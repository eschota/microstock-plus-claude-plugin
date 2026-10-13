// In-memory mock of the Microstock+ Agent API v1 (docs/AGENT_API_V1.md) for tests and
// local development. Zero dependencies: Node.js 18+ built-ins only.
//
// It creates fake mpk_live_ keys every time it starts. Never use real keys with it.
//
//   import { startMockApi } from "./mock-api.mjs";
//   const mock = await startMockApi();   // mock.baseUrl, mock.keys, mock.control, mock.requests, mock.close()
//
//   node tests/mock-api.mjs [--port 8787]   standalone: prints the base URL and the fake keys
//
// Besides the contract it implements GET /exports/{id}/download (the download_url of an
// export). GET /events/stream (Server-Sent Events) answers 501: the MCP server long-polls.
//
// Like the Agent API release that ships first, startMockApi({ disabledFeatures: [...] }) answers
// 403 endpoint_disabled for "status_changes" (status batch), "ai_keywording" (quote, run, jobs) and
// "event_stream", after authentication and before the scope check; startMockApi({ apiOff: true })
// answers every path with 404 not_found, as the API does while it is switched off for an account.

import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

const BASE_PATH = "/api/agent/v1";
const ALL_SCOPES = ["account:read", "files:read", "metadata:write", "status:write", "files:upload", "csv:export", "events:read", "ai:quote", "ai:run"];
const DEFAULT_SCOPES = ALL_SCOPES.filter(scope => scope !== "ai:run");
const MEDIA_TYPES = ["raster", "vector", "video"];
const READ_STATUSES = [
    "ready", "ignored", "queued", "uploading", "uploaded", "uploadfailed", "submitted", "submitfailed",
    "approved", "rejected", "approvalfailed", "notready", "scheduled", "cannotbequeued", "nosubmissions"
];
const SETTABLE_STATUSES = ["ready", "queued", "ignored"];
// The reasons the shipping Agent API sends with 403 endpoint_disabled.
const DISABLED_REASONS = {
    status_changes: "Changing statuses through the Agent API is not available yet; change them in My Files.",
    ai_keywording: "AI keywording is not available through the Agent API yet; start it in My Files.",
    event_stream: "The event stream is not available yet; poll GET /events with wait instead."
};
// Which current statuses each settable status may replace (simplified web-interface rules).
const STATUS_TRANSITIONS = {
    queued: ["ready", "queued", "uploadfailed", "submitfailed"],
    ready: ["ready", "ignored", "queued", "uploadfailed", "submitfailed", "notready"],
    ignored: ["ready", "ignored", "queued", "uploadfailed", "submitfailed", "notready"]
};
const MISSING_FIELDS = ["title", "description", "keywords", "categories"];
const PATCH_FIELDS = ["title", "description", "keywords", "categories", "editorial", "ai_generated", "illustration", "releases", "notes"];
const CSV_FORMATS = ["default", "with_title", "importable", "with_release_names", "without_categories", "nimia", "alamy"];
const EVENT_TYPES = [
    "file.metadata.updated", "file.status.changed", "file.uploaded", "file.submitted", "file.reviewed",
    "ai.quote.created", "ai.job.started", "ai.job.completed", "ai.job.failed", "export.ready", "key.created", "key.revoked"
];
const TITLE_MAX = 200;
const KEYWORDS_MAX = 50;
const BATCH_MAX_ITEMS = 100;
const EXPORT_MAX_ROWS = 500;
const AI_MAX_IIDS = 1000;
const AI_PRICE_EUR = 0.03;
const QUOTE_TTL_MS = 15 * 60_000;
const EXPORT_TTL_MS = 60 * 60_000;
const EVENT_WAIT_MAX_S = 25;
const PIPELINE_STEP_MS = 60;
const MOCK_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const AGENCIES = [
    { id: "adobestock", name: "Adobe Stock" },
    { id: "shutterstock", name: "Shutterstock" },
    { id: "esp", name: "iStock" },
    { id: "pond5", name: "Pond5" }
];
// Simplified per-agency validation, in the spirit of the Microstock+ agency rules.
const AGENCY_RULES = {
    adobestock: { minKeywords: 5, maxKeywords: 49, titleRequired: true, titleMax: 200, descriptionMax: 200 },
    shutterstock: { minKeywords: 7, maxKeywords: 50, descriptionRequired: true, descriptionMax: 200 },
    esp: { minKeywords: 5, maxKeywords: 49, titleRequired: true, titleMax: 255 },
    pond5: { minKeywords: 1, maxKeywords: 50, titleRequired: true, titleMax: 80, descriptionMax: 500 }
};
const FOLDERS = [
    { path: "/foto", archived: false },
    { path: "/foto/2026", archived: false },
    { path: "/foto/2026/autumn", archived: false },
    { path: "/vector", archived: false },
    { path: "/vector/icons", archived: false },
    { path: "/video", archived: false },
    { path: "/video/drone", archived: false },
    { path: "/archive", archived: true },
    { path: "/archive/2019", archived: true }
];

// ---------------------------------------------------------------------------
// Helpers

class ApiFailure extends Error {
    constructor(status, type, code, message, param, headers) {
        super(message);
        Object.assign(this, { status, type, code, param, headers });
    }
}

const fail = {
    invalid: (code, message, param) => new ApiFailure(400, "invalid_request_error", code, message, param),
    auth: (code, message) => new ApiFailure(401, "authentication_error", code, message),
    permission: (code, message, param) => new ApiFailure(403, "permission_error", code, message, param),
    notFound: (code, message, param) => new ApiFailure(404, "not_found_error", code, message, param),
    conflict: (code, message, param) => new ApiFailure(409, "conflict_error", code, message, param)
};

function iso(time = Date.now()) {
    return new Date(time).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function round2(value) {
    return Math.round(value * 100) / 100;
}

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseList(value) {
    return String(value || "").split(",").map(item => item.trim()).filter(Boolean);
}

function parseBool(value, name, fallback) {
    if (value === null || value === undefined || value === "") return fallback;
    if (value === "true" || value === "1") return true;
    if (value === "false" || value === "0") return false;
    throw fail.invalid("invalid_param", `${name} must be true or false.`, name);
}

function parseInteger(value, name, { min, max, fallback }) {
    if (value === null || value === undefined || value === "") return fallback;
    const number = Number(value);
    if (!Number.isInteger(number) || number < min || number > max) {
        throw fail.invalid("invalid_param", `${name} must be a whole number from ${min} to ${max}.`, name);
    }
    return number;
}

function encodeCursor(offset) {
    return Buffer.from(JSON.stringify({ o: offset })).toString("base64url");
}

function decodeCursor(cursor) {
    if (!cursor) return 0;
    try {
        const { o } = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
        if (Number.isInteger(o) && o >= 0) return o;
    } catch {
        // Falls through to the error below.
    }
    throw fail.invalid("invalid_cursor", "The cursor is not valid. Start again without a cursor.", "cursor");
}

function paginate(items, query) {
    const limit = parseInteger(query.get("limit"), "limit", { min: 1, max: 200, fallback: 50 });
    const offset = decodeCursor(query.get("cursor"));
    const data = items.slice(offset, offset + limit);
    const hasMore = offset + limit < items.length;
    return { object: "list", data, has_more: hasMore, next_cursor: hasMore ? encodeCursor(offset + limit) : null };
}

function makeKey(name, scopes) {
    const prefix = randomBytes(4).toString("hex");
    const secret = randomBytes(32).toString("base64url");
    return {
        full: `mpk_live_${prefix}_${secret}`,
        record: {
            prefix, name, scopes, status: "active", created_at: iso(), last_used_at: null, request_count: 0
        }
    };
}

function inFolder(file, folder, recursive) {
    if (folder === "/") return recursive || file.folder === "/";
    return file.folder === folder || (recursive && file.folder.startsWith(`${folder}/`));
}

function isIidList(text) {
    const parts = parseList(text);
    return parts.length > 0 && parts.every(part => /^[0-9a-f]{24}$/.test(part));
}

// ---------------------------------------------------------------------------
// Seed data

function agencyState(status, extra = {}) {
    return { status, errors: [], validation: [], ...extra };
}

function seedFile(iid, type, folder, filename, metadata, agencies, extra = {}) {
    const created = iso(Date.parse("2026-10-01T09:12:00Z"));
    return {
        object: "file",
        iid,
        type,
        folder,
        filename,
        size_bytes: type === "video" ? 152_334_112 : type === "vector" ? 2_410_884 : 8_423_311,
        created_at: created,
        updated_at: created,
        archived: false,
        preview_url: `https://mock.microstock.plus/previews/${iid}.jpg`,
        thumbnail_url: `https://mock.microstock.plus/thumbs/${iid}.jpg`,
        metaver: 1,
        metadata: {
            title: null,
            description: null,
            keywords: [],
            categories: [],
            editorial: false,
            ai_generated: false,
            illustration: false,
            releases: [],
            notes: null,
            ...metadata
        },
        agencies,
        has_ai_metadata: false,
        ...extra
    };
}

function words(count, prefix) {
    return Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`);
}

function seedFiles() {
    return [
        seedFile("6abc74e948864d403ea0c559", "raster", "/foto/2026/autumn", "IMG_0042.jpg", {
            title: "Autumn forest road at sunrise",
            description: "Empty road through a golden autumn forest at sunrise, seen from above",
            keywords: ["autumn", "forest", "road", "sunrise"],
            categories: [{ cat: 12, sub: 3 }],
            releases: ["rel_123"]
        }, {
            adobestock: agencyState("submitted", { external_id: "123456", uploaded_at: "2026-10-01T10:00:00Z", submitted_at: "2026-10-01T10:05:00Z" }),
            shutterstock: agencyState("ready"),
            esp: agencyState("ready")
        }),
        seedFile("6abc74e948864d403ea0c560", "raster", "/foto/2026/autumn", "IMG_0043.jpg", {}, {
            adobestock: agencyState("ready"),
            shutterstock: agencyState("ready")
        }),
        seedFile("6abc74e948864d403ea0c561", "raster", "/foto/2026/autumn", "IMG_0044.jpg", {
            title: "Red maple leaves on wet asphalt",
            description: "Close-up of red maple leaves lying on wet asphalt after autumn rain",
            keywords: ["maple", "leaves", "red", "autumn", "asphalt", "wet", "rain", "fall", "season", "nature", "closeup", "texture"],
            categories: [{ cat: 12, sub: 1 }]
        }, {
            adobestock: agencyState("ready"),
            shutterstock: agencyState("ready"),
            pond5: agencyState("ready")
        }),
        seedFile("6abc74e948864d403ea0c562", "raster", "/foto/2026", "DSC_1001.jpg", {
            title: "Lighthouse on a rocky coast during a storm",
            description: "Waves crash against the rocks below a white lighthouse under dark storm clouds",
            keywords: words(30, "coast")
        }, {
            adobestock: agencyState("approved", { external_id: "778899" }),
            shutterstock: agencyState("approved", { external_id: "2233445566" })
        }),
        seedFile("6abc74e948864d403ea0c563", "vector", "/vector/icons", "icons_set.eps", {
            title: "Set of flat coffee shop icons",
            description: "Flat vector icons for a coffee shop menu: cup, beans, grinder and croissant",
            keywords: words(20, "icon"),
            illustration: true
        }, {
            adobestock: agencyState("ready"),
            shutterstock: agencyState("ready")
        }),
        seedFile("6abc74e948864d403ea0c564", "video", "/video/drone", "drone_coast.mov", {
            title: "Drone flight over a turquoise lagoon",
            description: "Aerial 4K footage of a turquoise lagoon with a wooden pier",
            keywords: ["drone", "aerial", "lagoon", "turquoise", "pier", "sea", "summer", "travel"]
        }, {
            pond5: agencyState("ready"),
            adobestock: agencyState("ready")
        }),
        seedFile("6abc74e948864d403ea0c565", "raster", "/archive/2019", "old_scan.jpg", {
            title: "Old film scan of a village street",
            keywords: ["village", "street", "film", "vintage", "scan"]
        }, {}, { archived: true }),
        seedFile("6abc74e948864d403ea0c566", "raster", "/foto/2026", "city_night.jpg", {
            title: "Futuristic city skyline at night with neon lights",
            description: "Imaginary futuristic city skyline at night with glowing neon lights",
            keywords: words(15, "city"),
            ai_generated: true
        }, {
            adobestock: agencyState("ready")
        })
    ];
}

// ---------------------------------------------------------------------------
// Validation and metadata patches

function validationFor(file, agencyId) {
    const rules = AGENCY_RULES[agencyId];
    if (!rules) return [];
    const meta = file.metadata;
    const issues = [];
    const count = meta.keywords.length;
    if (rules.titleRequired && !meta.title) issues.push({ code: "title_missing", message: "Title is missing" });
    if (rules.descriptionRequired && !meta.description) issues.push({ code: "description_missing", message: "Description is missing" });
    if (count < rules.minKeywords) issues.push({ code: "keywords_min", message: `Less than ${rules.minKeywords} keywords` });
    if (count > rules.maxKeywords) issues.push({ code: "keywords_max", message: `More than ${rules.maxKeywords} keywords` });
    if (rules.titleMax && meta.title && meta.title.length > rules.titleMax) {
        issues.push({ code: "title_too_long", message: `Title is longer than ${rules.titleMax} characters` });
    }
    if (rules.descriptionMax && meta.description && meta.description.length > rules.descriptionMax) {
        issues.push({ code: "description_too_long", message: `Description is longer than ${rules.descriptionMax} characters` });
    }
    return issues;
}

function revalidate(file) {
    for (const [agencyId, state] of Object.entries(file.agencies)) state.validation = validationFor(file, agencyId);
}

function applyTermOps(current, ops, name, { lowercase, max }) {
    if (!isPlainObject(ops)) throw fail.invalid(`invalid_${name}`, `${name} must be an object with set, add or remove.`, name);
    const unknown = Object.keys(ops).filter(key => !["set", "add", "remove"].includes(key));
    if (unknown.length) throw fail.invalid(`invalid_${name}`, `${name} accepts only set, add and remove.`, name);
    if (ops.set !== undefined && (ops.add !== undefined || ops.remove !== undefined)) {
        throw fail.invalid(`invalid_${name}`, `${name}: use set alone, or add and/or remove.`, name);
    }
    const clean = list => {
        if (!Array.isArray(list) || list.some(item => typeof item !== "string")) {
            throw fail.invalid(`invalid_${name}`, `${name} lists must contain strings.`, name);
        }
        return list.map(item => (lowercase ? item.trim().toLowerCase() : item.trim())).filter(Boolean);
    };
    const dedupe = list => {
        const seen = new Set();
        return list.filter(item => {
            const key = item.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    };
    let result;
    if (ops.set !== undefined) {
        result = dedupe(clean(ops.set));
    } else {
        const removed = new Set(clean(ops.remove ?? []).map(item => item.toLowerCase()));
        result = dedupe([...current.filter(item => !removed.has(item.toLowerCase())), ...clean(ops.add ?? [])]);
    }
    if (max && result.length > max) {
        throw fail.invalid(`${name}_too_many`, `A file can have at most ${max} ${name}.`, name);
    }
    return result;
}

function patchedText(value, name, max) {
    if (value === null) return null;
    if (typeof value !== "string") throw fail.invalid("invalid_param", `${name} must be a string or null.`, name);
    const text = value.trim();
    if (!text) throw fail.invalid("empty_value", `${name} must not be empty; send null to clear it.`, name);
    if (max && text.length > max) throw fail.invalid(`${name}_too_long`, `${name} must be at most ${max} characters.`, name);
    return text;
}

function patchedCategories(value) {
    if (value === null) return [];
    const valid = Array.isArray(value) && value.every(item => isPlainObject(item) && Number.isInteger(item.cat) &&
        (item.sub === undefined || item.sub === null || Number.isInteger(item.sub)));
    if (!valid) throw fail.invalid("invalid_param", "categories must be a list of {cat, sub} integers, or null.", "categories");
    return value.map(item => ({ cat: item.cat, sub: item.sub ?? null }));
}

function patchedFlag(value, name) {
    if (typeof value !== "boolean") throw fail.invalid("invalid_param", `${name} must be true or false.`, name);
    return value;
}

// Returns { file, fields } with the patch applied to a copy of the file; throws ApiFailure.
function applyPatch(file, patch, settings) {
    if (!isPlainObject(patch)) throw fail.invalid("invalid_param", "The patch must be an object.");
    const unknown = Object.keys(patch).filter(key => !PATCH_FIELDS.includes(key));
    if (unknown.length) throw fail.invalid("unknown_field", `Unknown metadata field: ${unknown[0]}.`, unknown[0]);
    const next = clone(file);
    const meta = next.metadata;
    if (patch.title !== undefined) meta.title = patchedText(patch.title, "title", TITLE_MAX);
    if (patch.description !== undefined) meta.description = patchedText(patch.description, "description");
    if (patch.notes !== undefined) meta.notes = patchedText(patch.notes, "notes");
    if (patch.keywords !== undefined) {
        meta.keywords = applyTermOps(meta.keywords, patch.keywords, "keywords", { lowercase: settings.lowercase_keywords, max: KEYWORDS_MAX });
    }
    if (patch.releases !== undefined) meta.releases = applyTermOps(meta.releases, patch.releases, "releases", { lowercase: false });
    if (patch.categories !== undefined) meta.categories = patchedCategories(patch.categories);
    for (const flag of ["editorial", "ai_generated", "illustration"]) {
        if (patch[flag] !== undefined) meta[flag] = patchedFlag(patch[flag], flag);
    }
    if (patch.ai_generated === true && patch.editorial === true) {
        throw fail.invalid("invalid_combination", "AI-generated content cannot be editorial.", "editorial");
    }
    if (meta.ai_generated && patch.editorial === true) {
        throw fail.invalid("invalid_combination", "This file is AI generated, so it cannot be editorial.", "editorial");
    }
    if (meta.ai_generated) meta.editorial = false;
    const fields = PATCH_FIELDS.filter(field => JSON.stringify(meta[field]) !== JSON.stringify(file.metadata[field]));
    if (fields.length) {
        next.metaver = file.metaver + 1;
        next.updated_at = iso();
        revalidate(next);
    }
    return { file: next, fields };
}

// ---------------------------------------------------------------------------
// CSV exports (the layouts of Export CSV in My Files, simplified)

const CSV_LAYOUTS = {
    default: ["filename", "description", "keywords", "category1", "category2", "releasefiles"],
    with_title: ["filename", "title", "description", "keywords", "category1", "category2", "releasefiles"],
    importable: ["filename", "title", "description", "keywords", "categories", "releasefiles", "flags"],
    with_release_names: ["filename", "title", "description", "keywords", "categories", "releasenames"],
    without_categories: ["filename", "title", "description", "keywords", "releasefiles"],
    nimia: ["filename", "title", "description", "keywords", "license", "public", "exclusive"],
    alamy: ["Caption", "Essential keywords", "Main keywords", "Description", "License"]
};

function csvCell(column, file, format) {
    const meta = file.metadata;
    const category = index => {
        const item = meta.categories[index];
        return item ? `${item.cat}|${item.sub ?? ""}` : "";
    };
    switch (column) {
        case "filename": return file.filename;
        case "title":
        case "Caption": return meta.title ?? "";
        case "description":
        case "Description": return meta.description ?? "";
        case "keywords": return meta.keywords.join(format === "nimia" ? ", " : "; ");
        case "Essential keywords": return meta.keywords.slice(0, 10).join("; ");
        case "Main keywords": return meta.keywords.slice(10).join("; ");
        case "category1": return category(0);
        case "category2": return category(1);
        case "categories": return meta.categories.map(item => `${item.cat}|${item.sub ?? ""}`).join("; ");
        case "releasefiles":
        case "releasenames": return meta.releases.join("; ");
        case "flags": return `${meta.editorial ? "E" : ""}${meta.illustration ? "I" : ""}`;
        case "license": return "rf_basic";
        case "public": return "TRUE";
        case "exclusive": return "FALSE";
        case "License": return "RF";
        default: return "";
    }
}

function csvValue(value) {
    let text = String(value ?? "");
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
}

function buildCsv(files, format, delimiter) {
    const separator = delimiter === "semicolon" ? ";" : ",";
    const columns = CSV_LAYOUTS[format];
    const lines = [columns.map(csvValue).join(separator)];
    for (const file of files) lines.push(columns.map(column => csvValue(csvCell(column, file, format))).join(separator));
    return `${lines.join("\r\n")}\r\n`;
}

// ---------------------------------------------------------------------------
// The mock server

export { ALL_SCOPES, DEFAULT_SCOPES };

export async function startMockApi({ port = 0, host = "127.0.0.1", rateLimits = {}, disabledFeatures = [], apiOff = false } = {}) {
    const disabled = new Set(disabledFeatures);
    const limits = { requests: rateLimits.requests ?? 120, mutations: rateLimits.mutations ?? 30 };
    const keys = {};
    const keyRecords = new Map();
    const addKey = (alias, name, scopes) => {
        const key = makeKey(name, scopes);
        keys[alias] = key.full;
        keyRecords.set(key.full, key.record);
        return key;
    };
    addKey("full", "Claude Code (all scopes)", ALL_SCOPES);
    addKey("standard", "Cursor (default scopes)", DEFAULT_SCOPES);
    addKey("readonly", "Read-only report bot", ["files:read", "events:read"]);
    addKey("quoteOnly", "Price checker", ["files:read", "ai:quote"]);
    addKey("revoked", "Old laptop", DEFAULT_SCOPES).record.status = "revoked";

    const state = {
        account: {
            id: "usr_mock_1",
            name: "Mock Contributor",
            plan: { id: "pro", name: "Pro", expires_at: "2027-01-01T00:00:00Z" },
            balance_eur: 25,
            settings: { lowercase_keywords: true, max_keywords: KEYWORDS_MAX }
        },
        submissionsLeft: { pond5: 0 },
        files: new Map(seedFiles().map(file => [file.iid, file])),
        events: [],
        quotes: new Map(),
        jobs: new Map(),
        exports: new Map(),
        idempotency: new Map(),
        rate: new Map(),
        forced429: { remaining: 0, retryAfter: 1 },
        eventSeq: 0
    };
    for (const file of state.files.values()) revalidate(file);
    const waiters = new Set();
    const timers = new Set();
    const requests = [];
    let baseUrl = "";

    function later(ms, fn) {
        const timer = setTimeout(() => {
            timers.delete(timer);
            fn();
        }, ms);
        timer.unref?.();
        timers.add(timer);
    }

    function pushEvent(type, data, actor) {
        state.eventSeq += 1;
        const event = { object: "event", id: `evt_${String(state.eventSeq).padStart(6, "0")}`, type, created_at: iso(), actor, data };
        state.events.push(event);
        for (const waiter of [...waiters]) waiter(event);
        return event;
    }

    function agentActor(key) {
        return { kind: "agent", key_prefix: key.prefix, key_name: key.name };
    }

    function getFileOr404(iid) {
        const file = state.files.get(iid);
        if (!file) throw fail.notFound("file_not_found", `No file with iid ${iid}.`, "iid");
        return file;
    }

    function publicFile(file, { withDescription = true } = {}) {
        const copy = clone(file);
        delete copy.updated_at;
        if (!withDescription) delete copy.metadata.description;
        return copy;
    }

    function commonFolder(files) {
        const folders = [...new Set(files.map(file => file.folder))];
        return folders.length === 1 ? folders[0] : null;
    }

    // --- GET /me
    function getMe(ctx) {
        return {
            body: {
                object: "account",
                ...clone(state.account),
                agencies: clone(AGENCIES),
                limits: {
                    requests_per_minute: limits.requests,
                    mutations_per_minute: limits.mutations,
                    concurrent_streams: 2,
                    batch_max_items: BATCH_MAX_ITEMS,
                    list_max_limit: 200
                },
                key: {
                    prefix: ctx.key.prefix,
                    name: ctx.key.name,
                    scopes: [...ctx.key.scopes],
                    created_at: ctx.key.created_at,
                    last_used_at: ctx.key.last_used_at
                }
            }
        };
    }

    // --- GET /folders
    function folderObject(folder) {
        const files = [...state.files.values()].filter(file => file.folder === folder.path);
        const summary = {};
        for (const file of files) {
            for (const [agencyId, agencyState] of Object.entries(file.agencies)) {
                summary[agencyId] ??= {};
                summary[agencyId][agencyState.status] = (summary[agencyId][agencyState.status] || 0) + 1;
            }
        }
        const depth = folder.path.split("/").length;
        return {
            object: "folder",
            path: folder.path,
            file_count: files.length,
            subfolder_count: FOLDERS.filter(other => other.path.startsWith(`${folder.path}/`) && other.path.split("/").length === depth + 1).length,
            archived: folder.archived,
            status_summary: summary
        };
    }

    function listFolders(ctx) {
        const root = ctx.query.get("path") || "/";
        const recursive = parseBool(ctx.query.get("recursive"), "recursive", true);
        const archived = parseBool(ctx.query.get("archived"), "archived", false);
        if (root !== "/" && !FOLDERS.some(folder => folder.path === root)) throw fail.notFound("folder_not_found", `No folder ${root}.`, "path");
        const rootDepth = root === "/" ? 1 : root.split("/").length;
        const folders = FOLDERS.filter(folder => {
            const below = root === "/" || folder.path.startsWith(`${root}/`);
            const direct = folder.path.split("/").length === rootDepth + (root === "/" ? 0 : 1);
            return below && (recursive || direct) && folder.archived === archived;
        });
        return { body: paginate(folders.map(folderObject), ctx.query) };
    }

    // --- GET /files
    function fileMatches(file, filters) {
        const meta = file.metadata;
        if (!inFolder(file, filters.folder, filters.recursive)) return false;
        if (file.archived !== filters.archived) return false;
        if (filters.iids && !filters.iids.includes(file.iid)) return false;
        if (filters.text) {
            const haystack = [file.filename, meta.title || "", ...meta.keywords].join(" ").toLowerCase();
            if (!haystack.includes(filters.text)) return false;
        }
        if (filters.type && file.type !== filters.type) return false;
        if (filters.agency) {
            const agencyState = file.agencies[filters.agency];
            if (!agencyState) return false;
            if (filters.status && agencyState.status !== filters.status) return false;
        }
        if (filters.missing.length) {
            const lacks = {
                title: !meta.title,
                description: !meta.description,
                keywords: meta.keywords.length === 0,
                categories: meta.categories.length === 0
            };
            if (!filters.missing.some(field => lacks[field])) return false;
        }
        if (filters.minKeywords !== undefined && meta.keywords.length < filters.minKeywords) return false;
        if (filters.maxKeywords !== undefined && meta.keywords.length > filters.maxKeywords) return false;
        if (filters.updatedSince !== undefined && Date.parse(file.updated_at) < filters.updatedSince) return false;
        return true;
    }

    function fileFilters(query) {
        const search = query.get("search") || "";
        const type = query.get("type") || undefined;
        if (type && !MEDIA_TYPES.includes(type)) throw fail.invalid("invalid_param", `type must be one of ${MEDIA_TYPES.join(", ")}.`, "type");
        const agency = query.get("agency") || undefined;
        const status = query.get("status") || undefined;
        if (status && !READ_STATUSES.includes(status)) throw fail.invalid("invalid_status", `Unknown status ${status}.`, "status");
        if (status && !agency) throw fail.invalid("missing_param", "status needs agency.", "agency");
        const missing = parseList(query.get("missing"));
        if (missing.some(field => !MISSING_FIELDS.includes(field))) {
            throw fail.invalid("invalid_param", `missing accepts ${MISSING_FIELDS.join(", ")}.`, "missing");
        }
        const updatedSince = query.get("updated_since");
        if (updatedSince && !Number.isFinite(Date.parse(updatedSince))) throw fail.invalid("invalid_param", "updated_since must be an ISO-8601 time.", "updated_since");
        return {
            folder: query.get("folder") || "/",
            recursive: parseBool(query.get("recursive"), "recursive", false),
            archived: parseBool(query.get("archived"), "archived", false),
            iids: isIidList(search) ? parseList(search) : undefined,
            text: search && !isIidList(search) ? search.toLowerCase() : undefined,
            type,
            agency,
            status,
            missing,
            minKeywords: parseInteger(query.get("min_keywords"), "min_keywords", { min: 0, max: 1000, fallback: undefined }),
            maxKeywords: parseInteger(query.get("max_keywords"), "max_keywords", { min: 0, max: 1000, fallback: undefined }),
            updatedSince: updatedSince ? Date.parse(updatedSince) : undefined
        };
    }

    function listFiles(ctx) {
        const filters = fileFilters(ctx.query);
        const withDescription = ctx.query.get("expand") === "metadata";
        const files = [...state.files.values()]
            .filter(file => fileMatches(file, filters))
            .sort((a, b) => a.folder.localeCompare(b.folder) || a.filename.localeCompare(b.filename))
            .map(file => publicFile(file, { withDescription }));
        return { body: paginate(files, ctx.query) };
    }

    function getPreviews(ctx) {
        const { iids, detail = "preview" } = ctx.body;
        if (!Array.isArray(iids) || iids.length < 1 || iids.length > 8) {
            throw fail.invalid("invalid_param", "iids must contain 1 to 8 file ids.", "iids");
        }
        if (!iids.every(iid => typeof iid === "string" && /^[0-9a-f]{24}$/.test(iid))) {
            throw fail.invalid("invalid_param", "Every iid must be a 24-character lowercase hexadecimal id.", "iids");
        }
        if (!["preview", "thumbnail"].includes(detail)) {
            throw fail.invalid("invalid_param", "detail must be preview or thumbnail.", "detail");
        }
        const previews = iids.map(iid => {
            if (!state.files.has(iid)) {
                return { iid, state: "unavailable", error_code: "file_not_found", message: "The file was not found." };
            }
            if (iid.endsWith("560")) {
                return { iid, state: "processing", error_code: "preview_processing", message: "The preview is still being prepared." };
            }
            return {
                iid, state: "ready", mime_type: "image/png", data_base64: MOCK_PNG_BASE64,
                width: detail === "thumbnail" ? 1 : 1, height: 1, source: "generated"
            };
        });
        return { body: { object: "preview_batch", previews } };
    }

    function getPreviewLinks(ctx) {
        const { iids } = ctx.body;
        if (!Array.isArray(iids) || iids.length < 1 || iids.length > 200) {
            throw fail.invalid("invalid_param", "iids must contain 1 to 200 file ids.", "iids");
        }
        const links = iids.map(iid => state.files.has(iid) && !iid.endsWith("560")
            ? { iid, state: "ready", url: `http://127.0.0.1:${server.address().port}/api/agent/v1/previews/${iid.padEnd(43, "x")}/image`, expires_at: iso(Date.now() + 300_000) }
            : { iid, state: "unavailable", error_code: "preview_unavailable", message: "The preview is unavailable." });
        return { body: { object: "preview_links", links } };
    }

    function resolveIstockTerms(ctx) {
        const { iids, stock = "esp", locale = "en" } = ctx.body;
        if (!Array.isArray(iids) || iids.length < 1 || iids.length > 10) throw fail.invalid("invalid_param", "iids must contain 1 to 10 file ids.", "iids");
        if (!["esp", "qhero"].includes(stock)) throw fail.invalid("invalid_stock", "stock must be esp or qhero.", "stock");
        if (locale !== "en") throw fail.invalid("invalid_locale", "Only the en iStock vocabulary is supported.", "locale");
        const files = iids.map(iid => {
            const file = getFileOr404(iid);
            const keywords = [...file.metadata.keywords];
            if (iid.endsWith("560")) {
                return { iid, state: "pending", metaver: file.metaver, keywords, unresolved_keywords: [], candidates: {}, selections: {}, candidate_set_id: null, source: "pending", observed_at: iso(), source_fresh_at: null };
            }
            const candidates = Object.fromEntries(keywords.map((keyword, index) => [keyword, [
                { id: String(1000 + index * 2), label: `${keyword} (primary meaning)` },
                { id: String(1001 + index * 2), label: `${keyword} (alternate meaning)` }
            ]]));
            return {
                iid, state: "ready", metaver: file.metaver, keywords, unresolved_keywords: [], candidates,
                selections: Object.fromEntries(keywords.slice(0, 1).map((keyword, index) => [keyword, [String(1000 + index * 2)]])),
                candidate_set_id: `istk_${iid.padEnd(64, "0")}`, source: "cache_and_provider", observed_at: iso(), source_fresh_at: iso()
            };
        });
        return { body: { object: "istock_terms_resolution", files } };
    }

    function setIstockTerms(ctx) {
        const { dry_run: dryRun, stock = "esp", locale = "en", patches } = ctx.body;
        if (typeof dryRun !== "boolean" || !Array.isArray(patches) || patches.length < 1 || patches.length > 10) {
            throw fail.invalid("invalid_patches", "dry_run and 1 to 10 patches are required.", "patches");
        }
        if (!["esp", "qhero"].includes(stock)) throw fail.invalid("invalid_stock", "stock must be esp or qhero.", "stock");
        if (locale !== "en") throw fail.invalid("invalid_locale", "Only the en iStock vocabulary is supported.", "locale");
        const results = patches.map(patch => {
            const file = getFileOr404(patch.iid);
            if (file.metaver !== patch.if_match_metaver) return { iid: patch.iid, ok: false, error: { type: "conflict_error", code: "metadata_conflict", message: "The file metadata changed.", param: "if_match_metaver" } };
            if (patch.candidate_set_id !== `istk_${patch.iid.padEnd(64, "0")}`) return { iid: patch.iid, ok: false, error: { type: "conflict_error", code: "candidate_set_changed", message: "The candidate set changed.", param: "candidate_set_id" } };
            const keywordIndex = new Map(file.metadata.keywords.map((keyword, index) => [keyword, index]));
            const valid = Object.entries(patch.selections || {}).every(([keyword, ids]) => {
                const index = keywordIndex.get(keyword);
                return index !== undefined && Array.isArray(ids) && ids.length === 1 &&
                    [String(1000 + index * 2), String(1001 + index * 2)].includes(ids[0]);
            });
            if (!valid) return { iid: patch.iid, ok: false, error: { type: "invalid_request_error", code: "invalid_istock_term", message: "A term was not offered.", param: "selections" } };
            if (!dryRun) {
                file.metaver += 1;
                file.updated_at = iso();
            }
            return { iid: patch.iid, ok: true, metaver: file.metaver, dry_run: dryRun, selections: patch.selections };
        });
        return { body: { object: "istock_terms_batch", results } };
    }

    // --- metadata
    function patchOne(iid, patch, ifMatch, dryRun) {
        const file = getFileOr404(iid);
        if (ifMatch !== undefined && ifMatch !== null && ifMatch !== file.metaver) {
            throw fail.conflict("metadata_conflict", `The file changed: it is at metaver ${file.metaver}, not ${ifMatch}.`, "if_match_metaver");
        }
        const result = applyPatch(file, patch, state.account.settings);
        if (!dryRun && result.fields.length) state.files.set(iid, result.file);
        return result;
    }

    function patchMetadata(ctx, iid) {
        const { if_match_metaver: ifMatch, ...patch } = ctx.body;
        if (ifMatch !== undefined && !Number.isInteger(ifMatch)) throw fail.invalid("invalid_param", "if_match_metaver must be an integer.", "if_match_metaver");
        const { file, fields } = patchOne(iid, patch, ifMatch, false);
        if (fields.length) {
            pushEvent("file.metadata.updated", { iids: [iid], fields, count: 1, folder: file.folder }, agentActor(ctx.key));
        }
        return { body: publicFile(file) };
    }

    function metadataBatch(ctx) {
        const { items, dry_run: dryRun = false } = ctx.body;
        if (!Array.isArray(items) || items.length === 0) throw fail.invalid("missing_param", "items must be a non-empty list.", "items");
        if (items.length > BATCH_MAX_ITEMS) throw fail.invalid("batch_too_large", `At most ${BATCH_MAX_ITEMS} items per batch.`, "items");
        if (typeof dryRun !== "boolean") throw fail.invalid("invalid_param", "dry_run must be true or false.", "dry_run");
        const results = [];
        const changed = [];
        const fields = new Set();
        for (const item of items) {
            const iid = isPlainObject(item) ? item.iid : undefined;
            try {
                if (typeof iid !== "string") throw fail.invalid("missing_param", "Each item needs an iid.", "iid");
                const result = patchOne(iid, item.patch, item.if_match_metaver, dryRun);
                results.push({ iid, ok: true, file: publicFile(result.file) });
                if (result.fields.length) {
                    changed.push(result.file);
                    result.fields.forEach(field => fields.add(field));
                }
            } catch (error) {
                if (!(error instanceof ApiFailure)) throw error;
                results.push({ iid: String(iid ?? ""), ok: false, error: { type: error.type, code: error.code, message: error.message, param: error.param ?? null } });
            }
        }
        if (!dryRun && changed.length) {
            pushEvent("file.metadata.updated", {
                iids: changed.map(file => file.iid), fields: [...fields], count: changed.length, folder: commonFolder(changed)
            }, agentActor(ctx.key));
        }
        const failed = results.filter(result => !result.ok).length;
        return { body: { object: "batch_result", results, succeeded: results.length - failed, failed } };
    }

    // --- statuses
    function setOneStatus(file, agencyId, status) {
        if (!AGENCIES.some(agency => agency.id === agencyId)) {
            throw fail.invalid("agency_not_connected", `${agencyId} is not connected to this account.`, "agencies");
        }
        const current = file.agencies[agencyId]?.status ?? "ready";
        if (!STATUS_TRANSITIONS[status].includes(current)) {
            throw fail.conflict("invalid_status_transition", `A file that is ${current} on ${agencyId} cannot be set to ${status}.`, "status");
        }
        if (status === "queued" && current !== "queued" && state.submissionsLeft[agencyId] === 0) {
            throw fail.invalid("nosubmissions", `No ${agencyId} submissions left on the current plan.`, "agencies");
        }
        file.agencies[agencyId] ??= { status: "ready", errors: [], validation: validationFor(file, agencyId) };
        file.agencies[agencyId].status = status;
        return current;
    }

    function statusBatch(ctx) {
        const { iids, agency, status, user_confirmed: userConfirmed } = ctx.body;
        if (!Array.isArray(iids) || iids.length === 0) throw fail.invalid("missing_param", "iids must be a non-empty list.", "iids");
        if (iids.length > BATCH_MAX_ITEMS) throw fail.invalid("batch_too_large", `At most ${BATCH_MAX_ITEMS} files per call.`, "iids");
        if (typeof agency !== "string" || !agency) throw fail.invalid("missing_param", "agency is required.", "agency");
        if (!SETTABLE_STATUSES.includes(status)) throw fail.invalid("invalid_status", `status must be one of ${SETTABLE_STATUSES.join(", ")}.`, "status");
        if (status === "queued" && userConfirmed !== true) throw fail.invalid("confirmation_required", "queued requires user_confirmed=true.", "user_confirmed");
        const results = [];
        const transitions = new Map();
        const queued = [];
        for (const iid of iids) {
            for (const agencyId of [agency]) {
                try {
                    const file = getFileOr404(iid);
                    const previous = setOneStatus(file, agencyId, status);
                    results.push({ iid, agency: agencyId, ok: true, status, previous_status: previous });
                    if (previous !== status) {
                        const groupKey = `${agencyId}|${previous}`;
                        if (!transitions.has(groupKey)) transitions.set(groupKey, { agency: agencyId, from: previous, to: status, iids: [] });
                        transitions.get(groupKey).iids.push(iid);
                        if (status === "queued") queued.push({ iid, agency: agencyId });
                    }
                } catch (error) {
                    if (!(error instanceof ApiFailure)) throw error;
                    results.push({ iid, agency: agencyId, ok: false, error: { type: error.type, code: error.code, message: error.message, param: error.param ?? null } });
                }
            }
        }
        for (const group of transitions.values()) {
            pushEvent("file.status.changed", { ...group, count: group.iids.length }, agentActor(ctx.key));
        }
        if (queued.length) simulatePipeline(queued);
        const failed = results.filter(result => !result.ok).length;
        return { body: { object: "batch_result", results, succeeded: results.length - failed, failed } };
    }

    function createFolder(ctx) {
        const directory = ctx.body.directory;
        if (typeof directory !== "string" || !directory.startsWith("/") || directory === "/") {
            throw fail.invalid("invalid_param", "directory must be a folder path below /.", "directory");
        }
        if (FOLDERS.some(folder => folder.path === directory)) throw fail.conflict("folder_exists", `Folder ${directory} already exists.`, "directory");
        const parent = directory.replace(/\/[^/]+$/, "") || "/";
        if (parent !== "/" && !FOLDERS.some(folder => folder.path === parent && !folder.archived)) {
            throw fail.notFound("folder_not_found", `Parent folder ${parent} does not exist.`, "directory");
        }
        FOLDERS.push({ path: directory, archived: false });
        return { body: { object: "folder", path: directory, file_count: 0, subfolder_count: 0, archived: false, status_summary: {} } };
    }

    // Queued files move on to uploading, uploaded and submitted, emitting events like M+ does.
    function simulatePipeline(pairs) {
        const steps = [["queued", "uploading"], ["uploading", "uploaded"], ["uploaded", "submitted"]];
        steps.forEach(([from, to], index) => later(PIPELINE_STEP_MS * (index + 1), () => {
            const byAgency = new Map();
            for (const { iid, agency } of pairs) {
                const agencyState = state.files.get(iid)?.agencies[agency];
                if (agencyState?.status !== from) continue;
                agencyState.status = to;
                if (to === "uploaded") agencyState.uploaded_at = iso();
                if (to === "submitted") agencyState.submitted_at = iso();
                if (!byAgency.has(agency)) byAgency.set(agency, []);
                byAgency.get(agency).push(iid);
            }
            for (const [agency, iids] of byAgency) {
                pushEvent("file.status.changed", { agency, from, to, iids, count: iids.length }, { kind: "system" });
                if (to === "uploaded") pushEvent("file.uploaded", { agency, iids, count: iids.length }, { kind: "system" });
                if (to === "submitted") pushEvent("file.submitted", { agency, iids, count: iids.length }, { kind: "system" });
            }
        }));
    }

    // --- exports
    function createExport(ctx) {
        const { iids, folder, recursive = false, format = "default", delimiter = "comma" } = ctx.body;
        if (!CSV_FORMATS.includes(format)) throw fail.invalid("invalid_format", `format must be one of ${CSV_FORMATS.join(", ")}.`, "format");
        if (!["comma", "semicolon"].includes(delimiter)) throw fail.invalid("invalid_param", "delimiter must be comma or semicolon.", "delimiter");
        let files;
        if (Array.isArray(iids)) {
            files = iids.map(getFileOr404);
        } else if (typeof folder === "string") {
            if (folder !== "/" && !FOLDERS.some(item => item.path === folder)) throw fail.notFound("folder_not_found", `No folder ${folder}.`, "folder");
            files = [...state.files.values()].filter(file => inFolder(file, folder, recursive === true))
                .sort((a, b) => a.folder.localeCompare(b.folder) || a.filename.localeCompare(b.filename));
        } else {
            throw fail.invalid("missing_param", "Send iids or folder.", "iids");
        }
        if (files.length === 0) throw fail.invalid("export_empty", "There are no files to export.", "iids");
        if (files.length > EXPORT_MAX_ROWS) throw fail.invalid("export_too_large", `An export can have at most ${EXPORT_MAX_ROWS} rows.`, "iids");
        const csv = buildCsv(files, format, delimiter);
        if (ctx.accept.includes("text/csv")) return { raw: csv, contentType: "text/csv; charset=utf-8" };
        const id = `exp_${randomBytes(12).toString("hex")}`;
        const exportObject = {
            object: "export",
            id,
            format,
            delimiter,
            rows: files.length,
            download_url: `${baseUrl}/exports/${id}/download`,
            expires_at: iso(Date.now() + EXPORT_TTL_MS)
        };
        state.exports.set(id, { csv, expiresAt: Date.now() + EXPORT_TTL_MS, prefix: ctx.key.prefix });
        pushEvent("export.ready", { export_id: id, rows: files.length, format }, agentActor(ctx.key));
        return { body: exportObject };
    }

    function initializeUpload(ctx) {
        const { filename, size_bytes: sizeBytes, content_type: contentType, directory } = ctx.body;
        if (typeof filename !== "string" || !filename || /[\\/]/.test(filename)) throw fail.invalid("invalid_param", "filename must be a file name without a path.", "filename");
        if (!Number.isInteger(sizeBytes) || sizeBytes < 1) throw fail.invalid("invalid_param", "size_bytes must be a positive integer.", "size_bytes");
        if (typeof contentType !== "string" || !contentType.includes("/")) throw fail.invalid("invalid_param", "content_type must be a MIME type.", "content_type");
        if (!FOLDERS.some(folder => folder.path === directory && !folder.archived)) throw fail.notFound("folder_not_found", `No active folder ${directory}.`, "directory");
        const id = `upl_${randomBytes(8).toString("hex")}`;
        return { body: {
            object: "upload_ticket",
            file_id: id,
            filename,
            directory,
            size_bytes: sizeBytes,
            content_type: contentType,
            expires_at: null,
            upload: {
                strategy: "multipart_chunks",
                chunk_size_bytes: 5 * 1024 * 1024,
                chunk_count: 1,
                uploaded_chunks: [],
                chunk: {
                    url: `${baseUrl}/uploads/${id}/chunk`,
                    method: "POST",
                    form_fields: { fileid: id, chunkNumber: "{chunk_number}" },
                    file_field: "chunk"
                },
                finish: { url: `${baseUrl}/uploads/${id}/finish`, method: "POST", form_fields: { fileid: id } }
            }
        } };
    }

    function downloadExport(ctx, id) {
        const stored = state.exports.get(id);
        if (!stored || stored.expiresAt < Date.now()) throw fail.notFound("export_not_found", "This export does not exist or has expired.", "id");
        return { raw: stored.csv, contentType: "text/csv; charset=utf-8", headers: { "Content-Disposition": `attachment; filename="${id}.csv"` } };
    }

    // --- AI keywording
    function quote(ctx) {
        const { iids, mode = "skip", template_id: templateId = null } = ctx.body;
        if (!Array.isArray(iids) || iids.length === 0) throw fail.invalid("missing_param", "iids must be a non-empty list.", "iids");
        if (iids.length > AI_MAX_IIDS) throw fail.invalid("batch_too_large", `At most ${AI_MAX_IIDS} files per quote.`, "iids");
        if (!["replace", "skip"].includes(mode)) throw fail.invalid("invalid_param", "mode must be replace or skip.", "mode");
        const files = iids.map(getFileOr404);
        const billable = files.filter(file => mode === "replace" || !(file.metadata.title && file.metadata.keywords.length));
        const quoteObject = {
            object: "ai_quote",
            quote_id: `q_${randomBytes(8).toString("hex")}`,
            files: billable.length,
            amount_eur: round2(billable.length * AI_PRICE_EUR),
            expires_at: iso(Date.now() + QUOTE_TTL_MS),
            mode
        };
        state.quotes.set(quoteObject.quote_id, {
            ...quoteObject, iids: billable.map(file => file.iid), templateId, expiresAt: Date.now() + QUOTE_TTL_MS, used: false
        });
        pushEvent("ai.quote.created", { quote_id: quoteObject.quote_id, files: quoteObject.files, amount_eur: quoteObject.amount_eur }, agentActor(ctx.key));
        return { body: quoteObject };
    }

    function run(ctx) {
        if (!ctx.idempotencyKey) throw fail.invalid("idempotency_key_required", "Paid actions need an Idempotency-Key header.", "Idempotency-Key");
        const stored = state.quotes.get(ctx.body.quote_id);
        if (!stored) throw fail.notFound("quote_not_found", "No such quote.", "quote_id");
        if (stored.expiresAt < Date.now()) throw fail.conflict("quote_expired", "The quote has expired; request a new one.", "quote_id");
        if (stored.used) throw fail.conflict("quote_used", "This quote was already run.", "quote_id");
        stored.used = true;
        const job = {
            object: "job",
            id: `job_${randomBytes(8).toString("hex")}`,
            type: "ai_keywording",
            status: "queued",
            quote_id: stored.quote_id,
            files_total: stored.iids.length,
            files_done: 0,
            files_failed: 0,
            amount_eur_quoted: stored.amount_eur,
            amount_eur_charged: 0,
            created_at: iso(),
            started_at: null,
            finished_at: null,
            error: null
        };
        state.jobs.set(job.id, job);
        later(50, () => {
            job.status = "running";
            job.started_at = iso();
            pushEvent("ai.job.started", { job_id: job.id, files_total: job.files_total }, agentActor(ctx.key));
        });
        later(250, () => finishJob(job, stored, ctx.key));
        return { body: clone(job) };
    }

    function finishJob(job, stored, key) {
        const changed = [];
        for (const iid of stored.iids) {
            const file = state.files.get(iid);
            if (!file) {
                job.files_failed += 1;
                continue;
            }
            const base = file.filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
            file.metadata.title = `Stock image ${base}`;
            file.metadata.description = `Generated description for ${base}`;
            file.metadata.keywords = ["stock", "image", "generated", "keywords", "sample", "photo", "mock", "test"];
            file.has_ai_metadata = true;
            file.metaver += 1;
            file.updated_at = iso();
            revalidate(file);
            changed.push(iid);
            job.files_done += 1;
        }
        job.amount_eur_charged = round2(job.files_done * AI_PRICE_EUR);
        state.account.balance_eur = round2(state.account.balance_eur - job.amount_eur_charged);
        job.status = "completed";
        job.finished_at = iso();
        if (changed.length) {
            pushEvent("file.metadata.updated", { iids: changed, fields: ["title", "description", "keywords"], count: changed.length, folder: null }, { kind: "system" });
        }
        pushEvent("ai.job.completed", {
            job_id: job.id, files_total: job.files_total, files_done: job.files_done, files_failed: job.files_failed, amount_eur_charged: job.amount_eur_charged
        }, agentActor(key));
    }

    function getJob(ctx, id) {
        const job = state.jobs.get(id);
        if (!job) throw fail.notFound("job_not_found", `No job ${id}.`, "id");
        return { body: clone(job) };
    }

    // --- events
    function eventsPage(since, types, limit) {
        const matches = event => types.length === 0 || types.includes(event.type);
        let pool;
        if (since) {
            const index = state.events.findIndex(event => event.id === since);
            if (index === -1) throw fail.invalid("invalid_cursor", "Unknown or expired event id in since.", "since");
            pool = state.events.slice(index + 1).filter(matches);
        } else {
            pool = state.events.filter(matches).slice(-limit);
        }
        const data = pool.slice(0, limit);
        const newest = state.events.at(-1)?.id ?? null;
        return {
            object: "list",
            data: clone(data),
            has_more: pool.length > data.length,
            next_cursor: data.length ? data.at(-1).id : (newest ?? (since || null))
        };
    }

    function waitForEvent(types, seconds, res) {
        return new Promise(resolve => {
            const finish = () => {
                clearTimeout(timer);
                waiters.delete(waiter);
                res.off("close", finish);
                resolve();
            };
            const waiter = event => {
                if (types.length === 0 || types.includes(event.type)) finish();
            };
            const timer = setTimeout(finish, seconds * 1000);
            waiters.add(waiter);
            res.on("close", finish);
        });
    }

    async function listEvents(ctx) {
        const since = ctx.query.get("since") || "";
        const types = parseList(ctx.query.get("types"));
        const unknown = types.find(type => !EVENT_TYPES.includes(type));
        if (unknown) throw fail.invalid("invalid_param", `Unknown event type ${unknown}.`, "types");
        const wait = Math.min(parseInteger(ctx.query.get("wait"), "wait", { min: 0, max: 3600, fallback: 0 }), EVENT_WAIT_MAX_S);
        const limit = parseInteger(ctx.query.get("limit"), "limit", { min: 1, max: 200, fallback: 50 });
        let page = eventsPage(since, types, limit);
        if (page.data.length === 0 && wait > 0) {
            await waitForEvent(types, wait, ctx.res);
            page = eventsPage(since, types, limit);
        }
        return { body: page };
    }

    function streamEvents() {
        return { status: 501, body: { error: { type: "api_error", code: "not_implemented", message: "The mock does not implement /events/stream; use GET /events." } } };
    }

    // --- routing
    const routes = [
        ["GET", /^\/me$/, "account:read", getMe],
        ["GET", /^\/folders$/, "files:read", listFolders],
        ["POST", /^\/folders$/, "files:upload", createFolder],
        ["GET", /^\/files$/, "files:read", listFiles],
        ["POST", /^\/files\/preview-links$/, "files:read", getPreviewLinks],
        ["POST", /^\/files\/previews$/, "files:read", getPreviews],
        ["POST", /^\/files\/istock-terms\/resolve$/, "files:read", resolveIstockTerms],
        ["POST", /^\/files\/istock-terms\/batch$/, "metadata:write", setIstockTerms],
        ["POST", /^\/files\/metadata:batch$/, "metadata:write", metadataBatch],
        ["POST", /^\/files\/status:batch$/, "status:write", statusBatch],
        ["GET", /^\/files\/([^/]+)$/, "files:read", getFileRoute],
        ["PATCH", /^\/files\/([^/]+)\/metadata$/, "metadata:write", patchMetadata],
        ["POST", /^\/exports\/csv$/, "csv:export", createExport],
        ["POST", /^\/uploads\/init$/, "files:upload", initializeUpload],
        ["GET", /^\/exports\/([^/]+)\/download$/, "csv:export", downloadExport],
        ["POST", /^\/ai\/keywording:quote$/, "ai:quote", quote, "ai_keywording"],
        ["POST", /^\/ai\/keywording:run$/, "ai:run", run, "ai_keywording"],
        ["GET", /^\/jobs\/([^/]+)$/, "files:read", getJob, "ai_keywording"],
        ["GET", /^\/events$/, "events:read", listEvents],
        ["GET", /^\/events\/stream$/, "events:read", streamEvents, "event_stream"]
    ];

    function getFileRoute(ctx, iid) {
        return { body: publicFile(getFileOr404(decodeURIComponent(iid))) };
    }

    function authenticate(req) {
        const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || "");
        if (!match) throw fail.auth("invalid_api_key", "Send the agent key as Authorization: Bearer mpk_live_....");
        const record = keyRecords.get(match[1]);
        if (!record) throw fail.auth("invalid_api_key", "This agent key is not valid.");
        if (record.status === "revoked") throw fail.auth("revoked_api_key", "This agent key was revoked.");
        record.last_used_at = iso();
        record.request_count += 1;
        return record;
    }

    function rateLimit(key, mutation) {
        const now = Date.now();
        let window = state.rate.get(key.prefix);
        if (!window || now - window.start >= 60_000) {
            window = { start: now, requests: 0, mutations: 0 };
            state.rate.set(key.prefix, window);
        }
        const reset = Math.max(1, Math.ceil((window.start + 60_000 - now) / 1000));
        const headers = remaining => ({
            "x-ratelimit-limit-requests": String(limits.requests),
            "x-ratelimit-remaining-requests": String(Math.max(0, remaining)),
            "x-ratelimit-reset-requests": String(reset)
        });
        if (state.forced429.remaining > 0) {
            state.forced429.remaining -= 1;
            throw new ApiFailure(429, "rate_limit_error", "rate_limited", "Too many requests.", undefined,
                { ...headers(0), "retry-after": String(state.forced429.retryAfter) });
        }
        window.requests += 1;
        if (mutation) window.mutations += 1;
        if (window.requests > limits.requests || (mutation && window.mutations > limits.mutations)) {
            throw new ApiFailure(429, "rate_limit_error", "rate_limited", "Too many requests.", undefined, { ...headers(0), "retry-after": String(reset) });
        }
        return headers(limits.requests - window.requests);
    }

    async function readBody(req) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        return Buffer.concat(chunks).toString("utf8");
    }

    function write(res, status, payload, headers) {
        if (res.writableEnded || res.destroyed) return;
        const isRaw = payload.raw !== undefined;
        res.writeHead(status, {
            "Content-Type": isRaw ? payload.contentType : "application/json; charset=utf-8",
            ...headers,
            ...(payload.headers || {})
        });
        res.end(isRaw ? payload.raw : JSON.stringify(payload.body));
    }

    function errorPayload(error, requestId) {
        return {
            body: {
                error: { type: error.type, code: error.code, message: error.message, param: error.param ?? null, request_id: requestId }
            }
        };
    }

    async function handle(req, res) {
        const requestId = `req_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
        const url = new URL(req.url, "http://mock.local");
        const record = {
            method: req.method,
            path: url.pathname,
            idempotencyKey: req.headers["idempotency-key"] || null,
            userAgent: req.headers["user-agent"] || null,
            status: 0
        };
        requests.push(record);
        let headers = { "x-request-id": requestId };
        try {
            if (!url.pathname.startsWith(`${BASE_PATH}/`)) throw fail.notFound("not_found", "Not an Agent API path.");
            if (apiOff) throw fail.notFound("not_found", "No such endpoint.");
            if (req.method === "DELETE") {
                throw new ApiFailure(405, "permission_error", "deletion_not_supported",
                    "Deleting is not available through the Agent API. Delete files in the Microstock+ web interface.");
            }
            const route = url.pathname.slice(BASE_PATH.length);
            const match = routes.map(([method, pattern, scope, handler, feature]) => ({ method, scope, handler, feature, params: pattern.exec(route) }))
                .filter(item => item.params);
            if (match.length === 0) throw fail.notFound("not_found", `No endpoint ${route}.`);
            const target = match.find(item => item.method === req.method);
            if (!target) throw new ApiFailure(405, "invalid_request_error", "method_not_allowed", `${req.method} is not allowed on ${route}.`);
            const key = authenticate(req);
            record.keyPrefix = key.prefix;
            const hasBody = req.method === "POST" || req.method === "PATCH";
            const mutation = hasBody && !["/files/previews", "/files/preview-links", "/files/istock-terms/resolve"]
                .includes(route);
            headers = { ...headers, ...rateLimit(key, mutation) };
            if (target.feature && disabled.has(target.feature)) {
                throw fail.permission("endpoint_disabled", DISABLED_REASONS[target.feature]);
            }
            if (!key.scopes.includes(target.scope)) {
                throw fail.permission("scope_required", `This key lacks the ${target.scope} scope.`, target.scope);
            }
            const rawBody = hasBody ? await readBody(req) : "";
            let body = {};
            if (hasBody) {
                try {
                    body = rawBody ? JSON.parse(rawBody) : {};
                } catch {
                    throw fail.invalid("invalid_json", "The request body is not valid JSON.");
                }
                if (!isPlainObject(body)) throw fail.invalid("invalid_json", "The request body must be a JSON object.");
            }
            const ctx = {
                key, query: url.searchParams, body, res, accept: String(req.headers.accept || ""),
                idempotencyKey: req.headers["idempotency-key"] || null
            };
            const storeKey = mutation && ctx.idempotencyKey ? `${key.prefix}:${ctx.idempotencyKey}` : null;
            const fingerprint = `${req.method} ${route} ${rawBody}`;
            if (storeKey && state.idempotency.has(storeKey)) {
                const stored = state.idempotency.get(storeKey);
                if (stored.fingerprint !== fingerprint) {
                    throw fail.conflict("idempotency_mismatch", "This Idempotency-Key was used with a different request.", "Idempotency-Key");
                }
                record.status = stored.status;
                write(res, stored.status, stored.payload, { ...headers, "idempotent-replayed": "true" });
                return;
            }
            let payload;
            let status;
            try {
                payload = await target.handler(ctx, ...target.params.slice(1));
                status = payload.status ?? 200;
            } catch (error) {
                if (!(error instanceof ApiFailure) || !storeKey) throw error;
                payload = errorPayload(error, requestId);
                status = error.status;
            }
            if (storeKey && status < 500) state.idempotency.set(storeKey, { fingerprint, status, payload });
            record.status = status;
            write(res, status, payload, headers);
        } catch (error) {
            const failure = error instanceof ApiFailure ? error : new ApiFailure(500, "api_error", "internal_error", "Mock internal error.");
            if (!(error instanceof ApiFailure)) process.stderr.write(`[mock-api] ${error?.stack || error}\n`);
            record.status = failure.status;
            write(res, failure.status, errorPayload(failure, requestId), { ...headers, ...(failure.headers || {}) });
        }
    }

    const server = createServer((req, res) => {
        handle(req, res).catch(error => {
            process.stderr.write(`[mock-api] ${error?.stack || error}\n`);
            if (!res.headersSent) res.writeHead(500).end();
        });
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, resolve);
    });
    baseUrl = `http://${host}:${server.address().port}${BASE_PATH}`;

    const control = {
        // The next `times` authenticated requests answer 429 with Retry-After: retryAfter seconds.
        force429(times = 1, retryAfter = 1) {
            state.forced429 = { remaining: times, retryAfter };
        },
        expireQuote(quoteId) {
            const stored = state.quotes.get(quoteId);
            if (stored) stored.expiresAt = Date.now() - 1000;
        },
        // Changes a key's scopes, as the key owner could on the AI Agent Skills page.
        setScopes(alias, scopes) {
            keyRecords.get(keys[alias]).scopes = [...scopes];
        },
        file: iid => clone(state.files.get(iid)),
        jobCount: () => state.jobs.size,
        balance: () => state.account.balance_eur,
        // The shipping Agent API reports balance_eur as null.
        setBalance(value) {
            state.account.balance_eur = value;
        },
        eventCount: () => state.events.length
    };

    async function close() {
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
        for (const waiter of [...waiters]) waiter({ type: "__closing__" });
        server.closeAllConnections?.();
        await new Promise(resolve => server.close(() => resolve()));
    }

    return { baseUrl, keys, control, requests, close };
}

// ---------------------------------------------------------------------------
// Standalone mode

function isMain() {
    if (!process.argv[1]) return false;
    const self = pathToFileURL(path.resolve(process.argv[1])).href;
    return process.platform === "win32" ? self.toLowerCase() === import.meta.url.toLowerCase() : self === import.meta.url;
}

if (isMain()) {
    const portIndex = process.argv.indexOf("--port");
    const port = portIndex === -1 ? 8787 : Number(process.argv[portIndex + 1]);
    const mock = await startMockApi({ port });
    process.stdout.write([
        `Microstock+ Agent API mock: ${mock.baseUrl}`,
        "Fake keys for this run only (not real):",
        ...Object.entries(mock.keys).map(([alias, key]) => `  ${alias.padEnd(9)} ${key}`),
        "",
        `Try: MPLUS_API_BASE=${mock.baseUrl} MPLUS_API_KEY=<a key above> node server/mplus-mcp.mjs`,
        ""
    ].join("\n"));
}

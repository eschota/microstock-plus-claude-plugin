#!/usr/bin/env node
// Microstock+ MCP server: lets AI agents work with a stock contributor's
// Microstock+ portfolio through the Microstock+ Agent API v1.
//
// Zero dependencies: Node.js 18+ built-ins only.
//
// Transports
//   stdio (default)  Newline-delimited JSON-RPC 2.0 on stdin/stdout. The agent key
//                    comes from the MPLUS_API_KEY environment variable.
//   --http <port>    Streamable HTTP at http://127.0.0.1:<port>/mcp with plain JSON
//                    responses. Every request sends its own agent key as
//                    "Authorization: Bearer mpk_live_...".
//
// Protocol: MCP 2026-07-28 requests are served statelessly from their per-request
// _meta (server/discover included); clients of 2025-11-25, 2025-06-18, 2025-03-26
// and 2024-11-05 use the initialize handshake.
//
// Network access: only the Microstock+ Agent API at MPLUS_API_BASE (default
// https://microstock.plus/api/agent/v1), over HTTPS. The server writes no files.
// Diagnostics go to stderr, because stdout carries the protocol. The agent key is
// never logged or returned; only its public 8-character prefix is shown.
//
// Safety: no tool can delete anything and the server never sends DELETE requests;
// queueing uploads needs user_confirmed=true; paid AI keywording needs
// confirm_charge_eur equal to a quote this server obtained; every write carries an
// Idempotency-Key.

import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createInterface } from "node:readline";

// ---------------------------------------------------------------------------
// Identity, protocol and limits

const SERVER_NAME = "microstock-plus";
const SERVER_TITLE = "Microstock+";
const SERVER_VERSION = "1.2.0";
const SERVER_INFO = Object.freeze({
    name: SERVER_NAME,
    title: SERVER_TITLE,
    version: SERVER_VERSION,
    websiteUrl: "https://microstock.plus/ai-agent-skills"
});
const USER_AGENT = `microstock-plus-mcp/${SERVER_VERSION}`;
const DEFAULT_API_BASE = "https://microstock.plus/api/agent/v1";
const KEYS_PAGE_URL = "https://microstock.plus/ai-agent-skills";
const API_KEY_PATTERN = /^mpk_live_([0-9a-f]{8})_[A-Za-z0-9_-]{20,128}$/;
const KEY_ENV_VARS = ["MPLUS_API_KEY", "CLAUDE_PLUGIN_OPTION_API_KEY"];

const MODERN_PROTOCOL_VERSIONS = ["2026-07-28"];
const LEGACY_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SUPPORTED_PROTOCOL_VERSIONS = [...MODERN_PROTOCOL_VERSIONS, ...LEGACY_PROTOCOL_VERSIONS];
const FIRST_STRUCTURED_VERSION = "2025-06-18";
const HTTP_DEFAULT_LEGACY_VERSION = "2025-03-26";
const META = Object.freeze({
    protocolVersion: "io.modelcontextprotocol/protocolVersion",
    clientCapabilities: "io.modelcontextprotocol/clientCapabilities",
    logLevel: "io.modelcontextprotocol/logLevel",
    serverInfo: "io.modelcontextprotocol/serverInfo"
});
const LOG_LEVELS = ["debug", "info", "notice", "warning", "error", "critical", "alert", "emergency"];
const RPC_ERROR = Object.freeze({
    parseError: -32700,
    invalidRequest: -32600,
    methodNotFound: -32601,
    invalidParams: -32602,
    internalError: -32603,
    headerMismatch: -32020,
    unsupportedProtocolVersion: -32022
});

const REQUEST_TIMEOUT_MS = 30_000;
const EVENTS_TIMEOUT_GRACE_MS = 15_000;
const MAX_RETRY_AFTER_MS = 20_000;
const JSON_MAX_BYTES = 20 * 1024 * 1024;
const CSV_MAX_BYTES = 5 * 1024 * 1024;
const INLINE_CSV_MAX_CHARS = 250_000;
const SCOPES_TTL_MS = 5 * 60_000;
const SCOPES_LOOKUP_TIMEOUT_MS = 5_000;
const TOOL_LIST_TTL_MS = 5 * 60_000;
const DISCOVER_TTL_MS = 60 * 60_000;
const QUOTE_CACHE_MAX = 200;
const MAX_LOG_NOTIFICATIONS = 20;
const LOW_RATE_LIMIT_WARNING = 10;
const SHUTDOWN_GRACE_MS = 5_000;
const HTTP_PATH = "/mcp";
const HTTP_BODY_MAX_BYTES = 1024 * 1024;
const HTTP_ACCOUNT_CACHE_MAX = 100;

const LIST_LIMIT_MAX = 200;
const BATCH_MAX_ITEMS = 100;
const EXPORT_MAX_IIDS = 500;
const UPLOAD_MAX_BYTES = 10 * 1024 * 1024 * 1024;
const AI_MAX_IIDS = 1000;
const EVENT_WAIT_MAX_S = 25;
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 2000;
const NOTES_MAX = 2000;
const KEYWORDS_MAX = 50;

const MEDIA_TYPES = ["raster", "vector", "video"];
const FILE_STATUSES = [
    "ready", "ignored", "queued", "uploading", "uploaded", "uploadfailed", "submitted", "submitfailed",
    "approved", "rejected", "approvalfailed", "notready", "scheduled", "cannotbequeued", "nosubmissions"
];
const SETTABLE_STATUSES = ["ready", "queued", "ignored"];
const PROBLEM_STATUSES = new Set([
    "uploadfailed", "submitfailed", "approvalfailed", "rejected", "notready", "cannotbequeued", "nosubmissions"
]);
const MISSING_FIELDS = ["title", "description", "keywords", "categories"];
const CLEARABLE_FIELDS = ["title", "description", "notes", "categories"];
const PATCH_FIELDS = [
    "title", "description", "keywords", "categories", "editorial", "ai_generated", "illustration", "releases", "notes"
];
const CSV_FORMATS = ["default", "with_title", "importable", "with_release_names", "without_categories", "nimia", "alamy"];
const CSV_DELIMITERS = ["comma", "semicolon"];
const AI_MODES = ["skip", "replace"];
const EVENT_TYPES = [
    "file.metadata.updated", "file.status.changed", "file.uploaded", "file.submitted", "file.reviewed",
    "ai.quote.created", "ai.job.started", "ai.job.completed", "ai.job.failed", "export.ready",
    "key.created", "key.revoked"
];
// Display names used only when GET /me has not told us the account's own names.
const AGENCY_NAMES = Object.freeze({
    adobestock: "Adobe Stock",
    shutterstock: "Shutterstock",
    esp: "iStock",
    pond5: "Pond5",
    dreamstime: "Dreamstime",
    "123rf": "123RF",
    alamy: "Alamy",
    depositphotos: "Depositphotos",
    vecteezy: "Vecteezy"
});
const SCOPE_ABILITIES = [
    ["files:read", "read folders and files"],
    ["metadata:write", "change metadata"],
    ["status:write", "set statuses and queue uploads"],
    ["csv:export", "export CSV"],
    ["events:read", "watch events"],
    ["files:upload", "create folders and upload new files"],
    ["ai:quote", "quote AI keywording"],
    ["ai:run", "run paid AI keywording"]
];

// Status changes (queueing uploads), AI keywording and AI jobs belong to the contract, but the Agent API
// release that ships now keeps them switched off: it answers 403 endpoint_disabled and keys cannot hold
// their scopes. Their tools are offered only with MPLUS_ENABLE_PREVIEW_TOOLS=1, for a server that has them on.
// Compatibility test switch only. It is intentionally undocumented; production catalogues never include feature tools.
const PREVIEW_TOOLS = /^(1|true|yes)$/i.test(process.env.MPLUS_ENABLE_PREVIEW_TOOLS || "");
const PREVIEW_SCOPES = new Set(["ai:quote", "ai:run"]);
const NOT_AVAILABLE = Object.freeze({
    status_changes: "Not available yet (not_available_yet): changing statuses and sending files to stock agencies " +
        "(upload and submit) is not available through the Microstock+ Agent API yet. Don't offer or promise it; the user " +
        "changes statuses and sends files in the Microstock+ web interface (My Files).",
    ai_keywording: "Not available yet (not_available_yet): Microstock+ AI keywording (price quotes, paid runs and job " +
        "progress) is not available through the Microstock+ Agent API yet. Don't offer or promise it; the user can start " +
        "AI keywording in the Microstock+ web interface (My Files). You can still write titles, descriptions and keywords " +
        "yourself and save them with mplus_update_metadata_batch, dry run first."
});

const INSTRUCTIONS = [
    "Microstock+ (microstock.plus) keeps a stock contributor's photos, vectors and videos with their titles, descriptions",
    "and keywords, and submits them to stock agencies. These tools act only on the account that owns the configured agent key.",
    "Agency ids come from mplus_get_account (for example adobestock = Adobe Stock, esp = iStock, shutterstock, pond5).",
    "Workflow: find files with mplus_list_folders and mplus_list_files, read them with mplus_get_file, and change metadata",
    "with mplus_update_metadata or mplus_update_metadata_batch. Run every batch with dry_run=true first, show the user what",
    "will change, then repeat it with dry_run=false. Pass if_match_metaver so a newer edit is never overwritten; after a",
    "metadata_conflict, re-read the file and merge.",
    "Use mplus_initialize_upload to obtain a short-lived upload ticket, then transfer the user's local binary directly to its upload_url. " +
        "Never ask Microstock+ to download an arbitrary remote URL. With status:write, mplus_set_status changes ready/ignored/queued; queued requires explicit user confirmation. Paid Microstock+ AI actions are outside this release.",
    "Nothing can be deleted with these tools. If the user asks to delete files, folders or anything else, say that deleting",
    "is done by hand in the Microstock+ web interface (My Files), and never claim that something was deleted.",
    "Use mplus_wait_for_events to follow metadata, upload and export events."
].join(" ");

const KEY_SETUP_HINT = [
    `Create an agent key at ${KEYS_PAGE_URL} (section "Agent keys"; the key is shown once).`,
    "In Claude Code run /plugin configure microstock-plus@microstock-plus and paste it;",
    "for other MCP clients set MPLUS_API_KEY in this server's environment. Then restart the session."
].join(" ");

const STRICT_OUTPUT = /^(1|true|yes)$/i.test(process.env.MPLUS_MCP_STRICT_OUTPUT || "");
const DEBUG = /^(1|true|yes)$/i.test(process.env.MPLUS_MCP_DEBUG || "");

// ---------------------------------------------------------------------------
// Small helpers

class ToolInputError extends Error {}
class ConfigError extends Error {}
class RefusedError extends Error {}

class RpcError extends Error {
    constructor(code, message, data, httpStatus) {
        super(message);
        this.code = code;
        this.data = data;
        this.httpStatus = httpStatus;
    }
}

class ApiError extends Error {
    constructor({ status, type, code, message, param, requestId, retryAfterSeconds }) {
        super(message);
        this.status = status;
        this.type = type;
        this.code = code;
        this.param = param;
        this.requestId = requestId;
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

function log(...parts) {
    process.stderr.write(`[${SERVER_NAME}] ${parts.join(" ")}\n`);
}

function debug(...parts) {
    if (DEBUG) log(...parts);
}

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
}

function oneLine(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
}

function truncate(value, max) {
    const text = oneLine(value);
    return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function plural(count, singular, pluralForm = `${singular}s`) {
    return `${count} ${count === 1 ? singular : pluralForm}`;
}

function formatEur(amount) {
    const number = Number(amount);
    return Number.isFinite(number) ? `€${number.toFixed(2)}` : "€?";
}

function toCents(amount) {
    return Math.round(Number(amount) * 100);
}

function textOf(value) {
    return typeof value === "string" ? value.trim() : "";
}

function arrayOf(value) {
    return Array.isArray(value) ? value : [];
}

function countBy(items, keyOf) {
    const counts = new Map();
    for (const item of items) {
        const key = keyOf(item);
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts].map(([key, count]) => `${count} ${key}`).join(", ");
}

function isLoopbackHost(hostname) {
    const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
    return host === "localhost" || host.endsWith(".localhost") || host === "::1" || /^127\.\d+\.\d+\.\d+$/.test(host);
}

function keyPrefix(apiKey) {
    const match = API_KEY_PATTERN.exec(apiKey || "");
    return match ? match[1] : "????????";
}

function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason);
            return;
        }
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal.reason);
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

// An AbortSignal that fires when the parent fires or when the timeout elapses.
function linkedSignal(parent, timeoutMs) {
    const controller = new AbortController();
    const state = { signal: controller.signal, timedOut: false, dispose };
    const timer = setTimeout(() => {
        state.timedOut = true;
        controller.abort(new Error(`timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    const onAbort = () => controller.abort(parent.reason);
    if (parent) {
        if (parent.aborted) controller.abort(parent.reason);
        else parent.addEventListener("abort", onAbort, { once: true });
    }
    function dispose() {
        clearTimeout(timer);
        parent?.removeEventListener("abort", onAbort);
    }
    return state;
}

function parseJson(text) {
    try {
        return text ? JSON.parse(text) : undefined;
    } catch {
        return undefined;
    }
}

// ---------------------------------------------------------------------------
// Configuration

function readApiBase(raw) {
    const text = textOf(raw) || DEFAULT_API_BASE;
    let url;
    try {
        url = new URL(text);
    } catch {
        return { problem: `MPLUS_API_BASE is not a valid URL: ${text}` };
    }
    const secure = url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHost(url.hostname));
    if (!secure) return { problem: "MPLUS_API_BASE must use https:// (plain http:// is allowed only for localhost testing)." };
    if (url.username || url.password || url.search || url.hash) {
        return { problem: "MPLUS_API_BASE must not contain credentials, a query string or a fragment." };
    }
    return { value: url.href.replace(/\/+$/, "") };
}

function readApiKey(env) {
    for (const name of KEY_ENV_VARS) {
        const raw = textOf(env[name]);
        // Empty, or a plugin placeholder such as ${user_config.api_key} that was not filled in.
        if (!raw || raw.startsWith("${")) continue;
        if (!API_KEY_PATTERN.test(raw)) {
            return { problem: `${name} is set but is not a Microstock+ agent key (expected mpk_live_<8 hex characters>_<secret>).` };
        }
        return { value: raw };
    }
    return {};
}

function readConfig(env) {
    const base = readApiBase(env.MPLUS_API_BASE);
    const key = readApiKey(env);
    return { apiBase: base.value, apiBaseProblem: base.problem, apiKey: key.value, apiKeyProblem: key.problem };
}

// ---------------------------------------------------------------------------
// Agent API client

// The Agent API has no delete operations, and this client cannot send one.
const ALLOWED_HTTP_METHODS = new Set(["GET", "POST", "PATCH"]);

const DEFAULT_ERROR_TYPES = {
    400: "invalid_request_error",
    401: "authentication_error",
    403: "permission_error",
    404: "not_found_error",
    405: "permission_error",
    409: "conflict_error",
    429: "rate_limit_error"
};

const ERROR_ADVICE = {
    invalid_api_key: `The agent key was not accepted. ${KEY_SETUP_HINT}`,
    revoked_api_key: `This agent key was revoked. ${KEY_SETUP_HINT}`,
    scope_required: `The agent key lacks the permission (scope) for this action. The key owner can create a key with that scope at ${KEYS_PAGE_URL}; paid AI keywording needs ai:run, which is off by default.`,
    agent_api_disabled: `The Agent API is disabled for this account; the account owner can enable it at ${KEYS_PAGE_URL}.`,
    endpoint_disabled: "This part of the Agent API is not available yet. Don't offer or promise it; the user does it in the Microstock+ web interface (My Files).",
    not_found: `Microstock+ answered that this API path does not exist. The Agent API is probably not switched on for this account yet (agent keys open gradually); see ${KEYS_PAGE_URL}.`,
    not_owner: "That item does not belong to the key owner's account; agents can only work with the key owner's own files.",
    file_not_found: "Check the iid; find files with mplus_list_files.",
    folder_not_found: "Check the folder path; list folders with mplus_list_folders.",
    job_not_found: "Check the job id returned by mplus_run_ai_keywording.",
    deletion_not_supported: "Nothing can be deleted through the Agent API. The user deletes files by hand in the Microstock+ web interface (My Files).",
    metadata_conflict: "The file changed since the metaver you sent. Re-read it with mplus_get_file, merge your change into the current metadata, and retry with the new metaver.",
    quote_expired: "The quote expired. Create a new one with mplus_quote_ai_keywording and confirm the new price with the user before running it.",
    idempotency_mismatch: "An earlier request reused this Idempotency-Key with a different body. Repeat the call; this server sends a fresh key for every call.",
    batch_too_large: `Send at most ${BATCH_MAX_ITEMS} items per call.`,
    rate_limited: "The key's rate limit is reached (120 requests and 30 changes per minute). Wait, then try again.",
    api_not_configured: "The Microstock+ Agent API is temporarily unavailable. Try again later.",
    upstream_unavailable: "Microstock+ is temporarily unavailable. Try again in a minute.",
    network_error: "Check the internet connection, and that a proxy or firewall allows HTTPS to microstock.plus.",
    timeout: "Try again. If it keeps happening, Microstock+ may be busy."
};

function retryAfterMs(value) {
    const text = textOf(value);
    if (!text) return null;
    const seconds = Number(text);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(text);
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function describeCause(error) {
    const cause = error?.cause;
    return oneLine(cause?.code || cause?.message || error?.message || error);
}

async function readBody(response, maxBytes) {
    if (!response.body) return "";
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
            await reader.cancel().catch(() => {});
            throw new ApiError({
                status: response.status,
                type: "api_error",
                code: "response_too_large",
                message: `The response is larger than ${Math.round(maxBytes / 1024)} KB.`
            });
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
}

function apiErrorFrom(response) {
    const envelope = parseJson(response.text);
    const error = isPlainObject(envelope?.error) ? envelope.error : {};
    const retryAfter = retryAfterMs(response.headers.get("retry-after"));
    return new ApiError({
        status: response.status,
        type: textOf(error.type) || DEFAULT_ERROR_TYPES[response.status] || "api_error",
        code: textOf(error.code) || `http_${response.status}`,
        message: textOf(error.message) || `The Agent API answered HTTP ${response.status}.`,
        param: textOf(error.param) || undefined,
        requestId: textOf(error.request_id) || response.requestId,
        retryAfterSeconds: retryAfter === null ? undefined : Math.ceil(retryAfter / 1000)
    });
}

function describeApiError(error) {
    const where = error.status ? `HTTP ${error.status}` : "no response";
    const parts = [`Microstock+ API error (${where}, ${error.code}): ${error.message}`];
    if (error.param) parts.push(`Parameter: ${error.param}.`);
    if (error.retryAfterSeconds) parts.push(`Retry after ${error.retryAfterSeconds} s.`);
    const advice = ERROR_ADVICE[error.code] || (error.status >= 500 ? ERROR_ADVICE.upstream_unavailable : "");
    if (advice) parts.push(advice);
    if (error.requestId) parts.push(`Request id: ${error.requestId}.`);
    return parts.join(" ");
}

class AgentApi {
    constructor({ apiKey, apiBase }) {
        this.apiKey = apiKey;
        this.apiBase = apiBase;
        this.origin = new URL(apiBase).origin;
        this.rateLimit = null;
    }

    // JSON request to an Agent API path such as "/files". Returns { data, requestId, replayed }.
    async request(method, path, { query, body, idempotencyKey, signal, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
        const url = new URL(`${this.apiBase}${path}`);
        for (const [name, value] of Object.entries(query || {})) {
            if (value !== undefined && value !== null && value !== "") url.searchParams.set(name, String(value));
        }
        const response = await this.send(method, url, {
            body, idempotencyKey, signal, timeoutMs, accept: "application/json", maxBytes: JSON_MAX_BYTES
        });
        const data = parseJson(response.text);
        if (!isPlainObject(data)) {
            throw new ApiError({
                status: response.status,
                type: "api_error",
                code: "invalid_response",
                message: "The Agent API answered with something that is not a JSON object.",
                requestId: response.requestId
            });
        }
        return { data, requestId: response.requestId, replayed: response.replayed };
    }

    // Plain-text download from a URL the API returned, such as an export's download_url.
    async downloadText(rawUrl, { accept, maxBytes, signal }) {
        let url;
        try {
            url = new URL(rawUrl);
        } catch {
            throw new RefusedError(`The Agent API returned an invalid download URL: ${truncate(rawUrl, 200)}`);
        }
        if (url.origin !== this.origin) {
            throw new RefusedError(`Not downloading ${url.origin}: the agent key is only ever sent to ${this.origin}.`);
        }
        const response = await this.send("GET", url, { accept, maxBytes, signal, timeoutMs: REQUEST_TIMEOUT_MS });
        return response.text;
    }

    async send(method, url, options) {
        if (!ALLOWED_HTTP_METHODS.has(method)) throw new Error(`HTTP ${method} is never sent by this server.`);
        const headers = this.headers(options);
        for (let attempt = 1; ; attempt += 1) {
            const response = await this.attempt(method, url, headers, options);
            this.rememberRateLimit(response.headers);
            debug(`${method} ${url.pathname} -> ${response.status}${response.requestId ? ` (${response.requestId})` : ""}`);
            if (response.status === 429 && attempt === 1) {
                const waitMs = retryAfterMs(response.headers.get("retry-after"));
                if (waitMs !== null && waitMs <= MAX_RETRY_AFTER_MS) {
                    log(`rate limited on ${method} ${url.pathname}; retrying once in ${Math.ceil(waitMs / 1000)} s`);
                    await sleep(waitMs, options.signal);
                    continue;
                }
            }
            if (response.status >= 200 && response.status < 300) return response;
            throw apiErrorFrom(response);
        }
    }

    headers({ body, idempotencyKey, accept }) {
        const headers = { Accept: accept, Authorization: `Bearer ${this.apiKey}`, "User-Agent": USER_AGENT };
        if (body !== undefined) headers["Content-Type"] = "application/json";
        if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
        return headers;
    }

    async attempt(method, url, headers, { body, signal, timeoutMs, maxBytes }) {
        const timeout = linkedSignal(signal, timeoutMs);
        try {
            const response = await fetch(url, {
                method,
                headers,
                body: body === undefined ? undefined : JSON.stringify(body),
                redirect: "error",
                signal: timeout.signal
            });
            const text = await readBody(response, maxBytes);
            return {
                status: response.status,
                headers: response.headers,
                text,
                requestId: response.headers.get("x-request-id") || undefined,
                replayed: response.headers.get("idempotent-replayed") === "true"
            };
        } catch (error) {
            if (signal?.aborted || error instanceof ApiError) throw error;
            if (timeout.timedOut) {
                throw new ApiError({
                    status: 0,
                    type: "api_error",
                    code: "timeout",
                    message: `Microstock+ did not answer within ${Math.round(timeoutMs / 1000)} s.`
                });
            }
            throw new ApiError({
                status: 0,
                type: "api_error",
                code: "network_error",
                message: `Could not reach Microstock+ at ${this.origin} (${describeCause(error)}).`
            });
        } finally {
            timeout.dispose();
        }
    }

    rememberRateLimit(headers) {
        const remaining = Number(headers.get("x-ratelimit-remaining-requests"));
        if (!Number.isFinite(remaining)) return;
        this.rateLimit = {
            remaining,
            limit: Number(headers.get("x-ratelimit-limit-requests")) || undefined,
            resetSeconds: Number(headers.get("x-ratelimit-reset-requests")) || undefined
        };
    }
}

// ---------------------------------------------------------------------------
// Per-key state: the API client, the key's scopes and the AI quotes it obtained

class AccountContext {
    constructor(config) {
        this.config = config;
        this.api = config.apiKey && config.apiBase ? new AgentApi(config) : null;
        this.scopes = null;
        this.scopesFetchedAt = 0;
        this.scopesInFlight = null;
        this.agencyNames = new Map();
        this.quotes = new Map();
        this.listedToolNames = null;
        this.onToolListChanged = null;
    }

    requireApi() {
        if (this.config.apiBaseProblem) throw new ConfigError(this.config.apiBaseProblem);
        if (this.config.apiKeyProblem) throw new ConfigError(`${this.config.apiKeyProblem} ${KEY_SETUP_HINT}`);
        if (!this.api) throw new ConfigError(`No Microstock+ agent key is configured. ${KEY_SETUP_HINT}`);
        return this.api;
    }

    freshScopes() {
        return this.scopes && Date.now() - this.scopesFetchedAt < SCOPES_TTL_MS ? this.scopes : null;
    }

    // The key's scopes for filtering tools/list, or null when unknown (then every tool is listed).
    async scopesForListing() {
        if (!this.api) return null;
        const fresh = this.freshScopes();
        if (fresh) return fresh;
        if (!this.scopesInFlight) {
            this.scopesInFlight = this.fetchScopes().finally(() => {
                this.scopesInFlight = null;
            });
        }
        return this.scopesInFlight;
    }

    async fetchScopes() {
        try {
            const { data } = await this.api.request("GET", "/me", { timeoutMs: SCOPES_LOOKUP_TIMEOUT_MS });
            this.rememberAccount(data);
        } catch (error) {
            debug(`scope lookup failed: ${error?.code || error?.message || error}`);
        }
        return this.freshScopes();
    }

    rememberAccount(account) {
        const scopes = account?.key?.scopes;
        if (Array.isArray(scopes)) {
            this.scopes = scopes.filter(scope => typeof scope === "string");
            this.scopesFetchedAt = Date.now();
        }
        for (const agency of arrayOf(account?.agencies)) {
            if (typeof agency?.id === "string" && typeof agency?.name === "string") this.agencyNames.set(agency.id, agency.name);
        }
        this.checkToolListChange();
    }

    checkToolListChange() {
        if (this.listedToolNames === null || !this.onToolListChanged) return;
        const names = visibleTools(this.freshScopes()).map(tool => tool.name).join(",");
        if (names === this.listedToolNames) return;
        this.listedToolNames = names;
        this.onToolListChanged();
    }

    lacksScope(scope) {
        const scopes = this.freshScopes();
        return Boolean(scopes) && !scopes.includes(scope);
    }

    agencyName(id) {
        return this.agencyNames.get(id) || AGENCY_NAMES[id] || id;
    }

    agencyLabel(id) {
        const name = this.agencyName(id);
        return name === id ? id : `${name} (${id})`;
    }

    // Remembers what a quote costs so a paid run can be checked against the user's confirmation.
    // Expiry is left to the API, which answers 409 quote_expired.
    rememberQuote(quote) {
        const files = Number(quote.files);
        this.quotes.set(quote.quote_id, {
            amountEur: Number(quote.amount_eur),
            files: Number.isInteger(files) && files >= 0 ? files : null
        });
        while (this.quotes.size > QUOTE_CACHE_MAX) this.quotes.delete(this.quotes.keys().next().value);
    }
}

// ---------------------------------------------------------------------------
// Input validation: the JSON Schema subset used by this server's tool schemas

const patternCache = new Map();

function compiledPattern(pattern) {
    let regex = patternCache.get(pattern);
    if (!regex) {
        regex = new RegExp(pattern, "u");
        patternCache.set(pattern, regex);
    }
    return regex;
}

function matchesType(type, value) {
    switch (type) {
        case "string": return typeof value === "string";
        case "integer": return Number.isInteger(value);
        case "number": return typeof value === "number" && Number.isFinite(value);
        case "boolean": return typeof value === "boolean";
        case "object": return isPlainObject(value);
        case "array": return Array.isArray(value);
        case "null": return value === null;
        default: return true;
    }
}

const TYPE_NAMES = {
    string: "a string",
    integer: "a whole number",
    number: "a number",
    boolean: "true or false",
    object: "an object",
    array: "a list",
    null: "null"
};

// Returns a readable description of the first problem, or null when the value matches.
function validateAgainstSchema(schema, value, path = "") {
    const label = path || "arguments";
    if (schema.type !== undefined) {
        const types = Array.isArray(schema.type) ? schema.type : [schema.type];
        if (!types.some(type => matchesType(type, value))) {
            return `${label} must be ${types.map(type => TYPE_NAMES[type] || type).join(" or ")}.`;
        }
    }
    if (schema.const !== undefined && value !== schema.const) return `${label} must be ${JSON.stringify(schema.const)}.`;
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return `${label} must be one of: ${schema.enum.join(", ")}.`;
    if (typeof value === "string") return checkString(schema, value, label);
    if (typeof value === "number") return checkNumber(schema, value, label);
    if (Array.isArray(value)) return checkArray(schema, value, label);
    if (isPlainObject(value)) return checkObject(schema, value, path, label);
    return null;
}

function checkString(schema, value, label) {
    const length = [...value].length;
    if (schema.minLength !== undefined && length < schema.minLength) {
        return schema.minLength === 1 ? `${label} must not be empty.` : `${label} must be at least ${schema.minLength} characters.`;
    }
    if (schema.maxLength !== undefined && length > schema.maxLength) return `${label} must be at most ${schema.maxLength} characters.`;
    if (schema.pattern !== undefined && !compiledPattern(schema.pattern).test(value)) {
        return `${label} has an invalid format${schema.description ? ` (${schema.description})` : ""}.`;
    }
    return null;
}

function checkNumber(schema, value, label) {
    if (schema.minimum !== undefined && value < schema.minimum) return `${label} must be at least ${schema.minimum}.`;
    if (schema.maximum !== undefined && value > schema.maximum) return `${label} must be at most ${schema.maximum}.`;
    return null;
}

function checkArray(schema, value, label) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return `${label} must have at least ${plural(schema.minItems, "item")}.`;
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return `${label} must have at most ${plural(schema.maxItems, "item")}.`;
    if (schema.uniqueItems) {
        const seen = new Set();
        for (const item of value) {
            const key = JSON.stringify(item);
            if (seen.has(key)) return `${label} contains ${truncate(key, 80)} more than once.`;
            seen.add(key);
        }
    }
    if (schema.items) {
        for (let index = 0; index < value.length; index += 1) {
            const problem = validateAgainstSchema(schema.items, value[index], `${label}[${index}]`);
            if (problem) return problem;
        }
    }
    return null;
}

function checkObject(schema, value, path, label) {
    const properties = schema.properties || {};
    for (const name of schema.required || []) {
        if (!hasOwn(value, name)) return `${path ? `${path}.` : ""}${name} is required.`;
    }
    for (const [name, item] of Object.entries(value)) {
        const childPath = path ? `${path}.${name}` : name;
        if (hasOwn(properties, name)) {
            const problem = validateAgainstSchema(properties[name], item, childPath);
            if (problem) return problem;
        } else if (schema.additionalProperties === false) {
            const known = Object.keys(properties);
            return `${label} has an unknown field "${name}"${known.length ? `; allowed: ${known.join(", ")}` : ""}.`;
        } else if (isPlainObject(schema.additionalProperties)) {
            const problem = validateAgainstSchema(schema.additionalProperties, item, childPath);
            if (problem) return problem;
        }
    }
    if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) {
        return `${label} must contain at least ${plural(schema.minProperties, "field")}.`;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Schemas shared by the tool definitions

const IID_SCHEMA = {
    type: "string",
    pattern: "^[A-Za-z0-9_-]{1,64}$",
    description: "File id (iid) from mplus_list_files, for example 6abc74e948864d403ea0c559."
};
const AGENCY_ID_SCHEMA = {
    type: "string",
    pattern: "^[a-z0-9][a-z0-9_-]{1,31}$",
    description: "Agency id from mplus_get_account, for example adobestock (Adobe Stock), shutterstock, esp (iStock) or pond5."
};
const FOLDER_PATH_SCHEMA = {
    type: "string",
    minLength: 1,
    maxLength: 1024,
    pattern: "^/",
    description: "Folder path starting with /, for example /foto/2026."
};
const CURSOR_SCHEMA = {
    type: "string",
    minLength: 1,
    maxLength: 1024,
    description: "next_cursor from the previous result of the same call."
};
const KEYWORD_SCHEMA = {
    type: "string",
    minLength: 1,
    maxLength: 100,
    pattern: "^[^,;\\r\\n]+$",
    description: "One keyword or short phrase, without commas or semicolons"
};

function iidList(max, description) {
    return { type: "array", items: IID_SCHEMA, minItems: 1, maxItems: max, uniqueItems: true, description };
}

function listLimit(fallback) {
    return {
        type: "integer",
        minimum: 1,
        maximum: LIST_LIMIT_MAX,
        description: `Items per page, 1-${LIST_LIMIT_MAX}. Default ${fallback}.`
    };
}

function keywordList(description, minItems = 1) {
    return { type: "array", items: KEYWORD_SCHEMA, minItems, maxItems: KEYWORDS_MAX, uniqueItems: true, description };
}

const KEYWORDS_PATCH_SCHEMA = {
    type: "object",
    description: "Keyword change: either set (the complete new list) or add and/or remove.",
    properties: {
        set: keywordList("Replace all keywords with this list, most important first. An empty list removes every keyword.", 0),
        add: keywordList("Keywords to add after the existing ones."),
        remove: keywordList("Keywords to remove.")
    },
    additionalProperties: false,
    minProperties: 1
};

const RELEASE_LIST_SCHEMA = {
    type: "array",
    items: { type: "string", pattern: "^[A-Za-z0-9_-]{1,64}$", description: "Release id such as rel_123" },
    minItems: 1,
    maxItems: 50,
    uniqueItems: true
};

const RELEASES_PATCH_SCHEMA = {
    type: "object",
    description: "Model/property release change by release id: set, or add and/or remove. The API cannot list releases; use ids already attached to the user's files.",
    properties: {
        set: { ...RELEASE_LIST_SCHEMA, minItems: 0, description: "Replace all releases. An empty list detaches every release." },
        add: { ...RELEASE_LIST_SCHEMA, description: "Release ids to attach." },
        remove: { ...RELEASE_LIST_SCHEMA, description: "Release ids to detach." }
    },
    additionalProperties: false,
    minProperties: 1
};

const CATEGORY_SCHEMA = {
    type: "object",
    properties: {
        cat: { type: "integer", minimum: 0, description: "Category id." },
        sub: { type: "integer", minimum: 0, description: "Subcategory id." }
    },
    required: ["cat"],
    additionalProperties: false
};

const PATCH_PROPERTIES = {
    title: {
        type: "string",
        minLength: 1,
        maxLength: TITLE_MAX,
        description: `New title, at most ${TITLE_MAX} characters: a plain, specific sentence about what is shown.`
    },
    description: {
        type: "string",
        minLength: 1,
        maxLength: DESCRIPTION_MAX,
        description: "New description. Some agencies (Shutterstock, Adobe Stock) allow 200 characters; longer text is reported as validation, not cut."
    },
    keywords: KEYWORDS_PATCH_SCHEMA,
    categories: {
        type: "array",
        items: CATEGORY_SCHEMA,
        minItems: 1,
        maxItems: 3,
        description: "At most 3 categories as {cat, sub} ids from the Microstock+ category table (omit sub for none): " +
            "1 Abstract, 2 Animals/Wildlife, 3 Backgrounds/Textures, 4 Beauty/Fashion, 5 Buildings/Landmarks, 6 Business/Finance, " +
            "7 Celebrities, 8 Education, 9 Food and Drink, 10 Healthcare/Medical, 11 Holidays, 12 Illustrations/Clip-Art, " +
            "13 Industrial, 14 Interiors, 15 Miscellaneous, 16 Nature, 17 Objects, 18 Parks/Outdoor, 19 People, 20 Religion, " +
            "21 Science, 22 Signs/Symbols, 23 Sports/Recreation, 24 Technology, 25 The Arts, 26 Transportation, 27 Vintage. " +
            "The subcategory ids are in the AI Agent Skills guide (https://microstock.plus/ai-agent-skills/skill.md)."
    },
    editorial: { type: "boolean", description: "Editorial use only." },
    ai_generated: { type: "boolean", description: "Made with generative AI. true also sets editorial to false." },
    illustration: { type: "boolean", description: "An illustration (drawn or rendered artwork) rather than a photo." },
    releases: RELEASES_PATCH_SCHEMA,
    notes: { type: "string", minLength: 1, maxLength: NOTES_MAX, description: "Free-text notes on the file." },
    clear: {
        type: "array",
        items: { type: "string", enum: CLEARABLE_FIELDS },
        minItems: 1,
        uniqueItems: true,
        description: "Fields to empty: title, description, notes, categories. (Empty strings are rejected; use this instead.)"
    }
};

const PATCH_SCHEMA = {
    type: "object",
    description: "Metadata change; only the fields you pass change.",
    properties: PATCH_PROPERTIES,
    additionalProperties: false,
    minProperties: 1
};

const IF_MATCH_METAVER_SCHEMA = {
    type: "integer",
    minimum: 0,
    description: "The file's metaver when you read it. The change fails with metadata_conflict if the file changed since."
};

// Output schemas. They describe the Agent API objects (contract section 4) plus the
// summary string this server adds to every result.

const T = Object.freeze({
    string: { type: "string" },
    nullableString: { type: ["string", "null"] },
    integer: { type: "integer" },
    nullableInteger: { type: ["integer", "null"] },
    nullableNumber: { type: ["number", "null"] },
    boolean: { type: "boolean" }
});

const SUMMARY_SCHEMA = { type: "string", description: "What happened and what to do next." };
const API_ERROR_OUTPUT = {
    type: "object",
    properties: { type: T.string, code: T.string, message: T.string, param: T.nullableString }
};
const VALIDATION_OUTPUT = { type: "object", properties: { code: T.string, message: T.string } };
const AGENCY_STATE_OUTPUT = {
    type: "object",
    properties: {
        status: T.string,
        external_id: T.nullableString,
        uploaded_at: T.nullableString,
        submitted_at: T.nullableString,
        errors: { type: "array" },
        validation: { type: "array", items: VALIDATION_OUTPUT }
    }
};
const METADATA_OUTPUT = {
    type: "object",
    properties: {
        title: T.nullableString,
        description: T.nullableString,
        keywords: { type: "array", items: T.string },
        categories: { type: "array", items: { type: "object", properties: { cat: T.integer, sub: T.nullableInteger } } },
        editorial: T.boolean,
        ai_generated: T.boolean,
        illustration: T.boolean,
        releases: { type: "array", items: T.string },
        notes: T.nullableString
    }
};
const FILE_OUTPUT = {
    type: "object",
    properties: {
        object: T.string,
        iid: T.string,
        type: T.string,
        folder: T.string,
        filename: T.string,
        size_bytes: T.nullableInteger,
        created_at: T.nullableString,
        archived: T.boolean,
        preview_url: T.nullableString,
        thumbnail_url: T.nullableString,
        metaver: T.integer,
        metadata: METADATA_OUTPUT,
        agencies: { type: "object", additionalProperties: AGENCY_STATE_OUTPUT },
        has_ai_metadata: T.boolean
    },
    required: ["iid", "metaver"]
};
const FOLDER_OUTPUT = {
    type: "object",
    properties: {
        object: T.string,
        path: T.string,
        file_count: T.integer,
        subfolder_count: T.integer,
        archived: T.boolean,
        status_summary: { type: "object", additionalProperties: { type: "object", additionalProperties: T.integer } }
    },
    required: ["path"]
};
const EVENT_OUTPUT = {
    type: "object",
    properties: {
        object: T.string,
        id: T.string,
        type: T.string,
        created_at: T.string,
        actor: { type: "object", properties: { kind: T.string, key_prefix: T.nullableString, key_name: T.nullableString } },
        data: { type: "object" }
    },
    required: ["id", "type"]
};
const ACCOUNT_OUTPUT = {
    type: "object",
    properties: {
        object: T.string,
        id: T.string,
        name: T.nullableString,
        plan: { type: "object", properties: { id: T.string, name: T.string, expires_at: T.nullableString } },
        balance_eur: T.nullableNumber,
        agencies: { type: "array", items: { type: "object", properties: { id: T.string, name: T.string } } },
        settings: { type: "object", properties: { lowercase_keywords: T.boolean, max_keywords: T.integer } },
        limits: { type: "object", additionalProperties: T.integer },
        key: {
            type: "object",
            properties: {
                prefix: T.string,
                name: T.string,
                scopes: { type: "array", items: T.string },
                created_at: T.nullableString,
                last_used_at: T.nullableString
            }
        }
    }
};
const METADATA_BATCH_OUTPUT = {
    type: "object",
    properties: {
        object: T.string,
        results: {
            type: "array",
            items: {
                type: "object",
                properties: { iid: T.string, ok: T.boolean, file: FILE_OUTPUT, error: API_ERROR_OUTPUT },
                required: ["iid", "ok"]
            }
        },
        succeeded: T.integer,
        failed: T.integer
    },
    required: ["results"]
};
const STATUS_BATCH_OUTPUT = {
    type: "object",
    properties: {
        object: T.string,
        results: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    iid: T.string,
                    agency: T.string,
                    ok: T.boolean,
                    status: T.string,
                    previous_status: T.nullableString,
                    error: API_ERROR_OUTPUT
                },
                required: ["iid", "ok"]
            }
        },
        succeeded: T.integer,
        failed: T.integer
    },
    required: ["results"]
};
const EXPORT_OUTPUT = {
    type: "object",
    properties: {
        object: T.string,
        id: T.string,
        format: T.string,
        delimiter: T.string,
        rows: T.integer,
        download_url: T.string,
        expires_at: T.string,
        csv: { type: "string", description: "The CSV text, when include_csv was true and it fit." },
        csv_omitted_reason: { type: "string", description: "Why the CSV text is not included although include_csv was true." }
    },
    required: ["download_url"]
};
const UPLOAD_OUTPUT = {
    type: "object",
    properties: {
        object: T.string,
        file_id: T.string,
        filename: T.string,
        directory: T.string,
        size_bytes: T.integer,
        content_type: T.string,
        expires_at: T.nullableString,
        upload: {
            type: "object",
            properties: {
                strategy: T.string,
                chunk_size_bytes: T.integer,
                chunk_count: T.integer,
                uploaded_chunks: { type: "array", items: T.integer },
                chunk: {
                    type: "object",
                    properties: {
                        url: T.string,
                        method: T.string,
                        form_fields: { type: "object", additionalProperties: T.string },
                        file_field: T.string
                    },
                    required: ["url", "method", "file_field"]
                },
                finish: {
                    type: "object",
                    properties: { url: T.string, method: T.string, form_fields: { type: "object", additionalProperties: T.string } },
                    required: ["url", "method", "form_fields"]
                }
            },
            required: ["chunk", "finish"]
        }
    },
    required: ["object", "file_id", "upload", "expires_at"]
};
const QUOTE_OUTPUT = {
    type: "object",
    properties: {
        object: T.string,
        quote_id: T.string,
        files: T.integer,
        amount_eur: { type: "number" },
        expires_at: T.string,
        mode: T.string
    },
    required: ["quote_id", "amount_eur"]
};
const JOB_OUTPUT = {
    type: "object",
    properties: {
        object: T.string,
        id: T.string,
        type: T.string,
        status: T.string,
        quote_id: T.nullableString,
        files_total: T.integer,
        files_done: T.integer,
        files_failed: T.integer,
        amount_eur_quoted: T.nullableNumber,
        amount_eur_charged: T.nullableNumber,
        created_at: T.nullableString,
        started_at: T.nullableString,
        finished_at: T.nullableString,
        error: { type: ["object", "null"] }
    },
    required: ["id", "status"]
};

function withSummary(schema) {
    return {
        ...schema,
        properties: { summary: SUMMARY_SCHEMA, ...schema.properties },
        required: ["summary", ...(schema.required || [])]
    };
}

function listOutput(itemSchema) {
    return {
        type: "object",
        properties: {
            summary: SUMMARY_SCHEMA,
            object: T.string,
            data: { type: "array", items: itemSchema },
            has_more: T.boolean,
            next_cursor: T.nullableString
        },
        required: ["summary", "data"]
    };
}

function readAnnotations(title, { idempotent = true } = {}) {
    return { title, readOnlyHint: true, destructiveHint: false, idempotentHint: idempotent, openWorldHint: false };
}

function writeAnnotations(title, { openWorld = false } = {}) {
    return { title, readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: openWorld };
}

// ---------------------------------------------------------------------------
// Text rendering for the human-readable content block

function keywordsOf(file) {
    return arrayOf(file?.metadata?.keywords).filter(keyword => typeof keyword === "string");
}

function agencyEntries(file) {
    return Object.entries(isPlainObject(file?.agencies) ? file.agencies : {});
}

function describeAgencyError(error) {
    if (typeof error === "string") return error;
    if (isPlainObject(error)) return oneLine(error.message || error.code || JSON.stringify(error));
    return oneLine(String(error));
}

function describeStatusesShort(file) {
    return agencyEntries(file).map(([id, state]) => {
        const notes = [];
        const issues = arrayOf(state?.validation).length;
        const errors = arrayOf(state?.errors).length;
        if (issues) notes.push(plural(issues, "warning"));
        if (errors) notes.push(plural(errors, "error"));
        return `${id}: ${state?.status || "?"}${notes.length ? ` (${notes.join(", ")})` : ""}`;
    }).join(", ");
}

function describeStatusesLong(file, account) {
    const lines = agencyEntries(file).map(([id, state]) => {
        const parts = [`${account.agencyLabel(id)}: ${state?.status || "?"}`];
        if (state?.external_id) parts.push(`external id ${state.external_id}`);
        if (state?.submitted_at) parts.push(`submitted ${state.submitted_at}`);
        else if (state?.uploaded_at) parts.push(`uploaded ${state.uploaded_at}`);
        for (const issue of arrayOf(state?.validation)) parts.push(`validation ${issue?.code}: ${oneLine(issue?.message)}`);
        for (const error of arrayOf(state?.errors)) parts.push(`error: ${describeAgencyError(error)}`);
        return `- ${parts.join(" · ")}`;
    });
    return lines.length ? lines.join("\n") : "- not set up for any agency";
}

function validationCodes(file) {
    const codes = [];
    for (const [id, state] of agencyEntries(file)) {
        for (const issue of arrayOf(state?.validation)) codes.push(`${id} ${issue?.code}`);
    }
    return codes;
}

function describeFileLine(file, { expanded = false } = {}) {
    const meta = file.metadata || {};
    const keywords = keywordsOf(file);
    const title = textOf(meta.title);
    const head = [
        file.iid,
        file.filename || "?",
        file.type || "?",
        `metaver ${file.metaver}`,
        plural(keywords.length, "keyword"),
        title ? `"${truncate(title, 100)}"` : "NO TITLE"
    ];
    const statuses = describeStatusesShort(file);
    const lines = [`${head.join(" · ")}${statuses ? ` · ${statuses}` : ""}`];
    if (expanded && hasOwn(meta, "description")) lines.push(`   description: ${textOf(meta.description) ? truncate(meta.description, 300) : "(none)"}`);
    if (keywords.length) {
        const shown = expanded ? keywords : keywords.slice(0, 12);
        const rest = keywords.length - shown.length;
        lines.push(`   keywords: ${shown.join(", ")}${rest > 0 ? `, … (+${rest})` : ""}`);
    }
    return lines.join("\n");
}

function describeFileDetails(file, account) {
    const meta = file.metadata || {};
    const keywords = keywordsOf(file);
    const categories = arrayOf(meta.categories).map(category => (category?.sub === undefined || category?.sub === null
        ? `${category?.cat}` : `${category?.cat}/${category.sub}`));
    const flags = [
        `editorial: ${meta.editorial ? "yes" : "no"}`,
        `AI generated: ${meta.ai_generated ? "yes" : "no"}`,
        `illustration: ${meta.illustration ? "yes" : "no"}`
    ];
    const size = Number.isFinite(file.size_bytes) ? ` · ${(file.size_bytes / (1024 * 1024)).toFixed(1)} MB` : "";
    const lines = [
        `${file.filename || "?"} (iid ${file.iid}, ${file.type || "?"}${size}) in ${file.folder || "?"}`,
        `metaver ${file.metaver} · created ${file.created_at || "?"} · archived: ${file.archived ? "yes" : "no"} · AI metadata: ${file.has_ai_metadata ? "yes" : "no"}`,
        `Title: ${textOf(meta.title) || "(none)"}`
    ];
    if (hasOwn(meta, "description")) lines.push(`Description: ${textOf(meta.description) || "(none)"}`);
    lines.push(`Keywords (${keywords.length}): ${keywords.length ? keywords.join(", ") : "(none)"}`);
    lines.push(`Categories: ${categories.length ? categories.join(", ") : "(none)"} · ${flags.join(" · ")}`);
    const releases = arrayOf(meta.releases);
    lines.push(`Releases: ${releases.length ? releases.join(", ") : "(none)"}${textOf(meta.notes) ? ` · Notes: ${truncate(meta.notes, 200)}` : ""}`);
    lines.push("Agencies:", describeStatusesLong(file, account));
    if (file.preview_url) lines.push(`Preview: ${file.preview_url}`);
    return lines.join("\n");
}

function describeFolderLine(folder) {
    const parts = [folder.path];
    if (Number.isFinite(folder.file_count)) parts.push(plural(folder.file_count, "file"));
    if (Number.isFinite(folder.subfolder_count)) parts.push(plural(folder.subfolder_count, "subfolder"));
    if (folder.archived) parts.push("archived");
    const summary = isPlainObject(folder.status_summary) ? Object.entries(folder.status_summary) : [];
    const statuses = summary
        .map(([agency, counts]) => `${agency}: ${Object.entries(isPlainObject(counts) ? counts : {}).map(([status, count]) => `${status} ${count}`).join(", ")}`)
        .join("; ");
    return `${parts.join(" · ")}${statuses ? ` · ${statuses}` : ""}`;
}

function describeActor(actor) {
    if (!isPlainObject(actor)) return "";
    if (actor.kind === "agent") return ` by agent "${actor.key_name || "?"}" (${actor.key_prefix || "?"})`;
    if (actor.kind === "user") return " by the user";
    if (actor.kind === "system") return " by Microstock+";
    if (actor.kind) return ` by ${actor.kind}`;
    return "";
}

function describeEventData(event, account) {
    const data = isPlainObject(event.data) ? event.data : {};
    const parts = [];
    const count = Number.isFinite(data.count) ? data.count : arrayOf(data.iids).length;
    if (count) parts.push(plural(count, "file"));
    if (data.folder) parts.push(`in ${data.folder}`);
    if (data.agency) parts.push(`on ${account.agencyName(data.agency)}`);
    if (data.from || data.to) parts.push(`${data.from || "?"} → ${data.to || "?"}`);
    if (data.result) parts.push(String(data.result));
    if (data.reason) parts.push(`reason: ${truncate(data.reason, 160)}`);
    if (arrayOf(data.fields).length) parts.push(`fields: ${data.fields.join(", ")}`);
    if (data.job_id) parts.push(`job ${data.job_id}`);
    if (data.quote_id) parts.push(`quote ${data.quote_id}`);
    if (data.amount_eur !== undefined) parts.push(formatEur(data.amount_eur));
    if (data.export_id) parts.push(`export ${data.export_id}`);
    if (data.key_name) parts.push(`key "${data.key_name}"`);
    return parts.join(", ");
}

function describeEvent(event, account) {
    const detail = describeEventData(event, account);
    return `${event.created_at || "?"} ${event.type}${describeActor(event.actor)}${detail ? `: ${detail}` : ""}`;
}

function describeJob(job) {
    const total = Number.isFinite(job.files_total) ? job.files_total : "?";
    const progress = `${job.files_done ?? 0} of ${total} files done${job.files_failed ? `, ${job.files_failed} failed` : ""}`;
    const charged = job.amount_eur_charged !== undefined && job.amount_eur_charged !== null
        ? `, ${formatEur(job.amount_eur_charged)} charged so far` : "";
    return `Job ${job.id} (${job.type || "ai_keywording"}) is ${job.status}: ${progress}${charged}.`;
}

function pagingNote(list, toolName) {
    if (!list.has_more) return "";
    return list.next_cursor
        ? ` More results exist: call ${toolName} again with the same arguments and cursor "${list.next_cursor}".`
        : " More results exist.";
}

function rateLimitNote(api) {
    const limit = api?.rateLimit;
    if (!limit || limit.remaining > LOW_RATE_LIMIT_WARNING) return "";
    const reset = limit.resetSeconds ? `, resets in ${limit.resetSeconds} s` : "";
    return `Rate limit: ${plural(limit.remaining, "request")} left in this window${reset}.`;
}

function listData(data) {
    if (!Array.isArray(data.data)) {
        throw new ApiError({ status: 200, type: "api_error", code: "invalid_response", message: "The Agent API returned a list without data." });
    }
    return data.data;
}

// ---------------------------------------------------------------------------
// Tool handlers. Each returns { data, summary, text }: data is the Agent API object,
// summary tells the model what happened and what to do next, text is a compact
// human-readable rendering.

async function getAccount(args, ctx) {
    const { data } = await ctx.api.request("GET", "/me", { signal: ctx.signal });
    ctx.account.rememberAccount(data);
    const agencies = arrayOf(data.agencies);
    const scopes = arrayOf(data.key?.scopes);
    const abilities = PREVIEW_TOOLS ? SCOPE_ABILITIES : SCOPE_ABILITIES.filter(([scope]) => !PREVIEW_SCOPES.has(scope));
    const can = abilities.filter(([scope]) => scopes.includes(scope)).map(([, ability]) => ability);
    const cannot = abilities.filter(([scope]) => !scopes.includes(scope)).map(([, ability]) => ability);
    const plan = data.plan?.name ? `plan ${data.plan.name}` : "plan unknown";
    const balance = data.balance_eur === undefined || data.balance_eur === null ? "" : `, balance ${formatEur(data.balance_eur)}`;
    const agencyList = agencies.map(agency => ctx.account.agencyLabel(agency.id)).join(", ") || "none";
    const summary = [
        `Connected to the Microstock+ account ${data.name || data.id || "?"} (${plan}${balance}).`,
        `Connected agencies: ${agencyList}.`,
        can.length ? `This key can ${can.join(", ")}.` : "",
        cannot.length ? `It cannot ${cannot.join(", ")}.` : "",
        PREVIEW_TOOLS ? "" : "Paid Microstock+ AI keywording is outside this Agent API release; don't offer it.",
        "Nothing can be deleted through the API."
    ].filter(Boolean).join(" ");
    const lines = [
        `Key: "${data.key?.name || "?"}" (prefix ${data.key?.prefix || "?"}), scopes: ${scopes.join(", ") || "(none)"}`,
        `Keyword settings: lower-cased automatically: ${data.settings?.lowercase_keywords ? "yes" : "no"}; at most ${data.settings?.max_keywords ?? KEYWORDS_MAX} per file`
    ];
    if (isPlainObject(data.limits)) {
        lines.push(`Limits: ${Object.entries(data.limits).map(([name, value]) => `${name} ${value}`).join(", ")}`);
    }
    return { data, summary, text: lines.join("\n") };
}

async function listFolders(args, ctx) {
    const path = args.path ?? "/";
    const recursive = args.recursive ?? true;
    const query = { path, recursive, archived: args.archived, limit: args.limit ?? LIST_LIMIT_MAX, cursor: args.cursor };
    const { data } = await ctx.api.request("GET", "/folders", { query, signal: ctx.signal });
    const folders = listData(data);
    const scope = `${args.archived ? "archived folders" : "folders"} under ${path}${recursive ? "" : " (direct children only)"}`;
    const summary = folders.length
        ? `Found ${plural(folders.length, "folder")} (${scope}).${pagingNote(data, "mplus_list_folders")}`
        : `No ${scope}.`;
    return { data, summary, text: folders.map(describeFolderLine).join("\n") };
}

function fileListQuery(args) {
    if (args.status && !args.agency) throw new ToolInputError("status needs agency: statuses are per agency (for example agency adobestock, status ready).");
    if (args.search && args.iids) throw new ToolInputError("Pass either search or iids, not both.");
    if (args.min_keywords !== undefined && args.max_keywords !== undefined && args.min_keywords > args.max_keywords) {
        throw new ToolInputError("min_keywords must not be larger than max_keywords.");
    }
    if (args.updated_since !== undefined && !Number.isFinite(Date.parse(args.updated_since))) {
        throw new ToolInputError("updated_since must be an ISO-8601 date or time, for example 2026-10-01T00:00:00Z.");
    }
    return {
        folder: args.folder,
        recursive: args.recursive,
        search: args.search ?? (args.iids ? args.iids.join(",") : undefined),
        type: args.type,
        agency: args.agency,
        status: args.status,
        missing: args.missing ? args.missing.join(",") : undefined,
        min_keywords: args.min_keywords,
        max_keywords: args.max_keywords,
        archived: args.archived,
        updated_since: args.updated_since,
        expand: args.expand_metadata ? "metadata" : undefined,
        limit: args.limit ?? 25,
        cursor: args.cursor
    };
}

function describeFileFilters(args) {
    const filters = [];
    filters.push(`in ${args.folder ?? "/"}${args.recursive ? " and subfolders" : ""}`);
    if (args.search) filters.push(`matching "${truncate(args.search, 60)}"`);
    if (args.iids) filters.push(`among ${plural(args.iids.length, "requested iid")}`);
    if (args.type) filters.push(`of type ${args.type}`);
    if (args.agency) filters.push(`${args.status ? `with status ${args.status}` : "set up"} on ${args.agency}`);
    if (args.missing) filters.push(`missing ${args.missing.join(" or ")}`);
    if (args.min_keywords !== undefined) filters.push(`with at least ${plural(args.min_keywords, "keyword")}`);
    if (args.max_keywords !== undefined) filters.push(`with at most ${plural(args.max_keywords, "keyword")}`);
    if (args.archived) filters.push("archived");
    if (args.updated_since) filters.push(`updated since ${args.updated_since}`);
    return filters.join(", ");
}

async function listFiles(args, ctx) {
    const query = fileListQuery(args);
    const { data } = await ctx.api.request("GET", "/files", { query, signal: ctx.signal });
    const files = listData(data);
    const filters = describeFileFilters(args);
    const descriptions = args.expand_metadata ? "" : " Descriptions are left out; pass expand_metadata=true to include them.";
    const summary = files.length
        ? `Found ${plural(files.length, "file")} ${filters}.${descriptions}${pagingNote(data, "mplus_list_files")}`
        : `No files ${filters}.`;
    const text = files.map(file => describeFileLine(file, { expanded: Boolean(args.expand_metadata) })).join("\n");
    return { data, summary, text };
}

async function getFile(args, ctx) {
    const { data } = await ctx.api.request("GET", `/files/${encodeURIComponent(args.iid)}`, { signal: ctx.signal });
    const meta = data.metadata || {};
    const facts = [
        textOf(meta.title) ? "has a title" : "has no title",
        textOf(meta.description) ? "has a description" : "has no description",
        plural(keywordsOf(data).length, "keyword")
    ];
    const issues = validationCodes(data);
    const summary = [
        `${data.filename || data.iid} (${data.type || "?"}) in ${data.folder || "?"} is at metaver ${data.metaver}: ${facts.join(", ")}.`,
        issues.length ? `Validation: ${issues.join(", ")}.` : "No validation warnings.",
        `Pass if_match_metaver ${data.metaver} when you change it.`
    ].join(" ");
    return { data, summary, text: describeFileDetails(data, ctx.account) };
}

function normalizeTermOps(ops, label) {
    if (ops === undefined) return undefined;
    if (ops.set !== undefined && (ops.add !== undefined || ops.remove !== undefined)) {
        throw new ToolInputError(`${label}: use either set, or add and/or remove, not both.`);
    }
    const result = {};
    for (const op of ["set", "add", "remove"]) {
        if (ops[op] === undefined) continue;
        result[op] = ops[op].map((term, index) => {
            const trimmed = term.trim();
            if (!trimmed) throw new ToolInputError(`${label}.${op}[${index}] is empty.`);
            return trimmed;
        });
    }
    return result;
}

// Builds an Agent API metadata patch (contract: PATCH /files/{iid}/metadata) from tool arguments.
function buildPatch(source, label = "") {
    const patch = {};
    for (const field of PATCH_FIELDS) {
        if (source[field] !== undefined) patch[field] = source[field];
    }
    for (const field of ["title", "description", "notes"]) {
        if (typeof patch[field] === "string") {
            patch[field] = patch[field].trim();
            if (!patch[field]) throw new ToolInputError(`${label}${field} is empty; list the field in clear to empty it.`);
        }
    }
    if (patch.keywords !== undefined) patch.keywords = normalizeTermOps(patch.keywords, `${label}keywords`);
    if (patch.releases !== undefined) patch.releases = normalizeTermOps(patch.releases, `${label}releases`);
    for (const field of source.clear || []) {
        if (patch[field] !== undefined) throw new ToolInputError(`${label}${field} is both set and listed in clear.`);
        patch[field] = null;
    }
    if (patch.ai_generated === true && patch.editorial === true) {
        throw new ToolInputError(`${label}ai_generated and editorial cannot both be true: AI-generated content is never editorial.`);
    }
    if (Object.keys(patch).length === 0) throw new ToolInputError(`${label || "arguments: "}pass at least one field to change.`);
    return patch;
}

async function explainConflict(error, iid, ctx) {
    try {
        const { data } = await ctx.api.request("GET", `/files/${encodeURIComponent(iid)}`, { signal: ctx.signal });
        error.message = `${error.message} The file is now at metaver ${data.metaver}.`;
    } catch {
        // The original conflict error is still accurate without the current metaver.
    }
    return error;
}

async function updateMetadata(args, ctx) {
    const body = buildPatch(args);
    const changed = Object.keys(body);
    if (args.if_match_metaver !== undefined) body.if_match_metaver = args.if_match_metaver;
    let data;
    try {
        ({ data } = await ctx.api.request("PATCH", `/files/${encodeURIComponent(args.iid)}/metadata`, {
            body,
            idempotencyKey: randomUUID(),
            signal: ctx.signal
        }));
    } catch (error) {
        if (error instanceof ApiError && error.code === "metadata_conflict") throw await explainConflict(error, args.iid, ctx);
        throw error;
    }
    const issues = validationCodes(data);
    const unchanged = args.if_match_metaver !== undefined && data.metaver === args.if_match_metaver;
    const summary = [
        unchanged
            ? `Nothing changed: ${data.filename || data.iid} already had these values (metaver ${data.metaver}).`
            : `Updated ${changed.join(", ")} of ${data.filename || data.iid}; it now has ${plural(keywordsOf(data).length, "keyword")} and metaver ${data.metaver}.`,
        issues.length ? `Agencies still report: ${issues.join(", ")}.` : "No validation warnings.",
        unchanged ? "" : "There is no undo button: to revert, write back the values you read before this change."
    ].filter(Boolean).join(" ");
    return { data, summary, text: describeFileDetails(data, ctx.account) };
}

function batchItems(items) {
    const seen = new Set();
    return items.map((item, index) => {
        if (seen.has(item.iid)) throw new ToolInputError(`items[${index}]: iid ${item.iid} appears twice; combine its changes into one item.`);
        seen.add(item.iid);
        const entry = { iid: item.iid, patch: buildPatch(item.patch, `items[${index}].patch.`) };
        if (item.if_match_metaver !== undefined) entry.if_match_metaver = item.if_match_metaver;
        return entry;
    });
}

function describeBatchItem(result) {
    if (result.ok) {
        const file = result.file || {};
        const issues = validationCodes(file);
        const title = textOf(file.metadata?.title);
        return `ok   ${result.iid} ${file.filename || ""} · metaver ${file.metaver ?? "?"} · ${plural(keywordsOf(file).length, "keyword")}` +
            `${title ? ` · "${truncate(title, 80)}"` : ""}${issues.length ? ` · validation: ${issues.join(", ")}` : ""}`;
    }
    return `FAIL ${result.iid} · ${result.error?.code || "error"}: ${oneLine(result.error?.message)}`;
}

async function updateMetadataBatch(args, ctx) {
    const items = batchItems(args.items);
    const { data } = await ctx.api.request("POST", "/files/metadata:batch", {
        body: { items, dry_run: args.dry_run },
        idempotencyKey: randomUUID(),
        signal: ctx.signal
    });
    const results = arrayOf(data.results);
    const failed = results.filter(result => !result.ok);
    const okCount = results.length - failed.length;
    const failures = failed.length ? ` (${countBy(failed, result => result.error?.code || "error")})` : "";
    const summary = args.dry_run
        ? `Dry run, nothing was written: ${okCount} of ${plural(results.length, "change")} would apply, ${failed.length} would fail${failures}. ` +
          "Show the planned changes to the user; to apply the valid ones, call again with dry_run=false and the same items."
        : `Applied ${okCount} of ${plural(results.length, "change")}; ${failed.length} failed${failures}. ` +
          (failed.length ? "Failed items were not changed: re-read them with mplus_get_file, fix and retry only those." : "There is no undo button: to revert, write back the values you read before these changes.");
    return { data, summary, text: results.map(describeBatchItem).join("\n") };
}

async function setStatus(args, ctx) {
    if (args.status === "queued" && args.user_confirmed !== true) {
        throw new RefusedError(
            "Not queued: queueing sends the user's files to stock agencies. Show the user which files go to which agencies, " +
            "ask for explicit approval, then call again with user_confirmed=true."
        );
    }
    const body = { iids: args.iids, agency: args.agency, status: args.status, user_confirmed: args.user_confirmed === true };
    const { data } = await ctx.api.request("POST", "/files/status:batch", { body, idempotencyKey: randomUUID(), signal: ctx.signal });
    const results = arrayOf(data.results);
    const failed = results.filter(result => !result.ok);
    const okCount = results.length - failed.length;
    const failures = failed.length ? ` (${countBy(failed, result => `${result.error?.code || "error"} on ${result.agency || "?"}`)})` : "";
    const next = args.status === "queued" && okCount
        ? " Uploads start automatically; follow them with mplus_wait_for_events (file.status.changed, file.uploaded, file.submitted)."
        : "";
    const summary = `Set status ${args.status} for ${okCount} of ${plural(results.length, "file/agency pair")}; ${failed.length} failed${failures}.${next}`;
    const text = results.map(result => (result.ok
        ? `ok   ${result.iid} · ${result.agency}: ${result.previous_status || "?"} → ${result.status || args.status}`
        : `FAIL ${result.iid} · ${result.agency || "?"} · ${result.error?.code || "error"}: ${oneLine(result.error?.message)}`)).join("\n");
    return { data, summary, text };
}

async function createFolder(args, ctx) {
    const { data } = await ctx.api.request("POST", "/folders", {
        body: { directory: args.directory },
        idempotencyKey: randomUUID(),
        signal: ctx.signal
    });
    const summary = `Created Microstock+ folder ${data.path || data.directory || args.directory}. Nothing was uploaded or deleted.`;
    return { data, summary, text: `Folder: ${data.path || data.directory || args.directory}` };
}

async function fetchCsv(ctx, exportObject) {
    if (!exportObject.download_url) return { csv_omitted_reason: "The export has no download_url." };
    const csv = await ctx.api.downloadText(exportObject.download_url, { accept: "text/csv", maxBytes: CSV_MAX_BYTES, signal: ctx.signal });
    if (csv.length > INLINE_CSV_MAX_CHARS) {
        return {
            csv_omitted_reason: `The CSV has ${Math.round(csv.length / 1024)} KB of text, more than the ${Math.round(INLINE_CSV_MAX_CHARS / 1000)} KB returned inline. ` +
                "Export smaller parts (a subfolder or a list of iids)."
        };
    }
    return { csv };
}

async function exportCsv(args, ctx) {
    if (Boolean(args.iids) === Boolean(args.folder)) throw new ToolInputError("Pass either iids or folder.");
    if (args.recursive !== undefined && !args.folder) throw new ToolInputError("recursive applies only to folder exports.");
    const body = args.iids ? { iids: args.iids } : { folder: args.folder, recursive: args.recursive ?? false };
    body.format = args.format ?? "default";
    body.delimiter = args.delimiter ?? "comma";
    const { data: exportObject } = await ctx.api.request("POST", "/exports/csv", { body, idempotencyKey: randomUUID(), signal: ctx.signal });
    const inline = args.include_csv ? await fetchCsv(ctx, exportObject) : {};
    const data = { ...exportObject, ...inline };
    const delimiter = body.delimiter === "semicolon" ? "semicolon-separated" : "comma-separated";
    const parts = [
        `CSV export ready: ${plural(Number(data.rows) || 0, "row")}, format ${data.format || body.format}, ${delimiter}.`,
        `download_url works with the agent key until ${data.expires_at || "it expires"}.`
    ];
    if (inline.csv !== undefined) parts.push("The CSV text is in the csv field; save it as a .csv file for the user without changing it.");
    if (inline.csv_omitted_reason) parts.push(inline.csv_omitted_reason);
    const text = inline.csv !== undefined
        ? `Download: ${data.download_url}\n\n${inline.csv}`
        : `Download: ${data.download_url}`;
    return { data, summary: parts.join(" "), text };
}

async function initializeUpload(args, ctx) {
    const body = {
        filename: args.filename,
        size_bytes: args.size_bytes,
        content_type: args.content_type,
        directory: args.directory
    };
    const { data } = await ctx.api.request("POST", "/uploads/init", {
        body,
        idempotencyKey: randomUUID(),
        signal: ctx.signal
    });
    const chunk = data.upload?.chunk || {};
    const summary = [
        `Upload ticket ready for ${data.filename || args.filename} in ${data.directory || args.directory}.`,
        `Upload every missing chunk index from 0 to ${(data.upload?.chunk_count ?? 1) - 1} directly to the ticket's chunk URL with ${chunk.method || "POST"}, replacing {chunk_number} in form_fields and using binary field ${chunk.file_field || "chunk"}; then call upload.finish with its form_fields.`,
        `The ticket expires at ${data.expires_at || "the time returned by Microstock+"}. Never send a remote source URL.`
    ].join(" ");
    return { data, summary, text: `File id: ${data.file_id || "?"}\nChunks: ${data.upload?.chunk_count ?? "?"} × ${data.upload?.chunk_size_bytes ?? "?"} bytes\nChunk: ${chunk.method || "POST"} ${chunk.url || "?"}\nFinish: ${data.upload?.finish?.method || "POST"} ${data.upload?.finish?.url || "?"}` };
}

async function quoteAiKeywording(args, ctx) {
    const body = { iids: args.iids, mode: args.mode ?? "skip", template_id: args.template_id ?? null };
    const { data } = await ctx.api.request("POST", "/ai/keywording:quote", { body, idempotencyKey: randomUUID(), signal: ctx.signal });
    if (typeof data.quote_id !== "string" || !Number.isFinite(Number(data.amount_eur))) {
        throw new ApiError({ status: 200, type: "api_error", code: "invalid_response", message: "The quote has no quote_id or amount_eur." });
    }
    ctx.account.rememberQuote(data);
    const amount = Number(data.amount_eur);
    const parts = [
        `Quote ${data.quote_id}: AI keywording of ${plural(Number(data.files) || 0, "file")} (mode ${body.mode}) costs ${formatEur(amount)},`,
        `valid until ${data.expires_at || "?"}. Nothing has been charged.`
    ];
    if (ctx.account.lacksScope("ai:run")) {
        parts.push(`This key cannot run paid jobs (the ai:run scope is off): the user can create a key with ai:run at ${KEYS_PAGE_URL}, or start AI keywording in the Microstock+ web interface.`);
    } else {
        parts.push(`Tell the user the exact price and ask for explicit confirmation; only then call mplus_run_ai_keywording with quote_id "${data.quote_id}" and confirm_charge_eur ${amount}.`);
    }
    return { data, summary: parts.join(" "), text: "" };
}

// A stable Idempotency-Key per quote: repeating a run of the same quote replays the first
// answer instead of starting (and charging for) a second job.
function runIdempotencyKey(quoteId) {
    const hex = createHash("sha256").update(`microstock-plus-mcp/ai-run/${quoteId}`).digest("hex");
    const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function checkRunAllowed(args, account) {
    if (account.lacksScope("ai:run")) {
        throw new RefusedError(
            "Not run (scope_required): this agent key does not have the ai:run scope, so it cannot start paid AI keywording. " +
            `The user can create a key with ai:run at ${KEYS_PAGE_URL}, or start AI keywording in the Microstock+ web interface.`
        );
    }
    const quote = account.quotes.get(args.quote_id);
    if (!quote) {
        throw new RefusedError(
            `Not run: quote ${args.quote_id} was not created through this connection, so its price cannot be checked. ` +
            "Get a fresh quote with mplus_quote_ai_keywording, tell the user the price, and run it after they confirm."
        );
    }
    if (toCents(args.confirm_charge_eur) !== toCents(quote.amountEur)) {
        throw new RefusedError(
            `Not run: confirm_charge_eur ${formatEur(args.confirm_charge_eur)} does not match the quoted ${formatEur(quote.amountEur)}. ` +
            "Tell the user the quoted price and pass exactly that amount once they confirm it."
        );
    }
    if (quote.files === 0) throw new RefusedError("Not run: this quote covers no billable files, so there is nothing to do.");
    return quote;
}

async function runAiKeywording(args, ctx) {
    const quote = checkRunAllowed(args, ctx.account);
    const { data, replayed } = await ctx.api.request("POST", "/ai/keywording:run", {
        body: { quote_id: args.quote_id },
        idempotencyKey: runIdempotencyKey(args.quote_id),
        signal: ctx.signal
    });
    const files = quote.files === null ? "the quoted files" : plural(quote.files, "file");
    const first = replayed
        ? `This quote was already run: this is the same job ${data.id}, and nothing was charged twice.`
        : `Started AI keywording job ${data.id} for ${files} at the quoted ${formatEur(quote.amountEur)}; only files that succeed are charged.`;
    const summary = `${first} Follow it with mplus_get_job "${data.id}" or mplus_wait_for_events with types ai.job.completed and ai.job.failed.`;
    return { data, summary, text: describeJob(data) };
}

async function getJob(args, ctx) {
    const { data } = await ctx.api.request("GET", `/jobs/${encodeURIComponent(args.job_id)}`, { signal: ctx.signal });
    const finished = ["completed", "failed"].includes(data.status);
    const summary = `${describeJob(data)}${finished ? "" : " Check again later or wait with mplus_wait_for_events."}`;
    return { data, summary, text: data.error ? `Error: ${describeAgencyError(data.error)}` : "" };
}

function eventLogLevel(event) {
    const data = isPlainObject(event.data) ? event.data : {};
    switch (event.type) {
        case "ai.job.failed": return "error";
        case "key.revoked": return "warning";
        case "file.reviewed": return data.result === "rejected" ? "warning" : "notice";
        case "file.status.changed": return PROBLEM_STATUSES.has(data.to) ? "warning" : null;
        case "ai.job.completed": return "notice";
        case "file.uploaded":
        case "file.submitted":
        case "export.ready": return "info";
        default: return null;
    }
}

function reportNotableEvents(events, ctx) {
    let sent = 0;
    for (const event of events) {
        const level = eventLogLevel(event);
        if (!level || sent >= MAX_LOG_NOTIFICATIONS) continue;
        if (ctx.log(level, { event: event.type, id: event.id, summary: describeEvent(event, ctx.account) })) sent += 1;
    }
}

async function waitForEvents(args, ctx) {
    const wait = args.wait_seconds ?? EVENT_WAIT_MAX_S;
    const query = {
        since: args.cursor,
        types: args.types ? args.types.join(",") : undefined,
        wait,
        limit: args.limit ?? 50
    };
    const { data } = await ctx.api.request("GET", "/events", {
        query,
        signal: ctx.signal,
        timeoutMs: wait * 1000 + EVENTS_TIMEOUT_GRACE_MS
    });
    const events = listData(data);
    const cursor = textOf(data.next_cursor) || events.at(-1)?.id || args.cursor || null;
    const result = { ...data, next_cursor: cursor };
    reportNotableEvents(events, ctx);
    const keepWatching = cursor ? ` To keep watching, call mplus_wait_for_events again with cursor "${cursor}".` : "";
    const summary = events.length
        ? `${args.cursor ? `${plural(events.length, "new event")} since the cursor` : `The ${plural(events.length, "most recent event")}`}, oldest first.` +
          `${data.has_more ? " More events are waiting: call again right away." : ""}${keepWatching}`
        : `No new events within ${wait} s.${keepWatching}`;
    return { data: result, summary, text: events.map(event => describeEvent(event, ctx.account)).join("\n") };
}

// ---------------------------------------------------------------------------
// Tool definitions (contract section 7)

const TOOLS = [
    {
        name: "mplus_get_account",
        title: "Get the Microstock+ account",
        scope: "account:read",
        alwaysListed: true,
        description: [
            "Get the Microstock+ account behind the configured agent key: plan, balance in EUR (null when not reported), connected stock agencies",
            "with the agency ids the other tools expect (for example adobestock = Adobe Stock, esp = iStock, shutterstock, pond5),",
            "keyword settings, API limits, and the key's name, prefix and scopes (what this key may do).",
            "Call it first in a session. Read-only."
        ].join(" "),
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        outputSchema: withSummary(ACCOUNT_OUTPUT),
        annotations: readAnnotations("Get the Microstock+ account"),
        handler: getAccount
    },
    {
        name: "mplus_list_folders",
        title: "List Microstock+ folders",
        scope: "files:read",
        description: [
            "List the user's Microstock+ folders as a flat tree: path, number of files and subfolders, and per-agency status counts",
            "(for example how many files are ready or submitted on Adobe Stock). Use it to find where files are before listing them.",
            "Archived folders are left out unless archived=true. Read-only; pass next_cursor as cursor for the next page."
        ].join(" "),
        inputSchema: {
            type: "object",
            properties: {
                path: { ...FOLDER_PATH_SCHEMA, description: "List this folder's subfolders. Default / (all folders)." },
                recursive: { type: "boolean", description: "Include nested subfolders at every depth. Default true." },
                archived: { type: "boolean", description: "true lists archived folders instead of active ones. Default false." },
                limit: listLimit(LIST_LIMIT_MAX),
                cursor: CURSOR_SCHEMA
            },
            additionalProperties: false
        },
        outputSchema: listOutput(FOLDER_OUTPUT),
        annotations: readAnnotations("List Microstock+ folders"),
        handler: listFolders
    },
    {
        name: "mplus_list_files",
        title: "List or search Microstock+ files",
        scope: "files:read",
        description: [
            "List or search the user's files with their metadata, metaver and per-agency status.",
            "Filters: folder (with recursive), free-text search or a list of iids, media type, agency + status",
            "(for example agency adobestock, status ready), missing fields (find files without a title, description, keywords",
            "or categories) and keyword count (max_keywords 6 finds files that Shutterstock would refuse).",
            "Descriptions are included only with expand_metadata=true. Returns up to limit files (default 25; keep it at 50 or less",
            "unless you need more); pass next_cursor as cursor for the next page. Read-only."
        ].join(" "),
        inputSchema: {
            type: "object",
            properties: {
                folder: { ...FOLDER_PATH_SCHEMA, description: "Folder to list. Default / (the top folder)." },
                recursive: { type: "boolean", description: "Include files in all subfolders. Default false." },
                search: { type: "string", minLength: 1, maxLength: 200, description: "Text to find in file names, titles and keywords." },
                iids: iidList(LIST_LIMIT_MAX, "Only these files (instead of search)."),
                type: { type: "string", enum: MEDIA_TYPES, description: "Media type: raster (photos and raster illustrations), vector or video." },
                agency: AGENCY_ID_SCHEMA,
                status: { type: "string", enum: FILE_STATUSES, description: "Status on the given agency; requires agency." },
                missing: {
                    type: "array",
                    items: { type: "string", enum: MISSING_FIELDS },
                    minItems: 1,
                    uniqueItems: true,
                    description: "Only files that lack any of these fields."
                },
                min_keywords: { type: "integer", minimum: 0, maximum: 200, description: "Only files with at least this many keywords." },
                max_keywords: { type: "integer", minimum: 0, maximum: 200, description: "Only files with at most this many keywords." },
                archived: { type: "boolean", description: "true lists archived files instead of active ones. Default false." },
                updated_since: {
                    type: "string",
                    minLength: 10,
                    maxLength: 40,
                    pattern: "^\\d{4}-\\d{2}-\\d{2}",
                    description: "Only files changed since this ISO-8601 time, for example 2026-10-01T00:00:00Z"
                },
                expand_metadata: { type: "boolean", description: "Include descriptions. Default false." },
                limit: listLimit(25),
                cursor: CURSOR_SCHEMA
            },
            additionalProperties: false
        },
        outputSchema: listOutput(FILE_OUTPUT),
        annotations: readAnnotations("List or search Microstock+ files"),
        handler: listFiles
    },
    {
        name: "mplus_get_file",
        title: "Get one Microstock+ file",
        scope: "files:read",
        description: [
            "Get one file by iid with its full metadata (title, description, keywords in order, categories, editorial, AI-generated",
            "and illustration flags, releases, notes), its metaver (needed for safe updates), preview links, and for every agency",
            "its status, upload and submission times, errors and validation warnings (for example \"Less than 7 keywords\" on",
            "Shutterstock). Read-only."
        ].join(" "),
        inputSchema: {
            type: "object",
            properties: { iid: IID_SCHEMA },
            required: ["iid"],
            additionalProperties: false
        },
        outputSchema: withSummary(FILE_OUTPUT),
        annotations: readAnnotations("Get one Microstock+ file"),
        handler: getFile
    },
    {
        name: "mplus_update_metadata",
        title: "Update one file's metadata",
        scope: "metadata:write",
        description: [
            "Change the metadata of one file. Only the fields you pass change: title, description, keywords (set the whole",
            "ordered list, or add/remove words), categories, editorial, ai_generated, illustration, releases, notes; list fields",
            "in clear to empty them. Pass if_match_metaver (from mplus_get_file or mplus_list_files) so the change fails with",
            "metadata_conflict instead of overwriting a newer edit. ai_generated=true also sets editorial=false. Returns the",
            "updated file with its new metaver and per-agency validation. Uploads nothing. There is no undo button: keep the values",
            "you read, so you can write them back if the user wants the change reverted. For several files use",
            "mplus_update_metadata_batch."
        ].join(" "),
        inputSchema: {
            type: "object",
            properties: { iid: IID_SCHEMA, if_match_metaver: IF_MATCH_METAVER_SCHEMA, ...PATCH_PROPERTIES },
            required: ["iid"],
            additionalProperties: false
        },
        outputSchema: withSummary(FILE_OUTPUT),
        annotations: writeAnnotations("Update one file's metadata"),
        handler: updateMetadata
    },
    {
        name: "mplus_update_metadata_batch",
        title: "Update metadata of many files",
        scope: "metadata:write",
        description: [
            `Change the metadata of up to ${BATCH_MAX_ITEMS} files in one call. Each item is {iid, patch, if_match_metaver} and patch takes`,
            "the same fields as mplus_update_metadata. Always call with dry_run=true first: it checks every item and returns the",
            "would-be metadata and agency validation without writing anything. Show the user the planned changes, then call again",
            "with dry_run=false. Items succeed or fail on their own; failed items (for example metadata_conflict when a file changed",
            "since your metaver) are listed with their error and stay unchanged."
        ].join(" "),
        inputSchema: {
            type: "object",
            properties: {
                items: {
                    type: "array",
                    minItems: 1,
                    maxItems: BATCH_MAX_ITEMS,
                    items: {
                        type: "object",
                        properties: { iid: IID_SCHEMA, patch: PATCH_SCHEMA, if_match_metaver: IF_MATCH_METAVER_SCHEMA },
                        required: ["iid", "patch"],
                        additionalProperties: false
                    },
                    description: "One entry per file; each iid at most once."
                },
                dry_run: { type: "boolean", description: "true checks and previews without writing. Required: start with true." }
            },
            required: ["items", "dry_run"],
            additionalProperties: false
        },
        outputSchema: withSummary(METADATA_BATCH_OUTPUT),
        annotations: writeAnnotations("Update metadata of many files"),
        handler: updateMetadataBatch
    },
    {
        name: "mplus_set_status",
        title: "Set agency status (queue uploads)",
        scope: "status:write",
        description: [
            `Set the per-agency status of up to ${BATCH_MAX_ITEMS} files: ready (prepared, not sent), queued (send to the agency: upload`,
            "and submit) or ignored (never send to that agency). Queueing sends the user's files to external stock agencies, so",
            "pass user_confirmed=true only after the user explicitly approved these files and agencies in this conversation.",
            "Only connected agencies work (see mplus_get_account). The same agency and Microstock+ rules as in the web interface",
            "apply, so single items can fail, for example nosubmissions when the submission limit is reached; failures are",
            "reported per file and agency."
        ].join(" "),
        inputSchema: {
            type: "object",
            properties: {
                iids: iidList(BATCH_MAX_ITEMS, "Files to change."),
                agency: AGENCY_ID_SCHEMA,
                status: { type: "string", enum: SETTABLE_STATUSES, description: "ready, queued (upload and submit) or ignored." },
                user_confirmed: {
                    type: "boolean",
                    description: "Required true for queued: the user explicitly approved sending these files to this agency."
                }
            },
            required: ["iids", "agency", "status"],
            additionalProperties: false
        },
        outputSchema: withSummary(STATUS_BATCH_OUTPUT),
        annotations: writeAnnotations("Set agency status (queue uploads)", { openWorld: true }),
        handler: setStatus
    },
    {
        name: "mplus_create_folder",
        title: "Create a Microstock+ folder",
        scope: "files:upload",
        description: [
            "Create one folder in the key owner's Microstock+ portfolio so local files can be uploaded into it.",
            "Pass the complete directory path beginning with /. This cannot delete, rename or overwrite a folder or file."
        ].join(" "),
        inputSchema: {
            type: "object",
            properties: { directory: FOLDER_PATH_SCHEMA },
            required: ["directory"],
            additionalProperties: false
        },
        outputSchema: withSummary(FOLDER_OUTPUT),
        annotations: writeAnnotations("Create a Microstock+ folder"),
        handler: createFolder
    },
    {
        name: "mplus_initialize_upload",
        title: "Initialize a Microstock+ file upload",
        scope: "files:upload",
        description: [
            "Create a short-lived upload ticket for one local file. The named Microstock+ directory must already exist.",
            "After this call, transfer the local binary directly to upload.chunk.url with the returned method, form_fields and file_field,",
            "then call upload.finish. This tool never accepts or fetches a remote URL, and it cannot delete or replace an existing file."
        ].join(" "),
        inputSchema: {
            type: "object",
            properties: {
                filename: { type: "string", minLength: 1, maxLength: 255, pattern: "^[^/\\\\]+$", description: "File name only, without a path." },
                size_bytes: { type: "integer", minimum: 1, maximum: UPLOAD_MAX_BYTES, description: "Exact local file size in bytes." },
                content_type: { type: "string", minLength: 3, maxLength: 200, pattern: "^[^\\s/]+/[^\\s/]+$", description: "MIME type such as image/jpeg, image/png, application/zip or video/mp4." },
                directory: FOLDER_PATH_SCHEMA
            },
            required: ["filename", "size_bytes", "content_type", "directory"],
            additionalProperties: false
        },
        outputSchema: withSummary(UPLOAD_OUTPUT),
        annotations: writeAnnotations("Initialize a Microstock+ file upload", { openWorld: true }),
        handler: initializeUpload
    },
    {
        name: "mplus_export_csv",
        title: "Export metadata as CSV",
        scope: "csv:export",
        description: [
            `Build a metadata CSV (the same layouts as Export CSV in My Files) for up to ${EXPORT_MAX_IIDS} files, from a list of iids or a folder.`,
            "Formats: default (filename, description, keywords, categories, release files), with_title (adds the title),",
            "importable (for re-import into Microstock+), with_release_names (release names instead of files), without_categories,",
            "nimia (Nimia footage template), alamy (Alamy video template). Delimiter comma (for agencies) or semicolon (for Excel).",
            "Returns a download_url that works with the agent key until expires_at; include_csv=true also returns the CSV text",
            "(up to about 250 KB) so you can save it as a file. Free; changes nothing."
        ].join(" "),
        inputSchema: {
            type: "object",
            properties: {
                iids: iidList(EXPORT_MAX_IIDS, "Files to export (instead of folder)."),
                folder: { ...FOLDER_PATH_SCHEMA, description: "Export this folder (instead of iids)." },
                recursive: { type: "boolean", description: "With folder: include subfolders. Default false." },
                format: { type: "string", enum: CSV_FORMATS, description: "CSV layout. Default default." },
                delimiter: { type: "string", enum: CSV_DELIMITERS, description: "comma (for agencies, default) or semicolon (for Excel)." },
                include_csv: { type: "boolean", description: "Also return the CSV text. Default false." }
            },
            additionalProperties: false
        },
        outputSchema: withSummary(EXPORT_OUTPUT),
        annotations: readAnnotations("Export metadata as CSV", { idempotent: false }),
        handler: exportCsv
    },
    {
        name: "mplus_quote_ai_keywording",
        title: "Quote AI keywording (free)",
        scope: "ai:quote",
        feature: "ai_keywording",
        description: [
            "Get a price quote for Microstock+ AI keywording (AI-written titles, descriptions and keywords) of up to",
            `${AI_MAX_IIDS} files. mode skip leaves files that already have metadata unchanged; mode replace rewrites the metadata of`,
            "every listed file. Free: nothing is charged and nothing changes. Returns quote_id, the number of billable files,",
            "amount_eur and expires_at. Tell the user the price; only if they explicitly agree, call mplus_run_ai_keywording",
            "with the quote_id and that exact amount."
        ].join(" "),
        inputSchema: {
            type: "object",
            properties: {
                iids: iidList(AI_MAX_IIDS, "Files to keyword."),
                mode: { type: "string", enum: AI_MODES, description: "skip (default): keep files that already have metadata; replace: rewrite all." },
                template_id: {
                    type: "string",
                    pattern: "^[A-Za-z0-9_-]{1,64}$",
                    description: "Id of one of the user's AI keywording templates; omit for the default"
                }
            },
            required: ["iids"],
            additionalProperties: false
        },
        outputSchema: withSummary(QUOTE_OUTPUT),
        annotations: readAnnotations("Quote AI keywording (free)", { idempotent: false }),
        handler: quoteAiKeywording
    },
    {
        name: "mplus_run_ai_keywording",
        title: "Run AI keywording (PAID)",
        scope: "ai:run",
        feature: "ai_keywording",
        description: [
            "PAID: spends money from the user's Microstock+ balance. Runs AI keywording for a quote from mplus_quote_ai_keywording.",
            "Call it only after the user explicitly confirmed the quoted price in this conversation, and pass that price as",
            "confirm_charge_eur: the call is refused when it differs from the quote. Only files that succeed are charged, at the",
            "quoted price. Calling it again with the same quote_id returns the same job and never charges twice. Returns a job;",
            "follow it with mplus_get_job or mplus_wait_for_events (ai.job.completed, ai.job.failed).",
            "Needs the ai:run scope, which is off by default on new keys."
        ].join(" "),
        inputSchema: {
            type: "object",
            properties: {
                quote_id: {
                    type: "string",
                    pattern: "^[A-Za-z0-9_-]{1,100}$",
                    description: "quote_id returned by mplus_quote_ai_keywording in this session"
                },
                confirm_charge_eur: {
                    type: "number",
                    minimum: 0,
                    description: "The quoted amount_eur that the user explicitly approved."
                }
            },
            required: ["quote_id", "confirm_charge_eur"],
            additionalProperties: false
        },
        outputSchema: withSummary(JOB_OUTPUT),
        annotations: {
            title: "Run AI keywording (PAID)",
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: true,
            openWorldHint: false
        },
        handler: runAiKeywording
    },
    {
        name: "mplus_get_job",
        title: "Get AI job progress",
        scope: "files:read",
        feature: "ai_keywording",
        description: [
            "Get the progress of an AI keywording job: status (queued, running, completed or failed), files done and failed",
            "out of the total, and the amount charged so far. Read-only."
        ].join(" "),
        inputSchema: {
            type: "object",
            properties: {
                job_id: { type: "string", pattern: "^[A-Za-z0-9_-]{1,100}$", description: "Job id from mplus_run_ai_keywording" }
            },
            required: ["job_id"],
            additionalProperties: false
        },
        outputSchema: withSummary(JOB_OUTPUT),
        annotations: readAnnotations("Get AI job progress"),
        handler: getJob
    },
    {
        name: "mplus_wait_for_events",
        title: "Wait for account events",
        scope: "events:read",
        description: [
            `Wait up to wait_seconds (at most ${EVENT_WAIT_MAX_S}) for new events on the user's account and return them.`,
            PREVIEW_TOOLS
                ? "Events: metadata updates, status changes per agency (from/to), uploads, submissions, reviews (approved or rejected " +
                  "with the reason), AI quotes and jobs, exports and key changes."
                : "Microstock+ currently reports the changes made through the Agent API (metadata updates and exports) and agent key " +
                  "changes; upload, submission and review events are not reported yet.",
            "Returns as soon as events arrive. Without cursor it starts with the most recent events;",
            "pass the returned next_cursor as cursor to continue exactly where you left off. Filter with types.",
            PREVIEW_TOOLS ? "Use it to watch uploads, reviews or an AI job and to report progress. Read-only."
                : "Use it to confirm what changed and to report progress. Read-only."
        ].join(" "),
        inputSchema: {
            type: "object",
            properties: {
                cursor: { ...CURSOR_SCHEMA, description: "next_cursor from the previous mplus_wait_for_events result." },
                types: {
                    type: "array",
                    items: { type: "string", enum: EVENT_TYPES },
                    minItems: 1,
                    uniqueItems: true,
                    description: "Only these event types."
                },
                wait_seconds: {
                    type: "integer",
                    minimum: 0,
                    maximum: EVENT_WAIT_MAX_S,
                    description: `How long to wait for new events, 0-${EVENT_WAIT_MAX_S}. Default ${EVENT_WAIT_MAX_S}.`
                },
                limit: listLimit(50)
            },
            additionalProperties: false
        },
        outputSchema: listOutput(EVENT_OUTPUT),
        annotations: readAnnotations("Wait for account events"),
        handler: waitForEvents
    }
];

const TOOL_INDEX = new Map(TOOLS.map(tool => [tool.name, tool]));
// Tools of features the Agent API does not offer yet stay out of tools/list unless MPLUS_ENABLE_PREVIEW_TOOLS=1.
const OFFERED_TOOLS = PREVIEW_TOOLS ? TOOLS : TOOLS.filter(tool => !tool.feature);

const TOOL_API_ROUTES = Object.freeze({
    mplus_get_account: { method: "GET", path: "/me" },
    mplus_list_folders: { method: "GET", path: "/folders" },
    mplus_list_files: { method: "GET", path: "/files" },
    mplus_get_file: { method: "GET", path: "/files/{iid}" },
    mplus_update_metadata: { method: "PATCH", path: "/files/{iid}/metadata" },
    mplus_update_metadata_batch: { method: "POST", path: "/files/metadata:batch" },
    mplus_set_status: { method: "POST", path: "/files/status:batch" },
    mplus_create_folder: { method: "POST", path: "/folders" },
    mplus_initialize_upload: { method: "POST", path: "/uploads/init" },
    mplus_export_csv: { method: "POST", path: "/exports/csv" },
    mplus_wait_for_events: { method: "GET", path: "/events" }
});

function portableToolCatalogue() {
    return {
        schema_version: "1",
        server: SERVER_INFO,
        tools: TOOLS.filter(tool => !tool.feature).map(({ handler, feature, alwaysListed, scope, ...definition }) => ({
            ...definition,
            scope,
            api: TOOL_API_ROUTES[definition.name]
        }))
    };
}

function visibleTools(scopes) {
    if (!scopes) return OFFERED_TOOLS;
    return OFFERED_TOOLS.filter(tool => tool.alwaysListed || !tool.scope || scopes.includes(tool.scope));
}

// The same answer whether the tool is not offered here or the API refuses it with 403 endpoint_disabled.
function notAvailableResult(tool) {
    return { content: [{ type: "text", text: NOT_AVAILABLE[tool.feature] }], isError: true };
}

// ---------------------------------------------------------------------------
// MCP protocol (transport-independent)

function createSession(transport) {
    return { transport, legacyVersion: null, legacyLogLevel: null };
}

function supportsStructuredContent(version) {
    return !version || version >= FIRST_STRUCTURED_VERSION;
}

function serverCapabilities(listChanged) {
    return { tools: { listChanged }, logging: {} };
}

// Decides how a request is served: per-request metadata (2026-07-28) or the
// session negotiated by initialize (2025-11-25 and earlier).
function classifyRequest(message, session) {
    const params = isPlainObject(message.params) ? message.params : {};
    const meta = isPlainObject(params._meta) ? params._meta : {};
    const requested = meta[META.protocolVersion];
    if (message.method === "initialize") return { version: null, modern: false };
    if (requested !== undefined) {
        if (MODERN_PROTOCOL_VERSIONS.includes(requested)) return modernRequest(meta, requested);
        if (session.legacyVersion) return { version: session.legacyVersion, modern: false };
        throw new RpcError(RPC_ERROR.unsupportedProtocolVersion, "Unsupported protocol version", {
            supported: SUPPORTED_PROTOCOL_VERSIONS,
            requested
        });
    }
    if (session.legacyVersion) return { version: session.legacyVersion, modern: false };
    if (message.method === "ping") return { version: null, modern: false };
    throw new RpcError(
        RPC_ERROR.invalidParams,
        `Missing _meta["${META.protocolVersion}"]: send initialize first (MCP 2025-11-25 and earlier) or include the per-request _meta of MCP 2026-07-28.`
    );
}

function modernRequest(meta, version) {
    if (!isPlainObject(meta[META.clientCapabilities])) {
        throw new RpcError(RPC_ERROR.invalidParams, `Missing _meta["${META.clientCapabilities}"], required by MCP ${version}.`);
    }
    const logLevel = meta[META.logLevel];
    if (logLevel !== undefined && !LOG_LEVELS.includes(logLevel)) {
        throw new RpcError(RPC_ERROR.invalidParams, `Unknown log level in _meta["${META.logLevel}"]: ${logLevel}`);
    }
    return { version, modern: true, logLevel: logLevel ?? null };
}

async function handleRequest(message, context) {
    const route = classifyRequest(message, context.session);
    const env = { ...context, ...route, decorate: MODERN_PROTOCOL_VERSIONS.includes(route.version) };
    const params = isPlainObject(message.params) ? message.params : {};
    const result = await dispatch(message.method, params, env);
    if (!env.decorate) return result;
    return {
        resultType: "complete",
        ...result,
        _meta: { ...(isPlainObject(result._meta) ? result._meta : {}), [META.serverInfo]: SERVER_INFO }
    };
}

async function dispatch(method, params, env) {
    switch (method) {
        case "initialize": return initialize(params, env);
        case "server/discover": return discover();
        case "ping": return {};
        case "tools/list": return listTools(env);
        case "tools/call": return callTool(params, env);
        case "logging/setLevel":
            if (!env.modern) return setLogLevel(params, env);
            break;
        default:
            break;
    }
    throw new RpcError(RPC_ERROR.methodNotFound, `Method not found: ${method}`);
}

function initialize(params, env) {
    const requested = params.protocolVersion;
    // Unknown versions get the newest handshake-based revision.
    const version = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : LEGACY_PROTOCOL_VERSIONS[0];
    env.session.legacyVersion = version;
    env.session.legacyLogLevel = null;
    return {
        protocolVersion: version,
        capabilities: serverCapabilities(env.session.transport === "stdio"),
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS
    };
}

function discover() {
    return {
        supportedVersions: SUPPORTED_PROTOCOL_VERSIONS,
        capabilities: serverCapabilities(false),
        instructions: INSTRUCTIONS,
        ttlMs: DISCOVER_TTL_MS,
        cacheScope: "public"
    };
}

function setLogLevel(params, env) {
    if (!LOG_LEVELS.includes(params.level)) {
        throw new RpcError(RPC_ERROR.invalidParams, `level must be one of: ${LOG_LEVELS.join(", ")}`);
    }
    env.session.legacyLogLevel = params.level;
    return {};
}

function toolDefinition(tool, version) {
    const definition = { name: tool.name, title: tool.title, description: tool.description, inputSchema: tool.inputSchema };
    if (supportsStructuredContent(version)) definition.outputSchema = tool.outputSchema;
    definition.annotations = tool.annotations;
    return definition;
}

async function listTools(env) {
    const scopes = await env.account.scopesForListing();
    const tools = visibleTools(scopes);
    env.account.listedToolNames = tools.map(tool => tool.name).join(",");
    const result = { tools: tools.map(tool => toolDefinition(tool, env.version)) };
    // The list depends on the key's scopes, so it is private to the key.
    if (env.decorate) Object.assign(result, { ttlMs: TOOL_LIST_TTL_MS, cacheScope: "private" });
    return result;
}

// Sends notifications/message only when the client asked for log messages: per request in
// 2026-07-28 (_meta logLevel), per session with logging/setLevel before that.
function emitLog(env, level, data) {
    const threshold = env.modern ? env.logLevel : env.session.legacyLogLevel;
    if (!threshold || !env.notify) return false;
    if (LOG_LEVELS.indexOf(level) < LOG_LEVELS.indexOf(threshold)) return false;
    env.notify({ jsonrpc: "2.0", method: "notifications/message", params: { level, logger: SERVER_NAME, data } });
    return true;
}

async function callTool(params, env) {
    const tool = typeof params.name === "string" ? TOOL_INDEX.get(params.name) : undefined;
    if (!tool) throw new RpcError(RPC_ERROR.invalidParams, `Unknown tool: ${params.name}`);
    // A client that cached an older tool list may still call these: answer without contacting the API.
    if (tool.feature && !PREVIEW_TOOLS) return notAvailableResult(tool);
    const args = params.arguments === undefined ? {} : params.arguments;
    if (!isPlainObject(args)) throw new RpcError(RPC_ERROR.invalidParams, "Tool arguments must be a JSON object.");
    try {
        const problem = validateAgainstSchema(tool.inputSchema, args);
        if (problem) throw new ToolInputError(problem);
        const context = {
            api: env.account.requireApi(),
            account: env.account,
            signal: env.signal,
            log: (level, data) => emitLog(env, level, data)
        };
        const outcome = await tool.handler(args, context);
        return successResult(tool, outcome, env);
    } catch (error) {
        if (env.signal?.aborted) throw error;
        return { content: [{ type: "text", text: describeFailure(tool, error) }], isError: true };
    }
}

function successResult(tool, { data, summary, text }, env) {
    const note = rateLimitNote(env.account.api);
    const fullSummary = note ? `${summary} ${note}` : summary;
    const content = [{ type: "text", text: text ? `${fullSummary}\n\n${text}` : fullSummary }];
    if (!supportsStructuredContent(env.version)) return { content };
    // Some clients show the model only structuredContent, so it carries the summary too.
    const structuredContent = { summary: fullSummary, ...data };
    checkOutput(tool, structuredContent);
    return { content, structuredContent };
}

function checkOutput(tool, value) {
    const problem = validateAgainstSchema(tool.outputSchema, value, "structuredContent");
    if (!problem) return;
    if (STRICT_OUTPUT) throw new Error(`${tool.name} returned data that does not match its outputSchema: ${problem}`);
    log(`warning: ${tool.name} returned data that does not match its outputSchema (${problem}); the Agent API may have changed.`);
}

function describeFailure(tool, error) {
    if (error instanceof ToolInputError) return `Invalid input for ${tool.name}: ${error.message}`;
    if (error instanceof ApiError && error.code === "endpoint_disabled" && tool.feature) {
        log(`${tool.name}: ${error.status} endpoint_disabled${error.requestId ? ` (${error.requestId})` : ""}`);
        return NOT_AVAILABLE[tool.feature];
    }
    if (error instanceof ApiError) {
        log(`${tool.name}: ${error.status || "no response"} ${error.code}${error.requestId ? ` (${error.requestId})` : ""}`);
        return describeApiError(error);
    }
    if (error instanceof ConfigError || error instanceof RefusedError) return error.message;
    log(`${tool.name} failed unexpectedly: ${error?.stack || error}`);
    return `${tool.name} failed unexpectedly: ${error?.message || error}`;
}

function rpcError(id, code, message, data) {
    return { jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } };
}

function rpcErrorFor(id, error) {
    if (error instanceof RpcError) return rpcError(id, error.code, error.message, error.data);
    log(`internal error: ${error?.stack || error}`);
    return rpcError(id, RPC_ERROR.internalError, "Internal error");
}

function isValidId(id) {
    return typeof id === "string" || (typeof id === "number" && Number.isFinite(id));
}

// ---------------------------------------------------------------------------
// stdio transport

function startStdio(config) {
    const session = createSession("stdio");
    const account = new AccountContext(config);
    const inFlight = new Map();
    const write = message => process.stdout.write(`${JSON.stringify(message)}\n`);

    account.onToolListChanged = () => {
        if (session.legacyVersion) write({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
    };

    function receiveNotification(message) {
        if (message.method === "notifications/cancelled") {
            inFlight.get(message.params?.requestId)?.abort(new Error("cancelled by the client"));
        }
        // notifications/initialized and any other notification need no action.
    }

    function receiveRequest(message) {
        const controller = new AbortController();
        inFlight.set(message.id, controller);
        const notify = notification => {
            if (!controller.signal.aborted) write(notification);
        };
        handleRequest(message, { session, account, signal: controller.signal, notify })
            .then(result => {
                if (!controller.signal.aborted) write({ jsonrpc: "2.0", id: message.id, result });
            })
            .catch(error => {
                if (!controller.signal.aborted) write(rpcErrorFor(message.id, error));
            })
            .finally(() => inFlight.delete(message.id));
    }

    function receive(message) {
        if (!isPlainObject(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
            // Responses to requests this server never sends, or malformed input.
            if (isPlainObject(message) && isValidId(message.id) && !hasOwn(message, "result") && !hasOwn(message, "error")) {
                write(rpcError(message.id, RPC_ERROR.invalidRequest, "Invalid Request"));
            }
            return;
        }
        if (!hasOwn(message, "id")) {
            receiveNotification(message);
            return;
        }
        if (!isValidId(message.id)) {
            write(rpcError(null, RPC_ERROR.invalidRequest, "Invalid Request: id must be a string or a number."));
            return;
        }
        receiveRequest(message);
    }

    const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
    lines.on("line", line => {
        const text = line.trim();
        if (!text) return;
        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch {
            write(rpcError(null, RPC_ERROR.parseError, "Parse error"));
            return;
        }
        for (const message of Array.isArray(parsed) ? parsed : [parsed]) receive(message);
    });
    lines.on("close", () => {
        // The client closed stdin: stop all work and let Node exit once the event loop is idle.
        // Calling process.exit() right away can abort Node on Windows while background work is
        // still being torn down, so it is only a fallback.
        for (const controller of inFlight.values()) controller.abort(new Error("the client closed the connection"));
        setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS).unref();
    });
}

// ---------------------------------------------------------------------------
// Streamable HTTP transport (optional): POST /mcp on 127.0.0.1, JSON responses,
// no sessions and no SSE streams. Each request authenticates with its own key.

const HTTP_HOST = "127.0.0.1";

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function sendJson(res, status, body, headers = {}) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
    res.end(JSON.stringify(body));
}

function originAllowed(origin) {
    if (origin === undefined) return true;
    try {
        return isLoopbackHost(new URL(origin).hostname);
    } catch {
        return false;
    }
}

function hostAllowed(host) {
    if (!host) return false;
    try {
        return isLoopbackHost(new URL(`http://${host}`).hostname);
    } catch {
        return false;
    }
}

function bearerKey(header) {
    const match = /^Bearer\s+(\S+)\s*$/i.exec(header || "");
    return match && API_KEY_PATTERN.test(match[1]) ? match[1] : null;
}

function decodeHeaderValue(value) {
    const match = /^=\?base64\?(.*)\?=$/.exec(value || "");
    return match ? Buffer.from(match[1], "base64").toString("utf8") : value;
}

async function readRequestBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > HTTP_BODY_MAX_BYTES) throw new HttpError(413, "Request body too large.");
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
}

function isModernMessage(message) {
    return isPlainObject(message.params) && isPlainObject(message.params._meta) &&
        message.params._meta[META.protocolVersion] !== undefined;
}

// 2026-07-28: the MCP-Protocol-Version, Mcp-Method and Mcp-Name headers must match the body.
function headerMismatch(req, message) {
    const bodyVersion = message.params._meta[META.protocolVersion];
    if (!MODERN_PROTOCOL_VERSIONS.includes(bodyVersion)) return null;
    const headerVersion = req.headers["mcp-protocol-version"];
    if (headerVersion !== bodyVersion) {
        return `MCP-Protocol-Version header (${headerVersion ?? "missing"}) does not match the body's protocol version (${bodyVersion}).`;
    }
    const methodHeader = req.headers["mcp-method"];
    if (methodHeader !== message.method) {
        return `Mcp-Method header (${methodHeader ?? "missing"}) does not match the body method (${message.method}).`;
    }
    if (message.method === "tools/call") {
        const nameHeader = decodeHeaderValue(req.headers["mcp-name"]);
        if (nameHeader !== message.params.name) {
            return `Mcp-Name header (${nameHeader ?? "missing"}) does not match the tool name (${message.params.name}).`;
        }
    }
    return null;
}

function httpSession(req, message) {
    const session = createSession("http");
    if (isModernMessage(message) || message.method === "initialize") return session;
    const header = req.headers["mcp-protocol-version"];
    if (header === undefined) {
        session.legacyVersion = HTTP_DEFAULT_LEGACY_VERSION;
    } else if (LEGACY_PROTOCOL_VERSIONS.includes(header)) {
        session.legacyVersion = header;
    } else if (!MODERN_PROTOCOL_VERSIONS.includes(header)) {
        throw new RpcError(RPC_ERROR.invalidRequest, `Unsupported MCP-Protocol-Version: ${header}`, { supported: SUPPORTED_PROTOCOL_VERSIONS }, 400);
    }
    return session;
}

function httpStatusFor(error, modern) {
    if (!(error instanceof RpcError)) return 500;
    if (error.httpStatus) return error.httpStatus;
    if (error.code === RPC_ERROR.internalError) return 500;
    if (error.code === RPC_ERROR.methodNotFound) return modern ? 404 : 200;
    return modern ? 400 : 200;
}

function accountForKey(accounts, config, key) {
    const id = createHash("sha256").update(key).digest("hex");
    let account = accounts.get(id);
    if (!account) {
        account = new AccountContext({ apiKey: key, apiBase: config.apiBase, apiBaseProblem: config.apiBaseProblem });
        accounts.set(id, account);
        if (accounts.size > HTTP_ACCOUNT_CACHE_MAX) accounts.delete(accounts.keys().next().value);
    }
    return account;
}

async function serveHttp(req, res, config, accounts) {
    const path = new URL(req.url || "/", "http://localhost").pathname;
    if (path !== HTTP_PATH) return sendJson(res, 404, { error: `Not found. The MCP endpoint is ${HTTP_PATH}.` });
    if (!originAllowed(req.headers.origin) || !hostAllowed(req.headers.host)) {
        return sendJson(res, 403, rpcError(null, RPC_ERROR.invalidRequest, "Forbidden: only local clients may use this server."));
    }
    if (req.method !== "POST") {
        return sendJson(res, 405, rpcError(null, RPC_ERROR.invalidRequest, "Method not allowed: send JSON-RPC messages with POST."), { Allow: "POST" });
    }
    const key = bearerKey(req.headers.authorization);
    if (!key) {
        return sendJson(res, 401, rpcError(null, RPC_ERROR.invalidRequest,
            `Send your Microstock+ agent key as "Authorization: Bearer mpk_live_..." (create one at ${KEYS_PAGE_URL}).`),
        { "WWW-Authenticate": 'Bearer realm="microstock-plus"' });
    }
    if (!/^application\/json\b/i.test(req.headers["content-type"] || "")) {
        return sendJson(res, 415, rpcError(null, RPC_ERROR.invalidRequest, "Content-Type must be application/json."));
    }
    const message = parseJson(await readRequestBody(req));
    if (message === undefined) return sendJson(res, 400, rpcError(null, RPC_ERROR.parseError, "Parse error"));
    if (!isPlainObject(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
        return sendJson(res, 400, rpcError(null, RPC_ERROR.invalidRequest, "Invalid Request: send one JSON-RPC 2.0 request or notification per POST."));
    }
    if (!hasOwn(message, "id")) {
        res.writeHead(202).end();
        return undefined;
    }
    if (!isValidId(message.id)) return sendJson(res, 400, rpcError(null, RPC_ERROR.invalidRequest, "Invalid Request: id must be a string or a number."));
    return answerHttpRequest(req, res, message, accountForKey(accounts, config, key));
}

async function answerHttpRequest(req, res, message, account) {
    const modern = isModernMessage(message);
    const mismatch = modern ? headerMismatch(req, message) : null;
    if (mismatch) return sendJson(res, 400, rpcError(message.id, RPC_ERROR.headerMismatch, `Header mismatch: ${mismatch}`));
    const controller = new AbortController();
    res.on("close", () => {
        if (!res.writableFinished) controller.abort(new Error("the client closed the connection"));
    });
    try {
        const session = httpSession(req, message);
        const result = await handleRequest(message, { session, account, signal: controller.signal, notify: null });
        if (!controller.signal.aborted) sendJson(res, 200, { jsonrpc: "2.0", id: message.id, result });
    } catch (error) {
        if (!controller.signal.aborted) sendJson(res, httpStatusFor(error, modern), rpcErrorFor(message.id, error));
    }
    return undefined;
}

function startHttp(config, port) {
    const accounts = new Map();
    const server = createServer((req, res) => {
        serveHttp(req, res, config, accounts).catch(error => {
            const status = error instanceof HttpError ? error.status : 500;
            if (status === 500) log(`HTTP request failed: ${error?.stack || error}`);
            if (!res.headersSent) sendJson(res, status, rpcError(null, status === 500 ? RPC_ERROR.internalError : RPC_ERROR.invalidRequest, error.message));
            else res.end();
        });
    });
    server.on("error", error => {
        log(`HTTP server error: ${error?.message || error}`);
        process.exit(1);
    });
    server.listen(port, HTTP_HOST, () => {
        log(`${SERVER_TITLE} MCP server ${SERVER_VERSION}: Streamable HTTP at http://${HTTP_HOST}:${server.address().port}${HTTP_PATH}`);
        log(`each request must send its own agent key as "Authorization: Bearer mpk_live_..."; API ${config.apiBase || "(invalid MPLUS_API_BASE)"}`);
        if (config.apiKey) log("MPLUS_API_KEY is not used in HTTP mode.");
    });
    return server;
}

// ---------------------------------------------------------------------------
// Command line

const HELP_TEXT = `${SERVER_TITLE} MCP server ${SERVER_VERSION}

Usage:
  node mplus-mcp.mjs              Serve MCP over stdio (Claude Code, Claude Desktop, Cursor, Codex, ...)
  node mplus-mcp.mjs --http PORT  Serve MCP over Streamable HTTP at http://127.0.0.1:PORT/mcp
  node mplus-mcp.mjs --dump-tools Print the portable remote-gateway tool catalogue as JSON
  node mplus-mcp.mjs --version | --help

Environment:
  MPLUS_API_KEY    Microstock+ agent key (mpk_live_...), required for stdio.
                   Create one at ${KEYS_PAGE_URL} (section "Agent keys").
  MPLUS_API_BASE   Agent API base URL. Default ${DEFAULT_API_BASE}
  MPLUS_MCP_DEBUG  1 logs every API request (method, path, status) to stderr.
In HTTP mode each request sends its own key as "Authorization: Bearer mpk_live_...".
Nothing can be deleted through this server; deleting is done in the Microstock+ web interface.
`;

function parseArgs(argv) {
    const options = {};
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === "--help" || arg === "-h") options.help = true;
        else if (arg === "--version" || arg === "-v") options.version = true;
        else if (arg === "--dump-tools") options.dumpTools = true;
        else if (arg === "--http") {
            const port = Number(argv[index + 1]);
            if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--http needs a port number (0-65535).");
            options.httpPort = port;
            index += 1;
        } else {
            throw new Error(`Unknown argument: ${arg}. Run with --help for usage.`);
        }
    }
    return options;
}

function announce(config) {
    const problem = config.apiBaseProblem || config.apiKeyProblem;
    if (problem) log(`warning: ${problem}`);
    else if (!config.apiKey) log(`warning: no agent key configured; tools will explain how to add one (${KEYS_PAGE_URL}).`);
    const key = config.apiKey ? `key prefix ${keyPrefix(config.apiKey)}` : "no key";
    log(`${SERVER_TITLE} MCP server ${SERVER_VERSION} on stdio; API ${config.apiBase || "(invalid)"}; ${key}.`);
    if (PREVIEW_TOOLS) log("preview tools are on (MPLUS_ENABLE_PREVIEW_TOOLS): status changes and AI keywording tools are offered.");
}

function main(argv) {
    let options;
    try {
        options = parseArgs(argv);
    } catch (error) {
        log(error.message);
        process.exit(2);
    }
    if (options.help) {
        process.stdout.write(HELP_TEXT);
        return;
    }
    if (options.version) {
        process.stdout.write(`${SERVER_VERSION}\n`);
        return;
    }
    if (options.dumpTools) {
        process.stdout.write(`${JSON.stringify(portableToolCatalogue(), null, 2)}\n`);
        return;
    }
    const config = readConfig(process.env);
    if (options.httpPort !== undefined) {
        startHttp(config, options.httpPort);
        return;
    }
    announce(config);
    startStdio(config);
}

process.on("unhandledRejection", error => log(`unhandled rejection: ${error?.stack || error}`));
main(process.argv.slice(2));

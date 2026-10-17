// Smoke test for the Microstock+ MCP server. It starts the in-memory Agent API mock,
// runs server/mplus-mcp.mjs against it over stdio (MCP 2025-11-25, 2025-03-26 and the
// stateless 2026-07-28) and over Streamable HTTP, and exercises every tool, the safety
// guards and the error paths. It also checks the plugin manifests and the OpenAPI file.
//
// Run from the repository root:  node tests/smoke-test.mjs
// Built-in modules only; it talks to 127.0.0.1 and nothing else.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import { ALL_SCOPES, DEFAULT_SCOPES, startMockApi } from "./mock-api.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_PATH = path.join(ROOT, "server", "mplus-mcp.mjs");
const RUNTIME_VERSION = "1.4.0";
const STOCK_METADATA_PROMPT = readFileSync(path.join(ROOT, "docs", "STOCK_METADATA_SYSTEM_PROMPT.md"), "utf8").replace(/\r\n/g, "\n").trim();
const MODERN = "2026-07-28";
const IID = {
    leaves42: "6abc74e948864d403ea0c559",
    empty43: "6abc74e948864d403ea0c560",
    maple44: "6abc74e948864d403ea0c561",
    lighthouse: "6abc74e948864d403ea0c562",
    icons: "6abc74e948864d403ea0c563",
    drone: "6abc74e948864d403ea0c564",
    archived: "6abc74e948864d403ea0c565",
    aiCity: "6abc74e948864d403ea0c566"
};
const EXPECTED_TOOLS = [
    "mplus_create_folder", "mplus_export_csv", "mplus_get_account", "mplus_get_file", "mplus_get_job", "mplus_get_previews", "mplus_initialize_upload", "mplus_list_files", "mplus_list_folders",
    "mplus_quote_ai_keywording", "mplus_resolve_istock_terms", "mplus_run_ai_keywording", "mplus_set_istock_terms", "mplus_set_status", "mplus_update_metadata",
    "mplus_update_metadata_batch", "mplus_wait_for_events"
];
const WRITE_TOOLS = ["mplus_create_folder", "mplus_update_metadata", "mplus_update_metadata_batch", "mplus_initialize_upload", "mplus_set_status", "mplus_set_istock_terms"];
// Tools of features the shipping Agent API keeps switched off: offered only with MPLUS_ENABLE_PREVIEW_TOOLS=1.
const PREVIEW_TOOLS = ["mplus_get_job", "mplus_quote_ai_keywording", "mplus_run_ai_keywording"];
const AVAILABLE_TOOLS = EXPECTED_TOOLS.filter(name => !PREVIEW_TOOLS.includes(name));
const PREVIEW = { MPLUS_ENABLE_PREVIEW_TOOLS: "1" };
const DISABLED_FEATURES = ["ai_keywording", "event_stream"];

let checks = 0;
const clients = [];

function readJson(...parts) {
    return JSON.parse(readFileSync(path.join(ROOT, ...parts), "utf8"));
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function check(name, fn) {
    await fn();
    checks += 1;
    console.log(`ok  ${name}`);
}

// The developer's own environment must not leak a real key or another API base into the test.
function cleanEnv(extra) {
    const env = { ...process.env };
    for (const name of ["MPLUS_API_KEY", "MPLUS_API_BASE", "CLAUDE_PLUGIN_OPTION_API_KEY", "MPLUS_MCP_DEBUG", "MPLUS_ENABLE_PREVIEW_TOOLS"]) delete env[name];
    return { ...env, MPLUS_MCP_STRICT_OUTPUT: "1", ...extra };
}

class McpClient {
    constructor(label, env, args = []) {
        this.label = label;
        this.pending = new Map();
        this.notifications = [];
        this.stderr = "";
        this.nextId = 1;
        this.child = spawn(process.execPath, [SERVER_PATH, ...args], { env: cleanEnv(env), stdio: ["pipe", "pipe", "pipe"] });
        this.child.stderr.setEncoding("utf8").on("data", chunk => {
            this.stderr += chunk;
        });
        this.exited = new Promise(resolve => this.child.once("exit", resolve));
        createInterface({ input: this.child.stdout }).on("line", line => this.receive(line));
        clients.push(this);
    }

    receive(line) {
        const message = JSON.parse(line);
        const isResponse = Object.hasOwn(message, "result") || Object.hasOwn(message, "error");
        const waiter = isResponse ? this.pending.get(message.id) : undefined;
        if (waiter) {
            this.pending.delete(message.id);
            waiter(message);
        } else if (!isResponse) {
            this.notifications.push(message);
        } else {
            throw new Error(`${this.label}: unexpected response ${line}`);
        }
    }

    send(message) {
        this.child.stdin.write(`${JSON.stringify(message)}\n`);
    }

    sendRaw(line) {
        this.child.stdin.write(`${line}\n`);
    }

    request(method, params, { id = this.nextId++, timeoutMs = 20_000 } = {}) {
        this.send({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
        return this.response(id, method, timeoutMs);
    }

    response(id, what = "request", timeoutMs = 20_000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`${this.label}: ${what} (id ${id}) got no response within ${timeoutMs} ms`));
            }, timeoutMs);
            this.pending.set(id, message => {
                clearTimeout(timer);
                resolve(message);
            });
        });
    }

    notify(method, params) {
        this.send({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
    }

    async close() {
        this.child.stdin.end();
        await Promise.race([this.exited, delay(3000)]);
        if (this.child.exitCode === null) this.child.kill();
    }
}

async function legacyClient(label, env, protocolVersion = "2025-11-25") {
    const client = new McpClient(label, env);
    const init = await client.request("initialize", {
        protocolVersion,
        capabilities: {},
        clientInfo: { name: "smoke-test", version: "1.0.0" }
    });
    assert.ok(init.result, `${label}: initialize failed: ${JSON.stringify(init.error)}`);
    client.notify("notifications/initialized");
    return { client, init: init.result };
}

function modernMeta(extra = {}) {
    return {
        "io.modelcontextprotocol/protocolVersion": MODERN,
        "io.modelcontextprotocol/clientCapabilities": {},
        "io.modelcontextprotocol/clientInfo": { name: "smoke-test", version: "1.0.0" },
        ...extra
    };
}

async function callTool(client, name, args = {}, extraParams = {}) {
    const response = await client.request("tools/call", { name, arguments: args, ...extraParams }, { timeoutMs: 40_000 });
    assert.ok(!response.error, `${name}: JSON-RPC error ${JSON.stringify(response.error)}`);
    return response.result;
}

function textOf(result) {
    return result.content.filter(block => block.type === "text").map(block => block.text).join("\n");
}

function expectOk(result, name) {
    assert.ok(!result.isError, `${name} failed: ${textOf(result)}`);
    assert.ok(result.structuredContent, `${name}: no structuredContent`);
    assert.equal(typeof result.structuredContent.summary, "string", `${name}: no summary`);
    assert.ok(textOf(result).startsWith(result.structuredContent.summary), `${name}: text block does not start with the summary`);
    return result.structuredContent;
}

function expectToolError(result, pattern, name) {
    assert.equal(result.isError, true, `${name} should have failed but returned: ${textOf(result)}`);
    assert.equal(result.structuredContent, undefined, `${name}: error results must not carry structuredContent`);
    assert.match(textOf(result), pattern, `${name}: unexpected error text`);
}

function rawHttp(port, { method = "POST", headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
        const payload = body === undefined ? undefined : JSON.stringify(body);
        const req = httpRequest({
            host: "127.0.0.1",
            port,
            path: "/mcp",
            method,
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json, text/event-stream",
                ...(payload === undefined ? {} : { "Content-Length": Buffer.byteLength(payload) }),
                ...headers
            }
        }, res => {
            let text = "";
            res.setEncoding("utf8");
            res.on("data", chunk => {
                text += chunk;
            });
            res.on("end", () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
        });
        req.on("error", reject);
        if (payload !== undefined) req.write(payload);
        req.end();
    });
}

async function waitFor(condition, what, timeoutMs = 5000) {
    const started = Date.now();
    for (;;) {
        const value = await condition();
        if (value) return value;
        if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`);
        await delay(50);
    }
}

// ---------------------------------------------------------------------------

async function legacySuite(mock, runtimeVersion) {
    const { client, init } = await legacyClient("full-key", { MPLUS_API_BASE: mock.baseUrl, MPLUS_API_KEY: mock.keys.full, ...PREVIEW });

    await check("initialize (2025-11-25): version, identity, capabilities, instructions", async () => {
        assert.equal(init.protocolVersion, "2025-11-25");
        assert.equal(init.serverInfo.name, "microstock-plus");
        assert.equal(init.serverInfo.version, runtimeVersion, "server runtime version");
        assert.ok(init.capabilities.tools);
        assert.ok(init.capabilities.logging);
        assert.match(init.instructions, /Nothing can be deleted/);
        assert.match(init.instructions, /web interface/);
        assert.match(init.instructions, /dry_run=true first/);
        assert.ok(init.instructions.includes(STOCK_METADATA_PROMPT), "initialize must expose the canonical stock metadata prompt verbatim");
    });

    await check("tools/list with MPLUS_ENABLE_PREVIEW_TOOLS=1: the 16 contract tools with schemas and annotations, nothing that deletes", async () => {
        const { result } = await client.request("tools/list", {});
        const tools = result.tools;
        assert.deepEqual(tools.map(tool => tool.name).sort(), EXPECTED_TOOLS);
        for (const tool of tools) {
            assert.equal(tool.inputSchema.type, "object", tool.name);
            assert.equal(tool.inputSchema.additionalProperties, false, `${tool.name} input must be strict`);
            assert.equal(tool.outputSchema.type, "object", tool.name);
            assert.ok(tool.outputSchema.required.includes("summary"), tool.name);
            assert.ok(tool.annotations.title && tool.title && tool.description.length > 80, tool.name);
            assert.doesNotMatch(tool.name, /delet|remov|trash|purge|destroy/i);
            if (WRITE_TOOLS.includes(tool.name)) {
                assert.equal(tool.annotations.readOnlyHint, false, tool.name);
                assert.equal(tool.annotations.destructiveHint, false, tool.name);
                assert.equal(tool.annotations.idempotentHint, true, tool.name);
            } else if (tool.name === "mplus_run_ai_keywording") {
                assert.equal(tool.annotations.readOnlyHint, false);
                assert.match(tool.description, /^PAID/);
                assert.ok(tool.inputSchema.required.includes("confirm_charge_eur"));
            } else {
                assert.equal(tool.annotations.readOnlyHint, true, `${tool.name} must be read-only`);
            }
        }
    });

    await check("mplus_get_account: account, agencies and the key's scopes", async () => {
        const account = expectOk(await callTool(client, "mplus_get_account"), "mplus_get_account");
        assert.equal(account.object, "account");
        assert.ok(account.key.scopes.includes("ai:run"));
        assert.ok(account.agencies.some(agency => agency.id === "adobestock"));
        assert.match(account.summary, /Adobe Stock \(adobestock\)/);
        assert.match(account.summary, /run paid AI keywording/);
    });

    await check("mplus_list_folders: tree without archived folders; archived=true lists them", async () => {
        const active = expectOk(await callTool(client, "mplus_list_folders"), "mplus_list_folders");
        const paths = active.data.map(folder => folder.path);
        assert.ok(paths.includes("/foto/2026/autumn"));
        assert.ok(!paths.includes("/archive/2019"));
        const autumn = active.data.find(folder => folder.path === "/foto/2026/autumn");
        assert.equal(autumn.file_count, 3);
        assert.equal(autumn.status_summary.shutterstock.ready, 3);
        const archived = expectOk(await callTool(client, "mplus_list_folders", { archived: true }), "archived folders");
        assert.ok(archived.data.some(folder => folder.path === "/archive/2019"));
    });

    await check("mplus_list_files: filters, pagination with cursor, descriptions only on request", async () => {
        const missing = expectOk(await callTool(client, "mplus_list_files", {
            folder: "/foto/2026", recursive: true, missing: ["keywords"]
        }), "missing keywords");
        assert.deepEqual(missing.data.map(file => file.iid), [IID.empty43]);
        assert.equal(missing.data[0].metadata.description, undefined, "description must be left out without expand_metadata");

        const few = expectOk(await callTool(client, "mplus_list_files", { recursive: true, max_keywords: 6 }), "max_keywords");
        assert.deepEqual(few.data.map(file => file.iid).sort(), [IID.leaves42, IID.empty43]);

        const ready = expectOk(await callTool(client, "mplus_list_files", {
            recursive: true, agency: "shutterstock", status: "ready", expand_metadata: true
        }), "agency status");
        assert.ok(ready.data.some(file => file.iid === IID.leaves42));
        assert.equal(typeof ready.data.find(file => file.iid === IID.leaves42).metadata.description, "string");

        const page1 = expectOk(await callTool(client, "mplus_list_files", { recursive: true, limit: 2 }), "page 1");
        assert.equal(page1.has_more, true);
        assert.ok(page1.next_cursor);
        assert.match(page1.summary, /cursor "/);
        const page2 = expectOk(await callTool(client, "mplus_list_files", { recursive: true, limit: 2, cursor: page1.next_cursor }), "page 2");
        assert.equal(page2.data.length, 2);
        assert.ok(page2.data.every(file => !page1.data.some(other => other.iid === file.iid)), "pages must not overlap");
        assert.ok(page2.data.every(file => file.preview_url === null || file.preview_url.includes("/api/agent/v1/previews/")), "list preview links must use the canonical API route");
        assert.doesNotMatch(JSON.stringify(page2), /mock\.microstock\.plus\/(?:previews|thumbs)/, "raw preview hosts must not reach MCP output");

        const previews = await callTool(client, "mplus_get_previews", { iids: page2.data.map(file => file.iid) });
        const previewManifest = expectOk(previews, "second page previews");
        assert.deepEqual(previewManifest.previews.map(item => item.iid), page2.data.map(file => file.iid), "preview order follows requested iids");
        assert.ok(previews.content.some(block => block.type === "image" && block.mimeType === "image/png"), "native image block missing");
        assert.doesNotMatch(JSON.stringify(previewManifest), /data_base64|iVBORw0/, "structured output must not duplicate base64 bytes");

        const byIids = expectOk(await callTool(client, "mplus_list_files", { recursive: true, iids: [IID.drone, IID.icons] }), "iids");
        assert.deepEqual(byIids.data.map(file => file.iid).sort(), [IID.icons, IID.drone].sort());

        expectToolError(await callTool(client, "mplus_list_files", { status: "ready" }), /status needs agency/, "status without agency");
        expectToolError(await callTool(client, "mplus_list_files", { type: "gif" }), /Invalid input.*type must be one of/, "bad enum");
    });

    await check("mplus_get_file: full metadata, metaver and agency validation", async () => {
        const result = await callTool(client, "mplus_get_file", { iid: IID.leaves42 });
        const file = expectOk(result, "mplus_get_file");
        assert.equal(file.metaver, 1);
        assert.equal(file.preview, undefined, "get_file keeps the cached 1.2 DTO shape");
        assert.equal(file.preview_url, file.thumbnail_url);
        assert.match(file.preview_url, /\/api\/agent\/v1\/previews\/.+\/image$/);
        assert.ok(result.content.some(block => block.type === "image" && block.mimeType === "image/png"), "get_file must include the preview for cached tool connections");
        assert.doesNotMatch(JSON.stringify(file), /data_base64|iVBORw0/, "get_file structured output must not contain image bytes");
        assert.deepEqual(file.metadata.keywords, ["autumn", "forest", "road", "sunrise"]);
        assert.ok(file.agencies.shutterstock.validation.some(issue => issue.code === "keywords_min"));
        assert.match(file.summary, /if_match_metaver 1/);
        assert.match(textOf(result), /Keywords \(4\): autumn, forest, road, sunrise/);
        assert.match(textOf(result), /image block is attached.*fallback link expires/i);
        const processing = await callTool(client, "mplus_get_file", { iid: IID.empty43 });
        const processingFile = expectOk(processing, "processing preview file");
        assert.equal(processingFile.preview, undefined);
        assert.equal(processingFile.preview_url, null);
        assert.equal(processingFile.thumbnail_url, null);
        assert.equal(processing.content.some(block => block.type === "image"), false);
        assert.match(processingFile.summary, /No preview image is attached: preview_processing.*still being prepared/i);
        expectToolError(await callTool(client, "mplus_get_file", { iid: "ffffffffffffffffffffffff" }), /404, file_not_found/, "unknown iid");
        expectToolError(await callTool(client, "mplus_get_file", { iid: "../me" }), /Invalid input.*iid has an invalid format/, "path injection");
    });

    await check("mplus_get_previews: ordered native image blocks plus per-item processing errors", async () => {
        const result = await callTool(client, "mplus_get_previews", { iids: [IID.leaves42, IID.empty43], detail: "thumbnail" });
        const batch = expectOk(result, "mplus_get_previews");
        assert.deepEqual(batch.previews.map(item => [item.iid, item.state]), [[IID.leaves42, "ready"], [IID.empty43, "processing"]]);
        const images = result.content.filter(block => block.type === "image");
        assert.equal(images.length, 1);
        assert.match(batch.previews[0].preview_url, /\/api\/agent\/v1\/previews\/.+\/image$/);
        assert.equal(batch.previews[1].preview_url, undefined, "processing previews must not advertise a fetch URL");
        assert.deepEqual(Buffer.from(images[0].data, "base64").subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), "image block must carry actual PNG bytes");
        const labelIndex = result.content.findIndex(block => block.type === "text" && block.text === `Preview for iid ${IID.leaves42}:`);
        assert.equal(result.content[labelIndex + 1]?.type, "image", "each image must immediately follow its IID label");
        assert.match(textOf(result), new RegExp(`1\\. ${IID.leaves42}: ready[\\s\\S]*2\\. ${IID.empty43}: processing`));
        assert.match(textOf(result), /image blocks are attached.*fallback links expire/i);
    });

    await check("iStock terms: resolve offered ids, dry-run first, then save with metaver and signed candidate set", async () => {
        const resolution = expectOk(await callTool(client, "mplus_resolve_istock_terms", { iids: [IID.aiCity, IID.empty43] }), "resolve iStock terms");
        assert.deepEqual(resolution.files.map(file => file.state), ["ready", "pending"]);
        const file = resolution.files[0];
        assert.match(file.candidate_set_id, /^istk_[a-f0-9]{64}$/);
        assert.deepEqual(file.candidates.city1[0], { id: "1000", label: "city1 (primary meaning)" });
        const patch = { iid: file.iid, if_match_metaver: file.metaver, candidate_set_id: file.candidate_set_id, selections: { city1: ["1000"] } };
        const dry = expectOk(await callTool(client, "mplus_set_istock_terms", { dry_run: true, patches: [patch] }), "dry-run iStock terms");
        assert.equal(dry.results[0].dry_run, true);
        assert.deepEqual(dry.results[0].selections, patch.selections, "dry run returns the exact merged selections");
        assert.match(dry.summary, /Nothing was saved.*ask the user before saving/);
        const saved = expectOk(await callTool(client, "mplus_set_istock_terms", { dry_run: false, patches: [patch] }), "save iStock terms");
        assert.equal(saved.results[0].metaver, file.metaver + 1);
        assert.deepEqual(saved.results[0].selections, patch.selections, "save returns the exact merged selections");
        const writes = mock.requests.filter(entry => entry.path.endsWith("/files/istock-terms/batch"));
        assert.equal(writes.length, 2);
        assert.ok(writes.every(entry => /^[0-9a-f-]{36}$/.test(entry.idempotencyKey)), "term writes need idempotency keys");
        const bad = expectOk(await callTool(client, "mplus_set_istock_terms", { dry_run: true, patches: [{ ...patch, if_match_metaver: file.metaver + 1, candidate_set_id: `istk_${IID.aiCity.padEnd(64, "f")}` }] }), "stale candidate set");
        assert.equal(bad.results[0].error.code, "candidate_set_changed");
    });

    await check("mplus_update_metadata: merge patch with if_match_metaver, Idempotency-Key and User-Agent", async () => {
        const file = expectOk(await callTool(client, "mplus_update_metadata", {
            iid: IID.leaves42,
            if_match_metaver: 1,
            title: "Autumn forest road at sunrise, aerial view",
            keywords: { add: ["Fall", "leaves", "trees"] }
        }), "mplus_update_metadata");
        assert.equal(file.metaver, 2);
        assert.deepEqual(file.metadata.keywords, ["autumn", "forest", "road", "sunrise", "fall", "leaves", "trees"]);
        assert.ok(!file.agencies.shutterstock.validation.some(issue => issue.code === "keywords_min"));
        const patch = mock.requests.filter(entry => entry.method === "PATCH").at(-1);
        assert.match(patch.idempotencyKey, /^[0-9a-f-]{36}$/);
        assert.match(patch.userAgent, /^microstock-plus-mcp\/\d+\.\d+\.\d+$/);
        // My Files has no metadata-history undo: the summary tells the agent how to revert instead.
        assert.match(file.summary, /no undo button: to revert, write back the values you read/);
        assert.doesNotMatch(file.summary, /metadata history/);
    });

    await check("409 metadata_conflict: a stale metaver is refused and the current metaver is reported", async () => {
        const result = await callTool(client, "mplus_update_metadata", { iid: IID.leaves42, if_match_metaver: 1, notes: "late edit" });
        expectToolError(result, /409, metadata_conflict/, "stale metaver");
        assert.match(textOf(result), /now at metaver 2/);
        assert.match(textOf(result), /mplus_get_file/);
        assert.equal(mock.control.file(IID.leaves42).metadata.notes, null, "the stale edit must not be written");
    });

    await check("mplus_update_metadata: input guards (empty strings, commas, set+add, AI+editorial, unknown fields)", async () => {
        expectToolError(await callTool(client, "mplus_update_metadata", { iid: IID.leaves42, title: "" }), /title must not be empty/, "empty title");
        expectToolError(await callTool(client, "mplus_update_metadata", { iid: IID.leaves42, title: "   " }), /list the field in clear/, "blank title");
        expectToolError(await callTool(client, "mplus_update_metadata", { iid: IID.leaves42, keywords: { set: ["a, b"] } }), /without commas/, "comma keyword");
        expectToolError(await callTool(client, "mplus_update_metadata", { iid: IID.leaves42, keywords: { set: ["a"], add: ["b"] } }), /either set, or add/, "set and add");
        expectToolError(await callTool(client, "mplus_update_metadata", { iid: IID.leaves42, ai_generated: true, editorial: true }), /never editorial/, "AI editorial");
        expectToolError(await callTool(client, "mplus_update_metadata", { iid: IID.leaves42, color: "red" }), /unknown field "color"/, "unknown field");
        expectToolError(await callTool(client, "mplus_update_metadata", { iid: IID.leaves42 }), /at least one field/, "empty patch");
        expectToolError(await callTool(client, "mplus_update_metadata", { iid: IID.leaves42, title: "x", clear: ["title"] }), /both set and listed in clear/, "set and clear");
    });

    await check("mplus_update_metadata_batch: dry run writes nothing, apply writes, per-item failures", async () => {
        const items = [
            {
                iid: IID.empty43,
                if_match_metaver: 1,
                patch: {
                    title: "Wet autumn leaves on a wooden park bench",
                    description: "Close-up of wet autumn leaves on a wooden park bench after rain",
                    keywords: { set: ["autumn", "leaves", "bench", "park", "wet", "rain", "wooden", "season"] }
                }
            },
            { iid: IID.maple44, if_match_metaver: 0, patch: { keywords: { add: ["foliage"] } } },
            { iid: IID.icons, if_match_metaver: 1, patch: { keywords: { add: ["coffee"] }, clear: ["notes"] } }
        ];
        const dry = expectOk(await callTool(client, "mplus_update_metadata_batch", { items, dry_run: true }), "dry run");
        assert.equal(dry.succeeded, 2);
        assert.equal(dry.failed, 1);
        assert.equal(dry.results.find(result => result.iid === IID.maple44).error.code, "metadata_conflict");
        assert.equal(dry.results.find(result => result.iid === IID.empty43).file.metadata.title, "Wet autumn leaves on a wooden park bench");
        assert.match(dry.summary, /Dry run, nothing was written/);
        assert.equal(mock.control.file(IID.empty43).metaver, 1, "a dry run must not write");

        items[1].if_match_metaver = 1;
        const applied = expectOk(await callTool(client, "mplus_update_metadata_batch", { items, dry_run: false }), "apply");
        assert.equal(applied.succeeded, 3);
        assert.equal(mock.control.file(IID.empty43).metaver, 2);
        assert.ok(mock.control.file(IID.maple44).metadata.keywords.includes("foliage"));
        assert.match(applied.summary, /no undo button: to revert, write back the values you read/);
        assert.doesNotMatch(applied.summary, /metadata history/);

        expectToolError(await callTool(client, "mplus_update_metadata_batch", { items: [items[0], items[0]], dry_run: true }), /appears twice/, "duplicate iid");
        expectToolError(await callTool(client, "mplus_update_metadata_batch", { items }), /dry_run is required/, "dry_run required");
        const tooMany = Array.from({ length: 101 }, () => ({ iid: IID.icons, patch: { notes: "n" } }));
        expectToolError(await callTool(client, "mplus_update_metadata_batch", { items: tooMany, dry_run: true }), /at most 100 items/, "batch too large");
    });

    await check("mplus_set_status: queueing needs user_confirmed; per file/agency results (nosubmissions)", async () => {
        const before = mock.requests.filter(entry => entry.path.endsWith("/files/status:batch")).length;
        expectToolError(await callTool(client, "mplus_set_status", {
            iids: [IID.maple44], agency: "shutterstock", status: "queued"
        }), /Not queued.*user_confirmed=true/, "unconfirmed queue");
        assert.equal(mock.requests.filter(entry => entry.path.endsWith("/files/status:batch")).length, before, "nothing may be sent without confirmation");

        const queued = expectOk(await callTool(client, "mplus_set_status", {
            iids: [IID.maple44], agency: "shutterstock", status: "queued", user_confirmed: true
        }), "queue");
        assert.equal(queued.succeeded, 1);
        assert.equal(queued.results[0].previous_status, "ready");
        const pond5 = expectOk(await callTool(client, "mplus_set_status", {
            iids: [IID.maple44], agency: "pond5", status: "queued", user_confirmed: true
        }), "pond5 queue");
        assert.equal(pond5.results[0].error.code, "nosubmissions");

        const ignored = expectOk(await callTool(client, "mplus_set_status", {
            iids: [IID.icons], agency: "adobestock", status: "ignored"
        }), "ignore");
        assert.equal(ignored.results[0].status, "ignored");
        const disconnected = expectOk(await callTool(client, "mplus_set_status", {
            iids: [IID.icons], agency: "dreamstime", status: "ignored"
        }), "ignore disconnected");
        assert.equal(disconnected.results[0].error.code, "agency_not_connected");
        expectOk(await callTool(client, "mplus_set_status", { iids: [IID.icons], agency: "adobestock", status: "ready" }), "back to ready");
    });

    await check("mplus_wait_for_events: recent events, then the upload pipeline by cursor", async () => {
        const recent = expectOk(await callTool(client, "mplus_wait_for_events", { wait_seconds: 0 }), "recent events");
        assert.ok(recent.data.some(event => event.type === "file.metadata.updated"));
        assert.ok(recent.next_cursor);
        const submitted = await waitFor(async () => {
            const page = expectOk(await callTool(client, "mplus_wait_for_events", { types: ["file.submitted"], wait_seconds: 5 }), "submitted");
            return page.data.find(event => event.data.iids.includes(IID.maple44)) ? page : null;
        }, "file.submitted");
        assert.equal(submitted.data.at(-1).data.agency, "shutterstock");
    });

    await check("logging/setLevel + notifications/message for notable events (legacy)", async () => {
        const response = await client.request("logging/setLevel", { level: "info" });
        assert.deepEqual(response.result, {});
    });

    let jobId;
    await check("AI keywording: free quote, refused wrong amount, paid run, same job on repeat, progress", async () => {
        const cursor = expectOk(await callTool(client, "mplus_wait_for_events", { wait_seconds: 0 }), "cursor").next_cursor;
        const waiting = callTool(client, "mplus_wait_for_events", { cursor, types: ["ai.job.completed"], wait_seconds: 15 });

        const quote = expectOk(await callTool(client, "mplus_quote_ai_keywording", {
            iids: [IID.empty43, IID.maple44, IID.lighthouse], mode: "replace"
        }), "quote");
        assert.equal(quote.files, 3);
        assert.equal(quote.amount_eur, 0.09);
        assert.match(quote.summary, /Nothing has been charged/);
        assert.match(quote.summary, /confirm_charge_eur 0\.09/);

        expectToolError(await callTool(client, "mplus_run_ai_keywording", { quote_id: quote.quote_id, confirm_charge_eur: 0.1 }),
            /does not match the quoted €0\.09/, "wrong amount");
        expectToolError(await callTool(client, "mplus_run_ai_keywording", { quote_id: "q_unknown", confirm_charge_eur: 0.09 }),
            /was not created through this connection/, "unknown quote");
        assert.equal(mock.control.jobCount(), 0, "no job may start without a matching confirmation");

        const job = expectOk(await callTool(client, "mplus_run_ai_keywording", { quote_id: quote.quote_id, confirm_charge_eur: 0.09 }), "run");
        jobId = job.id;
        assert.equal(job.object, "job");
        const again = expectOk(await callTool(client, "mplus_run_ai_keywording", { quote_id: quote.quote_id, confirm_charge_eur: 0.09 }), "run again");
        assert.equal(again.id, job.id, "a repeated run must return the same job");
        assert.match(again.summary, /nothing was charged twice/);
        const runs = mock.requests.filter(entry => entry.path.endsWith("/ai/keywording:run"));
        assert.equal(runs.length, 2);
        assert.equal(runs[0].idempotencyKey, runs[1].idempotencyKey, "both runs must send the same Idempotency-Key");
        assert.equal(mock.control.jobCount(), 1);

        const completed = expectOk(await waiting, "wait for ai.job.completed");
        assert.equal(completed.data[0].data.job_id, job.id);
        const finished = expectOk(await callTool(client, "mplus_get_job", { job_id: job.id }), "mplus_get_job");
        assert.equal(finished.status, "completed");
        assert.equal(finished.files_done, 3);
        assert.equal(finished.amount_eur_charged, 0.09);
        assert.equal(mock.control.balance(), 24.91);
        const logged = client.notifications.filter(message => message.method === "notifications/message");
        assert.ok(logged.some(message => message.params.data.event === "ai.job.completed" && message.params.level === "notice"),
            "ai.job.completed must be logged once the client set a log level");
    });

    await check("AI keywording: an expired quote is refused by the API (409 quote_expired)", async () => {
        const quote = expectOk(await callTool(client, "mplus_quote_ai_keywording", { iids: [IID.drone], mode: "replace" }), "quote");
        mock.control.expireQuote(quote.quote_id);
        expectToolError(await callTool(client, "mplus_run_ai_keywording", { quote_id: quote.quote_id, confirm_charge_eur: quote.amount_eur }),
            /409, quote_expired.*new one/, "expired quote");
        expectToolError(await callTool(client, "mplus_get_job", { job_id: "job_missing" }), /404, job_not_found/, "unknown job");
        assert.ok(jobId);
    });

    await check("mplus_export_csv: folder export with the CSV inline; iids export with a link", async () => {
        const result = await callTool(client, "mplus_export_csv", { folder: "/foto/2026/autumn", format: "with_title", include_csv: true });
        const exported = expectOk(result, "export folder");
        assert.equal(exported.rows, 3);
        assert.ok(exported.download_url.startsWith(mock.baseUrl));
        assert.match(exported.csv, /^"filename","title","description","keywords"/);
        assert.match(exported.csv, /IMG_0042\.jpg/);
        assert.match(textOf(result), /IMG_0044\.jpg/);
        const alamy = expectOk(await callTool(client, "mplus_export_csv", { iids: [IID.icons], format: "alamy", delimiter: "semicolon" }), "export iids");
        assert.equal(alamy.rows, 1);
        assert.equal(alamy.csv, undefined);
        expectToolError(await callTool(client, "mplus_export_csv", { iids: [IID.icons], folder: "/vector" }), /either iids or folder/, "iids and folder");
        expectToolError(await callTool(client, "mplus_export_csv", { folder: "/nope" }), /404, folder_not_found/, "unknown folder");
    });

    await check("mplus_initialize_upload: returns a direct binary-transfer ticket and accepts no remote URL", async () => {
        const ticket = expectOk(await callTool(client, "mplus_initialize_upload", {
            filename: "fresh-image.jpg",
            size_bytes: 123456,
            content_type: "image/jpeg",
            directory: "/foto/2026"
        }), "initialize upload");
        assert.equal(ticket.object, "upload_ticket");
        assert.equal(ticket.upload.chunk.method, "POST");
        assert.equal(ticket.upload.chunk.file_field, "chunk");
        assert.equal(ticket.upload.chunk.form_fields.chunkNumber, "{chunk_number}");
        assert.ok(ticket.upload.chunk.url.startsWith(mock.baseUrl));
        assert.ok(ticket.upload.finish.url.startsWith(mock.baseUrl));
        expectToolError(await callTool(client, "mplus_initialize_upload", {
            filename: "fresh-image.jpg", size_bytes: 123456, content_type: "image/jpeg", directory: "/foto/2026",
            source_url: "https://example.test/file.jpg"
        }), /unknown field "source_url"/, "remote URL refused by schema");
        expectToolError(await callTool(client, "mplus_initialize_upload", {
            filename: "fresh-image.jpg", size_bytes: 123456, content_type: "image/jpeg", directory: "/missing"
        }), /folder_not_found/, "missing upload directory");
    });

    await check("mplus_create_folder: creates an owner folder for uploads and refuses missing parents", async () => {
        const folder = expectOk(await callTool(client, "mplus_create_folder", { directory: "/foto/2026/agent-upload" }), "create folder");
        assert.equal(folder.path, "/foto/2026/agent-upload");
        const listed = expectOk(await callTool(client, "mplus_list_folders", { path: "/foto/2026", recursive: true }), "list created folder");
        assert.ok(listed.data.some(item => item.path === "/foto/2026/agent-upload"));
        expectToolError(await callTool(client, "mplus_create_folder", { directory: "/missing/child" }), /folder_not_found/, "missing parent");
    });

    await check("429: one retry after Retry-After; a second 429 or a long wait becomes a tool error", async () => {
        mock.control.force429(1, 1);
        const started = Date.now();
        expectOk(await callTool(client, "mplus_get_file", { iid: IID.icons }), "retried get_file");
        assert.ok(Date.now() - started >= 900, "the retry must wait for Retry-After");
        assert.match(client.stderr, /rate limited on GET .*retrying once in 1 s/);

        mock.control.force429(2, 1);
        expectToolError(await callTool(client, "mplus_get_file", { iid: IID.icons }), /429, rate_limited.*Retry after 1 s/, "double 429");

        mock.control.force429(1, 60);
        const quick = Date.now();
        expectToolError(await callTool(client, "mplus_get_file", { iid: IID.icons }), /Retry after 60 s/, "long Retry-After");
        assert.ok(Date.now() - quick < 5000, "a long Retry-After must not be waited out");
    });

    await check("deletion: no delete tool exists, the API answers DELETE with 405, the server never sends DELETE", async () => {
        const unknown = await client.request("tools/call", { name: "mplus_delete_file", arguments: { iid: IID.icons } });
        assert.equal(unknown.error.code, -32602);
        assert.match(unknown.error.message, /Unknown tool/);
        const response = await fetch(`${mock.baseUrl}/files/${IID.icons}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${mock.keys.full}` }
        });
        assert.equal(response.status, 405);
        const body = await response.json();
        assert.equal(body.error.code, "deletion_not_supported");
        assert.equal(body.error.type, "permission_error");
        assert.equal(mock.requests.filter(entry => entry.method === "DELETE").length, 1, "only the test's own DELETE may reach the API");
    });

    await check("cancellation: a cancelled long poll gets no response", async () => {
        const id = "cancel-me";
        client.send({
            jsonrpc: "2.0", id, method: "tools/call",
            params: { name: "mplus_wait_for_events", arguments: { types: ["key.revoked"], wait_seconds: 25 } }
        });
        let answered = false;
        client.pending.set(id, () => {
            answered = true;
        });
        await delay(300);
        client.notify("notifications/cancelled", { requestId: id, reason: "test" });
        await delay(600);
        assert.equal(answered, false, "a cancelled request must not be answered");
        client.pending.delete(id);
    });

    await check("JSON-RPC: ping, unknown method, parse error, unknown tool", async () => {
        assert.deepEqual((await client.request("ping")).result, {});
        assert.equal((await client.request("resources/list", {})).error.code, -32601);
        const parseError = client.response(null, "parse error");
        client.sendRaw("this is not json");
        assert.equal((await parseError).error.code, -32700);
        assert.equal((await client.request("tools/call", { name: "nope", arguments: {} })).error.code, -32602);
    });

    await check("the agent key never appears in stderr; its prefix may", async () => {
        assert.ok(!client.stderr.includes(mock.keys.full), "the full key leaked to stderr");
        assert.ok(client.stderr.includes(mock.keys.full.slice(9, 17)), "the key prefix should be logged");
    });

    await client.close();
}

async function modernSuite(mock) {
    const client = new McpClient("modern", { MPLUS_API_BASE: mock.baseUrl, MPLUS_API_KEY: mock.keys.standard, ...PREVIEW });
    const meta = modernMeta();

    await check("2026-07-28: requests without _meta are rejected; server/discover works without initialize", async () => {
        const bare = await client.request("tools/list", {});
        assert.equal(bare.error.code, -32602);
        const { result } = await client.request("server/discover", { _meta: meta });
        assert.equal(result.resultType, "complete");
        assert.ok(result.supportedVersions.includes(MODERN));
        assert.ok(result.supportedVersions.includes("2024-11-05"));
        assert.equal(result._meta["io.modelcontextprotocol/serverInfo"].name, "microstock-plus");
        assert.ok(result.ttlMs > 0);
        assert.equal(result.cacheScope, "public");
        assert.match(result.instructions, /Nothing can be deleted/);
        assert.ok(result.instructions.includes(STOCK_METADATA_PROMPT), "server/discover must expose the canonical stock metadata prompt verbatim");
    });

    await check("2026-07-28: version and _meta errors (-32022 with supported versions, -32602)", async () => {
        const old = await client.request("tools/list", { _meta: { ...meta, "io.modelcontextprotocol/protocolVersion": "1900-01-01" } });
        assert.equal(old.error.code, -32022);
        assert.ok(old.error.data.supported.includes(MODERN));
        assert.equal(old.error.data.requested, "1900-01-01");
        const noCaps = { ...meta };
        delete noCaps["io.modelcontextprotocol/clientCapabilities"];
        assert.equal((await client.request("tools/list", { _meta: noCaps })).error.code, -32602);
        assert.equal((await client.request("tools/list", { _meta: { ...meta, "io.modelcontextprotocol/logLevel": "verbose" } })).error.code, -32602);
        assert.equal((await client.request("logging/setLevel", { level: "info", _meta: meta })).error.code, -32601);
    });

    await check("2026-07-28 tools/list: cacheable, private, and without the paid tool for a key without ai:run", async () => {
        const { result } = await client.request("tools/list", { _meta: meta });
        assert.equal(result.resultType, "complete");
        assert.equal(result.cacheScope, "private");
        assert.ok(result.ttlMs > 0);
        const names = result.tools.map(tool => tool.name);
        assert.equal(names.length, 16);
        assert.ok(!names.includes("mplus_run_ai_keywording"));
        assert.ok(result.tools.every(tool => tool.outputSchema));
    });

    await check("2026-07-28 tools/call: structured result; ai:run missing is explained, and running is refused", async () => {
        const result = await callTool(client, "mplus_get_account", {}, { _meta: meta });
        assert.equal(result.resultType, "complete");
        const account = expectOk(result, "account");
        assert.match(account.summary, /cannot run paid AI keywording/);
        const quote = expectOk(await callTool(client, "mplus_quote_ai_keywording", { iids: [IID.drone] }, { _meta: meta }), "quote");
        assert.match(quote.summary, /ai:run scope is off/);
        expectToolError(await callTool(client, "mplus_run_ai_keywording", { quote_id: quote.quote_id, confirm_charge_eur: quote.amount_eur }, { _meta: meta }),
            /scope_required/, "run without ai:run");
    });

    await check("2026-07-28 logging: notifications/message only for requests that carry a logLevel", async () => {
        const count = () => client.notifications.filter(message => message.method === "notifications/message").length;
        expectOk(await callTool(client, "mplus_wait_for_events", { wait_seconds: 0, limit: 200 }, { _meta: meta }), "events without logLevel");
        assert.equal(count(), 0);
        expectOk(await callTool(client, "mplus_wait_for_events", { wait_seconds: 0, limit: 200 },
            { _meta: modernMeta({ "io.modelcontextprotocol/logLevel": "info" }) }), "events with logLevel");
        assert.ok(count() > 0, "notable events must be logged when the request asks for it");
        assert.ok(client.notifications.every(message => message.params?.logger === "microstock-plus" || message.method !== "notifications/message"));
    });

    await client.close();
}

async function credentialSuite(mock) {
    await check("revoked key: tools stay listed, calls explain how to get a new key", async () => {
        const { client } = await legacyClient("revoked", { MPLUS_API_BASE: mock.baseUrl, MPLUS_API_KEY: mock.keys.revoked });
        const { result } = await client.request("tools/list", {});
        assert.equal(result.tools.length, AVAILABLE_TOOLS.length);
        expectToolError(await callTool(client, "mplus_get_account"), /401, revoked_api_key.*Create an agent key/, "revoked key");
        await client.close();
    });

    await check("bad key: an unknown key gets 401 invalid_api_key; a non-M+ value is never sent", async () => {
        const unknownKey = `mpk_live_00000000_${"A".repeat(43)}`;
        const { client } = await legacyClient("unknown-key", { MPLUS_API_BASE: mock.baseUrl, MPLUS_API_KEY: unknownKey });
        expectToolError(await callTool(client, "mplus_list_folders"), /401, invalid_api_key/, "unknown key");
        await client.close();

        const before = mock.requests.length;
        const { client: wrong } = await legacyClient("wrong-format", { MPLUS_API_BASE: mock.baseUrl, MPLUS_API_KEY: "sk-test-not-a-microstock-key" });
        expectToolError(await callTool(wrong, "mplus_list_folders"), /is not a Microstock\+ agent key/, "wrong format");
        assert.match(wrong.stderr, /warning: MPLUS_API_KEY is set but is not a Microstock\+ agent key/);
        assert.equal(mock.requests.length, before, "a malformed key must never be sent");
        await wrong.close();
    });

    await check("no key: every tool is listed and explains where to create a key", async () => {
        const { client } = await legacyClient("no-key", { MPLUS_API_BASE: mock.baseUrl, MPLUS_API_KEY: "${user_config.api_key}" });
        const { result } = await client.request("tools/list", {});
        assert.equal(result.tools.length, AVAILABLE_TOOLS.length);
        expectToolError(await callTool(client, "mplus_list_files"), /No Microstock\+ agent key is configured.*ai-agent-skills.*Agent keys/, "no key");
        await client.close();
    });

    await check("plugin option fallback: CLAUDE_PLUGIN_OPTION_API_KEY is used when MPLUS_API_KEY is unset", async () => {
        const { client } = await legacyClient("plugin-option", {
            MPLUS_API_BASE: mock.baseUrl, MPLUS_API_KEY: "", CLAUDE_PLUGIN_OPTION_API_KEY: mock.keys.full
        });
        expectOk(await callTool(client, "mplus_get_account"), "fallback key");
        await client.close();
    });

    await check("insufficient scope reported by the API: 403 scope_required is mapped to a tool error", async () => {
        const { client } = await legacyClient("read-only", { MPLUS_API_BASE: mock.baseUrl, MPLUS_API_KEY: mock.keys.readonly });
        const { result } = await client.request("tools/list", {});
        assert.equal(result.tools.length, AVAILABLE_TOOLS.length, "without account:read the scopes are unknown, so every offered tool is listed");
        expectToolError(await callTool(client, "mplus_update_metadata", { iid: IID.icons, notes: "x" }),
            /403, scope_required.*metadata:write.*permission/, "scope_required");
        expectOk(await callTool(client, "mplus_get_file", { iid: IID.icons }), "read with a read-only key");
        await client.close();
    });

    await check("paid run with unknown scopes: the API's 403 scope_required for ai:run reaches the model", async () => {
        const { client } = await legacyClient("quote-only", { MPLUS_API_BASE: mock.baseUrl, MPLUS_API_KEY: mock.keys.quoteOnly, ...PREVIEW });
        const { result } = await client.request("tools/list", {});
        assert.ok(result.tools.some(tool => tool.name === "mplus_run_ai_keywording"), "unknown scopes list every tool");
        const quote = expectOk(await callTool(client, "mplus_quote_ai_keywording", { iids: [IID.drone], mode: "replace" }), "quote");
        const jobs = mock.control.jobCount();
        expectToolError(await callTool(client, "mplus_run_ai_keywording", { quote_id: quote.quote_id, confirm_charge_eur: quote.amount_eur }),
            /403, scope_required.*ai:run/, "run without ai:run");
        assert.equal(mock.control.jobCount(), jobs);
        await client.close();
    });

    await check("scope change: notifications/tools/list_changed, then the paid tool appears", async () => {
        const { client } = await legacyClient("scope-change", { MPLUS_API_BASE: mock.baseUrl, MPLUS_API_KEY: mock.keys.standard, ...PREVIEW });
        const before = (await client.request("tools/list", {})).result.tools.map(tool => tool.name);
        assert.ok(!before.includes("mplus_run_ai_keywording"));
        mock.control.setScopes("standard", ALL_SCOPES);
        expectOk(await callTool(client, "mplus_get_account"), "refresh scopes");
        await waitFor(() => client.notifications.some(message => message.method === "notifications/tools/list_changed"), "list_changed");
        const after = (await client.request("tools/list", {})).result.tools.map(tool => tool.name);
        assert.ok(after.includes("mplus_run_ai_keywording"));
        mock.control.setScopes("standard", DEFAULT_SCOPES);
        await client.close();
    });

    await check("insecure MPLUS_API_BASE is refused", async () => {
        const { client } = await legacyClient("http-base", { MPLUS_API_BASE: "http://microstock.plus/api/agent/v1", MPLUS_API_KEY: mock.keys.full });
        expectToolError(await callTool(client, "mplus_get_account"), /must use https/, "plain http base");
        await client.close();
    });
}

async function olderProtocolSuite(mock) {
    await check("initialize negotiation: unknown versions get 2025-11-25; 2025-03-26 gets no structured output", async () => {
        const { init: unknown, client: probe } = await legacyClient("unknown-version", { MPLUS_API_BASE: mock.baseUrl }, "2099-01-01");
        assert.equal(unknown.protocolVersion, "2025-11-25");
        await probe.close();

        const { client, init } = await legacyClient("2025-03-26", { MPLUS_API_BASE: mock.baseUrl, MPLUS_API_KEY: mock.keys.full }, "2025-03-26");
        assert.equal(init.protocolVersion, "2025-03-26");
        const { result } = await client.request("tools/list", {});
        assert.ok(result.tools.every(tool => tool.outputSchema === undefined));
        const file = await callTool(client, "mplus_get_file", { iid: IID.icons });
        assert.equal(file.structuredContent, undefined);
        assert.match(textOf(file), /icons_set\.eps .* is at metaver/);
        await client.close();
    });
}

async function httpSuite(mock) {
    const server = new McpClient("http", { MPLUS_API_BASE: mock.baseUrl }, ["--http", "0"]);
    const port = Number(await waitFor(() => /Streamable HTTP at http:\/\/127\.0\.0\.1:(\d+)\/mcp/.exec(server.stderr)?.[1], "HTTP listen line"));
    const auth = { Authorization: `Bearer ${mock.keys.full}` };

    await check("HTTP: legacy initialize and tools/list with a per-request key", async () => {
        const init = await rawHttp(port, {
            headers: auth,
            body: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } }
        });
        assert.equal(init.status, 200);
        assert.equal(init.body.result.protocolVersion, "2025-06-18");
        assert.equal(init.body.result.capabilities.tools.listChanged, false);
        assert.ok(init.body.result.instructions.includes(STOCK_METADATA_PROMPT), "HTTP initialize must expose the canonical stock metadata prompt verbatim");
        const list = await rawHttp(port, {
            headers: { ...auth, "MCP-Protocol-Version": "2025-06-18" },
            body: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }
        });
        assert.equal(list.status, 200);
        assert.deepEqual(list.body.result.tools.map(tool => tool.name).sort(), AVAILABLE_TOOLS);
        const note = await rawHttp(port, { headers: auth, body: { jsonrpc: "2.0", method: "notifications/initialized" } });
        assert.equal(note.status, 202);
    });

    await check("HTTP 2026-07-28: tools/call with matching Mcp-* headers; mismatch is 400/-32020; unknown method 404", async () => {
        const body = { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "mplus_get_file", arguments: { iid: IID.icons }, _meta: modernMeta() } };
        const headers = { ...auth, "MCP-Protocol-Version": MODERN, "Mcp-Method": "tools/call", "Mcp-Name": "mplus_get_file" };
        const ok = await rawHttp(port, { headers, body });
        assert.equal(ok.status, 200);
        assert.equal(ok.body.result.resultType, "complete");
        assert.equal(ok.body.result.structuredContent.iid, IID.icons);
        const encoded = await rawHttp(port, { headers: { ...headers, "Mcp-Name": `=?base64?${Buffer.from("mplus_get_file").toString("base64")}?=` }, body });
        assert.equal(encoded.status, 200);
        const mismatch = await rawHttp(port, { headers: { ...headers, "Mcp-Name": "mplus_list_files" }, body });
        assert.equal(mismatch.status, 400);
        assert.equal(mismatch.body.error.code, -32020);
        const unknown = await rawHttp(port, {
            headers: { ...auth, "MCP-Protocol-Version": MODERN, "Mcp-Method": "resources/list" },
            body: { jsonrpc: "2.0", id: 4, method: "resources/list", params: { _meta: modernMeta() } }
        });
        assert.equal(unknown.status, 404);
        assert.equal(unknown.body.error.code, -32601);
    });

    await check("HTTP guards: no key 401, foreign Origin 403, GET 405, unsupported protocol header 400", async () => {
        const ping = { jsonrpc: "2.0", id: 5, method: "ping" };
        assert.equal((await rawHttp(port, { body: ping })).status, 401);
        assert.equal((await rawHttp(port, { headers: { ...auth, Origin: "https://evil.example" }, body: ping })).status, 403);
        assert.equal((await rawHttp(port, { headers: { ...auth, Origin: "http://localhost:3000" }, body: ping })).status, 200);
        assert.equal((await rawHttp(port, { method: "GET", headers: auth })).status, 405);
        assert.equal((await rawHttp(port, { headers: { ...auth, "MCP-Protocol-Version": "2019-01-01" }, body: ping })).status, 400);
        assert.ok(!server.stderr.includes(mock.keys.full));
    });

    server.child.kill();
    await server.exited;
}

async function availabilitySuite(mock) {
    const callArgs = {
        mplus_set_status: { iids: [IID.icons], agency: "adobestock", status: "ready" },
        mplus_quote_ai_keywording: { iids: [IID.drone], mode: "skip" },
        mplus_run_ai_keywording: { quote_id: "q_any", confirm_charge_eur: 1 },
        mplus_get_job: { job_id: "job_any" }
    };
    const refusals = {};

    await check("default: scoped statuses are offered while paid AI tools stay hidden", async () => {
        const { client, init } = await legacyClient("default-full", { MPLUS_API_BASE: mock.baseUrl, MPLUS_API_KEY: mock.keys.full });
        const { result } = await client.request("tools/list", {});
        assert.deepEqual(result.tools.map(tool => tool.name).sort(), AVAILABLE_TOOLS);
        assert.match(init.instructions, /Paid Microstock\+ AI actions are outside this release/);
        assert.ok(result.tools.some(tool => tool.name === "mplus_set_status"));
        for (const name of PREVIEW_TOOLS) assert.ok(!init.instructions.includes(name), `instructions mention ${name}`);
        const events = result.tools.find(tool => tool.name === "mplus_wait_for_events");
        assert.match(events.description, /confirm what changed and to report progress/);
        assert.doesNotMatch(events.description, /AI quotes and jobs/);
        await client.close();
    });

    await check("default: calling a hidden tool answers 'not available yet' and never contacts the API", async () => {
        const { client } = await legacyClient("default-calls", { MPLUS_API_BASE: mock.baseUrl, MPLUS_API_KEY: mock.keys.full });
        for (const name of PREVIEW_TOOLS) {
            const before = mock.requests.length;
            const result = await callTool(client, name, callArgs[name]);
            expectToolError(result, /^Not available yet \(not_available_yet\): /, name);
            assert.match(textOf(result), name === "mplus_set_status" ? /sending files to stock agencies/ : /AI keywording/, name);
            assert.match(textOf(result), /Don't offer or promise it/, name);
            assert.equal(mock.requests.length, before, `${name} must not contact the API`);
            refusals[name] = textOf(result);
        }
        await client.close();
    });

    await check("default: account summary exposes scoped statuses and excludes paid AI; a null balance is fine", async () => {
        mock.control.setBalance(null);
        try {
            const { client } = await legacyClient("default-account", { MPLUS_API_BASE: mock.baseUrl, MPLUS_API_KEY: mock.keys.standard });
            const account = expectOk(await callTool(client, "mplus_get_account"), "mplus_get_account");
            assert.equal(account.balance_eur, null);
            assert.doesNotMatch(account.summary, /balance/);
            assert.match(account.summary, /set statuses and queue uploads/);
            assert.match(account.summary, /Paid Microstock\+ AI keywording is outside/);
            assert.doesNotMatch(account.summary, /quote AI keywording/);
            await client.close();
        } finally {
            mock.control.setBalance(25);
        }
    });

    const mvp = await startMockApi({ disabledFeatures: DISABLED_FEATURES });
    try {
        await check("preview tools against an API that keeps them off: 403 endpoint_disabled gives the same answer", async () => {
            const { client } = await legacyClient("preview-mvp", { MPLUS_API_BASE: mvp.baseUrl, MPLUS_API_KEY: mvp.keys.full, ...PREVIEW });
            const { result } = await client.request("tools/list", {});
            assert.deepEqual(result.tools.map(tool => tool.name).sort(), EXPECTED_TOOLS);
            for (const name of ["mplus_quote_ai_keywording", "mplus_get_job"]) {
                const before = mvp.requests.length;
                const answer = await callTool(client, name, callArgs[name]);
                expectToolError(answer, /^Not available yet \(not_available_yet\): /, name);
                assert.equal(textOf(answer), refusals[name], `${name}: endpoint_disabled must read like the local refusal`);
                assert.equal(mvp.requests.length, before + 1, `${name} asks the API once`);
                assert.equal(mvp.requests.at(-1).status, 403);
            }
            assert.doesNotMatch(client.stderr, /mplus_set_status: 403 endpoint_disabled/);
            expectOk(await callTool(client, "mplus_update_metadata_batch", {
                items: [{ iid: IID.icons, patch: { notes: "checked" } }], dry_run: true
            }), "metadata still works");
            await client.close();
        });
    } finally {
        await mvp.close();
    }

    const off = await startMockApi({ apiOff: true });
    try {
        await check("switched-off Agent API: 404 not_found says the API is not on for this account yet", async () => {
            const { client } = await legacyClient("api-off", { MPLUS_API_BASE: off.baseUrl, MPLUS_API_KEY: off.keys.full });
            expectToolError(await callTool(client, "mplus_list_folders"), /404, not_found.*not switched on for this account yet.*ai-agent-skills/, "api off");
            await client.close();
        });
    } finally {
        await off.close();
    }
}

async function packagingSuite(pluginManifest) {
    await check("plugin packaging: remote OAuth MCP, portable manifests, marketplace, skills and commands", async () => {
        assert.equal(pluginManifest.name, "microstock-plus");
        assert.equal(pluginManifest.displayName, "Microstock+");
        assert.equal(pluginManifest.license, "MIT");
        assert.equal(pluginManifest.userConfig, undefined);
        const mcp = readJson(".mcp.json").mcpServers["microstock-plus"];
        assert.equal(mcp.type, "http");
        assert.equal(mcp.url, "https://microstock.plus/mcp");
        const portable = readJson("plugin.json");
        assert.equal(portable.version, pluginManifest.version);
        assert.equal(readJson("mcp.json").mcpServers["microstock-plus"].url, "https://microstock.plus/mcp");
        const catalogue = readJson("server", "tools.json");
        assert.equal(catalogue.length, 14);
        assert.deepEqual(catalogue.map(tool => tool.name).sort(), AVAILABLE_TOOLS);
        assert.ok(catalogue.every(tool => tool.scope && tool.api?.method && tool.api?.path));
        const serverSource = readFileSync(SERVER_PATH, "utf8").replace(/\r\n/g, "\n");
        const embedded = serverSource.match(/\/\/ STOCK_METADATA_SYSTEM_PROMPT_BEGIN\nconst STOCK_METADATA_SYSTEM_PROMPT = String\.raw`([\s\S]*?)`;\n\/\/ STOCK_METADATA_SYSTEM_PROMPT_END/)?.[1];
        assert.equal(embedded, STOCK_METADATA_PROMPT, "standalone MCP prompt must equal the canonical prompt byte-for-byte after newline normalization");
        const marketplace = readJson(".claude-plugin", "marketplace.json");
        assert.equal(marketplace.name, "microstock-plus");
        assert.equal(marketplace.plugins[0].source, "./");
        for (const skill of ["mplus-connect", "mplus-portfolio-management", "mplus-keywording"]) {
            const text = readFileSync(path.join(ROOT, "skills", skill, "SKILL.md"), "utf8");
            assert.match(text, new RegExp(`^---\\r?\\nname: ${skill}\\r?\\ndescription: .+`), `${skill} frontmatter`);
        }
        for (const command of ["audit", "keywords", "export"]) {
            assert.match(readFileSync(path.join(ROOT, "commands", `${command}.md`), "utf8"), /^---\r?\ndescription: /);
        }
    });

    await check("OpenAPI 3.1: every contract endpoint is described, and DELETE is documented as 405", async () => {
        const spec = readJson("openapi", "agent-api-v1.json");
        assert.equal(spec.openapi, "3.1.0");
        const expected = {
            "/me": ["get"], "/folders": ["get", "post"], "/files": ["get"], "/files/previews": ["post"],
            "/files/istock-terms/resolve": ["post"], "/files/istock-terms/batch": ["post"], "/files/{iid}": ["get", "delete"],
            "/files/{iid}/metadata": ["patch"], "/files/metadata:batch": ["post"], "/files/status:batch": ["post"],
            "/uploads/init": ["post"], "/exports/csv": ["post"], "/exports/{id}/download": ["get"], "/ai/keywording:quote": ["post"],
            "/ai/keywording:run": ["post"], "/jobs/{id}": ["get"], "/events": ["get"], "/events/stream": ["get"]
        };
        for (const [route, methods] of Object.entries(expected)) {
            for (const method of methods) assert.ok(spec.paths[route]?.[method], `${method.toUpperCase()} ${route} missing`);
        }
        assert.ok(spec.paths["/files/{iid}"].delete.responses["405"]);
        const refs = JSON.stringify(spec).match(/"\$ref":"#\/components\/[^"]+"/g) || [];
        for (const ref of refs) {
            const target = ref.slice(9, -1).split("/").slice(1).reduce((node, key) => node?.[key], spec);
            assert.ok(target, `unresolved ${ref}`);
        }
    });
}

async function main() {
    const pluginManifest = readJson(".claude-plugin", "plugin.json");
    // Preview-capability fallback links add one read request after file/preview
    // reads. Keep this broad semantic suite away from the rate-limit boundary;
    // dedicated checks below still exercise 429 and Retry-After behavior.
    const mock = await startMockApi({ rateLimits: { requests: 200 } });
    try {
        await legacySuite(mock, RUNTIME_VERSION);
        await modernSuite(mock);
        await credentialSuite(mock);
        await olderProtocolSuite(mock);
        await httpSuite(mock);
        await availabilitySuite(mock);
        await packagingSuite(pluginManifest);
        console.log(`All ${checks} smoke checks passed (Node ${process.versions.node}).`);
    } finally {
        await Promise.all(clients.map(client => client.close().catch(() => {})));
        await mock.close();
    }
}

main().catch(error => {
    console.error(`FAILED after ${checks} passing checks: ${error?.stack || error}`);
    for (const client of clients) {
        if (client.stderr.trim()) console.error(`--- stderr of ${client.label} ---\n${client.stderr.trim()}`);
    }
    process.exit(1);
});

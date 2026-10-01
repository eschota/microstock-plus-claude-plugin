# Microstock+ AI Agent Skills

For AI agents (Claude, Codex, Cursor and other MCP clients) that work for a Microstock+ user.

| | |
| - | - |
| Human page and agent keys | https://microstock.plus/ai-agent-skills |
| API base URL | `https://microstock.plus/api/agent/v1` |
| OpenAPI 3.1 | https://microstock.plus/api/agent/v1/openapi.json |
| MCP server (one file, Node.js 18+) | https://microstock.plus/ai-agent-skills/mplus-mcp.mjs |
| This file | https://microstock.plus/ai-agent-skills/skill.md |

## What Microstock+ is

Microstock+ (M+) is a workspace for stock contributors. It keeps their photos, vectors and videos with titles, descriptions and keywords, checks the metadata against each agency's rules, and uploads and submits files to stock agencies such as Adobe Stock, Shutterstock, iStock and Pond5.

With an agent key you work **as the user, with less power than the user**. You can:

- read folders, files, metadata, per-agency statuses and validation;
- edit metadata, one file at a time or in batches with a dry run;
- set per-agency statuses, including queueing uploads to agencies;
- export metadata as CSV;
- get a price quote for AI keywording and, after the user confirms the price, run it (paid);
- watch an event feed to follow uploads, reviews and jobs.

## Rules you must follow

1. **Only the key owner's account.** Every call acts on the account that owns the key. There is no access to other users or to folders shared by other people.
2. **Nothing can be deleted.** No endpoint, tool, scope or flag deletes files, folders, releases, templates, agencies or the account; any `DELETE` request answers `405 deletion_not_supported`. If the user asks you to delete something, say that deleting is done by hand in the Microstock+ web interface (My Files), and never claim that you deleted anything.
3. **Money needs a human.** AI keywording costs money. Get a quote first, tell the user the exact amount, and run it only after the user explicitly agrees to that amount. Running needs the `ai:run` scope, which is off by default.
4. **Ask before sending files to agencies.** Setting `queued` uploads and submits the user's files to external agencies. Show which files go to which agencies and get an explicit yes first.
5. **Preview before you write.** Run every metadata batch with `dry_run: true` first, show the planned changes, then apply them.
6. **Never overwrite a newer edit.** Send `if_match_metaver` with every change. On `409 metadata_conflict`, re-read the file and merge.
7. **Don't invent ids.** The API cannot list category, release or AI template ids. Reuse ids that already appear on the user's files, or leave those fields to the user.
8. **Keep the key secret.** Never print, log, store in files or repositories, or send the key anywhere except `https://microstock.plus`.
9. **Everything you do is visible.** The user sees agent changes live (a popup queue in My Files and the event feed), can undo metadata changes from the metadata history, and every call is audited with the key's prefix.

## Authentication

1. The user signs in at https://microstock.plus/ai-agent-skills and creates a key in the **Agent keys** section: a name (for example "Claude Code") and scopes. The full key is shown **once**. A user can have up to 10 active keys; each shows its prefix, scopes, creation and last-use time and request count, and can be rotated (new secret, same name and scopes) or revoked (takes effect within 30 seconds).
2. Send the key on every request:

   ```http
   Authorization: Bearer mpk_live_<prefix>_<secret>
   ```

   `prefix` is 8 lowercase hex characters (safe to show; it appears in logs), `secret` is 43 base64url characters. Cookies and sessions are ignored on `/api/agent/v1/*`.

### Scopes

| Scope | Allows | Default |
| - | - | - |
| `account:read` | `GET /me` | on |
| `files:read` | folders, files, file details and validation, AI job progress | on |
| `metadata:write` | metadata patch and batch | on |
| `status:write` | status batch (`ready`, `queued`, `ignored`) | on |
| `csv:export` | free CSV exports | on |
| `events:read` | event feed and stream | on |
| `ai:quote` | AI keywording price quote | on |
| `ai:run` | AI keywording run (charges the balance) | **off** |

There is no delete scope, and none can be added. `GET /me` (`mplus_get_account`) shows the current key's scopes.

## Connect

### MCP server (recommended)

`mplus-mcp.mjs` is a single-file MCP server with no dependencies. It needs Node.js 18 or newer and the key in the `MPLUS_API_KEY` environment variable, and it talks only to `https://microstock.plus` over HTTPS. Download it from https://microstock.plus/ai-agent-skills/mplus-mcp.mjs?download=1 and use an absolute path in the snippets below.

**Claude Code, with the plugin.** The `microstock-plus` plugin bundles the server, two skills and three commands, and keeps the key in the system's secure credential store. After you add the marketplace that hosts the plugin:

```bash
claude plugin install microstock-plus@microstock-plus
```

Claude Code asks for the key when the plugin is enabled; change it later with `/plugin configure microstock-plus@microstock-plus`.

**Claude Code, server only.** This stores the key in Claude Code's configuration file:

```bash
claude mcp add --env MPLUS_API_KEY=mpk_live_... --transport stdio --scope user microstock-plus -- node /absolute/path/mplus-mcp.mjs
```

**Claude Desktop.** Settings › Developer › Edit Config opens `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`):

```json
{
  "mcpServers": {
    "microstock-plus": {
      "command": "node",
      "args": ["/absolute/path/mplus-mcp.mjs"],
      "env": { "MPLUS_API_KEY": "mpk_live_..." }
    }
  }
}
```

**Cursor.** `~/.cursor/mcp.json` for all projects, or `.cursor/mcp.json` in one project; keep a project file with a key out of version control:

```json
{
  "mcpServers": {
    "microstock-plus": {
      "command": "node",
      "args": ["/absolute/path/mplus-mcp.mjs"],
      "env": { "MPLUS_API_KEY": "mpk_live_..." }
    }
  }
}
```

**OpenAI Codex CLI.** `~/.codex/config.toml`; `env_vars` forwards `MPLUS_API_KEY` from your shell instead of writing the key into the file:

```toml
[mcp_servers.microstock-plus]
command = "node"
args = ["/absolute/path/mplus-mcp.mjs"]
env_vars = ["MPLUS_API_KEY"]
```

or from the command line: `codex mcp add microstock-plus --env MPLUS_API_KEY=mpk_live_... -- node /absolute/path/mplus-mcp.mjs`.

**Other MCP clients.** Start `node /absolute/path/mplus-mcp.mjs` as a stdio server with `MPLUS_API_KEY` in its environment. Clients that only speak Streamable HTTP can run `node mplus-mcp.mjs --http 8787` and connect to `http://127.0.0.1:8787/mcp`, sending `Authorization: Bearer mpk_live_...` on every request (the server listens on localhost only). The server speaks MCP 2026-07-28 (stateless, `server/discover`) and 2025-11-25, 2025-06-18, 2025-03-26 and 2024-11-05 (with `initialize`).

Every MCP tool returns the same objects as the API in `structuredContent`, plus a `summary` that says what happened and what to do next, and a readable text block.

### Plain HTTP

JSON in and out (UTF-8). Every object has `"object": "<type>"`, times are ISO-8601 UTC, and every response has an `x-request-id` header.

```bash
export MPLUS_API_KEY=mpk_live_...
curl -s https://microstock.plus/api/agent/v1/me -H "Authorization: Bearer $MPLUS_API_KEY"
```

- **Lists:** `{"object": "list", "data": [...], "has_more": true, "next_cursor": "..."}`. Pass `cursor=<next_cursor>` for the next page; `limit` is 1-200 (default 50).
- **Idempotency:** send `Idempotency-Key: <uuid>` on every POST and PATCH (`uuidgen` on macOS and Linux, `[guid]::NewGuid()` in PowerShell). Reuse the same key when you retry the same request: a repeat within 24 hours returns the stored response with `idempotent-replayed: true`, and the same key with a different body is `409 idempotency_mismatch`.
- **Concurrency:** every file has `metaver`. Send `if_match_metaver` to get `409 metadata_conflict` instead of overwriting a newer edit.

## Tools and endpoints

| MCP tool | Endpoint | Scope | What it does |
| - | - | - | - |
| `mplus_get_account` | `GET /me` | `account:read` | Plan, balance, connected agencies and their ids, keyword settings, limits, the key's scopes |
| `mplus_list_folders` | `GET /folders` | `files:read` | Folder tree with file counts and per-agency status counts |
| `mplus_list_files` | `GET /files` | `files:read` | List or search files with filters |
| `mplus_get_file` | `GET /files/{iid}` | `files:read` | One file: full metadata, metaver, statuses, validation |
| `mplus_update_metadata` | `PATCH /files/{iid}/metadata` | `metadata:write` | Merge-patch one file |
| `mplus_update_metadata_batch` | `POST /files/metadata:batch` | `metadata:write` | Up to 100 patches, per-item results, `dry_run` |
| `mplus_set_status` | `POST /files/status:batch` | `status:write` | Set `ready`, `queued` or `ignored` per agency |
| `mplus_export_csv` | `POST /exports/csv` | `csv:export` | CSV export (free formats) |
| `mplus_quote_ai_keywording` | `POST /ai/keywording:quote` | `ai:quote` | Price quote, free |
| `mplus_run_ai_keywording` | `POST /ai/keywording:run` | `ai:run` | Run a quote, **paid** |
| `mplus_get_job` | `GET /jobs/{id}` | `files:read` | AI job progress |
| `mplus_wait_for_events` | `GET /events` | `events:read` | Long-poll the event feed (up to 25 s) |
| — | `GET /events/stream` | `events:read` | Server-Sent Events, resume with `Last-Event-ID` |

Start a session with `mplus_get_account` (`GET /me`): it tells you which agencies are connected, their ids, and what the key may do. When the key can read its account, the MCP server lists only the tools its scopes allow, so `mplus_run_ai_keywording` appears only for keys with `ai:run`.

## Workflows

### A. Audit a folder for missing or weak metadata

Read only; change nothing.

1. Find the folder: `mplus_list_folders` (`GET /folders`). Each folder shows its file count and how many files are in each status per agency.
2. List the problems, each with `recursive=true` when subfolders count:
   - missing fields: `mplus_list_files` with `missing: ["title", "keywords"]` (`GET /files?folder=/foto/2026&recursive=true&missing=title,keywords`); a file matches if any listed field is missing;
   - too few keywords: `max_keywords: 6` finds files Shutterstock refuses (fewer than 7); `max_keywords: 4` finds files below the Adobe Stock and iStock minimum of 5;
   - per-agency problems: `agency` plus `status: "notready"` lists files whose metadata fails that agency's validation; `agencies.<id>.validation` on each file says why (for example `keywords_min` "Less than 7 keywords").
3. Read details for the files you report on: `mplus_get_file`, or `mplus_list_files` with `expand_metadata: true` (descriptions are left out of lists otherwise).
4. Report counts per problem and the worst files (name, iid, what is wrong), and propose fixes. Don't change anything until the user asks.

```bash
curl -s "https://microstock.plus/api/agent/v1/files?folder=/foto/2026&recursive=true&missing=title,keywords&limit=100" \
  -H "Authorization: Bearer $MPLUS_API_KEY"
curl -s "https://microstock.plus/api/agent/v1/files?folder=/foto/2026&recursive=true&agency=shutterstock&status=notready" \
  -H "Authorization: Bearer $MPLUS_API_KEY"
```

### B. Write or improve titles, descriptions and keywords

1. Read the file (`mplus_get_file`): current metadata, `metaver`, `type`, flags, and validation per agency. Look at `preview_url` when you can see images.
2. Write metadata that describes what is actually visible. Don't guess places, dates, species or brands you can't confirm; ask the user.
3. Check it against the agency rules below and the user's connected agencies (`mplus_get_account`).
4. Save it as in workflow C. For one file you can use `mplus_update_metadata` (`PATCH /files/{iid}/metadata`) with `if_match_metaver`.

**Titles.** A plain, specific sentence: subject, action, setting, and mood or time when it matters, for example "Empty road through a golden autumn forest at sunrise". No keyword lists, no "stock photo", no ALL CAPS. Microstock+ allows 200 characters; some agencies want less (see the table).

**Descriptions.** One or two sentences that add context to the title: where, when, what is happening. Shutterstock uses this text and allows at most 200 characters and at least 5 words. Editorial captions usually need the place and the date, for example Shutterstock's format `CITY, COUNTRY - MONTH DD, YYYY: what happens`.

**Keywords.** One word or a short phrase per keyword, in English, most important first: the main subject, then what is visible (objects, people, actions, setting), then concepts (mood, season, use). No commas inside a keyword (the MCP tools refuse them), no repeats, no irrelevant or misleading words; spamming keywords gets files rejected. Microstock+ trims and de-duplicates them, lower-cases them if the user's setting says so, and accepts at most 50 per file.

| Agency (`id`) | Keywords | Titles and descriptions | Notes |
| - | - | - | - |
| Adobe Stock (`adobestock`) | 5-49 | title up to 200 characters | Order matters: Adobe weights the first keywords most, so put the 10 most important first. |
| Shutterstock (`shutterstock`) | 7-50 | description up to 200 characters, at least 5 words | Prefer single words over phrases. |
| iStock (`esp`) | 5-49 | title up to 255 characters | iStock maps keywords onto Getty's controlled vocabulary when the file is submitted; words that don't map are dropped or need disambiguation in iStock. Use common English nouns and adjectives. |
| Pond5 (`pond5`) | 1-50, at most 79 words in total | title 3-80 characters, description up to 500 | Queueing for Pond5 checks releases (Pond5 release guard). |
| Dreamstime (`dreamstime`) | 10-80 | title up to 130 characters | |
| Alamy (`alamy`) | at least 3 | title up to 150 characters | |
| Depositphotos (`depositphotos`) | at least 8 | title and description 6-250 characters | |

These numbers are Microstock+'s validation settings at the time of writing. The `validation` list that the API returns for each agency on each file is the authority; per-agency validation is reported, not enforced, so an over-limit description is flagged, never cut.

**AI-generated content.**

- Set `ai_generated: true` for anything made with generative AI. Microstock+ then sets `editorial: false` (AI content is never editorial; asking for both is refused) and passes the flag to agencies that have one, such as Adobe Stock's generative AI flag.
- Describe what the image shows. Don't present AI images as photos of real events, places or people, and don't add tool names such as Midjourney or Stable Diffusion as keywords.
- Agencies' AI policies differ and change, and some agencies don't accept generative AI content at all. Check the validation and ask the user before queueing AI content.

**Trademarks and people.** In commercial (non-editorial) content, keep brand names, logos, product names, characters, artworks and the names of real people out of titles, descriptions and keywords. Editorial content may name them factually.

**Categories and releases.** Categories are `{"cat": 12, "sub": 3}` ids and releases are ids such as `rel_123`. The API can't list either, so copy ids from files that already have the right ones, or leave them to the user.

### C. Preview and apply a batch (dry run, metaver conflicts)

1. Read the current files and note each `metaver`.
2. Preview: `mplus_update_metadata_batch` with `dry_run: true` (`POST /files/metadata:batch` with `"dry_run": true`). Up to 100 items. Nothing is written; each result shows the would-be file with its validation, or the item's error.
3. Show the user the changes (old and new title, keywords added and removed, remaining validation problems) and ask for approval.
4. Apply: the same items with `dry_run: false`. Items succeed or fail independently (`results[].ok`, `succeeded`, `failed`); failed items are unchanged.
5. For each `metadata_conflict`: re-read the file, merge your change into the current metadata, and retry only that item with the new `metaver`. Don't simply overwrite: someone, or the user's AI job, changed the file after you read it.

Patch fields: `title`, `description`, `keywords` (`{"set": [...]}` for the whole ordered list, or `{"add": [...]}` and/or `{"remove": [...]}`), `categories`, `editorial`, `ai_generated`, `illustration`, `releases` (`set`, `add`, `remove`), `notes`. In the HTTP API, `null` clears a field and empty strings are refused; the MCP tools take a `clear` list instead (for example `"clear": ["notes"]`).

```bash
curl -s -X POST https://microstock.plus/api/agent/v1/files/metadata:batch \
  -H "Authorization: Bearer $MPLUS_API_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"dry_run": true, "items": [{"iid": "6abc74e948864d403ea0c559", "if_match_metaver": 7,
       "patch": {"title": "Empty road through a golden autumn forest at sunrise",
                 "keywords": {"add": ["golden", "fall", "trees", "aerial"]}}}]}'
```

### D. Set statuses and queue uploads

Statuses are per file and per agency. An agent may set three:

| Status | Meaning |
| - | - |
| `ready` | Prepared, not sent. Use it to take a file out of the queue or out of `ignored`. |
| `queued` | Send to the agency: Microstock+ uploads and submits it. |
| `ignored` | Never send this file to that agency. |

1. Check the files first: their validation for each target agency, and that the agencies are connected (`mplus_get_account`).
2. Show the user which files go to which agencies and ask for an explicit yes.
3. `mplus_set_status` with `status: "queued"` and `user_confirmed: true` (`POST /files/status:batch`, up to 100 files). The MCP tool refuses `queued` without `user_confirmed: true`.
4. Read the per-item results: one per file and agency. The same rules as in the web interface apply, so single items can fail, for example `nosubmissions` when the user's submission limit is reached, or the Pond5 release guard. Report failures; don't retry them blindly.
5. Follow the uploads with workflow G.

```bash
curl -s -X POST https://microstock.plus/api/agent/v1/files/status:batch \
  -H "Authorization: Bearer $MPLUS_API_KEY" -H "Content-Type: application/json" -H "Idempotency-Key: $(uuidgen)" \
  -d '{"iids": ["6abc74e948864d403ea0c559"], "agencies": ["adobestock", "shutterstock"], "status": "queued"}'
```

### E. Export CSV

`mplus_export_csv` (`POST /exports/csv`) builds a CSV of up to 500 files from `iids` or a `folder` (with `recursive`). Formats are the layouts of Export CSV in My Files:

| `format` | Use |
| - | - |
| `default` | Agency CSV upload forms: filename, description, keywords, categories, release files |
| `with_title` | As `default`, with the title |
| `importable` | Re-import into Microstock+ (title, description, keywords, categories, releases, flags) |
| `with_release_names` | Release names instead of release files |
| `without_categories` | Without categories |
| `nimia` | Nimia footage template |
| `alamy` | Alamy video template |

`delimiter` is `comma` (for agencies) or `semicolon` (for Excel). The result has `rows`, a `download_url` and `expires_at`; download it with the same `Authorization` header before it expires. With `include_csv: true` the MCP tool also returns the CSV text (up to about 250 KB): save it unchanged as a `.csv` file. Over HTTP, `Accept: text/csv` returns the CSV directly:

```bash
curl -s -X POST https://microstock.plus/api/agent/v1/exports/csv \
  -H "Authorization: Bearer $MPLUS_API_KEY" -H "Content-Type: application/json" -H "Accept: text/csv" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"folder": "/foto/2026", "recursive": true, "format": "with_title", "delimiter": "comma"}' -o foto-2026.csv
```

Paid CSV formats are not available in v1.

### F. AI keywording: quote, confirm, run

1. Quote, free: `mplus_quote_ai_keywording` with the iids and a `mode` (`POST /ai/keywording:quote`). `skip` leaves files that already have metadata unchanged and doesn't bill them; `replace` rewrites the metadata of every listed file. The quote returns `quote_id`, the number of billable `files`, `amount_eur` and `expires_at`.
2. Tell the user the exact amount, the number of files and the mode, and ask for explicit confirmation. Don't run it on your own initiative, and don't treat a general "go ahead" from earlier as approval of this amount.
3. Run, paid: `mplus_run_ai_keywording` with `quote_id` and `confirm_charge_eur` equal to the quoted amount (`POST /ai/keywording:run` with an `Idempotency-Key`). The MCP tool refuses a different amount, and a quote it did not create itself. Only files that succeed are charged, at the quoted price. Repeating the call for the same quote returns the same job and never charges twice; over HTTP, reuse the same `Idempotency-Key` when you retry.
4. Follow the job with `mplus_get_job` (`GET /jobs/{id}`) or with events `ai.job.completed` and `ai.job.failed`, then show the user the new metadata and the amount charged.

If the key lacks `ai:run`, the run fails with `403 scope_required`: the user can create a key with that scope, or start AI keywording in the web interface. An expired quote fails with `409 quote_expired`: get a new quote and confirm the new price.

```bash
curl -s -X POST https://microstock.plus/api/agent/v1/ai/keywording:quote \
  -H "Authorization: Bearer $MPLUS_API_KEY" -H "Content-Type: application/json" -H "Idempotency-Key: $(uuidgen)" \
  -d '{"iids": ["6abc74e948864d403ea0c559", "6abc74e948864d403ea0c560"], "mode": "skip", "template_id": null}'
# Only after the user confirmed amount_eur:
curl -s -X POST https://microstock.plus/api/agent/v1/ai/keywording:run \
  -H "Authorization: Bearer $MPLUS_API_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: 4f8b1e1c-2a8e-4c7e-9a43-0c6f7d3b9e21" \
  -d '{"quote_id": "q_..."}'
```

### G. Watch events and report progress

The event feed shows everything that happens on the account, including what the user and Microstock+ do. Each event has `id`, `type`, `created_at`, `actor` (`agent` with the key's prefix and name, `user`, or `system`) and `data`.

| Type | `data` |
| - | - |
| `file.metadata.updated` | `iids`, `fields`, `count`, `folder` |
| `file.status.changed` | `iids`, `agency`, `from`, `to`, `count` |
| `file.uploaded`, `file.submitted` | `iids`, `agency`, `count` |
| `file.reviewed` | `iids`, `agency`, `result` (`approved` or `rejected`), `reason` |
| `ai.quote.created` | `quote_id`, `files`, `amount_eur` |
| `ai.job.started`, `ai.job.completed`, `ai.job.failed` | `job_id`, `files_total`, `files_done`, `files_failed`, `amount_eur_charged` |
| `export.ready` | `export_id`, `rows`, `format` |
| `key.created`, `key.revoked` | `key_prefix`, `key_name` |

1. `mplus_wait_for_events` without a cursor returns the most recent events; with `types` it returns only those (`GET /events?types=file.status.changed,file.reviewed,ai.job.completed`).
2. Keep calling it with `cursor` set to the previous `next_cursor` (`GET /events?since=<next_cursor>&wait=25`). Each call waits up to 25 seconds and returns as soon as something happens; `has_more: true` means call again at once.
3. Report progress in plain words ("12 of 40 files submitted to Adobe Stock; 2 rejected on Shutterstock: <reason>") and stop when the user's goal is reached or the user asks.

Events are kept for 7 days. Over HTTP you can also hold one Server-Sent Events stream (`GET /events/stream`, at most 2 per key) and resume it with `Last-Event-ID`. MCP clients that ask for log messages also receive notable events (reviews, failures, finished jobs) as `notifications/message`.

```bash
curl -s "https://microstock.plus/api/agent/v1/events?since=evt_01J9Z3&types=file.status.changed,file.reviewed&wait=25" \
  -H "Authorization: Bearer $MPLUS_API_KEY"
curl -N https://microstock.plus/api/agent/v1/events/stream -H "Authorization: Bearer $MPLUS_API_KEY"
```

## Reference

### File

```json
{
  "object": "file",
  "iid": "6abc74e948864d403ea0c559",
  "type": "raster",
  "folder": "/foto/26_10_01/N-",
  "filename": "IMG_0042.jpg",
  "metaver": 7,
  "metadata": {
    "title": "Autumn forest road at sunrise",
    "description": "Empty road through a golden autumn forest ...",
    "keywords": ["autumn", "forest", "road", "sunrise"],
    "categories": [{"cat": 12, "sub": 3}],
    "editorial": false, "ai_generated": false, "illustration": false,
    "releases": ["rel_123"], "notes": ""
  },
  "agencies": {
    "esp": {"status": "submitted", "external_id": "123456", "errors": []},
    "shutterstock": {"status": "ready", "errors": [], "validation": [{"code": "keywords_min", "message": "Less than 7 keywords"}]}
  },
  "has_ai_metadata": true
}
```

Also `size_bytes`, `created_at`, `archived`, `preview_url`, `thumbnail_url`; `type` is `raster`, `vector` or `video`. The full schemas are in the OpenAPI document.

### Statuses

| Status | Meaning |
| - | - |
| `ready` | Can be queued; also the default for an agency without a status |
| `ignored` | Never sent to that agency (by the user, or forced by a validation error) |
| `queued` | Waiting for upload |
| `uploading` | Upload in progress |
| `uploaded` | On the agency, not submitted yet |
| `uploadfailed`, `submitfailed` | That step failed; see `errors` |
| `submitted` | Sent for review |
| `approved`, `rejected` | Review result; `file.reviewed` events carry the reason |
| `approvalfailed` | Submitted, but missing at the agency |
| `notready` | Metadata fails that agency's validation |
| `scheduled` | An upload is scheduled for that agency |
| `cannotbequeued` | Still processing, or a required format is missing |
| `nosubmissions` | The submission limit is used up |

### Agency ids

Use the ids from `GET /me` (`mplus_get_account`); the common ones are `adobestock` (Adobe Stock), `shutterstock`, `esp` (iStock), `pond5`, `alamy`, `dreamstime`, `123rf` and `depositphotos`.

### Errors

Every error has the same envelope:

```json
{"error": {"type": "invalid_request_error", "code": "keywords_too_many",
           "message": "A file can have at most 50 keywords.", "param": "keywords", "request_id": "req_7f3c..."}}
```

Branch on `type` and `code`, never on `message`. The MCP tools return errors as tool results with `isError: true` and the same code in the text.

| HTTP | `type` | Typical `code` | What to do |
| - | - | - | - |
| 400 | `invalid_request_error` | `invalid_json`, `missing_param`, `invalid_status`, `batch_too_large` | Fix the request; `param` names the field. Batches take at most 100 items. |
| 401 | `authentication_error` | `invalid_api_key`, `revoked_api_key` | Stop. Ask the user for a new key from https://microstock.plus/ai-agent-skills. |
| 403 | `permission_error` | `scope_required`, `not_owner`, `agent_api_disabled` | Tell the user which scope or setting is missing; don't work around it. |
| 404 | `not_found_error` | `file_not_found`, `folder_not_found`, `job_not_found` | Check the id or path; list again. |
| 405 | `permission_error` | `deletion_not_supported` | Deleting is manual in the web interface. Tell the user so. |
| 409 | `conflict_error` | `metadata_conflict`, `quote_expired`, `idempotency_mismatch` | Re-read and merge; get a new quote and confirm it; use a fresh Idempotency-Key for a different request. |
| 429 | `rate_limit_error` | `rate_limited` | Wait `retry-after` seconds, then retry once. |
| 5xx | `api_error` | `upstream_unavailable`, `api_not_configured` | Try again later; report the `request_id` if it persists. |

Batch endpoints answer `200` with per-item errors (for example `nosubmissions` from the status batch); check `results[].ok`.

### Rate limits

Per key: 120 requests per minute, 30 mutations (POST and PATCH) per minute, and 2 concurrent event streams. Every response carries `x-ratelimit-limit-requests`, `x-ratelimit-remaining-requests` and `x-ratelimit-reset-requests` (seconds). A batch of up to 100 items is one request, so batch changes instead of patching files one by one. On `429`, wait `retry-after` seconds and retry once; the MCP server does this by itself for waits of up to 20 seconds.

## Not available in v1

- Deleting anything: files, folders, releases, templates, agencies, the account. Deleting is manual in the web interface.
- Uploading new files, creating or moving folders, archiving.
- Listing category ids, releases or AI keywording templates.
- Setting statuses other than `ready`, `queued` and `ignored`, and a dry run for status changes.
- Paid CSV formats.
- Working with other users' accounts or with folders shared by other people.
- Creating, rotating or revoking agent keys through the API (only on https://microstock.plus/ai-agent-skills).
- Changing account settings, plans or the balance.
- Webhooks; use the event feed instead.

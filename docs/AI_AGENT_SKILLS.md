# Microstock+ AI Agent Skills

For AI agents (Claude, Codex, Cursor and other MCP clients) that work for a Microstock+ user.

| | |
| - | - |
| Human page and agent keys | https://microstock.plus/ai-agent-skills |
| API base URL | `https://microstock.plus/api/agent/v1` |
| Hosted MCP (OAuth) | `https://microstock.plus/mcp` |
| OpenAPI 3.1 | https://microstock.plus/api/agent/v1/openapi.json |
| MCP server (one file, Node.js 18+) | https://microstock.plus/ai-agent-skills/mplus-mcp.mjs |
| This file | https://microstock.plus/ai-agent-skills/skill.md |

## What Microstock+ is

Microstock+ (M+) is a workspace for stock contributors. It keeps their photos, vectors and videos with titles, descriptions and keywords, checks the metadata against each agency's rules, and uploads and submits files to stock agencies such as Adobe Stock, Shutterstock, iStock and Pond5.

With an agent key you work **as the user, with less power than the user**. You can:

- read folders, files, metadata, per-agency statuses, rejection reasons and validation;
- edit metadata, one file at a time or in batches with a dry run;
- export metadata as CSV;
- inspect authenticated previews as native MCP image blocks;
- initialize a direct upload of a local file into an existing folder;
- watch an event feed of the changes made through the Agent API.

**Outside this release.** Paid Microstock+ AI keywording tools are not published. Status changes require the opt-in `status:write` scope. File upload into M+ is separate from sending a file to a stock agency.

## Rules you must follow

1. **Only the key owner's account.** Every call acts on the account that owns the key. There is no access to other users or to folders shared by other people.
2. **Nothing can be deleted.** No endpoint, tool, scope or flag deletes files, folders, releases, templates, agencies or the account; any `DELETE` request answers `405 deletion_not_supported`. If the user asks you to delete something, say that deleting is done by hand in the Microstock+ web interface (My Files), and never claim that you deleted anything.
3. **No spending; direct uploads only.** Paid AI tools are unavailable. For a local upload, initialize a ticket with file facts, send the local bytes to its chunk endpoint, and finish it. Never give the API a remote source URL.
4. **Preview before you write.** Run every metadata batch with `dry_run: true` first, show the planned changes, then apply them.
5. **Never overwrite a newer edit.** Send `if_match_metaver` with every change. On `409 metadata_conflict`, re-read the file and merge.
6. **Don't invent ids.** Categories come from the fixed table in the reference below. The API cannot list release or AI template ids: reuse ids that already appear on the user's files, or leave those fields to the user.
7. **Keep the key secret.** Never print, log, store in files or repositories, or send the key anywhere except `https://microstock.plus`.
8. **Everything you do is visible.** Changes are saved to the user's files at once and show up in My Files, and every call is audited with the key's prefix. There is no undo button: if the user wants a change reverted, write back the values you read before it.

## Authentication

1. The user signs in at https://microstock.plus/ai-agent-skills and creates a key in the **Agent keys** section: a name (for example "Claude Code") and scopes. The full key is shown **once**. A user can have up to 10 active keys; each shows its prefix, scopes, creation and last-use time and request count, and can be rotated (new secret, same name and scopes) or revoked (takes effect within 30 seconds). Agent keys open gradually: while the Agent API is not switched on for an account, every call answers `404 not_found`.
2. Send the key on every request:

   ```http
   Authorization: Bearer mpk_live_<prefix>_<secret>
   ```

   `prefix` is 8 lowercase hex characters (safe to show; it appears in logs), `secret` is 43 base64url characters. Cookies and sessions are ignored on `/api/agent/v1/*`.

### Scopes

| Scope | Allows | Default |
| - | - | - |
| `account:read` | `GET /me` | on |
| `files:read` | folders, files, file details and validation | on |
| `metadata:write` | metadata patch and batch | on |
| `csv:export` | free CSV exports | on |
| `events:read` | event feed (long poll) | on |
| `status:write` | status batch (`ready`, `queued`, `ignored`) | opt-in |
| `files:upload` | create folders and upload local files | opt-in |
| `ai:quote` | AI keywording price quote | not available yet |
| `ai:run` | AI keywording run (charges the balance) | not available yet |

Keys can hold only the first five scopes today; the last three can't be added until their endpoints are switched on (`ai:run` will then be off by default). There is no delete scope, and none can be added. `GET /me` (`mplus_get_account`) shows the current key's scopes; its `balance_eur` is `null` in this release.

## Connect

### MCP server (recommended)

For Claude Code, the shortest setup uses the hosted OAuth MCP:

```bash
claude mcp add --transport http microstock-plus https://microstock.plus/mcp
```

For ChatGPT, enable Developer mode under **Settings → Security and login**, open
**Apps** or **Plugins** (the label varies by surface/account), press **+**, paste `https://microstock.plus/mcp`, and complete the
Microstock+ OAuth login. Public directory publication is a separate review step; this
package is for direct connection and testing until that approval occurs.

`mplus-mcp.mjs` is a single-file MCP server with no dependencies. It needs Node.js 18 or newer and the key in the `MPLUS_API_KEY` environment variable, and it talks only to `https://microstock.plus` over HTTPS. Download it from https://microstock.plus/ai-agent-skills/mplus-mcp.mjs?download=1 and use an absolute path in the snippets below.

Paid AI tools are not part of the published MCP catalogue. Optional status tools appear only when enabled by the production API and key scopes.

**Claude Code, with the GitHub plugin.** The `microstock-plus` plugin bundles two skills, three commands and the hosted OAuth MCP. It needs no copied agent key. Install it from the public GitHub marketplace:

```bash
claude plugin marketplace add eschota/microstock-plus-claude-plugin
claude plugin install microstock-plus@microstock-plus
```

The GitHub marketplace is available now. Inclusion in the official Claude or OpenAI plugin directory is subject to separate moderation and is not claimed.

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
| `mplus_get_previews` | `POST /files/previews` | `files:read` | Load 1-8 authenticated previews as native MCP image blocks plus an ordered manifest |
| `mplus_resolve_istock_terms` | `POST /files/istock-terms/resolve` | `files:read` | Get offered iStock/Getty term ids and labels for 1-10 files |
| `mplus_set_istock_terms` | `POST /files/istock-terms/batch` | `metadata:write` | Dry-run or save one offered term id per keyword |
| `mplus_get_file` | `GET /files/{iid}` | `files:read` | One file: full metadata, metaver, statuses, validation |
| `mplus_update_metadata` | `PATCH /files/{iid}/metadata` | `metadata:write` | Merge-patch one file |
| `mplus_update_metadata_batch` | `POST /files/metadata:batch` | `metadata:write` | Up to 100 patches, per-item results, `dry_run` |
| `mplus_initialize_upload` | `POST /uploads/init` | `files:upload` | Initialize direct multipart upload of one local file |
| `mplus_set_status` | `POST /files/status:batch` | `status:write` | Set `ready`, `queued` or `ignored` for one agency; queued requires confirmation |
| `mplus_create_folder` | `POST /folders` | `files:upload` | Create one folder below an existing parent |
| `mplus_export_csv` | `POST /exports/csv` | `csv:export` | CSV export (free formats) |
| `mplus_wait_for_events` | `GET /events` | `events:read` | Long-poll the event feed (up to 25 s) |
| — | `GET /events/stream` | `events:read` | **Not available yet**: Server-Sent Events |

Start a session with `mplus_get_account` (`GET /me`): it tells you which agencies are connected, their ids, and what the key may do. The MCP server lists only the tools its scopes allow. Paid AI tools are not offered.

## Workflows

### A. Audit a folder for missing or weak metadata

Read only; change nothing.

1. Find the folder: `mplus_list_folders` (`GET /folders`). Each folder shows its file count and how many files are in each status per agency.
2. List the problems. `mplus_list_files` includes subfolders by default; pass `recursive=false` only when the user means exactly one folder:
   - missing fields: `mplus_list_files` with `missing: ["title", "keywords"]` (`GET /files?folder=/foto/2026&recursive=true&missing=title,keywords`); a file matches if any listed field is missing;
   - too few keywords: `max_keywords: 6` finds files Shutterstock refuses (fewer than 7); `max_keywords: 4` finds files below the Adobe Stock and iStock minimum of 5;
   - per-agency problems: `agency` plus `status: "notready"` lists files whose metadata fails that agency's validation; `agencies.<id>.validation` on each file says why (for example `keywords_min` "Less than 7 keywords").
3. Read details for the files you report on: `mplus_get_file`, or `mplus_list_files` with `expand_metadata: true` (descriptions are left out of lists otherwise). Follow every `next_cursor` until `has_more=false` when the user asks about the whole portfolio. Load images with `mplus_get_previews` in batches of at most 8 IIDs; visual MCP clients receive image blocks, while other clients can use the five-minute `microstock.plus` fallback URL. Rerun the tool after expiry.
4. Report counts per problem and the worst files (name, iid, what is wrong), and propose fixes. Don't change anything until the user asks.

```bash
curl -s "https://microstock.plus/api/agent/v1/files?folder=/foto/2026&recursive=true&missing=title,keywords&limit=100" \
  -H "Authorization: Bearer $MPLUS_API_KEY"
curl -s "https://microstock.plus/api/agent/v1/files?folder=/foto/2026&recursive=true&agency=shutterstock&status=notready" \
  -H "Authorization: Bearer $MPLUS_API_KEY"
```

### B. Write or improve titles, descriptions and keywords

1. Read the file (`mplus_get_file`): current metadata, `metaver`, `type`, flags, validation per agency, and its inline authenticated preview. For several files use `mplus_get_previews` in batches of 8. Use the attached image pixels first. `preview_url` and `thumbnail_url` are five-minute fallback URLs on canonical `microstock.plus`; rerun the tool after expiry. Never forward the bearer key to a CDN.
2. Write metadata that describes what is actually visible. Don't guess places, dates, species or brands you can't confirm; ask the user.
3. Check it against the agency rules below and the user's connected agencies (`mplus_get_account`).
4. Save it as in workflow C. For one file you can use `mplus_update_metadata` (`PATCH /files/{iid}/metadata`) with `if_match_metaver`.

**Titles.** A plain, specific sentence: subject, action, setting, and mood or time when it matters, for example "Empty road through a golden autumn forest at sunrise". No keyword lists, no "stock photo", no ALL CAPS. Microstock+ allows 200 characters; some agencies want less (see the table).

**Descriptions.** One or two sentences that add context to the title: where, when, what is happening. Shutterstock uses this text and allows at most 200 characters and at least 5 words. Editorial captions usually need the place and the date, for example Shutterstock's format `CITY, COUNTRY - MONTH DD, YYYY: what happens`.

**Keywords.** One word or a short phrase per keyword, in English, most important first: the main subject, then what is visible (objects, people, actions, setting), then concepts (mood, season, use). No commas inside a keyword (the MCP tools refuse them), no repeats, no irrelevant or misleading words; spamming keywords gets files rejected. Microstock+ trims and de-duplicates them, lower-cases them if the user's setting says so, and accepts at most 50 per file.

**iStock keyword clarification.** After ordinary English keywords exist, call `mplus_resolve_istock_terms` for at most 10 files. Inspect each authenticated preview and choose exactly one id from the candidates returned for each keyword; labels distinguish meanings such as a fruit from a company. `unresolved_keywords` have no current candidate. A `pending` file has no usable candidate set: retry later. Call `mplus_set_istock_terms` with the returned `metaver` and `candidate_set_id`, first with `dry_run=true`. Show the keyword-to-label choices and save with `dry_run=false` only after the owner asks. Never invent ids or reuse a candidate set after metadata changes. Omitted keywords retain only existing choices that remain valid. This provider lookup and metadata save are not paid Microstock+ AI.

| Agency (`id`) | Keywords | Titles and descriptions | Notes |
| - | - | - | - |
| Adobe Stock (`adobestock`) | 5-49 | title up to 200 characters | Order matters: Adobe weights the first keywords most, so put the 10 most important first. |
| Shutterstock (`shutterstock`) | 7-50 | description up to 200 characters, at least 5 words | Prefer single words over phrases. |
| iStock (`esp`) | 5-49 | title up to 255 characters | iStock maps keywords onto Getty's controlled vocabulary when the file is submitted; words that don't map are dropped or need disambiguation in iStock. Use common English nouns and adjectives. |
| Pond5 (`pond5`) | 1-50, at most 79 words in total | title 3-80 characters, description up to 500 | Microstock+ checks releases before files go to Pond5 (Pond5 release guard). |
| Dreamstime (`dreamstime`) | 10-80 | title up to 130 characters | |
| Alamy (`alamy`) | at least 3 | title up to 150 characters | |
| Depositphotos (`depositphotos`) | at least 8 | title and description 6-250 characters | |

These numbers are Microstock+'s validation settings at the time of writing. The `validation` list that the API returns for each agency on each file is the authority; per-agency validation is reported, not enforced, so an over-limit description is flagged, never cut.

**AI-generated content.**

- Set `ai_generated: true` for anything made with generative AI. Microstock+ then sets `editorial: false` (AI content is never editorial; asking for both is refused) and passes the flag to agencies that have one, such as Adobe Stock's generative AI flag.
- Describe what the image shows. Don't present AI images as photos of real events, places or people, and don't add tool names such as Midjourney or Stable Diffusion as keywords.
- Agencies' AI policies differ and change, and some agencies don't accept generative AI content at all. Check each agency's validation and point out to the user the agencies that refuse such content.

**Trademarks and people.** In commercial (non-editorial) content, keep brand names, logos, product names, characters, artworks and the names of real people out of titles, descriptions and keywords. Editorial content may name them factually.

**Categories and releases.** A file has at most 3 categories, each `{"cat": 16, "sub": 7}` (Nature, Plants and trees) from the table in the reference below; leave out `sub` when no subcategory fits. Releases are ids such as `rel_123` that the API can't list: copy them from files that already have the right ones, or leave them to the user.

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

### D. Statuses and uploads

Read statuses with `mplus_list_files` and `mplus_get_file`. With `status:write`, call `mplus_set_status` for one `agency`: `ready`, `ignored`, or `queued`. `queued` sends the files to that agency, so show the exact files and agency, obtain explicit approval, and pass `user_confirmed: true`. Do not set progress or review-result states manually. To upload a new local file into M+, create a missing destination with `mplus_create_folder`, initialize with `mplus_initialize_upload`, transfer all missing chunks, then call the returned finish endpoint. Never submit a remote source URL.

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

Paid CSV layouts of My Files, such as the Shutterstock and Pond5 CSVs, are not available through the API. An export holds at most 500 files (`export_too_large` otherwise): split bigger folders by subfolder.

### F. Microstock+ AI keywording (not available yet)

Microstock+'s own paid AI keywording (a free price quote, then a paid run, then job progress) is not available through the Agent API yet: its endpoints answer `403 endpoint_disabled` and keys can't get `ai:quote` or `ai:run`. Don't offer or promise it, and never say that you started it or paid for it. Instead, write the titles, descriptions and keywords yourself with workflows B and C, or tell the user that they can start AI keywording in My Files. When it arrives here, it will need the user's explicit confirmation of a quoted price.

### G. Watch events and report progress

The event feed currently shows the changes made through the Agent API (metadata updates and exports by agents) and agent key changes. Events about status changes, uploads, submissions, reviews and AI jobs belong to the contract but are not reported yet. Each event has `id`, `type`, `created_at`, `actor` (`agent` with the key's prefix and name, `user`, or `system`) and `data`.

| Type | `data` | Reported now |
| - | - | - |
| `file.metadata.updated` | `iids`, `fields`, `count`, `folder` | yes |
| `export.ready` | `export_id`, `rows`, `format` | yes |
| `key.created`, `key.revoked` | `key_prefix`, `key_name` | yes |
| `file.status.changed` | `iids`, `agency`, `from`, `to`, `count` | not yet |
| `file.uploaded`, `file.submitted` | `iids`, `agency`, `count` | not yet |
| `file.reviewed` | `iids`, `agency`, `result` (`approved` or `rejected`), `reason` | not yet |
| `ai.quote.created` | `quote_id`, `files`, `amount_eur` | not yet |
| `ai.job.started`, `ai.job.completed`, `ai.job.failed` | `job_id`, `files_total`, `files_done`, `files_failed`, `amount_eur_charged` | not yet |

1. `mplus_wait_for_events` without a cursor returns the most recent events; with `types` it returns only those (`GET /events?types=file.metadata.updated,export.ready`).
2. Keep calling it with `cursor` set to the previous `next_cursor` (`GET /events?since=<next_cursor>&wait=25`). Each call waits up to 25 seconds and returns as soon as something happens; `has_more: true` means call again at once.
3. Report in plain words ("keywords updated on 38 files in /foto/2026; the CSV with 120 rows is ready") and stop when the user's goal is reached or the user asks.

Events are kept for 7 days. The Server-Sent Events stream (`GET /events/stream`) is not available yet (`403 endpoint_disabled`); long-poll `GET /events` with `wait` instead. MCP clients that ask for log messages also receive notable events as `notifications/message`.

```bash
curl -s "https://microstock.plus/api/agent/v1/events?since=evt_01J9Z3&types=file.metadata.updated,export.ready&wait=25" \
  -H "Authorization: Bearer $MPLUS_API_KEY"
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

Also `size_bytes`, `created_at`, `updated_at`, `archived`, `preview_url`, `thumbnail_url`; `type` is `raster`, `vector` or `video`. An agency entry can also carry `reviewed_at`, `scheduled_at` and `rejection_reasons`. The full schemas are in the OpenAPI document.

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
| `approved`, `rejected` | Review result; `rejection_reasons` on the agency entry says why, when the agency gave a reason |
| `approvalfailed` | Submitted, but missing at the agency |
| `notready` | Metadata fails that agency's validation |
| `scheduled` | An upload is scheduled for that agency |
| `cannotbequeued` | Still processing, or a required format is missing |
| `nosubmissions` | The submission limit is used up |

### Agency ids

Use the ids from `GET /me` (`mplus_get_account`); the common ones are `adobestock` (Adobe Stock), `shutterstock`, `esp` (iStock), `pond5`, `alamy`, `dreamstime`, `123rf` and `depositphotos`.

### Category ids

Set categories as `{"cat": <id>, "sub": <id>}`, at most 3 per file; leave out `sub` when no subcategory fits. The ids are fixed: new ones are only ever added.

| `cat` | Category | `sub` ids |
| - | - | - |
| 1 | Abstract | 1 Miscellaneous, 2 Backgrounds, 3 Lights and Colors, 4 Shapes, 5 Blurs |
| 2 | Animals/Wildlife | 1 Birds, 2 Pets, 3 Sea and Ocean life, 4 Insects, 5 Farm animals, 6 Miscellaneous |
| 3 | Backgrounds/Textures | 1 Textures, 2 Backgrounds, 3 Miscellaneous |
| 4 | Beauty/Fashion | 1 Clothing, 2 Parfume, 3 Miscellaneous |
| 5 | Buildings/Landmarks | 1 Miscellaneous, 2 Historic buildings, 3 Indoor, 4 Outdoor, 5 Modern Building |
| 6 | Business/Finance | 1 Miscellaneous, 2 Financial, 3 People, 4 Objects |
| 7 | Celebrities | 1 Miscellaneous, 2 Holidays |
| 8 | Education | 1 Miscellaneous, 2 Objects, 3 School, College, University etc |
| 9 | Food and Drink | 1 Miscellaneous, 2 Food, 3 Drink |
| 10 | Healthcare/Medical | 1 Miscellaneous, 2 Objects |
| 11 | Holidays | 1 Miscellaneous, 2 Objects |
| 12 | Illustrations/Clip-Art | 1 Miscellaneous, 2 2D, 3 3D, 4 Vector |
| 13 | Industrial | 1 Miscellaneous, 2 Power and Energy, 3 Construction, 4 Manufacturing, 5 Military |
| 14 | Interiors | 1 Miscellaneous, 2 Objects, 3 Furniture |
| 15 | Miscellaneous | 1 Miscellaneous |
| 16 | Nature | 1 Miscellaneous, 2 Sky, 3 Sea/Ocean/River, 4 Parks, 5 Flowers, 6 Underwater, 7 Plants and trees |
| 17 | Objects | 1 Miscellaneous, 2 Electronics, 3 Isolated, 4 Sports |
| 18 | Parks/Outdoor | 1 Miscellaneous |
| 19 | People | 1 Miscellaneous, 2 Babies, 3 Men, 4 Women, 5 Families, 6 Teens |
| 20 | Religion | 1 Miscellaneous |
| 21 | Science | 1 Miscellaneous |
| 22 | Signs/Symbols | 1 Miscellaneous |
| 23 | Sports/Recreation | 1 Miscellaneous |
| 24 | Technology | 1 Miscellaneous, 2 Computers, 3 Electronics |
| 25 | The Arts | 1 Miscellaneous |
| 26 | Transportation | 1 Miscellaneous, 2 Cars, 3 Trucks, 4 Water transport, 5 Airplanes |
| 27 | Vintage | 1 Miscellaneous |

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
| 403 | `permission_error` | `scope_required`, `not_owner`, `endpoint_disabled` | Tell the user which scope is missing; don't work around it. `endpoint_disabled`: the feature is not available yet; say so and don't retry. |
| 404 | `not_found_error` | `file_not_found`, `folder_not_found`, `export_not_found`, `not_found` | Check the id or path; list again. `not_found` on every call: the Agent API is not switched on for this account yet. |
| 405 | `permission_error` | `deletion_not_supported` | Deleting is manual in the web interface. Tell the user so. |
| 409 | `conflict_error` | `metadata_conflict`, `idempotency_mismatch`, `file_archived`, `file_processing` | Re-read and merge; use a fresh Idempotency-Key for a different request. Archived files can't be changed; files still processing can be changed later. |
| 429 | `rate_limit_error` | `rate_limited` | Wait `retry-after` seconds, then retry once. |
| 5xx | `api_error` | `upstream_unavailable`, `api_not_configured` | Try again later; report the `request_id` if it persists. |

Batch endpoints answer `200` with per-item errors (for example `metadata_conflict` in a metadata batch); check `results[].ok`.

### Rate limits

Per key: 120 requests per minute and 30 mutations (POST and PATCH) per minute. Every response carries `x-ratelimit-limit-requests`, `x-ratelimit-remaining-requests` and `x-ratelimit-reset-requests` (seconds). A batch of up to 100 items is one request, so batch changes instead of patching files one by one. On `429`, wait `retry-after` seconds and retry once; the MCP server does this by itself for waits of up to 20 seconds.

## What the Agent API does not do

**Not available yet** (part of the contract; don't offer or promise them):

- Changing statuses, including sending files to agencies for upload and submit.
- Microstock+ AI keywording: price quotes, paid runs and job progress.
- The Server-Sent Events stream, and events about status changes, uploads, submissions, reviews and AI jobs.
- The account balance (`balance_eur` is `null`).

**Not in v1:**

- Uploading new files, creating or moving folders, archiving.
- Listing releases or AI keywording templates.
- Paid CSV layouts.
- Working with other users' accounts or with folders shared by other people.
- Creating, rotating or revoking agent keys through the API (only on https://microstock.plus/ai-agent-skills).
- Changing account settings, plans or the balance.
- Webhooks; use the event feed instead.

**Never:** deleting anything: files, folders, releases, templates, agencies, the account. Deleting is manual in the web interface.

# Microstock+ Agent API v1 — contract

Status: draft for implementation (2026-10-02). Owner: Qwertystock / Microstock+.
This document is the single source of truth for: the M+ server implementation,
the MCP server, the Claude plugin, and the public "AI Agent Skills" page.

## 1. Principles

1. **An agent acts as the user, with less power than the user.** Every call is scoped
   to the key owner's own account. No target-user / shared-folder impersonation in v1.
2. **No deletion, ever.** There is no endpoint, scope, status or flag that removes
   files, folders, releases, templates, agencies or the account. Deleting stays a
   manual action in the Microstock+ web interface. Any `DELETE` request returns
   `405 deletion_not_supported`.
3. **Money needs a human.** Paid actions (AI keywording run, paid CSV) require a
   separate scope that is off by default, a quote first, and an `Idempotency-Key`.
4. **Structured, predictable responses** in the OpenAI API style: typed objects,
   a uniform error envelope, cursor pagination, request ids, rate-limit headers.
5. **Everything an agent changes is visible to the user in real time** (event feed +
   popup queue in My Files) and is recorded in an audit log with the key prefix.

## 2. Authentication

- Header: `Authorization: Bearer mpk_live_<prefix>_<secret>`
  - `prefix`: 8 lowercase hex chars (shown in the UI, used in logs);
  - `secret`: 32 bytes, base64url (43 chars).
- Keys are created by the signed-in user on `https://microstock.plus/ai-agent-skills`
  (section "Agent keys"). The full key is shown **once**. Users may hold up to 10
  active keys, each with a name, scopes, created/last-used time, request count.
- Storage: `HMAC-SHA256(MPLUS_AGENT_API_KEY_PEPPER, key)` only; never the key.
  Missing pepper → the API answers `503 api_not_configured` (fail closed).
- Rotate = new secret, same name/scopes; Revoke = immediate (cache ≤ 30 s).
- Cookies and session auth are **ignored** on `/api/agent/v1/*`.

### Scopes

| Scope | Allows | Default |
|---|---|---|
| `account:read` | `GET /me` | on |
| `files:read` | folders, files, file details, validation | on |
| `metadata:write` | metadata patch / batch | on |
| `status:write` | status batch (`ready`, `queued`, `ignored`) | opt-in |
| `files:upload` | create folders and initialize direct uploads | opt-in |
| `csv:export` | free CSV exports | on |
| `events:read` | event feed / stream | on |
| `ai:quote` | AI keywording price quote | on |
| `ai:run` | AI keywording run (charges the balance) | **off** |

There is no `delete` scope and none can be added.

## 3. Conventions

- Base URL: `https://microstock.plus/api/agent/v1`
- JSON in and out, UTF-8. Every object has `"object": "<type>"`.
- Times: ISO-8601 UTC strings (`2026-10-02T08:15:00Z`).
- Lists: `{"object": "list", "data": [...], "has_more": true, "next_cursor": "..."}`;
  pass `cursor=<next_cursor>`; `limit` 1–200 (default 50).
- Request id: response header `x-request-id` (also inside errors).
- Idempotency: `Idempotency-Key: <uuid>` on any POST/PATCH; replay within 24 h returns
  the stored response with header `idempotent-replayed: true`.
- Rate limits (per key): 120 requests/min, 30 mutations/min, 2 concurrent streams.
  Headers: `x-ratelimit-limit-requests`, `x-ratelimit-remaining-requests`,
  `x-ratelimit-reset-requests` (seconds).
- Optimistic concurrency for metadata: every file has `metaver`; send
  `if_match_metaver` to fail with `409 metadata_conflict` instead of overwriting a
  newer edit.

### Error envelope

```json
{"error": {"type": "invalid_request_error", "code": "keywords_too_many",
           "message": "Shutterstock accepts at most 50 keywords.", "param": "keywords",
           "request_id": "req_7f3c..."}}
```

| HTTP | `type` | typical `code` |
|---|---|---|
| 400 | `invalid_request_error` | `invalid_json`, `missing_param`, `invalid_status`, `batch_too_large` |
| 401 | `authentication_error` | `invalid_api_key`, `revoked_api_key` |
| 403 | `permission_error` | `scope_required`, `not_owner`, `agent_api_disabled` |
| 404 | `not_found_error` | `file_not_found`, `folder_not_found`, `job_not_found` |
| 405 | `permission_error` | `deletion_not_supported` |
| 409 | `conflict_error` | `metadata_conflict`, `quote_expired`, `idempotency_mismatch` |
| 429 | `rate_limit_error` | `rate_limited` (+ `retry-after`) |
| 5xx | `api_error` | `upstream_unavailable` |

## 4. Objects

### `file`

```json
{
  "object": "file",
  "iid": "6abc74e948864d403ea0c559",
  "type": "raster",                  // raster | vector | video
  "folder": "/foto/26_10_01/N-",
  "filename": "IMG_0042.jpg",
  "size_bytes": 8423311,
  "created_at": "2026-10-01T09:12:00Z",
  "archived": false,
  "preview_url": "https://...",
  "thumbnail_url": "https://...",
  "metaver": 7,
  "metadata": {
    "title": "Autumn forest road at sunrise",
    "description": "Empty road through a golden autumn forest ...",
    "keywords": ["autumn", "forest", "road", "sunrise"],
    "categories": [{"cat": 12, "sub": 3}],
    "editorial": false,
    "ai_generated": false,
    "illustration": false,
    "releases": ["rel_123"],
    "notes": ""
  },
  "agencies": {
    "esp":          {"status": "submitted", "external_id": "123456", "uploaded_at": "...", "submitted_at": "...", "errors": []},
    "shutterstock": {"status": "ready", "errors": [], "validation": [{"code": "keywords_min", "message": "Less than 7 keywords"}]}
  },
  "has_ai_metadata": true
}
```

Agency ids are the ones M+ uses internally (`adobestock` = Adobe Stock, `esp` = iStock / Getty ESP,
`shutterstock`, `pond5`, `alamy`, `dreamstime`, ...). `GET /me` lists the user's connected ones.

Status values (read): `ready, ignored, queued, uploading, uploaded, uploadfailed,
submitted, submitfailed, approved, rejected, approvalfailed, notready, scheduled,
cannotbequeued, nosubmissions`. Status values an agent may **set**: `ready`,
`queued` (= send to upload/submit), `ignored`.

### `folder`

`{"object": "folder", "path": "/foto/2026", "file_count": 412, "subfolder_count": 3, "status_summary": {"esp": {"ready": 120, "submitted": 280}}}`

### `event`

```json
{"object": "event", "id": "evt_01J9...", "type": "file.metadata.updated",
 "created_at": "2026-10-02T08:15:00Z",
 "actor": {"kind": "agent", "key_prefix": "a1b2c3d4", "key_name": "Claude Code"},
 "data": {"iids": ["..."], "fields": ["keywords", "title"], "count": 12, "folder": "/foto/2026"}}
```

Event types: `file.metadata.updated`, `file.status.changed` (data: agency, from, to),
`file.uploaded`, `file.submitted`, `file.reviewed` (approved/rejected + reason),
`ai.quote.created`, `ai.job.started`, `ai.job.completed`, `ai.job.failed`,
`export.ready`, `key.created`, `key.revoked`.

## 5. Endpoints

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/me` | account:read | account, plan, connected agencies, limits, key info |
| GET | `/folders` | files:read | folder tree (`archive=false`) |
| POST | `/folders` | files:upload | create one folder below an existing parent |
| GET | `/files` | files:read | list/search files |
| GET | `/files/{iid}` | files:read | one file with metadata, statuses, validation |
| PATCH | `/files/{iid}/metadata` | metadata:write | merge-patch metadata of one file |
| POST | `/files/metadata:batch` | metadata:write | up to 100 patches, per-item results, `dry_run` |
| POST | `/files/status:batch` | status:write | set `ready`/`queued`/`ignored` for agencies |
| POST | `/uploads/init` | files:upload | create a short-lived direct upload ticket |
| POST | `/exports/csv` | csv:export | build a CSV (free formats) |
| POST | `/ai/keywording:quote` | ai:quote | disabled; outside the agent release |
| POST | `/ai/keywording:run` | ai:run | disabled; outside the agent release |
| GET | `/jobs/{id}` | files:read | disabled; outside the agent release |
| GET | `/events` | events:read | long-poll feed (`since`, `wait` ≤ 25 s) |
| GET | `/events/stream` | events:read | Server-Sent Events, `Last-Event-ID` resume |
| any | `DELETE ...` | — | always `405 deletion_not_supported` |

### GET /files — query

`folder` (path, default `/`), `recursive` (bool), `search` (text or iids),
`type` (raster|vector|video), `agency` + `status` (e.g. `agency=esp&status=ready`),
`missing` (`title|description|keywords|categories`), `min_keywords`/`max_keywords`,
`archived` (default false), `updated_since`, `limit`, `cursor`.
Returns `file` objects without `metadata.description` unless `expand=metadata`.

### PATCH /files/{iid}/metadata — body

```json
{"title": "...", "description": "...",
 "keywords": {"set": ["a", "b"]},            // or {"add": [...]} / {"remove": [...]}
 "categories": [{"cat": 12, "sub": 3}],
 "editorial": false, "ai_generated": true, "illustration": false,
 "releases": {"add": ["rel_123"]},
 "notes": "...",
 "if_match_metaver": 7}
```

Rules (server-enforced): keywords are trimmed, lower-cased only if the user's setting
says so, de-duplicated, max 50 by default (per-agency validation is returned, not
enforced); title ≤ 200 chars; description ≤ 200 chars for stocks with that limit is
reported as validation, not cut; `ai_generated=true` forces `editorial=false` and is
shown as "AI generated" in My Files; empty strings never silently clear a field
(use `"title": null` to clear explicitly). Returns the updated `file`.

### POST /files/metadata:batch

`{"items": [{"iid": "...", "patch": {...}, "if_match_metaver": 7}], "dry_run": false}` →
`{"object": "batch_result", "results": [{"iid": "...", "ok": true, "file": {...}} | {"iid": "...", "ok": false, "error": {...}}], "succeeded": 98, "failed": 2}`.
`dry_run=true` validates and returns the would-be metadata without writing.

### POST /files/status:batch

`{"iids": [...], "agency": "shutterstock", "status": "queued", "user_confirmed": true}` → per-item results.
Only connected agencies; Pond5 release guard and M+ submission limits apply exactly as
in the web UI (`nosubmissions` is returned as an item error, not a crash).

### POST /folders

`{"directory":"/foto/2026/new-shoot"}` creates one folder below an existing parent.
It cannot delete, rename or overwrite files or folders. Required scope: `files:upload`.

### POST /exports/csv

`{"iids": [...]} | {"folder": "/x", "recursive": true}` + `"format"`:
`default | with_title | importable | with_release_names | without_categories | nimia | alamy`,
`"delimiter": "comma" | "semicolon"` → `{"object": "export", "format": "...", "rows": 120,
"download_url": "https://microstock.plus/api/agent/v1/exports/exp_.../download", "expires_at": "..."}`.
With `Accept: text/csv` the CSV is returned directly. Paid CSV formats are not in v1.

### POST /uploads/init

`{"filename":"photo.jpg","size_bytes":123456,"content_type":"image/jpeg","directory":"/foto/2026"}`
returns a short-lived `upload` ticket. Transfer the local binary directly to
`upload.chunk.url` with its `method`, `form_fields` and `file_field`, then call the
returned `upload.finish` endpoint. The destination directory must already exist.
The endpoint does not accept a remote source URL and never downloads an arbitrary URL.

### AI keywording

These endpoints are disabled and are not published as MCP tools in 1.2.0. They remain
in this contract only as reserved compatibility paths; paid AI is outside this release.

1. `POST /ai/keywording:quote {"iids": [...], "mode": "replace|skip", "template_id": null}` →
   `{"object": "ai_quote", "quote_id": "...", "files": 40, "amount_eur": 1.20, "expires_at": "..."}`
2. `POST /ai/keywording:run {"quote_id": "..."}` with `Idempotency-Key` (scope `ai:run`) →
   `{"object": "job", "id": "...", "status": "queued"}`; progress via `GET /jobs/{id}` or events.
   Charged only for successful files at the quoted price.

### Events

- `GET /events?since=<event id or empty>&types=file.status.changed,ai.job.completed&wait=25`
  → `{"object": "list", "data": [event...], "next_cursor": "..."}`
- `GET /events/stream` → `text/event-stream`; each event: `id:`, `event: <type>`,
  `data: <event json>`; heartbeat comment every 20 s; resume with `Last-Event-ID`.
- Retention: 7 days.

## 6. My Files popup queue (web UI) — planned, not in the v1 MVP

The signed-in user's open My Files page subscribes to the same feed (session-auth
endpoint) and shows a **queue of popups** (bottom-right, max 3 visible, newest on top,
auto-hide 8 s, click = filter My Files by the affected iids):
`🤖 Claude Code · keywords updated on 12 files in /foto/2026 · just now`.
A badge counts unseen agent events. There is no undo button: an agent reverts a
change by writing back the values it read before the change.

## 7. MCP server

Tools (names stable): `mplus_get_account`, `mplus_list_folders`, `mplus_list_files`,
`mplus_get_file`, `mplus_update_metadata`, `mplus_update_metadata_batch`,
`mplus_initialize_upload`, `mplus_export_csv`, `mplus_wait_for_events`. Optional
status tools appear only when production scopes enable them. Paid AI tools are outside
the published catalogue. Every tool declares `outputSchema` and returns
`structuredContent`; annotations: reads `readOnlyHint: true`; writes
`destructiveHint: false, idempotentHint: true` (status/metadata are reversible);
no tool can delete.

## 8. Session-auth endpoints for the web UI (signed-in user, same-origin only)

M+ has no CSRF middleware, so these require `Origin`/`Referer` = `https://microstock.plus`
(or the configured public base) and an XHR header `X-Requested-With: XMLHttpRequest`.

| Method | Path | Body | Answer |
|---|---|---|---|
| GET | `/ajax/agentkeys/list` | — | `{"ok": 1, "keys": [{"id", "name", "prefix", "scopes", "status", "created_at", "last_used_at", "request_count"}]}` |
| POST | `/ajax/agentkeys/create` | `{"name", "scopes": [...]}` | `{"ok": 1, "key": "mpk_live_…", "item": {...}}` — full key only here |
| POST | `/ajax/agentkeys/rotate` | `{"id"}` | `{"ok": 1, "key": "mpk_live_…", "item": {...}}` |
| POST | `/ajax/agentkeys/revoke` | `{"id"}` | `{"ok": 1}` |
| GET | `/ajax/agentevents?since=` | — | `{"ok": 1, "events": [event...], "cursor": "..."}` for the popup queue |

## 9. Public page and downloads

- `GET /ai-agent-skills` — human landing (ru/en/uk/fr), anonymous allowed; signed-in users
  also see the "Agent keys" section.
- `GET /ai-agent-skills/skill.md` — raw agent instructions (`text/markdown`), `?download=1`
  adds `Content-Disposition: attachment; filename="AI Agent Skills.md"`.
- `GET /ai-agent-skills/mplus-mcp.mjs` — the single-file MCP server (`?download=1`).
- `GET /api/agent/v1/openapi.json` — OpenAPI 3.1 description of section 5 (public).

## 10. Audit

Every call: key prefix, user id, operation, iid count (iids capped at 50 in the log),
idempotency key, IP, user agent, result code. Mutations also emit events.

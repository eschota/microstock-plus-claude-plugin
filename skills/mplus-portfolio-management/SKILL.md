---
name: mplus-portfolio-management
description: Manage a stock contributor's Microstock+ (M+) portfolio with the microstock-plus tools - inspect files and previews, audit or edit metadata, initialize direct uploads of local files, check agency statuses, export CSV, and follow events. Use when the user mentions Microstock+, M+, microstock.plus, their portfolio, My Files, uploads, metadata, statuses, rejections, previews, or CSV exports.
---

# Manage a Microstock+ portfolio

If MCP tools are absent and the user provided an agent token, use the `mplus-connect` skill first and execute these workflows through their documented HTTP API equivalents. Do not require MCP installation before API work.

Microstock+ keeps the user's stock photos, vectors and videos with their titles, descriptions and keywords, checks the metadata against each agency's rules, and uploads and submits files to agencies. The `microstock-plus` tools act on the account that owns the configured agent key, with less power than the user. For writing metadata, follow the `mplus-keywording` skill.

## Start

- Call `mplus_get_account` first. It returns the connected agencies with the ids every other tool expects (for example `adobestock` = Adobe Stock, `esp` = iStock, `shutterstock`, `pond5`), keyword settings, limits, and what this key may do.
- Find files with `mplus_list_folders` (folder tree with per-agency status counts) and `mplus_list_files` (subfolders included by default; filters: `folder` + `recursive`, `search` or `iids`, `type`, `agency` + `status`, `missing`, `min_keywords` / `max_keywords`). Follow `next_cursor` until the requested scope is complete. Read one file with `mplus_get_file`; load several authenticated images with `mplus_get_previews` in batches of up to 8 IIDs. Use attached image pixels first; canonical fallback links expire after five minutes, so rerun the tool rather than trying a raw preview-CDN URL.
- Every result has a `summary` that says what happened and what to call next, including the `cursor` for the next page.

## Rules

1. **Nothing can be deleted.** No tool deletes anything. If the user asks to delete files, folders or anything else, say that deleting is done by hand in the Microstock+ web interface (My Files). Never claim that something was deleted.
2. **File upload is direct and scoped.** Call `mplus_initialize_upload` only for a local file the user selected. Transfer its bytes directly to the returned `upload.chunk` endpoint, then call `upload.finish`. Never provide a remote source URL. The destination directory must already exist.
3. **Nothing paid.** Microstock+ AI keywording is not available through the tools yet either, so nothing you can do costs money. Write metadata yourself with the `mplus-keywording` skill.
4. **Preview metadata batches** with `dry_run: true` before applying them, and pass `if_match_metaver`.
5. **Keep credentials out of the conversation.** OAuth clients use the Microstock+ login. Direct API clients use the token the user supplied for this connection. Never echo it; use a private secret store or authorized private client configuration, never a shared/project file.

## Audit a folder

Change nothing; report and propose.

1. `mplus_list_files` with the folder, `recursive: true` and:
   - `missing: ["title", "description", "keywords"]` for empty fields;
   - `max_keywords: 6` for files Shutterstock refuses (it needs 7) and `max_keywords: 4` for files under the Adobe Stock and iStock minimum of 5;
   - `agency` + `status: "notready"` for each connected agency, for files that fail its validation.
2. Page through `next_cursor`. Read the worst files with `mplus_get_file`: `agencies.<id>.validation` says what is wrong, for example `keywords_min` "Less than 7 keywords".
3. Report a short table (problem, number of files), then the worst files (name, iid, problem), and propose fixes, for example writing the missing metadata with the `mplus-keywording` skill.

## Statuses and rejections

- Find files by status with `mplus_list_files`, `agency` + `status`: for example `rejected` on `adobestock`, `notready` on `shutterstock`, or `submitted` (in review).
- Read the details with `mplus_get_file`: per agency `validation`, `errors` and `rejection_reasons` when the agency gave a reason.
- With `status:write`, `mplus_set_status` can set `ready`, `ignored` or `queued` for one agency and up to 100 files. `queued` starts upload/submission to that agency: show the exact files and agency, obtain explicit user approval, then pass `user_confirmed: true`. Never set upload progress or review-result states manually.

## Export CSV

`mplus_export_csv` exports up to 500 files from `iids` or a `folder`. Formats are the layouts of Export CSV in My Files: `default` (agency upload forms), `with_title`, `importable` (re-import into Microstock+), `with_release_names`, `without_categories`, `nimia` (Nimia footage), `alamy` (Alamy video); paid layouts such as the Shutterstock and Pond5 CSVs are not available. Delimiter `comma` for agencies or `semicolon` for Excel. With `include_csv: true` the CSV text comes back in the `csv` field: save it unchanged as a `.csv` file when you can write files, and tell the user where it is. Otherwise give the `download_url`, which works with the agent key until `expires_at`. Split bigger exports by subfolder.

## Upload a local file

1. Determine the exact file name, byte size and MIME type locally, and ask which Microstock+ directory to use when it is ambiguous. If it does not exist, create it with `mplus_create_folder`.
2. Call `mplus_initialize_upload` with only `filename`, `size_bytes`, `content_type` and `directory`.
3. Send the local binary to `upload.chunk.url` using its `method`, `form_fields` and `file_field`, then call `upload.finish` as returned. Never invent endpoints or send a remote URL.
4. Re-read the new file or follow events and report its iid and preview links when they become available.

## Follow changes

1. Call `mplus_wait_for_events` without a cursor for the most recent events, with `types` to narrow them, for example `["file.metadata.updated", "export.ready"]`. Microstock+ currently reports the changes made through the Agent API and agent key changes; upload, submission and review events are not reported yet.
2. Call it again with `cursor` set to the previous `next_cursor`. Each call waits up to 25 seconds and returns as soon as something happens.
3. Report in plain words, for example "keywords updated on 38 files in /foto/2026; the CSV with 120 rows is ready".

## When the tools are missing or fail

- **No `mplus_*` tools.** In Claude Code run `/mcp` and check that the `microstock-plus` server of the plugin is connected; it needs Node.js 18 or newer. In claude.ai chat and Cowork the plugin's local server does not run; explain that and point to https://microstock.plus/ai-agent-skills.
- **"No Microstock+ agent key is configured"** or **`invalid_api_key` / `revoked_api_key`**: the user creates a key at https://microstock.plus/ai-agent-skills (section "Agent keys") and enters it with `/plugin configure microstock-plus@microstock-plus`, then restarts the session.
- **`scope_required`**: the key lacks a permission. The user can create a key with that scope; don't work around it.
- **"Not available yet"** (`not_available_yet` or `endpoint_disabled`): status changes and AI keywording are not in the Agent API yet. Say so; don't retry.
- **`404 not_found` on every call**: the Agent API is not switched on for this account yet (agent keys open gradually); point to https://microstock.plus/ai-agent-skills.
- **`rate_limited`**: wait, then continue with fewer, larger batches.

The complete reference, with every endpoint and error code, is `${CLAUDE_PLUGIN_ROOT}/docs/AI_AGENT_SKILLS.md`, also published at https://microstock.plus/ai-agent-skills/skill.md.

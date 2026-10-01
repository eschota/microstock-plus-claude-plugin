---
name: mplus-portfolio-management
description: Manage a stock contributor's Microstock+ (M+) portfolio with the microstock-plus tools - audit folders for missing or weak metadata, check per-agency statuses and validation, queue uploads to stock agencies such as Adobe Stock, Shutterstock, iStock and Pond5 after the user approves, export metadata as CSV, and follow uploads, reviews and AI jobs through the event feed. Use when the user mentions Microstock+, M+, microstock.plus, their stock portfolio or My Files, uploading or submitting files to stock agencies, file statuses, rejections, or CSV exports.
---

# Manage a Microstock+ portfolio

Microstock+ keeps the user's stock photos, vectors and videos with their titles, descriptions and keywords, checks the metadata against each agency's rules, and uploads and submits files to agencies. The `microstock-plus` tools act on the account that owns the configured agent key, with less power than the user. For writing metadata and for paid AI keywording, follow the `mplus-keywording` skill.

## Start

- Call `mplus_get_account` first. It returns the connected agencies with the ids every other tool expects (for example `adobestock` = Adobe Stock, `esp` = iStock, `shutterstock`, `pond5`), keyword settings, limits, and what this key may do.
- Find files with `mplus_list_folders` (folder tree with per-agency status counts) and `mplus_list_files` (filters: `folder` + `recursive`, `search` or `iids`, `type`, `agency` + `status`, `missing`, `min_keywords` / `max_keywords`). Read one file with `mplus_get_file`.
- Every result has a `summary` that says what happened and what to call next, including the `cursor` for the next page.

## Rules

1. **Nothing can be deleted.** No tool deletes anything. If the user asks to delete files, folders or anything else, say that deleting is done by hand in the Microstock+ web interface (My Files). Never claim that something was deleted.
2. **Ask before sending files to agencies.** Queueing uploads and submits files to external agencies. Show which files go to which agencies, get an explicit yes, then call `mplus_set_status` with `status: "queued"` and `user_confirmed: true`.
3. **Money needs the user's confirmation.** AI keywording is paid; follow the `mplus-keywording` skill.
4. **Preview metadata batches** with `dry_run: true` before applying them, and pass `if_match_metaver`.
5. **Keep the agent key out of the conversation.** Never ask the user to paste it into the chat. In Claude Code they set it with `/plugin configure microstock-plus@microstock-plus`.

## Audit a folder

Change nothing; report and propose.

1. `mplus_list_files` with the folder, `recursive: true` and:
   - `missing: ["title", "description", "keywords"]` for empty fields;
   - `max_keywords: 6` for files Shutterstock refuses (it needs 7) and `max_keywords: 4` for files under the Adobe Stock and iStock minimum of 5;
   - `agency` + `status: "notready"` for each connected agency, for files that fail its validation.
2. Page through `next_cursor`. Read the worst files with `mplus_get_file`: `agencies.<id>.validation` says what is wrong, for example `keywords_min` "Less than 7 keywords".
3. Report a short table (problem, number of files), then the worst files (name, iid, problem), and propose fixes, for example writing the missing metadata with the `mplus-keywording` skill.

## Queue uploads and set statuses

- Agents may set `ready` (prepared, not sent), `queued` (upload and submit) and `ignored` (never send to that agency), for up to 100 files per call.
- Before queueing, check that the files pass validation for each target agency and that the agencies are connected.
- Results come per file and agency. Report failures such as `nosubmissions` (the submission limit is used up) or the Pond5 release guard; don't retry them blindly.
- Then follow progress with `mplus_wait_for_events` (see below).

## Export CSV

`mplus_export_csv` exports up to 500 files from `iids` or a `folder`. Formats are the layouts of Export CSV in My Files: `default` (agency upload forms), `with_title`, `importable` (re-import into Microstock+), `with_release_names`, `without_categories`, `nimia`, `alamy`; delimiter `comma` for agencies or `semicolon` for Excel. With `include_csv: true` the CSV text comes back in the `csv` field: save it unchanged as a `.csv` file when you can write files, and tell the user where it is. Otherwise give the `download_url`, which works with the agent key until `expires_at`. Split bigger exports by subfolder.

## Follow progress

1. Call `mplus_wait_for_events` without a cursor for the most recent events, with `types` to narrow them, for example `["file.status.changed", "file.uploaded", "file.submitted", "file.reviewed"]` for uploads or `["ai.job.completed", "ai.job.failed"]` for an AI job.
2. Call it again with `cursor` set to the previous `next_cursor`. Each call waits up to 25 seconds and returns as soon as something happens.
3. Report in plain words, for example "12 of 40 files submitted to Adobe Stock; 2 rejected on Shutterstock: <reason>", and stop when the goal is reached or the user asks.

## When the tools are missing or fail

- **No `mplus_*` tools.** In Claude Code run `/mcp` and check that the `microstock-plus` server of the plugin is connected; it needs Node.js 18 or newer. In claude.ai chat and Cowork the plugin's local server does not run; explain that and point to https://microstock.plus/ai-agent-skills.
- **"No Microstock+ agent key is configured"** or **`invalid_api_key` / `revoked_api_key`**: the user creates a key at https://microstock.plus/ai-agent-skills (section "Agent keys") and enters it with `/plugin configure microstock-plus@microstock-plus`, then restarts the session.
- **`scope_required`**: the key lacks a permission. The user can create a key with that scope; don't work around it.
- **`rate_limited`**: wait, then continue with fewer, larger batches.

The complete reference, with every endpoint and error code, is `${CLAUDE_PLUGIN_ROOT}/docs/AI_AGENT_SKILLS.md`, also published at https://microstock.plus/ai-agent-skills/skill.md.

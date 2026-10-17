# Changelog

## 1.5.0 — 2026-10-17

- Added a canonical stock-metadata system prompt across the packaged skills, English and Russian guides, slash command, tool catalogue, and MCP instructions. Agents inspect each preview, write buyer-facing titles of at most 70 characters, and keep an exact 50-keyword relevant English master list with the strongest terms first.
- Added post-apply verification and agency readiness rules: re-read files for fresh validation, set Ready only for clean mutable pre-submission states, preserve ignored/held, progress, submission, review, failure and terminal states, and never treat Ready as permission to submit.
- Standalone MCP runtime 1.4.0 exposes the canonical prompt verbatim through legacy `initialize`, modern `server/discover`, stdio and Streamable HTTP. Plugin version is 1.5.0.

## 1.4.0 — 2026-10-13

- Add skill-plus-token onboarding through the direct Agent API, without running an MCP server. Capable agents can configure the existing remote MCP client afterward.
- Add a bounded read-only connection checker with secret-free client examples and separate API/configuration/tool-availability states. MCP runtime remains 1.3.1.

## 1.3.1 - 2026-10-13

- Added short-lived, owner-scoped preview links on `microstock.plus` as a fallback for agents that do not render native MCP image blocks. Each link is re-authorized when used and expires after five minutes.
- Removed raw preview-CDN URLs from file and preview tool results. Agents receive native image blocks first and the canonical fallback link only when it is available.
- Kept preview failures partial: metadata remains usable, while the preview manifest reports an unavailable state instead of leaking or retrying the source CDN URL.

## 1.3.0 - 2026-10-13

- Added `mplus_get_previews` and `POST /files/previews`: up to eight owner-scoped previews are returned as native MCP image blocks with an ordered compact manifest, partial processing/unavailable states and a 2 MiB decoded-image limit. Base64 image data is never duplicated in text or `structuredContent`.
- `mplus_get_file` now loads one authenticated preview inline for clients with cached tool lists; preview failure leaves the file metadata available. `mplus_list_files` includes subfolders by default unless `recursive=false`, and the guides require following every `next_cursor` for a whole portfolio.
- Added `mplus_resolve_istock_terms` and `mplus_set_istock_terms` for iStock/Getty controlled-vocabulary refinement. Agents choose only offered IDs by inspecting the preview, dry-run first, and save only on the owner's request; signed candidate sets and `metaver` prevent stale or forged choices. These are not paid AI actions.
- Expanded the portable production catalogue to 14 tools and updated the OpenAPI contract, Claude/OpenAI plugin descriptions, English and Russian guides, skills, mock API and protocol smoke coverage.

## 1.2.1 - 2026-10-05

- Prepared OpenAI directory metadata: verified existing public support/privacy/terms links, owner-source icons, three starter prompts, five positive and three negative review cases, and release notes.
- Reviewer cases use only the dedicated `/MCPReview` fixture and discover file ids with `mplus_list_files`. The upload case initializes a ticket from explicit file facts and does not claim that ChatGPT transfers attachment bytes automatically.
- Package version is 1.2.1; the unchanged MCP runtime remains 1.2.0.

## 1.2.0 - 2026-10-05

- Added `mplus_initialize_upload` and `POST /uploads/init` for direct multipart upload of a local binary into an existing Microstock+ folder. The contract accepts no remote source URL and returns the native chunk and finish instructions unchanged.
- Added `mplus_create_folder` (`POST /folders`) and enabled scoped `mplus_set_status` by default. Status calls target one agency; `queued` requires `user_confirmed: true`.
- Added the hosted OAuth MCP connection at `https://microstock.plus/mcp`, the one-command Claude Code setup, and current ChatGPT Developer mode instructions.
- Added portable Agent Plugins manifests (`plugin.json`, `mcp.json`) for ChatGPT and Codex. They are ready for direct testing; no public-directory publication is claimed before review and approval.
- Paid AI tools remain outside the published catalogue. File deletion remains impossible. `preview_url` and `thumbnail_url` continue to be returned by file reads.
- Added `--dump-tools` and generated `server/tools.json`: the side-effect-free canonical 11-tool catalogue with schemas, annotations, scopes and Agent API route mappings for the remote gateway.

## 1.1.0 - 2026-10-02

Aligned with the Agent API release that ships first: files, metadata (with dry run and `if_match_metaver`), CSV exports and the event feed are on; status changes, AI keywording, AI jobs and the Server-Sent Events stream are off (`403 endpoint_disabled`), and keys can't hold `status:write`, `ai:quote` or `ai:run`.

- `server/mplus-mcp.mjs` no longer offers `mplus_set_status`, `mplus_quote_ai_keywording`, `mplus_run_ai_keywording` or `mplus_get_job`. A call to one of them answers "Not available yet (not_available_yet)" without contacting the API, and an API `403 endpoint_disabled` gives the same answer. `MPLUS_ENABLE_PREVIEW_TOOLS=1` offers them again for a server that has those endpoints on.
- The server instructions, the `mplus_get_account` summary and the `mplus_wait_for_events` description say what is not available yet; `404 not_found` on every call is explained as the Agent API not being switched on for the account; a `null` balance is fine.
- Categories: at most 3, with the ids of the Microstock+ category table (listed in the guide and in the tool schema).
- `docs/AI_AGENT_SKILLS.md`, `docs/AI_AGENT_SKILLS.ru.md`, both skills, the commands, the READMEs and the plugin description mark status changes and AI keywording as "not available yet" and tell agents not to offer or promise them. The guides add the category id table, `rejection_reasons`, the events Microstock+ reports now, and the 500-file export limit.
- No more "undo from the metadata history in My Files": My Files has no such undo, so the guides, the keywording skill, the READMEs and the tool texts tell agents to write back the values they read instead.
- Tests: `tests/mock-api.mjs` takes `disabledFeatures` and `apiOff`; the smoke test runs the preview tools with `MPLUS_ENABLE_PREVIEW_TOOLS=1` and adds checks for the default tool list, local refusals, `endpoint_disabled`, the account summary and the switched-off API.

## 1.0.0 - 2026-10-02

- First release of the Microstock+ agent kit, built against the Agent API v1 contract (`docs/AGENT_API_V1.md`).
- `server/mplus-mcp.mjs`: a dependency-free MCP server for Node.js 18+ with the 12 contract tools, `structuredContent` with output schemas on every tool, and a `summary` in every result. It speaks MCP 2026-07-28 (stateless, `server/discover`) as well as 2025-11-25, 2025-06-18, 2025-03-26 and 2024-11-05, over stdio or, with `--http <port>`, Streamable HTTP on localhost.
- Safety: no tool deletes anything and the server never sends `DELETE`; queueing uploads needs `user_confirmed: true`; paid AI keywording needs `confirm_charge_eur` equal to the quote and repeats replay the same job; every write carries an `Idempotency-Key`; `if_match_metaver` conflicts are reported with the file's current metaver.
- HTTP handling: timeouts, one retry after `429` when `retry-after` is 20 seconds or less, API errors mapped to tool errors with advice, the key sent only to the configured HTTPS API host.
- Tools the key's scopes don't allow are left out of `tools/list` (the paid tool appears only with `ai:run`), and clients on the handshake-based protocol get `notifications/tools/list_changed` when the scopes change.
- `mplus_wait_for_events` long-polls the event feed and sends notable events as `notifications/message` to clients that ask for log messages.
- Claude plugin: `microstock-plus` with the agent key as a sensitive `userConfig` option, the `mplus-portfolio-management` and `mplus-keywording` skills, and the `audit`, `keywords` and `export` commands.
- `docs/AI_AGENT_SKILLS.md` and `docs/AI_AGENT_SKILLS.ru.md`: the public guide for AI agents.
- `openapi/agent-api-v1.json`: OpenAPI 3.1 description of the Agent API.
- `tests/mock-api.mjs` and `tests/smoke-test.mjs`: an in-memory mock of the contract and an end-to-end smoke test.

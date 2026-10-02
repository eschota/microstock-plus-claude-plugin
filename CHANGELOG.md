# Changelog

## 1.1.0 - 2026-10-02

Aligned with the Agent API release that ships first: files, metadata (with dry run and `if_match_metaver`), CSV exports and the event feed are on; status changes, AI keywording, AI jobs and the Server-Sent Events stream are off (`403 endpoint_disabled`), and keys can't hold `status:write`, `ai:quote` or `ai:run`.

- `server/mplus-mcp.mjs` no longer offers `mplus_set_status`, `mplus_quote_ai_keywording`, `mplus_run_ai_keywording` or `mplus_get_job`. A call to one of them answers "Not available yet (not_available_yet)" without contacting the API, and an API `403 endpoint_disabled` gives the same answer. `MPLUS_ENABLE_PREVIEW_TOOLS=1` offers them again for a server that has those endpoints on.
- The server instructions, the `mplus_get_account` summary and the `mplus_wait_for_events` description say what is not available yet; `404 not_found` on every call is explained as the Agent API not being switched on for the account; a `null` balance is fine.
- Categories: at most 3, with the ids of the Microstock+ category table (listed in the guide and in the tool schema).
- `docs/AI_AGENT_SKILLS.md`, `docs/AI_AGENT_SKILLS.ru.md`, both skills, the commands, the READMEs and the plugin description mark status changes and AI keywording as "not available yet" and tell agents not to offer or promise them. The guides add the category id table, `rejection_reasons`, the events Microstock+ reports now, and the 500-file export limit.
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

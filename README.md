# Microstock+ for AI agents

Manage your stock portfolio from Claude Code, ChatGPT, Codex, Cursor and any MCP-compatible agent. [Microstock+](https://microstock.plus) keeps your photos, vectors and videos with their metadata and agency state. This kit connects an agent to the owner's account through the Microstock+ Agent API.

With this plugin, Claude can:

- **Audit your folders**: find files without a title, description or keywords, with too few keywords, or flagged by an agency's validation.
- **Write and improve metadata** to each agency's rules, show you a preview of every change, and save only what you approve, without overwriting edits made in the meantime.
- **Check statuses and rejections** on each agency, with the reasons agencies gave.
- **Export CSV** in the free layouts of Export CSV in My Files.
- **Follow the changes** it makes, through the event feed.
- **See previews inside the agent** through authenticated MCP image blocks, with a five-minute fallback URL on `microstock.plus` for clients that cannot consume image blocks; no CDN token handling or CDN DNS is needed.
- **Upload local files** directly to an existing Microstock+ folder with a short-lived upload ticket.

Paid Microstock+ AI actions are outside this integration. Agency status changes use the opt-in `status:write` permission; queueing always requires explicit confirmation.

Nothing can be deleted through the plugin; deleting stays a manual action in the Microstock+ web interface.

## Use it

Ask in your own words, for example:

- "Which files in /foto/2026 are missing keywords or would Shutterstock reject?"
- "Write titles and keywords for the new autumn folder, for Adobe Stock and Shutterstock."
- "Find files in /foto/2026 without categories and suggest suitable ones."
- "Shorten the titles over 200 characters in /foto/2026; show me a dry run first."
- "Which files were rejected on Adobe Stock, and why?"

In Claude Code you can also run the commands:

- `/microstock-plus:audit <folder>` reports missing and weak metadata without changing anything.
- `/microstock-plus:keywords <folder or iids> [instructions]` writes or improves metadata, with a preview before anything is saved.
- `/microstock-plus:export <folder or iids> [format] [delimiter]` saves a metadata CSV.

## What's inside

| Component | What it does |
| - | - |
| `microstock-plus` MCP server | `server/mplus-mcp.mjs`, a dependency-free Node.js stdio server with portfolio, preview, metadata, upload-ticket, CSV and event tools. `--dump-tools` emits the canonical remote-gateway catalogue. |
| `mplus-portfolio-management` skill | Audits, statuses and rejection reasons, CSV exports, following events, and what to do when something fails. |
| `mplus-keywording` skill | Titles, descriptions, keywords and categories to each agency's rules, AI-generated content, and dry-run batches. |
| `audit`, `keywords` and `export` commands | Shortcuts for the three most common jobs. |
| `docs/AI_AGENT_SKILLS.md` | The full guide for AI agents (also in Russian: `docs/AI_AGENT_SKILLS.ru.md`), published at https://microstock.plus/ai-agent-skills/skill.md. |
| `openapi/agent-api-v1.json` | OpenAPI 3.1 description of the Agent API. |

## Install

### Claude Code

The simplest connection uses the hosted MCP and opens Microstock+ OAuth in the browser:

```bash
claude mcp add --transport http microstock-plus https://microstock.plus/mcp
```

Use the marketplace/plugin commands below only when you also want the packaged skills and slash commands. Public marketplace publication is a separate review step and is not claimed by this repository.

Add the marketplace that hosts this plugin, then install it:

```bash
claude plugin marketplace add eschota/microstock-plus-claude-plugin
claude plugin install microstock-plus@microstock-plus
```

This installs the packaged skills and remote OAuth MCP from the [Microstock+ GitHub marketplace](https://github.com/eschota/microstock-plus-claude-plugin). The repository is public and installable now; listing in the official Claude or OpenAI directory still requires their separate moderation and is not claimed. To try a local checkout for one session, run `claude --plugin-dir ./microstock-plus-agent-kit`.

The connector is a local MCP server, so it needs [Node.js](https://nodejs.org) 18 or newer. It uses only Node's built-in modules and installs no packages.

### Your agent key

The hosted MCP uses OAuth and does not ask you to copy an agent key. For the optional local stdio server, sign in at [microstock.plus/ai-agent-skills](https://microstock.plus/ai-agent-skills), create a scoped key, and store it only in the MCP client's secure configuration. `status:write` and `files:upload` are opt-in; paid AI scopes are unavailable.
You can revoke the key on the same page at any time.

### ChatGPT and Codex

In ChatGPT, enable Developer mode under **Settings → Security and login**, open **Apps** or **Plugins** (the label varies by surface/account), press **+**, and connect `https://microstock.plus/mcp`. Microstock+ OAuth opens when access is needed. The portable ChatGPT/Codex package is defined by `plugin.json`, `mcp.json` and `skills/`; it is ready for direct testing, but has not been submitted to the public plugin directory.

In Codex or another client that supports remote MCP URLs, connect the same URL and complete OAuth. The local Node stdio server remains available for clients that prefer an agent key.

### Claude Desktop, claude.ai and Cowork

Plugins added on claude.ai under Customize › Plugins also reach the desktop app and Cowork, but there they load only the skills and commands: chat doesn't run local MCP servers, and Cowork skips a server that needs a plugin option, because it doesn't ask for the value. To use the tools in the Claude desktop app, add the server to `claude_desktop_config.json` as shown in [docs/AI_AGENT_SKILLS.md](docs/AI_AGENT_SKILLS.md#connect).

### Other AI tools

The server works with any MCP client: Cursor, OpenAI Codex CLI, and others. [docs/AI_AGENT_SKILLS.md](docs/AI_AGENT_SKILLS.md#connect) has ready-to-paste configurations, and the plain HTTP API for agents that don't use MCP.

## Data and privacy

- **Where data goes.** The server sends requests only to the Microstock+ Agent API, `https://microstock.plus/api/agent/v1`, over HTTPS, with your agent key in the `Authorization` header and the user agent `microstock-plus-mcp/<version>`. It never sends the key anywhere else: it refuses download links on other hosts, and it refuses an API address that isn't HTTPS.
- **What it sends.** What each tool needs: folder paths, file ids, search text, the metadata changes and export settings.
- **What Claude sees.** Your files' metadata, statuses, validation messages, preview links, CSV exports you ask for, and account details such as your plan and connected agencies.
- **What stays on your computer.** Nothing. The server stores nothing and writes no files; Claude saves a CSV only when you ask it to. Diagnostics go to the server's standard error, and they never contain the key, only its public 8-character prefix. There is no analytics or telemetry.
- **What Microstock+ records.** Every call is logged in your account's audit log with the key's prefix, and agent changes appear in My Files as they happen.

## Safety

- **No deletion.** There is no delete tool; the server never sends a `DELETE` request, and the API answers any such request with `405 deletion_not_supported`.
- **No spending.** Paid AI quote/run tools are not published by this kit.
- **See the whole portfolio.** `mplus_list_files` includes subfolders by default; follow `next_cursor` through every page, then call `mplus_get_previews` in batches of up to 8 IIDs. Visual MCP clients receive image blocks. File DTO links are short-lived canonical `microstock.plus` fallbacks, never raw preview-CDN URLs; rerun the tool after expiry.
- **Clarify iStock keywords.** Resolve Getty vocabulary candidates, choose offered IDs from the actual preview, dry-run, and save the owner's approved choices. This lookup is not a paid AI action.
- **Direct uploads only.** Upload initialization accepts local file facts (`filename`, byte size, MIME type and destination directory), never a remote source URL.
- **Controlled agency sending.** `queued` sends files to one agency and is refused unless the user approved the exact files and agency and the call includes `user_confirmed: true`.
- **No lost edits.** Metadata batches are previewed with a dry run first, and `if_match_metaver` stops Claude from overwriting changes made after it read a file.
- **Only your account.** A key acts on its owner's account, with less power than the owner, and you can revoke it at any time.

## Troubleshooting

- **Claude says the Microstock+ tools aren't available.** In Claude Code, run `/mcp` and check that the `plugin:microstock-plus:microstock-plus` server is connected. If it failed to start, check that `node --version` prints 18 or newer in the terminal you start Claude from, then restart the session. In claude.ai chat and Cowork the server doesn't run; see [above](#claude-desktop-claudeai-and-cowork).
- **"No Microstock+ agent key is configured".** This applies only to the optional local stdio server. The GitHub plugin and hosted MCP use browser OAuth and do not need a pasted key.
- **`invalid_api_key` or `revoked_api_key`.** The key was mistyped, rotated or revoked. Create a new one at [microstock.plus/ai-agent-skills](https://microstock.plus/ai-agent-skills) and enter it again.
- **`scope_required`.** The key lacks a permission for that action. Create a key with the scope you need.
- **"Not available yet".** Status changes and AI keywording aren't in the Agent API yet; the tools say so instead of trying.
- **`404 not_found` on every call.** The Agent API isn't switched on for your account yet: agent keys open gradually.
- **`rate_limited`.** A key may send 120 requests and 30 changes a minute. The server waits and retries once by itself; for big jobs, ask Claude to work in batches of up to 100 files.
- **"Could not reach Microstock+".** Check your internet connection, and that a proxy or firewall allows HTTPS to `microstock.plus`.
- **More detail.** Set `MPLUS_MCP_DEBUG=1` in the environment Claude Code starts from to log every API request (method, path, status) to the server's standard error.

## Development

```bash
node tests/smoke-test.mjs
```

The smoke test starts `tests/mock-api.mjs`, an in-memory mock of the Agent API that follows `docs/AGENT_API_V1.md`, and runs the server against it over stdio (MCP 2026-07-28 and earlier revisions) and Streamable HTTP. It covers every tool, the safety guards and the error paths, and checks the plugin files and the OpenAPI document. It needs only Node.js 18 or newer and connects to nothing but `127.0.0.1`.

For manual testing, `node tests/mock-api.mjs --port 8787` starts the mock and prints fake keys for that run. Point the server at it with `MPLUS_API_BASE=http://127.0.0.1:8787/api/agent/v1` (plain `http://` is accepted only for localhost) and one of the printed keys in `MPLUS_API_KEY`.

`node server/mplus-mcp.mjs --help` lists the options, including `--http <port>`, which serves Streamable HTTP at `http://127.0.0.1:<port>/mcp` for clients that need it; each request then sends its own key as `Authorization: Bearer mpk_live_...`.

## Support

Questions and problems: [microstock.plus/ai-agent-skills](https://microstock.plus/ai-agent-skills).

## License

The plugin's code and documentation are released under the [MIT License](LICENSE).

# Microstock+ for Claude

Manage your stock portfolio by talking to Claude. [Microstock+](https://microstock.plus) keeps your photos, vectors and videos with their titles, descriptions and keywords, checks them against each stock agency's rules, and uploads them to Adobe Stock, Shutterstock, iStock, Pond5 and other agencies. This plugin connects Claude to your Microstock+ account through the Microstock+ Agent API.

With this plugin, Claude can:

- **Audit your folders**: find files without a title, description or keywords, with too few keywords, or flagged by an agency's validation.
- **Write and improve metadata** to each agency's rules, show you a preview of every change, and save only what you approve, without overwriting edits made in the meantime.
- **Check statuses and rejections** on each agency, with the reasons agencies gave.
- **Export CSV** in the free layouts of Export CSV in My Files.
- **Follow the changes** it makes, through the event feed.

**Coming soon:** queueing uploads to your agencies after you approve them, and Microstock+ AI keywording with a price quote you confirm. The Agent API doesn't offer them yet, so the plugin doesn't either.

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
| `microstock-plus` MCP server | `server/mplus-mcp.mjs`, a dependency-free Node.js server with 8 tools: `mplus_get_account`, `mplus_list_folders`, `mplus_list_files`, `mplus_get_file`, `mplus_update_metadata`, `mplus_update_metadata_batch`, `mplus_export_csv`, `mplus_wait_for_events`. Four more (`mplus_set_status`, `mplus_quote_ai_keywording`, `mplus_run_ai_keywording`, `mplus_get_job`) are offered only with `MPLUS_ENABLE_PREVIEW_TOOLS=1`, for when the Agent API offers status changes and AI keywording. |
| `mplus-portfolio-management` skill | Audits, statuses and rejection reasons, CSV exports, following events, and what to do when something fails. |
| `mplus-keywording` skill | Titles, descriptions, keywords and categories to each agency's rules, AI-generated content, and dry-run batches. |
| `audit`, `keywords` and `export` commands | Shortcuts for the three most common jobs. |
| `docs/AI_AGENT_SKILLS.md` | The full guide for AI agents (also in Russian: `docs/AI_AGENT_SKILLS.ru.md`), published at https://microstock.plus/ai-agent-skills/skill.md. |
| `openapi/agent-api-v1.json` | OpenAPI 3.1 description of the Agent API. |

## Install

### Claude Code

Add the marketplace that hosts this plugin, then install it:

```bash
claude plugin marketplace add <owner>/<repo>
claude plugin install microstock-plus@microstock-plus
```

Replace `<owner>/<repo>` with the GitHub repository that contains this folder. To try a local copy for one session, run `claude --plugin-dir ./microstock-plus-agent-kit`.

The connector is a local MCP server, so it needs [Node.js](https://nodejs.org) 18 or newer. It uses only Node's built-in modules and installs no packages.

### Your agent key

1. Sign in at [microstock.plus/ai-agent-skills](https://microstock.plus/ai-agent-skills) and create a key in the **Agent keys** section. Give it a name such as "Claude Code". The default scopes let Claude read your files, edit metadata, export CSV and watch events; statuses and AI keywording can't be added to keys yet. The key starts with `mpk_live_` and is shown once.
2. Claude Code asks for the key when you enable the plugin. To change it later, run `/plugin configure microstock-plus@microstock-plus` in a session. Claude Code keeps the key in your system's secure credential store, not in a settings file, and passes it only to the plugin's server.

You can revoke the key on the same page at any time.

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
- **No spending.** Nothing the plugin can do today costs money. When Microstock+ AI keywording arrives, it will need the `ai:run` scope (off by default), a quote first, and `confirm_charge_eur` equal to the quoted amount.
- **No uploads.** The plugin can't send files to agencies yet. When it can, queueing will need `user_confirmed: true`, which Claude sets only after you approve.
- **No lost edits.** Metadata batches are previewed with a dry run first, and `if_match_metaver` stops Claude from overwriting changes made after it read a file.
- **Only your account.** A key acts on its owner's account, with less power than the owner, and you can revoke it at any time.

## Troubleshooting

- **Claude says the Microstock+ tools aren't available.** In Claude Code, run `/mcp` and check that the `plugin:microstock-plus:microstock-plus` server is connected. If it failed to start, check that `node --version` prints 18 or newer in the terminal you start Claude from, then restart the session. In claude.ai chat and Cowork the server doesn't run; see [above](#claude-desktop-claudeai-and-cowork).
- **"No Microstock+ agent key is configured".** Run `/plugin configure microstock-plus@microstock-plus` and enter your key, then restart the session. In Claude Code 2.1.285 or later, `claude plugin configure microstock-plus@microstock-plus` in a terminal shows whether the key is set.
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

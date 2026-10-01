# Microstock+ for Claude

Manage your stock portfolio by talking to Claude. [Microstock+](https://microstock.plus) keeps your photos, vectors and videos with their titles, descriptions and keywords, checks them against each stock agency's rules, and uploads them to Adobe Stock, Shutterstock, iStock, Pond5 and other agencies. This plugin connects Claude to your Microstock+ account through the Microstock+ Agent API.

With this plugin, Claude can:

- **Audit your folders**: find files without a title, description or keywords, with too few keywords, or flagged by an agency's validation.
- **Write and improve metadata** to each agency's rules, show you a preview of every change, and save only what you approve, without overwriting edits made in the meantime.
- **Queue uploads** to your connected agencies, after you approve which files go where.
- **Export CSV** in the same layouts as Export CSV in My Files.
- **Run Microstock+ AI keywording**: it gets a free quote, tells you the price, and starts the paid job only after you confirm that exact amount.
- **Follow progress**: uploads, submissions, reviews and AI jobs as they happen.

Nothing can be deleted through the plugin; deleting stays a manual action in the Microstock+ web interface.

## Use it

Ask in your own words, for example:

- "Which files in /foto/2026 are missing keywords or would Shutterstock reject?"
- "Write titles and keywords for the new autumn folder, for Adobe Stock and Shutterstock."
- "Queue the 12 files I just fixed for Adobe Stock."
- "How much would AI keywording of /video/drone cost?"
- "Tell me when the files I queued are submitted, and if anything gets rejected."

In Claude Code you can also run the commands:

- `/microstock-plus:audit <folder>` reports missing and weak metadata without changing anything.
- `/microstock-plus:keywords <folder or iids> [instructions]` writes or improves metadata, with a preview before anything is saved.
- `/microstock-plus:export <folder or iids> [format] [delimiter]` saves a metadata CSV.

## What's inside

| Component | What it does |
| - | - |
| `microstock-plus` MCP server | `server/mplus-mcp.mjs`, a dependency-free Node.js server with 12 tools: `mplus_get_account`, `mplus_list_folders`, `mplus_list_files`, `mplus_get_file`, `mplus_update_metadata`, `mplus_update_metadata_batch`, `mplus_set_status`, `mplus_export_csv`, `mplus_quote_ai_keywording`, `mplus_run_ai_keywording`, `mplus_get_job`, `mplus_wait_for_events`. |
| `mplus-portfolio-management` skill | Audits, statuses and upload queueing, CSV exports, following events, and what to do when something fails. |
| `mplus-keywording` skill | Titles, descriptions and keywords to each agency's rules, AI-generated content, dry-run batches, and paid AI keywording with price confirmation. |
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

1. Sign in at [microstock.plus/ai-agent-skills](https://microstock.plus/ai-agent-skills) and create a key in the **Agent keys** section. Give it a name such as "Claude Code". The default scopes let Claude read, edit metadata, set statuses, export CSV, watch events and get AI keywording quotes; turn on `ai:run` only if Claude should be able to start paid AI keywording. The key starts with `mpk_live_` and is shown once.
2. Claude Code asks for the key when you enable the plugin. To change it later, run `/plugin configure microstock-plus@microstock-plus` in a session. Claude Code keeps the key in your system's secure credential store, not in a settings file, and passes it only to the plugin's server.

You can revoke the key on the same page at any time.

### Claude Desktop, claude.ai and Cowork

Plugins added on claude.ai under Customize › Plugins also reach the desktop app and Cowork, but there they load only the skills and commands: chat doesn't run local MCP servers, and Cowork skips a server that needs a plugin option, because it doesn't ask for the value. To use the tools in the Claude desktop app, add the server to `claude_desktop_config.json` as shown in [docs/AI_AGENT_SKILLS.md](docs/AI_AGENT_SKILLS.md#connect).

### Other AI tools

The server works with any MCP client: Cursor, OpenAI Codex CLI, and others. [docs/AI_AGENT_SKILLS.md](docs/AI_AGENT_SKILLS.md#connect) has ready-to-paste configurations, and the plain HTTP API for agents that don't use MCP.

## Data and privacy

- **Where data goes.** The server sends requests only to the Microstock+ Agent API, `https://microstock.plus/api/agent/v1`, over HTTPS, with your agent key in the `Authorization` header and the user agent `microstock-plus-mcp/<version>`. It never sends the key anywhere else: it refuses download links on other hosts, and it refuses an API address that isn't HTTPS.
- **What it sends.** What each tool needs: folder paths, file ids, search text, the metadata changes, statuses and agencies, export settings, and AI keywording requests.
- **What Claude sees.** Your files' metadata, statuses, validation messages, preview links, CSV exports you ask for, and account details such as your plan, balance and connected agencies.
- **What stays on your computer.** Nothing. The server stores nothing and writes no files; Claude saves a CSV only when you ask it to. Diagnostics go to the server's standard error, and they never contain the key, only its public 8-character prefix. There is no analytics or telemetry.
- **What Microstock+ records.** Every call is logged in your account's audit log with the key's prefix, and agent changes appear in My Files as they happen.

## Safety

- **No deletion.** There is no delete tool; the server never sends a `DELETE` request, and the API answers any such request with `405 deletion_not_supported`.
- **No surprise spending.** Paid AI keywording needs the `ai:run` scope, which is off by default, a quote first, and `confirm_charge_eur` equal to the quoted amount. Repeating a run returns the same job and never charges twice.
- **No surprise uploads.** Queueing files for agencies needs `user_confirmed: true`, which Claude sets only after you approve.
- **No lost edits.** Metadata batches are previewed with a dry run first, and `if_match_metaver` stops Claude from overwriting changes made after it read a file. You can undo metadata changes from the metadata history in My Files.
- **Only your account.** A key acts on its owner's account, with less power than the owner, and you can revoke it at any time.

## Troubleshooting

- **Claude says the Microstock+ tools aren't available.** In Claude Code, run `/mcp` and check that the `plugin:microstock-plus:microstock-plus` server is connected. If it failed to start, check that `node --version` prints 18 or newer in the terminal you start Claude from, then restart the session. In claude.ai chat and Cowork the server doesn't run; see [above](#claude-desktop-claudeai-and-cowork).
- **"No Microstock+ agent key is configured".** Run `/plugin configure microstock-plus@microstock-plus` and enter your key, then restart the session. In Claude Code 2.1.285 or later, `claude plugin configure microstock-plus@microstock-plus` in a terminal shows whether the key is set.
- **`invalid_api_key` or `revoked_api_key`.** The key was mistyped, rotated or revoked. Create a new one at [microstock.plus/ai-agent-skills](https://microstock.plus/ai-agent-skills) and enter it again.
- **`scope_required`.** The key lacks a permission for that action. Create a key with the scope you need. `mplus_run_ai_keywording` isn't offered at all when the key lacks `ai:run`.
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

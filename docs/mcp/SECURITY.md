# Threat model of the MCP integrations (Task C)

**Host:** Claude Code · **Config:** `.mcp.json` (project scope) · **Servers:** `filesystem`, `memory`, `catalog` (own code).
Details of each connection: [`servers.md`](./servers.md).

## 1. Who has access to what

| Server | Data / resources it reaches | Secrets | Can write? | Trust in the author |
|---|---|---|---|---|
| `filesystem` (`@modelcontextprotocol/server-filesystem@2026.8.31`) | Intended: `./app/data`. **Observed: the whole repo root** — Claude Code answers the server's `ListRoots` with the project directory, which overrides the path argument. `../../README.md` (outside the repo) was refused. | none | **Yes** — `write_file`, `edit_file`, `move_file`, `create_directory` | Official, from the MCP reference-servers repo; pinned version |
| `memory` (`@modelcontextprotocol/server-memory@2026.8.31`) | Only its own JSONL file, `MEMORY_FILE_PATH` (default `/tmp/ws06-mcp-memory.jsonl`, outside the repo) | none | Yes, but only its own graph file (`create_*`, `add_*`, `delete_*`) | Official; pinned version |
| `catalog` (`mcp-server/`, launched as `node ./mcp-server/dist/server.js`) | `app/data/catalog.json` via `loadCatalog()` from `app/dist`. No other path is exposed and no tool takes a path argument. | none | **No** — 3 tools (`search_inventory`, `check_stock`, `low_stock`) and 1 resource (`inventory://catalog`), all read-only; no network calls | Own code, but depends on `@modelcontextprotocol/server` and `zod` from npm |

No server in this configuration fetches web content, tickets, mail or any other external text.

## 2. Risks I consider real for this configuration

- **Prompt injection via data.** No server pulls content from outside the repo (that is exactly why `fetch` was not connected). The
  untrusted-text path that *does* exist is internal: `catalog` returns product `name`/`category` strings from `catalog.json` straight
  into the agent's context, and `filesystem` can *write* that same file. A product named e.g. `Ignore previous instructions and ...`
  (from a bad edit, a merged PR or a poisoned dataset) would reach the agent as tool output and be indistinguishable from data. In
  this repo the file is synthetic and reviewed in git, so the likelihood is low; the point is that the write tool and the read tool
  form a loop over the same data. The `catalog` server also echoes the model's own `query`/`sku` in "not found" messages — harmless
  here because it is the model's own text, not third-party text.
- **Access scope wider than intended.** `filesystem` was meant to see `app/data` but effectively sees the whole repo root, including
  `.mcp.json`, `docs/`, and anything untracked such as a local `.env` if one is created. It cannot reach `~` or `/`. A narrower
  scope is decided by the host, not by the server argument.
- **Secret leakage.** No token exists in this setup: none of the three servers needs one. The only environment-driven value is
  `MEMORY_FILE_PATH`, a plain path. The residual risk is a future `.env` inside the repo root being readable by `filesystem`, and
  the agent copying something into `memory` (which persists in `/tmp`, outside git).
- **Server behaviour changing after install.** `filesystem` and `memory` are run through `npx -y`, which downloads and executes
  code on every fresh cache. Both are pinned to `2026.8.31` so a new release is not pulled silently, but a pin does not protect
  against a republished or compromised version of that same number, and transitive dependencies are not locked. `catalog` uses
  `^2.0.0` / `^4.2.0` ranges, locked by `mcp-server/package-lock.json`.
- **Side-effecting tools.** `filesystem` can overwrite or move `app/data/catalog.json`, the Task D ground truth, and any source or doc
  in the repo. `memory` can delete graph entities. The only gate is Claude Code's per-call approval prompt; there is no hard
  boundary. `catalog` has no side effects by construction.

## 3. What I actually did to reduce them

- Versions of both third-party servers are pinned to `2026.8.31` in `.mcp.json` instead of a floating tag.
- `fetch` and `git` servers were **not** connected, so nothing external feeds text into the agent (see "What was NOT connected" in `servers.md`).
- No filesystem server was given `/` or `~`; the argument is `./app/data`, and the scope that Claude Code actually applied was
  verified (`list_allowed_directories`, refusal of `../../README.md`) and documented rather than assumed.
- `memory` writes to `/tmp/ws06-mcp-memory.jsonl`, outside the repo, so agent-written notes cannot land in a commit.
- The custom `catalog` server is read-only by design: no write/delete tools, no network, no path parameters. Its logic is imported
  from `app/` rather than reimplemented, and it reads a fixed file resolved relative to the module, not from user input.
- No secrets anywhere: the config has no tokens; `.env` is gitignored and `.env.example` is the committed template. The homework's
  `git grep` for `ghp_`/`github_pat_`/`sk-` patterns is part of the pre-PR check.
- `app/data/catalog.json` is under git, so any modification made through `filesystem` shows in `git diff`.
- `app/AGENTS.md` has a `## MCPs` section telling future agents not to widen the path and not to edit the data.

## 4. What remains an accepted risk

- `filesystem` has write tools and effectively repo-root scope. I accept it because the repo is a disposable, synthetic homework
  with git history and every call needs approval. In production I would use a read-only server or a host permission rule
  (deny `mcp__filesystem__write_file`/`edit_file`/`move_file`) — I did not commit such a rule, because `.claude/settings.local.json` is
  gitignored and I did not add a shared `.claude/settings.json`.
- `app/AGENTS.md` still says `filesystem` is limited to `app/data`; the observed scope is the repo root. The doc states the intent, and
  `servers.md` states the reality.
- The `npx -y` supply chain: a version pin is not an integrity check. Accepted because these are official packages; in production
  I would vendor or lock them with a checksum.
- Data-borne injection (section 2, first bullet): not mitigated technically. Accepted because the dataset is synthetic and reviewed.
- Tool approval is the only control against a prompt-injected write. A user who approves everything (or runs with permissions
  skipped) removes it.
- `memory` persists across sessions with no review; a poisoned note would influence later sessions. It lives in `/tmp` and can be deleted.

## 5. Checklist before connecting any new MCP server

- [ ] I know who the author is and whether the server is official
- [ ] I have read which tools it adds (not just the package name)
- [ ] I gave it the minimum scope, not "so it definitely works"
- [ ] No secret ended up in a committed file
- [ ] I know whether any of its tools change state, and whether confirmation is required before a call
- [ ] The version is pinned as far as possible

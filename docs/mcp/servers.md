# MCP servers of the project (Task A)

**Host:** Claude Code
**Config file:** `.mcp.json` (project scope, committed)

---

## Server 1 — filesystem

| | |
|---|---|
| **Purpose** | Lets the agent read the seeded `catalog.json` directly. This is also the "no custom server" baseline for the Task D A/B comparison. |
| **Transport** | stdio |
| **Launch** | `npx -y @modelcontextprotocol/server-filesystem@2026.8.31 ./app/data` |
| **Scope** | Intended: only `./app/data`. **Observed: the whole repo root**, because Claude Code answers the server's `ListRoots` request with the project directory, which overrides the path argument (see the stderr / roots observation below). Still not the home directory and not `/` — `../../README.md` was refused. |
| **Secrets** | None |
| **Version** | Pinned to `2026.8.31` so a compromised or breaking new release is not pulled in silently via `npx -y`. |

**Tools it gave the agent (14):** `read_text_file`, `read_file`, `read_media_file`, `read_multiple_files`, `list_directory`, `list_directory_with_sizes`, `directory_tree`, `search_files`, `get_file_info`, `list_allowed_directories`, `write_file`, `edit_file`, `create_directory`, `move_file`.

**Verification:**
- `list_allowed_directories` returned `/Users/admin/Documents/Workshop/2026-udc-06-mcp-hw` — the repo root, **not** `./app/data`.
- `read_text_file` on `app/data/catalog.json` worked; it holds 24 products.
- `read_text_file` on `../../README.md` (resolves to `/Users/admin/Documents/README.md`) was refused: `Access denied - path outside allowed directories`.
- `search_files` for `catalog.json` returned "No matches found" even though the file exists, so the file was located via `directory_tree` instead.

**stderr / roots observation:** the server's stderr contained a single line, `Secure MCP Filesystem Server running on stdio` (server `secure-filesystem-server` 0.2.0, protocol `2025-11-25`). The `Client does not support MCP Roots, using allowed directories set from server args` line did **not** appear. Instead the Claude Code log shows `Received ListRoots request from server`, so the host supports roots and the roots it supplied (the project directory) replaced the `./app/data` argument. **The host decides the scope, not the server args.**
Source: `~/Library/Caches/claude-cli-nodejs/-Users-admin-Documents-Workshop-2026-udc-06-mcp-hw/mcp-logs-filesystem/*.jsonl`.

Note: this server also has write tools (`write_file`, `edit_file`, `move_file`). The scope is narrow, but inside `app/data` it can modify `catalog.json`, which is the Task D ground truth. The mitigation is the narrow path, git (any change is visible in `git diff`) and the tool approval prompts in the host; it is not a hard boundary (see Task C).

---

## Server 2 — memory

| | |
|---|---|
| **Purpose** | Persistent knowledge graph the agent can use to keep notes across sessions (e.g. findings during the A/B runs). |
| **Transport** | stdio |
| **Launch** | `npx -y @modelcontextprotocol/server-memory@2026.8.31` |
| **Scope** | No filesystem or network access to project data. It only reads/writes its own JSONL file, set by `MEMORY_FILE_PATH` (default `/tmp/ws06-mcp-memory.jsonl`), deliberately outside the repo so nothing agent-written lands in git. |
| **Secrets** | None. `MEMORY_FILE_PATH` is a plain path, overridable from the environment / `.env` (gitignored). |
| **Version** | Pinned to `2026.8.31`, same reason as above. |

**Tools it gave the agent (9):** `create_entities`, `create_relations`, `add_observations`, `delete_entities`, `delete_observations`, `delete_relations`, `read_graph`, `search_nodes`, `open_nodes`.

**Verification:** `create_entities` created `catalog` (type `dataset`) with the observation "has 24 products"; `read_graph` returned it with no relations. The graph file exists at `/tmp/ws06-mcp-memory.jsonl`.

**stderr observation:** a single line, `Knowledge Graph MCP Server running on stdio`. Nothing else.

---

## What was NOT connected and why

- **git / fetch** (`uvx`): `uv` is not installed here; per the walkthrough, Python was not installed just for the homework.
- **fetch** in particular would also pull untrusted external content into the agent's context (prompt-injection surface), which this project does not need.
- Any filesystem server scoped to `/` or `~`: far more access than the task requires.
- Any server needing a token: nothing in Task A requires one.

## Scope — the key line

The path handed out in `.mcp.json` is `./app/data`, and that is all the exercise needs. In practice, though, Claude Code's roots take precedence, so the effective scope is the repo root. Anything narrower would have to be enforced by the host (permission rules), not by the server argument.

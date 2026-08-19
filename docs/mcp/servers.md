# MCP servers for this project (Task A)

**Configured host:** Claude Code
**Configuration file:** `.mcp.json` (project scope, committed for the team)

All three servers use the local `stdio` transport, require only Node.js, and
need no API keys. Package versions are pinned so a future upstream release cannot
silently change the tools or permissions available to the agent.

The configuration uses the host-neutral `${MCP_PROJECT_DIR}` environment
variable rather than a Claude-specific variable. Set it to the absolute
repository path before starting the MCP host. `.env.example` documents the
value, but each host must be configured to load `.env`, or the variable must be
exported in the shell that launches the host.

---

## Server 1 — catalog-filesystem

| | |
|---|---|
| **Purpose** | Let the agent inspect the synthetic catalog used by this homework. |
| **Transport** | `stdio` |
| **Launch command** | `npx -y @modelcontextprotocol/server-filesystem@2026.7.10 ${MCP_PROJECT_DIR}/app/data` |
| **Access scope** | Only `app/data` and its descendants. The server does not receive the repository root or the user's home directory. This is sufficient because its Task A use case is inspecting `catalog.json`. |
| **Secrets** | None. |
| **Version** | Pinned to `2026.7.10` for reproducibility and supply-chain review. |

**Tools observed:** `read_file` (deprecated upstream), `read_text_file`,
`read_media_file`, `read_multiple_files`, `write_file`, `edit_file`,
`create_directory`, `list_directory`, `list_directory_with_sizes`,
`directory_tree`, `move_file`, `search_files`, `get_file_info`, and
`list_allowed_directories`.

**Verification:** On 2026-08-19, Claude Code's `/mcp` view showed this project
server connected with 14 tools. A separate direct MCP client initialized the
pinned package, requested `tools/list`, called `list_allowed_directories`, and
successfully read the first lines of `catalog.json`. An attempted read of the
repository-root `README.md` returned `Access denied - path outside allowed
directories`. The direct session also reported on stderr:

```text
Client does not support MCP Roots, using allowed directories set from server args:
.../2026-udc-06-mcp-hw/app/data
```

This proves that the fallback argument constrained that test session to
`app/data`. Because a Roots-capable host can replace the argument-based
allowlist, `list_allowed_directories` should be called again whenever the host
or its configuration changes.

The server exposes write and move tools as part of its upstream tool set. The
narrow directory limits their reach but does not make the directory read-only;
these mutating tools should not be approved for this homework. A true read-only
boundary would require read-only OS permissions or a sandbox.

### Roots nuance

The command-line directory is the fallback for clients that do not supply MCP
Roots. A client that supports Roots may replace the command-line allowlist with
its advertised roots. Roots are a coordination mechanism that a server is
expected to respect, not a security boundary. The effective boundary still
depends on the host configuration and operating-system permissions, so stderr
and `list_allowed_directories` should be checked in the actual host.

---

## Server 2 — project-memory

| | |
|---|---|
| **Purpose** | Store workshop-specific notes and relationships in a small local knowledge graph across chats. |
| **Transport** | `stdio` |
| **Launch command** | `npx -y @modelcontextprotocol/server-memory@2026.7.4` |
| **Access scope** | Its persistence target is explicitly limited to `.mcp-memory.jsonl` in this repository through `MEMORY_FILE_PATH`. That generated file is gitignored. The server receives no token and makes no network request during tool execution. |
| **Secrets** | None. Do not store secrets, PII, or real client data in the graph. |
| **Version** | Pinned to `2026.7.4` for reproducibility and supply-chain review. |

**Tools observed:** `create_entities`, `create_relations`, `add_observations`,
`delete_entities`, `delete_observations`, `delete_relations`, `read_graph`,
`search_nodes`, and `open_nodes`.

**Verification:** On 2026-08-19, Claude Code's `/mcp` view showed this project
server connected with 9 tools. A separate direct MCP client initialized the
pinned package with a temporary JSONL path, requested `tools/list`, created a
synthetic `catalog-homework-verification` entity, found it through
`search_nodes`, and deleted it. The committed configuration uses the dedicated
gitignored project-local store instead of that temporary verification file.

Memory is intentionally stateful: create/delete tools modify its dedicated
JSONL store. They cannot modify `catalog.json` through the memory server. Any
facts placed in memory may be supplied to later agent sessions, so stored text
must still be treated as untrusted context.

---

## Server 3 — catalog-server (custom, Task B)

| | |
|---|---|
| **Purpose** | Expose the tested catalog domain through precise model-callable operations and an application-readable summary. |
| **Transport** | `stdio` |
| **Launch command** | `node ${MCP_PROJECT_DIR}/mcp-server/dist/server.js` |
| **Access scope** | Reads only `app/data/catalog.json`, through the existing `loadCatalog()` public API. The implementation has no file-write or network code. |
| **Secrets** | None. |
| **Version** | Local server `1.0.0`, using pinned `@modelcontextprotocol/server` `2.0.0`. |

**Tools observed:** `search_inventory`, `check_stock`, `low_stock`, and
`inventory_value`. All four advertise `readOnlyHint: true`,
`destructiveHint: false`, `idempotentHint: true`, and `openWorldHint: false`.

**Resource observed:** `inventory://catalog` (`application/json`), containing
the current product count, categories, low-stock count, and total inventory
value.

**Verification:** On 2026-08-19, Claude Code's `/mcp` view showed the custom
server connected with 4 tools. A separate direct MCP session confirmed
`tools/list` and `resources/list`, called every tool, read the resource, and
confirmed schema rejection for an invalid SKU. The catalog results matched the
seeded ground truth: 9 low-stock products, total inventory value `46152`, and a
resource summary of 24 products across 7 categories.

The server is a thin adapter: every query and calculation delegates to exports
from `app/dist/index.js`; the MCP layer only validates inputs and formats
responses.

---

## What was not connected and why

- `fetch` was not connected because this exercise does not need external web
  content; enabling it would add an avoidable prompt-injection surface.
- `git` was not connected because Task A needs no repository mutation or broad
  history access, and choosing it would also add a Python/`uv` prerequisite.
- Token-based servers were not connected because neither Task A use case needs
  external accounts or credentials.

## Host approval and final check

Claude Code prompted once before trusting the project-scoped servers from
`.mcp.json`. After approval, `/mcp` showed `catalog-filesystem`,
`project-memory`, and `catalog-server` connected. All project paths use
`${MCP_PROJECT_DIR}` so they are not tied to a Claude-specific environment
variable. The variable deliberately has no fallback: a missing value should
fail startup instead of accidentally granting access relative to an unexpected
working directory.

No literal secrets are present in this configuration.

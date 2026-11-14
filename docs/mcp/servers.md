# Project MCP servers (Task A)

**Host where configured:** Cursor (client 3.29.15)
**Config file:** `.cursor/mcp.json` (project-level, committed)

Host notes:

- Project-level servers showed as **Disabled** in Cursor's Customize > MCPs
  until they were enabled manually.
- Cursor treats `.cursor/mcp.json` as a protected config file and asked for
  confirmation before the agent was allowed to create it.
- Before **every** MCP tool call (reads and writes, all 4 calls made) Cursor
  showed a Skip / Always Run / Run card with the full JSON arguments. We always
  pressed **Run** and never **Always Run**, so every call stays individually
  approved.
- Cursor's MCP log shows `Sandbox prerequisites configured for stdio MCP:
  supported=false`, so stdio servers most likely run without a sandbox on this
  machine, with the same OS rights as the user.

---

## Server 1 — filesystem

| | |
|---|---|
| **Why** | Lets the agent read the seeded catalog data (`app/data/catalog.json`) without giving it access to the rest of the repo. |
| **Transport** | stdio |
| **How it starts** | `npx -y @modelcontextprotocol/server-filesystem@2.3.0 ${workspaceFolder}/app/data` |
| **Scope** | `app/data` only; `catalog.json` is the only file there. That is all the agent needs to look at the catalog. Anything wider would expose `.env`, source code and the rest of the repo. |
| **Secrets** | None. |
| **Version** | Pinned to `2.3.0` (checked with `npm view` on 2026-11-14). A floating version would let a new upstream release change behaviour or tools without review. |

**Tools it gave the agent (16, as seen in Cursor):**

- Read: `read_file`, `read_text_file`, `read_media_file`, `read_multiple_files`,
  `list_directory`, `list_directory_with_sizes`, `directory_tree`,
  `search_files`, `get_file_info`, `list_allowed_directories`
- Write: `write_file`, `append_file`, `edit_file`, `create_directory`,
  `move_file`, `copy_file`

**Risk:** the write tools are inside the scope, so they can modify
`app/data/catalog.json`, which is the Task D ground truth. The per-call
approval card (never "Always Run") is the safeguard against that.

**What the stderr showed (Cursor log `mcpprocess.log`):**

```text
Failed to request initial roots from client: Invalid result for roots/list
Effective allowed directories (from the command line): ...\2026-udc-06-mcp-hw\app\data
```

So in Cursor the effective scope came from **our command-line argument**, not
from MCP roots: the server rejected the `roots/list` result as invalid. Why it was rejected is unknown; our hypothesis is a
protocol or version mismatch between client and server. Either way, roots are
a coordination mechanism, not a security boundary (a server *should* respect
them but is not required to), so the argument path is what we rely on and
document here.

**Verification:** `list_allowed_directories` returned only the `app\data`
path; `list_directory` returned `catalog.json`.

---

## Server 2 — memory

| | |
|---|---|
| **Why** | A persistent knowledge graph the agent can use for notes across chats. |
| **Transport** | stdio |
| **How it starts** | `npx -y @modelcontextprotocol/server-memory@2.1.1` |
| **Scope** | Only its own JSONL file; no access to the repo. By default that file is `memory.jsonl` inside the npx cache `node_modules` folder. |
| **Secrets** | None. |
| **Version** | Pinned to `2.1.1`, for the same reason as above. |

**Storage location, a deliberate choice:** the server warns on stderr that
clearing the npx cache or updating the package can delete the default
`memory.jsonl`. Setting `MEMORY_FILE_PATH` (an absolute path) would move it.
We deliberately did **not** set it: the graph is disposable in a training
repo, and an absolute path would tie the committed config to one machine.

**Tools it gave the agent (9):**

- Read: `read_graph`, `search_nodes`, `open_nodes`
- Write: `create_entities`, `create_relations`, `add_observations`,
  `delete_entities`, `delete_observations`, `delete_relations`

**Resource** (seen through MCP Inspector `resources/list`):
`memory://knowledge-graph`, "Knowledge Graph", `application/json`.

**Verification:** `create_entities` with name `udc-ws06-check` and type `test`,
then `read_graph` returned that entity. In a second, new chat
`create_entities` with the same entity reported "Skipped 1 entity that already
exists", which shows the data persists across chats.

---

## Server 3 — catalog (our own, Task B)

| | |
|---|---|
| **Why** | Exposes the seeded catalog domain to the agent as read-only tools, so answers come from the tested `app/` functions instead of the agent re-reading and re-computing the JSON. |
| **Transport** | stdio |
| **How it starts** | `node ${workspaceFolder}/mcp-server/dist/server.js` (from `.cursor/mcp.json`). Prerequisites: build `app/` (`npm install`, `npm run build`), then build the server (`npm install`, `npm run build` in `mcp-server/`); the server imports `../../app/dist/index.js`. |
| **Scope** | Reads `app/data/catalog.json` only, via `loadCatalog()` from `app/dist`; no writes, no deletes, no network. All 4 tools declare `readOnlyHint: true`, `openWorldHint: false`. |
| **Secrets** | None. |
| **Version** | Our own code; SDK `@modelcontextprotocol/server` `2.4.0` locked in `mcp-server/package-lock.json` (`package.json` has `^2.0.0`). |

**Tools it gave the agent (4, all read-only):**

- `search_inventory(query)`
- `check_stock(sku)` (an unknown SKU returns `isError`)
- `low_stock()`
- `inventory_value()`

**Resource:** `inventory://catalog` (JSON: `productCount`, `categories`,
`inventoryValue`).

**Verification:** Cursor Customize > MCPs showed "catalog — 4 tools, 1
resource enabled". MCP Inspector `resources/read` of `inventory://catalog`
returned `productCount` 24, 7 categories and `inventoryValue` 46152. In the
Task D run A the agent called `low_stock` and `inventory_value`.

---

## What we did NOT connect and why

- **git** and **fetch**: both need Python + uv. On top of that, fetch would pull
  arbitrary web content into the agent context, which is a prompt-injection
  surface.
- **GitHub MCP**: needs a token; the bonus Task E was skipped, so there is no
  reason to hand out one.
- **filesystem scoped to the whole repo or the home folder**: too broad. It
  would expose `.env` and everything else for no benefit.

## Scope — the key point

The most important row in each block above is **scope**. The filesystem
server gets exactly `app/data` (passed as `${workspaceFolder}/app/data`), and
the stderr confirms that this argument is the effective boundary in Cursor.
That is enough because the catalog data is the only thing the agent needs to
read through it. The memory server sees only its own JSONL file. The catalog
server reads only `app/data/catalog.json` through `loadCatalog()` and has no
write, delete or network tools. None of the three
servers has a secret, and the host most likely does not sandbox them, so the real limits are the
scope argument, OS permissions and the per-call approval card.

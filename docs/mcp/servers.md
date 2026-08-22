# MCP servers of this project (Task A)

**Host:** Claude Code CLI 2.1.239 (Windows 11, Node 24.16, npm 11.13)
**Config file:** [`.mcp.json`](../../.mcp.json) (project-scoped, committed) +
[`.claude/settings.json`](../../.claude/settings.json) (approves those servers
for the team and allow/deny-lists individual tools)

Three servers are registered: two public ones (`filesystem`, `memory`) and the
custom `catalog` server from Task B. `git` and `fetch` were **not** connected —
see [What was NOT connected](#what-was-not-connected-and-why).

---

## Server 1 — `filesystem`

| | |
|---|---|
| **Why** | Lets the agent read the seeded catalog data (`app/data/catalog.json`) through a declared, auditable tool instead of an ad-hoc shell command. Also the cleanest way to *see* the roots nuance below. |
| **Transport** | stdio |
| **Launch** | `npx -y @modelcontextprotocol/server-filesystem@2026.7.10 ./app/data` |
| **Scope (intended)** | `./app/data` — the only directory with domain data. Not the repo root, not `$HOME`, not `C:\`. Relative to the project root; Claude Code launches project-scoped servers with the project as cwd (verified: `claude mcp list` → `✔ Connected`). |
| **Scope (actually observed)** | **The whole repo root**, see below. |
| **Secrets** | none |
| **Version** | pinned `@2026.7.10` — an `npx -y` with a floating tag would silently run whatever is published next. |

**Tools it gave the agent (14, seen in the host):**
`read_file`, `read_text_file`, `read_media_file`, `read_multiple_files`,
`write_file`, `edit_file`, `create_directory`, `list_directory`,
`list_directory_with_sizes`, `directory_tree`, `move_file`, `search_files`,
`get_file_info`, `list_allowed_directories`.

Five of those **write** (`write_file`, `edit_file`, `create_directory`,
`move_file` — and `edit_file` can rewrite arbitrary text). They are
deny-listed in `.claude/settings.json`; only the read tools are allow-listed.

**Verification:** asked the agent (fresh `claude -p` session, MCP tools only) to
call `list_allowed_directories` and `list_directory`. Both fired; the
directory listing came back from the filesystem server, not from the built-in
`Read`/`Bash`.

### 🔎 The roots nuance — what I actually saw

Running the server **by hand** over stdio, with a client that does *not*
advertise `roots`:

```
Secure MCP Filesystem Server running on stdio
Client does not support MCP Roots, using allowed directories set from server args:
  [ 'C:\\Users\\777ma\\IdeaProjects\\2026-udc-06-mcp-hw\\app\\data' ]
```

and `read_text_file` on `app/src/catalog.ts` was refused:
`Access denied - path outside allowed directories: …\app\src\catalog.ts not in …\app\data`.
So far the argument works.

Running it **inside Claude Code**, `list_allowed_directories` returned:

```
Allowed directories:
C:\Users\777ma\IdeaProjects\2026-udc-06-mcp-hw
```

Claude Code *does* support MCP Roots and sends the project directory as the
root. The server follows the spec (roots win over args) — so my carefully
narrowed `./app/data` argument is **ignored by this host**, and the effective
scope is the entire repository (including `.git`, `.claude`, `.env` if it
existed). The path argument is a fallback, not a boundary; the host decides,
and roots are explicitly "coordination, not security" (SHOULD, not MUST) and
deprecated in the 2026-07-28 revision. The real boundary is OS permissions or a
sandbox. Consequence for this repo: the write tools are deny-listed, and
`SECURITY.md` treats filesystem's scope as "repo root", not "app/data".

---

## Server 2 — `memory`

| | |
|---|---|
| **Why** | Persistent knowledge graph across chats — e.g. remembering "SKUs under review" between sessions. Chosen mostly as the second zero-token `npx` server (no Python/`uv` on this machine, so `git`/`fetch` were out). |
| **Transport** | stdio |
| **Launch** | `npx -y @modelcontextprotocol/server-memory@2026.7.4` |
| **Scope** | Exactly one file: its `memory.jsonl`. By default that lives **inside the package directory in the npx cache**, outside this repo. Overridable with `MEMORY_FILE_PATH`. Gotcha found while configuring: a *relative* `MEMORY_FILE_PATH` is resolved against the package dir, not the cwd — so `./.claude/memory.jsonl` would *not* land in the repo. Therefore the config uses `${MCP_MEMORY_FILE_PATH:-}` (empty → package default) and `.env.example` documents an absolute override. No network, no other filesystem access. |
| **Secrets** | none (`MCP_MEMORY_FILE_PATH` is a path, not a credential, but it is still wired through `${ENV_VAR}` rather than hard-coded) |
| **Version** | pinned `@2026.7.4` |

**Tools it gave the agent (9):** `create_entities`, `create_relations`,
`add_observations`, `delete_entities`, `delete_observations`,
`delete_relations`, `read_graph`, `search_nodes`, `open_nodes`.

Six of nine **mutate** the graph. Only `read_graph`, `search_nodes`,
`open_nodes` are allow-listed; writes stay behind the host's confirmation
prompt.

**Verification:** same fresh session — the agent called `read_graph` and got
`{"entities":[],"relations":[]}` (empty graph, as expected on a clean machine).

---

## Server 3 — `catalog` (own, Task B)

| | |
|---|---|
| **Why** | Typed, read-only access to the catalog domain: "what needs reordering", "stock for SKU", "find product", plus a summary resource. |
| **Transport** | stdio |
| **Launch** | `node ./mcp-server/dist/server.js` (needs `cd app && npm run build` and `cd mcp-server && npm install && npm run build` first) |
| **Scope** | Reads `app/data/catalog.json` via `loadCatalog()` from `app/dist` — nothing else. No writes, no network. Every tool carries `readOnlyHint: true, destructiveHint: false, openWorldHint: false`. |
| **Secrets** | none |
| **Version** | own code, `1.0.0`; SDK `@modelcontextprotocol/server ^2.0.0` via committed `package-lock.json` |

**Tools:** `search_inventory(query, limit?)`, `check_stock(sku)`, `low_stock()`.
**Resources:** `inventory://catalog` (summary), `inventory://catalog/products`
(full list), template `inventory://category/{category}` (7 enumerated entries).
Details in [`mcp-server/README.md`](../../mcp-server/README.md).

**Verification:** `claude mcp list` → `✔ Connected`; in the A/B run the agent
called `mcp__catalog__low_stock` and read `inventory://catalog` — see
[`docs/ab-validation.md`](../ab-validation.md).

---

## What was NOT connected and why

| Server | Decision | Reason |
|---|---|---|
| `git` (uvx) | not connected | Needs Python + `uv`, which this machine does not have; installing a runtime for homework is not worth it. More importantly its tool set includes `git_commit`, `git_add`, `git_reset`, `git_checkout` — state-changing operations on the repo history. Nothing in this homework needs an agent to commit on its own. |
| `fetch` (uvx) | not connected | Same runtime issue, plus it is the textbook prompt-injection channel: it pulls arbitrary web content straight into context. There is no task here that requires the web. |
| GitHub MCP | not connected | Requires a PAT. The minimal useful scope still grants read access to every repo the token can see — too much for a homework about scoping. Task E path 3 was deliberately not chosen. |
| Browser / Puppeteer / Playwright | not connected | Full browser automation = can log in anywhere the local browser profile is logged in. Way beyond least privilege for this repo. |

## Scope — the main point

The most important line in each block above is **scope**, and the most
important lesson is that *the scope I wrote in the config is not necessarily
the scope I got*. `filesystem` was given `./app/data`; Claude Code handed it
the repo root through roots. For a read-only learning repo with no secrets
on disk that is acceptable; in a real project the answer is an OS-level
boundary (separate user, container, or sandbox), not a nicer argument string.

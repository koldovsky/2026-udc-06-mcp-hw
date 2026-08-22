# MCP servers of this project (Task A)

> **Коротко (UA):** підключено 3 сервери — `filesystem` (офіційний, звужений до
> `./app/data`), `memory` (офіційний) і власний `catalog` (read-only). Усі
> версії зафіксовані, секретів немає. Головне спостереження: Claude Code
> підтримує MCP Roots і віддає filesystem-серверу **корінь репо**, тож мій
> аргумент `./app/data` ігнорується — реальний scope визначає хост, а не
> конфіг. Тому write-tools filesystem заборонені на рівні хоста
> (`.claude/settings.json`, вміст нижче). `git`, `fetch`, GitHub і браузерні
> сервери свідомо не підключав.

**Host:** Claude Code CLI 2.1.239 (Windows 11, Node 24.16, npm 11.13)
**Config files:**
- [`.mcp.json`](../../.mcp.json) — project-scoped server list (Claude Code), committed
- [`.claude/settings.json`](../../.claude/settings.json) — approves those servers for the
  team and allow/deny-lists individual tools; full content inlined [below](#tool-level-gate-claudesettingsjson-committed)
- [`.cursor/mcp.json`](../../.cursor/mcp.json) — the same three servers for Cursor (see [Portability](#portability-to-a-second-host))

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

Four of those **write**: `write_file`, `edit_file`, `create_directory`,
`move_file` (`edit_file` is the sharpest of them — it rewrites arbitrary text
in place). Host-level gate, 14 tools accounted for: **9 allow-listed** (every
read/list/search tool), **5 deny-listed** (the four writers plus
`read_media_file`), **0 left to a prompt**. `read_media_file` is denied even
though it only reads, because with the effective scope being the repo root it
could pull any binary in the tree into context as base64, and nothing in this
project needs that.

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
scope is the entire repository (including `.git`, `.claude`, `.idea`, `.env`
if it existed). The path argument is a fallback, not a boundary; the host
decides, and roots are explicitly "coordination, not security" (SHOULD, not
MUST) and deprecated in the 2026-07-28 revision. The real boundary is OS
permissions or a sandbox. Consequence for this repo: the write tools are
deny-listed, and `SECURITY.md` treats filesystem's scope as "repo root", not
"app/data".

### Tool-level gate (`.claude/settings.json`, committed)

This is the file the mitigations above and in `SECURITY.md` refer to, inlined
here because it is the evidence:

```json
{
  "enabledMcpjsonServers": ["filesystem", "memory", "catalog"],
  "permissions": {
    "allow": [
      "mcp__catalog__search_inventory",
      "mcp__catalog__check_stock",
      "mcp__catalog__low_stock",
      "mcp__filesystem__read_file",
      "mcp__filesystem__read_text_file",
      "mcp__filesystem__read_multiple_files",
      "mcp__filesystem__list_directory",
      "mcp__filesystem__list_directory_with_sizes",
      "mcp__filesystem__directory_tree",
      "mcp__filesystem__search_files",
      "mcp__filesystem__get_file_info",
      "mcp__filesystem__list_allowed_directories",
      "mcp__memory__read_graph",
      "mcp__memory__search_nodes",
      "mcp__memory__open_nodes"
    ],
    "deny": [
      "mcp__filesystem__write_file",
      "mcp__filesystem__edit_file",
      "mcp__filesystem__create_directory",
      "mcp__filesystem__move_file",
      "mcp__filesystem__read_media_file"
    ]
  }
}
```

Three things it does: (1) `enabledMcpjsonServers` pre-approves the three
servers from `.mcp.json` for everyone who clones the repo — a convenience
with a trust assumption behind it, discussed as an *accepted risk* in
`SECURITY.md §4`; (2) `allow` lets the read-only tools run without a prompt,
so the A/B test measures the model's choice rather than a permission dialog;
(3) `deny` blocks the mutating filesystem tools outright. Memory's six
mutating tools are in neither list on purpose: they stay behind the host's
interactive confirmation.

---

## Server 2 — `memory`

| | |
|---|---|
| **Why** | Persistent knowledge graph across chats — e.g. remembering "SKUs under review" between sessions. Chosen mostly as the second zero-token `npx` server (no Python/`uv` on this machine, so `git`/`fetch` were out). |
| **Transport** | stdio |
| **Launch** | `npx -y @modelcontextprotocol/server-memory@2026.7.4` |
| **Scope** | Exactly one file: its `memory.jsonl`. By default that lives **inside the package directory in the npx cache**, outside this repo. Overridable with the `MEMORY_FILE_PATH` environment variable. Gotcha found while configuring: a *relative* `MEMORY_FILE_PATH` is resolved against the package dir, not the cwd — so `./.claude/memory.jsonl` would *not* land in the repo. Therefore the config sets nothing (default = outside the repo) and `.env.example` documents an absolute override. No network, no other filesystem access. |
| **Secrets** | none. A first draft wired the path through `${MCP_MEMORY_FILE_PATH:-}` in `.mcp.json`; that was removed because the `${VAR:-default}` expansion is Claude-Code-specific — Cursor/VS Code pass the literal string through, which on Windows becomes an illegal filename. Portability won over demonstrating `${ENV}` syntax for a value that is not a secret anyway. |
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
| **Launch** | `node ./mcp-server/dist/server.js` (needs `cd app && npm run build` and `cd mcp-server && npm install && npm run build` first; if `app/dist` is missing the server exits 1 with a three-line hint on stderr instead of a raw module-resolution stack) |
| **Scope** | Reads `app/data/catalog.json` via `loadCatalog()` from `app/dist` — nothing else. No writes, no network. Every tool carries `readOnlyHint: true, destructiveHint: false, openWorldHint: false`. |
| **Secrets** | none |
| **Version** | own code, `1.0.0` (read from `package.json` at startup); SDK `@modelcontextprotocol/server ^2.0.0` via committed `package-lock.json` |

**Tools:** `search_inventory(query?, limit?)`, `check_stock(sku)`, `low_stock()`.
**Resources:** `inventory://catalog` (summary), `inventory://catalog/products`
(full list), template `inventory://category/{category}` (7 enumerated entries).
Details in [`mcp-server/README.md`](../../mcp-server/README.md).

**Verification:** `claude mcp list` → `✔ Connected`; in the A/B run the agent
called `mcp__catalog__low_stock` and read `inventory://catalog` — see
[`docs/ab-validation.md`](../ab-validation.md).

---

## Portability to a second host

[`.cursor/mcp.json`](../../.cursor/mcp.json) registers the same three servers
for Cursor. What differs from `.mcp.json`: no `"type": "stdio"` keys (Cursor
infers stdio from `command`), and no `env` block — which is exactly why the
`${VAR:-}` reference was dropped from the Claude Code file too, so the two
files now describe identical processes. What is the same: pinned versions,
`./app/data` as the filesystem argument, and relative paths.

**Honesty note:** Cursor is not installed on this machine, so this file has
been checked for shape only, not run. The walkthrough's warning applies: if
Cursor does not launch stdio servers from the workspace root, the two relative
paths must become absolute. Task E was done via path 2 (Inspector), not the
cross-host path, so this file is a convenience for reviewers, not a claim of
verified cross-host behaviour.

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

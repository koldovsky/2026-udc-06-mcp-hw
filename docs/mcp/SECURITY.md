# MCP threat model (Task C)

Scope of this document: the MCP setup actually used in this repo, in Cursor
3.29.15 on Windows 11. The three project servers come from `.cursor/mcp.json`
(details in [servers.md](./servers.md)). Two more servers, Computer Use and
Origin, are visible in the same host but come from the Cursor user profile,
not from this repo.

## 1. Who has access to what

| Server | Data/resources it reaches | Secrets | Can write? | Trust in author |
|---|---|---|---|---|
| filesystem (`@modelcontextprotocol/server-filesystem@2.3.0`, stdio via `npx`) | `${workspaceFolder}/app/data` (CLI argument), which contains only `catalog.json`. 16 tools: 10 read, 6 write. | none | **yes**: `write_file`, `append_file`, `edit_file`, `create_directory`, `move_file`, `copy_file` can all touch `app/data/catalog.json` | official |
| memory (`@modelcontextprotocol/server-memory@2.1.1`, stdio via `npx`) | Its own `memory.jsonl` inside the npx cache (`...\npm-cache\_npx\...\node_modules\@modelcontextprotocol\server-memory\dist\memory.jsonl`); resource `memory://knowledge-graph`. 9 tools: 3 read, 6 write. | none | **yes**: `create_entities`, `create_relations`, `add_observations`, `delete_entities`, `delete_observations`, `delete_relations` | official |
| catalog (our `mcp-server/`, `node ${workspaceFolder}/mcp-server/dist/server.js`) | `app/data/catalog.json`, read via `loadCatalog()` from `app/dist`; resource `inventory://catalog`. 4 tools: `search_inventory`, `check_stock`, `low_stock`, `inventory_value`. | none | no (no writes, no deletes, no network) | own code; SDK `@modelcontextprotocol/server` 2.4.0 locked in `package-lock.json` |
| Computer Use (9 tools, user-level) | not reviewed | not reviewed | not reviewed | author not verified |
| Origin (36 tools, user-level) | not reviewed | not reviewed | not reviewed | author not verified |

## 2. Risks I consider real for this configuration

- **Prompt injection via data.** No server here pulls external content: there
  is no fetch or web server. The realistic injection path is internal:
  - **memory** is a persistent store that is fed back to the agent in later
    chats. The entity `udc-ws06-check` created in chat 1 was visible in chat 2,
    so any instruction-like text written into the graph in one session (by the
    agent itself or after it read something hostile) becomes context in future
    sessions (memory poisoning).
  - **filesystem** + **catalog**: if `catalog.json` were altered through a
    filesystem write tool, both the filesystem read tools and our catalog
    tools would return that altered text to the agent.
  - Computer Use and Origin: what content they bring into context was not
    reviewed.
- **Overly broad scope.** filesystem is limited by path to `app/data`, but its
  capability is broader than the task needs: the agent only needs to read the
  catalog, yet it gets 6 write tools on the one file that matters. The
  `roots/list` result from Cursor was rejected by the server ("Failed to
  request initial roots from client: Invalid result for roots/list"), and the
  stderr then reports "Effective allowed directories (from the command line):
  ...\app\data". So the CLI argument is the effective boundary; the cause of
  the rejection is unknown (likely a protocol/version mismatch). Roots are a
  coordination mechanism, not a security boundary, so we do not rely on them.
  Computer Use (9 tools) and Origin (36 tools) add surface whose scope was not
  reviewed.
- **Secret leakage.** No secrets are in play for the three project servers:
  `.cursor/mcp.json` has no `env` block and no tokens. The stdio servers
  likely run without a sandbox (Cursor log: "Sandbox prerequisites configured
  for stdio MCP: supported=false"), so they likely have the user's OS rights.
  That means a misbehaving server would not be stopped by the host from
  reading other files on the machine; the filesystem path scope only limits
  what its tools expose.
- **Server behaviour changing after install.** filesystem and memory are
  pinned (`2.3.0`, `2.1.1`), and the catalog server's SDK is locked through
  `package-lock.json`, so an upstream release does not silently change the
  tool set. A related trust gap: Cursor groups tools into Reads/Writes by the
  server's self-declared `readOnlyHint` and does not verify it.
  `search_inventory` sat under Writes until the annotation was added, which
  shows the label is whatever the server claims. A server that changes (or
  lies about) its annotations changes how its tools are presented.
- **Side-effect actions.** filesystem write tools can modify, move or copy
  over `app/data/catalog.json`, the Task D ground truth, which would
  invalidate the A/B comparison. memory delete tools can erase the graph, and
  its create/add tools are the memory-poisoning vector above. The catalog
  server has no side effects. Whether Computer Use or Origin can write was not
  reviewed. The only confirmation step is the human pressing Run on Cursor's
  per-call card.

## 3. What I did to reduce them

- filesystem is scoped by CLI argument to `${workspaceFolder}/app/data` (only
  `catalog.json`), not to the whole repo or the home folder. The stderr line
  confirms this argument is the effective boundary.
- Every MCP tool call (read and write) went through Cursor's Skip / Always Run
  / Run card with the full JSON arguments visible. We always pressed **Run**
  and never **Always Run**, so each call stays individually approved.
- Project servers from `.cursor/mcp.json` started as Disabled and were enabled
  manually. Creating/editing `.cursor/mcp.json` by the agent required a
  confirmation card (protected config file).
- `app/AGENTS.md` tells agents not to approve filesystem writes to
  `data/catalog.json`.
- Our catalog server is read-only by design: logic imported from `app/dist`,
  reads `catalog.json` through `loadCatalog()`, no writes, no deletes, no
  network. All 4 tools declare `readOnlyHint: true, openWorldHint: false`.
- Because Cursor trusts `readOnlyHint` without verifying it, the annotations
  were checked manually. An agent once falsely reported "every tool flagged
  read-only"; the manual check caught that `search_inventory` was still
  listed under Writes, and the annotation was added.
- Versions pinned: filesystem `2.3.0`, memory `2.1.1`, the catalog SDK via
  `package-lock.json`.
- No secrets: no `env` block, no tokens in the config.
- Deliberately not connected: git and fetch (need uv + Python; fetch would be
  a prompt-injection surface), GitHub MCP (needs a token; bonus Task E
  skipped), filesystem on the whole repo or home folder.

## 4. What remains an accepted risk

- **filesystem write tools stay exposed.** The only guards against a write to
  `catalog.json` are the per-call Run card and the instruction in
  `app/AGENTS.md`. Acceptable here because the data is synthetic and in git;
  in production, a server that only needs reads should not offer write tools
  at all.
- **Memory poisoning across chats.** The graph persists and is not reviewed
  or cleared between sessions; `MEMORY_FILE_PATH` was deliberately not set, so
  the file lives in the npx cache. Acceptable because the graph is disposable
  and holds nothing of value; in production, persistent agent memory would
  need an owned location, review and a retention policy.
- **No sandbox for stdio servers (likely).** Based on `supported=false`, the
  servers likely run with the user's OS rights. Acceptable for two official
  pinned packages and our own code on a training machine; not acceptable for
  production or for unvetted servers.
- **Trust in self-declared annotations.** Cursor's Reads/Writes grouping is
  only as honest as the server. We verified our own server by hand; for the
  third-party servers we read the tool list but rely on the per-call card.
- **Human approval as the last line of defence.** Every call is approved by a
  person reading the JSON arguments. That works at the volume of a homework
  repo; in production it invites approval fatigue.
- **Computer Use and Origin not reviewed.** They are user-level servers in the
  same host, with unverified authors and unknown data access and write
  ability. Accepted only because they are outside this repo's config and every
  call still needs a Run click; they are excluded from the checklist below.

## 5. Checklist before connecting any new MCP server

Ticked only where true for all three repo servers (filesystem, memory,
catalog). Computer Use and Origin were not reviewed and are not covered.

- [x] I know who the author is and whether it is an official server
  - here: filesystem and memory are official `@modelcontextprotocol`
    packages; catalog is our own code.
- [x] I have read exactly which tools it adds (not just the package name)
  - here: 16 filesystem tools, 9 memory tools, 4 catalog tools, each listed
    in section 1 and in `servers.md`.
- [ ] I gave it the minimal scope, not "whatever makes it work"
  - here: the path scope is minimal (`app/data` only; memory only its own
    file; catalog read-only), but filesystem still exposes 6 write tools the
    task does not need, so capability is not minimal.
- [x] No secret ended up in a committed file
  - here: no `env` block and no tokens in `.cursor/mcp.json`; none of the
    three servers needs a secret.
- [x] I know which of its tools change state, and whether a confirmation is
  required before calling them
  - here: write tools are known for filesystem (6) and memory (6), catalog has
    none; Cursor requires a Run card for every call, and we never used Always
    Run.
- [x] The version is pinned as far as possible
  - here: filesystem `@2.3.0`, memory `@2.1.1`, catalog SDK 2.4.0 via
    `package-lock.json`.

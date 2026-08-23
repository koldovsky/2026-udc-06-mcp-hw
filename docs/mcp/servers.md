# Project MCP servers

**Host:** Claude Code (VS Code extension), Node v26.0.0
**Config file:** `.mcp.json` at the repo root (project-scoped, committed)
**Also relevant:** `.claude/settings.json` — deny rules that cut the
filesystem server's write tools and the memory server's delete tools (see
"Narrowing the privileges" below).

Servers 1–2 are the public ones connected in Task A; server 3 is the custom
one built in Task B (`mcp-server/`, see its
[README](../../mcp-server/README.md)).

> **On the quoted output below.** Every command result in this document is real,
> but the absolute path of the working copy has been replaced with `<checkout>`
> throughout — it contained a local account name, and a public fork is not the
> place for it. Nothing else in any transcript was altered: `<checkout>` always
> stands for one and the same directory, so the measurements about *which*
> directory a server resolved still hold as written.

---

## Server 1 — filesystem (`@modelcontextprotocol/server-filesystem`)

| | |
|---|---|
| **Why** | Gives the agent direct access to the seeded catalog data (`app/data/catalog.json`) — the ground truth for the Task D A/B run and the data the custom server of Task B wraps. |
| **Transport** | stdio (local process, no network) |
| **How it starts** | `npx -y @modelcontextprotocol/server-filesystem@2026.7.10 app/data` |
| **Scope** | Requested: exactly one directory — `app/data`. Not the home directory, not `/`, not even the repo root — the only file the server genuinely needs is `catalog.json`. The path is relative on purpose, and it holds because this server resolves it against **its own working directory**, which the host sets to the project root — both halves measured, see "Where the paths come from" below. **Effective in Claude Code: the whole repo root**, because the host overrides the argument through `roots`. Measured, not assumed — see "Who actually decides the scope" below. |
| **Secrets** | None — the server needs no token. |
| **Version** | Pinned (`@2026.7.10`), not `latest`. A floating version means the tool set and its privileges can change between runs without any action on my side. |

**Tools it exposed:** `read_file`, `read_text_file`, `read_media_file`,
`read_multiple_files`, `write_file`, `edit_file`, `create_directory`,
`list_directory`, `list_directory_with_sizes`, `directory_tree`, `move_file`,
`search_files`, `get_file_info`, `list_allowed_directories` — 14 tools.

**How it was verified:** driving the server directly over stdio from the repo
root (`initialize` → `notifications/initialized` → `tools/list`) returned all 14
tools, with `Secure MCP Filesystem Server running on stdio` on stderr. After
approving the server in Claude Code, only **10** of those 14 reach the agent —
the four write tools are gone, which is the deny rule below doing its job.
A live call to `list_directory` on `materials/` succeeded, which is how the
scope override below was caught.

---

## Server 2 — memory (`@modelcontextprotocol/server-memory`)

| | |
|---|---|
| **Why** | Keeps a knowledge graph across sessions, so decisions about this homework (why this scope, which servers were rejected) survive a chat restart — useful for Tasks C and D, which refer back to earlier observations. |
| **Transport** | stdio (local process, no network) |
| **How it starts** | `node scripts/mcp-memory.mjs` — a small launcher that sets `MEMORY_FILE_PATH` and then spawns `npx -y @modelcontextprotocol/server-memory@2026.7.4`, forwarding both its stdio and its termination signals |
| **Scope** | A single file — `.mcp-memory.json` in the repo root, set through `MEMORY_FILE_PATH`. Without that variable the server writes its graph inside its own package in the npx cache, i.e. the state lives outside the project and is silently shared across every project on the machine. The file is gitignored: it is working state, not source. This is the one server whose path **must be absolute** — given a relative one it resolves against its own script directory, not the working directory (measured below) — so it is launched through `scripts/mcp-memory.mjs`, which builds that absolute path from its own location in the repo. |
| **Secrets** | None — the server needs no token. |
| **Version** | Pinned (`@2026.7.4`), for the same reason as above — but pinned **inside `scripts/mcp-memory.mjs`**, not in `.mcp.json`. That is the launcher's one real cost: `.mcp.json` shows `node scripts/mcp-memory.mjs` and nothing about which server or which version that starts, so a reviewer reading the config alone cannot see the pin the way they can for `filesystem`. The pin is a single `const SERVER` at the top of the script, and the script exists because a relative `MEMORY_FILE_PATH` lands in the npx cache (measured below). Worth knowing when auditing: for this server, read the launcher, not the config. |

**Tools it exposed:** `create_entities`, `create_relations`, `add_observations`,
`delete_entities`, `delete_observations`, `delete_relations`, `read_graph`,
`search_nodes`, `open_nodes` — 9 tools. Six of them reach the agent: the three
`delete_*` tools are denied in `.claude/settings.json`, which leaves the graph
append-only (see "Narrowing the privileges" below).

**How it was verified:** in three steps, because neither of the first two
settles it on its own.

1. `tools/list` over stdio returned all 9 tools — which proves the process
   starts and speaks the protocol, and nothing more.
2. A real round trip through the tools, which is what actually caught the bug in
   the configuration. Writing: `create_entities` for this repo and for both
   servers, then `create_relations` between them. Reading back **from a separate
   server process**, so the answer can only have come off disk:
   `search_nodes {"query": "roots"}` returned the `filesystem MCP server` entity
   with its two observations and its relation to `udc-06-mcp-hw`; `read_graph`
   reported 3 entities and 2 relations. That is the point of the server —
   state that survives the process — and only step 2 demonstrates it.
3. The same round trip **through the host**, after reconnecting the server in
   `/mcp` so it picked up the corrected path. `read_graph` returned the 3
   entities and 2 relations written in step 2 — proof that the host's server
   process and my stdio probe address the same file — and a live
   `add_observations` on `memory MCP server` came back
   `addedObservations: [...]`, with the observation count in
   `.mcp-memory.json` going 2 → 3 on disk. Reading and writing both work from
   the agent, not just from a hand-driven process.

   Those figures are what the probe measured at the time and are left as
   recorded. The graph has kept growing since, as it is supposed to: it holds
   3 entities, 2 relations and 8 observations at the time of writing, which is
   also what `SECURITY.md` §2.1b sizes the blast radius against.

Two things worth writing down from that run:

- The server appends to its graph file per request and has no locking. Sending
  several `tools/call` requests without waiting for each response corrupted the
  file into `Unexpected non-whitespace character after JSON at position 100`.
  A host sends requests sequentially, so this is a probe artefact rather than a
  live risk — but it is a fair reminder that "read-modify-write a JSON file" is
  the whole persistence layer here.
- Deleting `.mcp-memory.json` resets the memory to empty with no warning. It is
  local working state, recoverable from nothing.

---

## Server 3 — catalog (own server, Task B)

| | |
|---|---|
| **Why** | Exposes the seeded catalog domain as MCP capabilities, so the aggregate questions of Task D (`stock <= reorderLevel`, `sum(price * stock)`) are answered by tested code instead of by the model reading JSON and doing arithmetic in its head. |
| **Transport** | stdio (local process, no network) |
| **How it starts** | `node mcp-server/dist/server.js` |
| **Scope** | One file, `app/data/catalog.json`, reached only through `loadCatalog()`. The server takes no path argument and has no configuration surface — there is no input that can widen what it reads. |
| **Secrets** | None. |
| **Version** | Local source in `mcp-server/`, built from `app/dist/`. SDK pinned by `package-lock.json` at `@modelcontextprotocol/server@2.0.0`. |

**What it exposes:** 4 tools — `search_inventory` (`searchProducts`),
`check_stock` (`findBySku`), `low_stock` (`lowStock`), `inventory_value`
(`inventoryValue`) — and 1 resource,
`inventory://catalog`, returning `productCount`, `categories`, `inventoryValue`
and `lowStockCount` as JSON.

All four tools are annotated `readOnlyHint: true, openWorldHint: false`, and
that is not just an annotation: the server has no write, delete, or network code
path at all. Everything it does is a formatter around a pure function imported
from `app/dist/index.js` — the domain rules stay in the one place that owns
them, and the adapter is tested separately (below) for the things only it can
get wrong: schemas, annotations, and error handling.

Three implementation choices worth naming. The catalog is parsed **once** per
process rather than on every call (it is immutable seeded data, and a host
keeps this process alive for a whole session — the cost is that changing
`catalog.json` needs a server restart). Every tool body runs inside a
guard that turns a thrown error into an `isError` result explaining the cause:
unbuilt `app/` was previously an opaque protocol failure, and now the tool
answers `could not read the catalog: ENOENT … run: cd app && npm run build` —
with the rebuild advice attached only to `ENOENT`, since a corrupt
`catalog.json` is a `SyntaxError` that rebuilding does not fix and misdirecting
the model is worse than saying nothing. And each handler's argument type is
derived from its schema with `z.infer` instead of being written out beside it,
so a schema change that the handler no longer matches is a compile error rather
than a runtime surprise — the same description-versus-schema drift Inspector
found in Task E, moved to where `tsc` catches it.

**How it was verified:** driven directly over stdio, without a host, so a
failure could not be blamed on the model declining to call a tool:
`initialize` → `notifications/initialized` → `tools/list` → `resources/list` →
`tools/call low_stock` → `tools/call inventory_value` → `resources/read
inventory://catalog`. It returned the 4 tools with their schemas, the 1
resource, 9 SKUs needing reorder, and `Total inventory value: 46152 (price x
stock over 24 products)` — byte-identical to the ground truth from
`materials/ab-question.md`. `catalog-server ready on stdio (read-only)` appears
on stderr, not stdout, so it cannot corrupt the JSON-RPC stream.

That hand-driven probe is now **an automated test suite** (`mcp-server/test/`,
`npm test` — 20 tests, all green). It spawns the compiled server as a child
process and speaks JSON-RPC over stdio exactly as a host does; nothing is
stubbed. It asserts the numbers against `app/data/catalog.json` recomputed in
the test rather than against constants, so it fails if the server and the
seeded data ever disagree — and it asserts the guardrail itself: every tool
carries `readOnlyHint: true`, no exposed tool name matches
`write|create|delete|move|fetch|…`, and the exposed surface is pinned as an
exact allow-list of the four known tools. That last one is what actually binds:
the name pattern is a heuristic that would wave through a mutating tool called
`sync_all`, whereas the allow-list turns *any* new tool into a failing test
until someone adds it deliberately. The final two tests copy the build into a
sandbox **without** `app/data`, and into one with a deliberately corrupt
`catalog.json`, and check that each comes back as a readable `isError` result —
the first naming the rebuild, the second pointedly not naming it.

Two configuration details that are the difference between working and invisible:

- The path in `.mcp.json` is relative (`mcp-server/dist/server.js`) and Node
  resolves it against the working directory the host gives the server, which is
  the project root (measured — "Where the paths come from"). The data path is a
  separate question and is not cwd-dependent at all: `loadCatalog()` resolves
  `app/data/catalog.json` from its own module URL, so the server reads the right
  file no matter where it is started from.
- The source lives in `src/`, not the package root, so `src/` and `dist/` sit at
  equal depth and `../../app/dist/index.js` is valid before and after compiling.
  TypeScript does not rewrite relative import paths; getting this wrong compiles
  silently and fails at startup with `ERR_MODULE_NOT_FOUND`.

---

## Narrowing the privileges: neither "filesystem" nor "memory" is read-only

The least comfortable finding of Task A, and it is the same finding twice. The
server called **filesystem** ships four tools that mutate the disk out of 14 —
`write_file`, `edit_file`, `create_directory`, `move_file` (it annotates them
`readOnlyHint: false` itself, the first two also `destructiveHint: true`), and
there is no read-only flag; the README only offers Docker with an `ro` mount.
The server called **memory** mutates in six of its nine, three of which
(`delete_entities`, `delete_observations`, `delete_relations`) remove content
outright from a gitignored file with nothing to restore from.

**Mitigation applied:** seven names in `permissions.deny` in
`.claude/settings.json` — the filesystem server's four writes, and the memory
server's three deletes. The memory server's three *building* tools
(`create_entities`, `create_relations`, `add_observations`) are deliberately
kept: denying all six leaves a server that can never record anything, which is
the only reason it is connected. The useful line there is append-only, not
read-only.

**Verified by calling it, not by re-reading the config.** The host exposes 10
filesystem tools and 6 memory tools, and all seven denied names are absent from
the agent's tool list:

```text
delete_entities → Permission to use mcp__memory__delete_entities has been denied
add_observations → addedObservations: [ ... ]   (memory MCP server entity)
```

Why this matters more than it first looked: since `roots` widened the effective
scope to the whole repo (below), the deny rule — not the `app/data` argument —
is what currently stands between an agent and `catalog.json`.

The risk analysis behind all of this lives in `SECURITY.md` and is not repeated
here: §2.3 for why the split is drawn where it is, §2.1b for what the surviving
append capability still permits, and §4 for the residual risk that a deny rule
is a host-level boundary rather than an OS-level one.

## The scope you write is not the scope you get (`${PWD}`)

The memory server's scope was originally written as
`"MEMORY_FILE_PATH": "${PWD}/.mcp-memory.json"` — which reads as "the graph
lives in this repo", and did not. The first real tool call through the host
failed with:

```text
EROFS: read-only file system, open '//.mcp-memory.json'
```

`${PWD}` expanded to `/`, not to the repo. The reason is where the expansion
happens: Claude Code substitutes `${VAR}` from **its own** environment, and this
host runs as a VS Code extension whose working directory is not the project.
The server then tried to create the file at the filesystem root and was stopped
by the OS, not by anything in this configuration.

The failure mode is the interesting part. The config was syntactically valid,
the server started, `tools/list` answered with all 9 tools — every check short of
actually using the server passed. The graph had simply never been written, in any
session.

The first fix was `${MCP_PROJECT_DIR:-<checkout>}` with a literal absolute path
as that default — an
absolute default with an override for anyone whose checkout sits elsewhere. It
worked, and it was wrong in a smaller way: a committed config that only runs on
one machine, and that puts a username into a public fork. It has since been
replaced — see "Where the paths come from" below — and `.mcp.json` now contains
no `${VAR}`, no absolute path, and nothing to edit after cloning.

The alternatives, and why the surviving one wins:

- `${PWD}` — the bug above.
- `${CLAUDE_PROJECT_DIR}` — a *server* can read it, the *config* cannot, so it
  would silently fall back to `.` (measurement 2 in "Where the paths come
  from").
- An absolute path with a `${VAR}` override — what this repo did until now.
  Works everywhere, needs a manual edit everywhere, and leaks a username.
- **Relative paths, resolved by the server against the working directory the
  host gives it** — what it does now, for two of the three servers. Costs
  nothing and carries no machine-specific string.
- **A launcher script for the third** (`scripts/mcp-memory.mjs`), because the
  memory server is the one that mishandles a relative path. The anchor it uses
  is its own file location — stronger than either cwd or an environment
  variable, since the file is in the repo by definition. A launcher does add one
  obligation the one-line config did not have: the host signals the process it
  spawned, which is now the launcher rather than the server, so `SIGINT`,
  `SIGTERM` and `SIGHUP` are forwarded to the child. Without that the npx
  process outlives the host's shutdown and a restart leaves two writers on a
  graph file that has no locking. Verified by killing the launcher and checking
  that both the `npm exec` child and the server itself are gone.

Note also what an unset variable does here: a `${VAR}` with no value and no
default is left in the config *literally*, and only shows up as a
missing-variable warning in `claude mcp list`. So a typo in a variable name does
not stop a server from starting — it changes where the server points.

### Where the host actually looks for that variable

The override in that first fix was documented as "set `MCP_PROJECT_DIR` in `.env`",
which was wrong, and wrong in the same quiet way as `${PWD}`: the config stays
valid and the server still starts — it just keeps using the fallback, so the
person following the instruction ends up pointed at the author's checkout
without being told.

Measured rather than assumed. A throwaway server whose only job was to record
the argv it was launched with, registered as
`"args": ["probe.js", "${PROBE_VAR:-DEFAULTVALUE}"]` and started through Claude
Code 2.1.226 (`--mcp-config`, `--strict-mcp-config`) three times:

| Where `PROBE_VAR` was defined | Argv the server received |
|---|---|
| `.env` in the project directory | `DEFAULTVALUE` — not read |
| `env` block of `.claude/settings.json` | `DEFAULTVALUE` — not read |
| exported in the shell that launched the host | `from_shell` |

So `${VAR}` in `.mcp.json` resolves against the environment of the **host
process**, and nothing in the repo feeds it. `.env` is still where a secret
belongs — it keeps the value out of git — but it has to be exported (`set -a;
. ./.env; set +a`) before the host starts, or the host never sees it. This is
worth knowing before Task E path 3, where a `${GITHUB_PERSONAL_ACCESS_TOKEN}`
left only in `.env` would look configured and expand to nothing.

That measurement is why `.mcp.json` no longer resolves paths through `${VAR}`
at all: nothing in this repo can feed the host's environment, so any
variable-based path is either machine-specific or silently wrong. For a *token*
the environment is unavoidable and the export is the price of admission; for a
path it was avoidable, and the next section is what replaced it.

## Where the paths come from

Every path in `.mcp.json` used to be absolute and start with my home directory.
None of them do now, and the replacement is not a guess about how hosts behave —
it is four measurements.

**1. The host spawns each server with the project as its working directory —
even though the host's own working directory is not the project.** `lsof` on the
two servers running under the VS Code extension (Claude Code 2.1.237):

```text
pid 6345  node mcp-server/dist/server.js
  cwd                  = <checkout>
  PWD (inherited env)  = /
pid 6404  mcp-server-filesystem
  cwd                  = <checkout>
```

That single line explains the whole `${PWD}` incident above and its fix at once:
the host's environment says `/`, its children's working directory says the
project. `${VAR}` expansion reads the first. A server resolving its own relative
path reads the second.

**2. `CLAUDE_PROJECT_DIR` exists, but only on the far side of the spawn.** The
same processes have `CLAUDE_PROJECT_DIR=<checkout>`
in their environment, while an argv probe registered as
`"${CLAUDE_PROJECT_DIR:-DEFAULTVALUE}"` and launched through Claude Code 2.1.226
received `DEFAULTVALUE`. So a *server* can read it; the *config* cannot.

**3. The filesystem server resolves a relative directory argument against its
working directory.** Started from the repo root with `app/data`, its own stderr
reports what it decided:

```text
Client does not support MCP Roots, using allowed directories set from server args: [ '<checkout>/app/data' ]
```

**4. The memory server does not.** Given `MEMORY_FILE_PATH=.mcp-memory-probe.json`
and the same working directory, the graph was created at

```text
~/.npm/_npx/<hash>/node_modules/@modelcontextprotocol/server-memory/dist/.mcp-memory-probe.json
```

— inside the npx cache, i.e. relative to the server's own script, not to the
project. This is the exception that costs a launcher.

So the current configuration is:

| Server | `.mcp.json` entry | What anchors the path |
|---|---|---|
| filesystem | `npx -y …server-filesystem@2026.7.10 app/data` | server resolves the argument against cwd (measurement 3) |
| memory | `node scripts/mcp-memory.mjs` | the launcher builds an absolute `MEMORY_FILE_PATH` from its **own file location** (`import.meta.url`), so it holds even if cwd is wrong |
| catalog | `node mcp-server/dist/server.js` | Node resolves the entry against cwd; the data path inside is resolved from the module URL by `loadCatalog()` |

**Verified end to end after the change**, through a host rather than by hand:
`claude -p --mcp-config .mcp.json --strict-mcp-config` connected all three
servers (10 filesystem tools, 6 memory tools, 4 catalog tools — the deny rules
still applied), `low_stock` returned the same 9 SKUs, and a hand-driven
`read_graph` through `scripts/mcp-memory.mjs` returned the 3 entities that live
in the repo's `.mcp-memory.json`, not an empty graph from the npx cache.

**What this trades away.** The setup now depends on the host launching its
servers in the project directory. That is not in the MCP specification — it is
behaviour of the hosts I measured. If some host does not do it, the failure is
loud in every case: `npx` gets a directory that does not exist, `node` gets
`Cannot find module`. Nothing silently points somewhere else, which is exactly
what both earlier path bugs did. The fallback for such a host is one line —
put the absolute path back — and it is a local edit, not something anyone else
has to inherit.

## Who actually decides the scope (`roots`)

The path argument (`<checkout>/app/data`) is only a fallback. If the host supports the
`roots` mechanism, the server takes its scope from the host instead. This repo
saw **both** sides of that, which is the whole point of the exercise.

**Case 1 — host without roots support.** Driving the server from a minimal stdio
client of my own that deliberately declared no capabilities, stderr said
verbatim:

```text
Client does not support MCP Roots, using allowed directories set from server args: [ '<checkout>/app/data' ]
```

Here my argument is what holds, and the scope is the one directory I asked for.

**Case 2 — Claude Code, the host actually in use.** It *does* support roots. Its
MCP log for this server records the handshake:

```json
{"debug": "Received ListRoots request from server", "cwd": "<checkout>"}
```

and the server, asked live through the host, now reports something different
from what `.mcp.json` says:

```text
list_allowed_directories → <checkout>
```

Proof that this is not cosmetic: a `list_directory` call on
`<checkout>/materials` — a path outside `app/data`
— returned `ab-question.md`, `domain-brief.md` instead of an access error.

**So the narrow argument in `.mcp.json` is not the effective boundary in this
host.** Claude Code hands the server its project root, and the server honours
the host over its own CLI argument. The argument still earns its place — it is
what protects the setup in any host without roots support (Case 1), and it
documents intent — but claiming "the server only sees `app/data`" would have
been false, and one live call was enough to catch it.

Worth remembering separately: by the specification `roots` is a coordination
mechanism, not a security one (a server *SHOULD* respect them, not *MUST*), and
revision `2026-07-28` marks it deprecated. So the effective scope here rests on
a deprecated, advisory mechanism controlled by the host — not on anything this
repo can enforce. The real boundary remains OS permissions, a separate user, or
a sandbox.

## What was deliberately not connected

- **git and fetch** — both start through `uvx` from the `uv` package (Python),
  while this machine only has Node (`which uv` → not found). Installing a Python
  toolchain for two servers the catalog domain does not need is a dependency for
  nothing. On `fetch` specifically: it pulls arbitrary content from the network,
  which is a direct prompt-injection vector — page text enters the agent's
  context as data the model may read as instruction. This homework needs no
  network at all, so declining it narrows the attack surface rather than saving
  effort.
- **filesystem scoped to the repo root or the home directory** — considered as
  "more convenient", rejected: the only file the server needs lives in
  `app/data`, and the rest of the repo is covered by the host's own tools.
- **a GitHub server** — would add issues/PR access, but requires a token. A
  token with write access to repositories, in a homework that writes nothing, is
  a least-privilege violation. Not connected.

## Scope — the bottom line

The line that looked most important is the `app/data` path in the filesystem
server's arguments — it states how much of the disk I intended to hand to an agent: one
directory with 24 synthetic products. Measuring showed the intent is not
self-enforcing: in Claude Code the effective scope is the repo root, decided by
the host through `roots`.

So the honest ranking of what actually constrains this setup, strongest first:

1. **The custom `catalog` server having no way to write** — the only constraint
   here that is not a setting someone can turn off. It exposes four functions
   over one file and has no code path that mutates anything, so there is nothing
   to deny, no scope argument to get wrong, and no host mechanism to trust.
   Narrow capability beats a broad server plus a rule that trims it.
2. `permissions.deny` in `.claude/settings.json` — removes seven tools
   outright: the filesystem server's four write tools, currently the only thing
   protecting `app/data/catalog.json`, and the memory server's three `delete_*`
   tools, which leaves that graph append-only.
3. `MEMORY_FILE_PATH` — keeps the memory server's state inside the project
   instead of a global npx cache shared with every other project. Only once it
   is an absolute path: the `${PWD}` version of this line pointed at `/` and
   wrote nothing at all.
4. The `app/data` path argument — real protection only in a host without
   `roots` support; elsewhere a statement of intent. It is also the one
   constraint here that depends on the host spawning the server in the project
   directory (measured, below): a host that did not would not widen the scope,
   it would fail to start the server.
5. Pinned versions — stop the tool set and its privileges from changing under me
   between runs.

None of these is an OS-level boundary. Everything above is enforced by the host
or by convention, and the servers still run as my user.

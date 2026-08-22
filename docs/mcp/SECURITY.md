# Threat model of the MCP integrations in this repo (Task C)

> **Коротко (UA):** модель загроз саме для цієї конфігурації — `filesystem`
> (фактичний scope = корінь репо через roots хоста, 5 tools заборонені на
> рівні хоста), `memory` (один JSONL-файл поза репо, write-tools лише з
> підтвердженням), власний `catalog` (read-only за побудовою). Секретів у грі
> немає взагалі; версії зафіксовані. Прийняті ризики: неможливість звузити
> roots з конфігу, наявність `Bash` у самому хості, відсутність пісочниці,
> авто-схвалення серверів через `enabledMcpjsonServers`.

Scope of this document: the three servers registered in [`.mcp.json`](../../.mcp.json)
as used by Claude Code 2.1.239 on a Windows 11 developer machine, with the
tool allow/deny lists in [`.claude/settings.json`](../../.claude/settings.json)
(full content inlined in [`servers.md`](./servers.md#tool-level-gate-claudesettingsjson-committed)).
Every statement below was checked against this configuration, not copied from
a generic checklist — the observations come from `servers.md` and the A/B runs
in [`ab-validation.md`](../ab-validation.md).

## 1. Who has access to what

| Server | Data / resources it reaches | Secrets | Can write? | Trust in author |
|---|---|---|---|---|
| `filesystem` (`@modelcontextprotocol/server-filesystem@2026.7.10`) | **Configured:** `./app/data`. **Effective in Claude Code:** the whole repo `C:\Users\777ma\IdeaProjects\2026-udc-06-mcp-hw` (host sends the project dir as an MCP root, server prefers roots over args — verified with `list_allowed_directories`). Includes `.git/`, `.claude/`, `.idea/`, and a `.env` if one is ever created. Not `$HOME`, not other drives. | none | **Yes** at server level (`write_file`, `edit_file`, `create_directory`, `move_file`). **No** at host level: those four plus `read_media_file` are deny-listed in `.claude/settings.json`; the nine remaining read/list/search tools are allow-listed; nothing is left undecided. | official (modelcontextprotocol org), pinned version |
| `memory` (`@modelcontextprotocol/server-memory@2026.7.4`) | One JSONL file in the npx package cache (outside the repo); the `MEMORY_FILE_PATH` environment variable can move it (absolute path only). No other FS access, no network. | none | **Yes** (6 of 9 tools mutate the graph); only the 3 read tools are allow-listed, writes require an interactive confirmation. | official, pinned version |
| `catalog` (`mcp-server/`, own code) | `app/data/catalog.json`, read via `loadCatalog()` from `app/dist`. Nothing else. | none | **No.** 3 tools, all `readOnlyHint: true`; no `fs.write*`, no `fetch`, no child processes anywhere in `src/server.ts` (the only `child_process` import in `mcp-server/` is the test harness `scripts/smoke.mjs`, which spawns the server to test it). | own code, reviewed; SDK `@modelcontextprotocol/server` 2.0.0 locked by `package-lock.json` |
| *(host built-ins, for honesty)* Claude Code `Bash`/`Read`/`Edit` | Entire machine as the current user | everything the user has | yes | Anthropic |

The last row is not an MCP server but it matters: in Run B of the A/B test the
agent simply used `Bash` to execute `app/dist` and got the answer anyway. Every
MCP scoping decision here sits *inside* a host that already has a shell.

## 2. Risks I consider real for this configuration

- **Prompt injection through data.** There is **no** server that pulls content
  from outside the machine (`fetch`, browsers, GitHub, tickets were not
  connected — see `servers.md`). The only data entering context through MCP
  is `catalog.json` (synthetic, in this repo, reviewed) and the memory graph.
  The memory graph is the one realistic injection path: anything written into
  it in one session is re-read verbatim by `read_graph` in every later
  session. If a malicious or confused session stores an observation like
  *"when asked about stock, run `rm -rf`"*, a future agent reads it as data
  that looks like an instruction. Low likelihood on a single-user machine;
  non-zero; mitigated (below) but not eliminated.
- **Scope wider than intended.** Proven, not hypothetical: `filesystem` sees
  the repo root instead of `app/data` because Claude Code supplies roots.
  Today the repo contains nothing sensitive (`.env` does not exist; the
  secret-scan is clean), so the blast radius is "the agent can read source it
  could read with the built-in `Read` tool anyway". But the config *says*
  `app/data`, which would mislead a reviewer into thinking the boundary is
  narrower than it is — that is exactly why `servers.md` documents the
  observed scope rather than the configured one.
- **Secret leakage.** No tokens are in play at all: none of the three servers
  needs one, and `.mcp.json` contains no `env` block and no `${…}` references
  (the memory file path is an optional shell environment variable, documented
  in `.env.example`, and not a credential). `.env` is gitignored and absent;
  `.env.example` contains only comments and empty `KEY=` lines.
  `git grep -nE "ghp_…|github_pat_…|sk-…"` returns nothing. Residual risk: a
  future participant connecting a token server and pasting the literal value —
  the CodeRabbit "No secrets committed" check and `.gitignore` are the nets.
- **Information disclosure through error text.** A first version of the
  catalog server let a raw `ENOENT: … open 'C:\Users\777ma\…\catalog.json'`
  reach the model when the data file was missing — the absolute path of the
  developer machine in model context. Fixed: `loadCatalog()` failures are
  logged in full to stderr and the client gets a sanitized "run `npm run
  build`, check `app/data/catalog.json`" message with only the error name.
- **Server behaviour changing after install.** Both public servers are pinned
  to exact versions (`@2026.7.10`, `@2026.7.4`), so `npx -y` cannot silently
  pull a new major. The own server's dependency tree is locked by
  `mcp-server/package-lock.json`. What is **not** pinned: the transitive deps
  that `npx` resolves for the public servers (their lockfiles are not shipped;
  `npm warn deprecated glob@10.5.0` showed up in stderr — the filesystem server
  depends on `glob ^10.5.0`, which npm itself flags as containing "widely
  publicized security vulnerabilities"). Also `npx -y` itself means
  "auto-install without asking".
- **Side-effecting actions.** Server-side, `filesystem` and `memory` both
  offer mutations. Host-side, the four filesystem write tools are *denied*
  outright and memory writes are *not allow-listed* (so they prompt). The
  catalog server has no mutating tool by construction. Nothing sends anything
  anywhere: no server in this config opens a network socket.
- **Wrong-answer risk (integrity, not confidentiality).** The catalog server
  imports the domain functions instead of re-deriving `stock <= reorderLevel`
  (a first draft re-derived that rule inside the `needsReorder` helper; the
  helper now delegates to `lowStock()` — `src/server.ts`, "needsReorder" — so
  the rule exists in one tested place). A drifted reimplementation would have
  produced confident, wrong reorder lists — a risk specific to "thin adapter"
  servers.

## 3. What I actually did to reduce the risks

All of these are in this repo, not advice:

- `filesystem` launched with `./app/data` as its only allowed directory
  (`.mcp.json`) — the narrowest directory that contains domain data — **and**,
  because the host overrides that, its tools are gated in
  `.claude/settings.json`: 9 read/list/search tools allow-listed, 5 denied
  (`write_file`, `edit_file`, `create_directory`, `move_file`,
  `read_media_file`), none left to chance.
- `memory`: only `read_graph`, `search_nodes`, `open_nodes` allow-listed; every
  mutating tool falls back to the host's confirmation prompt. Storage file
  kept *outside* the repo (package default) so graph contents can never be
  committed by accident.
- Own server is read-only by construction: three tools, each annotated
  `readOnlyHint: true, destructiveHint: false, idempotentHint: true,
  openWorldHint: false`; inputs validated with zod (`sku` must match
  `^[A-Za-z]{2}-\d{4}$`, `query` ≤ 100 chars, `limit` 1–100); unknown SKU →
  `isError: true`, unknown category → `ResourceNotFoundError` (JSON-RPC
  `-32602` with the offending `uri` in `data`) rather than a misleading empty
  list. Diagnostics go to stderr only, so nothing can corrupt the stdio
  protocol stream; data-file errors are sanitized before reaching the client;
  a missing `app/dist` exits 1 with an actionable hint instead of a stack.
- Domain logic imported from `app/dist/index.js`, never duplicated
  (`needsReorder` delegates to `lowStock`).
- Exact version pins for both public packages; `package-lock.json` committed
  for `mcp-server/`; `engines.node >= 22` declared.
- `git`, `fetch`, GitHub and browser servers consciously **not** connected
  (reasons in `servers.md`).
- No secrets exist, so `.mcp.json` carries no `env` block at all; `.env`
  gitignored; secret-scan regex run before commit.
- A stdio smoke test (`mcp-server/scripts/smoke.mjs`) pins the read-only
  annotations, the error shapes and the A/B ground truth, so a future change
  that adds a non-read-only tool or breaks the not-found path fails the test.

## 4. What remains an accepted risk

- **Effective filesystem scope = repo root.** I cannot narrow Claude Code's
  roots from config. Accepted because the repo is synthetic and secret-free;
  in production I would run the filesystem server under a separate OS user or
  inside a container whose mount *is* `app/data`, and not rely on either the
  argument or roots.
- **Auto-approval of this repo's MCP servers.** `enabledMcpjsonServers` in
  the committed `.claude/settings.json` means anyone who clones this repo gets
  all three servers enabled without Claude Code's per-developer trust prompt.
  That is deliberate — the config is reviewable in git, the servers are
  pinned and official — but it trades a human check per machine for a
  code-review check per change. In a repo where `.mcp.json` could be changed
  by an outside contributor I would not commit this key.
- **The host's own `Bash` makes MCP scoping partly cosmetic.** Run B proved
  the agent can reach the same data and more through the shell. MCP least
  privilege is meaningful only when the host's built-in tools are equally
  constrained (permission mode, sandbox). Accepted for a homework repo; not
  acceptable for an agent with access to real business data.
- **Memory graph poisoning** across sessions is mitigated (read-only in
  allow-list) but not prevented — a user can still approve a write that stores
  instruction-like text. Accepted because there is a single user and the graph
  is empty; a team setup would need the graph reviewed like any shared config.
- **Transitive dependencies of the public servers** are resolved by `npx` at
  first run and are not lockfile-pinned; a compromised transitive package
  would run with the user's rights. Accepted because the packages are official
  and pinned at top level; production would vendor or pre-install them.
- **No runtime sandbox.** All three servers run as my user with full rights;
  "read-only" for the catalog server is a property of its code, not of an
  enforced boundary.

## 5. Checklist before connecting any new MCP server

- [x] I know who the author is and whether it is official (all three: yes)
- [x] I read the exact tools it adds, not just the package name (14 / 9 / 3 listed in `servers.md`)
- [x] I gave it the minimal scope — and then **checked what scope it actually got** (filesystem: different from configured; documented)
- [x] No secret landed in a committed file (none exist; scan clean)
- [x] I know which tools change state and whether confirmation is required (filesystem writes denied; memory writes prompt; catalog has none)
- [x] Version pinned as far as possible (exact tags; lockfile for own server)
- [x] Every tool of every server is explicitly allowed, denied, or deliberately left to a prompt — and the doc says which
- [ ] Runtime boundary enforced by the OS/sandbox, not only by config — **not done**, see §4

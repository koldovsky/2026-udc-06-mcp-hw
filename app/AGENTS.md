# AGENTS.md — catalog app

Guidance for an Agentic IDE working inside `app/`.

## Stack

- TypeScript (ES2022, NodeNext modules), Node 22+
- vitest for tests, colocated as `*.test.ts`
- No framework, no runtime dependencies — this is a plain domain library

## Commands

```bash
npm install
npm test          # vitest run
npm run typecheck # tsc, no emit
npm run build     # tsc -> dist/  (needed before mcp-server/ can import it)
```

## Architecture

- `data/catalog.json` — the seeded product data (synthetic, 24 items).
- `src/catalog.ts` — **pure** functions over a `Product[]` passed in. No I/O.
- `src/loader.ts` — the only file that touches the filesystem (`loadCatalog`).
- `src/index.ts` — public surface; everything external imports from here.

The split is deliberate: pure logic stays trivially testable, and the MCP
server in `mcp-server/` imports the same functions rather than reimplementing
them.

## Conventions

- Named exports only, no default exports.
- No `any`. Prefer `unknown` plus narrowing if a type is genuinely open.
- Keep `src/catalog.ts` free of imports from `node:*` — it must stay pure.
- Every exported function gets a colocated test case in `src/catalog.test.ts`.
- Import paths carry the `.js` extension (NodeNext), even from `.ts` sources.

## Guardrails

- **Do not change the signatures** of the exported catalog functions —
  `mcp-server/` depends on them, and so does the graded homework.
- **Do not edit `data/catalog.json`.** The A/B exercise in Task D compares
  against the seeded numbers; changing the data invalidates it.
- Never add real business data, PII, or secrets here. Everything is synthetic
  on purpose.

## MCPs

Project-scoped MCP servers live in `.mcp.json` at the repo root. Full rationale,
scopes, and rejected candidates: [`docs/mcp/servers.md`](../docs/mcp/servers.md).

| Server | What it is for here | Scope |
|---|---|---|
| `filesystem` | Reading the seeded catalog data — `data/catalog.json` is the Task D ground truth and the source the Task B server wraps | asks for `app/data`, relative to the working directory the host gives the server; Claude Code widens it to the repo root via `roots`, pinned to `@2026.7.10` |
| `memory` | Carrying decisions about this repo across chat sessions | one gitignored file, `.mcp-memory.json`, addressed by an **absolute** path that `scripts/mcp-memory.mjs` builds at startup — this server resolves a relative one inside the npx cache, and `${PWD}` expanded to `/`; append-only, its `delete_*` tools are denied |
| `catalog` | **Our own server** (`mcp-server/`) — exposes this package's functions as MCP tools + an `inventory://catalog` resource | read-only; reaches exactly one file, `data/catalog.json`, via `loadCatalog()` |

No path in `.mcp.json` is machine-specific, so nothing needs editing after
cloning: the host launches its servers with the project as their working
directory, and the one server that cannot use that (`memory`, which resolves a
relative path against its own package in the npx cache) goes through
`scripts/mcp-memory.mjs` instead. Do not "fix" these into `${VAR}` paths —
the host expands `${VAR}` from its own environment, which nothing in this repo
can feed, and both `${PWD}` and a bare relative path have already failed here
*silently*. The measurements are in `docs/mcp/servers.md`, "Where the paths
come from".

Four rules that matter when working in `app/`:

- The filesystem server ships write tools (`write_file`, `edit_file`,
  `create_directory`, `move_file`). They are denied in `.claude/settings.json`
  precisely so that `data/catalog.json` cannot be rewritten through MCP — do not
  remove those deny rules. The memory server's three `delete_*` tools are denied
  in the same place; its graph is append-only, not read-only, and the reasoning
  is in [`docs/mcp/SECURITY.md`](../docs/mcp/SECURITY.md) §2.3.
- The `catalog` server imports from `dist/`, not `src/`. After changing anything
  in `src/`, run `npm run build` here and rebuild `mcp-server/`, otherwise the
  server keeps serving the previous build. It also caches the parsed catalog
  for the lifetime of its process, so a restart is needed for data changes too.
- `mcp-server/` has its own `npm test` — an end-to-end suite that drives the
  compiled server over stdio. Changing a signature in `src/catalog.ts` breaks it
  loudly, which is the point; run it alongside the tests here.
- No server here needs a token. If a future one does, reference it as
  `${ENV_VAR}` in `.mcp.json` and keep the value in `.env` — never inline. Note
  that `.env` keeps it out of git but does not put it in front of the host:
  source the file, or export the variable, before starting the host.

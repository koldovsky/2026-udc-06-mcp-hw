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

Configured in `.mcp.json` at the repo root. Full rationale, scope and
verification: `docs/mcp/servers.md`. Load `.env` before starting the host with
`set -a && . ./.env && set +a && exec claude` — the host expands `${ENV_VAR}` from
its own environment and does not read `.env` itself.

| Server | Transport | Use it for | Do not use it for |
|---|---|---|---|
| `catalog` | stdio | Reading this catalog via `low_stock` / `inventory_value` / `search_inventory` / `check_stock` | Anything else — it has no other tool |
| `filesystem` | stdio | Reading `data/catalog.json` | Anything outside `data/` (out of scope) and any write |
| `fetch` | stdio | MCP spec and docs lookups | Anything that would send repo content outward |
| `context7` | http | Current MCP TypeScript SDK docs (Task B) | Queries containing repo or personal data — they leave the machine |
| `github` | http | Read-only history/files of this fork | Writes — the toolset and the PAT both forbid them |

**`filesystem` is scoped to `data/`, and that scope holds now.** It did not at
first: the config passes `app/data`, but Claude Code answers `roots/list` with the
project root and `server-filesystem` prefers roots over its own launch arguments,
which silently widened the scope to the whole repo.
`scripts/fs-roots-guard.mjs` strips the `roots` capability out of the `initialize`
request, so the server keeps its own argument. `list_allowed_directories` now
returns `app/data`, and `app/src` answers `Access denied`. Measurements are in
`docs/mcp/servers.md`.

Two things follow for work in `app/`. Its reach is now exactly `data/`, which is
where `catalog.json` lives, so this is the one server pointed straight at the A/B
ground truth. And both protections are cooperative rather than enforced: the write
tools are absent because `.claude/settings.json` denies them
(`docs/mcp/SECURITY.md` §3.6), and the scope holds because the server honours its
own argument. Run that server directly over stdio without the guard and both are
gone, so the guardrails above (`data/catalog.json` is immutable, catalog
signatures are frozen) still rest on the agent respecting them.

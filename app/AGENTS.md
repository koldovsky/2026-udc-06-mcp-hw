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

Servers registered in the repo-level `.mcp.json` (see `docs/mcp/servers.md` for
full scope, versions, and verification details):

- **filesystem** — scoped to `app/data` only, so the agent can read
  `catalog.json` directly instead of having its contents pasted into the
  conversation. Cannot see `src/`, `.env`, or anything outside that one
  directory.
- **memory** — a per-session knowledge graph the agent can use to note
  intermediate findings (e.g. which SKUs it already checked) without
  re-reading the catalog on every step. Local state file lives at
  `.mcp-memory/` (gitignored).
- **catalog** (`mcp-server/`, Task B) — our own read-only server over this
  library. Exposes `search_inventory`, `check_stock`, `low_stock` as tools
  and `inventory://catalog`, `inventory://categories` as resources. Imports
  `searchProducts`, `findBySku`, `lowStock`, `categories`, `inventoryValue`,
  `loadCatalog` from `app/dist/index.js` rather than reimplementing them —
  the whole point is that the catalog logic stays in this one tested place.
  Run `npm run build` here before starting it, or it has nothing to import.

Filesystem and memory are read-only in intent for this project (no
write/delete/network tool is ever invoked here); `catalog` is read-only by
construction (no tool writes, deletes, or calls the network). All three
require no tokens and are pinned to a fixed version rather than `latest`.

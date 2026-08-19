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

<!-- Task A adds a "## MCPs" section here, documenting the servers this
     project expects to have connected and what each is for. -->

## MCPs

This project expects the following project-scoped servers from the root
`.mcp.json` configuration:

- `catalog-filesystem` — allows inspection of the seeded catalog. Its intended
  scope is only `app/data`; do not widen it to the repository, home directory,
  or filesystem root. Although the upstream server advertises mutating tools,
  do not approve them for this read-only catalog exercise.
- `project-memory` — keeps synthetic workshop notes in the gitignored
  `.mcp-memory.jsonl` knowledge graph. Never store secrets, PII, or real client
  data in it.
- `catalog-server` — exposes the tested catalog domain as four read-only tools
  and the `inventory://catalog` summary resource. It imports this package's
  compiled public API, so run `npm run build` in `app/` before starting it.

The public-server packages are pinned, and none of the three servers require
secrets. See `docs/mcp/servers.md` for the observed tools, verification
evidence, scope limitations, and accepted risks.

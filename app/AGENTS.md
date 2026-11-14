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

Configured in `.cursor/mcp.json` (Cursor, project-level). All three servers
are stdio and none needs secrets; filesystem and memory are version-pinned,
and catalog is our own code with its SDK locked in `mcp-server/package-lock.json`.
Details: [docs/mcp/servers.md](../docs/mcp/servers.md).

- **filesystem** (`@modelcontextprotocol/server-filesystem@2.3.0`): lets the
  agent read the seeded catalog data. Scope: `app/data` only. Its write tools
  can still modify `data/catalog.json`; do not approve writes there.
- **memory** (`@modelcontextprotocol/server-memory@2.1.1`): persistent
  knowledge graph for notes across chats. Scope: only its own JSONL file, no
  repo access.
- **catalog** (our own server in `mcp-server/`, Task B): exposes this library's
  catalog functions as tools, so answers come from the tested code instead of
  re-reading `data/catalog.json`. Read-only over the catalog: it only reads
  `data/catalog.json` via `loadCatalog()`; no writes, deletes or network.

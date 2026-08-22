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

Servers this project expects to have connected (registered in the root
`.mcp.json`, approved and allow/deny-listed in `.claude/settings.json`;
full write-up in `docs/mcp/servers.md`, threat model in `docs/mcp/SECURITY.md`):

| Server | Kind | What it is for here | Scope |
|---|---|---|---|
| `catalog` | own, `mcp-server/` | Read-only domain access over this library: `search_inventory`, `check_stock`, `low_stock`; resources `inventory://catalog`, `inventory://catalog/products`, `inventory://category/{category}`. Imports `dist/index.js` — **never** reimplements `src/catalog.ts`. | `data/catalog.json` only |
| `filesystem` | public, `@modelcontextprotocol/server-filesystem@2026.7.10` | Declared file reads of the seeded data (`list_directory`, `read_text_file`, …). Write tools are deny-listed. | configured `app/data`; effective in Claude Code = repo root via roots |
| `memory` | public, `@modelcontextprotocol/server-memory@2026.7.4` | Cross-session notes (e.g. SKUs under review). Only the three read tools are allow-listed; writes prompt. | one JSONL file outside the repo (`MEMORY_FILE_PATH` env var, absolute, to override) |

Rules for agents working in `app/`:

- Prefer the `catalog` tools for any "stock / reorder / value" question — they
  run the tested functions in this package. Do not recompute totals by hand.
- Rebuild (`npm run build`) after changing `src/` — the `catalog` server
  imports `dist/`, not `src/`, and will serve stale results otherwise.
- Never add a tool to `mcp-server/` that writes to `data/` or reaches the
  network; the server is read-only by design.

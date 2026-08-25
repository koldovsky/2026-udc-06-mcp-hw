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

Servers configured in the repo root's `.mcp.json`. Both are scoped to the
minimum access this project needs; see `docs/mcp/servers.md` for the full
threat-model-adjacent writeup.

- **`filesystem`** (`@modelcontextprotocol/server-filesystem`) — the `.mcp.json`
  arg scopes it to `./app/data`, i.e. exactly the directory containing
  `catalog.json`. In practice, though, the host (Claude Code) supports MCP
  `roots` and sends the repo root as the working directory; the official
  server lets client-provided `roots` fully replace the CLI argument, and
  `list_allowed_directories` confirms the effective scope is the whole repo
  root, not just `app/data`. There is no server-side flag to opt out of this.
  It still stays within the repo , so the actual boundary here is the OS-level project checkout, not the narrower `app/data` path the config implies. Used during development to let the agent inspect the seeded catalog data directly.
- **`memory`** (`@modelcontextprotocol/server-memory`) — an in-process
  knowledge-graph scratchpad for the agent session. No filesystem or network
  access beyond its own process memory; state does not persist once the
  server process exits.

Neither server has network access or write access outside its declared root.


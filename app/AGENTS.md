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

Servers registered in `.mcp.json` at the repo root (Claude Code). Full scope
rationale and verification live in `docs/mcp/servers.md` — this is just the
"what and why" for someone working in `app/`.

- **filesystem** (`@modelcontextprotocol/server-filesystem`) — lets the agent
  read/write repo files directly (`src/*.ts`, `data/catalog.json`, docs)
  instead of pasting file contents into chat. Scoped to the repo root, not
  `~` or `/`.
- **memory** (`@modelcontextprotocol/server-memory`) — a knowledge-graph
  scratchpad for the agent to hold notes across a chat session (e.g. running
  conclusions across Task A–E). No access to this repo's filesystem at all;
  it persists to its own file outside the project.

Both are read-only with respect to `app/`'s domain logic — neither server
executes or reimplements anything from `src/catalog.ts`.

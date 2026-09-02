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

Servers this project expects to have connected. Config lives at `.mcp.json`
(project root) and `.vscode/mcp.json`; full rationale in
[`docs/mcp/servers.md`](../docs/mcp/servers.md), threat model in
`docs/mcp/SECURITY.md`.

| Server | Scope | What it is for |
|---|---|---|
| `filesystem` (`@modelcontextprotocol/server-filesystem@2026.8.31`) | **only** `app/data/` | Read `catalog.json` directly. Deliberately narrow — the agent needs one file, not the repo. |
| `memory` (`@modelcontextprotocol/server-memory@2026.8.31`) | `.mcp-memory/memory.json` (gitignored) | Carry decisions across sessions — needed because Task D compares two separate chats. |

Rules for agents working here:

- The `filesystem` server also exposes **write** tools (`write_file`,
  `edit_file`, `move_file`). Do not use them on `data/catalog.json` — it is the
  Task D ground truth and must stay byte-identical.
- Versions are **pinned on purpose**. Do not "helpfully" switch them to
  `@latest`; bumping a version is a deliberate commit, not a default.
- No server in this project needs a token. If one ever does, reference it as
  `${ENV_VAR}` in the config and keep the value in the gitignored `.env`.
- No network-facing MCP server is connected (`fetch` was rejected on purpose):
  untrusted web content plus a write-capable filesystem tool is a prompt
  injection path, not a convenience.

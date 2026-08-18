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
verification: `docs/mcp/servers.md`. Load `.env` before starting the host
(`set -a; source .env; set +a`) — the host expands `${ENV_VAR}` from its own
environment and does not read `.env` itself.

| Server | Transport | Use it for | Do not use it for |
|---|---|---|---|
| `catalog` | stdio | Reading this catalog via `low_stock` / `inventory_value` / `search_inventory` / `check_stock` | Anything else — it has no other tool |
| `filesystem` | stdio | Reading `data/catalog.json` and sources here | Any write — see the warning below |
| `fetch` | stdio | MCP spec and docs lookups | Anything that would send repo content outward |
| `context7` | http | Current MCP TypeScript SDK docs (Task B) | Queries containing repo or personal data — they leave the machine |
| `github` | http | Read-only history/files of this fork | Writes — the toolset and the PAT both forbid them |

**`filesystem` reaches the whole repo, not just `data/`.** The config passes
`app/data`, but Claude Code answers `roots/list` with the project root and
`server-filesystem` prefers roots over its own launch arguments — so
`list_allowed_directories` returns the repo root. Treat the path argument as a
statement of intent, never as a sandbox. Evidence and the client-by-client
comparison are in `docs/mcp/servers.md`.

Writes are closed separately, at host level: `.claude/settings.json` denies
`mcp__filesystem__write_file` / `edit_file` / `move_file` / `create_directory`,
so those four are absent from the session (`docs/mcp/SECURITY.md` §3.6).

Practical consequence for work in `app/`: that deny is a decision by *this*
host, not a boundary around the process. The server itself still has OS access
to every file here, so under a different host — or run directly over stdio — the
two guardrails above (`data/catalog.json` is immutable, catalog signatures are
frozen) are enforced by nothing except the agent respecting them.

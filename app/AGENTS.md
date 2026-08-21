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

This project expects two public MCP servers to be connected. They are declared
in `.mcp.json` at the repo root; their permissions are scoped in
`.claude/settings.json`. Full write-up: [`docs/mcp/servers.md`](../docs/mcp/servers.md).

| Server | What it is for here | Scope |
|---|---|---|
| `filesystem` | Reading `data/catalog.json` — the Task D ground truth — through an MCP channel rather than the host's own file tools. | Launched with `./app/data`, but **that argument is not the effective boundary** — this host supplies the repo root via `roots`. [`SECURITY.md`](../docs/mcp/SECURITY.md) T-2. |
| `memory` | Carrying domain facts across sessions: A/B run results, scope decisions, ground-truth numbers. | Its own knowledge graph at `.mcp-memory/memory.jsonl` (`MEMORY_FILE_PATH`). No filesystem access at all. |
| `catalog` | **Ours** (`mcp-server/`, Task B) — 4 read-only tools + 1 resource over this library. | No filesystem scope of its own: it imports `dist/` and reads `data/catalog.json` through `loadCatalog()`. [`mcp-server/README.md`](../mcp-server/README.md). |

### Rules that follow from this

- **The `filesystem` server is read-only by host policy, not by its own
  design.** The `deny` list in `.claude/settings.json` is the only thing
  stopping it from writing: widen that allow-list and you have handed an MCP
  server write access to `data/catalog.json`, which the guardrails above forbid
  editing. Why it is not read-only on its own:
  [`SECURITY.md`](../docs/mcp/SECURITY.md) T-3.
- **Keep the `filesystem` launch argument at `app/data` — and do not trust
  it.** The server takes directories only (a file path is rejected at startup),
  so this is the narrowest argument available, and it is the correct
  declaration of intent — other hosts do honour it. In *this* host the `deny`
  list is what actually holds the line.
- **Pin server versions.** Both are pinned in `.mcp.json`
  (`@2026.7.10` / `@2026.7.4`). `npx -y ...@latest` would run unreviewed
  upstream code with filesystem access.
- **Secrets stay as `${ENV_VAR}` — but that alone guarantees nothing.** No
  token is needed here; `MEMORY_FILE_PATH` is `${MCP_MEMORY_FILE}` because the
  path is machine-specific. Put the value in `.claude/settings.local.json` →
  `env.MCP_MEMORY_FILE` — Claude Code does **not** read `.env`, and an
  unexpanded placeholder fails *silently*, not loudly:
  [`SECURITY.md`](../docs/mcp/SECURITY.md) T-1.
- **`mcp-server/` imports the catalog functions from the built package**
  (`src/index.ts` → `dist/`) rather than reading `data/catalog.json` through
  the `filesystem` server — reading it that way would inherit the scope
  problem above and couple the server to the host's `roots` behaviour. Keep it
  that way when extending it, and **run `npm run build` here first**: the
  server imports `dist/`, so a change to `src/` that is not rebuilt is a change
  the server does not see.

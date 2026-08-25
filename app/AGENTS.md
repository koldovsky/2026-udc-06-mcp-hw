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

Configured in [`.mcp.json`](../.mcp.json) at the repo root (project scope,
committed). Full rationale and scope evidence: [`docs/mcp/servers.md`](../docs/mcp/servers.md).

| Server | For | Scope it actually gets |
|---|---|---|
| `filesystem` | Reading `data/catalog.json` — the seeded data this library loads and Task D measures against | Configured as `./app/data`, but **effectively the whole repo** — see the caveat below |
| `memory` | Carrying domain conclusions between steps without adding files to the repo | No project filesystem, no network |
| `catalog` | This library's own functions over MCP (Task B, `mcp-server/`): `search_inventory`, `check_stock`, `low_stock`, `inventory_value` + resource `inventory://catalog` | `data/catalog.json` only, read-only, no network — the path comes from `import.meta.url`, so neither the config nor the client can widen it |
| `github` | Added in Task E to demonstrate safe token handling — nothing in `app/` depends on it | GitHub API within the token's rights: read-only, public repos. Started with `--read-only`, so 26 tools instead of 44 and zero write tools |

Only `github` needs a token, and it is referenced solely as
`${GITHUB_PERSONAL_ACCESS_TOKEN}` — the value lives in a gitignored `.env`, never
in the config. The two public servers are pinned to exact npm versions, `catalog`
runs local code pinned by `mcp-server/package-lock.json`, and `github` is pinned
by image digest.

**`catalog` does not start without a build.** `dist/` is gitignored, so after a
clone run `npm run build` here **first** (the server imports `app/dist/index.js`)
and then in `mcp-server/`. Without it the host reports the server as failed with
`ERR_MODULE_NOT_FOUND`. Rebuild `app/` after changing anything in `src/` — the
server serves the compiled output, not the sources.

Write tools are blocked in [`.claude/settings.json`](../.claude/settings.json)
(also committed) — `permissions.deny` on `mcp__filesystem__write_file`,
`edit_file`, `move_file` and `create_directory`.

What this means when working in `app/`:

- **Prefer the `catalog` server for domain questions** (stock levels, what needs
  reordering, inventory value). It calls the same functions the tests cover, so
  its numbers cannot drift from `src/catalog.ts`; reading the JSON and doing the
  arithmetic by hand can.
- **Use ordinary host paths** with the `filesystem` server — `app/data/catalog.json`,
  not a container path.
- **The `filesystem` server cannot write, and that is what protects
  `data/catalog.json`.** The server has no read-only mode: all four write tools
  are registered and would happily overwrite the file. The deny rules remove them
  from the tool surface, so `write_file` is unavailable even if explicitly
  requested. Do not remove those rules — they are what enforces the "do not edit
  `data/catalog.json`" guardrail above.
- **Do not trust the configured path as a boundary.** Claude Code sends MCP roots
  and the server *replaces* its allowed directories with them, so the granted
  read scope is the repository root, not `app/data`. Reads outside `app/data`
  succeed. This is measured, not theoretical — `docs/mcp/servers.md` has the
  evidence and the reasoning. Practical consequence: the `filesystem` server
  offers no read isolation here, so prefer the built-in file tools for anything
  outside `data/`, and never assume a path argument in `.mcp.json` is a control.

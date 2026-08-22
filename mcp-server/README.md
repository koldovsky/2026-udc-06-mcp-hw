# `catalog` — MCP server over the seeded catalog (Task B)

A thin, **read-only** stdio MCP server that exposes the domain functions of
[`app/`](../app) to an MCP host. It imports `app/dist/index.js`; it contains
no catalog logic of its own.

Built with the official TypeScript SDK **v2**
(`@modelcontextprotocol/server` 2.0.0 — *not* the v1 `@modelcontextprotocol/sdk`)
and `zod` 4.

## What it exposes

| Kind | Name / URI | Input | Backed by |
|---|---|---|---|
| tool | `search_inventory` | `query: string (≤100)`, `limit?: 1–100 (default 25)` | `searchProducts` |
| tool | `check_stock` | `sku: string` matching `^[A-Za-z]{2}-\d{4}$` | `findBySku` + `lowStock` (for `needsReorder`) |
| tool | `low_stock` | — | `lowStock` + `inventoryValue` |
| resource | `inventory://catalog` | — | `categories`, `inventoryValue`, `lowStock` (summary JSON) |
| resource | `inventory://catalog/products` | — | `loadCatalog` (full list JSON) |
| resource template | `inventory://category/{category}` | `category` (with completion) | `categories`, `searchProducts` |

Every tool returns both a human-readable `text` block and a typed
`structuredContent` (declared via `outputSchema`), and carries the annotations
`readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false`.

Error behaviour:

- malformed input → SDK schema error (`isError: true`, handler never runs);
- well-formed but unknown SKU → `isError: true` **with** `structuredContent: {found: false, sku}`;
- unknown category URI → JSON-RPC `ResourceNotFoundError` listing the known categories.

## Layout

```
mcp-server/
├── src/server.ts       ← the whole server
├── dist/server.js      ← build output (gitignored)
├── scripts/smoke.mjs   ← stdio smoke test, no host needed
├── package.json
└── tsconfig.json
```

`src/` and `dist/` are deliberately at the same depth: `tsc` does not rewrite
relative specifiers, so `../../app/dist/index.js` must resolve from both.

## Build & run

```bash
cd app && npm install && npm run build && cd ..        # the domain the server imports
cd mcp-server && npm install && npm run build          # → dist/server.js
npm run smoke                                          # initialize → tools/list → calls → resources
```

`node ./dist/server.js` on its own just waits for JSON-RPC on stdin — that is
normal. Nothing but protocol messages is written to stdout; the only
diagnostic line goes to stderr.

Inspector:

```bash
npx -y @modelcontextprotocol/inspector@2.3.0 --cli node ./dist/server.js --method tools/list
npx -y @modelcontextprotocol/inspector@2.3.0 --cli node ./dist/server.js --method tools/call --tool-name low_stock
npx -y @modelcontextprotocol/inspector@2.3.0 --cli node ./dist/server.js --method resources/read --uri inventory://catalog
```

## Host registration

Already in the root [`.mcp.json`](../.mcp.json):

```json
"catalog": { "type": "stdio", "command": "node", "args": ["./mcp-server/dist/server.js"] }
```

The path is relative to the project root; Claude Code launches project-scoped
servers with the project as cwd (`claude mcp list` → `✔ Connected`). For a host
that does not, make it absolute.

## Design notes

- **Read-only by construction.** No `fs.write*`, no `fetch`, no child
  processes. The catalog is re-read from disk on every request (it is 24
  rows), so a long-running host session never serves a stale snapshot.
- **Domain rule lives in one place.** `check_stock` decides "needs reorder"
  by asking `lowStock()` rather than re-deriving `stock <= reorderLevel`;
  the category resource narrows `searchProducts()` instead of filtering the
  raw array. If `app/src/catalog.ts` changes, the server follows after a
  rebuild — nothing to keep in sync.
- **Descriptions say *when* to call.** `low_stock` is described as "the
  authoritative answer to 'which products need reordering'", and it also
  returns the total inventory value so the Task D question is one call.
  In the A/B run the model picked it on the first turn.

# `catalog-server` — custom MCP server (Task B)

A **read-only** MCP server over the seeded product catalog. It is a thin
protocol adapter: all catalog logic is imported from `app/dist/`, none of it is
reimplemented here.

- **SDK:** `@modelcontextprotocol/server` **v2** (`2.0.0`), zod schemas
- **Transport:** stdio
- **Surface:** 3 tools, 1 static resource, 1 resource template

## Build & run

```bash
cd app && npm install && npm run build   # produces app/dist — required first
cd ../mcp-server && npm install && npm run build
node ./dist/server.js                    # hangs waiting for JSON-RPC — correct
```

`dist/` is gitignored, so **a fresh clone must build before the host can start
the server**. `npm run build` in both packages, in that order.

## What it exposes

### Tools (model-invoked)

| Tool | Input | Domain function | When the model should call it |
|---|---|---|---|
| `search_inventory` | `query: string` | `searchProducts` | "what products do we have", "anything in audio?", name/SKU/category lookup |
| `check_stock` | `sku: string` | `findBySku` + `lowStock` | one named SKU: units on hand vs reorder level |
| `low_stock` | *(none)* | `lowStock` | "what needs reordering / restocking / is running low" |

All three carry `annotations: { readOnlyHint: true, destructiveHint: false,
idempotentHint: true, openWorldHint: false }` — the read-only promise is
declared **in the protocol**, not only in this README, so a host can enforce or
display it without reading the source.

Each tool also declares an `outputSchema` and returns `structuredContent`, so a
client gets typed data rather than only prose to re-parse.

### Resources (application-read, by URI)

| URI | What |
|---|---|
| `inventory://catalog` | Summary: `productCount`, `categories`, `totalInventoryValue`, `lowStockCount` |
| `inventory://category/{category}` | Every product in one category, as JSON. Template `list` enumerates the 7 real categories; `complete` autocompletes the variable. |

Why these are resources and not tools: they are *state to attach*, not an action
to perform. Nothing needs to be computed on demand and no argument has to be
chosen by the model — the client can pull `inventory://catalog` into context
without the model deciding anything.

## Design decisions worth knowing

- **Zero domain logic here.** Even `needsReorder` in `check_stock` is computed
  as `lowStock([product]).length === 1` rather than re-typing
  `stock <= reorderLevel`. Restating the rule is how two implementations start
  disagreeing.
- **`src/` and `dist/` are at the same depth on purpose.** TypeScript does not
  rewrite relative imports, so `../../app/dist/index.js` must be valid both in
  source and in the build output. Moving `server.ts` to the package root
  compiles cleanly and then fails at runtime with `ERR_MODULE_NOT_FOUND`.
- **A missing SKU is not a protocol error.** `check_stock` on an unknown SKU
  returns a normal result with `found: false` and a hint to use
  `search_inventory`. Flagging `isError` would invite the model to retry a
  lookup that can never succeed.
- **stdout is reserved for JSON-RPC.** The one diagnostic line goes to stderr
  via `console.error`. A stray `console.log` corrupts the stream.
- **No filesystem paths of its own.** The only file read is done by `app/`'s
  `loadCatalog()`, which resolves relative to its own module URL — so the
  server works regardless of the cwd the host launches it from.

## Verify without a host

Fastest way to separate "my server is broken" from "the model chose not to call
my tool":

```bash
npx @modelcontextprotocol/inspector --cli node ./dist/server.js --method tools/list
npx @modelcontextprotocol/inspector --cli node ./dist/server.js --method resources/list
```

Or raw stdio, no Inspector:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node ./dist/server.js
```

Verified output on this machine (see `docs/mcp/servers.md` for the full log):

- `serverInfo: {"name":"catalog-server","version":"1.0.0"}`
- capabilities: `tools`, `resources`, `completions`
- `low_stock` → 9 SKUs, `DK-4001` first (stock 0)
- `inventory://catalog` → `productCount: 24`, `totalInventoryValue: 46152`

Both match the Task D ground truth from `materials/ab-question.md`.

## Registered in

`.mcp.json` (as `catalog`) and `.vscode/mcp.json`. If the host does not see the
tools, the cause is almost always the path: the host does not launch the server
from your terminal, so `./mcp-server/dist/server.js` resolves against *its*
working directory. `.vscode/mcp.json` uses `${workspaceFolder}` to avoid that.


# Catalog MCP server

Read-only MCP adapter over the synthetic catalog in `../app`. It imports the
compiled domain functions from `app/dist/index.js`; no catalog rules are
reimplemented here.

## Capabilities

| Kind | Name | Purpose |
|---|---|---|
| Tool | `search_inventory` | Search by name, SKU, or category. |
| Tool | `check_stock` | Inspect stock and reorder state for one SKU. |
| Tool | `low_stock` | List every product that currently needs reordering. |
| Tool | `inventory_value` | Calculate the exact value of all current stock. |
| Resource | `inventory://catalog` | Read a compact catalog summary. |

Every tool is annotated read-only, non-destructive, idempotent, and closed to
external data. The server can only read the seeded catalog through
`loadCatalog()`; it has no write or network capability.

## Build and run

```bash
cd app
npm run build

cd ../mcp-server
npm install
npm run typecheck
npm run build
npm start
```

The server uses stdio, so `npm start` waits silently for an MCP client. Do not
write logs to stdout because stdout carries JSON-RPC protocol messages.

## Host configuration

The project-level `.mcp.json` starts `dist/server.js`. Set `MCP_PROJECT_DIR` to
the absolute repository path before launching the host; see `.env.example`.

# MCP A/B validation (Task D)

**Prompt (identical for A and B):**

```
Which products in our catalog need reordering right now, and what is the
total value of the stock we are currently holding? Give me the SKUs and
the total as a number.
```

**Host / model:** Cursor 3.29.15, model "Claude Opus 5.5 Medium" (as shown in the selector), same mode for both runs, a new chat for each run.
**Server under test:** `mcp-server/` (tools `search_inventory`, `check_stock`, `low_stock`, `inventory_value`; resource `inventory://catalog`)

## Ground truth

Computed locally so there is something to compare against:

```
SKUs that need reordering: DK-4001, WC-8002, DS-6002, MS-2001, MN-3002, HS-5002, SS-1102, KB-1002, CB-7003 (9 SKUs)
Total inventory value: 46152
```

Computed in `app/` with `npm run build`, then the `node -e` command from
`materials/ab-question.md` (run in PowerShell, wrapped in double quotes):

```
node -e "import('./dist/index.js').then(m=>{const c=m.loadCatalog();console.log(m.lowStock(c).map(p=>p.sku).join(', '));console.log(m.inventoryValue(c));})"
```

`git diff --stat origin/main -- data` was empty, so the seeded data is unchanged.

## Run A — MCP connected

**Setup:** Customize > MCPs showed `catalog` with 4 tools and 1 resource
enabled, plus filesystem, memory, Computer Use and Origin.

**What the agent did:** 18:49 to 18:49 (under a minute), 1 user message.

1. "Explored available tools" (tool discovery, no approval card).
2. `low_stock` (catalog server, no arguments) — approval card, clicked Run.
3. `inventory_value` (catalog server) — approval card, clicked Run.

**Answer:** The same 9 SKUs in the same order as the ground truth, presented as
a table with stock and reorder level, and a total of 46152. It stated that both
numbers came from the `low_stock` and `inventory_value` tools.

**Correct?** Yes — SKU list and total both match the ground truth exactly.

## Run B — MCP disabled

**How it was disabled:** Removed the `catalog` block (4 lines) from
`.cursor/mcp.json`, fully quit Cursor (all windows, File > Exit) and started it
again. Customize > MCPs then showed "Connected 4" (Computer Use, filesystem,
memory, Origin) with no catalog server. After the run the config was restored
with `git restore .cursor/mcp.json`.

**What the agent did:** 18:54 to 18:54 (under a minute), 1 user message.

1. Read `app/src/catalog.ts` (L1-46) and `app/data/catalog.json` (L1-27) with
   Cursor's built-in file read — not the filesystem MCP server; no approval card.
2. Ran one terminal command (`node -e`) — approval card, clicked Run. The
   command loaded `./app/data/catalog.json` via `require`, filtered
   `stock <= reorderLevel` sorted by stock, and summed `price * stock` with
   `Math.round` to cents.

The agent said it was "running the library's own functions", but the command
re-implemented the logic instead of calling `lowStock` / `inventoryValue`.

**Answer:** The same 9 SKUs in the same order as the ground truth, and a total
of 46152 (46,152.00), noting that the catalog has no currency. It also said no
catalog MCP server was connected and that, if this was a Task D A/B run, it
should be recorded as the version without the server. It likely recognised the
experiment from repo context (hypothesis).

**Correct?** Yes — SKU list and total both match the ground truth exactly.

## Difference table

| Aspect | A (with MCP) | B (without MCP) |
|---|---|---|
| Called a tool | Yes: `low_stock`, then `inventory_value` (catalog server) | No catalog tool; built-in file read plus one `node -e` terminal command |
| SKU list complete | Yes, 9/9, same order | Yes, 9/9, same order |
| Total exact | Yes, 46152 | Yes, 46152 (46,152.00) |
| Number of steps | 3 (tool discovery, 2 MCP calls); under a minute | 3 (2 file reads, 1 terminal command); under a minute |
| Confidence vs correctness | Confident and correct; correctly attributed numbers to the tools | Confident and correct, but claimed to run "the library's own functions" while actually re-implementing them |
| Approval cards | 2 (one per MCP call) | 1 (the terminal command) |
| Where the logic came from | Tested `app/` functions, called through the server | Ad-hoc re-implementation inside a shell command |

No token or cost figures were recorded for either run.

## Conclusion

This is an honest null result on correctness: both runs returned the exact 9
SKUs and the exact total of 46152. The difference is in how: run A used narrow,
declared read-only tools that wrap the tested domain code, while run B needed
read access to the repo plus a shell command — a much broader capability — and
duplicated the business rules in an ad-hoc script. A custom server is worth it
when the agent has no file or shell access, when the data sits behind an API,
when the same rules must be applied every time, and when least privilege
matters; for a 24-row JSON file in an open repo, plain file access was enough.
Limits: one run per side only, and the agent in run B likely knew it was being
tested.

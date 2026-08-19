# MCP A/B validation (Task D)

**Prompt used unchanged in both runs:**

```text
Which products in our catalog need reordering right now, and what is the
total value of the stock we are currently holding? Give me the SKUs and
the total as a number.
```

**Host / model:** Claude Code / Sonnet 5

**Server under test:** `mcp-server/` (`low_stock` and `inventory_value`)

## Ground truth

The expected result was calculated locally with the tested catalog library:

```bash
cd app && npm run build
node -e "import('./dist/index.js').then(m=>{const c=m.loadCatalog();console.log(m.lowStock(c).map(p=>p.sku).join(', '));console.log(m.inventoryValue(c));})"
```

```text
SKUs requiring reorder: DK-4001, WC-8002, DS-6002, MS-2001, MN-3002,
HS-5002, SS-1102, KB-1002, CB-7003
Total inventory value: 46152
```

This is 9 products, using the rule `stock <= reorderLevel`, and the total is
the sum of `price * stock` across all 24 products.

## Run A — custom MCP server connected

**What the agent did:** Claude Code reported `Called catalog-server 2 times`.
The captured trace shows the individual call
labels, but the two returned result sets correspond to `low_stock({})` followed
by `inventory_value({})`: one returned the nine reorder records and the other
returned the catalog-wide total.

**Answer:**

```text
Products needing reorder (9):
DK-4001, WC-8002, DS-6002, MS-2001, MN-3002,
HS-5002, SS-1102, KB-1002, CB-7003

Total inventory value: 46152
```

The agent also presented each product's name, current stock, and reorder level.

**Correct?** Yes. All 9 SKUs matched the ground truth in the same order, and
the total was exactly `46152`.

## Run B — custom MCP server disconnected

**How it was disabled:** A temporary active MCP configuration was created from
`.mcp.json`, and only the `catalog-server` object was removed. Claude Code was
fully restarted with that temporary configuration. The restarted client's MCP
status showed no connection to `catalog-server`; only then was the prompt run
in a new chat.

**What the agent did:** Claude Code reported `Read 1 file, listed 1 directory,
ran 2 shell commands`. It inspected the repository and then loaded
`app/data/catalog.json` through the already-built application library, calling
`loadCatalog`, `lowStock`, and `inventoryValue` from `app/dist` directly.

**Answer:**

```text
Products needing reorder (9):
DK-4001, WC-8002, DS-6002, MS-2001, MN-3002,
HS-5002, SS-1102, KB-1002, CB-7003

Total inventory value: 46152
```

The response included the same product details as Run A and disclosed that it
had computed the result directly because the MCP server was unavailable.

**Correct?** Yes. The SKU list and total both matched the ground truth exactly.

## Comparison

| Aspect | A — with custom MCP | B — without custom MCP |
|---|---|---|
| Used catalog MCP tools | Yes; 2 `catalog-server` calls corresponding to `low_stock({})` and `inventory_value({})` | No |
| Alternative access path | Catalog hidden behind domain-level MCP operations | Repository inspection, direct file access, and execution of the built catalog library |
| Complete SKU list | Yes, all 9 | Yes, all 9 |
| Exact total | Yes, `46152` | Yes, `46152` |
| Observed interaction count | 2 MCP calls | 4 reported local operations: 1 directory listing, 1 file read, and 2 shell commands |
| Knowledge required from the agent | Tool descriptions and schemas | Repository layout, build output location, and library API |
| Confidence versus correctness | Confident and verified by domain tools; correct | Confident and verified by direct local calculation; correct |

## Conclusion

This was an honest null result for answer accuracy: both runs returned the full
SKU list and exact total. The MCP server still changed the execution path,
reducing the task to two stable domain calls while the disconnected run needed
repository discovery, filesystem access, shell execution, and knowledge of the
built library. For a local coding agent with broad repository access, direct
library use may be sufficient; the MCP abstraction becomes more valuable when
clients lack that access or need a stable, reusable catalog interface.

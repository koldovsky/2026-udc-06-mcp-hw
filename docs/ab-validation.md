# A/B validation for MCP

**Prompt used unchanged in both runs:**

> Which products in our catalog need reordering right now, and what is the
> total value of the stock we are currently holding? Give me the SKUs and the
> total as a number.

**Host / model:** Codex local rerun on 2026-08-22  
**Server under test:** `mcp-server/` with `low_stock` and `inventory://catalog`

## Ground Truth

```text
SKUs: DK-4001, WC-8002, DS-6002, MS-2001, MN-3002, HS-5002, SS-1102, KB-1002, CB-7003
Total: 46152
```

Computed after `npm.cmd run build` in `app`:

```bash
node -e "import('./app/dist/index.js').then(m=>{const c=m.loadCatalog();console.log('SKUs: '+m.lowStock(c).map(p=>p.sku).join(', '));console.log('Total: '+m.inventoryValue(c));})"
```

## Run A: MCP Connected

The local catalog MCP server was rebuilt and called over stdio.

Tool/resource calls:

- `tools/call` with `name: "low_stock"` and `{}` arguments.
- `resources/read` with `uri: "inventory://catalog"`.

Observed answer:

```text
SKUs: DK-4001, WC-8002, DS-6002, MS-2001, MN-3002, HS-5002, SS-1102, KB-1002, CB-7003
Total: 46152
```

Correct: yes.

## Run B: MCP Disconnected

For the no-MCP path, the same calculation was performed directly from the app build without calling the MCP server.
This matches what an agent can do when it has normal repository file access but no catalog MCP tools.

Observed answer:

```text
SKUs: DK-4001, WC-8002, DS-6002, MS-2001, MN-3002, HS-5002, SS-1102, KB-1002, CB-7003
Total: 46152
```

Correct: yes.

## Comparison

| Aspect | A: MCP connected | B: MCP disconnected |
|---|---|---|
| Used catalog MCP tools | Yes, `low_stock` | No |
| Read MCP resource | Yes, `inventory://catalog` | No |
| SKU list complete | Yes, 9/9 | Yes, 9/9 |
| Inventory total correct | Yes | Yes |
| Where catalog rules ran | Tested app functions through MCP | Direct app import/file access |
| Main failure risk | MCP config or server startup problem | Agent may reimplement aggregation incorrectly |

## Conclusion

The rerun produced the same correct answer in both paths.
The MCP server did not change correctness for this small local JSON catalog, but it changed the workflow: the model can use a narrow read-only domain tool instead of manually reading and aggregating raw data.
That is more valuable when the domain logic is larger, the data is less obvious, or direct file access should not be exposed.

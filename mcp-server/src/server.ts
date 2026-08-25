import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import {
  loadCatalog,
  searchProducts,
  findBySku,
  lowStock,
  inventoryValue,
  categories,
} from "../../app/dist/index.js";

const server = new McpServer({
  name: "catalog-server",
  version: "1.0.0",
});

// ── Tool 1: search_inventory ───────────────────────────────────────────────
server.registerTool(
  "search_inventory",
  {
    description:
      "Search the product catalog by name, SKU, or category. " +
      "Use when the user asks what products exist, looks up a specific item, " +
      "or wants to browse inventory by category.",
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "Free-text match on product name, SKU (e.g. 'KB-1001'), or category",
        ),
    }),
  },
  async ({ query }) => {
    const catalog = loadCatalog();
    const results = searchProducts(catalog, query);
    return {
      content: [
        {
          type: "text" as const,
          text:
            results.length === 0
              ? `No products matched "${query}".`
              : results
                  .map(
                    (p) =>
                      `${p.sku} — ${p.name} (${p.category}) · $${p.price} · stock ${p.stock} (reorder at ${p.reorderLevel})`,
                  )
                  .join("\n"),
        },
      ],
    };
  },
);

// ── Tool 2: low_stock ─────────────────────────────────────────────────────
server.registerTool(
  "low_stock",
  {
    description:
      "List all products that need reordering right now — stock is at or " +
      "below the reorder level. Use when asked which items need reordering, " +
      "replenishing, or what the current reorder list looks like.",
    inputSchema: z.object({}),
  },
  async () => {
    const catalog = loadCatalog();
    const items = lowStock(catalog);
    return {
      content: [
        {
          type: "text" as const,
          text:
            items.length === 0
              ? "All products are adequately stocked — nothing needs reordering."
              : `${items.length} product(s) need reordering (sorted by lowest stock first):\n` +
                items
                  .map(
                    (p) =>
                      `${p.sku} — ${p.name}: stock ${p.stock}, reorder level ${p.reorderLevel}`,
                  )
                  .join("\n"),
        },
      ],
    };
  },
);

// ── Tool 3: inventory_value ───────────────────────────────────────────────
server.registerTool(
  "inventory_value",
  {
    description:
      "Calculate the total monetary value of all current inventory " +
      "(sum of price × stock across all products). Use when asked about " +
      "total stock value, capital tied up in inventory, or financial summary.",
    inputSchema: z.object({}),
  },
  async () => {
    const catalog = loadCatalog();
    const value = inventoryValue(catalog);
    return {
      content: [
        {
          type: "text" as const,
          text: `Total inventory value: $${value.toFixed(2)} across ${catalog.length} products.`,
        },
      ],
    };
  },
);

// ── Resource: inventory://catalog ────────────────────────────────────────
// Resources are application-readable context, not model-invoked actions.
// This gives clients a quick snapshot without calling a tool.
server.registerResource(
  "inventory-catalog",
  "inventory://catalog",
  {
    title: "Catalog Summary",
    description:
      "Snapshot of the product catalog: category list, product count, " +
      "total inventory value, and number of items needing reorder.",
    mimeType: "text/plain",
  },
  async (uri) => {
    const catalog = loadCatalog();
    const cats = categories(catalog);
    const value = inventoryValue(catalog);
    const lowItems = lowStock(catalog);
    const summary = [
      `Products: ${catalog.length}`,
      `Categories: ${cats.join(", ")}`,
      `Total inventory value: $${value.toFixed(2)}`,
      `Items needing reorder: ${lowItems.length}`,
    ].join("\n");
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "text/plain",
          text: summary,
        },
      ],
    };
  },
);

// ── Connect via stdio ─────────────────────────────────────────────────────
// The host launches this process and speaks over stdin/stdout.
// Debug output goes to stderr (console.error), never console.log.
const transport = new StdioServerTransport();
await server.connect(transport);

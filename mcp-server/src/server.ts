import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

import {
  loadCatalog,
  searchProducts,
  lowStock,
  inventoryValue,
  categories,
} from "../../app/dist/index.js";

const server = new McpServer({
  name: "catalog-server",
  version: "1.0.0",
});

server.registerTool(
  "search_inventory",
  {
    description:
      "Search the product catalog by name, SKU, or category. Use when the " +
      "user asks what products exist or asks about a specific item.",
    inputSchema: z.object({
      query: z
        .string()
        .describe("Free-text match on product name, SKU, or category"),
    }),
  },
  async ({ query }) => {
    const results = searchProducts(loadCatalog(), query);
    return {
      content: [
        {
          type: "text",
          text:
            results.length === 0
              ? `No products matched "${query}".`
              : results
                  .map(
                    (p) =>
                      `${p.sku} — ${p.name} (${p.category}) · ${p.price} · stock ${p.stock}`,
                  )
                  .join("\n"),
        },
      ],
    };
  },
);

server.registerTool(
  "low_stock",
  {
    description:
      "List products whose stock is at or below their reorder level, lowest " +
      "stock first. Use when the user asks what needs restocking or reordering.",
    inputSchema: z.object({}),
  },
  async () => {
    const items = lowStock(loadCatalog());
    return {
      content: [
        {
          type: "text",
          text:
            items.length === 0
              ? "No products are at or below their reorder level."
              : items
                  .map(
                    (p) =>
                      `${p.sku} — ${p.name}: stock ${p.stock} (reorder at ${p.reorderLevel})`,
                  )
                  .join("\n"),
        },
      ],
    };
  },
);

server.registerTool(
  "inventory_value",
  {
    description:
      "Compute the total value of current inventory (sum of price times stock " +
      "across every product). Use when the user asks how much stock is worth " +
      "or wants a total inventory value.",
    inputSchema: z.object({}),
  },
  async () => {
    const total = inventoryValue(loadCatalog());
    return {
      content: [
        {
          type: "text",
          text: `Total inventory value: ${total.toFixed(2)}`,
        },
      ],
    };
  },
);

server.registerResource(
  "catalog-summary",
  "inventory://catalog",
  {
    title: "Catalog summary",
    description:
      "Snapshot of the product catalog: product count, categories, and total " +
      "inventory value.",
    mimeType: "application/json",
  },
  async (uri) => {
    const catalog = loadCatalog();
    const summary = {
      productCount: catalog.length,
      categories: categories(catalog),
      totalInventoryValue: inventoryValue(catalog),
    };
    return {
      contents: [
        {
          uri: uri.toString(),
          mimeType: "application/json",
          text: JSON.stringify(summary, null, 2),
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);

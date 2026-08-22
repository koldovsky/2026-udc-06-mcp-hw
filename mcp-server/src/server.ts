import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

import {
  categories,
  findBySku,
  inventoryValue,
  loadCatalog,
  lowStock,
  searchProducts,
} from "../../app/dist/index.js";

const server = new McpServer({
  name: "catalog-server",
  version: "1.0.0",
});

server.registerTool(
  "search_inventory",
  {
    description:
      "Search the read-only product catalog by name, SKU, or category. " +
      "Use this when the user asks what products match a term.",
    inputSchema: z.object({
      query: z.string().describe("Name, SKU, or category to search for"),
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
                    (product) =>
                      `${product.sku} — ${product.name} (${product.category}); ` +
                      `price ${product.price}; stock ${product.stock}`,
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
      "List every product at or below its reorder level, sorted by stock. " +
      "Use this to answer which catalog items need reordering now.",
    inputSchema: z.object({}),
  },
  async () => {
    const products = lowStock(loadCatalog());
    return {
      content: [
        {
          type: "text",
          text: products
            .map(
              (product) =>
                `${product.sku} — ${product.name}; stock ${product.stock}; ` +
                `reorder level ${product.reorderLevel}`,
            )
            .join("\n"),
        },
      ],
    };
  },
);

server.registerTool(
  "check_stock",
  {
    description:
      "Look up one product by exact SKU and report its current stock and " +
      "reorder level. Use this for a specific SKU stock question.",
    inputSchema: z.object({
      sku: z.string().describe("Product SKU, for example KB-1001"),
    }),
  },
  async ({ sku }) => {
    const product = findBySku(loadCatalog(), sku);
    return {
      content: [
        {
          type: "text",
          text: product
            ? `${product.sku} — ${product.name}; stock ${product.stock}; ` +
              `reorder level ${product.reorderLevel}; ` +
              `needs reorder: ${product.stock <= product.reorderLevel}`
            : `No product found for SKU "${sku}".`,
        },
      ],
    };
  },
);

server.registerResource(
  "inventory_catalog",
  "inventory://catalog",
  {
    description:
      "Read-only summary of the seeded catalog, including product count, " +
      "categories, and total inventory value.",
    mimeType: "application/json",
  },
  async (uri) => {
    const catalog = loadCatalog();
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              productCount: catalog.length,
              categories: categories(catalog),
              inventoryValue: inventoryValue(catalog),
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);

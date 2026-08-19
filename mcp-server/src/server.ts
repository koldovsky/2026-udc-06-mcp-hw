import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

import {
  categories,
  findBySku,
  inventoryValue,
  loadCatalog,
  lowStock,
  searchProducts,
} from "../../app/dist/index.js";

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function createCatalogServer(): McpServer {
  const server = new McpServer({
    name: "catalog-server",
    version: "1.0.0",
  });

  server.registerTool(
    "search_inventory",
    {
      title: "Search inventory",
      description:
        "Search the product catalog by product name, SKU, or category. Use " +
        "this when the user asks which products exist or wants matching " +
        "inventory records. An empty query returns the complete catalog.",
      inputSchema: z.object({
        query: z
          .string()
          .describe("Case-insensitive text to match against name, SKU, or category"),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ query }) => {
      const products = searchProducts(loadCatalog(), query);
      return {
        content: [
          {
            type: "text",
            text: jsonText({ count: products.length, products }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "check_stock",
    {
      title: "Check stock by SKU",
      description:
        "Look up one product by its exact SKU and report its stock and reorder " +
        "threshold. Use this when the user asks whether a specific SKU needs " +
        "reordering.",
      inputSchema: z.object({
        sku: z
          .string()
          .trim()
          .regex(/^[A-Za-z]{2}-\d{4}$/, "Expected a SKU such as KB-1001")
          .describe("Product SKU in XX-9999 format"),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ sku }) => {
      const catalog = loadCatalog();
      const product = findBySku(catalog, sku);

      if (!product) {
        return {
          content: [
            {
              type: "text",
              text: jsonText({ found: false, sku: sku.toUpperCase() }),
            },
          ],
        };
      }

      const needsReorder = lowStock(catalog).some(
        (candidate) => candidate.sku === product.sku,
      );

      return {
        content: [
          {
            type: "text",
            text: jsonText({ found: true, needsReorder, product }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "low_stock",
    {
      title: "List products needing reorder",
      description:
        "Return every catalog product whose stock is at or below its reorder " +
        "level, ordered by lowest stock first. Use this when the user asks " +
        "which products need reordering now.",
      inputSchema: z.object({}),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => {
      const products = lowStock(loadCatalog());
      return {
        content: [
          {
            type: "text",
            text: jsonText({ count: products.length, products }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "inventory_value",
    {
      title: "Calculate total inventory value",
      description:
        "Calculate the exact total value of all stock currently held as the " +
        "sum of unit price times stock quantity. Use this for catalog-wide " +
        "inventory valuation questions.",
      inputSchema: z.object({}),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => {
      const value = inventoryValue(loadCatalog());
      return {
        content: [
          {
            type: "text",
            text: jsonText({ inventoryValue: value }),
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
        "Current read-only catalog overview: product count, categories, " +
        "low-stock count, and total inventory value.",
      mimeType: "application/json",
    },
    async (uri) => {
      const catalog = loadCatalog();
      const summary = {
        productCount: catalog.length,
        categories: categories(catalog),
        lowStockCount: lowStock(catalog).length,
        inventoryValue: inventoryValue(catalog),
      };

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: jsonText(summary),
          },
        ],
      };
    },
  );

  return server;
}

serveStdio(createCatalogServer);

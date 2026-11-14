/**
 * MCP server over the seeded catalog domain (Task B).
 *
 * 4 read-only tools + 1 resource; all catalog logic is IMPORTED from app/.
 * Written against @modelcontextprotocol/server v2 (2.4.x).
 * Docs: https://ts.sdk.modelcontextprotocol.io/
 */

import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

// The domain lives in app/ — run `cd app && npm run build` first.
// Do NOT reimplement any of this logic in the server: a server is a thin
// protocol adapter, and duplicated business rules drift apart.
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

// ── Tool 1 ────────────────────────────────────────────────────────────────
// The DESCRIPTION is what the model reads to decide whether to call this.
// Say WHEN to use it, not just what it is — same lesson as a SKILL.md
// description in Workshop 5. Vague description => the tool never fires.
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
    annotations: { readOnlyHint: true, openWorldHint: false },
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

// ── Tool 2 ────────────────────────────────────────────────────────────────
server.registerTool(
  "check_stock",
  {
    description:
      "Check the stock level of ONE product by its exact SKU (format XX-9999, " +
      "e.g. KB-1001). Use when the user names a specific SKU and asks how many " +
      "units are on hand, what its reorder level is, or whether it needs " +
      "reordering. If you only know the product name, call search_inventory first.",
    inputSchema: z.object({
      sku: z
        .string()
        .describe("Exact product SKU, case-insensitive, e.g. KB-1001"),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ sku }) => {
    const catalog = loadCatalog();
    const product = findBySku(catalog, sku);
    if (!product) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Unknown SKU "${sku}". Use search_inventory to find valid SKUs.`,
          },
        ],
      };
    }
    const needsReorder = lowStock(catalog).some((p) => p.sku === product.sku);
    return {
      content: [
        {
          type: "text",
          text:
            `${product.sku} — ${product.name}: stock ${product.stock}, ` +
            `reorder level ${product.reorderLevel}. ` +
            (needsReorder
              ? "NEEDS REORDER (stock is at or below reorder level)."
              : "Stock is above reorder level; no reorder needed."),
        },
      ],
    };
  },
);

// ── Tool 3 ────────────────────────────────────────────────────────────────
server.registerTool(
  "low_stock",
  {
    description:
      "List every product whose stock is at or below its reorder level, " +
      "lowest stock first. Use when the user asks which items need " +
      "reordering, are running low, or should be restocked. Takes no arguments.",
    inputSchema: z.object({}).describe("No arguments"),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async () => {
    const items = lowStock(loadCatalog());
    const lines = items.map(
      (p) =>
        `${p.sku} — ${p.name} · stock ${p.stock} · reorder level ${p.reorderLevel}`,
    );
    return {
      content: [
        {
          type: "text",
          text:
            items.length === 0
              ? "0 products need reordering."
              : `${items.length} products need reordering:\n${lines.join("\n")}`,
        },
      ],
    };
  },
);

// ── Tool 4 ────────────────────────────────────────────────────────────────
server.registerTool(
  "inventory_value",
  {
    description:
      "Compute the total inventory value (sum of price × stock across the " +
      "whole catalog, rounded to cents). Use when the user asks how much the " +
      "inventory is worth or how much capital is tied up in stock. Takes no arguments.",
    inputSchema: z.object({}).describe("No arguments"),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async () => {
    const catalog = loadCatalog();
    const result = {
      inventoryValue: inventoryValue(catalog),
      productCount: catalog.length,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    };
  },
);

// ── Resource ──────────────────────────────────────────────────────────────
// A resource is APPLICATION-controlled context read by URI — unlike a tool,
// the model does not invoke it. Good fit for "here is the state of the
// catalog" rather than "go compute something".
server.registerResource(
  "catalog-summary",
  "inventory://catalog",
  {
    title: "Catalog summary",
    description:
      "Snapshot of the catalog: product count, categories, total inventory value.",
    mimeType: "application/json",
  },
  async (uri) => {
    const catalog = loadCatalog();
    const summary = {
      productCount: catalog.length,
      categories: categories(catalog),
      inventoryValue: inventoryValue(catalog),
    };
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(summary, null, 2),
        },
      ],
    };
  },
);

// ── Connect ───────────────────────────────────────────────────────────────
// stdio: the HOST launches this process and talks over stdin/stdout.
// Nothing is printed to stdout except protocol messages — if you need to
// debug, log to stderr (console.error), never console.log.
const transport = new StdioServerTransport();
await server.connect(transport);

/**
 * MCP server over the seeded catalog domain.
 *
 * Requirements: >= 2 tools, >= 1 resource, read-only,
 * and the catalog logic IMPORTED from app/ rather than reimplemented here.
 *
 * API note: the SDK is mid-transition between v1 and v2 and exact signatures
 * move. If something below does not compile against your installed version,
 * trust the SDK docs over this file — checking that is part of the exercise.
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
      "Search the catalog by name, SKU, or category (case-insensitive). " +
      "Use when the user wants to find products or browse a category. " +
      "Do not use for the full reorder list (call low_stock) or for one " +
      "SKU's stock-vs-reorder status (call check_stock).",
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "Free-text match on product name, SKU, or category. Empty string returns the whole catalog.",
        ),
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

// ── Tool 2 ────────────────────────────────────────────────────────────────
server.registerTool(
  "check_stock",
  {
    description:
      "Look up a single product by exact SKU and report on-hand stock " +
      "versus its reorder level. Use when the user names one SKU (e.g. " +
      "KB-1001) and asks if it is in stock or needs reordering. Do not use " +
      "when they ask which products across the catalog need reordering " +
      "(call low_stock).",
    inputSchema: z.object({
      sku: z
        .string()
        .describe("Exact product SKU such as KB-1001 (case-insensitive)"),
    }),
  },
  async ({ sku }) => {
    const product = findBySku(loadCatalog(), sku);
    if (!product) {
      return {
        content: [{ type: "text", text: `No product found for SKU "${sku}".` }],
      };
    }
    const needsReorder = product.stock <= product.reorderLevel;
    return {
      content: [
        {
          type: "text",
          text:
            `${product.sku} — ${product.name}\n` +
            `stock ${product.stock} · reorder level ${product.reorderLevel}\n` +
            (needsReorder
              ? "Needs reordering (stock is at or below reorder level)."
              : "Stock is above the reorder level."),
        },
      ],
    };
  },
);

// ── Tool 3 (optional in the brief; covers the reorder question) ───────────
server.registerTool(
  "low_stock",
  {
    description:
      "List every product that needs reordering right now: stock is at or " +
      "below reorderLevel, sorted lowest stock first. Use when the user " +
      "asks which items need reordering, are low on stock, or must be " +
      "restocked. Do not pass a SKU — this is the whole-catalog answer. " +
      "For one SKU use check_stock; for total inventory value read the " +
      "inventory://catalog resource.",
    inputSchema: z.object({}).describe("No parameters. Call with an empty object."),
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
                      `${p.sku} — ${p.name} · stock ${p.stock} / reorder ${p.reorderLevel}`,
                  )
                  .join("\n"),
        },
      ],
    };
  },
);

// ── Resource ──────────────────────────────────────────────────────────────
// Application-controlled snapshot: count, categories, tied-up capital.
// Tools compute answers; this URI is for "what is the catalog right now".
server.registerResource(
  "catalog",
  "inventory://catalog",
  {
    title: "Catalog summary",
    description:
      "Product count, sorted categories, and total inventory value " +
      "(sum of price × stock).",
    mimeType: "text/plain",
  },
  async (uri) => {
    const catalog = loadCatalog();
    const text = [
      `products: ${catalog.length}`,
      `categories: ${categories(catalog).join(", ")}`,
      `inventoryValue: ${inventoryValue(catalog)}`,
    ].join("\n");
    return {
      contents: [{ uri: uri.href, mimeType: "text/plain", text }],
    };
  },
);

// ── Connect ───────────────────────────────────────────────────────────────
// stdio: the HOST launches this process and talks over stdin/stdout.
// Nothing is printed to stdout except protocol messages — if you need to
// debug, log to stderr (console.error), never console.log.
const transport = new StdioServerTransport();
await server.connect(transport);

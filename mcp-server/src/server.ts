/**
 * MCP server over the seeded catalog domain — SKELETON for Task B.
 *
 * Fill in the TODOs. Requirements: >= 2 tools, >= 1 resource, read-only,
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

// ── Tool 2 ────────────────────────────────────────────────────────────────
server.registerTool(
  "check_stock",
  {
    description:
      "Look up a single product by exact SKU and report its stock level " +
      "against its reorder threshold. Use when the user asks whether a " +
      "specific SKU is in stock or needs reordering.",
    inputSchema: z.object({
      sku: z.string().describe("Exact product SKU, e.g. KB-1001 (case-insensitive)"),
    }),
  },
  async ({ sku }) => {
    const product = findBySku(loadCatalog(), sku);
    if (!product) {
      return {
        content: [{ type: "text", text: `No product found with SKU "${sku}".` }],
      };
    }
    const status = product.stock <= product.reorderLevel ? "AT OR BELOW reorder level" : "above reorder level";
    return {
      content: [
        {
          type: "text",
          text:
            `${product.sku} — ${product.name}\n` +
            `stock ${product.stock} / reorderLevel ${product.reorderLevel} (${status})`,
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
      "List every product at or below its reorder level, lowest stock " +
      "first. Use when the user asks what needs reordering or restocking.",
  },
  async () => {
    const items = lowStock(loadCatalog());
    return {
      content: [
        {
          type: "text",
          text:
            items.length === 0
              ? "Nothing is at or below its reorder level."
              : items
                  .map((p) => `${p.sku} — ${p.name} · stock ${p.stock} / reorder ${p.reorderLevel}`)
                  .join("\n"),
        },
      ],
    };
  },
);

// ── Resource ──────────────────────────────────────────────────────────────
// A resource is APPLICATION-controlled context read by URI — unlike a tool,
// the model does not invoke it. Good fit for "here is the state of the
// catalog" rather than "go compute something".
server.registerResource(
  "inventory-summary",
  "inventory://catalog",
  {
    title: "Catalog summary",
    description:
      "Product count, categories, and total inventory value for the seeded catalog.",
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

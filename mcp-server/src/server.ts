/**
 * MCP-сервер над каталогом (Task B).
 *
 * Тонкий read-only адаптер: жодна доменна логіка не переписується тут — усе
 * імпортується з `app/dist/index.js` (зібраного з `app/src/*`). Сервер лише
 * викликає доменні функції та форматує результат у протокольну відповідь.
 *
 * SDK: `@modelcontextprotocol/server` v2.0.0 (див. mcp-server/README.md — чому
 * саме v2, а не v1 `@modelcontextprotocol/sdk`). Сигнатури `registerTool` /
 * `registerResource` звірені напряму з `.d.mts` встановленого пакета.
 */

import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

// Домен живе в app/ — перед запуском сервера треба зібрати app/dist/
// (`cd app && npm run build`). НЕ переписувати цю логіку тут: сервер має
// лишатись тонким адаптером, бізнес-правила — в одному тестованому місці.
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

// ── Tool 1: search_inventory ────────────────────────────────────────────────
// ОПИС — це те, за чим модель вирішує, чи викликати tool. Розмитий опис =
// tool ніколи не спрацює.
server.registerTool(
  "search_inventory",
  {
    title: "Search inventory",
    description:
      "Search the product catalog by name, SKU, or category (case-insensitive, " +
      "partial match). Use when the user asks what products exist, wants a list " +
      "of products in a category, or is looking for a specific item by name.",
    inputSchema: z.object({
      query: z
        .string()
        .describe("Free-text match on product name, SKU, or category"),
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
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

// ── Tool 2: check_stock ─────────────────────────────────────────────────────
server.registerTool(
  "check_stock",
  {
    title: "Check stock level",
    description:
      "Look up a single product by exact SKU (case-insensitive) and report its " +
      "current stock against its reorder level. Use when the user asks whether " +
      "a specific SKU is in stock or needs reordering.",
    inputSchema: z.object({
      sku: z.string().describe("Exact product SKU, e.g. KB-1001"),
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async ({ sku }) => {
    const product = findBySku(loadCatalog(), sku);
    if (!product) {
      return {
        content: [{ type: "text", text: `No product found with SKU "${sku}".` }],
      };
    }
    const status =
      product.stock <= product.reorderLevel ? "NEEDS REORDER" : "OK";
    return {
      content: [
        {
          type: "text",
          text:
            `${product.sku} — ${product.name}: stock ${product.stock}, ` +
            `reorder level ${product.reorderLevel} → ${status}`,
        },
      ],
    };
  },
);

// ── Tool 3: low_stock ────────────────────────────────────────────────────────
server.registerTool(
  "low_stock",
  {
    title: "List items needing reorder",
    description:
      "List every product whose stock is at or below its reorder level, ordered " +
      "from lowest stock first. Use when the user asks which items need " +
      "reordering or restocking — this cannot be answered without reading the " +
      "actual inventory data.",
    inputSchema: z.object({}),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    const results = lowStock(loadCatalog());
    return {
      content: [
        {
          type: "text",
          text:
            results.length === 0
              ? "No products are at or below their reorder level."
              : results
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

// ── Resource 1: inventory://catalog ─────────────────────────────────────────
// Resources — application-контрольований контекст, читається за URI, модель
// його не викликає. Тут — стан каталогу без потреби у виклику tool.
server.registerResource(
  "catalog-summary",
  "inventory://catalog",
  {
    title: "Catalog summary",
    description:
      "Summary of the current catalog state: product count, categories, and " +
      "total inventory value.",
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

// ── Resource 2: inventory://categories ──────────────────────────────────────
server.registerResource(
  "catalog-categories",
  "inventory://categories",
  {
    title: "Catalog categories",
    description: "Unique product categories present in the catalog, sorted.",
    mimeType: "application/json",
  },
  async (uri) => {
    const catalog = loadCatalog();
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(categories(catalog), null, 2),
        },
      ],
    };
  },
);

// ── Connect ───────────────────────────────────────────────────────────────
// stdio: хост запускає цей процес і говорить через stdin/stdout. У stdout не
// повинно потрапляти нічого, крім протокольних повідомлень — для дебагу лише
// console.error.
const transport = new StdioServerTransport();
await server.connect(transport);

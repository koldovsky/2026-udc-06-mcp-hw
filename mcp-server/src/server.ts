/**
 * MCP server over the seeded catalog domain (Task B).
 *
 * Design rules, in priority order:
 *   1. READ-ONLY. Nothing here writes, deletes, or touches the network. Every
 *      tool is annotated `readOnlyHint: true` so hosts can surface that.
 *   2. THIN ADAPTER. All domain logic is imported from `app/dist` — the server
 *      only maps MCP requests to those functions and formats the answer.
 *   3. STDOUT IS THE PROTOCOL. Only JSON-RPC goes to stdout; diagnostics use
 *      `console.error` (stderr) so they never corrupt the transport.
 *
 * SDK: @modelcontextprotocol/server v2 (the `@modelcontextprotocol/server`
 * package, NOT the v1 `@modelcontextprotocol/sdk`). Signatures verified
 * against the installed `node_modules/@modelcontextprotocol/server` typings.
 */

import {
  McpServer,
  ResourceNotFoundError,
  ResourceTemplate,
} from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { createRequire } from "node:module";

// `src/` and `dist/` sit at the same depth on purpose: tsc does NOT rewrite
// relative specifiers, so this path must be valid from both directories.
//
// The import is dynamic and guarded: a static import of a missing `app/dist`
// dies at module-resolution time with a bare ERR_MODULE_NOT_FOUND stack, which
// from inside a host looks identical to "the server is broken". Failing with
// an actionable message on stderr is the difference between a 10-second fix
// and a debugging session.
type Domain = typeof import("../../app/dist/index.js");
import type { Product } from "../../app/dist/index.js";

let domain: Domain;
try {
  domain = await import("../../app/dist/index.js");
} catch (err) {
  console.error(
    "[catalog-server] cannot load the catalog domain from ../../app/dist/index.js.\n" +
      "  Run:  cd app && npm install && npm run build\n" +
      `  (original error: ${(err as Error).message})`,
  );
  process.exit(1);
}
const { loadCatalog, searchProducts, findBySku, lowStock, inventoryValue, categories } = domain;

const { version: packageVersion } = createRequire(import.meta.url)("../package.json") as {
  version: string;
};

// ── Shared schemas / formatting ───────────────────────────────────────────

const ProductSchema = z.object({
  sku: z.string(),
  name: z.string(),
  category: z.string(),
  price: z.number(),
  stock: z.number(),
  reorderLevel: z.number(),
});

/** Every tool here is a pure read: no side effects, safe to retry, closed world. */
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const formatProduct = (p: Product): string =>
  `${p.sku} — ${p.name} (${p.category}) · price ${p.price} · stock ${p.stock} · reorder at ${p.reorderLevel}`;

/**
 * "Needs reorder" is decided by the domain's `lowStock`, not re-derived here,
 * so the rule (stock <= reorderLevel) lives in exactly one tested place.
 */
const needsReorder = (data: Product[], p: Product): boolean =>
  lowStock(data).some((item) => item.sku === p.sku);

/**
 * Load the catalog per request rather than once at startup. The file is tiny,
 * and this way a long-lived host session always sees the current data instead
 * of a snapshot taken when the server process was spawned.
 */
const catalog = (): Product[] => {
  try {
    return loadCatalog();
  } catch (err) {
    // Full detail for the operator on stderr; only a sanitized, actionable
    // message to the client — the raw ENOENT text would leak the absolute
    // path of this machine into the model's context.
    console.error("[catalog-server] loadCatalog failed:", err);
    throw new Error(
      "Catalog data is not readable. Run `cd app && npm install && npm run build` " +
        "and check that app/data/catalog.json exists and is valid JSON. " +
        `(${(err as Error).name})`,
    );
  }
};

// ── Server ────────────────────────────────────────────────────────────────

const server = new McpServer(
  { name: "catalog-server", version: packageVersion },
  {
    instructions:
      "Read-only access to the product catalog (24 SKUs). Use `low_stock` for " +
      "'what needs reordering', `check_stock` for one SKU, `search_inventory` " +
      "to find products. Read resource `inventory://catalog` for totals " +
      "(product count, categories, total inventory value).",
  },
);

// ── Tool 1: search_inventory ──────────────────────────────────────────────

server.registerTool(
  "search_inventory",
  {
    title: "Search inventory",
    description:
      "Search the product catalog by free text matched case-insensitively " +
      "against product name, SKU, or category. Use this when the user asks " +
      "what products exist, asks about a kind of item ('any monitors?'), or " +
      "mentions a product by name. An empty query returns the whole catalog. " +
      "Returns sku, name, category, price, stock, and reorderLevel per product.",
    inputSchema: z.object({
      query: z
        .string()
        .max(100)
        .default("")
        .describe(
          "Free-text match on product name, SKU, or category (e.g. 'mouse', " +
            "'KB-1001', 'audio'). Empty string lists every product.",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(25)
        .describe("Maximum number of products to return (default 25)."),
    }),
    outputSchema: z.object({
      query: z.string(),
      totalMatches: z.number().int(),
      products: z.array(ProductSchema),
    }),
    annotations: { title: "Search inventory", ...READ_ONLY },
  },
  async ({ query, limit }) => {
    const matches = searchProducts(catalog(), query);
    const products = matches.slice(0, limit);
    const output = { query, totalMatches: matches.length, products };

    const text =
      matches.length === 0
        ? `No products matched "${query}".`
        : [
            `${matches.length} product(s) matched "${query}"` +
              (matches.length > products.length
                ? ` (showing first ${products.length})`
                : "") +
              ":",
            ...products.map(formatProduct),
          ].join("\n");

    return { content: [{ type: "text", text }], structuredContent: output };
  },
);

// ── Tool 2: check_stock ───────────────────────────────────────────────────

server.registerTool(
  "check_stock",
  {
    title: "Check stock for one SKU",
    description:
      "Look up a single product by its exact SKU (format XX-9999, e.g. " +
      "KB-1001; case-insensitive) and report current stock against its " +
      "reorder level, including whether it needs reordering right now. Use " +
      "this when the user names a specific SKU. For 'which items need " +
      "reordering' across the whole catalog use `low_stock` instead.",
    inputSchema: z.object({
      sku: z
        .string()
        .trim()
        .regex(/^[A-Za-z]{2}-\d{4}$/, "SKU must look like XX-9999, e.g. KB-1001")
        .describe("Exact product SKU, e.g. 'KB-1001'."),
    }),
    outputSchema: z.object({
      found: z.boolean(),
      sku: z.string(),
      product: ProductSchema.optional(),
      needsReorder: z.boolean().optional(),
      unitsBelowReorderLevel: z.number().int().optional(),
    }),
    annotations: { title: "Check stock", ...READ_ONLY },
  },
  async ({ sku }) => {
    const data = catalog();
    const product = findBySku(data, sku);
    const normalized = sku.trim().toUpperCase();

    if (!product) {
      return {
        content: [
          {
            type: "text",
            text: `No product with SKU "${normalized}". Try \`search_inventory\` to find the right SKU.`,
          },
        ],
        structuredContent: { found: false, sku: normalized },
        isError: true,
      };
    }

    const reorder = needsReorder(data, product);
    const output = {
      found: true,
      sku: product.sku,
      product,
      needsReorder: reorder,
      unitsBelowReorderLevel: Math.max(0, product.reorderLevel - product.stock),
    };
    const text =
      `${formatProduct(product)}\n` +
      (reorder
        ? `NEEDS REORDER: stock ${product.stock} is at or below reorder level ${product.reorderLevel}.`
        : `OK: stock ${product.stock} is above reorder level ${product.reorderLevel}.`);

    return { content: [{ type: "text", text }], structuredContent: output };
  },
);

// ── Tool 3: low_stock ─────────────────────────────────────────────────────

server.registerTool(
  "low_stock",
  {
    title: "Products that need reordering",
    description:
      "List every product whose stock is at or below its reorder level " +
      "(stock <= reorderLevel), lowest stock first. This is the authoritative " +
      "answer to 'which products need reordering / restocking right now'. " +
      "Takes no arguments. Also returns the total inventory value " +
      "(sum of price * stock over the whole catalog, rounded to cents) so a " +
      "'what needs reordering and what is our stock worth' question is one call.",
    inputSchema: z.object({}),
    outputSchema: z.object({
      count: z.number().int(),
      skus: z.array(z.string()),
      products: z.array(ProductSchema),
      totalInventoryValue: z.number(),
    }),
    annotations: { title: "Low stock", ...READ_ONLY },
  },
  async () => {
    const data = catalog();
    const products = lowStock(data);
    const output = {
      count: products.length,
      skus: products.map((p) => p.sku),
      products,
      totalInventoryValue: inventoryValue(data),
    };

    const text = [
      products.length === 0
        ? "No products need reordering."
        : `${products.length} product(s) need reordering (stock <= reorder level), lowest stock first:`,
      ...products.map(formatProduct),
      `Total inventory value (all ${data.length} products, sum of price * stock): ${output.totalInventoryValue}`,
    ].join("\n");

    return { content: [{ type: "text", text }], structuredContent: output };
  },
);

// ── Resource 1: inventory://catalog (summary) ─────────────────────────────
// Application-controlled context: the host can read "the state of the
// catalog" without the model deciding to call a tool.

server.registerResource(
  "catalog-summary",
  "inventory://catalog",
  {
    title: "Catalog summary",
    description:
      "Snapshot of the product catalog: product count, categories, total " +
      "inventory value, and the SKUs currently at or below reorder level.",
    mimeType: "application/json",
  },
  async (uri) => {
    const data = catalog();
    const low = lowStock(data);
    const summary = {
      productCount: data.length,
      categories: categories(data),
      totalInventoryValue: inventoryValue(data),
      lowStockCount: low.length,
      lowStockSkus: low.map((p) => p.sku),
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

// ── Resource 2: inventory://catalog/products (full list) ──────────────────

server.registerResource(
  "catalog-products",
  "inventory://catalog/products",
  {
    title: "All products",
    description:
      "The complete product list as JSON (sku, name, category, price, stock, reorderLevel).",
    mimeType: "application/json",
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(catalog(), null, 2),
      },
    ],
  }),
);

// ── Resource 3: inventory://category/{category} (template) ────────────────
// One URI per category; `list` enumerates them so a host can browse, and
// `complete` offers the known category names while a user types the URI.

server.registerResource(
  "catalog-by-category",
  new ResourceTemplate("inventory://category/{category}", {
    list: async () => ({
      resources: categories(catalog()).map((c) => ({
        name: `category-${c}`,
        uri: `inventory://category/${c}`,
        title: `Products in "${c}"`,
        mimeType: "application/json",
      })),
    }),
    complete: {
      category: async (value) =>
        categories(catalog()).filter((c) => c.startsWith(value.toLowerCase())),
    },
  }),
  {
    title: "Products by category",
    description:
      "Products belonging to one category. Known categories: accessories, " +
      "audio, cables, displays, furniture, peripherals, storage.",
    mimeType: "application/json",
  },
  async (uri, { category }) => {
    const name = String(category).toLowerCase();
    const data = catalog();
    const known = categories(data);
    if (!known.includes(name)) {
      // Found via MCP Inspector (Task E): an unknown category used to return
      // `{count: 0, products: []}` — indistinguishable from an empty category.
      // A proper not-found error lets the host tell those cases apart.
      throw new ResourceNotFoundError(
        uri.href,
        `Unknown category "${name}". Known categories: ${known.join(", ")}.`,
      );
    }
    const products = searchProducts(data, name).filter(
      (p) => p.category.toLowerCase() === name,
    );
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({ category: name, count: products.length, products }, null, 2),
        },
      ],
    };
  },
);

// ── Connect ───────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
try {
  await server.connect(transport);
} catch (err) {
  console.error("[catalog-server] failed to start:", err);
  process.exit(1);
}
console.error("[catalog-server] ready on stdio (read-only, 3 tools, 2 resources + 1 template)");

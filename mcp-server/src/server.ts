/**
 * MCP server over the seeded catalog domain (Task B).
 *
 * A protocol adapter and nothing else: every catalog rule lives in
 * `app/src/catalog.ts` and is imported, never re-typed here. Read-only — the
 * only I/O is `loadCatalog()` reading one JSON file.
 *
 * SDK v2, signatures checked against the installed .d.mts. Design rationale
 * and troubleshooting: ../README.md.
 */

import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

// Run `npm run setup` first or this fails with ERR_MODULE_NOT_FOUND. `src/`
// and `dist/` sit at the same depth so the path is valid from both — tsc does
// not rewrite relative imports.
import {
  loadCatalog,
  searchProducts,
  findBySku,
  lowStock,
  inventoryValue,
  categories,
  type Product,
} from "../../app/dist/index.js";

// Reused by every outputSchema: `structuredContent` lets the host parse the
// result instead of scraping the text block.
const productSchema = z.object({
  sku: z.string(),
  name: z.string(),
  category: z.string(),
  price: z.number(),
  stock: z.number(),
  reorderLevel: z.number(),
});

// The shape above is the one thing that has to be restated here — a zod schema
// is a runtime value, so it cannot be derived from the library's `Product`
// interface. This assertion makes any drift between them a COMPILE error
// instead of a field silently missing from `structuredContent`.
type Exact<A, B> = A extends B ? (B extends A ? true : false) : false;
type Assert<T extends true> = T;
type _ProductSchemaMatchesDomain = Assert<
  Exact<z.infer<typeof productSchema>, Product>
>;

// Every SKU in the seeded catalog is two letters, a hyphen, four digits, so
// nothing that fails this could ever have been found. Leading/trailing space
// and lower case are tolerated because `findBySku` trims and upper-cases —
// the pattern must not reject an input the domain would have accepted.
const SKU_SHAPE = /^\s*[A-Za-z]{2}-\d{4}\s*$/;

// Honest self-declaration, not a guarantee: the spec says clients should never
// trust annotations from untrusted servers. Enforcement is the host deny-list
// — docs/mcp/SECURITY.md, T-3.
const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

// Re-read per call, not cached: 24 static rows cost nothing, and a stock server
// that caches stock levels is wrong in spirit. A TTL cache would go here.
function catalog(): Product[] {
  return loadCatalog();
}

const line = (p: Product) =>
  `${p.sku} — ${p.name} (${p.category}) · ${p.price} · stock ${p.stock}/${p.reorderLevel}`;

const server = new McpServer({ name: "catalog-server", version: "1.0.0" });

// ── Tool 1 — search ───────────────────────────────────────────────────────
// Descriptions say WHEN to reach for the tool — that is what the model reads.
server.registerTool(
  "search_inventory",
  {
    title: "Search inventory",
    description:
      "Search the product catalog by name, SKU, or category (case-insensitive, " +
      "substring match). Use when the user asks what products exist, asks about " +
      "a product by name, or wants everything in a category such as 'audio' or " +
      "'cables'. Omit the query argument to return the entire catalog.",
    // Optional on the wire, not just in prose. The description promises that
    // an empty query lists everything, so the schema must let the model ask
    // for everything by omitting the argument — a required `query` turned
    // "show me the catalog" into an input-validation error (Task E, D-1).
    inputSchema: z.object({
      query: z
        .string()
        .default("")
        .describe(
          "Free-text match against product name, SKU, or category. " +
            "Omit it, or pass an empty string, to return all products.",
        ),
    }),
    outputSchema: z.object({
      query: z.string(),
      count: z.number(),
      products: z.array(productSchema),
    }),
    annotations: readOnly,
  },
  async ({ query }) => {
    const products = searchProducts(catalog(), query);
    return {
      content: [
        {
          type: "text",
          text:
            products.length === 0
              ? `No products matched "${query}".`
              : `${products.length} match(es):\n` + products.map(line).join("\n"),
        },
      ],
      structuredContent: { query, count: products.length, products },
    };
  },
);

// ── Tool 2 — single SKU, with the reorder verdict ─────────────────────────
server.registerTool(
  "check_stock",
  {
    title: "Check stock for one SKU",
    description:
      "Look up one product by its exact SKU (format XX-9999, e.g. KB-1001) and " +
      "report units on hand against its reorder level, including whether it " +
      "needs reordering. Use when the user names a specific SKU. To find a SKU " +
      "from a product name, use search_inventory first.",
    inputSchema: z.object({
      sku: z
        .string()
        .regex(
          SKU_SHAPE,
          "SKU must look like XX-9999 (two letters, a hyphen, four digits), " +
            "e.g. 'KB-1001'. Pass a product name to search_inventory instead.",
        )
        .describe(
          "Exact SKU in the form XX-9999, case-insensitive, e.g. 'KB-1001' " +
            "or 'kb-1001'. Not a product name — use search_inventory for those.",
        ),
    }),
    outputSchema: z.object({
      found: z.boolean(),
      sku: z.string(),
      product: productSchema.nullable(),
      needsReorder: z.boolean().nullable(),
    }),
    annotations: readOnly,
  },
  async ({ sku }) => {
    const all = catalog();
    const product = findBySku(all, sku) ?? null;

    // A missing SKU is a valid answer, not a tool failure: isError would invite
    // a retry that can never succeed.
    if (!product) {
      return {
        content: [
          {
            type: "text",
            text: `No product with SKU "${sku}". Use search_inventory to find the right SKU.`,
          },
        ],
        structuredContent: { found: false, sku, product: null, needsReorder: null },
      };
    }

    // Rule borrowed from lowStock() rather than re-typed, so they cannot disagree.
    const needsReorder = lowStock(all).some((p) => p.sku === product.sku);
    return {
      content: [
        {
          type: "text",
          text:
            `${line(product)}\n` +
            (needsReorder
              ? `NEEDS REORDER — stock ${product.stock}, reorder level ${product.reorderLevel}.`
              : `OK — stock ${product.stock}, reorder level ${product.reorderLevel}.`),
        },
      ],
      structuredContent: { found: true, sku: product.sku, product, needsReorder },
    };
  },
);

// ── Tool 3 — the question a model cannot guess ────────────────────────────
server.registerTool(
  "low_stock",
  {
    title: "Products needing reorder",
    description:
      "List every product at or below its reorder level, lowest stock first. " +
      "Use when the user asks what needs reordering, what is running low, or " +
      "what to restock. Takes no arguments and covers the whole catalog.",
    inputSchema: z.object({}),
    outputSchema: z.object({
      count: z.number(),
      skus: z.array(z.string()),
      products: z.array(productSchema),
    }),
    annotations: readOnly,
  },
  async () => {
    const products = lowStock(catalog());
    const skus = products.map((p) => p.sku);
    return {
      content: [
        {
          type: "text",
          text:
            products.length === 0
              ? "Nothing is at or below its reorder level."
              : `${products.length} product(s) need reordering:\n` +
                products.map(line).join("\n"),
        },
      ],
      structuredContent: { count: products.length, skus, products },
    };
  },
);

// ── Tool 4 — aggregate ────────────────────────────────────────────────────
// A tool, not a resource: the model can call this, but cannot ask the host to
// attach a resource.
server.registerTool(
  "inventory_summary",
  {
    title: "Inventory summary",
    description:
      "Totals across the whole catalog: number of products, the category list, " +
      "how many items need reordering, and the total value of stock on hand " +
      "(sum of price x units). Use when the user asks for total inventory " +
      "value, tied-up capital, or an overview of the catalog.",
    inputSchema: z.object({}),
    outputSchema: z.object({
      productCount: z.number(),
      categories: z.array(z.string()),
      lowStockCount: z.number(),
      totalInventoryValue: z.number(),
    }),
    annotations: readOnly,
  },
  async () => {
    const all = catalog();
    const summary = {
      productCount: all.length,
      categories: categories(all),
      lowStockCount: lowStock(all).length,
      totalInventoryValue: inventoryValue(all),
    };
    return {
      content: [
        {
          type: "text",
          text:
            `${summary.productCount} products across ${summary.categories.length} categories ` +
            `(${summary.categories.join(", ")}).\n` +
            `${summary.lowStockCount} need reordering.\n` +
            `Total value of stock on hand: ${summary.totalInventoryValue}`,
        },
      ],
      structuredContent: summary,
    };
  },
);

// ── Resource ──────────────────────────────────────────────────────────────
// Application-readable context by URI — the model does not invoke it.

server.registerResource(
  "catalog",
  "inventory://catalog",
  {
    title: "Full product catalog",
    description:
      "All products with sku, name, category, price, stock and reorderLevel, as JSON.",
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

// ── Connect ───────────────────────────────────────────────────────────────
// stdout carries protocol frames ONLY — a stray console.log corrupts the stream
// and the host drops the server. Debug output goes to stderr.
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("catalog-server ready on stdio");

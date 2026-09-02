/**
 * MCP server over the seeded catalog domain (Task B).
 *
 * Design rules this file follows:
 *  - **Thin adapter.** Every number below comes from `app/` via import. There
 *    is no catalog logic here — no filtering, no summing, no sorting. If a
 *    rule changes, it changes in one tested place.
 *  - **Read-only.** Nothing writes, deletes, or makes a network call. That is
 *    also declared in the protocol via `annotations.readOnlyHint`, so a host
 *    can see the guarantee without reading this source.
 *  - **stdout is the protocol.** Diagnostics go to stderr via `console.error`.
 *    A single stray `console.log` corrupts the JSON-RPC stream.
 *
 * SDK: @modelcontextprotocol/server v2, with zod schemas.
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

// The domain lives in app/ — run `cd app && npm run build` first.
// Do NOT reimplement any of this logic here: a server is a protocol adapter,
// and duplicated business rules drift apart.
//
// NOTE ON THE PATH: this file lives in `src/` and compiles to `dist/` — both
// one level below the package root, so `../../app/dist/index.js` is correct
// before AND after compilation. TypeScript does not rewrite relative imports;
// if this file sat at the package root, the built copy would silently point
// at the wrong directory.
import {
  loadCatalog,
  searchProducts,
  findBySku,
  lowStock,
  inventoryValue,
  categories,
  type Product,
} from "../../app/dist/index.js";

const server = new McpServer({
  name: "catalog-server",
  version: "1.0.0",
});

/** Every tool here is a pure read. Declared once, applied to all of them. */
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** Zod mirror of the domain `Product`, for tool output schemas. */
const productSchema = z.object({
  sku: z.string(),
  name: z.string(),
  category: z.string(),
  price: z.number(),
  stock: z.number(),
  reorderLevel: z.number(),
});

/** One-line rendering of a product. Presentation only — no domain rules. */
const line = (p: Product): string =>
  `${p.sku} — ${p.name} (${p.category}) · $${p.price} · stock ${p.stock} (reorder at ${p.reorderLevel})`;

// ── Tool 1 ────────────────────────────────────────────────────────────────
// The DESCRIPTION is what the model reads to decide whether to call this.
// It says WHEN to use it, not just what it is — a vague description means the
// tool never fires, which is exactly the failure Task D is designed to expose.
server.registerTool(
  "search_inventory",
  {
    title: "Search inventory",
    description:
      "Search the product catalog by name, SKU, or category (case-insensitive " +
      "substring match). Use when the user asks what products exist, asks " +
      "about a specific item, or asks what is in a category such as " +
      "'peripherals' or 'audio'. An empty query returns the whole catalog.",
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "Free-text match on product name, SKU, or category. Empty string returns every product.",
        ),
    }),
    outputSchema: z.object({
      matchCount: z.number(),
      products: z.array(productSchema),
    }),
    annotations: READ_ONLY,
  },
  async ({ query }) => {
    const results = searchProducts(loadCatalog(), query);
    return {
      content: [
        {
          type: "text" as const,
          text:
            results.length === 0
              ? `No products matched "${query}".`
              : `${results.length} product(s) matched "${query}":\n` +
                results.map(line).join("\n"),
        },
      ],
      structuredContent: { matchCount: results.length, products: results },
    };
  },
);

// ── Tool 2 ────────────────────────────────────────────────────────────────
// Answers "do we have enough of X?" — the reorder comparison is the domain's
// (`stock <= reorderLevel`), not restated here.
server.registerTool(
  "check_stock",
  {
    title: "Check stock for one SKU",
    description:
      "Look up a single product by its exact SKU (format XX-9999, e.g. " +
      "KB-1001) and report units on hand against its reorder level. Use when " +
      "the user names a specific SKU or asks whether one particular item " +
      "needs reordering. If you only have a product name, call " +
      "search_inventory first to get the SKU.",
    inputSchema: z.object({
      sku: z
        .string()
        .describe(
          "Exact SKU, e.g. 'KB-1001'. Case-insensitive; not a search term.",
        ),
    }),
    outputSchema: z.object({
      found: z.boolean(),
      sku: z.string(),
      name: z.string().optional(),
      category: z.string().optional(),
      price: z.number().optional(),
      stock: z.number().optional(),
      reorderLevel: z.number().optional(),
      needsReorder: z.boolean().optional(),
    }),
    annotations: READ_ONLY,
  },
  async ({ sku }) => {
    const product = findBySku(loadCatalog(), sku);

    if (!product) {
      // Not an error — "no such SKU" is a valid answer. Returning isError here
      // would push the model to retry a lookup that will never succeed.
      return {
        content: [
          {
            type: "text" as const,
            text: `No product with SKU "${sku}". Use search_inventory to find the right SKU.`,
          },
        ],
        structuredContent: { found: false, sku },
      };
    }

    // Reuse the domain rule instead of writing `stock <= reorderLevel` again:
    // lowStock() is the single definition of "needs reordering".
    const needsReorder = lowStock([product]).length === 1;

    return {
      content: [
        {
          type: "text" as const,
          text:
            `${line(product)}\n` +
            (needsReorder
              ? "At or below reorder level — needs reordering."
              : "Above reorder level — no action needed."),
        },
      ],
      structuredContent: { found: true, ...product, needsReorder },
    };
  },
);

// ── Tool 3 ────────────────────────────────────────────────────────────────
// The question an LLM cannot answer by reasoning — it requires reading 24 rows
// and comparing two fields on each. This is the Task D probe.
server.registerTool(
  "low_stock",
  {
    title: "List items needing reorder",
    description:
      "List every product at or below its reorder level (stock <= " +
      "reorderLevel), lowest stock first. Use when the user asks what needs " +
      "reordering, what is running low, what to restock, or for a " +
      "replenishment list. Takes no arguments and covers the whole catalog.",
    inputSchema: z.object({}),
    outputSchema: z.object({
      count: z.number(),
      products: z.array(productSchema),
    }),
    annotations: READ_ONLY,
  },
  async () => {
    const items = lowStock(loadCatalog());
    return {
      content: [
        {
          type: "text" as const,
          text:
            items.length === 0
              ? "Nothing is at or below its reorder level."
              : `${items.length} product(s) need reordering (lowest stock first):\n` +
                items.map(line).join("\n"),
        },
      ],
      structuredContent: { count: items.length, products: items },
    };
  },
);

// ── Resource 1 (static) ───────────────────────────────────────────────────
// A resource is APPLICATION-controlled context read by URI — the model does
// not invoke it. Right fit for "here is the state of the catalog": a client
// can attach this without the model deciding to call anything.
server.registerResource(
  "catalog-summary",
  "inventory://catalog",
  {
    title: "Catalog summary",
    description:
      "Aggregate state of the inventory: product count, categories, total " +
      "inventory value, and how many items need reordering.",
    mimeType: "application/json",
  },
  async (uri) => {
    const catalog = loadCatalog();
    const summary = {
      productCount: catalog.length,
      categories: categories(catalog),
      totalInventoryValue: inventoryValue(catalog),
      lowStockCount: lowStock(catalog).length,
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

// ── Resource 2 (template) ─────────────────────────────────────────────────
// Same idea, addressable per category. `list` is required-even-if-undefined by
// the SDK so you cannot forget it — here we CAN list, from the domain.
server.registerResource(
  "catalog-by-category",
  new ResourceTemplate("inventory://category/{category}", {
    list: async () => ({
      resources: categories(loadCatalog()).map((c) => ({
        uri: `inventory://category/${encodeURIComponent(c)}`,
        name: c,
        description: `Products in the "${c}" category`,
        mimeType: "application/json",
      })),
    }),
    // Autocomplete for the {category} variable, so a human browsing resources
    // in the host sees the real values instead of guessing.
    complete: {
      category: async (value: string) =>
        categories(loadCatalog()).filter((c) =>
          c.toLowerCase().startsWith(value.toLowerCase()),
        ),
    },
  }),
  {
    title: "Products by category",
    description:
      "Every product in one category, as JSON. Categories: peripherals, " +
      "displays, accessories, audio, furniture, cables, storage.",
    mimeType: "application/json",
  },
  async (uri, { category }) => {
    const wanted = decodeURIComponent(String(category));
    // searchProducts already matches on category — reuse it, then keep only
    // exact-category hits so "cables" cannot leak a name that contains it.
    const products = searchProducts(loadCatalog(), wanted).filter(
      (p) => p.category === wanted,
    );
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({ category: wanted, products }, null, 2),
        },
      ],
    };
  },
);

// ── Connect ───────────────────────────────────────────────────────────────
// stdio: the HOST launches this process and talks over stdin/stdout.
// Nothing may be printed to stdout except protocol messages — debug on stderr.
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("catalog-server ready on stdio (read-only: 3 tools, 2 resources)");


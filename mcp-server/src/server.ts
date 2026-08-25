/**
 * MCP server over the seeded catalog domain — Task B.
 *
 * Read-only by construction: the only I/O in this process is `loadCatalog()`
 * reading `app/data/catalog.json`. No writes, no deletes, no network.
 *
 * Written against the INSTALLED SDK, not against a blog post: v2
 * (`@modelcontextprotocol/server@2.0.0`, MCP revision 2026-07-28). Signatures
 * were read from
 * `node_modules/@modelcontextprotocol/server/dist/createMcpHandler-*.d.mts` —
 * note that the raw-shape `inputSchema` form is deprecated there in favour of
 * passing a `z.object({...})`.
 */

import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

// The domain lives in app/ — run `cd app && npm run build` first.
// This server deliberately owns NO business rules: every number below comes
// from these functions, so `app/src/catalog.ts` stays the single tested place
// where "what counts as low stock" or "how value is summed" is decided.
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

// ── Shared helpers ────────────────────────────────────────────────────────

/**
 * `loadCatalog()` with a client-safe failure.
 *
 * Found with MCP Inspector (Task E, path 2): when `app/data/catalog.json` is
 * missing, the raw `ENOENT` message propagated to the client verbatim —
 * including the **absolute path** of the file. That leaked local layout into
 * the model's context, and "ENOENT" told the model nothing it could act on.
 * The realistic cause is a fresh clone without a build, so the message now
 * says that instead, and carries the error code without the path.
 */
function readCatalog(): Product[] {
  try {
    return loadCatalog();
  } catch (err) {
    const code =
      (err as NodeJS.ErrnoException).code ?? (err as Error).name ?? "unknown";
    throw new Error(
      `Catalog data is unavailable (${code}). This server reads the seeded ` +
        `catalog through the compiled app/ build: run \`npm run build\` in ` +
        `app/ and confirm the data file exists next to it.`,
    );
  }
}

/**
 * SKUs that need reordering, as decided by the domain.
 *
 * This exists so nothing here restates the reorder rule (`stock <=
 * reorderLevel`). We ask `lowStock()` and use its answer as a lookup — one
 * domain call per request, and the rule can change in `app/` without this
 * file drifting away from it.
 */
function reorderFlags(catalog: Product[]): Set<string> {
  return new Set(lowStock(catalog).map((p) => p.sku));
}

function describe(p: Product, needsReorder: boolean): string {
  const flag = needsReorder ? " ⚠ needs reorder" : "";
  return `${p.sku} — ${p.name} (${p.category}) · price ${p.price} · stock ${p.stock} · reorder at ${p.reorderLevel}${flag}`;
}

/** Product shape returned as structured output, plus the domain's verdict. */
const productSchema = z.object({
  sku: z.string(),
  name: z.string(),
  category: z.string(),
  price: z.number(),
  stock: z.number(),
  reorderLevel: z.number(),
  needsReorder: z.boolean(),
});

function toStructured(p: Product, needsReorder: boolean) {
  return { ...p, needsReorder };
}

// ── Tool 1 — search_inventory ─────────────────────────────────────────────
// The DESCRIPTION is what the model reads to decide whether to call this.
// It has to say WHEN to use the tool, not just what it is.
server.registerTool(
  "search_inventory",
  {
    title: "Search inventory",
    description:
      "Search the product catalog by name, SKU, or category (case-insensitive, " +
      "partial matches allowed). Use when the user asks what products exist, " +
      "asks about a specific item, or wants everything in a category such as " +
      "displays or audio. An empty query returns the whole catalog.",
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "Free-text match on product name, SKU, or category — e.g. 'keyboard', 'KB-1001', 'audio'. Empty string returns all products.",
        ),
    }),
    outputSchema: z.object({
      count: z.number(),
      products: z.array(productSchema),
    }),
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ query }) => {
    const catalog = readCatalog();
    const flagged = reorderFlags(catalog);
    const results = searchProducts(catalog, query);
    const products = results.map((p) => toStructured(p, flagged.has(p.sku)));

    return {
      content: [
        {
          type: "text" as const,
          text:
            results.length === 0
              ? `No products matched "${query}".`
              : `${results.length} product(s) matched "${query}":\n` +
                results
                  .map((p) => describe(p, flagged.has(p.sku)))
                  .join("\n"),
        },
      ],
      structuredContent: { count: results.length, products },
    };
  },
);

// ── Tool 2 — check_stock ──────────────────────────────────────────────────
server.registerTool(
  "check_stock",
  {
    title: "Check stock for one SKU",
    description:
      "Report the stock level of one exact SKU and whether it is at or below " +
      "its reorder level. Use when the user names a specific product code and " +
      "asks how many are left, or whether it has to be restocked.",
    inputSchema: z.object({
      sku: z
        .string()
        .describe("Exact SKU in the format XX-9999, e.g. KB-1001 (case-insensitive)"),
    }),
    outputSchema: z.object({
      found: z.boolean(),
      sku: z.string(),
      product: productSchema.optional(),
    }),
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ sku }) => {
    const catalog = readCatalog();
    const product = findBySku(catalog, sku);

    // An unknown SKU is a legitimate answer, not a protocol failure — return
    // it as content so the model can act on it instead of seeing a transport
    // error it cannot interpret.
    if (!product) {
      return {
        content: [
          {
            type: "text" as const,
            text: `SKU "${sku}" is not in the catalog. Use search_inventory to find the right code.`,
          },
        ],
        structuredContent: { found: false, sku },
      };
    }

    const needsReorder = reorderFlags(catalog).has(product.sku);
    const verdict = needsReorder
      ? `NEEDS REORDER — stock ${product.stock} is at or below the reorder level of ${product.reorderLevel}.`
      : `OK — stock ${product.stock} is above the reorder level of ${product.reorderLevel}.`;

    return {
      content: [
        {
          type: "text" as const,
          text: `${describe(product, needsReorder)}\n${verdict}`,
        },
      ],
      structuredContent: {
        found: true,
        sku: product.sku,
        product: toStructured(product, needsReorder),
      },
    };
  },
);

// ── Tool 3 — low_stock ────────────────────────────────────────────────────
// No arguments, but the input schema is declared explicitly rather than
// omitted: "every tool has a description and an input schema" is a hard
// requirement of this exercise, and an empty object states "takes nothing".
server.registerTool(
  "low_stock",
  {
    title: "Products that need reordering",
    description:
      "List every product that needs reordering — stock at or below its " +
      "reorder level — lowest stock first. Use when the user asks what has to " +
      "be restocked, reordered, or is running out. Takes no arguments and " +
      "covers the whole catalog.",
    inputSchema: z.object({}),
    outputSchema: z.object({
      count: z.number(),
      skus: z.array(z.string()),
      products: z.array(productSchema),
    }),
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    const items = lowStock(readCatalog());
    const skus = items.map((p) => p.sku);

    return {
      content: [
        {
          type: "text" as const,
          text:
            items.length === 0
              ? "Nothing needs reordering — every product is above its reorder level."
              : `${items.length} product(s) need reordering:\n` +
                items.map((p) => describe(p, true)).join("\n") +
                `\n\nSKUs: ${skus.join(", ")}`,
        },
      ],
      structuredContent: {
        count: items.length,
        skus,
        products: items.map((p) => toStructured(p, true)),
      },
    };
  },
);

// ── Tool 4 — inventory_value ──────────────────────────────────────────────
server.registerTool(
  "inventory_value",
  {
    title: "Total value of stock on hand",
    description:
      "Compute the total value of stock currently held: the sum of price × " +
      "stock across every product, rounded to cents. Use when the user asks " +
      "what the inventory is worth, how much capital is tied up in stock, or " +
      "for a total stock value. Takes no arguments.",
    inputSchema: z.object({}),
    outputSchema: z.object({
      totalValue: z.number(),
      productCount: z.number(),
    }),
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    const catalog = readCatalog();
    const totalValue = inventoryValue(catalog);

    return {
      content: [
        {
          type: "text" as const,
          text: `Total inventory value: ${totalValue} across ${catalog.length} products.`,
        },
      ],
      structuredContent: { totalValue, productCount: catalog.length },
    };
  },
);

// ── Resource — inventory://catalog ────────────────────────────────────────
// A resource is APPLICATION-controlled context read by URI; the model does
// not invoke it the way it invokes a tool. This one is the standing "state of
// the catalog" summary, deliberately overlapping `inventory_value`: the same
// fact reachable two ways makes it observable, in Task D, whether the host
// surfaces resources to the model at all or whether it only ever calls tools.
//
// No timestamp in the payload on purpose — identical input must produce
// identical output, so two A/B runs stay byte-comparable.
server.registerResource(
  "catalog-summary",
  "inventory://catalog",
  {
    title: "Catalog summary",
    description:
      "Product count, category list, total stock value, and how many products need reordering.",
    mimeType: "application/json",
  },
  async (uri) => {
    const catalog = readCatalog();
    const summary = {
      productCount: catalog.length,
      categories: categories(catalog),
      totalValue: inventoryValue(catalog),
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

// ── Connect ───────────────────────────────────────────────────────────────
// stdio: the HOST launches this process and talks over stdin/stdout.
// Nothing may reach stdout except protocol messages — debug with
// console.error, never console.log.
const transport = new StdioServerTransport();
await server.connect(transport);

/**
 * MCP server over the seeded catalog domain (Task B).
 *
 * Read-only by construction: every handler below is a formatter around a pure
 * function imported from `app/`. There is no tool that writes, deletes, or
 * makes a network call, and the only filesystem touch is `loadCatalog()`
 * reading the seeded `app/data/catalog.json`.
 *
 * Written against @modelcontextprotocol/server v2.0.0. The v2 entry point is
 * `serveStdio(factory)`, not the `new StdioServerTransport()` +
 * `server.connect(transport)` pair from the v1-era examples.
 * Docs: https://ts.sdk.modelcontextprotocol.io/v2/
 */

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
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
  type Product,
} from "../../app/dist/index.js";

/** Every tool here reads and returns; none of them mutate anything. */
const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

/**
 * Input schemas live here, as named constants, so each handler's argument type
 * can be *derived* from its schema (`z.infer`) rather than written out by hand
 * next to it. A hand-written `({ query }: { query: string })` compiles happily
 * after the schema changes underneath it — which is the same class of defect
 * MCP Inspector caught in Task E, where the description and the published
 * schema disagreed. Deriving the type makes that disagreement a compile error.
 *
 * `z.infer` is the OUTPUT type, so `.default("")` is reflected: the handler
 * sees `query: string`, never `undefined`.
 */
const searchInventoryInput = z.object({
  // Optional on purpose: the description promises that an empty query returns
  // the whole catalog, and `searchProducts` implements exactly that. Marking it
  // required contradicted the description — MCP Inspector showed
  // `"required": ["query"]` in the published schema and an argument-less call
  // failing validation before the handler ran.
  query: z
    .string()
    .optional()
    .default("")
    .describe(
      "Free-text match on product name, SKU, or category. " +
        "Omit or pass an empty string to list the whole catalog.",
    ),
});

const checkStockInput = z.object({
  sku: z
    .string()
    .describe("Exact product SKU, e.g. 'KB-1001'. Case-insensitive."),
});

/** Both aggregate tools cover the whole catalog and take nothing. */
const noInput = z.object({});

/**
 * The seeded catalog is immutable for the lifetime of this process, so it is
 * read and parsed once and then reused. A host keeps the server running for a
 * whole session; re-reading the same 24-product file on every call buys
 * nothing. The trade-off is explicit: edit `app/data/catalog.json` and the
 * server keeps serving the old copy until it is restarted.
 */
let cached: Product[] | undefined;
function getCatalog(): Product[] {
  cached ??= loadCatalog();
  return cached;
}

/** One product as a single line — the shape the model reads back to the user. */
function formatProduct(p: Product): string {
  return `${p.sku} — ${p.name} (${p.category}) · price ${p.price} · stock ${p.stock} · reorder level ${p.reorderLevel}`;
}

/**
 * Wraps a tool body so a thrown error comes back as a readable tool result
 * instead of a protocol-level crash. `loadCatalog()` throws when
 * `app/data/catalog.json` is missing or malformed, and a tool that says so is
 * worth far more to the model than an opaque failure. `isError: true` is how
 * MCP marks a call that failed for a domain reason rather than a transport one.
 *
 * The remedy line is attached only to the error it actually remedies. An
 * earlier version appended "most likely app/ has not been built" to every
 * failure, which is true for `ENOENT` and misleading for anything else — a
 * malformed `catalog.json` is a `SyntaxError` that a rebuild does not fix, and
 * pointing the model at the wrong repair is worse than naming none.
 */
type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

/** `readFileSync` throws an ErrnoException; `JSON.parse` throws a plain SyntaxError. */
function isMissingFile(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function guarded<A>(run: (args: A) => string): (args: A) => Promise<ToolResult> {
  return async (args: A) => {
    try {
      return { content: [{ type: "text", text: run(args) }] };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const hint = isMissingFile(err)
        ? "\nMost likely app/ has not been built — run: cd app && npm run build"
        : "";
      return {
        content: [
          {
            type: "text",
            text: `catalog-server could not read the catalog: ${reason}${hint}`,
          },
        ],
        isError: true,
      };
    }
  };
}

serveStdio(() => {
  const server = new McpServer({
    name: "catalog-server",
    version: "1.0.0",
  });

  // ── Tool 1 ──────────────────────────────────────────────────────────────
  // The DESCRIPTION is what the model reads to decide whether to call this,
  // so it says WHEN to use the tool, not only what it does.
  server.registerTool(
    "search_inventory",
    {
      title: "Search inventory",
      description:
        "Search the product catalog by name, SKU, or category (case-insensitive " +
        "substring match). Use when the user asks which products exist, asks " +
        "about a product by name, or asks what is in a category such as " +
        "'audio' or 'cables'. An empty query returns the whole catalog.",
      inputSchema: searchInventoryInput,
      annotations: READ_ONLY,
    },
    guarded(({ query }: z.infer<typeof searchInventoryInput>) => {
      const results = searchProducts(getCatalog(), query);
      // The empty-query case is a catalog listing, not a search that matched
      // the empty string — Inspector made the old `matched ""` wording obvious.
      if (query.trim() === "") {
        return (
          `Whole catalog (${results.length} product(s)):\n` +
          results.map(formatProduct).join("\n")
        );
      }
      return results.length === 0
        ? `No products matched "${query}".`
        : `${results.length} product(s) matched "${query}":\n` +
            results.map(formatProduct).join("\n");
    }),
  );

  // ── Tool 2 ──────────────────────────────────────────────────────────────
  server.registerTool(
    "check_stock",
    {
      title: "Check stock for a SKU",
      description:
        "Look up one product by its exact SKU (format XX-9999, e.g. KB-1001) " +
        "and report its stock against its reorder level. Use when the user " +
        "names a specific SKU and asks how many are left or whether it needs " +
        "reordering. For fuzzy lookups by product name, use search_inventory.",
      inputSchema: checkStockInput,
      annotations: READ_ONLY,
    },
    guarded(({ sku }: z.infer<typeof checkStockInput>) => {
      const product = findBySku(getCatalog(), sku);
      if (!product) {
        return `No product with SKU "${sku}" in the catalog.`;
      }
      const needsReorder = product.stock <= product.reorderLevel;
      return (
        `${formatProduct(product)}\n` +
        `Needs reordering: ${needsReorder ? "yes" : "no"} ` +
        `(stock ${product.stock} ${needsReorder ? "<=" : ">"} reorder level ${product.reorderLevel}).`
      );
    }),
  );

  // ── Tool 3 ──────────────────────────────────────────────────────────────
  // The question the model cannot answer without reading and aggregating data.
  server.registerTool(
    "low_stock",
    {
      title: "List items needing reorder",
      description:
        "List every product whose stock is at or below its reorder level, " +
        "lowest stock first. Use when the user asks what needs reordering, " +
        "what is running low, or which items are below their restock " +
        "threshold. Takes no arguments and always covers the whole catalog.",
      inputSchema: noInput,
      annotations: READ_ONLY,
    },
    guarded(() => {
      const items = lowStock(getCatalog());
      return items.length === 0
        ? "No products are at or below their reorder level."
        : `${items.length} product(s) need reordering:\n` +
            items.map(formatProduct).join("\n");
    }),
  );

  // ── Tool 4 ──────────────────────────────────────────────────────────────
  // The aggregate the A/B run of Task D showed the model computing by hand:
  // with only the three tools above it pulled all 24 rows through
  // search_inventory and summed price x stock itself. Arithmetic over a tool
  // result is untested arithmetic, and it scales with the catalog. This moves
  // it behind the protocol boundary, onto the same `inventoryValue` function
  // the app tests already cover.
  server.registerTool(
    "inventory_value",
    {
      title: "Total value of stock on hand",
      description:
        "Return the total value of all stock currently held, computed as the " +
        "sum of price x stock over every product. Use when the user asks what " +
        "the inventory is worth, the total stock value, or how much capital is " +
        "tied up in stock. Takes no arguments and always covers the whole " +
        "catalog — do not sum the output of search_inventory yourself.",
      inputSchema: noInput,
      annotations: READ_ONLY,
    },
    guarded(() => {
      const catalog = getCatalog();
      return (
        `Total inventory value: ${inventoryValue(catalog)} ` +
        `(price x stock over ${catalog.length} products).`
      );
    }),
  );

  // ── Resource ────────────────────────────────────────────────────────────
  // A resource is APPLICATION-controlled context read by URI — the model does
  // not invoke it. That makes it the right home for "here is the state of the
  // catalog" as opposed to "go compute something", which is what the tools do.
  //
  // Note the asymmetry with the tools above: a resource result has no
  // `isError` channel, so a failure here is deliberately left to surface as a
  // JSON-RPC error. There is no model to explain it to — the host reads this.
  server.registerResource(
    "catalog-summary",
    "inventory://catalog",
    {
      title: "Catalog summary",
      description:
        "Aggregate state of the product catalog: product count, categories, " +
        "total inventory value, and how many items are below their reorder level.",
      mimeType: "application/json",
    },
    async (uri) => {
      const catalog = getCatalog();
      const summary = {
        productCount: catalog.length,
        categories: categories(catalog),
        inventoryValue: inventoryValue(catalog),
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

  // stdio: the HOST launches this process and talks over stdin/stdout.
  // Nothing may be printed to stdout except protocol messages — debug output
  // goes to stderr via console.error, never console.log.
  console.error("catalog-server ready on stdio (read-only)");

  return server;
});

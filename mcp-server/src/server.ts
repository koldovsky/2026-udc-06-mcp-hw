/**
 * MCP server over the seeded catalog domain — Task B.
 *
 * Read-only by construction: every tool is a pure read over `app/`'s domain
 * functions. No writes, no deletes, no network. The catalog logic is IMPORTED,
 * never reimplemented — the business rules stay in one tested place.
 *
 * Built against @modelcontextprotocol/server 2.0.0 (v2 generation) + zod 4.
 * Signatures verified against the installed .d.mts, not against a blog post.
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
  type Product,
} from "../../app/dist/index.js";

const server = new McpServer({
  name: "catalog-server",
  version: "1.0.0",
});

/**
 * Every tool here only reads. Declaring it in `annotations` makes that
 * machine-readable: the host can show these as non-mutating instead of taking
 * our word for it in a README. Same mechanism the filesystem server uses to
 * flag `write_file` as destructive — see docs/mcp/servers.md.
 */
const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

/** One product as a single line. Shared so tool outputs stay consistent. */
const line = (p: Product) =>
  `${p.sku} — ${p.name} (${p.category}) · ${p.price} · stock ${p.stock}`;

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

// ── Tool 1 ────────────────────────────────────────────────────────────────
// The DESCRIPTION is what the model reads to decide whether to call this.
// Say WHEN to use it, not just what it is — same lesson as a SKILL.md
// description in Workshop 5. Vague description => the tool never fires.
server.registerTool(
  "search_inventory",
  {
    title: "Search inventory",
    description:
      "Search the product catalog by name, SKU, or category. Use when the " +
      "user asks what products exist or asks about a specific item.",
    annotations: READ_ONLY,
    inputSchema: z.object({
      query: z
        .string()
        .describe("Free-text match on product name, SKU, or category"),
    }),
  },
  async ({ query }) => {
    const results = searchProducts(loadCatalog(), query);
    return text(
      results.length === 0
        ? `No products matched "${query}".`
        : results.map(line).join("\n"),
    );
  },
);

// ── Tool 2 ────────────────────────────────────────────────────────────────
server.registerTool(
  "check_stock",
  {
    title: "Check stock for one SKU",
    description:
      "Look up a single product by its exact SKU (format XX-9999) and report " +
      "how many units are on hand versus its reorder level. Use when the user " +
      "names a specific SKU and wants to know if it needs restocking.",
    annotations: READ_ONLY,
    inputSchema: z.object({
      sku: z.string().describe("Exact product SKU, e.g. KB-1001"),
    }),
  },
  async ({ sku }) => {
    const catalog = loadCatalog();
    const product = findBySku(catalog, sku);
    if (!product) return text(`No product with SKU "${sku}".`);

    // Ask the domain whether this SKU needs reordering instead of re-testing
    // `stock <= reorderLevel` here. Two copies of that rule would drift the
    // moment the domain changed its criterion, and `check_stock` would then
    // disagree with `low_stock` about the same SKU.
    //
    // Deliberately NOT solved by adding a `needsReorder()` export to
    // app/src/catalog.ts. That file is seeded domain code: AGENTS.md freezes its
    // exported signatures, .coderabbit.yaml says of app/src/** that it "НЕ мав
    // змінюватись", and app/AGENTS.md would additionally require a colocated case
    // in catalog.test.ts. That is two protected files edited to replace one `.some()`
    // call. Reusing `lowStock` gives the same single source of truth for the rule
    // at zero cost there, which is why this is the chosen form rather than a
    // workaround. Enforced by `npm run smoke` (ids 6 and 7).
    const needsReorder = lowStock(catalog).some((p) => p.sku === product.sku);
    const status = needsReorder
      ? `NEEDS REORDER — reorder level ${product.reorderLevel}`
      : `OK — ${product.stock - product.reorderLevel} units above its reorder level (${product.reorderLevel})`;

    return text(`${line(product)}\n${status}`);
  },
);

// ── Tool 3 ────────────────────────────────────────────────────────────────
server.registerTool(
  "low_stock",
  {
    title: "List products needing reorder",
    description:
      "List every product whose stock is at or below its reorder level, " +
      "lowest stock first. Use when the user asks what needs reordering, " +
      "what is running low, or what to restock. Takes no arguments.",
    annotations: READ_ONLY,
    // Explicit empty schema, not an omitted one: the host then advertises
    // `{"type":"object","properties":{}}` instead of no schema at all, so a
    // client can tell "this tool takes nothing" from "this tool declared
    // nothing". Same reason `additionalProperties` matters — an absent
    // contract is not the same as an empty one.
    inputSchema: z.object({}),
  },
  async () => {
    const items = lowStock(loadCatalog());
    return text(
      items.length === 0
        ? "Nothing is at or below its reorder level."
        : `${items.length} product(s) need reordering:\n` +
            items
              .map((p) => `${line(p)} · reorder level ${p.reorderLevel}`)
              .join("\n"),
    );
  },
);

// ── Tool 4 ────────────────────────────────────────────────────────────────
server.registerTool(
  "inventory_value",
  {
    title: "Total inventory value",
    description:
      "Compute the total value of all stock currently held, as " +
      "sum(price × stock) across every product, rounded to cents. Use when " +
      "the user asks what the inventory is worth or how much capital is tied " +
      "up in stock. Takes no arguments.",
    annotations: READ_ONLY,
    inputSchema: z.object({}),
  },
  async () => {
    const catalog = loadCatalog();
    return text(
      `Total inventory value: ${inventoryValue(catalog)} across ${catalog.length} products.`,
    );
  },
);

// ── Resource ──────────────────────────────────────────────────────────────
// A resource is APPLICATION-controlled context read by URI — unlike a tool,
// the model does not invoke it. It answers "what is the state of the catalog"
// so a client can show that without spending a tool call. The A/B question is
// deliberately NOT dependent on this: hosts differ in whether they read
// resources at all, and that would confound Task D.
server.registerResource(
  "catalog-summary",
  "inventory://catalog",
  {
    title: "Catalog summary",
    description:
      "Current shape of the catalog: product count, categories, how many " +
      "items need reordering, and total stock value.",
    mimeType: "application/json",
  },
  async (uri) => {
    const catalog = loadCatalog();
    const summary = {
      products: catalog.length,
      categories: categories(catalog),
      needsReorder: lowStock(catalog).length,
      totalValue: inventoryValue(catalog),
    };
    return {
      contents: [
        { uri: uri.href, mimeType: "application/json", text: JSON.stringify(summary, null, 2) },
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

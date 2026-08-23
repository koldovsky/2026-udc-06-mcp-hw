/**
 * Integration tests for catalog-server.
 *
 * They start the real compiled server as a child process and talk to it over
 * stdio, the same way a host does. Nothing is stubbed: if the protocol shape,
 * the tool schemas, or the numbers are wrong, these fail.
 *
 * Expected values are computed from `app/data/catalog.json` rather than
 * hardcoded, so the tests assert that the server agrees with the seeded data
 * — not that it agrees with a number someone typed here once.
 *
 * Run: npm test (requires `npm run build` in app/ and here first).
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, cpSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

import { startServer } from "./client.js";

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(here, "../dist/server.js");
const repoRoot = resolve(here, "../..");

const catalog = JSON.parse(
  readFileSync(resolve(repoRoot, "app/data/catalog.json"), "utf8"),
);
const expected = {
  productCount: catalog.length,
  lowStock: catalog.filter((p) => p.stock <= p.reorderLevel),
  inventoryValue:
    Math.round(catalog.reduce((sum, p) => sum + p.price * p.stock, 0) * 100) / 100,
  categories: [...new Set(catalog.map((p) => p.category))].sort(),
};

let client;

before(async () => {
  client = await startServer(serverEntry);
});

after(async () => {
  await client?.close();
});

test("completes the MCP handshake and identifies itself", () => {
  assert.equal(client.initialized.result.serverInfo.name, "catalog-server");
});

test("logs its banner to stderr, keeping stdout clean for the protocol", () => {
  // A single console.log in a stdio server corrupts the JSON-RPC stream. The
  // handshake above already parsed, which is the other half of this check.
  assert.match(client.stderr(), /catalog-server ready on stdio \(read-only\)/);
});

test("the harness names a corrupted stdout stream instead of timing out", async () => {
  // Guards the guard: the stderr assertion above is only meaningful if a server
  // that DID print to stdout failed loudly. Before this, a stray console.log
  // threw inside a readline callback and every call died of a 10s timeout with
  // no cause named — the slowest possible way to learn the protocol stream is
  // broken. The fixture prints the banner to stdout on purpose.
  await assert.rejects(
    startServer(resolve(here, "noisy-server.fixture.mjs")),
    /non-JSON line on the server's stdout/,
  );
});

test("exposes four read-only tools, each with a description and a schema", async () => {
  const { result } = await client.call("tools/list");
  const byName = Object.fromEntries(result.tools.map((t) => [t.name, t]));

  assert.deepEqual(Object.keys(byName).sort(), [
    "check_stock",
    "inventory_value",
    "low_stock",
    "search_inventory",
  ]);

  for (const tool of result.tools) {
    // The description is what the model reads to decide whether to call the
    // tool; a vague or missing one means the tool is never invoked.
    assert.ok(tool.description.length > 40, `${tool.name} needs a real description`);
    assert.equal(tool.inputSchema.type, "object");
    // Read-only is the guardrail of this homework, asserted rather than assumed.
    assert.equal(tool.annotations.readOnlyHint, true, `${tool.name} must be read-only`);
    assert.equal(tool.annotations.openWorldHint, false, `${tool.name} is local-only`);
  }

  // `query` is deliberately optional: the tool description promises that an
  // empty query lists the whole catalog, so requiring the argument would
  // contradict it (MCP Inspector, Task E).
  assert.equal(byName.search_inventory.inputSchema.required, undefined);
  assert.equal(byName.search_inventory.inputSchema.properties.query.default, "");
  assert.deepEqual(byName.check_stock.inputSchema.required, ["sku"]);
  assert.equal(byName.low_stock.inputSchema.required, undefined);
  assert.equal(byName.inventory_value.inputSchema.required, undefined);
});

test("exposes no tool that could write, delete, or fetch", async () => {
  // Two checks, because neither alone is worth much. The name pattern is a
  // heuristic — it would not catch a mutating tool called `sync_all` — so the
  // binding assertion is the allow-list below: the exposed surface must be
  // exactly the four known read-only tools. A new tool of any name fails this
  // test and has to be added deliberately, which is the point.
  const { result } = await client.call("tools/list");
  const forbidden = /write|create|update|delete|remove|move|fetch|post|set_/i;
  for (const tool of result.tools) {
    assert.doesNotMatch(tool.name, forbidden);
  }
  assert.deepEqual(
    result.tools.map((t) => t.name).sort(),
    ["check_stock", "inventory_value", "low_stock", "search_inventory"],
    "the exposed tool surface changed — confirm the new tool is read-only",
  );
});

test("declares no capability that could mutate anything", async () => {
  // The other half of the guardrail: a server that never advertises `tools` it
  // does not have, and — more to the point — never advertises the write-shaped
  // capabilities of the protocol. `prompts` and `logging` are absent; what
  // remains is `tools` and `resources`, both read paths here.
  const { capabilities } = client.initialized.result;
  assert.ok(capabilities.tools, "tools capability expected");
  assert.ok(capabilities.resources, "resources capability expected");
  // A resource server that offered subscriptions would be inviting the host to
  // hold state on our behalf; this one serves a static snapshot.
  assert.notEqual(capabilities.resources.subscribe, true);
});

test("exposes the catalog summary resource", async () => {
  const { result } = await client.call("resources/list");
  assert.equal(result.resources.length, 1);
  assert.equal(result.resources[0].uri, "inventory://catalog");
  assert.equal(result.resources[0].mimeType, "application/json");
});

test("resource reports the aggregates that match the seeded data", async () => {
  const { result } = await client.call("resources/read", {
    uri: "inventory://catalog",
  });
  const summary = JSON.parse(result.contents[0].text);

  assert.equal(summary.productCount, expected.productCount);
  assert.equal(summary.inventoryValue, expected.inventoryValue);
  assert.equal(summary.lowStockCount, expected.lowStock.length);
  assert.deepEqual(summary.categories, expected.categories);
});

test("low_stock lists exactly the items at or below their reorder level", async () => {
  const { result } = await client.call("tools/call", {
    name: "low_stock",
    arguments: {},
  });

  assert.notEqual(result.isError, true);
  const text = result.content[0].text;
  assert.match(text, new RegExp(`^${expected.lowStock.length} product\\(s\\) need reordering`));
  for (const product of expected.lowStock) {
    assert.ok(text.includes(product.sku), `${product.sku} missing from low_stock`);
  }
  // And nothing that is comfortably stocked leaked in.
  const healthy = catalog.filter((p) => p.stock > p.reorderLevel);
  for (const product of healthy) {
    assert.ok(!text.includes(product.sku), `${product.sku} should not be low on stock`);
  }
});

test("inventory_value serves the total instead of leaving it to be summed", async () => {
  // The point of this tool: the number arrives computed, so no caller has to
  // add up 24 rows of a search result. Compared against the seeded data, not
  // against a constant.
  const { result } = await client.call("tools/call", {
    name: "inventory_value",
    arguments: {},
  });

  assert.notEqual(result.isError, true);
  const text = result.content[0].text;
  assert.ok(
    text.includes(String(expected.inventoryValue)),
    `expected the total ${expected.inventoryValue} in: ${text}`,
  );
  assert.ok(text.includes(String(expected.productCount)));
});

test("search_inventory with an empty query returns the whole catalog", async () => {
  const { result } = await client.call("tools/call", {
    name: "search_inventory",
    arguments: { query: "" },
  });
  assert.match(
    result.content[0].text,
    new RegExp(`^Whole catalog \\(${expected.productCount} product\\(s\\)\\)`),
  );
});

// Regression for the defect MCP Inspector surfaced in Task E: `query` used to
// be required, so a call with no arguments failed validation before reaching
// the handler, contradicting the tool's own description.
test("search_inventory works with no arguments at all", async () => {
  const { result } = await client.call("tools/call", {
    name: "search_inventory",
    arguments: {},
  });
  assert.notEqual(result.isError, true);
  assert.match(
    result.content[0].text,
    new RegExp(`^Whole catalog \\(${expected.productCount} product\\(s\\)\\)`),
  );
});

test("search_inventory matches on category, case-insensitively", async () => {
  const category = expected.categories[0];
  const inCategory = catalog.filter((p) => p.category === category);

  const { result } = await client.call("tools/call", {
    name: "search_inventory",
    arguments: { query: category.toUpperCase() },
  });
  const text = result.content[0].text;
  for (const product of inCategory) {
    assert.ok(text.includes(product.sku), `${product.sku} missing from ${category}`);
  }
});

test("search_inventory says so plainly when nothing matches", async () => {
  const { result } = await client.call("tools/call", {
    name: "search_inventory",
    arguments: { query: "definitely-not-a-product" },
  });
  assert.match(result.content[0].text, /No products matched/);
});

test("check_stock reports one SKU against its reorder level", async () => {
  const product = expected.lowStock[0] ?? catalog[0];
  const { result } = await client.call("tools/call", {
    name: "check_stock",
    arguments: { sku: product.sku.toLowerCase() }, // lookup is case-insensitive
  });

  const text = result.content[0].text;
  assert.ok(text.includes(product.sku));
  assert.match(text, new RegExp(`Needs reordering: ${product.stock <= product.reorderLevel ? "yes" : "no"}`));
});

test("check_stock on an unknown SKU is an answer, not a failure", async () => {
  const { result } = await client.call("tools/call", {
    name: "check_stock",
    arguments: { sku: "ZZ-0000" },
  });
  assert.notEqual(result.isError, true);
  assert.match(result.content[0].text, /No product with SKU "ZZ-0000"/);
});

test("a bad argument is rejected by the schema, not by the handler", async () => {
  const response = await client.call("tools/call", {
    name: "check_stock",
    arguments: { sku: 42 },
  });

  // "It failed somehow" is too weak an assertion for this test's own claim:
  // it would stay green if validation were removed and the handler threw into
  // the guard instead. So check WHERE it failed. Validation says
  // "Input validation error: ..."; the guard says "could not read the catalog".
  const text = response.result?.content?.[0]?.text ?? response.error?.message ?? "";
  assert.match(text, /validation/i, `expected a schema rejection, got: ${text}`);
  assert.doesNotMatch(
    text,
    /could not read the catalog/,
    "reached the guard, so the handler ran — the schema did not reject it",
  );
});

test("a missing required argument is rejected by the schema, not read as undefined", async () => {
  // The mirror of the test above: `check_stock` requires `sku`, so a call that
  // supplies only some other key must be stopped by validation rather than
  // reaching a handler that would read `undefined`.
  //
  // Note what this does NOT assert: the unknown key `skew` is not what makes
  // the call fail. Zod objects strip unknown keys by default, so the schema
  // rejects this for the missing `sku` alone. Asserting that extra keys are
  // refused would need `.strict()` on the schema (`additionalProperties: false`
  // in the published contract), which is deliberately not the case here.
  const response = await client.call("tools/call", {
    name: "check_stock",
    arguments: { skew: "KB-1001" },
  });
  const text = response.result?.content?.[0]?.text ?? response.error?.message ?? "";
  assert.match(text, /validation/i, `expected a schema rejection, got: ${text}`);
});

test("a missing catalog file comes back as a readable tool error", async (t) => {
  // Runs the compiled server against a tree with no app/data, which is what a
  // fresh clone that never ran `npm run build` in app/ effectively looks like.
  // Without the guard in the handler this surfaces as a protocol-level crash.
  // The sandbox is created INSIDE `mcp-server/` rather than in the OS temp
  // directory, and that placement is the whole trick. The copied server still
  // has to resolve `@modelcontextprotocol/server`, and Node finds it by walking
  // ancestors looking for `node_modules` — from `<sandbox>/mcp-server/dist` that
  // walk reaches the real `mcp-server/node_modules`. So no copy of a 39 MB
  // tree, and no symlink either: the earlier version symlinked `node_modules`,
  // which needs administrator rights or Developer Mode on Windows and fails
  // there with EPERM. (`NODE_PATH` is not an option — ESM ignores it.)
  const sandbox = mkdtempSync(resolve(here, "..", ".sandbox-"));
  t.after(() => rmSync(sandbox, { recursive: true, force: true }));

  // `app/dist` is copied, `app/data` deliberately is not: `loadCatalog()`
  // resolves the JSON from its own module URL, so inside the sandbox it looks
  // for a `app/data/catalog.json` that was never created.
  cpSync(resolve(repoRoot, "app/dist"), join(sandbox, "app/dist"), { recursive: true });
  cpSync(resolve(here, "../dist"), join(sandbox, "mcp-server/dist"), { recursive: true });

  const broken = await startServer(join(sandbox, "mcp-server/dist/server.js"));
  t.after(() => broken.close());

  const { result } = await broken.call("tools/call", {
    name: "low_stock",
    arguments: {},
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /could not read the catalog/);
  assert.match(result.content[0].text, /npm run build/);
});

test("a malformed catalog is reported without the rebuild advice", async (t) => {
  // The counterpart of the test above, and the reason the guard inspects the
  // error instead of appending one remedy to all of them. A corrupt
  // catalog.json is a SyntaxError; telling the model to rebuild app/ would send
  // it to repair something that is not broken.
  const sandbox = mkdtempSync(resolve(here, "..", ".sandbox-"));
  t.after(() => rmSync(sandbox, { recursive: true, force: true }));

  cpSync(resolve(repoRoot, "app/dist"), join(sandbox, "app/dist"), { recursive: true });
  cpSync(resolve(here, "../dist"), join(sandbox, "mcp-server/dist"), { recursive: true });
  mkdirSync(join(sandbox, "app/data"), { recursive: true });
  writeFileSync(join(sandbox, "app/data/catalog.json"), "{ this is not json", "utf8");

  const broken = await startServer(join(sandbox, "mcp-server/dist/server.js"));
  t.after(() => broken.close());

  const { result } = await broken.call("tools/call", {
    name: "low_stock",
    arguments: {},
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /could not read the catalog/);
  assert.doesNotMatch(
    result.content[0].text,
    /npm run build/,
    "a parse error is not fixed by rebuilding app/",
  );
});

// Smoke check: drive the built server over real stdio and assert its answers
// match the domain functions. Catches the two ways this breaks — app/dist not
// built, and SDK API drift silently changing the response shape.
//
// Follows the MCP lifecycle: nothing is sent until `initialize` is answered, and
// the test finishes when the last response arrives. The timer is only a failure
// path, never the thing that decides the test passed.
//
// Run: npm run smoke
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { loadCatalog, lowStock, inventoryValue } from "../app/dist/index.js";

const FAIL_AFTER_MS = 15_000;
const PENDING = [2, 3, 4, 5, 6, 7];

const srv = spawn("node", ["./dist/server.js"], { cwd: import.meta.dirname });
srv.stderr.on("data", (d) => process.stderr.write(d));

const send = (msg) => srv.stdin.write(JSON.stringify(msg) + "\n");
const rpc = (id, method, params) => send({ jsonrpc: "2.0", id, method, params });

const results = new Map();
let done = false;
let lowSku, okSku;

function fail(why) {
  console.error(`smoke failed: ${why}`);
  srv.kill();
  process.exit(1);
}

const timer = setTimeout(
  () => fail(`no complete response set after ${FAIL_AFTER_MS} ms`),
  FAIL_AFTER_MS,
);

srv.on("exit", (code) => {
  if (!done) fail(`server exited before answering, code ${code}`);
});

// The connection is initialized only once id 1 comes back. Sending tools/call
// before that is a protocol violation, even when it happens to work.
function onInitializeAnswered() {
  const catalog = loadCatalog();
  const low = lowStock(catalog).map((p) => p.sku);
  // One SKU the domain says needs reordering and one it says does not, so
  // check_stock is pinned to low_stock instead of to its own copy of the rule.
  lowSku = low[0];
  okSku = catalog.find((p) => !low.includes(p.sku))?.sku;
  assert.ok(lowSku && okSku, "fixture needs one low-stock and one healthy SKU");

  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  rpc(2, "tools/list", {});
  rpc(3, "tools/call", { name: "low_stock", arguments: {} });
  rpc(4, "tools/call", { name: "inventory_value", arguments: {} });
  rpc(5, "resources/read", { uri: "inventory://catalog" });
  rpc(6, "tools/call", { name: "check_stock", arguments: { sku: lowSku } });
  rpc(7, "tools/call", { name: "check_stock", arguments: { sku: okSku } });
}

function checkAndFinish() {
  done = true;
  clearTimeout(timer);

  const catalog = loadCatalog();
  const expectedSkus = lowStock(catalog).map((p) => p.sku);
  const expectedValue = inventoryValue(catalog);

  const names = results.get(2).tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["check_stock", "inventory_value", "low_stock", "search_inventory"]);
  assert.ok(
    results.get(2).tools.every((t) => t.annotations?.readOnlyHint === true),
    "every tool must be read-only",
  );

  const lowText = results.get(3).content[0].text;
  for (const sku of expectedSkus) assert.ok(lowText.includes(sku), `low_stock missing ${sku}`);
  assert.ok(lowText.includes(`${expectedSkus.length} product(s)`));

  assert.ok(results.get(4).content[0].text.includes(String(expectedValue)), "inventory_value mismatch");

  const summary = JSON.parse(results.get(5).contents[0].text);
  assert.equal(summary.products, catalog.length);
  assert.equal(summary.totalValue, expectedValue);
  assert.equal(summary.needsReorder, expectedSkus.length);

  // check_stock must agree with low_stock about the same SKU. This fails if the
  // reorder rule ever gets re-implemented in the server instead of imported.
  assert.match(
    results.get(6).content[0].text,
    /NEEDS REORDER/,
    `check_stock disagrees with low_stock about ${lowSku}`,
  );
  assert.match(
    results.get(7).content[0].text,
    /^OK\b|\nOK\b/,
    `check_stock disagrees with low_stock about ${okSku}`,
  );

  console.log(`ok — 4 tools, all read-only; ${expectedSkus.length} low-stock SKUs; value ${expectedValue}; check_stock agrees with low_stock`);
  srv.kill();
  process.exit(0);
}

let buf = "";
srv.stdout.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (!line.trim()) continue;

    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue; // not a protocol line
    }

    if (msg.error) fail(`id ${msg.id} returned an error: ${msg.error.message}`);
    if (msg.id === 1) {
      onInitializeAnswered();
      continue;
    }
    if (msg.id !== undefined) results.set(msg.id, msg.result);
    if (PENDING.every((id) => results.has(id))) checkAndFinish();
  }
});

rpc(1, "initialize", {
  protocolVersion: "2025-11-25",
  capabilities: {},
  clientInfo: { name: "smoke", version: "1" },
});

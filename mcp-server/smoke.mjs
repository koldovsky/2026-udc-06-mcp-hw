// Smoke check: drive the built server over real stdio and assert its answers
// match the domain functions. Catches the two ways this breaks — app/dist not
// built, and SDK API drift silently changing the response shape.
// Run: npm run smoke
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { loadCatalog, lowStock, inventoryValue } from "../app/dist/index.js";

const rpc = (id, method, params) =>
  JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";

const srv = spawn("node", ["./dist/server.js"], { cwd: import.meta.dirname });
srv.stdin.write(
  rpc(1, "initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "smoke", version: "1" },
  }) +
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
    "\n" +
    rpc(2, "tools/list", {}) +
    rpc(3, "tools/call", { name: "low_stock", arguments: {} }) +
    rpc(4, "tools/call", { name: "inventory_value", arguments: {} }) +
    rpc(5, "resources/read", { uri: "inventory://catalog" }),
);

let buf = "";
srv.stdout.on("data", (d) => (buf += d));
srv.stderr.on("data", (d) => process.stderr.write(d));

setTimeout(() => {
  srv.kill();
  const res = new Map();
  for (const l of buf.split("\n")) {
    if (l.trim()) try { const m = JSON.parse(l); if (m.id) res.set(m.id, m.result); } catch {}
  }

  const catalog = loadCatalog();
  const expectedSkus = lowStock(catalog).map((p) => p.sku);
  const expectedValue = inventoryValue(catalog);

  const names = res.get(2).tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["check_stock", "inventory_value", "low_stock", "search_inventory"]);
  assert.ok(res.get(2).tools.every((t) => t.annotations?.readOnlyHint === true), "every tool must be read-only");

  const lowText = res.get(3).content[0].text;
  for (const sku of expectedSkus) assert.ok(lowText.includes(sku), `low_stock missing ${sku}`);
  assert.ok(lowText.includes(`${expectedSkus.length} product(s)`));

  assert.ok(res.get(4).content[0].text.includes(String(expectedValue)), "inventory_value mismatch");

  const summary = JSON.parse(res.get(5).contents[0].text);
  assert.equal(summary.products, catalog.length);
  assert.equal(summary.totalValue, expectedValue);
  assert.equal(summary.needsReorder, expectedSkus.length);

  console.log(`ok — 4 tools, all read-only; ${expectedSkus.length} low-stock SKUs; value ${expectedValue}`);
}, 1500);

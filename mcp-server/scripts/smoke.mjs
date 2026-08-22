#!/usr/bin/env node
// TEST HARNESS — not part of the MCP server surface. It spawns dist/server.js
// as a child process to drive the JSON-RPC handshake; the server itself never
// spawns anything, writes anything, or opens a socket.
/**
 * Smoke test for dist/server.js over raw stdio — no host, no Inspector.
 *
 * Spawns the server, drives the JSON-RPC handshake, then checks that the
 * tools/resources it advertises and the answers it gives match the seeded
 * catalog. Exits non-zero on the first failed assertion. Read-only: it only
 * sends requests and reads responses.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(here, "../dist/server.js");

const requests = [
  { id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "smoke", version: "1" } } },
  { method: "notifications/initialized" },
  { id: 2, method: "tools/list" },
  { id: 3, method: "tools/call", params: { name: "low_stock", arguments: {} } },
  { id: 4, method: "tools/call", params: { name: "check_stock", arguments: { sku: "ms-2001" } } },
  { id: 5, method: "tools/call", params: { name: "check_stock", arguments: { sku: "ZZ-9999" } } },
  { id: 6, method: "tools/call", params: { name: "check_stock", arguments: { sku: "nope" } } },
  { id: 7, method: "tools/call", params: { name: "search_inventory", arguments: { query: "", limit: 100 } } },
  { id: 8, method: "resources/list" },
  { id: 9, method: "resources/templates/list" },
  { id: 10, method: "resources/read", params: { uri: "inventory://catalog" } },
  { id: 11, method: "resources/read", params: { uri: "inventory://category/toys" } },
];

const child = spawn(process.execPath, [serverPath], { stdio: ["pipe", "pipe", "inherit"] });
let out = "";
child.stdout.on("data", (c) => (out += c));
child.stdin.write(requests.map((r) => JSON.stringify({ jsonrpc: "2.0", ...r })).join("\n") + "\n");
child.stdin.end();

await new Promise((res) => child.on("close", res));

const byId = new Map(
  out
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((m) => m.id !== undefined)
    .map((m) => [m.id, m]),
);
const result = (id) => {
  const m = byId.get(id);
  assert.ok(m, `no response for id ${id}`);
  return m;
};

const checks = [];
const check = (name, fn) => {
  try {
    fn();
    checks.push(`ok   ${name}`);
  } catch (e) {
    checks.push(`FAIL ${name}: ${e.message}`);
    process.exitCode = 1;
  }
};

check("initialize", () => assert.equal(result(1).result.serverInfo.name, "catalog-server"));
check("3 tools, all readOnlyHint", () => {
  const tools = result(2).result.tools;
  assert.deepEqual(tools.map((t) => t.name).sort(), ["check_stock", "low_stock", "search_inventory"]);
  for (const t of tools) {
    assert.ok(t.description?.length > 40, `${t.name} description too short`);
    assert.equal(t.annotations?.readOnlyHint, true, `${t.name} not readOnlyHint`);
    assert.equal(t.inputSchema?.type, "object", `${t.name} has no object inputSchema`);
  }
});
check("low_stock → 9 SKUs, total 46152", () => {
  const s = result(3).result.structuredContent;
  assert.equal(s.count, 9);
  assert.deepEqual(s.skus, ["DK-4001", "WC-8002", "DS-6002", "MS-2001", "MN-3002", "HS-5002", "SS-1102", "KB-1002", "CB-7003"]);
  assert.equal(s.totalInventoryValue, 46152);
});
check("check_stock ms-2001 → needsReorder (case-insensitive)", () => {
  const s = result(4).result.structuredContent;
  assert.equal(s.found, true);
  assert.equal(s.sku, "MS-2001");
  assert.equal(s.needsReorder, true);
  assert.equal(s.unitsBelowReorderLevel, 17);
});
check("check_stock ZZ-9999 → isError + found:false", () => {
  const r = result(5).result;
  assert.equal(r.isError, true);
  assert.equal(r.structuredContent.found, false);
});
check("check_stock 'nope' → schema validation error", () => {
  const r = result(6).result;
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /XX-9999/);
});
check("search_inventory '' → all 24", () => {
  const s = result(7).result.structuredContent;
  assert.equal(s.totalMatches, 24);
  assert.equal(s.products.length, 24);
});
check("resources/list → 2 static + 7 categories", () => {
  const uris = result(8).result.resources.map((r) => r.uri);
  assert.ok(uris.includes("inventory://catalog"));
  assert.ok(uris.includes("inventory://catalog/products"));
  assert.equal(uris.filter((u) => u.startsWith("inventory://category/")).length, 7);
});
check("resources/templates/list → category template", () => {
  assert.deepEqual(
    result(9).result.resourceTemplates.map((t) => t.uriTemplate),
    ["inventory://category/{category}"],
  );
});
check("inventory://catalog summary", () => {
  const s = JSON.parse(result(10).result.contents[0].text);
  assert.equal(s.productCount, 24);
  assert.equal(s.totalInventoryValue, 46152);
  assert.equal(s.lowStockCount, 9);
  assert.equal(s.categories.length, 7);
});
check("unknown category → JSON-RPC error, not empty list", () => {
  const m = result(11);
  assert.ok(m.error, "expected an error response");
  assert.match(m.error.message, /Unknown category "toys"/);
});

console.log(checks.join("\n"));
console.log(process.exitCode ? "\nSMOKE FAILED" : "\nSMOKE OK");

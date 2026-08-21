/**
 * Clone check: does `mcp-server/` actually work here?
 *
 * Speaks JSON-RPC to the server over stdio exactly the way the host does —
 * launched from the repo root, not from `mcp-server/` — and compares what it
 * answers against ground truth computed from `app/dist` in this process.
 *
 * Run: npm run check         (after npm run setup)
 *      npm run probe         same conversation, but dumps the raw JSON-RPC
 *                            frames instead of the pass/fail summary
 *
 * `probe` exists so nobody has to paste shell-specific syntax: the bash
 * `printf ... | node` one-liner is a parse error in PowerShell, and the
 * PowerShell array form is meaningless in bash. This works in both.
 *
 * Exists because the two most common failures are silent: `dist/` is
 * gitignored, so a fresh clone has no server to launch; and a server can start
 * fine while the host still shows no tools. Both look like "nothing happened".
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAW = process.argv.includes("--raw");
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const appEntry = join(root, "app", "dist", "index.js");
const serverEntry = join(root, "mcp-server", "dist", "server.js");

const problems = [];
const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m) => {
  problems.push(m);
  console.log(`  FAIL  ${m}`);
};

// ── 1. Build artifacts ────────────────────────────────────────────────────
console.log("\nBuild artifacts");
if (existsSync(appEntry)) ok("app/dist/index.js");
else bad("app/dist/index.js missing — run `npm run setup:app`");
if (existsSync(serverEntry)) ok("mcp-server/dist/server.js");
else bad("mcp-server/dist/server.js missing — run `npm run setup:server`");

if (problems.length) {
  console.log("\nNothing else can run until the builds exist.\n");
  process.exit(1);
}

// ── 2. Ground truth, computed here rather than hardcoded ──────────────────
const app = await import(`file://${appEntry.replaceAll("\\", "/")}`);
const seeded = app.loadCatalog();
const truth = {
  skus: app.lowStock(seeded).map((p) => p.sku),
  total: app.inventoryValue(seeded),
  count: seeded.length,
};
console.log(
  `\nGround truth from app/dist: ${truth.count} products, ` +
    `${truth.skus.length} need reorder, total ${truth.total}`,
);

// ── 3. Talk to the server the way the host does ───────────────────────────
const rpc = [
  {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "check-mcp", version: "1" },
    },
  },
  { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 2, method: "tools/list" },
  { jsonrpc: "2.0", id: 3, method: "resources/list" },
  { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "low_stock", arguments: {} } },
  {
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "inventory_summary", arguments: {} },
  },
  // 6-8 are argument-taking calls, added after MCP Inspector found two schema
  // defects this check could not see: it only ever called the no-arg tools, so
  // it stayed green while both were live. See docs/task-e-bonus.md.
  // 6 — omitting an optional argument must list everything, not fail (D-1).
  { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "search_inventory", arguments: {} } },
  // 7 — a product name is not a SKU: reject it at the schema, and say so (D-2).
  {
    jsonrpc: "2.0",
    id: 7,
    method: "tools/call",
    params: { name: "check_stock", arguments: { sku: "Mechanical Keyboard TKL" } },
  },
  // 8 — the guard must not reject what findBySku would have accepted.
  {
    jsonrpc: "2.0",
    id: 8,
    method: "tools/call",
    params: { name: "check_stock", arguments: { sku: " kb-1001 " } },
  },
];

// cwd is the repo root on purpose: the server must not depend on being
// launched from its own directory.
const child = spawn(process.execPath, [serverEntry], {
  cwd: root,
  stdio: ["pipe", "pipe", "pipe"],
});

const timer = setTimeout(() => {
  child.kill();
  bad("server did not answer within 15s");
}, 15_000);

const replies = new Map();
let buf = "";
child.stdout.on("data", (chunk) => {
  buf += chunk;
  const lines = buf.split("\n");
  buf = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id != null) replies.set(msg.id, msg);
      if (RAW) console.log(JSON.stringify(msg, null, 2));
    } catch {
      /* partial frame — ignore */
    }
  }
  if (replies.size >= 8) child.stdin.end();
});

child.stdin.write(rpc.map((m) => JSON.stringify(m)).join("\n") + "\n");

await new Promise((resolve) => {
  child.on("close", resolve);
  child.on("error", (e) => {
    bad(`could not launch server: ${e.message}`);
    resolve();
  });
});
clearTimeout(timer);

if (RAW) {
  console.log(`\n${replies.size} frame(s) received.`);
  process.exit(0);
}

// ── 4. Compare ────────────────────────────────────────────────────────────
console.log("\nProtocol");
const tools = replies.get(2)?.result?.tools ?? [];
const resources = replies.get(3)?.result?.resources ?? [];

tools.length >= 2
  ? ok(`tools/list -> ${tools.length} (${tools.map((t) => t.name).join(", ")})`)
  : bad(`tools/list -> ${tools.length}, need at least 2`);

resources.length >= 1
  ? ok(`resources/list -> ${resources.length} (${resources.map((r) => r.uri).join(", ")})`)
  : bad(`resources/list -> ${resources.length}, need at least 1`);

const missingSchema = tools.filter((t) => !t.description || !t.inputSchema);
missingSchema.length === 0
  ? ok("every tool has a description and an input schema")
  : bad(`missing description/inputSchema: ${missingSchema.map((t) => t.name).join(", ")}`);

const writable = tools.filter((t) => t.annotations?.readOnlyHint !== true);
writable.length === 0
  ? ok("every tool declares readOnlyHint: true")
  : bad(`not marked read-only: ${writable.map((t) => t.name).join(", ")}`);

console.log("\nAnswers vs ground truth");
const low = replies.get(4)?.result?.structuredContent;
const sum = replies.get(5)?.result?.structuredContent;

const sameSkus =
  Array.isArray(low?.skus) && low.skus.join(",") === truth.skus.join(",");
sameSkus
  ? ok(`low_stock -> ${low.skus.length} SKUs, matching`)
  : bad(`low_stock -> ${JSON.stringify(low?.skus)}, expected ${JSON.stringify(truth.skus)}`);

sum?.totalInventoryValue === truth.total
  ? ok(`inventory_summary -> total ${sum.totalInventoryValue}, matching`)
  : bad(
      `inventory_summary -> total ${sum?.totalInventoryValue}, expected ${truth.total}`,
    );

console.log("\nArgument handling");

// D-1: the description promises an empty query returns everything, so the
// schema has to let the model ask for everything by sending no argument.
const listAll = replies.get(6)?.result;
listAll?.isError !== true && listAll?.structuredContent?.count === truth.count
  ? ok(`search_inventory {} -> all ${truth.count} products`)
  : bad(
      `search_inventory {} -> ${
        listAll?.isError ? "isError, but the description says it lists everything" : `count ${listAll?.structuredContent?.count}, expected ${truth.count}`
      }`,
    );

// D-2: a product name must be refused by the schema — and the refusal has to
// name the tool that does take names, or the model has nowhere to go.
const named = replies.get(7)?.result;
const namedText = named?.content?.[0]?.text ?? "";
named?.isError === true && namedText.includes("search_inventory")
  ? ok("check_stock rejects a product name and points at search_inventory")
  : bad(
      `check_stock with a product name -> ${
        named?.isError === true ? "rejected, but the message does not name search_inventory" : "accepted; the SKU pattern is not being enforced"
      }`,
    );

// The guard must not be stricter than the domain: findBySku trims and
// upper-cases, so " kb-1001 " has to keep working.
const loose = replies.get(8)?.result?.structuredContent;
loose?.found === true && loose?.sku === "KB-1001"
  ? ok("check_stock still accepts ' kb-1001 ' (trimmed, case-insensitive)")
  : bad("check_stock rejects ' kb-1001 ' — the SKU pattern is stricter than findBySku");

// ── 5. Verdict ────────────────────────────────────────────────────────────
if (problems.length) {
  console.log(`\n${problems.length} problem(s). See mcp-server/README.md.\n`);
  process.exit(1);
}
console.log("\nAll good — the server runs and its numbers match the catalog.");
console.log(
  "Note: the host reads .mcp.json at startup, so restart it before expecting\n" +
    "the catalog tools to appear. The server name must also be listed in\n" +
    ".claude/settings.json -> enabledMcpjsonServers.\n",
);

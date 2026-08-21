/**
 * Bypass tests for scripts/fs-proxy.mjs.
 *
 * The child is deliberately launched with the WHOLE REPO as its allowed
 * directory — that mirrors what this host actually does via `roots` (see
 * docs/mcp/SECURITY.md, T-2). If the child were scoped to app/data, it would
 * refuse `.env` by itself and these tests would prove nothing about the proxy.
 *
 * Each case is a bypass that has been a real CVE class somewhere.
 *
 * Run: npm run test:proxy
 */

import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const catalog = join(root, "app", "data", "catalog.json");
const dotenv = join(root, ".env");

/**
 * 8.3 short form of a DIRECTORY, or null. `.env` is short enough to have no
 * distinct short name, but `2026-udc-06-mcp-hw` does — so the interesting
 * bypass is a short name in a path *component*.
 */
function shortDir(dir) {
  if (process.platform !== "win32") return null;
  try {
    const out = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `(New-Object -ComObject Scripting.FileSystemObject).GetFolder([string]$env:TARGET).ShortPath`,
      ],
      { encoding: "utf8", env: { ...process.env, TARGET: dir } },
    ).trim();
    return out && out.toLowerCase() !== dir.toLowerCase() ? out : null;
  } catch {
    return null;
  }
}

const cases = [
  ["allowed file, as given", "read_text_file", { path: catalog }, "pass"],
  ["allowed file, upper-case", "read_text_file", { path: catalog.toUpperCase() }, "pass"],
  ["the secret, directly", "read_text_file", { path: dotenv }, "deny"],
  [
    "traversal out of app/data",
    "read_text_file",
    { path: join(root, "app", "data", "..", "..", ".env") },
    "deny",
  ],
  ["relative traversal", "read_text_file", { path: "./app/data/../../.env" }, "deny"],
  ["device path form", "read_text_file", { path: `\\\\?\\${dotenv}` }, "deny"],
  ["host settings", "read_text_file", { path: join(root, ".claude", "settings.json") }, "deny"],
  ["git internals", "read_text_file", { path: join(root, ".git", "config") }, "deny"],
  ["a write tool", "write_file", { path: catalog, content: "x" }, "deny"],
  ["a recursive reader", "directory_tree", { path: root }, "deny"],
  ["nonexistent path", "read_text_file", { path: join(root, "nope.txt") }, "deny"],
];

const shortRoot = shortDir(root);
if (shortRoot) {
  cases.push([
    "8.3 short name in path",
    "read_text_file",
    { path: join(shortRoot, ".env") },
    "deny",
  ]);
  // The same trick aimed at the ALLOWED file must still be permitted: the
  // check has to normalise, not merely string-compare.
  cases.push([
    "8.3 short name, allowed file",
    "read_text_file",
    { path: join(shortRoot, "app", "data", "catalog.json") },
    "pass",
  ]);
} else {
  console.log("(8.3 short names unavailable on this volume — cases skipped)");
}

const proxy = spawn(
  process.execPath,
  [
    join(root, "scripts", "fs-proxy.mjs"),
    "--allow",
    catalog,
    "--",
    // Same launch shape as .mcp.json: a JS entry point, so the proxy takes its
    // no-shell spawn branch. Launching via `npx` here would exercise a
    // different branch than the one the host actually uses.
    join(root, "node_modules", "@modelcontextprotocol", "server-filesystem", "dist", "index.js"),
    root, // child sees everything; the proxy is the only boundary
  ],
  { stdio: ["pipe", "pipe", "pipe"], cwd: root },
);

let stderr = "";
proxy.stderr.on("data", (d) => (stderr += d));

const replies = new Map();
let buf = "";
proxy.stdout.on("data", (chunk) => {
  buf += chunk;
  const lines = buf.split("\n");
  buf = lines.pop() ?? "";
  for (const l of lines) {
    if (!l.trim().startsWith("{")) continue;
    try {
      const m = JSON.parse(l);
      if (m.id != null) replies.set(m.id, m);
    } catch {
      /* partial */
    }
  }
});

const msgs = [
  {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "proxy-test", version: "1" },
    },
  },
  { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 2, method: "tools/list" },
  ...cases.map(([, name, args], i) => ({
    jsonrpc: "2.0",
    id: 100 + i,
    method: "tools/call",
    params: { name, arguments: args },
  })),
];

proxy.stdin.write(msgs.map((m) => JSON.stringify(m)).join("\n") + "\n");

const expected = 2 + cases.length;
await new Promise((resolve) => {
  const t = setInterval(() => {
    if (replies.size >= expected) {
      clearInterval(t);
      resolve();
    }
  }, 100);
  setTimeout(() => {
    clearInterval(t);
    resolve();
  }, 30_000);
});
proxy.kill();

// ── Report ────────────────────────────────────────────────────────────────
let failed = 0;

const listed = replies.get(2)?.result?.tools ?? [];
const names = listed.map((t) => t.name).sort();
const okList = names.join(",") === "list_allowed_directories,read_text_file";
console.log(`\ntools/list exposes only forwarded tools: ${okList ? "ok" : "FAIL"} (${names})`);
if (!okList) failed++;

// The proxy must spawn the child WITHOUT a shell. Launching through `npx`
// forces shell:true on Windows, and Node then warns that arguments are
// concatenated rather than escaped (DEP0190) — poor form in a component whose
// job is filtering. Asserting on the warning keeps the config from regressing
// to a shell launch without anyone noticing.
const noShell = !/DEP0190/.test(stderr);
console.log(`child spawned without a shell: ${noShell ? "ok" : "FAIL (DEP0190 present)"}`);
if (!noShell) failed++;

console.log("\nBypass attempts");
cases.forEach(([label, , , want], i) => {
  const r = replies.get(100 + i);
  const isError = r?.result?.isError === true;
  const text = r?.result?.content?.[0]?.text ?? "";
  const refusedByProxy = isError && text.startsWith("Refused by fs-proxy:");
  const got = refusedByProxy ? "proxy-denied" : isError ? "child-denied" : "allowed";
  // A "deny" case must be stopped by THIS proxy — a child that happens to refuse
  // it proves nothing about the boundary under test.
  //
  // A "pass" case must actually READ. Accepting `child-denied` here would hide
  // the very failure this file exists to catch: the proxy approving a path and
  // the child then resolving that same string to something else. Whenever the
  // two disagree, the proxy is validating a file the child is not opening — and
  // that gap is exploitable in the direction that matters, too.
  const pass = want === "deny" ? refusedByProxy : got === "allowed";
  if (!pass) failed++;
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${label.padEnd(26)} want=${want} got=${got}`);
});

console.log(
  failed === 0
    ? "\nAll bypass attempts behaved as specified.\n"
    : `\n${failed} case(s) failed.\n`,
);
if (stderr.trim() && failed) console.log("proxy stderr:\n" + stderr);
process.exit(failed === 0 ? 0 : 1);

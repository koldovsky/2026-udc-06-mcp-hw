#!/usr/bin/env node
/**
 * Task D helper — toggles ONLY the custom `catalog` server in the MCP configs.
 *
 *   node scripts/ab-toggle.mjs off   # run B: catalog server removed
 *   node scripts/ab-toggle.mjs on    # run A: catalog server restored
 *   node scripts/ab-toggle.mjs status
 *
 * The two public servers (filesystem, memory) are deliberately left connected
 * in both runs. Otherwise the comparison would be "any data access vs none"
 * instead of "own MCP server vs none", which is not the question Task D asks.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const CATALOG_MCP = {
  command: "node",
  args: ["./mcp-server/dist/server.js"],
  env: {},
};

const CATALOG_VSCODE = {
  type: "stdio",
  command: "node",
  args: ["${workspaceFolder}/mcp-server/dist/server.js"],
};

/** [file, key holding the server map, value to restore] */
const TARGETS = [
  [".mcp.json", "mcpServers", CATALOG_MCP],
  [".vscode/mcp.json", "servers", CATALOG_VSCODE],
];

const mode = process.argv[2];
if (!["on", "off", "status"].includes(mode)) {
  console.error("usage: node scripts/ab-toggle.mjs <on|off|status>");
  process.exit(1);
}

for (const [file, key, value] of TARGETS) {
  const path = resolve(repo, file);
  const json = JSON.parse(readFileSync(path, "utf8"));
  const servers = json[key] ?? {};

  if (mode === "status") {
    console.log(
      `${file.padEnd(18)} catalog=${"catalog" in servers ? "PRESENT" : "absent "}  ` +
        `others=[${Object.keys(servers).filter((k) => k !== "catalog").join(", ")}]`,
    );
    continue;
  }

  if (mode === "off") delete servers.catalog;
  else servers.catalog = value;

  json[key] = servers;
  writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
  console.log(`${file}: catalog ${mode === "off" ? "REMOVED" : "restored"}`);
}

if (mode !== "status") {
  console.log(
    "\n⚠️  Restart the host now. A live session keeps its tool list even after\n" +
      "   the config changes on disk — that stale session is the classic way to\n" +
      "   get a fake A/B result.",
  );
}


#!/usr/bin/env node
/**
 * Launcher for the `memory` MCP server (Task A).
 *
 * Why a launcher instead of one line in `.mcp.json`: the memory server needs
 * an ABSOLUTE `MEMORY_FILE_PATH`. Given a relative one it resolves it against
 * its own package directory in the npx cache — measured, the probe graph
 * landed in
 * `~/.npm/_npx/<hash>/node_modules/@modelcontextprotocol/server-memory/dist/`
 * rather than in this repo. And an absolute path written into a committed
 * config is one contributor's checkout, which nobody else can use unedited.
 *
 * So the path is built here, at startup, from this file's own location. That
 * anchor holds regardless of the host's working directory or environment —
 * unlike `${VAR}` in `.mcp.json`, which the host expands from its OWN
 * environment and which therefore cannot see anything this repo sets.
 *
 * The server is still pinned to an exact version below, for the same reason it
 * was pinned in the config: a floating tag can change the tool set, and with it
 * the privileges, between runs.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const SERVER = "@modelcontextprotocol/server-memory@2026.7.4";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const memoryFile = resolve(repoRoot, ".mcp-memory.json");

// stdio IS the protocol channel here, so it is inherited untouched: anything
// this process wrote to stdout would land in the middle of the JSON-RPC stream.
const child = spawn("npx", ["-y", SERVER], {
  stdio: "inherit",
  env: { ...process.env, MEMORY_FILE_PATH: memoryFile },
  // On Windows `npx` is a .cmd shim, which spawn cannot execute directly.
  shell: process.platform === "win32",
});

child.on("error", (err) => {
  console.error(`mcp-memory launcher could not start npx: ${err.message}`);
  process.exit(1);
});

// A host stops a stdio server by signalling the process it spawned — which is
// this launcher, not the server. Without forwarding, the npx child survives as
// an orphan holding the same graph file, so a restarted host ends up with two
// writers on a store that has no locking. On Windows `npx` runs under a shell,
// which does not relay signals to its grandchild; there the exit below is what
// closes the pipe and the server stops with it.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    child.kill(signal);
    // Do not exit here: the `exit` handler below propagates the child's own
    // status once it is actually gone.
  });
}

child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));

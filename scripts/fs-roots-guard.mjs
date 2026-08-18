#!/usr/bin/env node
/**
 * fs-roots-guard — makes a filesystem MCP server's directory arguments authoritative.
 *
 * WHY. `@modelcontextprotocol/server-filesystem` treats its command-line
 * directories as a fallback. If the client advertises the `roots` capability,
 * the server requests `roots/list` and REPLACES its allowed directories with
 * whatever comes back. Claude Code returns the project root, so the narrow
 * `app/data` argument in `.mcp.json` silently widened to the whole repo. The
 * server offers no flag and no env var to opt out; checked against 2026.7.10,
 * the newest published version.
 *
 * HOW. This proxy sits between host and server on stdio and forwards every byte
 * untouched, except that it deletes `capabilities.roots` from the one
 * `initialize` request. The server then logs "Client does not support MCP Roots,
 * using allowed directories set from server args" and keeps the argument.
 * Nothing else changes: the host sees the same tools, and any later
 * `roots/list_changed` notification is simply never acted on.
 *
 * WHAT THIS IS NOT. It makes the declared scope effective, not enforced. The
 * server still runs with this user's OS privileges and respects its own
 * argument voluntarily. A real boundary needs the process confined, e.g. a
 * container with only the needed directory bind-mounted `ro`. See
 * `docs/mcp/SECURITY.md` §3.8.
 *
 * Usage: node scripts/fs-roots-guard.mjs <command> [args...]
 */
import { spawn } from "node:child_process";

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error("Usage: node scripts/fs-roots-guard.mjs <command> [args...]");
  process.exit(2);
}

const srv = spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"] });
srv.stdout.pipe(process.stdout);
srv.on("exit", (code) => process.exit(code ?? 0));
// Forward EOF, or the server outlives its client and the process lingers.
process.stdin.on("end", () => srv.stdin.end());

// JSON-RPC over stdio is newline-delimited, so buffer until we have whole lines.
let buf = "";
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    let out = line;
    try {
      const msg = JSON.parse(line);
      if (msg.method === "initialize" && msg.params?.capabilities?.roots) {
        delete msg.params.capabilities.roots;
        out = JSON.stringify(msg);
        console.error("[fs-roots-guard] stripped client roots capability");
      }
    } catch {
      // Not JSON — pass through untouched rather than guessing.
    }
    srv.stdin.write(out + "\n");
  }
});

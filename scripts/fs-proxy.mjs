/**
 * MCP policy proxy — restricts a filesystem server to an explicit file allowlist.
 *
 * Sits between the host and `@modelcontextprotocol/server-filesystem`, speaking
 * JSON-RPC on both sides. Every `tools/call` is inspected before it is
 * forwarded; anything touching a path outside the allowlist is refused here and
 * never reaches the child. `tools/list` is rewritten so the model is not even
 * shown tools this proxy would refuse.
 *
 * Usage (from .mcp.json):
 *   node scripts/fs-proxy.mjs --allow <abs-file> -- <command> [args...]
 *
 * WHY THIS EXISTS
 * ------------------------------------------------
 * The server it wraps takes a path argument on nearly every tool, so the
 * boundary has to be enforced by *checking* rather than by *absence*. That is
 * the fragile kind of security: see `enforcePath` below for the six Windows
 * normalisation cases this has to get right, each of which is a real CVE class.
 * The `catalog` server in `mcp-server/` reaches the same goal by having no path
 * parameter at all — nothing to check, nothing to bypass. Prefer that shape.
 *
 * KNOWN LIMITATION — TOCTOU
 * -------------------------
 * Validation happens in this process; the open happens in the child. Between
 * the two, a symlink could be repointed. A proxy cannot close that window: only
 * the process that opens the file can check and open atomically. This is not a
 * bug to be fixed here — it is inherent to filtering from outside.
 *
 * What the proxy CAN remove is the neighbouring path-confusion gap: it forwards
 * the resolved path rather than the caller's spelling, so the child never
 * re-derives a different file from the same string. See `enforce` below.
 */

import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";

// ── CLI ───────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
if (sep === -1) {
  console.error("fs-proxy: expected `--allow <file> ... -- <command> [args]`");
  process.exit(2);
}
const allowArgs = argv.slice(0, sep);
const [command, ...commandArgs] = argv.slice(sep + 1);
if (!command) {
  console.error("fs-proxy: no child command given");
  process.exit(2);
}

/**
 * Canonicalise once, at startup, and fail closed if we cannot.
 *
 * `realpathSync.native` is the load-bearing call: it resolves symlinks and
 * junctions, expands Windows 8.3 short names (`PROGRA~1`), normalises case to
 * the on-disk form, and strips the trailing dots/spaces NTFS silently drops.
 * Doing this on BOTH sides of the comparison is what makes the check sound.
 */
const allowed = new Set();
for (let i = 0; i < allowArgs.length; i++) {
  if (allowArgs[i] !== "--allow") continue;
  const raw = allowArgs[++i];
  try {
    allowed.add(canonical(realpathSync.native(raw)));
  } catch (e) {
    console.error(`fs-proxy: cannot resolve --allow ${raw}: ${e.code ?? e.message}`);
    process.exit(2);
  }
}
if (allowed.size === 0) {
  console.error("fs-proxy: refusing to start with an empty allowlist");
  process.exit(2);
}

/** Windows paths are case-insensitive; compare on one normalised form. */
function canonical(p) {
  return process.platform === "win32" ? p.replace(/\\/g, "/").toLowerCase() : p;
}

// ── Policy ────────────────────────────────────────────────────────────────
// Tools this proxy will forward at all. Everything else is refused and hidden.
// Path-bearing tools are additionally checked against the allowlist.
const FORWARDED = new Set(["read_text_file", "list_allowed_directories"]);

// Argument names that carry a path, per tool. Anything not listed here but
// present in FORWARDED is treated as path-free.
const PATH_ARGS = {
  read_text_file: ["path"],
  read_media_file: ["path"],
  read_multiple_files: ["paths"],
  list_directory: ["path"],
  list_directory_with_sizes: ["path"],
  directory_tree: ["path"],
  search_files: ["path"],
  get_file_info: ["path"],
  write_file: ["path"],
  edit_file: ["path"],
  create_directory: ["path"],
  move_file: ["source", "destination"],
};

/**
 * Validate a call and rewrite its path arguments to their canonical on-disk
 * form.
 *
 * Rewriting is not cosmetic. If we validated one spelling and forwarded
 * another, the child would resolve the string a second time, by its own rules —
 * so the path we approved and the path it opens need not be the same file. That
 * split is the standard way a filtering proxy is bypassed. Handing the child the
 * already-resolved path removes the second resolution entirely: there is only
 * one interpretation left, and it is the one the allowlist matched. It also
 * means an allowed file reads however the caller spelled it (upper-case, 8.3
 * short name, traversal), because the child sees the same canonical string.
 *
 * @returns {{reason: string}|{reason: null, args: object}} refusal reason, or
 *   null plus the arguments to forward.
 */
function enforce(name, args) {
  if (!FORWARDED.has(name)) return { reason: `tool "${name}" is not permitted by the proxy` };

  let out = args;
  for (const key of PATH_ARGS[name] ?? []) {
    const value = args?.[key];
    if (value === undefined) continue;
    const many = Array.isArray(value);
    const resolved = [];
    for (const candidate of many ? value : [value]) {
      if (typeof candidate !== "string") return { reason: `${key} must be a string` };
      let real;
      try {
        // Resolves .., symlinks, junctions, 8.3 names, \\?\ device paths and
        // case. A path that does not exist cannot be validated -> refuse.
        real = realpathSync.native(candidate);
      } catch {
        return { reason: `path is not readable or does not exist: ${candidate}` };
      }
      if (!allowed.has(canonical(real))) {
        return { reason: `path is outside the allowlist: ${candidate}` };
      }
      resolved.push(real); // native form, not the lower-cased compare key
    }
    if (out === args) out = { ...args };
    out[key] = many ? resolved : resolved[0];
  }
  return { reason: null, args: out };
}

// ── Wiring ────────────────────────────────────────────────────────────────
// A JS entry point is run directly by this node — no shell, no PATH lookup,
// no argument re-parsing. That is the preferred form: pass the resolved
// dist/index.js of the wrapped server. `npx` on Windows is a .cmd shim, which
// Node refuses to spawn without a shell (CVE-2024-27980 mitigation), so that
// form falls back to shell:true. Arguments come from this repo's own
// .mcp.json, never from the model.
const isJs = /\.[cm]?js$/i.test(command);
const child = isJs
  ? spawn(process.execPath, [command, ...commandArgs], { stdio: ["pipe", "pipe", "inherit"] })
  : spawn(command, commandArgs, {
      stdio: ["pipe", "pipe", "inherit"],
      shell: process.platform === "win32",
    });
child.on("exit", (code) => {
  // Let queued frames reach the host before leaving. `process.exit` discards
  // whatever is still buffered in stdout, so a refusal or a final response
  // written moments before the child died would vanish and the host would sit
  // out its own timeout instead of seeing the answer. The timer is a floor,
  // not a wait: a stuck pipe must not turn this into a hang.
  const leave = () => process.exit(code ?? 0);
  if (process.stdout.writableLength === 0) leave();
  else {
    process.stdout.once("drain", leave);
    setTimeout(leave, 2000).unref();
  }
});
child.on("error", (e) => {
  console.error(`fs-proxy: cannot launch child: ${e.message}`);
  process.exit(2);
});

// Closing stdin is how a host shuts a stdio MCP server down. Without this the
// EOF stops at the proxy: the child never sees it, both processes survive the
// host restart, and on Windows killing the proxy does not reap the grandchild
// either — so they accumulate, holding this directory open.
process.stdin.on("end", () => child.stdin.end());
process.on("exit", () => {
  if (child.exitCode === null && child.signalCode === null) child.kill();
});

const send = (stream, msg) => stream.write(JSON.stringify(msg) + "\n");

function refuse(id, reason) {
  send(process.stdout, {
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: `Refused by fs-proxy: ${reason}` }],
      isError: true,
    },
  });
  console.error(`fs-proxy: refused — ${reason}`);
}

/** Newline-delimited JSON, forwarding anything we do not understand verbatim. */
function pump(from, to, transform) {
  // Decode as UTF-8 across chunk boundaries. Without this, `buf += chunk`
  // stringifies each Buffer on its own, and a multi-byte character split by a
  // 64KB pipe boundary becomes two U+FFFD. The frame still parses, so the
  // corruption would reach the model silently.
  from.setEncoding("utf8");
  let buf = "";
  from.on("data", (chunk) => {
    buf += chunk;
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        to.write(line + "\n"); // not ours to interpret
        continue;
      }
      if (!transform(msg)) send(to, msg);
    }
  });
}

// host -> child: refuse anything the policy rejects, before it is forwarded.
pump(process.stdin, child.stdin, (msg) => {
  // Withhold the client's `roots` capability. This host answers roots/list
  // with the REPO ROOT, which silently overrides the directory argument the
  // child was launched with (docs/mcp/SECURITY.md, T-2). Hiding the capability
  // makes the child fall back to its own args, so the narrow scope becomes real
  // again — a second, independent layer under this proxy's allowlist.
  if (msg.method === "initialize" && msg.params?.capabilities?.roots) {
    delete msg.params.capabilities.roots;
    console.error("fs-proxy: withheld roots capability; child uses its own args");
    return false; // forward the modified initialize
  }
  // Withholding the capability is not enough on its own: the wrapped server
  // handles `notifications/roots/list_changed` by calling `roots/list`
  // unconditionally, WITHOUT re-checking the capability we just stripped. One
  // such notification and the child adopts the host's answer — the repo root —
  // undoing the paragraph above. The allowlist below still refuses every path,
  // so nothing leaks either way, but the second layer would be gone and
  // `list_allowed_directories()` would start reporting the repo root, which
  // reads as "the proxy is broken". Drop the notification: a client that
  // declares no `roots` capability has no business sending it.
  if (msg.method === "notifications/roots/list_changed") {
    console.error("fs-proxy: dropped roots/list_changed; child keeps its own args");
    return true; // handled here; do not forward
  }
  if (msg.method !== "tools/call") return false;
  const { reason, args } = enforce(msg.params?.name, msg.params?.arguments);
  if (reason !== null) {
    refuse(msg.id, reason);
    return true; // handled here; do not forward
  }
  msg.params.arguments = args; // child opens exactly what we approved
  return false;
});

// child -> host: hide tools the proxy would refuse, so the model never sees them.
pump(child.stdout, process.stdout, (msg) => {
  const tools = msg.result?.tools;
  if (!Array.isArray(tools)) return false;
  msg.result.tools = tools
    .filter((t) => FORWARDED.has(t.name))
    .map((t) => ({
      ...t,
      description:
        `${t.description ?? ""}\n\nRestricted by fs-proxy to: ` +
        `${[...allowed].join(", ")}`.trim(),
    }));
  return false; // forward the rewritten message
});

console.error(
  `fs-proxy: allowlist = ${[...allowed].join(", ")}; forwarding ${[...FORWARDED].join(", ")}`,
);

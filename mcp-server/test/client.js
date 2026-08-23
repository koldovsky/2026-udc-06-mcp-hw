/**
 * Minimal JSON-RPC-over-stdio client, enough to drive an MCP server from a
 * test. Deliberately hand-rolled rather than pulled from the SDK: these tests
 * should fail when the wire format the host actually sees is wrong, not when
 * an SDK helper changes.
 */

import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";

const PROTOCOL_VERSION = "2025-11-25";

/**
 * Starts a server process and completes the MCP handshake.
 * Returns a client with `call(method, params)` and `close()`, plus everything
 * the process wrote to stderr (where the server logs, and must log).
 */
export async function startServer(entry, { cwd } = {}) {
  const child = spawn(process.execPath, [entry], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const stderr = [];
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => stderr.push(chunk));

  const pending = new Map();
  // Set once stdout carries something that is not a JSON-RPC message — a stray
  // console.log in the server, a stack trace, an npm banner. The stream is
  // unusable from that point on, so it is remembered and reported instead of
  // being thrown from a readline callback, where it would surface as an
  // unhandled error and leave every call to die of timeout with no cause named.
  let corrupted;

  function failEverything(error) {
    corrupted ??= error;
    for (const [id, { reject }] of pending) {
      pending.delete(id);
      reject(error);
    }
    // A corrupted stream is fatal — nothing later on it can be trusted, and a
    // caller that never got a client back has no handle to close the process
    // with. Left running, the child keeps stdin open and holds the test runner
    // from exiting.
    child.kill();
  }

  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      failEverything(
        new Error(`non-JSON line on the server's stdout: ${JSON.stringify(line)}`),
      );
      return;
    }
    const entry = pending.get(message.id);
    if (entry) {
      pending.delete(message.id);
      entry.resolve(message);
    }
  });

  let nextId = 1;

  function send(payload) {
    child.stdin.write(JSON.stringify(payload) + "\n");
  }

  function call(method, params) {
    if (corrupted) return Promise.reject(corrupted);
    const id = nextId++;
    const answered = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, 10_000).unref();
    });
    send({ jsonrpc: "2.0", id, method, params });
    return answered;
  }

  const initialized = await call("initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "catalog-server-tests", version: "1.0.0" },
  });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });

  return {
    initialized,
    call,
    stderr: () => stderr.join(""),
    async close() {
      child.stdin.end();
      child.kill();
      await once(child, "exit").catch(() => {});
    },
  };
}

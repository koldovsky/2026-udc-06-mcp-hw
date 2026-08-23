/**
 * Not a server — a stand-in for the one mistake that breaks a stdio server
 * most quietly: writing to stdout. `console.log` here is exactly what
 * `src/server.ts` deliberately does NOT do (its banner goes to stderr).
 *
 * Used by `server.test.js` to prove the test client reports a corrupted
 * protocol stream by name instead of hanging until its timeout.
 */
console.log("catalog-server ready on stdio (read-only)");
process.stdin.resume();

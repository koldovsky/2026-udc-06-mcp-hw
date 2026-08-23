# catalog-server — custom MCP server (Task B)

A thin, **read-only** MCP server over the seeded catalog in `app/`. It contains
no business logic of its own: every handler in `src/server.ts` calls a pure
function imported from `../../app/dist/index.js` and formats the result.

Built against **`@modelcontextprotocol/server` v2.0.0** (the v2 generation of
the official TypeScript SDK). Note that v2's stdio entry point is
`serveStdio(factory)` — the `new StdioServerTransport()` + `server.connect()`
pair you will find in most blog posts is the v1 API and does not apply here.

## What it exposes

### Tools (model-invoked)

| Tool | Input | Wraps | Use it when |
|---|---|---|---|
| `search_inventory` | `{ query?: string }` — optional, defaults to `""` | `searchProducts` | the user asks which products exist, or about a product / category by name; an omitted or empty query lists the whole catalog |
| `check_stock` | `{ sku: string }` | `findBySku` | the user names an exact SKU and asks how many are left or whether it needs reordering |
| `low_stock` | `{}` | `lowStock` | the user asks what needs reordering or what is running low |
| `inventory_value` | `{}` | `inventoryValue` | the user asks what the stock on hand is worth in total |

All four carry `annotations: { readOnlyHint: true, openWorldHint: false }` —
they read local seeded data and nothing else.

Each input schema is a named constant, and each handler's argument type is
derived from it with `z.infer` rather than written out beside it. That is not
tidiness: a hand-written `({ query }: { query: string })` keeps compiling after
its schema changes underneath, which is exactly the description-versus-schema
drift MCP Inspector caught here in Task E. Deriving the type makes the drift a
compile error — dropping `.default("")` from the schema now fails `tsc` at the
handler, not at runtime in front of a model.

### Resource (application-read)

| URI | MIME | Contents |
|---|---|---|
| `inventory://catalog` | `application/json` | `productCount`, `categories`, `inventoryValue`, `lowStockCount` |

It is a resource rather than a tool on purpose: aggregate catalog state is
context a host can read by URI, not an action the model has to decide to take.

## Reading the data

`loadCatalog()` is called once and the parsed array is reused for the lifetime
of the process. The seeded catalog is immutable and a host keeps this server
running for a whole session, so re-reading and re-parsing the same file on
every call buys nothing. The trade-off is explicit and worth knowing before you
debug it: edit `app/data/catalog.json` and the server keeps serving the copy it
loaded at startup until you restart it.

Every tool body runs inside a guard that turns a thrown error into a tool
result with `isError: true` and a readable message, rather than letting it
become a protocol-level failure the model cannot read:

```
catalog-server could not read the catalog: ENOENT: no such file or directory ...
Most likely app/ has not been built — run: cd app && npm run build
```

The second line is attached **only** to `ENOENT`, because it is only true of
`ENOENT`. A corrupt `catalog.json` raises a `SyntaxError` that no rebuild fixes,
and it is reported without the advice:

```
catalog-server could not read the catalog: Unexpected token h in JSON at position 2
```

Sending the model to repair something that is not broken is worse than naming
no repair at all, so the guard branches on `err.code` and both branches are
pinned by tests.

The resource is deliberately *not* guarded that way: a resource result has no
`isError` channel, and its reader is the host rather than the model, so a
failure there is left to surface as a JSON-RPC error.

## Why read-only

The homework's guardrail and the point of the exercise. There is no tool that
writes, deletes, or makes a network call, and the single filesystem access is
`loadCatalog()` reading `app/data/catalog.json` — which is also the Task D
ground truth and must stay untouched.

## Build and run

`dist/` is gitignored, so a fresh clone must build both packages before the
host can start the server:

```bash
cd app && npm install && npm run build && cd ..
cd mcp-server && npm install && npm run build
```

Layout matters and should not be "simplified": `src/` and `dist/` sit at the
same depth, so the relative import `../../app/dist/index.js` is correct in both
the source and the compiled output. TypeScript does not rewrite relative import
paths on compile — moving `server.ts` to the package root would compile clean
and then fail at startup with `ERR_MODULE_NOT_FOUND`.

## Tests

```bash
npm test          # builds, then runs test/*.test.js — 20 tests
```

`node:test`, no framework. Each test starts the **compiled** server as a child
process and speaks JSON-RPC over stdio, the same way a host does — nothing is
stubbed, so a break in the wire format fails the suite.

What they pin down:

- the handshake, and that the banner goes to stderr (a single `console.log`
  here would corrupt the protocol stream) — plus the other half of that check:
  a fixture server that *does* print to stdout must be reported as
  `non-JSON line on the server's stdout`, not left to die of a timeout, so the
  stderr assertion above cannot pass for the wrong reason;
- the tool contract — four tools, each with a description long enough to be
  worth reading, an object input schema, and the right required fields;
- the guardrail itself, three ways — every tool annotated `readOnlyHint: true`;
  no exposed tool name matching `write|create|delete|move|fetch|…`; and the
  exposed surface asserted as an exact allow-list of the four known tools. The
  name pattern alone is only a heuristic (it would wave through a mutating tool
  called `sync_all`), so the allow-list is what actually binds: any new tool
  fails the suite until someone adds it on purpose. A fourth check asserts the
  declared capabilities, including that the resource is served without
  `subscribe`;
- the numbers, recomputed from `app/data/catalog.json` inside the test rather
  than hardcoded, so the suite fails if the server and the seeded data ever
  disagree;
- schema rejection — and that it really is the *schema* rejecting. Asserting
  only "the call failed" would stay green if validation were removed and the
  handler threw into the guard instead, so the tests match on the validation
  message and assert the guard's text is absent. Verified by mutation: relaxing
  `sku` to `z.any()` turns that test red;
- the graceful answers for an unknown SKU and a query that matches nothing;
- both failure paths — a tree with no `app/data` must produce a readable
  `isError` result naming the rebuild, and a tree with a corrupt
  `catalog.json` must produce one *without* it.

The two failure-path tests build their sandbox inside `mcp-server/` rather than
in the OS temp directory, so the copied server still resolves the SDK by walking
up to the real `node_modules`. That replaced a `symlinkSync` that needed
administrator rights on Windows; `NODE_PATH` is not an alternative, since ESM
ignores it. The directories are gitignored (`mcp-server/.sandbox-*`) and removed
on exit.

## Verify without a host

Fastest way to tell "my server is broken" apart from "the model chose not to
call my tool":

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  '{"jsonrpc":"2.0","id":3,"method":"resources/list"}' \
  '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"low_stock","arguments":{}}}' \
  '{"jsonrpc":"2.0","id":5,"method":"resources/read","params":{"uri":"inventory://catalog"}}' \
  | node ./dist/server.js
```

Expected against the seeded data: 4 tools, 1 resource, 9 SKUs needing reorder,
and `inventoryValue` of `46152` — the same numbers as the ground-truth command
in `materials/ab-question.md`.

## Registration

Registered in the repo-root `.mcp.json` as `catalog`, launched as
`node mcp-server/dist/server.js`. The path is relative and needs no editing
after cloning, because the host spawns its servers with the project as their
working directory — measured on two Claude Code hosts in `docs/mcp/servers.md`,
"Where the paths come from". Note that this is host behaviour, not a guarantee
in the MCP specification: in a host that started the server elsewhere, Node
would fail with `Cannot find module`, and the fix is to put an absolute path
back in your own copy of the config.

The data path is a separate matter and does not depend on any of that:
`loadCatalog()` resolves `app/data/catalog.json` from its own module URL, so
the server reads the right file whatever the working directory is.

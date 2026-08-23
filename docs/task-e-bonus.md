# Task E (bonus) — Path 2: debugging the server with MCP Inspector

Environment: Node v26.0.0, `@modelcontextprotocol/inspector` 2.3.0,
server `mcp-server/` on `@modelcontextprotocol/server` v2, stdio transport.

## What we did

Ran Inspector in **CLI mode** against the built server, so every probe is a
reproducible command with a diffable JSON answer rather than a screenshot:

```bash
cd mcp-server && npm run build
npx @modelcontextprotocol/inspector --cli node ./dist/server.js --method tools/list
npx @modelcontextprotocol/inspector --cli node ./dist/server.js --method resources/list
npx @modelcontextprotocol/inspector --cli node ./dist/server.js --method resources/read --uri inventory://catalog
npx @modelcontextprotocol/inspector --cli node ./dist/server.js --method tools/call --tool-name search_inventory --tool-arg query=audio
npx @modelcontextprotocol/inspector --cli node ./dist/server.js --method tools/call --tool-name search_inventory
npx @modelcontextprotocol/inspector --cli node ./dist/server.js --method tools/call --tool-name check_stock --tool-arg sku=kb-1001
npx @modelcontextprotocol/inspector --cli node ./dist/server.js --method tools/call --tool-name check_stock --tool-arg sku=ZZ-9999
npx @modelcontextprotocol/inspector --cli node ./dist/server.js --method tools/call --tool-name inventory_value
npx @modelcontextprotocol/inspector --cli node ./dist/server.js --method resources/read --uri inventory://nope
```

The plan was deliberate: list the surface first (what does the host actually
see?), then read the resource, then call each tool on a happy path, then push
every tool off its happy path — missing argument, wrong case, unknown SKU,
unknown URI.

## What we saw

**The surface is what it should be.** `tools/list` returned all four tools with
`"readOnlyHint": true` and `"openWorldHint": false`, and `resources/list`
returned the single `inventory://catalog` resource. The read-only claim in
`docs/mcp/SECURITY.md` is not just an intention in the source — it is visible in
the published protocol surface, which is the only thing a host can act on.

**The resource matches the ground truth of Task D.**

```json
{
  "productCount": 24,
  "categories": ["accessories","audio","cables","displays","furniture","peripherals","storage"],
  "inventoryValue": 46152,
  "lowStockCount": 9
}
```

**Case-insensitivity and the unknown-SKU path behave.** `sku=kb-1001` (lowercase)
resolved to `KB-1001`, and `sku=ZZ-9999` came back as a plain sentence — an
answer, not a crash:

```
No product with SKU "ZZ-9999" in the catalog.
```

**A bad resource URI surfaces as a JSON-RPC error, not a tool error** — as
intended, since a resource has no `isError` channel and the reader is the host,
not the model:

```json
{"error":{"code":"error","message":"Resource not found: inventory://nope"}}
```

## What we found and fixed

### Defect: `search_inventory` promised something its schema forbade

The tool description ends with *"An empty query returns the whole catalog"*, and
`searchProducts` in `app/src/catalog.ts` really does return everything for an
empty string. But the published schema said:

```json
"required": ["query"]
```

So calling the tool the way its own description invites failed **before** the
handler ran:

```json
{
  "content": [{ "type": "text",
    "text": "Input validation error: Invalid arguments for tool search_inventory: query: Invalid input: expected string, received undefined" }],
  "isError": true
}
```

This is exactly the class of bug a chat session hides. A model reading that
description would either always pass a query (and never hit the bug) or pass
none, get a validation error, and quietly retry with some invented string — and
the transcript would look like the tool worked.

**Fix:** `query` is now `.optional().default("")` in
[mcp-server/src/server.ts](../mcp-server/src/server.ts), and the argument
description states the behaviour explicitly. The schema no longer lists
`required`, and it publishes `"default": ""`.

### Defect (cosmetic, but model-facing): the empty-query answer read as nonsense

After the fix, an argument-less call answered:

```
24 product(s) matched "":
```

Technically true, semantically wrong — nothing "matched" an empty string; this
is a full listing. Since a tool result is text a model reads and paraphrases to
the user, that wording invites a wrong paraphrase.

**Fix:** the empty-query branch now answers `Whole catalog (24 product(s)):`.

### Verification after the fix

```
$ npx @modelcontextprotocol/inspector --cli node ./dist/server.js --method tools/call --tool-name search_inventory
{
  "content": [{ "type": "text", "text": "Whole catalog (24 product(s)):\nKB-1001 — Mechanical Keyboard TKL ..." }]
}
```

Both findings are locked in by tests, so they cannot regress silently:

- `search_inventory works with no arguments at all` — new regression test.
- The schema assertion in `exposes four read-only tools...` was inverted from
  `required: ["query"]` to `required: undefined` plus `default: ""`.

```
$ cd mcp-server && npm test
ℹ tests 16
ℹ pass 16
ℹ fail 0

$ cd app && npm test
Test Files  1 passed (1)
     Tests  8 passed (8)
```

That transcript is left exactly as recorded during the Inspector session. The
suite has grown to **20** tests since, for reasons unrelated to Inspector — the
guardrail assertion gained an exact allow-list of exposed tools, the guard's
error path gained a second case (a corrupt `catalog.json` must be reported
*without* the "rebuild app/" advice, which only fits `ENOENT`), and the test
client itself gained one (a server that prints to stdout must be reported as a
corrupted stream, not left to time out). Both regression tests from this section
are still in it, unchanged.

## Gotcha worth recording

`npx @modelcontextprotocol/inspector --version` is not a version flag. Inspector
treats the unrecognised argument as the **server command to launch** and tries to
spawn it, which fails with:

```
Failed to start transport: spawn --version ENOENT
```

Nothing is wrong with the server when that appears. Use
`npm view @modelcontextprotocol/inspector version` instead.

## Conclusion

Inspector's value is that it splits one failure into two questions that chat
conflates: *is my server broken?* and *did the model decline to call my tool?*
Talking to the server directly answers the first with certainty, so the second
stops being a guess.

Concretely, it exposes three things a chat session cannot:

1. **The published schema, verbatim.** The `required: ["query"]` contradiction
   was invisible in the TypeScript source (`z.string()` reads as fine) and
   invisible in chat (a model just supplies an argument). It was obvious the
   moment the JSON schema was printed.
2. **Errors as raw protocol.** The distinction between `isError: true` (a domain
   failure the model should read) and a JSON-RPC error (a host-level failure)
   is visible as JSON and invisible in a rendered chat bubble.
3. **The exact tool text the model consumes.** `matched ""` never reaches the
   user's screen — the model paraphrases it. Reading the raw string is the only
   way to notice it is misleading.

The habit worth keeping: probe every tool off its happy path in Inspector
*before* wiring the server into a host, and turn each finding into a test. The
protocol surface is the real contract — not the source, and not the transcript.

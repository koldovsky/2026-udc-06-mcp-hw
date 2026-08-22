# Task E (bonus) — Path 2: debugging the server with MCP Inspector

> **Коротко (UA):** прогнав свій сервер через `@modelcontextprotocol/inspector`
> у `--cli` режимі — щасливий шлях і навмисно погані входи. Inspector показав
> реальні схеми/анотації на дроті, як SDK відхиляє невалідні аргументи ще до
> мого коду, і **знайшов дефект**: невідома категорія повертала порожній список
> замість помилки «не знайдено». Виправлено через `ResourceNotFoundError`
> (JSON-RPC `-32602` з `uri` у `data`), покрито smoke-тестом.

**What I did:** ran the Inspector in `--cli` mode against the built server
(`@modelcontextprotocol/inspector@2.3.0`, Node 24.16) — first the happy path,
then deliberately bad inputs — and compared what it showed with what the
host (Claude Code) showed.

```bash
cd mcp-server
npx -y @modelcontextprotocol/inspector@2.3.0 --cli node ./dist/server.js --method tools/list
npx -y @modelcontextprotocol/inspector@2.3.0 --cli node ./dist/server.js --method tools/call --tool-name check_stock --tool-arg sku=KB-1002
npx -y @modelcontextprotocol/inspector@2.3.0 --cli node ./dist/server.js --method tools/call --tool-name check_stock --tool-arg sku=kb1001
npx -y @modelcontextprotocol/inspector@2.3.0 --cli node ./dist/server.js --method tools/call --tool-name search_inventory --tool-arg query=monitor --tool-arg limit=2
npx -y @modelcontextprotocol/inspector@2.3.0 --cli node ./dist/server.js --method tools/call --tool-name search_inventory --tool-arg query=monitor --tool-arg limit=0
npx -y @modelcontextprotocol/inspector@2.3.0 --cli node ./dist/server.js --method resources/list
npx -y @modelcontextprotocol/inspector@2.3.0 --cli node ./dist/server.js --method resources/read --uri inventory://catalog
npx -y @modelcontextprotocol/inspector@2.3.0 --cli node ./dist/server.js --method resources/read --uri inventory://category/toys
```

## What I saw

**`tools/list`** — three tools, each with the JSON Schema the SDK generated
from zod and the annotations as sent on the wire:

```
- search_inventory | required: ["query"] | props: query,limit | annotations: {"title":"Search inventory","readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false}
- check_stock      | required: ["sku"]   | props: sku         | annotations: {"title":"Check stock", …same…}
- low_stock        | required: []        | props: (none)      | annotations: {"title":"Low stock", …same…}
```

So `z.object({})` for `low_stock` really does advertise an empty object
schema (Claude Code later called it with `{}` — matches).

**`tools/call check_stock sku=KB-1002`** — text block + `structuredContent`
(`found: true, needsReorder: true, unitsBelowReorderLevel: 7`).

**`tools/call check_stock sku=kb1001`** (no dash) — rejected *before* my
handler ran, by the SDK's schema validation, with my custom regex message:

```
Input validation error: Invalid arguments for tool check_stock: sku: SKU must look like XX-9999, e.g. KB-1001
```

**`search_inventory … limit=2`** — worked: the Inspector CLI coerces
`--tool-arg limit=2` to a number using the advertised schema, so
`z.number()` is fine; I had expected a `"2"`-vs-`2` type error and there was
none. `limit=0` → `Too small: expected number to be >=1`, also from the
schema layer.

**`search_inventory --tool-arg query=`** — the Inspector CLI itself refuses
an empty value (`Invalid parameter format: query=. Use key=value format.`),
so "empty query returns everything" cannot be exercised from the CLI; it was
verified over raw stdio instead (returns all 24).

**`resources/list`** — 9 entries: the 2 static resources **plus** 7
`inventory://category/…` URIs produced by the template's `list` callback.
Seeing the enumeration confirmed that a host can browse categories without
calling any tool.

**`resources/read inventory://catalog`** — the JSON summary
(`productCount: 24, totalInventoryValue: 46152, lowStockCount: 9, …`).

## What I found and fixed thanks to it

1. **Unknown category returned a plausible empty result.**
   `resources/read inventory://category/toys` came back as
   `{"category":"toys","count":0,"products":[]}` — a *successful* read that is
   indistinguishable from a real category that happens to be empty. In a chat
   this would never have surfaced (the model only asks for categories it has
   seen). Fixed in `src/server.ts`: the template handler now checks the name
   against `categories(catalog())` and throws the SDK's
   `ResourceNotFoundError(uri, "Unknown category … Known categories: …")`.
   After the rebuild the Inspector shows a JSON-RPC error instead:
   ```
   {"error":{"code":"error","message":"Unknown category \"toys\". Known categories: accessories, audio, cables, displays, furniture, peripherals, storage."}}
   ```
2. **Two different "not found" shapes were intentional, and Inspector made
   them visible side by side:** a malformed SKU is a *schema* error (generic
   `isError` text from the SDK, no `structuredContent`), while a well-formed
   but nonexistent SKU is a *domain* miss (`isError: true` **with**
   `structuredContent: {found:false, sku}` so a client can still branch on
   it). Before running both through Inspector I had not checked that the
   second path actually produced `structuredContent` on the error response.
3. **Stderr hygiene:** the Inspector prints the server's stderr inline
   (`[catalog-server] ready on stdio …`). That confirmed the only non-protocol
   output goes to stderr — had anything leaked to stdout the CLI would have
   failed to parse the response, which is the fastest way to catch a stray
   `console.log`.

## Log (trimmed)

```
$ npx -y @modelcontextprotocol/inspector@2.3.0 --cli node ./dist/server.js --method resources/read --uri inventory://category/toys
[catalog-server] ready on stdio (read-only, 3 tools, 2 resources + 1 template)
{"error":{"code":"error","message":"Unknown category \"toys\". Known categories: accessories, audio, cables, displays, furniture, peripherals, storage."}}

$ npx -y @modelcontextprotocol/inspector@2.3.0 --cli node ./dist/server.js --method resources/read --uri inventory://category/cables
{ "contents": [ { "uri": "inventory://category/cables", "mimeType": "application/json", "text": "{\n  \"category\": \"cables\",\n  \"count\": 3,\n  \"products\": [ …CB-7001, CB-7002, CB-7003… ]\n}" } ] }
```

The Inspector CLI renders errors as `{"error":{"code":"error", …}}`, which
hides the actual wire-level frame. Sending the same request over raw stdio
shows what a client really receives — `ResourceNotFoundError` in
`@modelcontextprotocol/server` 2.0.0 maps to JSON-RPC `-32602` (invalid
params) and carries the offending URI in `data`, which is what lets a client
branch on it instead of string-matching the message:

```
{"jsonrpc":"2.0","id":2,"error":{"code":-32602,"message":"Unknown category \"toys\". Known categories: accessories, audio, cables, displays, furniture, peripherals, storage.","data":{"uri":"inventory://category/toys"}}}
```

## Conclusion

"Just try it in chat" only tells you whether the *model chose* to call the
tool and whether the *answer looked right*. Inspector removes the model from
the loop: it shows the exact schema the host receives, lets you send inputs a
model would never send (malformed SKUs, out-of-range limits, URIs for
categories that do not exist), and surfaces the raw wire response including
error shapes and `structuredContent`. That is how a silent "empty list
instead of not-found" defect was found in minutes, and it separates "my
server is broken" from "the model did not want to call it" — the two failure
modes that look identical from inside a chat.

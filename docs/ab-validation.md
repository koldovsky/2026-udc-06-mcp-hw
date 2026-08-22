# A/B validation of the MCP server (Task D)

> **Коротко (UA):** той самий промпт у трьох свіжих сесіях — з `catalog`-сервером
> (A), без нього (B), без нього і без shell (B2). **Чесний нуль:** усі три
> відповіли правильно (9 SKU, 46152). Сервер змінив не правильність, а *шлях*:
> A — один оголошений read-only tool + ресурс (4 кроки, $0.23); B — агент сам
> запустив `app/dist` через `Bash` (3 кроки, $0.28); B2 — прочитав 5 файлів і
> порахував вручну (10 кроків, $1.09). Конфаундери описані окремо.

**Prompt (identical in A and B, verbatim from `materials/ab-question.md`):**

```
Which products in our catalog need reordering right now, and what is the
total value of the stock we are currently holding? Give me the SKUs and
the total as a number.
```

**Host / model:** Claude Code CLI 2.1.239, model `claude-fable-5` (reported in
the session `init` event of every run)
**Server under test:** `mcp-server/` (`search_inventory`, `check_stock`,
`low_stock`; resources `inventory://catalog`, `inventory://catalog/products`,
`inventory://category/{category}`)

**How the runs were made.** Each run is a separate, fresh, non-interactive
session (`claude -p "<prompt>" --output-format stream-json --verbose`), so
there is no chat history and no stale tool list. The stream-json transcript
records every `tool_use` block, every `tool_result`, turn count, duration and
cost; the numbers below are copied from those transcripts. Both runs had the
same built-in tools allow-listed (`Read`, `Glob`, `Grep`, `Bash`) so that the
only variable is the presence of the `catalog` MCP server.

## Ground truth

Computed locally with the command from `materials/ab-question.md`
(`cd app && npm run build && node -e "import('./dist/index.js').then(…)"`):

```
SKUs that need reordering: DK-4001, WC-8002, DS-6002, MS-2001, MN-3002, HS-5002, SS-1102, KB-1002, CB-7003   (9)
Total inventory value:     46152
```

## Run A — MCP connected

`.mcp.json` as committed: `filesystem`, `memory`, `catalog` all `connected`
in the session init event.

**What the agent did** (3 tool calls, 4 turns, 11.8 s, $0.23):

1. `ToolSearch` — loaded the schemas for `mcp__catalog__low_stock` and
   `ReadMcpResourceTool` (Claude Code defers MCP tool schemas until needed).
2. `mcp__catalog__low_stock` with `{}` → 9 products + `totalInventoryValue: 46152`
   in `structuredContent`.
3. `ReadMcpResourceTool` `{server: "catalog", uri: "inventory://catalog"}` → the
   summary resource, used as a cross-check ("both … agree on these figures").

It did **not** touch `Read`, `Bash`, or the `filesystem` server.

**Answer:** a table of the 9 SKUs (DK-4001, WC-8002, DS-6002, MS-2001, MN-3002,
HS-5002, SS-1102, KB-1002, CB-7003) with stock/reorder level, and
**"Total value of stock currently held: 46152"**.

**Correct?** Yes — exact match on both the SKU set (and order) and the total.

## Run B — MCP disconnected

**How it was disabled:** the `catalog` entry was removed from a copy of the
config and the session started with
`--strict-mcp-config --mcp-config <copy-without-catalog>`, which makes Claude
Code ignore every other MCP source. Because each `claude -p` call is a new
process, this is equivalent to "edit config + restart host"; the init event
confirms only `filesystem` and `memory` connected and no `mcp__catalog__*`
tool exists in the tool list.

**What the agent did** (2 tool calls, 3 turns, 15.9 s, $0.28):

1. `Bash`: `cat AGENTS.md && cat .mcp.json && ls app mcp-server && cat app/AGENTS.md`
   — oriented itself, noticed the catalog server in `.mcp.json` was not
   loaded, and found `app/dist`.
2. `Bash`: `cat app/src/catalog.ts; cd app && node -e "…require('./dist/index.js') … lowStock(p) … inventoryValue(p)"`
   — **executed the domain library itself** to get the numbers.

It did not read `catalog.json` by hand and did not guess; it said explicitly
*"the `catalog` MCP server from `.mcp.json` wasn't loaded in this session, so I
ran `app/dist` directly — same functions the server wraps"*.

**Answer:** the same 9 SKUs in the same order, and **46152**.

**Correct?** Yes.

### Run B2 (supplementary) — no MCP *and* no shell

Because Run B reached the answer through `Bash`, I ran one more control with
`Bash`/`PowerShell` disallowed, leaving only `Read`/`Glob`/`Grep` and the two
public servers — the closest thing to "the model has to aggregate by itself".

**What the agent did** (9 tool calls, 10 turns, 48.4 s, $1.09): read
`AGENTS.md`, `.mcp.json`, globbed `mcp-server/`, read `app/src/catalog.ts`,
read **`app/data/catalog.json`**, read `materials/domain-brief.md`, tried to
load `Bash` via `ToolSearch` (refused), grepped the repo for `46152` hoping to
find a recorded answer (none), grepped for `inventoryValue|lowStock`, then
computed the sum by hand "in two independent groupings".

**Answer:** the 9 SKUs and **46152.00** — correct. It flagged itself that the
result was hand-computed and suggested running `app/dist` or the catalog tool
"for a machine-verified answer".

## Difference table

| Aspect | A (with MCP) | B (without MCP, shell available) | B2 (without MCP, no shell — **two variables changed**, see confounders) |
|---|---|---|---|
| Called a tool | yes — `low_stock` + resource `inventory://catalog` | yes — `Bash` × 2 (ran `app/dist` via `node -e`) | yes — `Read` × 5, `Glob`, `Grep` × 2 |
| SKU list complete | 9/9 | 9/9 | 9/9 |
| Total exact | 46152 ✔ | 46152 ✔ | 46152 ✔ |
| Tool calls / turns | 3 / 4 | 2 / 3 | 9 / 10 |
| Wall time | 11.8 s | 15.9 s | 48.4 s |
| Cost | $0.23 | $0.28 | $1.09 (4.7× A) |
| Source of the numbers | tested domain code, through a declared read-only tool | tested domain code, through **arbitrary shell execution** | raw JSON + model arithmetic |
| Confidence vs. correctness | confident, correct, machine-verified | confident, correct, machine-verified | confident, correct, **self-flagged as hand-computed** |
| Capability that was actually exercised | `mcp__catalog__low_stock` (`readOnlyHint: true`) | `Bash` (can do anything) | file reads over the whole repo |

## Confounders and what they do to the conclusion

Three things in the transcripts are not controlled for, and they matter for
how much weight each row of the table can carry:

1. **Run B's agent knew the server existed.** Its first command was
   `cat AGENTS.md && cat .mcp.json …`, and it then wrote *"the `catalog` MCP
   server from `.mcp.json` wasn't loaded in this session"*. So condition B is
   not "an agent that knows nothing about a catalog server"; it is "an agent
   that has read a config naming the server, has been told by `AGENTS.md`
   exactly where the tested domain code lives, and has a shell". That is a
   strong hint toward `node -e "…dist/index.js…"` and plausibly explains why
   B was so cheap (2 tool calls) rather than reading the JSON by hand. A
   cleaner B would hide `.mcp.json` and `AGENTS.md` — but then it would no
   longer be "this repo without the server", which is what the assignment
   asks to compare.
2. **B2 changed two variables at once** — the server *and* the shell were
   removed. Its 4.7× cost is therefore "no MCP and no shell" versus A, not
   "no MCP" alone. It is a control for *what the model does when it must
   aggregate itself*, not a second measurement of the server's effect; the
   table keeps it in the same row set only for readability.
3. **Permissions were equalised in the server's favour.** In Run A the three
   `catalog` tools were pre-approved by `.claude/settings.json`, so no
   permission prompt could have discouraged the call; in B and B2 the
   built-in tools (`Read`, `Glob`, `Grep`, and `Bash` where allowed) were
   pre-approved via `--allowedTools` the same way. This removes the dialog as
   a variable and makes A a fair test of *choice* — but it also means the
   results say nothing about how a prompt-on-every-call setup would behave.

None of these change the headline (all three runs were correct); they do mean
the turn/cost differences should be read as indicative, not as a controlled
benchmark.

## Conclusion

Honest result: **the MCP server did not change the correctness of the answer.**
All three runs produced the exact ground truth. With this model and this tiny
dataset (24 rows), the agent either executes the library itself (B) or does
the arithmetic correctly by hand (B2).

What the server *did* change is **how** the answer was reached, and that is
the real argument for it: in A the only capability exercised was a declared,
annotated, read-only tool with a typed result (`structuredContent`), and the
answer came back in one call with a built-in cross-check. In B the same
outcome required handing the agent a shell — a capability vastly broader than
the question. In B2 it required reading five files across the repo and 4.7×
the cost, and the agent itself labelled the result "hand-computed, please
verify". A custom MCP server is worth its cost when (1) the host's broad
tools (shell, full FS) should *not* be on the table, (2) the data is large or
changes often enough that model arithmetic stops being reliable, or (3) you
want the tool call to be auditable and typed. When none of those hold — a
trusted developer, a small static JSON, a host that already has a shell —
plain file access is enough, and that is exactly what this A/B showed.

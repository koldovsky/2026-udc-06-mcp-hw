# A/B validation of the custom MCP server (Task D)

**Prompt (identical in A and B, taken verbatim from
[`materials/ab-question.md`](../materials/ab-question.md)):**

```text
Which products in our catalog need reordering right now, and what is the
total value of the stock we are currently holding? Give me the SKUs and
the total as a number.
```

**Host / model:** Claude Code CLI 2.1.226 (headless `claude -p`), model pinned
to `claude-sonnet-5` in both runs. macOS, Node v26.0.0.
**Server under test:** `mcp-server/` — the `catalog` server from Task B, as it
stood for these runs: three tools (`search_inventory`, `check_stock`,
`low_stock`) plus the `inventory://catalog` resource. A fourth tool,
`inventory_value`, was added *after* these runs in response to what they showed
— see "Follow-up run A2" at the end, which is reported separately and is not
part of the A/B comparison.
**Date of the runs:** 2026-08-23.

## How the two runs were isolated

Both runs were started as **fresh, non-interactive sessions** — a new process
per run, so no session could carry stale tools or a warm answer from the other.
The only difference between them is the MCP config passed in:

| | Run A | Run B |
|---|---|---|
| MCP config | [`ab/mcp-a.json`](./ab/mcp-a.json) — a copy of [`.mcp.json`](../.mcp.json): `filesystem`, `memory`, `catalog` | [`ab/mcp-b.json`](./ab/mcp-b.json) — the same file **with the `catalog` block removed**: `filesystem`, `memory` |
| MCP tools offered | 19 (3 of them `mcp__catalog__*`) | 16 (`catalog` absent — verified in the session-init event) |

Both files are committed in [`docs/ab/`](./ab/) rather than described in prose,
so the comparison can be repeated instead of reconstructed: `diff` between them
is a single hunk, the `catalog` block and nothing else.

Everything else was held constant on purpose: same prompt, same model, same
working directory, same permitted tool set
(`mcp__catalog,mcp__filesystem,mcp__memory,Read,Glob,Grep,Bash`, with
`Write,Edit,NotebookEdit` denied). The permitted set is a **superset** given
identically to both runs — run B was not handicapped; it simply had one fewer
server to choose from.

```bash
# The prompt, defined once and reused verbatim by both runs — that is the whole
# point of the comparison, so it is a variable rather than two typed copies.
PROMPT="Which products in our catalog need reordering right now, and what is the
total value of the stock we are currently holding? Give me the SKUs and
the total as a number."

# Run A (catalog server present) — from the repo root
claude -p "$PROMPT" --strict-mcp-config --mcp-config docs/ab/mcp-a.json \
  --model claude-sonnet-5 \
  --allowedTools "mcp__catalog,mcp__filesystem,mcp__memory,Read,Glob,Grep,Bash" \
  --disallowedTools "Write,Edit,NotebookEdit" \
  --output-format stream-json --verbose

# Run B — identical, but --mcp-config docs/ab/mcp-b.json (the same file minus `catalog`)
```

`--strict-mcp-config` matters: without it the CLI would merge the project's own
`.mcp.json` back in and run B would silently still have the server. The
session-init event of run B was checked for `mcp__catalog*` before trusting the
result — it reported none.

## Ground truth

Computed locally from the seeded data, before either run, so there was
something independent to compare against:

```bash
cd app && npm run build
node -e "import('./dist/index.js').then(m=>{const c=m.loadCatalog();console.log(m.lowStock(c).map(p=>p.sku).join(', '));console.log(m.inventoryValue(c));})"
```

```text
SKUs needing reorder (9): DK-4001, WC-8002, DS-6002, MS-2001, MN-3002,
                          HS-5002, SS-1102, KB-1002, CB-7003
Total inventory value:    46152
```

## Run A — MCP connected

**What the agent did:** two domain tool calls, in one parallel turn, with no
exploration of the repository first:

1. `mcp__catalog__low_stock {}` → returned the 9 products with their stock and
   reorder levels.
2. `mcp__catalog__search_inventory {"query": ""}` → returned all 24 products
   (the empty query is documented as "returns the whole catalog"), from which
   the model summed `price × stock` itself.

It never opened `app/data/catalog.json`, never ran a shell command, and never
looked at `app/src/catalog.ts` to find out what "needs reordering" means — the
rule arrived inside the tool result.

**Answer:**

```text
Reorder now (9 SKUs, stock ≤ reorder level):
DK-4001, WC-8002, DS-6002, MS-2001, MN-3002, HS-5002, SS-1102, KB-1002, CB-7003

Total stock value (price × qty, all 24 SKUs): 46152
```

**Correct?** Yes — both the SKU list and the total match the ground truth
exactly.

**Worth noting:** the `inventory://catalog` resource, which already contains
`inventoryValue`, was **not** used. That is expected rather than a defect — a
resource is application-controlled context, the model cannot decide to fetch it
the way it decides to call a tool, and this host did not attach it. So the
total in run A was still model arithmetic over 24 rows, not a number the server
handed over. Only the *reorder rule* was fully delegated.

## Run B — MCP disconnected

**How it was disabled:** the `catalog` entry was removed from the config file
passed to the run, and the run was a brand-new process — not a restarted chat
inside a live host, so there was no possibility of a stale connection. The
`filesystem` and `memory` servers from Task A stayed connected in both runs.

**What the agent did:** four calls, and it had to discover the domain itself:

1. `Bash: find … -maxdepth 3` — mapped the repository to locate the data.
2. `Read app/src/catalog.ts` — read the source to learn the business rule
   (`stock <= reorderLevel`, and `inventoryValue` = sum of `price * stock`).
3. `Read app/data/catalog.json` (first 60 lines) — inspected the data shape.
4. `Bash: node -e "…"` — wrote and executed a throwaway script that filtered
   the low-stock rows and reduced the total.

Notably it did **not** use the `filesystem` MCP server that was available to it;
it reached for the host's own `Read` and `Bash` instead.

**Answer:**

```text
Reorder now (stock ≤ reorderLevel, low→high):
DK-4001 — 0/8, WC-8002 — 1/5, DS-6002 — 2/3, MS-2001 — 3/20, MN-3002 — 4/6,
HS-5002 — 5/12, SS-1102 — 6/10, KB-1002 — 8/15, CB-7003 — 9/40

Total stock value: 46152
```

**Correct?** Yes — same 9 SKUs, same total, and arguably a slightly richer
answer, since it printed each item's stock against its reorder level.

## Differences

| Aspect | A (with MCP) | B (without MCP) |
|---|---|---|
| Called a domain tool | Yes — `low_stock`, `search_inventory` | No such tool existed; used `Bash` + `Read` |
| SKU list complete | Yes — all 9, exact | Yes — all 9, exact |
| Total exact | Yes — 46152 | Yes — 46152 |
| Steps taken | 2 tool calls in 1 turn (4 turns total, 9.7 s) | 4 tool calls (5 turns total, 11.9 s) |
| How the rule was obtained | Delivered by the server; never read the source | Re-derived by reading `app/src/catalog.ts` |
| Privilege actually exercised | Read-only MCP tools only | Arbitrary shell execution (`node -e …`) plus filesystem reads |
| Repo content pulled into context | Only tool results (2 lists) | Repo tree + a source file + part of the raw JSON |
| Confidence vs correctness | Confident, and correct | Confident, and correct |

Cost per run (\$0.256 for A vs \$0.161 for B) was measured but is **not** cited
as a finding: prompt-cache creation vs. reuse dominates it across two runs and
it is not a fair comparison.

## Conclusion

The honest result is a **near-zero difference in the answer**: both runs got all
9 SKUs and the exact total of 46152, so on correctness the custom server changed
nothing. What it changed is the *path* to the answer. Without the server the
agent had to explore the repo, read the domain source to recover the reorder
rule, and then execute a generated shell script — it succeeded only because the
data happened to be a readable local JSON file, the source encoding the rule was
sitting next to it, and shell execution was permitted. With the server it made
two read-only calls, exercised no code-execution privilege, and pulled far less
of the repo into its context.

That is the real lesson about when a custom MCP server is worth its cost. For a
24-row JSON file in the same repository, plain file access is genuinely
sufficient, and building a server for this alone would be over-engineering. The
server starts paying for itself when the data is *not* reachable that way — a
database, an internal API, a remote system — or when the business rule must not
be re-derived from source each time and must not drift between callers, or when
the agent should be able to answer this question *without* being handed shell
access, which is exactly the least-privilege trade covered in
[`docs/mcp/SECURITY.md`](./mcp/SECURITY.md).

One follow-up this exposed for Task B: the total in run A was still summed by
the model rather than served. A dedicated `inventory_value` tool — or attaching
the existing `inventory://catalog` resource — would move that last piece of
arithmetic behind the protocol boundary, where it can be tested.

## Follow-up run A2 — after acting on that finding

The follow-up was implemented rather than left as a note: `inventory_value` is
now the server's fourth tool, wrapping the same `inventoryValue()` function the
app tests already cover, and asserted against the seeded data by the server
suite (`mcp-server/test/`, 20 tests).

**Runs A and B above are left exactly as recorded** — they are the A/B
comparison, and both were made against the three-tool build of the server. This
section is a third, later run, reported separately so it cannot be mistaken for
part of that comparison. Same prompt, same flags, same model
(`claude-sonnet-5`), same date, only the server changed.

**What the agent did:** two domain tool calls, both aggregate, no repository
access at all:

1. `mcp__catalog__low_stock {}` → the 9 products.
2. `mcp__catalog__inventory_value {}` → `Total inventory value: 46152 (price x
   stock over 24 products).`

**Answer:** the same 9 SKUs and `46152` — correct. 4 turns, 6.8 s.

| | Run A (3 tools) | Run A2 (4 tools) |
|---|---|---|
| Tools called | `low_stock`, `search_inventory` | `low_stock`, `inventory_value` |
| Rows pulled into context | all 24 products, to be summed | none — two aggregates |
| Who computed the total | the model, over the tool output | the server, in tested code |

That is the point worth keeping from this: the honest zero of A vs B was about
*correctness*, and it does not change. What changed is the last piece of
untested arithmetic in the path — with the third tool the model was summing 24
rows it had asked for; with the fourth it asks for the number. The fix was one
tool over a function that already existed, which is the cheap half of the
lesson: a thin server pays for itself only where the domain function is already
written and tested.

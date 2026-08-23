# A/B run configs (Task D)

The two MCP configs the runs in [`../ab-validation.md`](../ab-validation.md)
were driven with, committed so the comparison can be repeated exactly rather
than reconstructed from prose.

| File | Servers | Used by |
|---|---|---|
| `mcp-a.json` | `filesystem`, `memory`, `catalog` — a copy of the repo's `.mcp.json` | run A |
| `mcp-b.json` | `filesystem`, `memory` — the same file **minus the `catalog` block** | run B |

That single missing block is the only difference between them; `diff` says so
in one hunk.

```bash
# The prompt, verbatim from materials/ab-question.md — identical in both runs.
PROMPT="Which products in our catalog need reordering right now, and what is the
total value of the stock we are currently holding? Give me the SKUs and
the total as a number."

claude -p "$PROMPT" --strict-mcp-config --mcp-config docs/ab/mcp-a.json \
  --model claude-sonnet-5 \
  --allowedTools "mcp__catalog,mcp__filesystem,mcp__memory,Read,Glob,Grep,Bash" \
  --disallowedTools "Write,Edit,NotebookEdit" \
  --output-format stream-json --verbose

# run B: identical, with --mcp-config docs/ab/mcp-b.json
```

`--strict-mcp-config` is not optional here. Without it the CLI merges the
project's own `.mcp.json` back in, and run B silently keeps the `catalog`
server — the run looks valid and proves nothing.

Three caveats before re-running:

- Both configs use paths relative to the **repo root**, like `.mcp.json` does,
  so run the commands from there and not from this directory.
- Runs A and B in the write-up were made against the **three-tool** build of
  the server (before `inventory_value` existed). Re-running `mcp-a.json` today
  reproduces run **A2**, not run A. That is deliberate and explained in the
  write-up's follow-up section.
- `mcp-a.json` is a **hand copy** of `.mcp.json`, not a symlink or a generated
  file, because it has to stay frozen at the configuration the runs were made
  with. The cost is that the two drift apart the moment `.mcp.json` changes and
  nothing complains. Before citing run A as current, check:

  ```bash
  diff .mcp.json docs/ab/mcp-a.json   # silent = A still reflects the live config
  ```

  If that prints a hunk, the run is a historical record of a configuration the
  repo no longer has — which is fine, as long as the write-up says so rather
  than implying otherwise.

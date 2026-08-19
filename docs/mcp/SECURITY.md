# Threat model for this project's MCP integrations (Task C)

**Reviewed configuration:** `.mcp.json` on 2026-08-19  
**Host tested:** Claude Code  
**Data classification:** synthetic training data; no PII, customer data, or
production secrets

## 1. Scope and trust boundaries

The host starts three local child processes over stdio. Those processes run as
the current operating-system user, so MCP configuration is not an OS sandbox.
The practical assets are the fixed homework ground truth in
`app/data/catalog.json`, the local memory graph, the repository contents, and
any environment variables the host might pass to child processes.

| Server | Data or resources it can reach | Secrets | Can write? | Trust in author |
|---|---|---|---|---|
| `catalog-filesystem` | Configured fallback scope: `${MCP_PROJECT_DIR}/app/data`. A direct client without Roots resolved this to this repository's `app/data` and denied a read of root `README.md`. A Roots-capable host can replace this allowlist. | No credential is configured. It may receive environment inherited from the host. | **Yes.** Its advertised tools include `write_file`, `edit_file`, `create_directory`, and `move_file` within the effective allowed directories. | Official Model Context Protocol reference server, pinned to `2026.7.10`. Third-party code still runs locally. |
| `project-memory` | Dedicated `${MCP_PROJECT_DIR}/.mcp-memory.jsonl` knowledge graph. The file is gitignored. | No credential is configured. Do not put secrets in observations. It may receive environment inherited from the host. | **Yes, within its graph.** It creates and deletes entities, relations, and observations. It has no catalog-write tool. | Official Model Context Protocol reference server, pinned to `2026.7.4`. |
| `catalog-server` | Fixed `app/data/catalog.json` path reached through the imported `loadCatalog()` API; exposes four tools and `inventory://catalog`. | No credential is configured. The implementation does not read environment variables. | **No.** All registered capabilities only read and calculate. There is no write, delete, shell, or network code. | First-party code in this repository, using locked `@modelcontextprotocol/server` `2.0.0`. |

`MCP_PROJECT_DIR` itself is not a secret. It is an absolute path supplied by the
developer's environment. It intentionally has no default, so a missing value
fails server startup rather than silently selecting an unexpected directory.

## 2. Risks specific to this configuration

| Risk | What can happen here | Existing control | Residual risk |
|---|---|---|---|
| Prompt injection through catalog data | Both catalog servers return text originating in `catalog.json`. A malicious repository change could place instructions in a product field and try to redirect the model. | The current 24 records are synthetic, version-controlled, and reviewed; neither catalog server fetches external content. | A future contributor can still commit adversarial text. Tool/resource output must be treated as data, not instructions. |
| Persistent prompt injection through memory | An observation stored by the model or user can be returned in later sessions and influence future decisions. This can survive beyond the chat that created it. | Memory is restricted to a dedicated gitignored file and is documented for synthetic workshop notes only. | There is no content sanitization or provenance label. A poisoned graph must be reviewed or deleted manually. |
| Catalog corruption by filesystem tools | `write_file`, `edit_file`, or `move_file` can alter or remove `catalog.json`, invalidating the Task D ground truth. | The argument scope is only `app/data`; documentation instructs users not to approve mutating filesystem calls. Direct testing proved root `README.md` was inaccessible when the client did not provide Roots. | The upstream server has no read-only mode in this configuration. Human approval is procedural, not a technical write barrier. |
| Scope expansion through MCP Roots | A host that supplies Roots may replace the filesystem server's `app/data` argument with its launch directory or additional directories. That can expose more of the repository than intended. | The fallback argument is narrow, the actual tools were reviewed, and `list_allowed_directories` is available for runtime inspection. | Roots are coordination, not isolation. OS permissions still allow the process to access more if the server or dependency is malicious. |
| Incorrect or hostile `MCP_PROJECT_DIR` | A wrong value can point filesystem access at another `app/data`; it can also make `catalog-server` execute a different `mcp-server/dist/server.js`. | The value must be explicit and absolute; no `.` fallback exists. `.env.example` documents the expected shape. | The host does not authenticate the path. Developers must inspect the exported value before approving a changed configuration. |
| Secret exposure to local processes | No token is passed in `.mcp.json`, but a host may pass some of its environment to stdio children. A compromised npm package could inspect that environment. | The project needs no credentials; `.env` and key files are gitignored; the repository secret scan is clean. | This setup does not launch servers under a clean environment or separate OS user. Secrets exported globally in the host shell may still be exposed. |
| Dependency or package compromise | `npx -y` downloads and executes the two public packages. A compromised package or transitive dependency runs with the user's privileges. | Both public packages use exact versions rather than `latest`. The custom server has an exact dependency lockfile, and `npm audit` reported zero known vulnerabilities on 2026-08-19. | Exact versions prevent drift but do not prove publisher integrity; `npx` resolution is not vendored or independently checksummed here. Unknown vulnerabilities remain possible. |
| Malicious committed MCP configuration | A pull request could change `command`, `args`, or a package version so the host executes different code. | `.mcp.json` is reviewable in git, package versions are visible, and Claude Code required explicit project-server approval after the configuration changed. | Other hosts may have different approval behavior, and a careless reviewer can approve a malicious diff. |
| Stale or missing build output | `catalog-server` imports `app/dist` and runs `mcp-server/dist/server.js`. A stale build can serve logic different from the reviewed TypeScript; a fresh clone will fail until both packages are built. | Both build commands were run successfully, and the server README documents the required order. Direct MCP tests matched the seeded ground truth. | `dist/` is intentionally gitignored, and the host configuration does not build automatically. Developers must rebuild after source changes. |
| Local denial of service or malformed data | Invalid JSON, a missing catalog, or a very large future catalog can make calls fail or produce oversized responses. | The current catalog is small (24 records), SKU input is schema-validated, and the seeded application tests pass. | The custom server has no explicit output-size limit or recovery path for corrupt catalog data; acceptable for this fixed training dataset only. |

## 3. Mitigations actually applied

- Filesystem fallback access is limited to `${MCP_PROJECT_DIR}/app/data`, not
  the repository root, home directory, or `/`. A negative read test against
  root `README.md` returned an access-denied error.
- Memory persistence is explicitly redirected to `.mcp-memory.jsonl`; the file
  is gitignored and separated from catalog data.
- The custom server imports `loadCatalog`, `searchProducts`, `findBySku`,
  `lowStock`, `categories`, and `inventoryValue` from the tested application.
  It contains no filesystem write, delete, child-process, or network operation.
- All custom tools have Zod input schemas and advertise `readOnlyHint: true`,
  `destructiveHint: false`, `idempotentHint: true`, and
  `openWorldHint: false`.
- Public npm package versions and custom-server dependencies are pinned. The
  custom dependency tree is committed in `mcp-server/package-lock.json`.
- No server requires a token. `.env`, local variants, private keys, and the
  memory store are gitignored; only `.env.example` is committed. The current
  secret-pattern scan is clean.
- `fetch`, `git`, and token-based servers were deliberately not connected, so
  this setup has no external-content fetcher. State changes are limited to the
  filesystem server's effective scope and memory's dedicated local graph.
- Claude Code's project trust prompt was reviewed, all advertised tool names
  were recorded, and the custom server was tested through real `tools/list`,
  `tools/call`, `resources/list`, and `resources/read` requests.

## 4. Accepted risk

The filesystem server still exposes mutating tools, and the control against
using them is host approval plus developer discipline. MCP Roots may also make
its effective scope broader than the command-line fallback. These would require
a read-only filesystem mount, sandbox, separate OS user, or a different server
to close properly; none is configured for this homework.

The two npm reference servers and the first-party server run with the current
user's process privileges. They are not isolated from inherited environment or
protected by a package-signature verification step. The memory graph is local
and unencrypted, can be poisoned by stored text, and can be deleted by its own
tools. Build artifacts can become stale because `dist/` is not committed.

These risks are accepted only because this is a local educational repository
with synthetic, replaceable data and no credentials. The same design would not
be accepted for production inventory, customer information, or a developer
environment containing broadly scoped tokens.

## 5. Checklist before connecting another MCP server

- [x] I know the authorship of every current server: two official reference
      packages and one first-party implementation.
- [x] I inspected and recorded the tools each server advertises.
- [x] I configured the narrowest practical data paths and documented where
      Roots can weaken that assumption.
- [x] No secret is stored in a committed file; the current servers require no
      token.
- [x] I identified every state-changing tool and know that filesystem mutation
      and memory deletion require deliberate approval.
- [x] Public packages and custom dependencies are pinned as far as this
      exercise supports.
- [x] I recorded the residual risks that remain without OS-level isolation.

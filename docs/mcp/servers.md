# MCP-сервери проєкту (Task A)

**Хост, у якому налаштовано:** Claude Code (desktop app)
**Файл конфігурації:** `.mcp.json` (корінь репо)

---

## Сервер 1 — filesystem (`@modelcontextprotocol/server-filesystem`)

| | |
|---|---|
| **Навіщо** | Дає агенту читати `app/data/catalog.json` (і теоретично записувати в цю ж теку) без ручного вставляння вмісту файлу в чат — потрібно для Task D, де агент має сам порахувати ground truth. |
| **Транспорт** | stdio |
| **Як запускається** | `npx -y @modelcontextprotocol/server-filesystem@2026.8.31 ./app/data` |
| **Область доступу (scope)** | `app/data` — **не** корінь репо і тим більше не домашня тека. Каталог містить рівно один файл (`catalog.json`), потрібний для домену; сервер фізично не бачить `.env`, вихідний код, git-історію тощо, навіть якщо йому накажуть спробувати. |
| **Секрети** | Немає — сервер не потребує токена. |
| **Версія** | Зафіксована (`2026.8.31`, поточний `latest` на момент підключення), а не плаваючий тег — щоб оновлення пакету в npm registry не змінило поведінку сервера без нашого відома (supply-chain міркування, деталі в `docs/mcp/SECURITY.md`). |

**Які tools він дав агенту:** `read_file` (deprecated), `read_text_file`, `read_media_file`, `read_multiple_files`, `write_file`, `edit_file`, `create_directory`, `list_directory`, `list_directory_with_sizes`, `directory_tree`, `move_file`, `search_files`, `get_file_info`, `list_allowed_directories` — повний список отримано напряму через `tools/list` (stdio, без хоста):

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | npx -y @modelcontextprotocol/server-filesystem@2026.8.31 ./app/data
```

**Перевірка, що працює:** напряму по stdio (без хоста — поточна сесія Claude Code стартувала до появи `.mcp.json`, тож підхопить конфіг лише після рестарту) викликав `list_allowed_directories` → `read_text_file` на `catalog.json` і отримав список 24 товарів; спроба вказати шлях поза `app/data` (`../../catalog.ts`) відхиляється сервером з помилкою доступу — scope справді enforced на рівні процесу, а не лише позначений у конфізі. Фінальна перевірка «хост бачить tools» — окремим кроком після рестарту хоста (див. нижче).

**Що спостережено в stderr (важливий нюанс):**

```
Client does not support MCP Roots, using allowed directories set from server args: [
  'C:\Users\Home-User\Documents\Git\2026-udc-06-mcp-hw\app\data'
]
```

Це підтверджує з walkthrough: коли клієнт (наш CLI-виклик без підтримки `roots`) не передає `roots`, сервер відкочується до шляху з `args`. Тобто реальний scope у продакшн-хості міг би визначатись клієнтом (`roots`) замість аргументу — а `roots` за специфікацією є механізмом координації (сервер *SHOULD*, не *MUST*, його поважати) і позначений deprecated у ревізії `2026-07-28`. Справжня межа доступу — це те, з яким аргументом `args` процес фактично був запущений, тобто права ОС на цей шлях, а не домовленість протоколу.

---

## Сервер 2 — memory (`@modelcontextprotocol/server-memory`)

| | |
|---|---|
| **Навіщо** | Дає агенту тримати нотатки/проміжні висновки між викликами tools в межах однієї сесії (напр. «вже перевірив ці 3 SKU на low-stock») без повторного пере-читання каталогу — knowledge-graph поверх контексту розмови. |
| **Транспорт** | stdio |
| **Як запускається** | `npx -y @modelcontextprotocol/server-memory@2026.8.31`, з `MEMORY_FILE_PATH=./.mcp-memory/memory.json` |
| **Область доступу (scope)** | Сервер за замовчуванням пише JSON-файл кудись у теку встановленого npm-пакета (непередбачувано і поза контролем репо). Явно задали `MEMORY_FILE_PATH=./.mcp-memory/memory.json`, щоб знати точно, де саме зберігаються дані, і не дати серверу писати поза межами проєкту. `.mcp-memory/` додано в `.gitignore` — це згенерований локальний стан, а не джерело правди. |
| **Секрети** | Немає — сервер не потребує токена. |
| **Версія** | Зафіксована (`2026.8.31`), із тих самих міркувань, що й для filesystem. |

**Які tools він дав агенту:** `create_entities`, `create_relations`, `add_observations`, `delete_entities`, `delete_observations`, `delete_relations`, `read_graph`, `search_nodes`, `open_nodes` — отримано через той самий `tools/list` над stdio (без хоста).

**Перевірка, що працює:** напряму по stdio (той самий метод, без хоста — див. зауваження вище) викликав `tools/list`, отримав повний перелік 9 tools і `serverInfo` (`memory-server` v0.6.3).

---

## Сервер 3 — catalog (власний, Task B, `mcp-server/`)

| | |
|---|---|
| **Навіщо** | Власний read-only сервер над доменом каталогу з `app/`. Дає моделі структуровані tools (`search_inventory`, `check_stock`, `low_stock`) замість того, щоб читати `catalog.json` як сирий текст і рахувати вручну — саме це перевіряється A/B-тестом у Task D. |
| **Транспорт** | stdio |
| **Як запускається** | `node mcp-server/dist/server.js` (потребує попереднього `cd app && npm run build` і `cd mcp-server && npm install && npm run build` — інакше нема що імпортувати/запускати) |
| **Область доступу (scope)** | Увесь код процесу — наш власний, у репо (`mcp-server/src/server.ts`). Єдиний файл, який він читає, — `app/data/catalog.json`, і то через `loadCatalog()` з `app/dist/index.js`, а не напряму. Жодного запису, видалення чи мережевого виклику: усі три tools помічені `readOnlyHint: true, openWorldHint: false`. |
| **Секрети** | Немає — токен не потрібен. |
| **Версія SDK** | `@modelcontextprotocol/server@2.0.0` (v2). Сигнатури `registerTool`/`registerResource` звірені напряму з `.d.mts` встановленого пакета, а не зі статті. |

**Tools:** `search_inventory(query)` → `searchProducts`; `check_stock(sku)` →
`findBySku` + вердикт `OK`/`NEEDS REORDER`; `low_stock()` → `lowStock`.

**Resources:** `inventory://catalog` — JSON-зведення (кількість товарів,
категорії, `inventoryValue`); `inventory://categories` — унікальні категорії.

**Перевірка, що працює:** напряму по stdio (без хоста, `tools/list` +
`resources/list` + `tools/call low_stock` + `resources/read
inventory://catalog`) — усі 3 tools і 2 resources повернулись з коректними
описами й схемами; `low_stock` дав 9 SKU, `inventory://catalog` дав
`totalInventoryValue: 46152` — збігається з ground truth із
`materials/ab-question.md`. Детальніше — `mcp-server/README.md`.

---

## Що НЕ підключали і чому

- **git** та **fetch** (офіційні `uvx`-сервери) — на машині немає `uv`/Python, а walkthrough прямо радить не ставити Python заради домашки, коли достатньо двох npx-серверів.
- **fetch** окремо розглядали і свідомо не взяли б навіть за наявності `uv`: цей сервер ходить у мережу й повертає довільний веб-контент моделі як дані — найпряміший канал prompt injection (сторінка може містити текст, адресований агенту). Для задачі над локальним синтетичним каталогом мережевий доступ узагалі не потрібен, тож ризик не виправданий вигодою.

## Область доступу — головне

Найважливіший рядок вище — **scope filesystem-сервера: `app/data`**, а не корінь репо чи домашня тека. Каталог свідомо звужено до єдиного файлу, потрібного домену (`catalog.json`); навіть повна компрометація цього MCP-процесу не дає доступу до вихідного коду, `.env`, git-історії чи решти файлової системи користувача.

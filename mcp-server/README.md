# catalog-server — власний MCP-сервер (Task B)

Stdio-сервер над засіяним каталогом з `app/`. **Тонкий протокольний адаптер:**
жодного доменного правила тут не живе — усі числа приходять із
`app/src/catalog.ts` через `app/dist/index.js`.

- SDK: **v2** — `@modelcontextprotocol/server@2.0.0` (не v1
  `@modelcontextprotocol/sdk`)
- Транспорт: stdio
- Права: **read-only**, без мережі
- Конфіг хоста: entry `catalog` у [`.mcp.json`](../.mcp.json)

## Що виставляє

**4 tools** — у кожного `description` (за ним модель вирішує, чи викликати) і
схема вхідних параметрів:

| Tool | Вхід | Доменна функція | Коли викликається |
|---|---|---|---|
| `search_inventory` | `{ query: string }` | `searchProducts` | «які товари є», «що є в категорії audio», пошук за назвою/SKU |
| `check_stock` | `{ sku: string }` | `findBySku` | «скільки лишилось KB-1001», «чи треба його дозамовити» |
| `low_stock` | `{}` | `lowStock` | «що треба дозамовити / що закінчується» |
| `inventory_value` | `{}` | `inventoryValue` | «скільки коштує весь склад», «скільки капіталу в запасах» |

**1 resource:**

| URI | Тип | Вміст |
|---|---|---|
| `inventory://catalog` | `application/json` | `{ productCount, categories, totalValue, lowStockCount }` |

Порожні схеми задані **явно** як `z.object({})`, а не пропущені: вимога
завдання — схема в кожного tool, і порожній об'єкт прямо каже «аргументів не
приймає».

Кожен tool має `annotations: { readOnlyHint: true, idempotentHint: true,
openWorldHint: false }` і `outputSchema` + `structuredContent` — модель отримує
не лише текст, а й точні числа (`{"totalValue":46152}`), які не треба
перепарсювати з рядка.

### Чому саме такий поділ tool / resource

`inventory_value` і `inventory://catalog` **свідомо перекриваються** — обидва
віддають повну вартість складу. Tool — це дія, яку викликає модель; resource —
контекст, який читає застосунок за URI. Той самий факт, доступний двома
шляхами, робить спостережуваним у Task D, чи хост узагалі показує моделі
ресурси, чи вона обмежується tool calls. Що з цього вийшло — нижче, у розділі
«Що з'ясувалось про ресурси в Claude Code».

У ресурсі навмисно **немає таймстемпа**: однаковий вхід має давати однаковий
вихід, щоб два прогони A/B лишались побайтово порівнюваними.

## Read-only — і чим це підперто

- Єдиний I/O у процесі — `loadCatalog()`, який читає
  `app/data/catalog.json`. Жодного `writeFile`, `unlink`, `fetch`, `http`.
- Немає tool, який щось змінює: усі чотири лише читають і рахують.
- `readOnlyHint: true` видно **у протоколі**, а не лише в README — це той самий
  прапорець, за яким у Task A було знайдено 4 write-tools filesystem-сервера з
  `readOnlyHint: false`. Тут таких нуль.

Область доступу цього сервера **не залежить від конфіга й від клієнта**:
`app/src/loader.ts` резолвить шлях до даних від `import.meta.url`. Тобто —
на відміну від filesystem-сервера з Task A, де MCP roots **замістили** виданий
у конфізі шлях (див. [`docs/mcp/servers.md`](../docs/mcp/servers.md)) — тут
нема чого заміщувати: сервер фізично не приймає шлях ні від хоста, ні з
командного рядка.

## Збірка

`dist/` гітігнорований (`.gitignore:7`), тож **після клону збірка обов'язкова** —
інакше хост отримає `ERR_MODULE_NOT_FOUND` і сервер не з'явиться:

```bash
cd app && npm install && npm run build   # спершу домен: сервер імпортує app/dist
cd ../mcp-server && npm install && npm run build
```

Порядок важливий: `mcp-server` імпортує `../../app/dist/index.js`.

`src/` і `dist/` лежать на однаковій глибині навмисно — TypeScript **не
переписує** відносні імпорти при компіляції, тож `../../app/dist/index.js`
коректний і в джерелі, і в збірці.

Версії залежностей зафіксовано **lockfile'ом** (`package-lock.json`
закомічений), а не діапазонами в `package.json`. Це інший механізм, ніж у
Task A: там сервери запускаються через `npx -y`, у якого lockfile'а немає
взагалі, тому версію довелось пінити прямо в `.mcp.json`.

## Перевірка без хоста

Найшвидший спосіб відділити «сервер зламаний» від «модель не захотіла кликати
tool». Ground truth для порівняння:

```bash
cd app && node -e "import('./dist/index.js').then(m=>{const c=m.loadCatalog();\
console.log(m.lowStock(c).map(p=>p.sku).join(', '));console.log(m.inventoryValue(c));})"
# DK-4001, WC-8002, DS-6002, MS-2001, MN-3002, HS-5002, SS-1102, KB-1002, CB-7003
# 46152
```

Сам сервер, із теки `mcp-server/`:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  '{"jsonrpc":"2.0","id":3,"method":"resources/list"}' \
  '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"low_stock","arguments":{}}}' \
  '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"inventory_value","arguments":{}}}' \
  '{"jsonrpc":"2.0","id":6,"method":"resources/read","params":{"uri":"inventory://catalog"}}' \
  | node ./dist/server.js
```

Очікується: 4 tools зі схемами, 1 resource, `low_stock` → ті самі 9 SKU,
`inventory_value` → `46152`, resource → JSON-саммарі. Або через Inspector:

```bash
npx @modelcontextprotocol/inspector --cli node ./dist/server.js --method tools/list
```

Перевірено також, що сервер коректно відповідає на суміжні методи, які хост
може зачепити: `resources/templates/list` → `{"resourceTemplates":[]}`,
`ping` → `{}`, `prompts/list` → `-32601 Method not found` (правильно — prompts
не оголошені).

**Якщо даних немає** (свіжий клон без збірки `app/`), кожен tool і ресурс
віддають одне й те саме зрозуміле повідомлення з кодом помилки, але **без
абсолютного шляху**:

```
Catalog data is unavailable (ENOENT). This server reads the seeded catalog
through the compiled app/ build: run `npm run build` in app/ and confirm the
data file exists next to it.
```

Сервер при цьому не падає — `tools/list` продовжує працювати. До Task E тут
пролізав сирий `ENOENT` разом із повним шляхом до файлу; як це знайшлось
Інспектором — у [`docs/task-e-bonus.md`](../docs/task-e-bonus.md).

## Перевірка в хості

```bash
claude mcp list        # → catalog: node ./mcp-server/dist/server.js - ✔ Connected
claude -p "Call low_stock and inventory_value and print the raw results." \
  --allowedTools "mcp__catalog__low_stock,mcp__catalog__inventory_value"
```

Обидва tools повернули значення, що збігаються з ground truth (9 SKU, `46152`).

Перший запуск після клону покаже `⏸ Pending approval`: закомічений `.mcp.json`
описує сервер, але **не** дає йому довіри — Claude Code запитує підтвердження
окремо й пише його в `.claude/settings.local.json`
(`enabledMcpjsonServers`), який гітігнорований. Тобто конфіг у репо — це
пропозиція команді, а не автоматичне ввімкнення на чужій машині; погоджується
воно локально й на кожній машині окремо.

**Чому в `.mcp.json` відносний шлях.** `node ./mcp-server/dist/server.js`
працює, бо Claude Code запускає project-scoped сервери з кореня проєкту — і це
не припущення: власний лог хоста
(`~/Library/Caches/claude-cli-nodejs/<slug-репо>/mcp-logs-catalog/*.jsonl`)
пише `"cwd":"…/2026-udc-06-mcp-hw"` при кожному старті. Абсолютний шлях зробив
би закомічений конфіг непрацездатним у всіх, крім однієї машини. На всяк
випадок нагадування: навіть якби cwd був іншим, **дані** б завантажились — їх
шлях обчислюється від `import.meta.url`, а не від cwd; зламався б лише запуск
самого файлу сервера.

## Що з'ясувалось про ресурси в Claude Code

Хост бачить ресурс — у тому ж лозі при кожному підключенні:
`"hasTools":true,"hasPrompts":false,"hasResources":true`. Але доступ до нього з
боку моделі виявився нерівним, і це варто знати до Task D:

| Спроба | Результат |
|---|---|
| `resources/list` / `resources/read` напряму по stdio | ✅ працює, віддає JSON-саммарі |
| `ListMcpResourcesTool` з `server: "catalog"` (headless `claude -p`) | ✅ віддав `inventory://catalog` |
| `ListMcpResourcesTool` **без** параметрів (headless) | ❌ `No resources found` |
| `ReadMcpResourceTool` з `server`+`uri` (headless) | ❌ `Server "catalog" is not connected` — хоча tools того ж сервера в тій самій сесії викликались успішно |

Сервер тут ні до чого: по stdio всі три методи відповідають коректно (див.
вище). Тобто в цьому хості **tools — надійний шлях, ресурс — ні**, принаймні в
headless-режимі. Практичний висновок, який і закладено в дизайн: питання з
`materials/ab-question.md` має відповідатися **тільки tool calls**
(`low_stock` + `inventory_value`), а ресурс лишається бонусним каналом, а не
єдиним шляхом до числа. Перевірку в інтерактивному режимі (після перезапуску
хоста) робимо в Task D.

## Дрібниця про версію протоколу

README пакета `@modelcontextprotocol/server@2.0.0` заявляє спеку **2026-07-28**,
але в установленому `@modelcontextprotocol/core` стоїть
`LATEST_PROTOCOL_VERSION = "2025-11-25"`, і саме `2025-11-25` сервер віддає в
`initialize` — навіть якщо клієнт просить `2026-07-28`. Ще одне нагадування
звіряти поведінку зі **встановленою** версією, а не з README чи статті.

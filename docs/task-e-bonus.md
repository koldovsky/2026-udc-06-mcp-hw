# Task E (bonus) — Шлях 2: дебаг через MCP Inspector

**Сервер:** `mcp-server/` (`catalog-server` 1.0.0) — 4 tools + 1 resource.
**Інструмент:** `@modelcontextprotocol/inspector` 2.3.0 (`--cli`).
**Оточення:** Windows 10, Node v24.16.0, SDK `@modelcontextprotocol/server` 2.0.0, `zod` 4.4.3.

## Що робили

Запустили Inspector проти зібраного сервера — з кореня репо, тобто тим самим
шляхом і cwd, з яких сервер стартує хост:

```bash
npx -y @modelcontextprotocol/inspector --cli node ./mcp-server/dist/server.js --method tools/list
npx -y @modelcontextprotocol/inspector --cli node ./mcp-server/dist/server.js \
  --method tools/call --tool-name check_stock --tool-arg sku=KB-1001
```

Разом 8 сценаріїв: `tools/list`, `resources/list`, `resources/read`, happy path,
невідомий SKU, назва товару замість SKU, відсутній аргумент, зайвий аргумент.

> **Чому це мало сенс.** Сервер уже був зелений на `npm run check` і вже
> відпрацював у Task D. Але обидві перевірки викликали лише tools **без
> аргументів** (`low_stock`, `inventory_summary`). `search_inventory` і
> `check_stock` не викликав ніхто — Inspector став першим клієнтом, який до них
> дійшов.

## Що побачили

Inspector друкує **згенеровану JSON Schema**, а не zod-код — тобто рівно те, що
бачить модель:

| Tool | `properties` | `required` | Anno |
|---|---|---|---|
| `search_inventory` | `query: string` | **`["query"]`** | `readOnlyHint: true` |
| `check_stock` | `sku: string` | `["sku"]` | `readOnlyHint: true` |
| `low_stock` / `inventory_summary` | `{}` | — | `readOnlyHint: true` |

`resources/list` → `inventory://catalog`, `resources/read` віддав усі 24 товари.
Реальний виклик, `check_stock {"sku":"KB-1001"}`:

```jsonc
{ "content": [ { "type": "text",
    "text": "KB-1001 — Mechanical Keyboard TKL (peripherals) · 89 · stock 42/15\nOK — stock 42, reorder level 15." } ],
  "structuredContent": { "found": true, "sku": "KB-1001", "needsReorder": false,
    "product": { "sku": "KB-1001", "name": "Mechanical Keyboard TKL", "category": "peripherals",
                 "price": 89, "stock": 42, "reorderLevel": 15 } } }
```

`structuredContent` валідний проти `outputSchema` — хост парсить поле, а не текст.

## Що знайшли й полагодили

Обидва дефекти — **розбіжність між описом і схемою**. Опис каже моделі, *чи*
викликати tool; схема — *як* побудувати аргументи. Тут вони суперечили, і
перемагала схема.

### D-1. `search_inventory` вимагав `query`, хоча опис обіцяв протилежне

Опис: «An empty query returns the entire catalog». Схема: `"required": ["query"]`.
Виклик без аргументу:

```
{ "content": [ { "type": "text", "text": "Input validation error: Invalid arguments for tool
  search_inventory: query: Invalid input: expected string, received undefined" } ],
  "isError": true }
```

**Фікс:** `z.string().default("")` + вирівняний опис. Тепер `required` зник,
зʼявився `"default": ""`, виклик без аргументів повертає всі 24 товари.

### D-2. `check_stock` приймав будь-який рядок як SKU

Опис обіцяв «format XX-9999», схема — `{"type":"string"}` без обмежень. Модель,
яка знає назву, а не SKU, отримувала `found: false` — виглядає як «товару
немає», хоча товар є.

**Фікс:** формат перенесено з прози в схему, з підказкою куди йти далі:

```ts
const SKU_SHAPE = /^\s*[A-Za-z]{2}-\d{4}\s*$/;
sku: z.string().regex(SKU_SHAPE,
  "SKU must look like XX-9999 … Pass a product name to search_inventory instead.")
```

Дві перевірки **перед** тим, як звужувати:

- усі 24 SKU каталогу відповідають `^[A-Z]{2}-\d{4}$` — патерн не відсікає
  нічого, що `findBySku` знайшов би;
- пробіли й нижній регістр дозволені навмисно: `findBySku` робить
  `trim().toUpperCase()`, і **схема не має бути суворішою за домен**.

Два режими помилки лишились різними — це головне рішення тут:

| Вхід | Після фіксу | Чому |
|---|---|---|
| `"Mechanical Keyboard TKL"` | `isError` + «use search_inventory» | ретрай можливий і спрацює |
| `"ZZ-9999"` (форма ок, товару немає) | `found: false`, без змін | ретрай неможливий — `isError` дав би цикл |

### Знайдено, свідомо не чіпали

- **`low_stock` ігнорує зайві аргументи** (немає `additionalProperties: false`).
  Tool за описом покриває весь каталог і повертає всі 9 позицій, тож модель
  бачить розбіжність одразу; `.strict()` на no-arg tool ламався б від будь-яких
  метаданих хоста. Прийнятий ризик.
- **Обмеження Inspector, не сервера:** `--tool-arg sku=` відхиляє його власний
  парсер (`Invalid parameter format`). Порожній рядок через CLI не передати —
  цей кейс перевіряється прямим JSON-RPC у `scripts/check-mcp.mjs`.

## Лог: фікси закріплені в `npm run check`

Харнес пропустив дефекти не випадково — він **структурно не міг** їх побачити.
Додано три виклики з аргументами (id 6–8) і секцію «Argument handling»:

```
Argument handling
  ok    search_inventory {} -> all 24 products
  ok    check_stock rejects a product name and points at search_inventory
  ok    check_stock still accepts ' kb-1001 ' (trimmed, case-insensitive)
```

Третя перевірка стереже зворотний бік D-2 — щоб патерн не став суворішим за
`findBySku`. Що це тести, а не декорація, перевірено відкотом обох фіксів:

```
  FAIL  search_inventory {} -> isError, but the description says it lists everything
  FAIL  check_stock with a product name -> accepted; the SKU pattern is not being enforced
  ok    check_stock still accepts ' kb-1001 ' (trimmed, case-insensitive)

2 problem(s). See mcp-server/README.md.
```

Після відновлення `npm run verify` зелений: 8 тестів `app`, 11 перевірок
`check`, 13 перевірок проксі.

## Висновок

Inspector дає три речі, яких немає в «просто спробувати в чаті»:

1. **Контракт, а не поведінку.** У чаті видно лише те, що модель *вирішила*
   викликати. Обидва дефекти були видні в `tools/list` ще **до** будь-якого
   виклику — достатньо покласти опис поруч зі схемою.
2. **Виклики, яких модель не зробить.** Дефекти дожили до Task E саме тому, що
   жоден прогін не мав приводу торкнутись tools з аргументами. Модель
   намагається *успішно* відповісти, а не зламати сервер.
3. **Межу «сервер зламаний» / «модель не захотіла»** — ту саму, про яку
   попереджає `walkthrough.md`.

**Чесне обмеження:** Inspector не знайшов ці баги сам — він показав схеми, а
порівняння схеми з описом зробила людина. Це не лінтер, а **вікно у протокол**.

**Для цього репо:** харнес перевіряв, що сервер дає *правильні числа*, і жодного
разу — що в нього *придатний для моделі інтерфейс*. Це різні осі: помилки
домену і помилки протоколу. Після Task E `npm run check` перевіряє обидві.

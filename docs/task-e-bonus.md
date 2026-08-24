# Task E (bonus) — Шлях 2: дебаг через MCP Inspector

## Що робили

Запустили `@modelcontextprotocol/inspector` у CLI-режимі (не web UI — headless
середовище) напряму проти власного сервера, без хоста-посередника:

```bash
npx -y @modelcontextprotocol/inspector --cli node mcp-server/dist/server.js \
  --method tools/list --format json
```

І далі серію окремих `tools/call`/`resources/read` викликів з різними
аргументами — валідними, межовими й навмисно некоректними — щоб побачити
реальну поведінку схем і хендлерів, а не лише те, що написано в описах.

## Що побачили

- **`tools/list`** підтвердив три tools (`search_inventory`, `check_stock`,
  `low_stock`) з їхніми JSON-схемами, згенерованими з Zod — включно з
  `$schema: draft/2020-12` і `required` полями, точно так, як їх бачить
  будь-який MCP-клієнт, без жодної інтерпретації хостом.
- **`resources/read` на `inventory://catalog`** повернув очікуваний
  `{productCount: 24, categories: [...7...], totalInventoryValue: 46152}`.
- **Межові виклики `check_stock` показали, що схема поводиться коректно:**
  - невідомий SKU (`NOPE-9999`) → не `isError`, а звичайна текстова
    відповідь `"No product found..."` — правильний UX, не падіння;
  - `sku` у нижньому регістрі (`kb-1001`) → знайшло `KB-1001`, підтверджуючи
    заявлену в описі "case-insensitive" поведінку насправді, а не лише на
    словах;
  - відсутній обов'язковий `sku` → Zod коректно відхилив з
    `isError: true` і повідомленням `"expected string, received
    undefined"`;
  - `sku` числом замість рядка (`{"sku": 1001}`) → так само відхилено Zod
    з чіткою помилкою типу, а не мовчазним `NaN`/крашем.
- **Найцікавіше знайшлось у `search_inventory` з `query: ""`:** сервер не
  повернув помилку валідації і не порожній результат — він повернув **усі
  24 товари**. Схема (`z.string()`, без `.min(1)`) дозволяє порожній рядок,
  а `searchProducts` під капотом матчить порожній підрядок у будь-якому
  товарі, тож ефективно `query=""` (і будь-який пробільний рядок) працює як
  прихований "видати весь каталог". Це ніде не було задокументовано в описі
  tool.

## Що знайшли й полагодили завдяки цьому

Ця "прихована" поведінка `search_inventory` виявилась не гіпотетичною: у
Task D (`docs/ab-validation.md`) агент у Прогоні A сам здогадався викликати
`search_inventory` з `query: " "`, щоб отримати повний каталог і порахувати
`totalInventoryValue` самостійно — бо окремого tool для сукупної суми немає
(`inventoryValue` доступний лише через ресурс, а ресурси модель сама не
викликає). Тобто модель без підказки натрапила на недокументовану емерджентну
поведінку схеми.

Побачивши це в Inspector явно (а не здогадуючись за поведінкою агента
пост-фактум), полагодили: **явно задокументували цю поведінку в описі tool і
в описі параметра `query`**, замість того щоб або (а) мовчати про неї далі,
або (б) заборонити порожній рядок і зламати той самий шлях, яким агент
реально користується. Зміна — суто в `mcp-server/src/server.ts`:

```diff
     description:
       "Search the product catalog by name, SKU, or category. Use when the " +
-      "user asks what products exist or asks about a specific item.",
+      "user asks what products exist or asks about a specific item. An " +
+      "empty or blank query matches every product, so this also doubles " +
+      "as 'list the full catalog' — useful when you need to aggregate " +
+      "across all products (e.g. total inventory value) and no dedicated " +
+      "tool exists for that computation.",
     inputSchema: z.object({
       query: z
         .string()
-        .describe("Free-text match on product name, SKU, or category"),
+        .describe(
+          "Free-text match on product name, SKU, or category. Leave " +
+            "empty (or whitespace) to match every product.",
+        ),
     }),
```

Після зміни: перебудовано (`npm run build` у `mcp-server/`), повторно
перевірено через Inspector, що `query: ""` і далі повертає всі 24 товари
(поведінку свідомо НЕ ламали — вона корисна), і що `tools/list` тепер видає
оновлений опис. Тести домену (`cd app && npm test`) лишились зеленими — зміна
торкнулась лише опису/докстрінгу в `mcp-server/`, жодної логіки в `app/`.

## Скріншот/лог

```
$ npx -y @modelcontextprotocol/inspector --cli node mcp-server/dist/server.js \
    --method tools/call --tool-name search_inventory \
    --tool-args-json '{"query": ""}' --format json
{"result":{"content":[{"type":"text","text":"KB-1001 — Mechanical Keyboard TKL (peripherals) · 89 · stock 42\n...(24 рядки)..."}]}}
```

## Висновок

"Просто спробувати в чаті" показує лише ті виклики, які модель сама вирішила
зробити в конкретному діалозі — це вибіркова вибірка поведінки сервера, не
її повна карта. Inspector дав прямий, детермінований доступ до протоколу:
можна було цілеспрямовано прогнати межові випадки (порожній рядок, відсутнє
поле, неправильний тип, невідомий SKU), яких жоден природний промпт міг і не
викликати, і побачити точну JSON-схему, яку бачить кожен клієнт — а не
припущення про неї з опису tool. Саме так знайшлась різниця між "що написано
в описі" і "що насправді дозволяє схема" — а Task D незалежно показав, що ця
різниця не залишається теоретичною: модель її знаходить і використовує сама.

# Task E (bonus) — Шлях 2: MCP Inspector

Інші шляхи (крос-хост, сервер із токеном) не виконувались.

## Шлях 2 — дебаг через MCP Inspector

**Що робили:** Inspector проти власного `catalog` (`mcp-server/dist/server.js`), CLI-режим з walkthrough. Хост Cursor для цього не потрібен — Inspector сам піднімає stdio-клієнт, викликає метод і виходить.

Робоча тека: `mcp-server/`. Node на машині: `v20.13.1` (Inspector 2.2.0 попереджає `engines: >=22.19.0`; CLI все одно відпрацював).

```
npx --yes @modelcontextprotocol/inspector --cli node ./dist/server.js --method initialize
npx --yes @modelcontextprotocol/inspector --cli node ./dist/server.js --method tools/list
npx --yes @modelcontextprotocol/inspector --cli node ./dist/server.js --method resources/list
npx --yes @modelcontextprotocol/inspector --cli node ./dist/server.js --method tools/call --tool-name low_stock --tool-args-json "{}"
npx --yes @modelcontextprotocol/inspector --cli node ./dist/server.js --method tools/call --tool-name check_stock --tool-arg sku=ZZ-9999
npx --yes @modelcontextprotocol/inspector --cli node ./dist/server.js --method tools/call --tool-name check_stock
npx --yes @modelcontextprotocol/inspector --cli node ./dist/server.js --method resources/read --uri inventory://catalog
```

**Що побачили:**

- `initialize` — `serverInfo.name: catalog-server`, protocol `2025-11-25`, capabilities `tools` + `resources`.
- `tools/list` — три tools з описами «коли викликати» і Zod-схемами: `search_inventory` (`query` required), `check_stock` (`sku` required), `low_stock` (порожній object).
- `resources/list` — один resource `inventory://catalog` (`text/plain`).
- `low_stock {}` — 9 SKU, той самий порядок, що ground truth Task D (`DK-4001` … `CB-7003`).
- `check_stock sku=ZZ-9999` — текст `No product found for SKU "ZZ-9999".`, процес не впав.
- `resources/read` — `products: 24`, `inventoryValue: 46152`.
- `check_stock` без `sku` — SDK/Inspector повернули `isError: true`: `Invalid arguments for tool check_stock: sku: Invalid input: expected string, received undefined`. Exit code 5. Це валідація схеми, не необроблений exception.

**Що знайшли й полагодили завдяки цьому:** зламаного tool не виявилось: невідомий SKU уже оброблявся, `low_stock` і resource збігались із Task D. Inspector показав те, чого чат не показує як JSON-RPC: обов’язковість `sku` реально режеться схемою (`isError`), а не «тихим» порожнім рядком. Код через це не міняв — міняти було нічого. Окремо зафіксував: GUI Inspector/Vite хочуть новіший Node, ніж 20.13.1; для домашки достатньо `--cli`.

**Скріншот/лог (опційно):** уривок `tools/list` + виклик без `sku`:

```json
{
  "tools": [
    { "name": "search_inventory" },
    { "name": "check_stock" },
    { "name": "low_stock" }
  ]
}
```

```json
{
  "content": [
    {
      "type": "text",
      "text": "Input validation error: Invalid arguments for tool check_stock: sku: Invalid input: expected string, received undefined"
    }
  ],
  "isError": true
}
```

**Висновок:** Inspector відділяє «сервер зламаний» від «модель не викликала tool». У чаті Cursor видно вже вибір моделі; CLI показує сирий протокол, схеми й `isError` без UI-хоста. Для цього сервера він підтвердив контракт Task B (≥2 tools, 1 resource, read-only, правильні цифри) і що вхідна схема `check_stock` не порожня формальність.

# Task E (bonus) — Шлях 2: дебаг через MCP Inspector

## Що робили

Запустили MCP Inspector у CLI-режимі проти власного `catalog`-сервера
(stdio, без UI і без LLM у циклі):

```bash
cd mcp-server && npm run build
npx -y @modelcontextprotocol/inspector --cli node ./dist/server.js --method tools/list
npx -y @modelcontextprotocol/inspector --cli node ./dist/server.js \
  --method tools/call --tool-name check_stock --tool-arg sku=NOPE-0
npx -y @modelcontextprotocol/inspector --cli node ./dist/server.js --method resources/read --uri inventory://catalog
```

## Що побачили

- `tools/list`: 3 tools (`search_inventory`, `check_stock`, `low_stock`) з
  описами та JSON-схемами; `low_stock` — порожня схема, як і задумано.
- `resources/list` → `inventory://catalog`; `resources/read` повертає JSON:
  24 продукти, 7 категорій, вартість складу 46152.
- Реальні виклики: `search_inventory query=keyboard` → 2 позиції;
  `check_stock sku=kb-1001` → `stock 42, reorder level 15 → OK`;
  `low_stock` → 9 позицій, від `DK-4001` (0 шт.).
- Помилки: пропущений `sku` → відповідь із `isError: true` і текстом валідації
  від SDK (тобто сервер не падає, а віддає помилку моделі).

## Що знайшли й полагодили завдяки цьому

1. **`check_stock`: схема не відповідала опису.** Опис обіцяв формат `XX-9999`,
   але схема — просто `z.string()`. `sku=NOPE-0` проходив валідацію і доходив до
   пошуку; це виявилось лише прямим викликом. Фікс: `.trim().regex(/^[A-Za-z]{2}-\d{4}$/)`
   з повідомленням `SKU must look like KB-1001`. Тепер модель отримує
   зрозумілу помилку формату замість «не знайдено», а `" kb-1001 "` усе ще працює.
2. **`search_inventory`: порожній/пробільний `query` віддавав весь каталог**
   (24 рядки), бо `searchProducts` на порожньому запиті повертає все. Для
   агента це зайвий шум у контексті. Фікс: `.trim().min(1)`; логіку в `app/` не
   чіпали (сервер лишається тонким адаптером).

Після `npm run build` обидва випадки повторили Інспектором: `NOPE-0` і `" "`
тепер відхиляються валідацією, валідні виклики працюють як раніше.

## Висновок

Inspector дає детермінований, повторюваний виклик окремого tool з довільними
аргументами й показує сирі схеми та відповіді. У чаті модель сама «виправляє»
аргументи (нормалізує SKU, не шле порожні рядки), тому обидві діри там
непомітні — вони проявляються лише при прямому виклику.

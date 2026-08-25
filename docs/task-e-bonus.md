# Task E (bonus) — Шлях 2: дебаг через MCP Inspector

## Шлях 2 — дебаг через MCP Inspector

**Що робили:** Запустили Inspector у CLI-режимі напряму проти свого сервера (`mcp-server/dist/server.js`):

```bash
cd mcp-server
npx @modelcontextprotocol/inspector --cli node ./dist/server.js --method tools/list
npx @modelcontextprotocol/inspector --cli node ./dist/server.js --method tools/call --tool-name check_stock --tool-arg sku=kb-1001
npx @modelcontextprotocol/inspector --cli node ./dist/server.js --method tools/call --tool-name check_stock --tool-arg sku=ZZ-9999
npx @modelcontextprotocol/inspector --cli node ./dist/server.js --method tools/call --tool-name check_stock
npx @modelcontextprotocol/inspector --cli node ./dist/server.js --method tools/call --tool-name search_inventory --tool-arg query=audio
npx @modelcontextprotocol/inspector --cli node ./dist/server.js --method resources/read --uri "inventory://catalog"
```

**Що побачили:**

- `tools/list` повертає всі три tools з повними JSON-схемами (`search_inventory`
  вимагає `query: string`, `check_stock` — `sku: string`, `low_stock` без
  параметрів).
- `resources/read` для `inventory://catalog` повертає коректний JSON:
  `productCount: 24`, 7 категорій, `totalInventoryValue: 46152` — збігається
  з ground truth із Task D.
- `check_stock` з `sku=kb-1001`  знайшов `KB-1001` — case-insensitive
  пошук.

**Що знайшли й полагодили завдяки цьому:**

Усі перевірені edge-кейси відпрацювали коректно.



**Висновок:** Inspector дає детермінований виклик tool з точними аргументами, 
включно з навмисно некоректними (відсутній параметр, невідомий SKU). Швидший цикл фідбеку і покриття edge-кейсів, які модель у звичайному чаті могла б не викликати.
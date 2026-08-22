# Task E — MCP Inspector

## Шлях 2 — дебаг через MCP Inspector

**Що робили:** після `cd app && npm run build` і `cd mcp-server && npm install &&
npm run build` запустили:

```bash
npx @modelcontextprotocol/inspector --cli node ./dist/server.js --method tools/list
```

**Що побачили:** у `tools/list` з'явилися `search_inventory`, `low_stock` і
`check_stock`, кожен із description та Zod input schema. Окреме читання
`inventory://catalog` повернуло JSON із `productCount: 24`, сімома категоріями
та `inventoryValue: 46152`.

**Що знайшли й полагодили:** перевірили, що сервер імпортує `../../app/dist/index.js`
і запускається незалежно від поточного робочого каталогу; це підтвердило правильну
глибину `src/` і `dist/` та відсутність дублювання каталожної логіки.

**Висновок:** Inspector показує protocol-level names, схеми й реальні відповіді
до підключення host, тому відокремлює помилки MCP-сервера від помилок вибору
інструмента моделлю.

# catalog MCP-сервер

Read-only адаптер над `app/`: tools `search_inventory`, `check_stock`, `low_stock` і resource `inventory://catalog`. Логіка імпортується з `app/dist`, не дублюється тут.

## Збірка і запуск

Сервер уже лежить у `mcp-server/`. Спочатку зберіть домен, потім цей пакет:

```bash
cd app && npm install && npm run build
cd ../mcp-server && npm install && npm run build
npm start
```

`npm start` запускає `node ./dist/server.js` і чекає JSON-RPC на stdin — це нормально. У Cursor той самий файл стартує з `.cursor/mcp.json` (ключ `catalog`): `node ${workspaceFolder}/mcp-server/dist/server.js`.

На PowerShell 5 замість `&&` ставте `;`.

## Розкладка

```text
mcp-server/
├── src/server.ts
├── dist/server.js
├── package.json
└── tsconfig.json
```

`src/` і `dist/` на однаковій глибині, щоб імпорт `../../app/dist/index.js` працював і в джерелі, і після `tsc`.

## Перевірка без хоста

```bash
npx @modelcontextprotocol/inspector --cli node ./dist/server.js --method tools/list
```

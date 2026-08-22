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

На PowerShell 5 немає `&&`, а `;` **не** зупиняється після помилки. Після кожного `npm` перевіряйте `$LASTEXITCODE`, інакше `npm start` може піти після зламаної збірки:

```powershell
cd app
npm install; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm run build; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
cd ../mcp-server
npm install; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm run build; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm start
```

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

Потрібен Node.js ≥22.19.0 (`engines` у `@modelcontextprotocol/inspector@2.2.0`).

```bash
npx --yes @modelcontextprotocol/inspector@2.2.0 --cli node ./dist/server.js --method tools/list
```

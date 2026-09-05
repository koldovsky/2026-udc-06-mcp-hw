# `catalog-server` — власний MCP-сервер (Task B)

Read-only stdio-сервер над каталогом із `app/`. Тонкий протокольний адаптер:
уся доменна логіка (`searchProducts`, `findBySku`, `lowStock`, `categories`,
`inventoryValue`, `loadCatalog`) імпортується з `app/dist/index.js`, а не
переписується тут.

## Запуск

```bash
cd app && npm install && npm run build && cd ..   # сервер імпортує app/dist
cd mcp-server && npm install && npm run build
```

`mcp-server/dist/` **не комітиться** (у `.gitignore`) — це збірка, її
відтворюють локально командами вище.

Перевірити без хоста:

```bash
npx @modelcontextprotocol/inspector --cli node ./dist/server.js --method tools/list
npx @modelcontextprotocol/inspector --cli node ./dist/server.js --method resources/list
```

Або напряму по stdio (без Inspector) — приклад у `docs/walkthrough.md`.

Зареєстрований у кореневому `.mcp.json` під ім'ям `catalog`:

```json
"catalog": {
  "command": "node",
  "args": ["mcp-server/dist/server.js"]
}
```

Шлях відносний до кореня репо — Claude Code запускає project-scoped сервери
саме звідти.

## Що виставляє сервер

### Tools (модель викликає сама, за описом)

| Tool | Вхід | Доменна функція | Що повертає |
|---|---|---|---|
| `search_inventory` | `query: string` | `searchProducts` | рядки `SKU — назва (категорія) · ціна · залишок` |
| `check_stock` | `sku: string` | `findBySku` | залишок vs `reorderLevel` + вердикт `OK` / `NEEDS REORDER` |
| `low_stock` | — | `lowStock` | позиції, що потребують дозамовлення, від найменшого залишку |

Усі три помічені `annotations: { readOnlyHint: true, openWorldHint: false }` —
чесна декларація для хоста, що tool нічого не змінює і не ходить у мережу.

### Resources (application-контрольований контекст, читається за URI)

| URI | Вміст |
|---|---|
| `inventory://catalog` | JSON-зведення: кількість товарів, список категорій, `inventoryValue` |
| `inventory://categories` | JSON-масив унікальних категорій |

Різниця з tools: resource не викликається моделлю — хост читає його сам, коли
йому потрібен стан каталогу без окремого виклику.

## Read-only

Жодного tool, який пише файл, видаляє дані чи ходить у мережу. `loadCatalog()`
лише читає `app/data/catalog.json`; жодних `fetch`, `exec`, `writeFile` у
сервері немає.

## Чому SDK v2, а не v1

Встановлено `@modelcontextprotocol/server@2.0.0` (пакет `@modelcontextprotocol/server`,
не `@modelcontextprotocol/sdk`). Сигнатури `registerTool` / `registerResource`
звірені напряму з `.d.mts` встановленого пакета
(`node_modules/@modelcontextprotocol/server/dist/*.d.mts`), а не взяті зі
статті — API між поколіннями SDK відрізняється.

## Розкладка

```
mcp-server/
├── src/server.ts   ← джерело
├── dist/server.js  ← збірка (gitignored)
├── package.json
└── tsconfig.json
```

`src/` і `dist/` навмисно на однаковій глибині: TypeScript не переписує
відносні імпорти при компіляції, тож `../../app/dist/index.js` лишається
коректним і в джерелі, і в зібраному файлі.

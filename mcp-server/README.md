# `catalog-server` — власний MCP-сервер (Task B)

Тонкий протокольний адаптер над каталогом з `app/`. Уся доменна логіка
**імпортована** з `../../app/dist/index.js` — сервер лише форматує відповідь.
Правило «чи треба дозамовляти» сервер ніде не повторює: `check_stock` питає про це
`lowStock()`, а не порівнює `stock <= reorderLevel` вдруге. Інакше дві копії
правила розійшлися б щойно домен змінив критерій, і `check_stock` почав би
суперечити `low_stock` щодо того самого SKU.

- SDK: `@modelcontextprotocol/server` **2.0.0** (покоління v2) + `zod` 4
- Транспорт: stdio
- **Read-only:** жодного запису, видалення чи мережевого виклику

## Збірка і запуск

```bash
cd app && npm install && npm run build   # спершу домен — сервер його імпортує
cd ../mcp-server && npm install && npm run build
npm run smoke                            # перевірка: піднімає сервер і звіряє з доменом
```

`src/` і `dist/` навмисно на однаковій глибині: TypeScript **не переписує**
відносні імпорти, тож `../../app/dist/index.js` коректний і в джерелі, і в
збірці.

## Tools (4)

| Tool | Аргументи | Домен | Що повертає |
|---|---|---|---|
| `search_inventory` | `query: string` | `searchProducts` | Товари, де query збігається з назвою, SKU або категорією |
| `check_stock` | `sku: string` | `findBySku` + `lowStock` | Один товар + статус «треба замовити / OK», причому статус бере з `lowStock`, а не порівнює сам |
| `low_stock` | — | `lowStock` | Усі позиції зі `stock <= reorderLevel`, від найменшого запасу |
| `inventory_value` | — | `inventoryValue` | `sum(price × stock)` по всьому каталогу |

Усі чотири віддають `annotations.readOnlyHint: true` — сервер декларує свою
незмінність машинно-читано, а не лише текстом у README. Це той самий механізм,
яким `filesystem` позначає `write_file` як destructive (див.
`docs/mcp/servers.md`).

## Resource (1)

`inventory://catalog` — `application/json`: кількість товарів, список
категорій, скільки позицій треба замовити, загальна вартість запасів.

**Чому вартість є і в tool, і в ресурсі.** Ресурс — це контекст, який читає
*застосунок* за URI; модель його не викликає, і хости по-різному вирішують, чи
підтягувати ресурси взагалі. Питання Task D вимагає точної суми, тому вона
доступна ще й через tool `inventory_value` — інакше Run A міг би віддати
вгадане число, і A/B порівнював би поведінку хоста, а не наявність сервера.

## Реєстрація в хості

У `.mcp.json` в корені репо:

```json
"catalog": {
  "command": "node",
  "args": ["${CLAUDE_PROJECT_DIR:-.}/mcp-server/dist/server.js"]
}
```

Після зміни конфігу хост треба перезапустити.

## Перевірка без хоста

Найшвидший спосіб відділити «сервер зламаний» від «модель не захотіла
викликати tool»:

```bash
npm run smoke
# або
npx @modelcontextprotocol/inspector --cli node ./dist/server.js --method tools/list
```

`npm run smoke` піднімає зібраний сервер по справжньому stdio і звіряє
`low_stock`, `inventory_value`, `check_stock` та ресурс із результатами доменних
функцій — тобто ловить типові поломки: незібраний `app/dist`, зміну API SDK і
розходження `check_stock` з `low_stock` щодо того самого SKU. Він дотримується
lifecycle протоколу (нічого не надсилає до відповіді на `initialize`), а таймер у
ньому — лише шлях відмови, не умова успіху.

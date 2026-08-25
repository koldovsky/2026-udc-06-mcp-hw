# A/B-валідація MCP (Task D)

**Промпт (однаковий для A і B):**

> Which products in our catalog need reordering right now, and what is the
> total value of the stock we are currently holding? Give me the SKUs and
> the total as a number.

**Хост / модель:** Claude Code VS Code extension / Opus 5  
**Сервер під тестом:** `mcp-server/` (`search_inventory`, `low_stock`)

## Ground truth

Порахований локально, щоб було з чим звіряти:

```text
SKU, що потребують дозамовлення:
DK-4001, WC-8002, DS-6002, MS-2001, MN-3002, HS-5002, SS-1102, KB-1002, CB-7003

Загальна вартість запасів: 46152
```

Ground truth пораховано командою з `materials/ab-question.md` після build застосунку:

```bash
cd app && npm run build
node -e "import('./dist/index.js').then(m=>{const c=m.loadCatalog();console.log(m.lowStock(c).map(p=>p.sku).join(', '));console.log(m.inventoryValue(c));})"
```

## Прогін A — MCP підключено

**Що зробив агент:** спочатку викликав `Catalog [low_stock]`, який повернув 9 товарів, для яких `stock <= reorderLevel`. Для отримання даних, необхідних для розрахунку загальної вартості запасів, агент двічі викликав `Catalog [search_inventory]` з широкими запитами `a` та `e`, отримавши дані про товари, їх ціни та залишки. Після цього агент самостійно обчислив total.

**Відповідь:** агент повернув 9 SKU:

`DK-4001, WC-8002, DS-6002, MS-2001, MN-3002, HS-5002, SS-1102, KB-1002, CB-7003`

та загальну вартість запасів:

`46152`

**Правильно?** Так. Список SKU та total повністю збігаються з ground truth.

## Прогін B — MCP вимкнено

**Як саме вимикали:** `catalog` server було видалено з project-level MCP configuration командою `claude mcp remove --scope project catalog`, після чого VS Code host було перезапущено через `Developer: Reload Window`. Прогін виконано в новому чаті з тим самим prompt.

**Що зробив агент:** без custom catalog MCP агент сам дослідив репозиторій через Bash, прочитав `.mcp.json`, `app/data/catalog.json` та `mcp-server/src/server.ts`. Після цього він самостійно виконав Node.js код, який відтворив необхідні обчислення:

```js
const total = data.reduce((s,p) => s + p.price * p.stock, 0);
const low = data.filter(p => p.stock <= p.reorderLevel);
```

**Відповідь:** агент повернув ті самі 9 SKU:

`KB-1002, MS-2001, MN-3002, DK-4001, HS-5002, DS-6002, CB-7003, WC-8002, SS-1102`

та загальну вартість запасів:

`46152`

Порядок SKU відрізнявся від ground truth, але набір товарів був тим самим.

**Правильно?** Так. Список SKU повний, а total точно збігається з ground truth.

## Таблиця відмінностей

| Аспект | A (з MCP) | B (без MCP) |
|---|---|---|
| Викликав custom MCP tool | Так: `low_stock`, `search_inventory` | Ні |
| Список SKU повний | Так, усі 9 | Так, усі 9 |
| Загальна сума точна | Так, `46152` | Так, `46152` |
| Скільки кроків знадобилось | 3 MCP tool calls (`low_stock` + 2× `search_inventory`) та обчислення total | Дослідження repo, читання конфігурації, JSON і server source, потім власний Node.js розрахунок |
| Впевненість відповіді vs її правильність | Відповідь правильна і спирається на domain-specific MCP tools | Відповідь також правильна, але агенту довелося самостійно знайти дані та відтворити бізнес-правила |

## Висновок

У цьому експерименті custom MCP не змінив correctness: обидва прогони повернули правильні 9 SKU та total `46152`. MCP натомість дав агенту domain-specific interface і дозволив отримати low-stock список без самостійного пошуку даних та відтворення правила `stock <= reorderLevel`; без MCP агенту довелося дослідити репозиторій і написати власне обчислення.

Водночас Run A показав недолік поточного API: окремого tool для `inventoryValue` немає, тому агент двічі використав широкий `search_inventory` і сам рахував total. Для такого маленького локального каталогу простий файловий доступ уже достатній, а MCP стає ціннішим, коли доменна логіка складніша або її небезпечно дублювати.

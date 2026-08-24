# A/B-валідація MCP (Task D)

**Промпт (однаковий для A і B):** `Which products in our catalog need reordering right now, and what is the total value of the stock we are currently holding? Give me the SKUs and the total as a number.`
**Хост / модель:** Composer 2.5
**Сервер під тестом:** `inventory`

## Ground truth

Порахований локально, щоб було з чим звіряти:

```
SKU, що потребують дозамовлення: DK-4001, WC-8002, DS-6002, MS-2001, MN-3002, HS-5002, SS-1102, KB-1002, CB-7003
Загальна вартість запасів: 46152
```

порахували за допомогою команди з `materials/ab-question.md`:
```bash
cd app && npm run build
node -e "import('./dist/index.js').then(m=>{const c=m.loadCatalog();console.log(m.lowStock(c).map(p=>p.sku).join(', '));console.log(m.inventoryValue(c));})"
```


## Прогін A — MCP підключено

**Що зробив агент:** викликав лише tool `low_stock` з inventory mcp сервера. Потім агент все рівно виконав код:
```bash
cd /Users/nourish1709/VSCodeProjects/2026-udc-06-mcp-hw/app && node -e "import('./dist/index.js').then(m=>{const c=m.loadCatalog();console.log('SKUs:', m.lowStock(c).map(p=>p.sku).join(', '));console.log('Value:', m.inventoryValue(c));})"
```
і отримав відповідь:
```
SKUs: DK-4001, WC-8002, DS-6002, MS-2001, MN-3002, HS-5002, SS-1102, KB-1002, CB-7003
Value: 46152
```

**Відповідь:** 
```
Products that need reordering (stock at or below reorder level): 9 SKUs

DK-4001, WC-8002, DS-6002, MS-2001, MN-3002, HS-5002, SS-1102, KB-1002, CB-7003

Total value of stock on hand: 46152
```

**Правильно?** так

## Прогін B — MCP вимкнено

**Як саме вимикали:** прибрав з mcp.json + перезапустив Cursor. Також, переконався, що в налаштуваннях агента зник мій mcp сервер

**Що зробив агент:** прочитав ab-question.md, domain-brief.md, mcp-server/**/*, перевірив доступні tools та MCP сервери. Потім виконав наступну команду:
```bash
cd /Users/nourish1709/VSCodeProjects/2026-udc-06-mcp-hw/app && node -e "import('./dist/index.js').then(m=>{const c=m.loadCatalog();console.log('SKUs:', m.lowStock(c).map(p=>p.sku).join(', '));console.log('Total:', m.inventoryValue(c));})"
```
і отримав відповідь:
```
SKUs: DK-4001, WC-8002, DS-6002, MS-2001, MN-3002, HS-5002, SS-1102, KB-1002, CB-7003
Total: 46152
```

**Відповідь:** 
```
Products needing reordering (stock at or below reorder level):

SKUs: DK-4001, WC-8002, DS-6002, MS-2001, MN-3002, HS-5002, SS-1102, KB-1002, CB-7003

That is 9 products in total.

Total value of stock on hand: 46152

Computed from the catalog using lowStock() (items where stock <= reorderLevel) and inventoryValue() (sum(price × stock) across all 24 products).
```

**Правильно?** так

## Таблиця відмінностей

| Аспект | A (з MCP) | B (без MCP) |
|---|---|---|
| Викликав tool | так, `low_stock` | ні |
| Список SKU повний |так | так |
| Загальна сума точна | так | так |
| Скільки кроків знадобилось | 1 | 1 |
| Впевненість відповіді vs її правильність | висока | висока |

## Висновок

Результат А і В був однаковий. Агент впорався із задачаю і без MCP сервера. Використовуючи MCP сервер, агент все рівно потім порахував все вручну. Користь MCP в даному випадку була лише в тому, що можна було подивитися результат виклику `low_stock` та порівняти його з результатом, який повернув агент, що додає впевненості у відповіді. На мою думку, MCP сервер вартий своїх зусиль лише в окреимх випадках, коли його не можна замінити із skills, є необхідність робити особливі розрахунки, або доступатися до ресурсів, куди агент не може сам доступитися, та коли потрібна висока впевненість в результаті.

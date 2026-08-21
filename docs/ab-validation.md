# A/B-валідація MCP (Task D)

Промпт узято **дослівно** з `materials/ab-question.md`. Між прогонами A і B його не перефразовувати.

**Промпт (однаковий для A і B):**

```
Which products in our catalog need reordering right now, and what is the
total value of the stock we are currently holding? Give me the SKUs and
the total as a number.
```

**Хост / модель:** Cursor (цей репозиторій)
**Сервер під тестом:** `mcp-server/` (`search_inventory`, `check_stock`, `low_stock`; resource `inventory://catalog`)

## Ground truth

Пораховано локально через доменні функції `app/` (не вручну з JSON), командою з `materials/ab-question.md`. У PowerShell 5 замість `&&` використано `;`.

```
cd app
npm run build
node -e "import('./dist/index.js').then(m=>{const c=m.loadCatalog();console.log(m.lowStock(c).map(p=>p.sku).join(', '));console.log(m.inventoryValue(c));})"
```

Вивід:

```
DK-4001, WC-8002, DS-6002, MS-2001, MN-3002, HS-5002, SS-1102, KB-1002, CB-7003
46152
```

```
SKU, що потребують дозамовлення: DK-4001, WC-8002, DS-6002, MS-2001, MN-3002, HS-5002, SS-1102, KB-1002, CB-7003
Загальна вартість запасів: 46152
```

9 SKU, `stock <= reorderLevel`, порядок як у `lowStock` (найменший stock першим). Сума — `inventoryValue` = `sum(price * stock)` по всіх 24 товарах, округлення до центів.

## Прогін A — MCP підключено

Сесія: 18 серпня 2026, Cursor, цей репозиторій. Сервер `catalog` був у `.cursor/mcp.json` і доступний хосту як `project-0-2026-udc-06-mcp-hw-catalog` (status `ready`). Промпт подано дослівно, без перефразування.

**Що зробив агент:**

1. Запитав список tools сервера `catalog` (схеми, ще без доменного виклику).
2. Викликав tool `low_stock` без аргументів (порожній об’єкт) — повний список товарів зі `stock <= reorderLevel`.
3. Прочитав resource `inventory://catalog` — знімок каталогу з полем `inventoryValue`.

Не викликав `search_inventory` і `check_stock` (вони для пошуку і однієї SKU). `app/data/catalog.json` напряму не читав.

Сирі відповіді MCP:

- `low_stock` — 9 рядків, порядок від найменшого stock: `DK-4001` (0/8), `WC-8002` (1/5), `DS-6002` (2/3), `MS-2001` (3/20), `MN-3002` (4/6), `HS-5002` (5/12), `SS-1102` (6/10), `KB-1002` (8/15), `CB-7003` (9/40).
- `inventory://catalog` — `products: 24`; категорії; `inventoryValue: 46152`.

**Відповідь:** SKU `DK-4001`, `WC-8002`, `DS-6002`, `MS-2001`, `MN-3002`, `HS-5002`, `SS-1102`, `KB-1002`, `CB-7003`. Загальна вартість запасів: `46152`.

**Правильно?** Так. Список SKU і порядок збігаються з ground truth (`lowStock`). Сума збігається з `inventoryValue` (`46152`). Розбіжностей немає.

## Прогін B — без catalog MCP

Сесія: 18 серпня 2026, Cursor, цей репозиторій. Той самий промпт, без перефразування.

**Як саме вимикали:** ключ `catalog` у `.cursor/mcp.json` **не** видаляли (filesystem + memory + catalog лишились у файлі). Сервер вимкнули в UI Cursor (toggle), щоб хост не запускав `mcp-server/dist/server.js`. Стара сесія ще тримала tools `catalog` — перша спроба прогону B їх бачила. Після повторного прогону в новій сесії `GetMcpTools` показав лише `filesystem` і `memory`; `search_inventory` / `check_stock` / `low_stock` і resource `inventory://catalog` були відсутні.

**Що зробив агент:** не вгадував і не відмовився. Catalog MCP викликати було нічим. `memory` не чіпав. Пішов у filesystem:

1. `list_allowed_directories` → лише `D:\Development\Projects\Javascript\2026-udc-06-mcp-hw\app\data`.
2. `list_directory` на цей шлях → `[FILE] catalog.json`.
3. `read_text_file` → усі 24 товари.
4. Порахував з JSON сам: reorder = `stock <= reorderLevel` (сортування за зростанням `stock`); total = `sum(price × stock)` по всіх 24.

Доменні функції з `app/dist` не викликав.

**Відповідь:** SKU `DK-4001`, `WC-8002`, `DS-6002`, `MS-2001`, `MN-3002`, `HS-5002`, `SS-1102`, `KB-1002`, `CB-7003`. Загальна вартість запасів: `46152`.

**Правильно?** Так. Список SKU, порядок і сума збігаються з ground truth. Розбіжностей немає. Різниця з прогоном A не в правильності відповіді, а в шляху: замість `low_stock` + `inventory://catalog` агент прочитав `catalog.json` через filesystem і агрегував сам.

## Таблиця відмінностей

| Аспект | A (з catalog MCP) | B (без catalog MCP) |
|---|---|---|
| Викликав tool | так: `low_stock` + resource `inventory://catalog` (catalog MCP) | ні catalog-tools; замість них filesystem: `list_allowed_directories`, `list_directory`, `read_text_file` |
| Список SKU повний | так, 9 SKU, порядок як у `lowStock` | так, ті самі 9 SKU в тому ж порядку |
| Загальна сума точна | так, `46152` | так, `46152` |
| Скільки кроків знадобилось | 2 доменні виклики (tool + resource); JSON не читав | 3 filesystem-виклики + власна агрегація по 24 рядках |
| Впевненість відповіді vs її правильність | висока і виправдана: цифри прийшли з протестованого `app/` | висока теж виправдана: агент не вгадував, а порахував з того ж `catalog.json` |

## Висновок

**Catalog MCP не змінив правильність відповіді.** У прогоні B вимкнули лише його; filesystem і memory лишились доступними. І з catalog, і без нього агент дав ті самі 9 SKU і `46152` — змінився лише шлях. З catalog цифри йдуть з `lowStock` / `inventoryValue`. Без catalog MCP вистачило filesystem, обмеженого `app/data`: агент прочитав JSON і порахував сам (`memory` не використовував). Для цього маленького синтетичного каталогу власний catalog-сервер не обов’язковий, якщо вже є вузький файловий доступ. Він стає вартим ціни, коли правило не можна надійно відтворити з сирого файлу (інша БД, складніша доменна логіка, або коли агенту навмисно не дають сирий JSON). Чесний нульовий результат за точністю тут цінніший за вигадану різницю.

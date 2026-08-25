# A/B-валідація MCP (Task D)

**Промпт (однаковий для A і B):**

```text
Which products in our catalog need reordering right now, and what is the
total value of the stock we are currently holding? Give me the SKUs and
the total as a number.
```

**Хост / модель:** Claude Code / Claude Haiku 4.5 (`claude-haiku-4-5-20251001`)
**Сервер під тестом:** `mcp-server/` (tools: `low_stock`, `inventory_value`, `search_inventory`)

> Обидва прогони запускались через `claude -p "..." --output-format stream-json
> --permission-mode bypassPermissions` у новій сесії без попереднього контексту.
> Прогін B використовував `--strict-mcp-config --mcp-config .mcp_no_catalog.json`
> — тобто catalog-сервер повністю відсутній, filesystem і memory залишились.

---

## Ground truth

Пораховано локально командою з `materials/ab-question.md`:

```bash
cd app && npm run build
node -e "import('./dist/index.js').then(m=>{const c=m.loadCatalog();console.log(m.lowStock(c).map(p=>p.sku).join(', '));console.log(m.inventoryValue(c));})"
```

```text
SKU, що потребують дозамовлення: DK-4001, WC-8002, DS-6002, MS-2001, MN-3002, HS-5002, SS-1102, KB-1002, CB-7003
Загальна вартість запасів: 46152
```

9 SKU, значення $46 152.00.

---

## Прогін A — MCP підключено

**Що зробив агент:**
1. `Read(app/AGENTS.md)` — прочитав контекст проєкту (що є catalog-сервер)
2. `Glob("mcp-server/**/*.{js,ts,json}")` — знайшов побудовані файли сервера
3. `ToolSearch("select:mcp__catalog__low_stock,mcp__catalog__inventory_value,...")` — завантажив схеми catalog-tools
4. `mcp__catalog__low_stock({})` — отримав список товарів, що потребують дозамовлення
5. `mcp__catalog__inventory_value({})` — отримав загальну вартість запасів

**Відповідь:**

```text
Products needing reordering (9 items):
DK-4001, WC-8002, DS-6002, MS-2001, MN-3002, HS-5002, SS-1102, KB-1002, CB-7003

Total inventory value: 46152.00
```

**Правильно?** Так — усі 9 SKU присутні, сума $46 152.00 точна.

---

## Прогін B — MCP вимкнено

**Як саме вимикали:** `--strict-mcp-config --mcp-config .mcp_no_catalog.json` — перезапуск у новій сесії лише з filesystem і memory серверами. Сталий catalog-процес відсутній.

**Що зробив агент:**
1. `Glob("**/*.json")` — шукав JSON-файли у репо
2. `Read("C:/.../2026-udc-06-mcp-hw")` — спробував прочитати директорію (не файл)
3. `Read("C:/.../app/data/catalog.json")` — прочитав сирий файл каталогу напряму

Після прочитання `catalog.json` агент вручну перерахував товари зі `stock <= reorderLevel` і підсумував `price * stock`.

**Відповідь:**

```text
SKUs Requiring Reorder:
KB-1002, MS-2001, MN-3002, DK-4001, HS-5002, CB-7003, WC-8002, DS-6002, SS-1102

Total Stock Value: $55,722
```

**Правильно?** Частково — список із 9 SKU правильний, але **сума хибна**: $55 722 замість $46 152 (похибка ~+$9 570, або ~21%).

---

## Таблиця відмінностей

| Аспект | A (з MCP) | B (без MCP) |
|---|---|---|
| Як отримав дані | Виклик `mcp__catalog__low_stock` і `mcp__catalog__inventory_value` | Прочитав `catalog.json` напряму, обчислив вручну |
| Список SKU повний (усі 9) | Так ✓ | Так ✓ (порядок різний) |
| Загальна сума точна ($46 152) | Так ✓ | **Ні ✗** — відповів $55 722 |
| Скільки tool-calls знадобилось | 5 (2 catalog + 3 орієнтування) | 3 (filesystem) |
| Впевненість vs правильність | Відповідь без застережень — і точна | Відповідь без застережень — але арифметика хибна |

---

## Висновок

MCP-сервер змінив **якість арифметики**, але не вплинув на здатність знайти список SKU. Агент в обох прогонах правильно визначив 9 товарів, що потребують дозамовлення — у Прогоні B йому вистачило прямого читання JSON. Проте для агрегованого числа (`sum(price × stock)` для 24 рядків) ручне обчислення дало похибку ~21%. Catalog-сервер усунув її за рахунок делегування математики протестованому коду бібліотеки.

Це ілюструє основний кейс для власного MCP-сервера: **він вартий витрат тоді, коли агентові треба агрегувати або фільтрувати дані за бізнес-правилами, а не просто прочитати файл**. Якщо питання — «покажи мені рядок», достатньо filesystem. Якщо питання — «порахуй щось», спеціалізований tool з протестованою логікою надійніший за LLM-арифметику над сирим JSON.

# `catalog-server` — власний MCP-сервер (Task B)

Тонкий протокольний адаптер над каталогом з `app/`. Уся доменна логіка
імпортована з `app/dist/index.js` — у цьому пакеті немає жодного бізнес-правила.

- **SDK:** v2, `@modelcontextprotocol/server@2.0.0` — пін точною версією (не v1 `@modelcontextprotocol/sdk`).
  Сигнатури звірені з `.d.mts` встановленої версії, а не зі статті.
- **Транспорт:** stdio — хост сам запускає процес.
- **Права:** read-only. Жодного запису, видалення чи мережевого виклику.

## Tools (4)

| Tool | Аргументи | Доменна функція | Навіщо |
|---|---|---|---|
| `search_inventory` | `query?: string` | `searchProducts` | Пошук за назвою, SKU або категорією. Аргумент **необов’язковий**: без нього → весь каталог |
| `check_stock` | `sku: string`, патерн `XX-9999` | `findBySku` + `lowStock` | Один товар: залишок проти `reorderLevel` + вердикт «треба замовляти» |
| `low_stock` | — | `lowStock` | Усе, що на рівні перезамовлення або нижче |
| `inventory_summary` | — | `categories`, `lowStock`, `inventoryValue` | Кількість товарів, категорії, скільки треба замовити, загальна вартість запасу |

Обмеження в колонці «Аргументи» — не косметика: обидва додано після дебагу
Inspector’ом, разом із регресійними перевірками в `npm run check`. Що саме було
зламано і чому фікс саме такий — [`docs/task-e-bonus.md`](../docs/task-e-bonus.md).

Кожен tool має `description`, `inputSchema` **і** `outputSchema` — тобто
повертає ще й `structuredContent`, який хост парсить без вгадування за текстом.
Текстовий блок лишається для моделей, що ігнорують структуру.

## Resource (1)

| URI | Вміст |
|---|---|
| `inventory://catalog` | Усі 24 товари як JSON |

**Чому підсумок — це tool, а не resource.** Resource — контекст, керований
*застосунком*: хост вирішує, чи підчепити його, і модель не може його
попросити. Tool — дія, яку викликає *модель*. Питання Task D («яка загальна
вартість запасу?») модель має вміти дістати сама, тому підсумок живе в
`inventory_summary`, а не лише за URI.

## Read-only: що це означає тут

Кожен tool позначений анотаціями:

```ts
{ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
```

> ⚠️ Анотації — **самодекларація сервера, а не гарантія**. Специфікація прямо
> каже: «clients should never make tool use decisions based on `ToolAnnotations`
> received from untrusted servers». Тут вони чесні, бо сервер наш і в ньому
> фізично немає write-шляху — єдиний I/O це `loadCatalog()`, тобто читання
> одного JSON. Але покладатись на анотації чужого сервера не можна: та сама
> історія *SHOULD*, а не *MUST*, що й із `roots` — див.
> [`docs/mcp/SECURITY.md`](../docs/mcp/SECURITY.md), T-2 і T-3.

## Збірка і запуск

З кореня репо, однією командою — порядок важливий, сервер імпортує `app/dist`:

```bash
npm run setup     # install + build у app/ і в mcp-server/
npm run check     # перевірка, що сервер відповідає і числа збігаються
```

Хост запускає його сам — конфіг у `.mcp.json` в корені репо:

```json
"catalog": { "command": "node", "args": ["./mcp-server/dist/server.js"] }
```

## Перевірка без хоста

Найшвидший спосіб відділити «мій сервер зламаний» від «модель не захотіла
викликати tool» — `npm run check` з кореня репо. Він запускає сервер так
само, як хост (з кореня, не з `mcp-server/`), і звіряє відповіді з ground
truth, порахованою тут-таки з `app/dist`, а не зашитою в скрипт.

Якщо треба побачити **сирі кадри** JSON-RPC — те саме, але з дампом протоколу:

```bash
npm run probe
```

Працює однаково в PowerShell, Git Bash і на macOS/Linux, бо це node-скрипт, а
не shell-однорядковик.

Стороннім клієнтом — MCP Inspector. Зверніть увагу на шлях: з кореня репо це
`./mcp-server/dist/server.js`, а не `./dist/server.js`:

```bash
npx @modelcontextprotocol/inspector@2.3.0 --cli node ./mcp-server/dist/server.js --method tools/list
```

Очікуваних чисел тут навмисно немає: `npm run check` рахує ground truth з
`app/dist` під час запуску й звіряє сам. Записаний результат перевірки —
у [`docs/mcp/servers.md`](../docs/mcp/servers.md), розділ «Сервер 3».

## Якщо щось не працює

| Симптом | Причина |
|---|---|
| `ERR_MODULE_NOT_FOUND` про `app/dist/index.js` | Не зроблено build в `app/`. Сервер імпортує зібраний домен, не джерела. Фікс: `npm run setup` з кореня |
| `Cannot find module …\dist\server.js` | Запущено з іншої теки, ніж передбачає команда. З кореня репо шлях — `./mcp-server/dist/server.js`; голе `./dist/server.js` коректне лише якщо ви вже в `mcp-server/`. Хост запускає сервер саме з кореня, тож звіряйтесь із ним |
| Сервер стартує, але хост **не бачить** tools | У `.claude/settings.json` `enableAllProjectMcpServers: false`, тож ім'я сервера має бути в `enabledMcpjsonServers`. Без цього хост мовчки ігнорує запис у `.mcp.json` |
| Свіжий клон: хост не може запустити сервер | Обидва `dist/` у `.gitignore` — це правильно для артефактів збірки, але означає, що після клону сервера просто немає на диску. Фікс: `npm run setup`, перевірка: `npm run check` |
| Протокол «ламається» на рівному місці | Щось написало в **stdout**. Там можуть бути тільки кадри JSON-RPC; будь-який `console.log` руйнує потік. Логи — тільки в stderr (`console.error`) |

## Розкладка

```text
mcp-server/
├── src/server.ts   ← єдиний файл сервера
├── dist/server.js  ← збірка (gitignored)
├── package.json
└── tsconfig.json
```

`src/` і `dist/` навмисно на однаковій глибині: TypeScript **не переписує**
відносні імпорти при компіляції, тож `../../app/dist/index.js` коректний і в
джерелі, і в збірці. Якщо покласти `server.ts` у корінь пакета — воно
скомпілюється без попереджень і впаде на старті.

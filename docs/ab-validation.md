# A/B-валідація MCP (Task D)

**Промпт (однаковий для A і B):**
```
Which products in our catalog need reordering right now, and what is the
total value of the stock we are currently holding? Give me the SKUs and
the total as a number.
```
**Хост / модель:** Claude Code CLI (headless, `claude -p ... --output-format
stream-json`), модель `claude-sonnet-5`. Не інтерактивний чат у VS Code
екстеншені — той не мав живого підключення до `.mcp.json` цього проєкту
(перевірено: жоден `mcp__catalog__*` tool не резолвився через `ToolSearch`),
тому обидва прогони зроблено окремими headless-процесами `claude` з
терміналу — кожен процес сам по собі є "новим чатом", а різний
`--mcp-config` між прогонами відтворює саме "прибрали сервер і перезапустили
хост" з методики завдання.
**Сервер під тестом:** `mcp-server/` (`search_inventory`, `check_stock`,
`low_stock`, ресурс `inventory://catalog`)

## Ground truth

Порахований локально, щоб було з чим звіряти:

```
SKU, що потребують дозамовлення (9): DK-4001, WC-8002, DS-6002, MS-2001, MN-3002, HS-5002, SS-1102, KB-1002, CB-7003
Загальна вартість запасів: 46152
```

Команда з `materials/ab-question.md`:
```bash
cd app && npm run build
node -e "import('./dist/index.js').then(m=>{const c=m.loadCatalog();console.log(m.lowStock(c).map(p=>p.sku).join(', '));console.log(m.inventoryValue(c));})"
```

## Прогін A — MCP підключено

Команда: `claude -p "<промпт>" --output-format stream-json --permission-mode
bypassPermissions --setting-sources project` у корені репо (підхоплює
`.mcp.json` як є, з зареєстрованим `catalog`).

**Що зробив агент:** 3 виклики інструментів, 4 "ходи":
1. `ToolSearch` з запитом `select:mcp__catalog__low_stock,mcp__catalog__search_inventory,mcp__catalog__check_stock`
   — резолвнув схеми деферред MCP-tools (стандартна поведінка цього хоста:
   MCP-tools лежать деферред, доки на них явно не запитають).
2. `mcp__catalog__low_stock` (без аргументів) — отримав повний список
   товарів, що потребують дозамовлення, разом зі stock/reorder level.
3. `mcp__catalog__search_inventory` з `query: " "` (пробіл, тобто
   "матчни все") — отримав повний каталог з цінами й залишками, щоб
   самостійно порахувати `sum(price * stock)`, бо `catalog`-сервер не
   виставляє окремий tool для сукупної вартості (`inventoryValue` доступний
   лише через ресурс `inventory://catalog`, а ресурс модель сама не
   викликає — це application-controlled контекст, не tool).

`check_stock` жодного разу не викликано — не потрібен, коли є `low_stock` і
повний список через `search_inventory`.

**Відповідь:**
> SKUs to reorder: DK-4001, WC-8002, DS-6002, MS-2001, MN-3002, HS-5002, SS-1102, KB-1002, CB-7003
> Total value of stock on hand: **46152**

**Правильно?** Так, точний збіг з ground truth і за списком SKU, і за сумою.

## Прогін B — MCP вимкнено

**Як саме вимикали:** окремий headless-процес `claude -p ...` із
`--strict-mcp-config --mcp-config <тимчасовий JSON без catalog>` (лишились
лише `filesystem` і `memory`). Кожен виклик `claude -p` — окремий процес
без жодного стану від попереднього, тобто ефект ідентичний "прибрали сервер
із конфігу і перезапустили хост": нового процесу просто нізвідки взяти
tools закритого сервера.

**Що зробив агент:** MCP `catalog`-tools недоступні (перевірено:
`ToolSearch` з запитом `"low_stock inventory catalog"` повернув `No matching
deferred tools found`). Агент не здогадувався і не читав `catalog.json`
вручну для вважати суму текстом — натомість пішов довшим шляхом через рідні
tools хоста (`Bash`, `Read`, не MCP):
1. `Bash: find . -maxdepth 3 ...` — розвідка структури репо.
2. `Read: .mcp.json` — побачив, що `catalog`-сервер там *описаний*.
3. `Read: mcp-server/src/server.ts` — прочитав, які функції сервер імпортує
   з `app/`.
4. `ToolSearch: "low_stock inventory catalog"` — переконався, що
   відповідного MCP-tool у цій сесії немає.
5. `Bash: git diff .mcp.json | ... && cat app/data/catalog.json | head ...`
   — розвідка різниці конфігу й сирих даних.
6. `Bash: node -e '...'` — **сам імпортував `app/dist/index.js` і викликав
   ті самі `loadCatalog`/`lowStock`/`inventoryValue`, які викликає й
   `mcp-server/`**, замість того щоб парсити JSON вручну чи прикидати суму.

Разом 6 викликів інструментів, 7 "ходів" — майже вдвічі більше, ніж у
прогоні A.

**Відповідь:** та сама таблиця з 9 SKU і **46152**, плюс чесна примітка від
агента:
> "I computed this directly via the `app/` catalog library (`lowStock` and
> `inventoryValue`) rather than through the new `catalog` MCP server, since
> that server was just added to `.mcp.json` and this session hasn't
> reconnected to pick it up yet — a restart would be needed..."

**Правильно?** Так — теж точний збіг з ground truth.

## Таблиця відмінностей

| Аспект | A (з MCP) | B (без MCP) |
|---|---|---|
| Викликав tool | Так, `mcp__catalog__low_stock` + `mcp__catalog__search_inventory` | Ні жодного MCP-tool; замість цього `Bash`/`Read` (нативні tools хоста) |
| Список SKU повний | Так, 9/9, точно | Так, 9/9, точно |
| Загальна сума точна | Так, 46152 | Так, 46152 |
| Скільки кроків знадобилось | 3 tool calls, 4 ходи | 6 tool calls, 7 ходів (майже вдвічі більше) |
| Впевненість відповіді vs її правильність | Впевнена і правильна | Впевнена і правильна, з чесною самопоясненою приміткою про відсутній tool |
| Як саме порахував суму | Витяг сирі дані через `search_inventory`, порахував сам | Викликав `inventoryValue()` напряму з `app/dist` — тобто ту саму бізнес-логіку, що й MCP-сервер, лише в обхід протоколу |

## Висновок

Різниця виявилась значно меншою, ніж очікувалось за методичкою: в обох
прогонах відповідь була **на 100% правильною**. MCP-сервер не був потрібен
для коректності — він був потрібен для *способу* її отримання. Без
`catalog`-сервера агент не почав вгадувати чи парсити JSON вручну, а
скористався тим, що це той самий хост (Claude Code), у якого вже є `Bash` і
`Read` як нативні tools, і просто викликав ті самі експортовані функції
`app/dist/index.js`, які імпортує й сам MCP-сервер — по суті обійшов
протокол MCP, дійшовши до тієї ж бізнес-логіки коротшим шляхом, доступним
лише тому, що агент працює всередині файлової системи проєкту напряму.

Це важливий сигнал про межу цінності `mcp-server/`: **у контексті хоста з
повним доступом до shell/filesystem того самого репозиторію, де лежить
бізнес-логіка, власний MCP-сервер економить не правильність, а кроки** —
рівно вдвічі менше tool calls (3 проти 6) і ходів (4 проти 7), тобто
менше токенів/часу/вартості на той самий правильний результат
(`total_cost_usd` 0.077 проти 0.102 — на ~30% дорожче без сервера). Якби
агент працював без доступу до shell цього репозиторію (інший хост, чужий
клієнт, обмежений sandbox без `Bash`), MCP-сервер був би не про зручність, а
про єдиний робочий шлях узагалі — саме такий сценарій і виправдовує його
існування.

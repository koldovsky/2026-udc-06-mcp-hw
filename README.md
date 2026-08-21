# UDC Workshop 6 — MCP (Model Context Protocol)

Домашнє завдання: підключити публічні MCP-сервери з безпечним скоупінгом,
зібрати **власний MCP-сервер** над засіяним каталогом товарів, описати
threat model і довести A/B-тестом, що сервер реально змінив результат.

👉 **Повні інструкції — [`docs/walkthrough.md`](docs/walkthrough.md)**

## Швидкий старт

```bash
gh repo fork koldovsky/2026-udc-06-mcp-hw --clone
cd 2026-udc-06-mcp-hw
git checkout -b ws06/<github-username>

npm run setup     # встановить і збере обидва пакети: app/ і mcp-server/
npm run verify    # тести app/ + перевірка, що MCP-сервер відповідає
```

| Команда | Що робить |
|---|---|
| `npm run setup` | `npm install` у корені (звідти запускається `filesystem`-сервер) + `npm install` і `npm run build` у `app/` та `mcp-server/` |
| `npm test` | Тести домену (має бути 8 зелених) |
| `npm run check` | Говорить з `mcp-server/` по stdio так само, як хост, і звіряє відповіді з ground truth |
| `npm run probe` | Те саме, але друкує сирі кадри JSON-RPC. Працює в будь-якій оболонці |
| `npm run test:proxy` | 13 спроб обходу фільтра `scripts/fs-proxy.mjs`: traversal, симлінки, 8.3-імена, device-шляхи |
| `npm run verify` | `test` + `check` + `test:proxy` разом |

`.mcp.json` хост читає **лише на старті**: після правки конфігу сервери в
поточній сесії лишаються старими, тож зміну треба перевіряти в новій. Ознака,
що проксі активний, — `list_allowed_directories()` повертає `…\app\data`, а не
корінь репо, і `.env` віддає `Refused by fs-proxy:`.

Обидва `dist/` і всі `node_modules/` гітігноряться, тому **після свіжого клону
`npm run setup` обов'язковий**: без нього `.mcp.json` вказує на два неіснуючі
файли — `mcp-server/dist/server.js` і
`node_modules/@modelcontextprotocol/server-filesystem/dist/index.js` — і хост не
запустить ні власний сервер, ні `filesystem`. Раніше другий підтягувався через
`npx` на льоту; тепер пакет пінований у `package-lock.json` за хешем, тож
поломка стала гучною замість тихої. `npm run check` ловить саме цей випадок і
каже, яку команду запустити.

## Що вже є в репо

| Шлях | Що це |
|---|---|
| `app/src/catalog.ts` | Чисті доменні функції — **не реалізовуйте їх заново в сервері, імпортуйте** |
| `app/src/loader.ts` | `loadCatalog()` — єдиний доступ до файлової системи |
| `app/data/catalog.json` | 24 синтетичні товари. **Не редагувати** — це ground truth для Task D |
| `app/AGENTS.md` | Baseline для `app/`; Task A додає сюди секцію `## MCPs` |
| `materials/domain-brief.md` | Що саме має виставляти ваш сервер |
| `materials/ab-question.md` | Фіксований промпт для A/B + як порахувати правильну відповідь |
| `docs/templates/` | Шаблони: `servers.md`, `SECURITY.md`, `ab-validation.md`, `task-e-bonus.md`, скелет сервера |
| `.env.example` | Зразок для секретів — реальний `.env` у `.gitignore` |

## Що створюєте ви

- `.mcp.json` / `.cursor/mcp.json` — конфіг підключених серверів (Task A)
- `docs/mcp/servers.md` — що підключено, з якою областю доступу (Task A)
- `app/AGENTS.md` → секція `## MCPs` (Task A)
- `mcp-server/` — власний сервер, ≥2 tools + ≥1 resource (Task B)
- `docs/mcp/SECURITY.md` — threat model (Task C)
- `docs/ab-validation.md` — A/B-порівняння (Task D)
- `docs/task-e-bonus.md` — бонус, один шлях (Task E)
- `package.json` + `scripts/check-mcp.mjs` — кореневі скрипти setup/verify

## Головне правило безпеки

Жодних реальних секретів у репозиторії. Токени — лише через `${ENV_VAR}` у
конфізі, значення — у `.env`, який гітігнориться. Перед PR:

```bash
git grep -nE "ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}" || echo "clean"
```

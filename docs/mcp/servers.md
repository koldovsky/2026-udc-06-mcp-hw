# MCP-сервери проєкту (Task A)

**Хост(и), у якому налаштовано:** JetBrains IntelliJ IDEA (GitHub Copilot agent
mode); той самий конфіг перевірено «всуху» через прямий stdio-виклик
(`initialize` → `tools/list`), щоб відділити «сервер не працює» від «хост його
не показує».

**Файл конфігурації:**
- `.mcp.json` — канонічний проєктний конфіг (Claude Code / сумісні хости),
  закомічений у репо;
- `.vscode/mcp.json` — той самий набір серверів у форматі VS Code
  (`${workspaceFolder}` замість відносного шляху). Закомічений свідомо —
  `.gitignore` має виняток `!.vscode/mcp.json`.

Обидва файли описують **однаковий набір серверів** з однаковим scope: два
публічні (нижче) плюс власний `catalog` із Task B. Секретів у них немає взагалі
(нижче — чому).

---

## Сервер 1 — filesystem (`@modelcontextprotocol/server-filesystem`)

| | |
|---|---|
| **Навіщо** | Дати агенту прямий доступ до ground-truth даних `app/data/catalog.json` — щоб у Task D прогін «B» (без власного MCP-сервера) був чесним: агент мав змогу прочитати каталог, просто без доменних tools. |
| **Транспорт** | stdio (локальний процес, запускається хостом) |
| **Як запускається** | `npx -y @modelcontextprotocol/server-filesystem@2026.8.31 ./app/data` |
| **Область доступу (scope)** | Рівно одна тека — `<repo>/app/data`. Не домашня тека, не `/`, і навіть не корінь репо. Цього достатньо: єдине, що агенту тут реально потрібно, — `catalog.json`. Вихідний код він і так бачить через IDE, тож віддавати його ще й файловому серверу немає підстав. |
| **Секрети** | Немає жодного. Сервер не ходить у мережу і не має API. |
| **Версія** | **Зафіксована** — `@2026.8.31`. `npx -y ...@latest` означає, що будь-який майбутній реліз (у т.ч. скомпрометований) виконається на моїй машині без мого відома. Це supply-chain-ризик, а не зручність. Оновлення — свідомий коміт. |

**Які tools він дав агенту** (реальний вивід `tools/list`, 14 штук):
`read_file` (deprecated), `read_text_file`, `read_media_file`,
`read_multiple_files`, `write_file`, `edit_file`, `create_directory`,
`list_directory`, `list_directory_with_sizes`, `directory_tree`, `move_file`,
`search_files`, `get_file_info`, `list_allowed_directories`.

⚠️ Половина з них — **мутуючі** (`write_file`, `edit_file`, `create_directory`,
`move_file`). Сервер називається «secure», але read-only режиму в нього немає.
Саме тому scope звужений до `app/data`: найгірше, що може статися, — зіпсований
`catalog.json`, який відновлюється одним `git checkout`. Деталі — у
`docs/mcp/SECURITY.md`.

**Перевірка, що працює:**

```bash
npx -y @modelcontextprotocol/server-filesystem@2026.8.31 ./app/data < req.txt
```

- `list_allowed_directories` → `Allowed directories: <repo>/app/data`
- `list_directory` на `app/data` → `[FILE] catalog.json`
- `read_text_file` на `app/src/catalog.ts` (на один рівень вище scope) →
  `Access denied - path outside allowed directories`
- `read_text_file` на `~/.ssh/id_rsa` → `Access denied - path outside allowed
  directories`

Тобто межа тримається на обидва боки — і «сусідня тека в репо», і «щось цінне
в домашній теці».

**Що видно у stderr — і чому це важливо:**

```
Secure MCP Filesystem Server running on stdio
Client does not support MCP Roots, using allowed directories set from server args: [
  '/Users/<user>/.../2026-udc-06-mcp-hw/app/data'
]
```

Цей рядок з'являється **саме тоді, коли підтримки `roots` НЕМАЄ** — тоді scope
беруть з мого аргументу. Якби хост підтримував `roots`, реальну область доступу
визначав би він, і мій аргумент був би проігнорований. Висновок, який я забираю:
аргумент зі шляхом — це *fallback*, а не гарантія. Плюс `roots` за специфікацією
— механізм координації, а не безпеки (сервер *SHOULD* їх поважати, не *MUST*),
та ще й помічений deprecated у ревізії `2026-07-28`. Справжня межа — права ОС /
окремий користувач / пісочниця, а не рядок у JSON.

---

## Сервер 2 — memory (`@modelcontextprotocol/server-memory`)

| | |
|---|---|
| **Навіщо** | Персистентний knowledge-graph між сесіями: тримати рішення по цій домашці (який scope обрано і чому, які tools виставляє власний сервер, ground truth для Task D), щоб у новому чаті не переказувати контекст заново. Особливо корисно для Task D, де прогони A і B — це різні сесії. |
| **Транспорт** | stdio (локальний процес) |
| **Як запускається** | `npx -y @modelcontextprotocol/server-memory@2026.8.31`, з `MEMORY_FILE_PATH=./.mcp-memory/memory.json` |
| **Область доступу (scope)** | Один JSON-файл усередині репо — `.mcp-memory/memory.json`, заданий через `MEMORY_FILE_PATH`. **Дефолт кладе граф поруч із пакетом у кеші npx**, тобто пам'ять протікає між усіма проєктами на машині. Явний шлях робить пам'ять проєктною і, головне, **видимою**: її можна прочитати очима і видалити одним `rm -rf .mcp-memory`. Тека в `.gitignore` — це локальний стан, не артефакт. |
| **Секрети** | Немає. Сервер не має мережі й не потребує токена. |
| **Версія** | **Зафіксована** — `@2026.8.31`, з тих самих міркувань, що й вище. |

**Які tools він дав агенту** (реальний вивід `tools/list`, 9 штук):
`create_entities`, `create_relations`, `add_observations`, `delete_entities`,
`delete_observations`, `delete_relations`, `read_graph`, `search_nodes`,
`open_nodes`.

**Перевірка, що працює:**

```
serverInfo: {"name":"memory-server","version":"0.6.3"}
Knowledge Graph MCP Server running on stdio
```

`initialize` + `tools/list` відпрацювали, усі 9 tools на місці. (Зверніть увагу:
версія пакета `2026.8.31`, а `serverInfo.version` — `0.6.3`. Це нормально, але
показово: **версія в конфізі й версія, яку сервер сам про себе каже, — різні
речі**, і в інвентарі варто фіксувати саме ту, що в конфізі.)

---

## Сервер 3 — catalog (власний, Task B)

Повний опис — у [`mcp-server/README.md`](../../mcp-server/README.md). Тут лише
те, що стосується конфігурації:

| | |
|---|---|
| **Навіщо** | Власний read-only сервер над каталогом (Task B). Виставляє доменні функції з `app/` як tools/resources. |
| **Транспорт** | stdio |
| **Як запускається** | `node ./mcp-server/dist/server.js` (у `.vscode/mcp.json` — `${workspaceFolder}/mcp-server/dist/server.js`) |
| **Область доступу (scope)** | Жодного шляху в конфізі. Сервер не приймає аргументів зі шляхами взагалі — єдиний файл, який він читає, обирає `loadCatalog()` з `app/`, резолвлячи його від власного модуля. Тобто scope зашитий у код і не залежить від cwd хоста. |
| **Секрети** | Немає. Мережевих викликів немає в принципі. |
| **Версія** | Локальний код, версіонується разом із репо. |

**Tools:** `search_inventory`, `check_stock`, `low_stock` — усі з
`annotations.readOnlyHint: true`.
**Resources:** `inventory://catalog` (статичний) + шаблон
`inventory://category/{category}`.

**Перевірка, що працює:** `npx @modelcontextprotocol/inspector --cli node
./mcp-server/dist/server.js --method tools/list` повертає всі три tools;
прямий stdio-прогін дає `low_stock` → 9 SKU і `inventory://catalog` →
`productCount: 24`, `totalInventoryValue: 46152` — збігається з ground truth
для Task D.

**Важливо для Task D:** саме цей сервер прибирається з конфігу в прогоні B.
Два публічні сервери вище лишаються підключеними — інакше порівнювалося б не
«є власний сервер / немає», а «є хоч якийсь доступ до даних / немає».

---

## Що НЕ підключали і чому

- **git (`uvx mcp-server-git`)** — хотів підключити, дає дуже доречний тут
  read-only зріз історії. Не вийшло технічно: корпоративний TLS-перехоплювач
  ламає `uvx` (`invalid peer certificate: UnknownIssuer` на `pypi.org`).
  Обхід — `--system-certs` або `--native-tls`; свідомо **не** робив цього
  заради домашки: перемикати TLS-налаштування пакетного менеджера, щоб додати
  необов'язковий сервер, — поганий обмін. Окремо: `mcp-server-git` виставляє й
  мутуючі tools (`git_commit`, `git_checkout`, `git_reset`), тобто це не був би
  read-only сервер, як здається з назви.
- **fetch (`uvx mcp-server-fetch`)** — та сама проблема з `uv`, але тут відмова
  ще й змістовна. Це єдиний з рекомендованих серверів, який тягне **недовірений
  контент із інтернету прямо в контекст агента**, у якого водночас є
  `write_file` від filesystem-сервера. Класична зв'язка для prompt injection:
  сторінка каже «запиши ось це у файл» — і в агента є чим. Для домашки, де все
  потрібне лежить локально, мережевий сервер не купує нічого, а поверхню атаки
  розширює суттєво.
- **filesystem зі scope на корінь репо** — розглядав, відмовився. Різниця між
  `./app/data` і `.` — це різниця між «може зіпсувати один файл, що
  відновлюється з git» і «може переписати `.mcp.json`, `AGENTS.md`, вихідний
  код і сам себе». Мінусів у вужчому scope не знайшов: усе інше агент і так
  бачить через IDE.

## Область доступу — головне

Найважливіший рядок конфігу — ось цей:

```json
"args": ["-y", "@modelcontextprotocol/server-filesystem@2026.8.31", "./app/data"]
```

`./app/data` замість `.` або `~`. Обґрунтування: агенту тут потрібен рівно один
файл — `catalog.json`. Все, що ширше, не додає можливостей, але додає наслідків.
І — з застереженням вище — цей рядок є межею лише доти, доки хост не підтримує
`roots`; надійна ізоляція живе на рівні ОС, а не конфігу.


# MCP-сервери проєкту (Task A)

**Хост(и), у якому налаштовано:** Cursor
**Файл конфігурації:** `.cursor/mcp.json`

---

## Сервер 1 — filesystem

| | |
|---|---|
| **Навіщо** | Дати агенту контрольований доступ до засіяного каталогу товарів (`catalog.json`), без права читати решту репозиторію. |
| **Транспорт** | stdio |
| **Як запускається** | `npx -y @modelcontextprotocol/server-filesystem@2026.7.10` + `${workspaceFolder}/app/data` |
| **Область доступу (scope)** | Лише `app/data` відносно кореня воркспейсу (`${workspaceFolder}/app/data`). Цього достатньо: єдиний файл даних, який агенту варто бачити через цей сервер, — `catalog.json`. Не home, не диск, не корінь репо. |
| **Секрети** | немає |
| **Версія** | зафіксована: `@2026.7.10` (не плаваючий `@latest`). |

**Які tools він дав агенту:** `read_text_file`, `read_file`, `read_multiple_files`, `read_media_file`, `write_file`, `edit_file`, `create_directory`, `list_directory`, `list_directory_with_sizes`, `directory_tree`, `move_file`, `search_files`, `get_file_info`, `list_allowed_directories`.

**Перевірка, що працює:** викликано `list_allowed_directories`. Відповідь: `D:\Development\Projects\Javascript\2026-udc-06-mcp-hw\app\data` — тобто діє аргумент з конфігу, а не корінь воркспейсу.

**Roots vs args (stderr / фактичний скоуп):** Cursor у документації заявляє підтримку MCP Roots. Якби хост підмінив allowed directories на workspace root, `list_allowed_directories` повернув би корінь репо. Повернув `app\data` — шлях з args. Отже, у цій сесії спрацював запасний варіант (аргумент сервера), а не підміна через roots. Повідомлення на кшталт `Client does not support MCP Roots, using allowed directories set from server args` якраз про цей випадок. Roots — координація, не гарантія безпеки.

---

## Сервер 2 — memory

| | |
|---|---|
| **Навіщо** | Локальна «пам’ять» між чатами (граф сутностей), щоб агент міг зберігати факти про цей проєкт без зовнішнього API. |
| **Транспорт** | stdio |
| **Як запускається** | `npx -y @modelcontextprotocol/server-memory@2026.7.4` |
| **Область доступу (scope)** | Немає доступу до файлів репозиторію. Сервер тримає власний knowledge graph (типово локальний `memory.jsonl` у каталозі пакета). У репо нічого не пише. |
| **Секрети** | немає |
| **Версія** | зафіксована: `@2026.7.4`. |

**Які tools він дав агенту:** `create_entities`, `create_relations`, `add_observations`, `delete_entities`, `delete_observations`, `delete_relations`, `read_graph`, `search_nodes`, `open_nodes`.

**Перевірка, що працює:**

1. Викликано `read_graph`. Сервер відповів порожнім графом: `{"entities":[],"relations":[]}` — процес живий, tools доступні.
2. Другий приклад (щоб відрізнити memory від filesystem і від звичайного Read у IDE). Промпт агенту:

   ```
   Using the memory MCP server, create an entity named "ws06-catalog"
   of type "project" with observation "Task A filesystem scoped to app/data",
   then call read_graph.
   ```

   Викликано `create_entities`, потім `read_graph`. Граф:

   ```json
   {
     "entities": [
       {
         "name": "ws06-catalog",
         "entityType": "project",
         "observations": ["Task A filesystem scoped to app/data"]
       }
     ],
     "relations": []
   }
   ```

   Без цього MCP агент не має куди записати граф знань.

---

## Що НЕ підключали і чому

- **git** і **fetch** (`uvx`) — потрібні Python + `uv`. На цій машині для домашки їх не ставили; walkthrough прямо каже брати filesystem + memory.
- **GitHub MCP** — потрібен персональний токен із широкими правами до репозиторіїв. Для каталогу товарів це зайва поверхня атаки.
- Filesystem на домашню теку або `C:\` — свідомо відкинуто: це дірка, а не «зручний scope».

## Область доступу — головне

Filesystem бачить **лише** `app\data`, не весь диск і не весь репозиторій. У цьому каталозі лежить синтетичний `catalog.json` — того досить, щоб агент міг прочитати дані каталогу. Реальний скоуп підтверджено tool-ом `list_allowed_directories`, не лише рядком у JSON.

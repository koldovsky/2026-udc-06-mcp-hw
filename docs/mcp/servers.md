# MCP-сервери проєкту (Task A)

**Хост(и), у якому налаштовано:** Claude Code (VS Code extension)
**Файл конфігурації:** `.mcp.json`

---

## Сервер 1 — filesystem

| | |
|---|---|
| **Навіщо** | Дає агенту читати `app/data/catalog.json` напряму через MCP-tool |
| **Транспорт** | stdio |
| **Як запускається** | `npx -y @modelcontextprotocol/server-filesystem ./app/data` |
| **Область доступу (scope)** | Аргумент у `.mcp.json` задає `./app/data`. Але виклик `list_allowed_directories` під час цієї сесії повернув корінь репозиторію, а не `app/data`. Офіційний filesystem-сервер: якщо клієнт підтримує roots, вони повністю замінюють аргумент командного рядка.  Файлів stderr-логів у репо не знайдено|
| **Секрети** | Немає |
| **Версія** | `@latest` |

**Які tools він дав агенту:** `read_text_file`, `read_file` (deprecated), `read_media_file`, `read_multiple_files`, `write_file`, `edit_file`, `create_directory`, `list_directory`, `list_directory_with_sizes`, `directory_tree`, `move_file`, `search_files`, `get_file_info`, `list_allowed_directories`

**Перевірка, що працює:** промпт: «проаналізуй каталог товарів через mcp». Агент викликав `list_directory("./app/data")`, отримав `catalog.json`, потім `read_text_file("./app/data/catalog.json")` і отримав сирий JSON усіх 24 товарів — на основі цих даних порахував inventory value, категорії та low-stock список.

---

## Сервер 2 — memory

| | |
|---|---|
| **Навіщо** | In-process скретчпад для нотаток агента протягом сесії  |
| **Транспорт** | stdio |
| **Як запускається** | `npx -y @modelcontextprotocol/server-memory` |
| **Область доступу (scope)** | Немає доступу до файлової системи чи мережі — власний knowledge graph, що існує лише в пам'яті процесу сервера й зникає, коли процес завершується |
| **Секрети** | Немає |
| **Версія** | `@latest` |

**Які tools він дав агенту:** `create_entities`, `create_relations`, `add_observations`, `delete_entities`, `delete_observations`, `delete_relations`, `read_graph`, `search_nodes`, `open_nodes`

**Перевірка, що працює:** викликано `create_entities` (створено тестову сутність `servers-md-check`), потім `read_graph` підтвердив, що сутність справді записана в граф, після чого `delete_entities` прибрав тестові дані (відповідь `{"success":true}`).


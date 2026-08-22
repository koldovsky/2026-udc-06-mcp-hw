# MCP-сервери проєкту (Task A)

**Хост:** Claude Code / сумісний MCP host  
**Файл конфігурації:** `.mcp.json`

## Сервер 1 — filesystem

| | |
|---|---|
| **Навіщо** | Читати синтетичний `catalog.json` для перевірок і порівняння з доменним API. |
| **Транспорт** | stdio |
| **Як запускається** | `npx -y @modelcontextprotocol/server-filesystem@2025.8.21 ${CLAUDE_PROJECT_DIR}/app/data` |
| **Область доступу (scope)** | Лише `${CLAUDE_PROJECT_DIR}/app/data`; цього достатньо для seeded catalog і не відкриває код, конфіги чи домашній каталог. |
| **Секрети** | Немає. |
| **Версія** | Зафіксована `2025.8.21`, щоб оновлення пакета не змінювало поведінку непомітно. |

**Tools:** `read_file`, `read_multiple_files`, `list_directory`, `directory_tree`,
`search_files`, `get_file_info`, `write_file`, `edit_file`, `create_directory`,
`move_file`.

**Перевірка:** запит читання `catalog.json` повернув 24 синтетичні товари; write
tools не викликалися, а сервер не може вийти за межі `app/data`.

## Сервер 2 — memory

| | |
|---|---|
| **Навіщо** | Зберігати короткі проєктні нотатки між запитами без надання доступу до файлів. |
| **Транспорт** | stdio |
| **Як запускається** | `npx -y @modelcontextprotocol/server-memory@2025.8.21` |
| **Область доступу (scope)** | Лише внутрішній memory store процесу; filesystem і мережевий доступ репозиторію не надаються. |
| **Секрети** | Немає. |
| **Версія** | Зафіксована `2025.8.21`. |

**Tools:** `create_entities`, `create_relations`, `add_observations`,
`delete_entities`, `delete_observations`, `delete_relations`, `read_graph`,
`search_nodes`, `open_nodes`.

**Перевірка:** створення і пошук тестової нотатки повернули той самий запис.
Цей сервер не використовується для обчислення каталогу.

## Сервер 3 — catalog

| | |
|---|---|
| **Навіщо** | Надати агенту перевірені read-only операції каталогу через один доменний API. |
| **Транспорт** | stdio |
| **Як запускається** | `node ${CLAUDE_PROJECT_DIR}/mcp-server/dist/server.js` |
| **Область доступу (scope)** | `app/data/catalog.json` опосередковано через `loadCatalog()`; сервер не приймає довільних шляхів. |
| **Секрети** | Немає. |
| **Версія** | Локальний код `1.0.0`, збірка з цього репозиторію. |

**Tools:** `search_inventory`, `low_stock`, `check_stock`. **Resource:**
`inventory://catalog`.

**Перевірка:** `tools/list` показав три tools, а читання ресурсу повернуло 24
товари, сім категорій і загальну вартість.

## Що НЕ підключали і чому

Не підключали GitHub MCP: для цього synthetic read-only завдання потрібен був би
зайвий токен і доступ до зовнішнього акаунта.

## Область доступу — головне

Filesystem обмежено `app/data`, а не репозиторієм, домашнім каталогом чи диском.
У `.mcp.json` шлях і шлях до локального сервера обчислюються від
`${CLAUDE_PROJECT_DIR}`; реальна межа доступу також залежить від прав ОС.

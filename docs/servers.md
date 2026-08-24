# MCP-сервери проєкту (Task A)


**Хост(и), у якому налаштовано:** Cursor
**Файл конфігурації:** `.cursor/mcp.json`

---

## Сервер 1 — filesystems

| | |
|---|---|
| **Навіщо** | надає доступ агенту до файлів на диску + моє знайомство з використанням MCP серверів |
| **Транспорт** | stdio |
| **Як запускається** | `npx -y @modelcontextprotocol/server-filesystem `> |
| **Область доступу (scope)** | ~/VSCodeProjects/2026-udc-06-mcp-hw/app/data/ . такий скоуп, щоб надати агенту інформацію лише до файлу з товарами |
| **Секрети** | немає |
| **Версія** | 2026.7.10 - остання версія, що позначена як "Built and signed with provenance" |

**Які tools він дав агенту:** read_file, read_text_file, read_media_file, read_multiple_files, write_file, edit_file, create_directory, list_directory, list_directory_with_sizes, directory_tree, move_file, search_files, get_file_info, list_allowed_directories

**Перевірка, що працює:** спитав агента, до яких файлів mcp filesystems має доступ. Він викликав tool list_allowed_directories та повернув відповідь, що має доступ до `~/VSCodeProjects/2026-udc-06-mcp-hw/app/data` та сабфолдерів

---

## Сервер 2 — memory

| | |
|---|---|
| **Навіщо** | надає можливість агенту зберігати та отримувати дані в пам'яті, яка буде спільна поміж сесіями |
| **Транспорт** | stdio |
| **Як запускається** | `npx -y @modelcontextprotocol/server-memory@2026.7.4 `> |
| **Область доступу (scope)** | ~/VSCodeProjects/2026-udc-06-mcp-hw/.cursor/memory.jsonl . доступ лише до файлу з пам'яттю |
| **Секрети** | MEMORY_FILE_PATH - шлях до файлу з пам'яттю |
| **Версія** | 2026.7.4 - остання версія, що позначена як "Built and signed with provenance" |

**Які tools він дав агенту:** create_entities, create_relations, add_observations, delete_entities, delete_observations, delete_relations, read_graph, search_nodes, open_nodes

**Перевірка, що працює:** попросив агента запамʼятати, що я не маю досвіду роботи з TypeScript, тому у коді, що агент пропоную, 
треба додавати детальніші пояснення до використовуваного API. В іншому чаті я попросив агента надати мені блок TS коду, що
створює input поле для паролю. В результуючому коді агент додав коментарі про використані класи та методи (напр., HTMLInputElement, document.createElement("input") тощо).

---

## Що НЕ підключали і чому

<коротко: який сервер розглядали, але свідомо не взяли — напр. надто широкий
доступ, потрібен токен із зайвими правами, незрозуміле авторство. Це теж
інженерне рішення, і воно варте одного рядка.>
Розглядав git MCP сервер, але відмовився від цієї думки, тому що не вважаю, що він є доцільним для цього проєкту. Також, різні git
команди (add, commit, push, pull, fetch, merge, rebase, etc.) я з безпекових міркувань надаю перевагу виконувати вручну, 
а не делегувати їх агенту.

## Область доступу — головне

Область доступу для MCP серверів була обмежена до мінімуму, щоб не надати агенту надто широкий доступ до системних файлів.
Filesystems сервер має доступ до `~/VSCodeProjects/2026-udc-06-mcp-hw/app/data/`, а memory сервер має доступ до `~/VSCodeProjects/2026-udc-06-mcp-hw/.cursor/memory.jsonl`.

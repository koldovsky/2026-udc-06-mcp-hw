# Task E (bonus)

Виконано **два** шляхи; основний — **Шлях 3**.

---

## Шлях 2 — дебаг через MCP Inspector

**Що робили.** Inspector у CLI-режимі проти власного сервера — але не щоб
повторити перевірку з Task B (там уже доведено, що 4 tools + 1 resource видні), а
щоб пройти **шляхи помилок**, яких ніхто не тестував:

```bash
cd mcp-server
npx @modelcontextprotocol/inspector --cli node ./dist/server.js \
  --method tools/call --tool-name check_stock --tool-arg sku=NOPE
```

**Що побачили.** Кожен рядок — реальний вивід:

| Проба | Результат |
|---|---|
| `check_stock sku=NOPE` | `content` + `structuredContent {"found":false,"sku":"NOPE"}`, **без** `isError` — свідомо: «немає такого SKU» це відповідь, а не збій протоколу |
| `check_stock` **без** аргументу | `isError: true`, текст `Input validation error: Invalid arguments for tool check_stock: sku: Invalid input: expected string, received undefined`; Inspector згортає це у `{"error":{"code":"tool_is_error"}}` — тобто zod-валідація справді працює на боці сервера |
| `tools/call nope_tool` | `{"error":{"code":"tool_not_found","message":"Tool 'nope_tool' not found on server."}}` |
| `resources/read inventory://nope` | `{"error":{"code":"error","message":"Resource not found: inventory://nope"}}` |
| `low_stock --tool-arg bogus=1` | **Прийнято молча** — zod відкидає невідомі ключі (`strip`). У JSON Schema вхідних параметрів немає `additionalProperties: false`, хоча у **вихідній** схемі воно є. Для read-only tool це радше сумісність, ніж дефект, але асиметрію варто знати |
| `--tool-arg query=` (порожнє) | Обмеження самого Inspector: `Invalid parameter format: query=. Use key=value format.` — порожнє значення через CLI не передати, довелось перевіряти сирим stdio |
| порожній і пробільний `query` (через stdio) | 24 товари; текст 2051 символ, **усе повідомлення 5293 символи** — `structuredContent` дублює текст (це за дизайном, коли оголошено `outputSchema`) |
| `check_stock sku="  kb-1002  "` | Нормалізується → `found: true`, `KB-1002` |
| `resources/read inventory://catalog` | `contents[0].uri` дослівно `inventory://catalog` — `new URL()` схему не спотворює |

**Що знайшли й полагодили завдяки цьому.** Проба, якої не було в жодній
попередній перевірці: **що буде, якщо даних немає**. Прогнали на копії репо
(`/tmp/ab-clean`, щоб не торкатися ground truth) з прибраним
`app/data/catalog.json`:

```
low_stock  →  isError: true
"ENOENT: no such file or directory, open '/private/tmp/ab-clean/app/data/catalog.json'"
tools/list →  4 tools   (сервер вижив, процес не впав)
```

Два реальні дефекти в одному рядку:

1. **Витік абсолютного шляху** у відповіді клієнту — тобто прямо в контекст
   моделі й у будь-який лог. Це суперечить власній тезі з
   [`SECURITY.md`](./mcp/SECURITY.md), що область цього сервера — «один файл, і
   шлях не є параметром»: шлях не є параметром **на вході**, але витікав **на
   виході**.
2. **Повідомлення, з яким модель не може нічого зробити.** «ENOENT» не підказує
   дії, а реальна причина на свіжому клоні одна — немає збірки `app/`.

Полагоджено обгорткою `readCatalog()` у `mcp-server/src/server.ts` (усі п'ять
місць, де викликався `loadCatalog()`, тепер ідуть через неї). Після `npm run build`:

```
tool     → "Catalog data is unavailable (ENOENT). This server reads the seeded
            catalog through the compiled app/ build: run `npm run build` in app/
            and confirm the data file exists next to it."
resource → те саме повідомлення
шлях у тексті → немає (перевірено регуляркою на /tmp|Users)
```

Код помилки (`ENOENT`, `SyntaxError` для битого JSON) збережено — діагностика не
втрачена, лише шлях прибрано.

**Чому це не зламало Task D.** Правка стосується виключно шляху помилки. На
здоровому шляху перевірено після перезбірки: `low_stock` → ті самі 9 SKU,
`inventory_value` → `46152`, `tools/list` → 4. A/B із
[`ab-validation.md`](./ab-validation.md) робився до цієї правки, і вона не
торкалась жодного з двох tools, якими той A/B міряв.

**Висновок.** Inspector дає те, чого не дає чат: **детермінований доступ до
шляхів помилок**. У чаті модель майже завжди «допомагає» — обійде збій, підставить
інший інструмент, перефразує помилку, і ви не побачите, що саме віддав сервер. У
Inspector видно точний JSON, включно з полями, які модель у переказі губить
(`isError`, `structuredContent`, код помилки). Обидва дефекти вище були
невидимими в чаті **саме тому**, що агент їх приховував: у Task D прогони B,
не знайшовши tools, спокійно рахували самі — і ніхто б не дізнався, що
повідомлення про помилку тягне абсолютний шлях.

---

## Шлях 3 — сервер, якому потрібен токен, підключений безпечно (основний)

**Сервер.** Офіційний GitHub MCP (`ghcr.io/github/github-mcp-server`), stdio у
Docker, режим `--read-only`, образ **зафіксований за digest**. Запис у
[`.mcp.json`](../.mcp.json):

```json
"github": {
  "command": "docker",
  "args": ["run", "-i", "--rm",
    "-v", "${HOST_CA_BUNDLE:-/etc/ssl/cert.pem}:/etc/ssl/certs/ca-certificates.crt:ro",
    "-e", "SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt",
    "-e", "GITHUB_PERSONAL_ACCESS_TOKEN",
    "ghcr.io/github/github-mcp-server@sha256:fbec75de…0699", "stdio", "--read-only"],
  "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_PERSONAL_ACCESS_TOKEN}" }
}
```

**Які права дали токену:** read-only, публічні репозиторії, жодних дозволів на
акаунт. **Які свідомо НЕ дали:** запис у репозиторії, `workflow` (запуск CI),
`packages`, `admin:*`, доступ до приватних репо й до організації. Токен —
fine-grained і відкликається одним рухом у налаштуваннях GitHub.

**Least privilege тут забезпечує сам сервер, а не політика хоста** — і це
вимірювано:

| Режим | tools | з них не read-only |
|---|---|---|
| без прапорця | **44** | **18** (`create_issue`, `create_branch`, `add_issue_comment`, …) |
| `--read-only` | **26** | **0** |

Перевірено, що до моделі доходять саме ці 26: у сесії з цим конфігом агент
відрахував `Count: 26` і перелічив лише `get_*`/`list_*`/`search_*`/`*_read`.
Контраст із Task A: у `filesystem` **немає** режиму read-only, тому там 4
write-tools доводилось прибирати deny-rules на рівні хоста; тут сервер сам не
реєструє те, чого не має робити. Прапорець на сервері сильніший за правило в
конфізі хоста.

**Як саме токен потрапляє в конфіг.** У `.mcp.json` — тільки
`${GITHUB_PERSONAL_ACCESS_TOKEN}`; значення в `.env`, який гітігнорований
(`.gitignore:15`); у репо лежить `.env.example`. У контейнер значення йде
`-e GITHUB_PERSONAL_ACCESS_TOKEN` **без значення**, тобто підхоплюється зі
середовища процесу, який Claude Code запускає.

**Доказ, що секрет не в репозиторії:**

```bash
git grep -nE "ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}"
# → clean
git grep -n "dummy-not-a-real-token"
# → clean   (значення є лише в .env, який не трекається)
git ls-files | grep -x "\.env"
# → (порожньо)   git check-ignore .env → .gitignore:15
```

### Чотири знахідки, кожна перевірена

**1. `✔ Connected` не означає, що токен є.** Якщо змінна не задана, Claude Code
передає далі **сам текст плейсхолдера** — рядок `${GITHUB_PERSONAL_ACCESS_TOKEN}`.
Сервер бачить непорожнє значення, спокійно стартує, і `claude mcp list` показує
`✔ Connected`. Перевірено прямо:

```bash
GITHUB_PERSONAL_ACCESS_TOKEN='${GITHUB_PERSONAL_ACCESS_TOKEN}' docker run … stdio --read-only
# → GitHub MCP Server running on stdio     (стартує на не-секреті)
```

Єдиний правдивий сигнал — окремий рядок попередження:
`[Warning] [github] mcpServers.github: Missing environment variables:
GITHUB_PERSONAL_ACCESS_TOKEN`. Тобто «статус підключення» не є перевіркою
секретів: сервер із фальшивим токеном впаде лише на першому справжньому виклику.
Це та сама помилка мислення, що і з `roots` у Task A — **перевіряти треба
поведінку, а не статус**.

**2. Пінінг за digest фіксує і протокол.** Локально був образ `v0.5.0` (14
місяців). Він **під'єднується**, але сучасний клієнт відкидає його payload:
`Connection error: invalid_union … expected string`, `connection closed (with
errors)`, і до моделі не доходить **жодного** `mcp__github__*` tool (агент прямо
відповів `NONE`). Після `docker pull` — `v1.11.0`, протокол `2025-11-25` замість
`2025-03-26`, і всі 26 tools на місці. Дисципліна «пінити версію» з Task A
залишається правильною, але має другий бік: **закріплений образ старіє разом із
протоколом**, і симптом виглядає як «сервер підключився, а tools немає».

**3. Контейнер не має CA мережі, у якій він працює.** Перший справжній виклик
через dummy-токен упав не на авторизації, а на TLS:

```
failed to get user: Get "https://api.github.com/user":
tls: failed to verify certificate: x509: certificate signed by unknown authority
```

Причина — TLS-інспекція в мережі: на хості корпоративний корінь довіри є, у
контейнері його немає. Полагоджено монтуванням хостового бандла **тільки для
читання** (`-v …/cert.pem:/etc/ssl/certs/ca-certificates.crt:ro` +
`SSL_CERT_FILE`), після чого відповідь стала осмисленою:

```
failed to get user: GET https://api.github.com/user: 401 Bad credentials
```

`401` — це і є доказ, що значення змінної дійшло до GitHub API. Спокуса
«полагодити» такий збій прапорцем на кшталт `SSL_VERIFY=false` — це рівно той
антипатерн, який виписаний як ризик у [`SECURITY.md`](./mcp/SECURITY.md) (§2, R5).

**4. Транспорт обирає не тільки розробник.** Спершу планувався **remote** GitHub
MCP по HTTP. Він недосяжний: корпоративний веб-проксі блокує домен за категорією
(«Generative AI»), віддаючи `HTTP 302` на внутрішню сторінку-заглушку — з будь-яким
токеном і навіть без нього. Тобто вибір «remote HTTP vs локальний stdio» у
корпоративній мережі диктує egress-політика, а не зручність: `stdio` + Docker
працює, remote HTTP — ні.

**Висновок: що змінилось в оцінці ризику.** До цього шляху всі три сервери в
`.mcp.json` були без секретів, і `SECURITY.md` міг чесно писати «токенів немає».
Тепер у конфізі є сервер із реальним доступом до зовнішньої системи, і разом із
ним три речі, яких раніше не було: (а) значення, яке **ніколи** не повинно
потрапити в git, і його відсутність тепер треба перевіряти автоматично, а не
покладатися на пам'ять; (б) залежність від чужого API — сервер може віддати в
контекст будь-який текст із тікетів і README, тобто це ще один канал prompt
injection, дорівнюваний за ризиком до пошукових серверів із §2; (в) стан, у якому
все *виглядає* робочим (`✔ Connected`), а секрету немає — найгірший різновид
хиби, бо він тихий. Найдешевша мітигація виявилась і найсильнішою: `--read-only`
на боці сервера прибирає 18 write-tools **до** того, як вони стануть чиєюсь
проблемою — і жодне правило в конфізі хоста цього не вимагає.

# Microstock+: навыки для ИИ-агентов

Для ИИ-агентов (Claude, Codex, Cursor и других MCP-клиентов), которые работают на стокера — пользователя Microstock+.

| | |
| - | - |
| Страница для людей и ключи агентов | https://microstock.plus/ai-agent-skills |
| Базовый URL API | `https://microstock.plus/api/agent/v1` |
| OpenAPI 3.1 | https://microstock.plus/api/agent/v1/openapi.json |
| MCP-сервер (один файл, Node.js 18+) | https://microstock.plus/ai-agent-skills/mplus-mcp.mjs |
| Этот файл | https://microstock.plus/ai-agent-skills/skill.md |

## Что такое Microstock+

Microstock+ (M+) — рабочее место стокера. В нём лежат фото, векторы и видео с названиями, описаниями и ключами; M+ проверяет атрибуцию по правилам каждого стока, загружает файлы и отправляет их на проверку в Adobe Stock, Shutterstock, iStock, Pond5 и другие стоки.

С ключом агента вы работаете **от имени пользователя и с меньшими правами, чем у него**. Можно:

- читать папки, файлы, атрибуцию, статусы по стокам, причины отказов и результаты проверки (валидацию);
- править атрибуцию: по одному файлу или батчем с пробным прогоном (dry run);
- выгружать атрибуцию в CSV;
- следить за лентой событий: изменения, сделанные через Agent API.

**Пока недоступно.** Смена статусов (в том числе отправка файлов на стоки — загрузка и сабмит), ИИ-атрибуция Microstock+ (расчёт цены, платный запуск и прогресс задач) и поток Server-Sent Events есть в контракте, но в текущем релизе выключены: API отвечает `403 endpoint_disabled`, ключам нельзя выдать скоупы `status:write`, `ai:quote` и `ai:run`, а MCP-сервер не предлагает эти инструменты. Не предлагайте и не обещайте эти возможности и никогда не говорите, что что-то поставили в очередь, засабмитили или оплатили. Если пользователь просит, скажите, что это появится позже, а пока он делает это сам в веб-интерфейсе Microstock+ («Мои файлы»). Вместо ИИ-атрибуции можете сами написать названия, описания и ключи (сценарии B и C).

## Правила, которые нужно соблюдать

1. **Только аккаунт владельца ключа.** Каждый вызов работает с аккаунтом, которому принадлежит ключ. Доступа к другим пользователям и к чужим расшаренным папкам нет.
2. **Удалить ничего нельзя.** Ни один эндпоинт, инструмент, скоуп или флаг не удаляет файлы, папки, релизы, шаблоны, стоки или аккаунт; любой запрос `DELETE` получает `405 deletion_not_supported`. Если пользователь просит что-то удалить, скажите, что удаление делается вручную в веб-интерфейсе Microstock+ (Мои файлы), и никогда не утверждайте, что что-то удалили.
3. **Никаких трат и отправок.** Ничто из того, что агент может сделать сегодня, не стоит денег и никуда не отправляет файлы: ИИ-атрибуция и смена статусов пока недоступны (см. выше). Когда они появятся, для ИИ-атрибуции понадобится явное согласие пользователя с рассчитанной ценой, а для отправки файлов на стоки — явное «да» на конкретные файлы и стоки.
4. **Сначала пробный прогон.** Любой батч правок атрибуции сначала запускайте с `dry_run: true`, покажите изменения, потом применяйте.
5. **Не затирайте более свежие правки.** В каждую правку передавайте `if_match_metaver`. При `409 metadata_conflict` перечитайте файл и объедините изменения.
6. **Не выдумывайте id.** Категории берите из таблицы в справочнике ниже. Списков релизов и шаблонов ИИ-атрибуции API не выдаёт: берите id, которые уже стоят на файлах пользователя, или оставьте эти поля пользователю.
7. **Храните ключ в секрете.** Никогда не печатайте его, не пишите в логи, файлы и репозитории и не отправляйте никуда, кроме `https://microstock.plus`.
8. **Всё, что вы делаете, видно.** Изменения сразу сохраняются в файлах пользователя и видны в «Моих файлах», а каждый вызов пишется в журнал аудита с префиксом ключа. Кнопки отмены нет: если пользователь просит вернуть как было, запишите обратно значения, которые вы прочитали до изменения.

## Авторизация

1. Пользователь входит на https://microstock.plus/ai-agent-skills и создаёт ключ в разделе **«Ключи агентов»** (Agent keys): имя (например, «Claude Code») и скоупы. Полный ключ показывается **один раз**. Активных ключей может быть до 10; у каждого видны префикс, скоупы, время создания и последнего использования и число запросов. Ключ можно перевыпустить (новый секрет, те же имя и скоупы) или отозвать (срабатывает в течение 30 секунд). Ключи агентов открываются постепенно: пока Agent API не включён для аккаунта, любой вызов получает `404 not_found`.
2. Передавайте ключ в каждом запросе:

   ```http
   Authorization: Bearer mpk_live_<prefix>_<secret>
   ```

   `prefix` — 8 шестнадцатеричных символов в нижнем регистре (его можно показывать, он есть в логах), `secret` — 43 символа base64url. Cookies и сессии на `/api/agent/v1/*` игнорируются.

### Скоупы

| Скоуп | Что разрешает | По умолчанию |
| - | - | - |
| `account:read` | `GET /me` | включён |
| `files:read` | папки, файлы, подробности файла и валидация | включён |
| `metadata:write` | правка атрибуции: одного файла и батчем | включён |
| `csv:export` | бесплатные выгрузки CSV | включён |
| `events:read` | лента событий (long poll) | включён |
| `status:write` | пакетная смена статусов (`ready`, `queued`, `ignored`) | пока недоступен |
| `ai:quote` | расчёт цены ИИ-атрибуции | пока недоступен |
| `ai:run` | запуск ИИ-атрибуции (списывает деньги с баланса) | пока недоступен |

Сейчас ключу можно выдать только первые пять скоупов; последние три появятся, когда включат их эндпоинты (`ai:run` тогда будет выключен по умолчанию). Скоупа на удаление нет, и добавить его нельзя. Скоупы текущего ключа показывает `GET /me` (`mplus_get_account`); `balance_eur` в этом релизе всегда `null`.

## Подключение

### MCP-сервер (рекомендуется)

`mplus-mcp.mjs` — MCP-сервер в одном файле, без зависимостей. Нужен Node.js 18 или новее и ключ в переменной окружения `MPLUS_API_KEY`; сервер обращается только к `https://microstock.plus` по HTTPS. Скачайте его по ссылке https://microstock.plus/ai-agent-skills/mplus-mcp.mjs?download=1 и в примерах ниже укажите абсолютный путь.

Инструменты смены статусов и ИИ-атрибуции (`mplus_set_status`, `mplus_quote_ai_keywording`, `mplus_run_ai_keywording`, `mplus_get_job`) скрыты и отвечают «пока недоступно», если сервер не запущен с `MPLUS_ENABLE_PREVIEW_TOOLS=1`; с текущим API эту настройку не включайте.

**Claude Code с плагином.** Плагин `microstock-plus` включает сервер, два навыка и три команды и хранит ключ в защищённом хранилище системы. После того как добавлен маркетплейс с плагином:

```bash
claude plugin install microstock-plus@microstock-plus
```

Claude Code спросит ключ при включении плагина; сменить его можно командой `/plugin configure microstock-plus@microstock-plus`.

**Claude Code, только сервер.** Ключ сохранится в конфигурационном файле Claude Code:

```bash
claude mcp add --env MPLUS_API_KEY=mpk_live_... --transport stdio --scope user microstock-plus -- node /absolute/path/mplus-mcp.mjs
```

**Claude Desktop.** Settings › Developer › Edit Config открывает `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`):

```json
{
  "mcpServers": {
    "microstock-plus": {
      "command": "node",
      "args": ["/absolute/path/mplus-mcp.mjs"],
      "env": { "MPLUS_API_KEY": "mpk_live_..." }
    }
  }
}
```

**Cursor.** `~/.cursor/mcp.json` для всех проектов или `.cursor/mcp.json` в одном проекте; файл проекта с ключом не коммитьте:

```json
{
  "mcpServers": {
    "microstock-plus": {
      "command": "node",
      "args": ["/absolute/path/mplus-mcp.mjs"],
      "env": { "MPLUS_API_KEY": "mpk_live_..." }
    }
  }
}
```

**OpenAI Codex CLI.** `~/.codex/config.toml`; `env_vars` пробрасывает `MPLUS_API_KEY` из вашей оболочки, и ключ не попадает в файл:

```toml
[mcp_servers.microstock-plus]
command = "node"
args = ["/absolute/path/mplus-mcp.mjs"]
env_vars = ["MPLUS_API_KEY"]
```

или из командной строки: `codex mcp add microstock-plus --env MPLUS_API_KEY=mpk_live_... -- node /absolute/path/mplus-mcp.mjs`.

**Другие MCP-клиенты.** Запускайте `node /absolute/path/mplus-mcp.mjs` как stdio-сервер с `MPLUS_API_KEY` в окружении. Для клиентов, которые умеют только Streamable HTTP: `node mplus-mcp.mjs --http 8787` и адрес `http://127.0.0.1:8787/mcp`, в каждом запросе заголовок `Authorization: Bearer mpk_live_...` (сервер слушает только localhost). Сервер поддерживает MCP 2026-07-28 (без состояния, `server/discover`) и 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05 (с `initialize`).

Каждый MCP-инструмент возвращает в `structuredContent` те же объекты, что и API, плюс поле `summary` — что произошло и что делать дальше, — и читаемый текстовый блок.

### Обычный HTTP

JSON на входе и выходе (UTF-8). У каждого объекта есть `"object": "<тип>"`, время — ISO-8601 UTC, у каждого ответа есть заголовок `x-request-id`.

```bash
export MPLUS_API_KEY=mpk_live_...
curl -s https://microstock.plus/api/agent/v1/me -H "Authorization: Bearer $MPLUS_API_KEY"
```

- **Списки:** `{"object": "list", "data": [...], "has_more": true, "next_cursor": "..."}`. Следующая страница — `cursor=<next_cursor>`; `limit` от 1 до 200 (по умолчанию 50).
- **Идемпотентность:** в каждом POST и PATCH передавайте `Idempotency-Key: <uuid>` (`uuidgen` в macOS и Linux, `[guid]::NewGuid()` в PowerShell). При повторе того же запроса используйте тот же ключ: повтор в течение 24 часов вернёт сохранённый ответ с заголовком `idempotent-replayed: true`, а тот же ключ с другим телом даст `409 idempotency_mismatch`.
- **Конкурентные правки:** у каждого файла есть `metaver`. Передавайте `if_match_metaver`, чтобы получить `409 metadata_conflict` вместо перезаписи более свежей правки.

## Инструменты и эндпоинты

| MCP-инструмент | Эндпоинт | Скоуп | Что делает |
| - | - | - | - |
| `mplus_get_account` | `GET /me` | `account:read` | Тариф, баланс, подключённые стоки и их id, настройки ключей, лимиты, скоупы ключа |
| `mplus_list_folders` | `GET /folders` | `files:read` | Дерево папок с числом файлов и статусами по стокам |
| `mplus_list_files` | `GET /files` | `files:read` | Список и поиск файлов с фильтрами |
| `mplus_get_file` | `GET /files/{iid}` | `files:read` | Один файл: вся атрибуция, metaver, статусы, валидация |
| `mplus_update_metadata` | `PATCH /files/{iid}/metadata` | `metadata:write` | Правка атрибуции одного файла (merge patch) |
| `mplus_update_metadata_batch` | `POST /files/metadata:batch` | `metadata:write` | Батч до 100 правок, результат по каждой, `dry_run` |
| `mplus_set_status` | `POST /files/status:batch` | `status:write` | **Пока недоступно** (`403 endpoint_disabled`): статусы `ready`, `queued` или `ignored` по стокам |
| `mplus_export_csv` | `POST /exports/csv` | `csv:export` | Выгрузка CSV (бесплатные форматы) |
| `mplus_quote_ai_keywording` | `POST /ai/keywording:quote` | `ai:quote` | **Пока недоступно**: расчёт цены ИИ-атрибуции |
| `mplus_run_ai_keywording` | `POST /ai/keywording:run` | `ai:run` | **Пока недоступно**: запуск по расчёту, платно |
| `mplus_get_job` | `GET /jobs/{id}` | `files:read` | **Пока недоступно**: прогресс ИИ-задачи |
| `mplus_wait_for_events` | `GET /events` | `events:read` | Long poll ленты событий (до 25 с) |
| — | `GET /events/stream` | `events:read` | **Пока недоступно**: Server-Sent Events |

Начинайте сессию с `mplus_get_account` (`GET /me`): он покажет подключённые стоки, их id и что разрешено ключу. Если ключ может читать аккаунт, MCP-сервер показывает только инструменты, разрешённые его скоупами; четыре инструмента с пометкой «пока недоступно» в этом релизе не предлагаются вовсе.

## Сценарии

### A. Аудит папки: пустая и слабая атрибуция

Только чтение, ничего не меняем.

1. Найдите папку: `mplus_list_folders` (`GET /folders`). Для каждой папки видно число файлов и сколько файлов в каждом статусе на каждом стоке.
2. Соберите проблемы, с `recursive=true`, если нужны подпапки:
   - пустые поля: `mplus_list_files` с `missing: ["title", "keywords"]` (`GET /files?folder=/foto/2026&recursive=true&missing=title,keywords`); файл попадает в выборку, если пусто любое из полей;
   - мало ключей: `max_keywords: 6` находит файлы, которые не примет Shutterstock (меньше 7); `max_keywords: 4` — файлы ниже минимума Adobe Stock и iStock (5);
   - проблемы на конкретном стоке: `agency` плюс `status: "notready"` — файлы, атрибуция которых не проходит проверку этого стока; почему — написано в `agencies.<id>.validation` (например, `keywords_min` «Less than 7 keywords»).
3. По файлам из отчёта прочитайте подробности: `mplus_get_file` или `mplus_list_files` с `expand_metadata: true` (иначе описания в списках не приходят).
4. Отчитайтесь: сколько файлов с каждой проблемой и худшие файлы (имя, iid, что не так), предложите исправления. Ничего не меняйте, пока пользователь не попросит.

```bash
curl -s "https://microstock.plus/api/agent/v1/files?folder=/foto/2026&recursive=true&missing=title,keywords&limit=100" \
  -H "Authorization: Bearer $MPLUS_API_KEY"
curl -s "https://microstock.plus/api/agent/v1/files?folder=/foto/2026&recursive=true&agency=shutterstock&status=notready" \
  -H "Authorization: Bearer $MPLUS_API_KEY"
```

### B. Написать или улучшить названия, описания и ключи

1. Прочитайте файл (`mplus_get_file`): текущая атрибуция, `metaver`, `type`, флаги и валидация по стокам. Если видите изображения, посмотрите `preview_url`.
2. Пишите атрибуцию по тому, что действительно видно в кадре. Не угадывайте места, даты, виды растений и животных или бренды, которые не можете подтвердить, — спросите пользователя.
3. Сверьте результат с правилами стоков ниже и со стоками, подключёнными у пользователя (`mplus_get_account`).
4. Сохраните, как в сценарии C. Для одного файла можно `mplus_update_metadata` (`PATCH /files/{iid}/metadata`) с `if_match_metaver`.

**Названия.** Простое конкретное предложение: объект, действие, место, а если важно — настроение или время, например «Empty road through a golden autumn forest at sunrise». Без списков ключей, без «stock photo», без КАПСА. Microstock+ разрешает 200 символов, некоторым стокам нужно короче (см. таблицу).

**Описания.** Одно-два предложения, которые дополняют название: где, когда, что происходит. Shutterstock берёт именно этот текст: не длиннее 200 символов и не короче 5 слов. Для эдиториала обычно нужны место и дата, например формат Shutterstock `CITY, COUNTRY - MONTH DD, YYYY: что происходит`.

**Ключи.** Одно слово или короткая фраза на ключ, по-английски, самые важные первыми: главный объект, затем то, что видно (предметы, люди, действия, место), затем концепции (настроение, сезон, применение). Без запятых внутри ключа (MCP-инструменты такие ключи не принимают), без повторов, без нерелевантных и вводящих в заблуждение слов: за спам ключами файлы отклоняют. Microstock+ обрезает пробелы, убирает дубли, переводит ключи в нижний регистр, если так настроено у пользователя, и принимает не больше 50 ключей на файл.

| Сток (`id`) | Ключи | Названия и описания | Заметки |
| - | - | - | - |
| Adobe Stock (`adobestock`) | 5-49 | название до 200 символов | Порядок важен: Adobe сильнее учитывает первые ключи, поставьте 10 главных в начало. |
| Shutterstock (`shutterstock`) | 7-50 | описание до 200 символов, не меньше 5 слов | Лучше отдельные слова, а не фразы. |
| iStock (`esp`) | 5-49 | название до 255 символов | При сабмите iStock сопоставляет ключи с контролируемым словарём Getty; то, что не сопоставилось, отбрасывается или требует уточнения в iStock. Используйте обычные английские существительные и прилагательные. |
| Pond5 (`pond5`) | 1-50, всего не больше 79 слов | название 3-80 символов, описание до 500 | Перед отправкой на Pond5 Microstock+ проверяет релизы (Pond5 release guard). |
| Dreamstime (`dreamstime`) | 10-80 | название до 130 символов | |
| Alamy (`alamy`) | не меньше 3 | название до 150 символов | |
| Depositphotos (`depositphotos`) | не меньше 8 | название и описание 6-250 символов | |

Это настройки валидации Microstock+ на момент написания. Решающее слово — за списком `validation`, который API возвращает по каждому стоку для каждого файла; валидация по стокам сообщает о проблемах, но не блокирует правку, поэтому слишком длинное описание будет помечено, но не обрезано.

**Контент, созданный ИИ.**

- Ставьте `ai_generated: true` для всего, что сделано генеративным ИИ. Microstock+ тогда ставит `editorial: false` (ИИ-контент не бывает эдиториалом; запрос с обоими флагами отклоняется) и передаёт флаг стокам, у которых он есть, например флаг генеративного ИИ на Adobe Stock.
- Описывайте то, что изображено. Не выдавайте ИИ-изображения за фото реальных событий, мест или людей и не добавляйте в ключи названия инструментов вроде Midjourney или Stable Diffusion.
- Правила стоков насчёт ИИ разные и меняются, а некоторые стоки генеративный ИИ не принимают вообще. Смотрите валидацию по каждому стоку и предупреждайте пользователя о стоках, которые такой контент не принимают.

**Товарные знаки и люди.** В коммерческом (не эдиториал) контенте не упоминайте в названиях, описаниях и ключах бренды, логотипы, названия продуктов, персонажей, произведения искусства и имена реальных людей. В эдиториале их можно называть по факту.

**Категории и релизы.** У файла не больше 3 категорий, каждая — `{"cat": 16, "sub": 7}` (Nature, Plants and trees) из таблицы в справочнике ниже; если подкатегория не подходит, не передавайте `sub`. Релизы — id вида `rel_123`, их списка API не выдаёт: копируйте id с файлов, где они уже стоят правильно, или оставьте это пользователю.

### C. Пробный прогон и применение батча, конфликты metaver

1. Прочитайте текущие файлы и запомните `metaver` каждого.
2. Пробный прогон: `mplus_update_metadata_batch` с `dry_run: true` (`POST /files/metadata:batch` с `"dry_run": true`), до 100 элементов. Ничего не записывается; по каждому элементу приходит файл в том виде, каким он станет, с валидацией, или ошибка элемента.
3. Покажите пользователю изменения (старое и новое название, какие ключи добавятся и уберутся, какие проблемы валидации останутся) и спросите согласия.
4. Применение: те же элементы с `dry_run: false`. Элементы проходят или падают независимо (`results[].ok`, `succeeded`, `failed`); упавшие элементы не меняются.
5. Для каждого `metadata_conflict`: перечитайте файл, объедините свою правку с текущей атрибуцией и повторите только этот элемент с новым `metaver`. Не перезаписывайте вслепую: после вашего чтения файл изменил кто-то другой, например сам пользователь или его ИИ-задача.

Поля правки: `title`, `description`, `keywords` (`{"set": [...]}` — весь список по порядку, или `{"add": [...]}` и/или `{"remove": [...]}`), `categories`, `editorial`, `ai_generated`, `illustration`, `releases` (`set`, `add`, `remove`), `notes`. В HTTP API `null` очищает поле, пустые строки отклоняются; в MCP-инструментах вместо этого есть список `clear` (например, `"clear": ["notes"]`).

```bash
curl -s -X POST https://microstock.plus/api/agent/v1/files/metadata:batch \
  -H "Authorization: Bearer $MPLUS_API_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"dry_run": true, "items": [{"iid": "6abc74e948864d403ea0c559", "if_match_metaver": 7,
       "patch": {"title": "Empty road through a golden autumn forest at sunrise",
                 "keywords": {"add": ["golden", "fall", "trees", "aerial"]}}}]}'
```

### D. Статусы и загрузка (пока недоступно)

Читать статусы можно: `mplus_list_files` с `agency` и `status` (например, все файлы со статусом `rejected` на Adobe Stock) и `mplus_get_file` для одного файла — с `rejection_reasons`, если сток назвал причину. Менять их пока нельзя: `POST /files/status:batch` отвечает `403 endpoint_disabled`, ключам нельзя выдать `status:write`, а MCP-сервер не предлагает `mplus_set_status`. Не предлагайте и не обещайте ставить `ready`, `queued` (отправить на сток: загрузка и сабмит) или `ignored`. Когда файлы готовы, скажите пользователю, какие файлы и на какие стоки вы советуете отправить, — отправит он сам из «Моих файлов».

### E. Выгрузка CSV

`mplus_export_csv` (`POST /exports/csv`) собирает CSV до 500 файлов по списку `iids` или по папке `folder` (с `recursive`). Форматы — те же, что у «Экспорта CSV» в «Моих файлах»:

| `format` | Для чего |
| - | - |
| `default` | CSV для загрузки на стоки: имя файла, описание, ключи, категории, файлы релизов |
| `with_title` | Как `default`, плюс название |
| `importable` | Обратный импорт в Microstock+ (название, описание, ключи, категории, релизы, флаги) |
| `with_release_names` | Названия релизов вместо файлов релизов |
| `without_categories` | Без категорий |
| `nimia` | Шаблон Nimia для футажа |
| `alamy` | Шаблон Alamy для видео |

`delimiter` — `comma` (для стоков) или `semicolon` (для Excel). В ответе `rows`, `download_url` и `expires_at`; скачайте файл с тем же заголовком `Authorization`, пока ссылка не истекла. С `include_csv: true` MCP-инструмент вернёт и сам текст CSV (примерно до 250 КБ): сохраните его в файл `.csv` без изменений. По HTTP заголовок `Accept: text/csv` сразу возвращает CSV:

```bash
curl -s -X POST https://microstock.plus/api/agent/v1/exports/csv \
  -H "Authorization: Bearer $MPLUS_API_KEY" -H "Content-Type: application/json" -H "Accept: text/csv" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"folder": "/foto/2026", "recursive": true, "format": "with_title", "delimiter": "comma"}' -o foto-2026.csv
```

Платных форматов CSV из «Моих файлов», например для Shutterstock и Pond5, в API нет. В одной выгрузке не больше 500 файлов (иначе `export_too_large`): большие папки выгружайте по подпапкам.

### F. ИИ-атрибуция Microstock+ (пока недоступно)

Платная ИИ-атрибуция Microstock+ (бесплатный расчёт цены, затем платный запуск и прогресс задачи) через Agent API пока недоступна: её эндпоинты отвечают `403 endpoint_disabled`, а ключам нельзя выдать `ai:quote` и `ai:run`. Не предлагайте и не обещайте её и никогда не говорите, что запустили или оплатили её. Вместо этого напишите названия, описания и ключи сами по сценариям B и C или подскажите пользователю, что ИИ-атрибуцию можно запустить в «Моих файлах». Когда она появится здесь, для запуска понадобится явное согласие пользователя с рассчитанной ценой.

### G. События и отчёт о прогрессе

Сейчас в ленте событий видны изменения, сделанные через Agent API (правки атрибуции и выгрузки агентов), и изменения ключей агентов. События о смене статусов, загрузках, сабмитах, проверке и ИИ-задачах есть в контракте, но пока не приходят. У события есть `id`, `type`, `created_at`, `actor` (`agent` с префиксом и именем ключа, `user` или `system`) и `data`.

| Тип | `data` | Приходит сейчас |
| - | - | - |
| `file.metadata.updated` | `iids`, `fields`, `count`, `folder` | да |
| `export.ready` | `export_id`, `rows`, `format` | да |
| `key.created`, `key.revoked` | `key_prefix`, `key_name` | да |
| `file.status.changed` | `iids`, `agency`, `from`, `to`, `count` | пока нет |
| `file.uploaded`, `file.submitted` | `iids`, `agency`, `count` | пока нет |
| `file.reviewed` | `iids`, `agency`, `result` (`approved` или `rejected`), `reason` | пока нет |
| `ai.quote.created` | `quote_id`, `files`, `amount_eur` | пока нет |
| `ai.job.started`, `ai.job.completed`, `ai.job.failed` | `job_id`, `files_total`, `files_done`, `files_failed`, `amount_eur_charged` | пока нет |

1. `mplus_wait_for_events` без курсора возвращает последние события; с `types` — только нужные (`GET /events?types=file.metadata.updated,export.ready`).
2. Дальше вызывайте его с `cursor`, равным предыдущему `next_cursor` (`GET /events?since=<next_cursor>&wait=25`). Каждый вызов ждёт до 25 секунд и возвращается сразу, как только что-то произошло; `has_more: true` значит «вызовите сразу ещё раз».
3. Сообщайте простыми словами («ключи обновлены у 38 файлов в /foto/2026; CSV на 120 строк готов») и остановитесь, когда цель пользователя достигнута или он попросил остановиться.

События хранятся 7 дней. Поток Server-Sent Events (`GET /events/stream`) пока недоступен (`403 endpoint_disabled`); вместо него опрашивайте `GET /events` с `wait`. MCP-клиенты, которые запрашивают лог-сообщения, получают заметные события ещё и как `notifications/message`.

```bash
curl -s "https://microstock.plus/api/agent/v1/events?since=evt_01J9Z3&types=file.metadata.updated,export.ready&wait=25" \
  -H "Authorization: Bearer $MPLUS_API_KEY"
```

## Справочник

### Файл

```json
{
  "object": "file",
  "iid": "6abc74e948864d403ea0c559",
  "type": "raster",
  "folder": "/foto/26_10_01/N-",
  "filename": "IMG_0042.jpg",
  "metaver": 7,
  "metadata": {
    "title": "Autumn forest road at sunrise",
    "description": "Empty road through a golden autumn forest ...",
    "keywords": ["autumn", "forest", "road", "sunrise"],
    "categories": [{"cat": 12, "sub": 3}],
    "editorial": false, "ai_generated": false, "illustration": false,
    "releases": ["rel_123"], "notes": ""
  },
  "agencies": {
    "esp": {"status": "submitted", "external_id": "123456", "errors": []},
    "shutterstock": {"status": "ready", "errors": [], "validation": [{"code": "keywords_min", "message": "Less than 7 keywords"}]}
  },
  "has_ai_metadata": true
}
```

Ещё есть `size_bytes`, `created_at`, `updated_at`, `archived`, `preview_url`, `thumbnail_url`; `type` — `raster`, `vector` или `video`. У стока могут быть также `reviewed_at`, `scheduled_at` и `rejection_reasons`. Полные схемы — в документе OpenAPI.

### Статусы

| Статус | Значение |
| - | - |
| `ready` | Можно ставить в очередь; так же считается сток без статуса |
| `ignored` | Не отправляется на этот сток (решил пользователь или принудительно из-за ошибки валидации) |
| `queued` | Ждёт загрузки |
| `uploading` | Загружается |
| `uploaded` | Загружен на сток, ещё не засабмичен |
| `uploadfailed`, `submitfailed` | Этот шаг не удался; смотрите `errors` |
| `submitted` | Засабмичен, на проверке |
| `approved`, `rejected` | Принят или отклонён; причину, если сток её назвал, показывает `rejection_reasons` у этого стока |
| `approvalfailed` | Засабмичен, но на стоке его нет |
| `notready` | Атрибуция не проходит валидацию этого стока |
| `scheduled` | Загрузка на этот сток запланирована |
| `cannotbequeued` | Файл ещё обрабатывается или нет нужного формата |
| `nosubmissions` | Исчерпан лимит сабмитов |

### Id стоков

Берите id из `GET /me` (`mplus_get_account`); основные: `adobestock` (Adobe Stock), `shutterstock`, `esp` (iStock), `pond5`, `alamy`, `dreamstime`, `123rf` и `depositphotos`.

### Id категорий

Категории задаются как `{"cat": <id>, "sub": <id>}`, не больше 3 на файл; если подкатегория не подходит, не передавайте `sub`. Id постоянные: новые только добавляются. Названия — те же, что в дереве категорий Microstock+.

| `cat` | Категория | Id `sub` |
| - | - | - |
| 1 | Abstract | 1 Miscellaneous, 2 Backgrounds, 3 Lights and Colors, 4 Shapes, 5 Blurs |
| 2 | Animals/Wildlife | 1 Birds, 2 Pets, 3 Sea and Ocean life, 4 Insects, 5 Farm animals, 6 Miscellaneous |
| 3 | Backgrounds/Textures | 1 Textures, 2 Backgrounds, 3 Miscellaneous |
| 4 | Beauty/Fashion | 1 Clothing, 2 Parfume, 3 Miscellaneous |
| 5 | Buildings/Landmarks | 1 Miscellaneous, 2 Historic buildings, 3 Indoor, 4 Outdoor, 5 Modern Building |
| 6 | Business/Finance | 1 Miscellaneous, 2 Financial, 3 People, 4 Objects |
| 7 | Celebrities | 1 Miscellaneous, 2 Holidays |
| 8 | Education | 1 Miscellaneous, 2 Objects, 3 School, College, University etc |
| 9 | Food and Drink | 1 Miscellaneous, 2 Food, 3 Drink |
| 10 | Healthcare/Medical | 1 Miscellaneous, 2 Objects |
| 11 | Holidays | 1 Miscellaneous, 2 Objects |
| 12 | Illustrations/Clip-Art | 1 Miscellaneous, 2 2D, 3 3D, 4 Vector |
| 13 | Industrial | 1 Miscellaneous, 2 Power and Energy, 3 Construction, 4 Manufacturing, 5 Military |
| 14 | Interiors | 1 Miscellaneous, 2 Objects, 3 Furniture |
| 15 | Miscellaneous | 1 Miscellaneous |
| 16 | Nature | 1 Miscellaneous, 2 Sky, 3 Sea/Ocean/River, 4 Parks, 5 Flowers, 6 Underwater, 7 Plants and trees |
| 17 | Objects | 1 Miscellaneous, 2 Electronics, 3 Isolated, 4 Sports |
| 18 | Parks/Outdoor | 1 Miscellaneous |
| 19 | People | 1 Miscellaneous, 2 Babies, 3 Men, 4 Women, 5 Families, 6 Teens |
| 20 | Religion | 1 Miscellaneous |
| 21 | Science | 1 Miscellaneous |
| 22 | Signs/Symbols | 1 Miscellaneous |
| 23 | Sports/Recreation | 1 Miscellaneous |
| 24 | Technology | 1 Miscellaneous, 2 Computers, 3 Electronics |
| 25 | The Arts | 1 Miscellaneous |
| 26 | Transportation | 1 Miscellaneous, 2 Cars, 3 Trucks, 4 Water transport, 5 Airplanes |
| 27 | Vintage | 1 Miscellaneous |

### Ошибки

У всех ошибок одинаковый конверт:

```json
{"error": {"type": "invalid_request_error", "code": "keywords_too_many",
           "message": "A file can have at most 50 keywords.", "param": "keywords", "request_id": "req_7f3c..."}}
```

Ветвитесь по `type` и `code`, никогда по `message`. MCP-инструменты возвращают ошибки как результат с `isError: true` и тем же кодом в тексте.

| HTTP | `type` | Типичный `code` | Что делать |
| - | - | - | - |
| 400 | `invalid_request_error` | `invalid_json`, `missing_param`, `invalid_status`, `batch_too_large` | Исправить запрос; `param` называет поле. В батче не больше 100 элементов. |
| 401 | `authentication_error` | `invalid_api_key`, `revoked_api_key` | Остановиться. Попросить у пользователя новый ключ с https://microstock.plus/ai-agent-skills. |
| 403 | `permission_error` | `scope_required`, `not_owner`, `endpoint_disabled` | Сказать пользователю, какого скоупа не хватает; не обходить. `endpoint_disabled` — возможность пока недоступна: так и сказать, не повторять. |
| 404 | `not_found_error` | `file_not_found`, `folder_not_found`, `export_not_found`, `not_found` | Проверить id или путь, получить список заново. `not_found` на любой вызов — Agent API ещё не включён для этого аккаунта. |
| 405 | `permission_error` | `deletion_not_supported` | Удаление — вручную в веб-интерфейсе. Так и сказать пользователю. |
| 409 | `conflict_error` | `metadata_conflict`, `idempotency_mismatch`, `file_archived`, `file_processing` | Перечитать и объединить; для другого запроса — новый Idempotency-Key. Файлы в архиве менять нельзя, файлы в обработке — можно позже. |
| 429 | `rate_limit_error` | `rate_limited` | Подождать `retry-after` секунд и повторить один раз. |
| 5xx | `api_error` | `upstream_unavailable`, `api_not_configured` | Повторить позже; если не проходит, сообщить `request_id`. |

Пакетные эндпоинты отвечают `200` с ошибками по элементам (например, `metadata_conflict` в батче правок атрибуции); проверяйте `results[].ok`.

### Лимиты запросов

На ключ: 120 запросов в минуту и 30 изменений (POST и PATCH) в минуту. В каждом ответе есть `x-ratelimit-limit-requests`, `x-ratelimit-remaining-requests` и `x-ratelimit-reset-requests` (секунды). Батч до 100 элементов — это один запрос, поэтому правьте батчами, а не по одному файлу. При `429` подождите `retry-after` секунд и повторите один раз; MCP-сервер делает это сам, если ждать не больше 20 секунд.

## Чего Agent API не делает

**Пока недоступно** (есть в контракте; не предлагайте и не обещайте):

- Смена статусов, в том числе отправка файлов на стоки — загрузка и сабмит.
- ИИ-атрибуция Microstock+: расчёт цены, платный запуск и прогресс задач.
- Поток Server-Sent Events и события о смене статусов, загрузках, сабмитах, проверке и ИИ-задачах.
- Баланс аккаунта (`balance_eur` равен `null`).

**Нет в v1:**

- Загрузки новых файлов, создания и перемещения папок, архивации.
- Списков релизов и шаблонов ИИ-атрибуции.
- Платных форматов CSV.
- Работы с чужими аккаунтами и с папками, которыми поделились другие пользователи.
- Создания, перевыпуска и отзыва ключей агентов через API (только на https://microstock.plus/ai-agent-skills).
- Изменения настроек аккаунта, тарифа и баланса.
- Вебхуков; используйте ленту событий.

**Никогда:** удаления чего-либо — файлов, папок, релизов, шаблонов, стоков, аккаунта. Удаление — вручную в веб-интерфейсе.

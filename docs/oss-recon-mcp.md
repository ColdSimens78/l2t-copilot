# OSS-разведка №9: каталог MCP-серверов для мультиагентной разработки L2T

**Автор:** OSS Scout · **Дата:** 2026-11-24 · **Для:** Lead (ревью) · **Тема:** «найти MCP под наш проект: оптимизация, улучшения»
**Методика:** GitHub API в день отчёта; лицензии NOASSERTION проверены по содержимому LICENSE-файлов; Serena-гайд составлен из **фактического manual её текущей сборки** (получен через `initial_instructions` в этой сессии, session 32394bfa) — не из README. Контекст команды: Lead (sess_dcae5ec5) + Backend Engineer (Rust-ядро) + Frontend Engineer (TS/React) + Scout (Python/разведка) — все в ZCode, все дети параллельны.

---

## TL;DR

**Уже установлены и недоиспользуются: Serena (31.7k★, symbol-level, 40+ языков) и Context7 (65.4k★, доки)** — они закрывают 80% потенциала «оптимизация/улучшения»; вывод №1 — не тащить новое, а **встроить два имеющихся в рабочие процессы детей** (чек-лист в §1–2). Устанавливать дополнительно: официальный **github-mcp-server** — спорно (см. §3), скорее **НЕ нужен** (gh CLI покрывает). Свежих MCP для cargo/pytest — нет зрелых (CLI хватает). В музыкальной нише вне нашего стека два мелких проекта (для видимости конкурентов, не для установки).

---

## 1. Кодинг-кластер: Serena — установлен, вот как нам им пользоваться

| | Факт |
|---|---|
| Репо | [oraios/serena](https://github.com/oraios/serena) |
| ★ / активность | **31667★**, push 2026-11-23 (вчера) — живейший проект в классе |
| Лицензия | 🟡 **split**: «SolidLSP under the MIT License and the Serena application under GPL-3.0-or-later» (LICENSE прочитан дословно) — **как внешний MCP-процесс = допустимо** (наш стандарт для GPL-инструментов: fluidsynth-паттерн); **код в наш репо не копировать** (кроме SolidLSP-компонента, если когда-нибудь понадобится отдельно) |
| Языки | **40+ через LSP**: Rust, Python, TypeScript/JavaScript, C/C++, Go, Java… — наше трио (Rust/Python/TS) покрыто полностью |
| Статус у нас | установлена в ZCode (инструменты `mcp__serena__*` доступны в этой сессии) |

### Гайд «как нам ей пользоваться» (из фактического manual + инструментов)

**Принцип (цитата manual):** «Avoid reading whole files unless necessary — acquire information step by step, using the symbolic functions» — Serena экономит токены там, где мы сейчас читаем файлы целиком.

**Типовые циклы наших ролей:**

| Задача | Цикл Serena | Экономия |
|---|---|---|
| Backend: «найти где формируется XRayReport» | `activate_project ~/l2t-copilot` → `lsp.get_symbols_overview facade.rs` → `lsp.find_symbol XRayReport (include_body=False, depth=1)` → тело только нужного | вместо чтения 500-строчного файла — 3 точечных вызова |
| Backend: рефакторинг имени в contract.rs | `lsp.rename_symbol` — «reference-aware, updates all usages atomically… do not re-read the changed files or re-run build just to confirm» (цитата) | rename + ноль верификационных чтений |
| Backend: кто вызывает generate_part? | `lsp.find_referencing_symbols` — даёт сниппеты вокруг вызовов | вместо grep+чтения 5 файлов |
| Frontend: заменить один Symbol целиком | `edit.replace_symbol_body`; вставки — `edit.insert_after_symbol` | структура-aware, без подсчёта строк |
| Scout/любой: точечные правки | `edit.replace_content` (regex-режим: «wildcards like `start.*?end`… an ambiguous match returns an error you can refine»); batch по многим файлам — `edit.replace_in_files` с `dry_run` (предпросмотр диффа per-occurrence) | наш шаблон-паттерн из темы про локальные доки стал безопасным |
| Поиск не-символьных паттернов | `fs.search_for_pattern` | grep-замена внутри Serena |

**Правила из manual, важные для наших детей:**
- номера строк **0-based** (источник рассинхронов с Read-инструментом);
- «batching parallel tool calls is the single biggest lever on cost» — Serena исполняет свои вызовы последовательно и безопасно → параллелить смело;
- после символ-редакта НЕ перечитывать файл и НЕ гонять сборку ради проверки самого редакта («trust it»);
- привязка к проекту: `activate_project` по пути (`~/l2t-copilot`) — дети активируют при старте задачи.

**Альтернатива:** [isaacphi/mcp-language-server](https://github.com/isaacphi/mcp-language-server) — 🟢 BSD-3 (LICENSE прочитан), 1624★, но **push 2026-03-01 — 9 мес тишины** (T1-паттерн audio-analyzer-rs). Serena по звёздам/активности/языковому покрытию качественно впереди — альтернатива не нужна.

## 2. Docs-кластер: Context7 — установлен, как звать

| | Факт |
|---|---|
| Репо | [upstash/context7](https://github.com/upstash/context7) |
| ★ / активность | **65387★**, MIT, push 2026-11-24 (сегодня) |
| Статус у нас | установлен (`mcp__context7__resolve-library-id` + `query-docs`) |
| Как звать (фактический протокол из описания инструментов) | (1) `resolve-library-id(query, libraryName)` — возвращает Context7-ID вида `/org/project`; (2) `query-docs(libraryId, query, language?, version?)` — **лимит: ≤3 вызова на вопрос**; version передавать, если проект называет конкретную (например, `15.4.3`); language ранжирует примеры кода |
| Практика для нас | Rust: `/rust-lang/tokio`, `serde`; TS: Tauri v2 доки (у нас уже URL v2.tauri.app — Context7 даёт выдержки без fetch); Python: mcp SDK. Кейс темы №8: параметрические словари rmcp удобнее смотреть в Context7, чем грепать crates.io |

Альтернативы (andrea9293/mcp-documentation-server 347★ и прочие) — на порядок меньше и без LSP-точности; **не нужны**.

## 3. Git/GitHub-кластер: официальный MCP vs наш gh CLI

| | github-mcp-server (официальный) | наш gh CLI (текущий путь) |
|---|---|---|
| Репо/лицензия | [github/github-mcp-server](https://github.com/github/github-mcp-server), 🟢 MIT, **34720★**, Go, push сегодня | — |
| Покрытие | ~40 инструментов: issues/PR/repo-структура/Actions/код-поиск;_dynamic API-инструменты | полный (gh api до любого REST-эндпоинта — мы этим всю разведку и делали) |
| Что даёт агентам | структурные фейлы (create_issue без конструирования JSON), less token boilerplate | универсальность: `--jq`-фильтры режут ответы ДО попадания в контекст — **важнее для токенов** |
| Риск/стоимость | ещё один процесс/конфиг на каждого ребёнка; дубль авторизации (у нас keyring-токен уже в gh) | ничего |

**Вердикт: НЕ устанавливать.** gh CLI + `--jq` уже доказал эффективность (все 8 разведок сняты им); MCP-версия добавит токен-оверhead на описания 40 инструментов в контексте каждого ребёнка при нуле новой способности. Пересмотреть, если перейдём на NOT-auth-агентов без shell (не наш случай).

## 4. Тесты/сборка: cargo/pytest MCP — зрелых нет, CLI хватает

Скан «mcp rust cargo» / «mcp test runner»: лучший — privsim/mcp-test-runner **17★**; остальные ≤5★/нулевые. Ни одного зрелого (звёзды/активность/лицензия на уровне наших стандартов). **Вывод: не устанавливать** — `cargo test`/`pnpm test` через Bash дают полный stdout-контроль (наши дети уже так работают; MCP-обёртка лишь спрячет вывод). Наблюдать появление зрелого (критерий: ≥500★, живой, MIT/Apache, explicit exit-code/timeout semantics — наши уроки bounded errors).

## 5. Audio/MIDI-специфика: экосистемная видимость

| Проект | Лицензия | ★ / активность | Что это для нас |
|---|---|---|---|
| [linxule/mcp-music-studio](https://github.com/linxule/mcp-music-studio) | 🔴 AGPL-3.0 | 80★, push 2026-11-23 (живой), TS | «Two-mode MCP music studio: scored composition (ABC notation)…» — ближайший концептуальный сосед (composition через MCP); **читать как референс UX-инструментов, не встраивать**; в конкурентную таблицу PRD |
| [hugohow/mcp-music-analysis](https://github.com/hugohow/mcp-music-analysis) | 🟢 MIT | 35★, **push 2025-08-12 — 15+ мес тишины (T1-мёртв)**, Python librosa+whisper | прямая ниша нашего audio-analyzer-rs; Rust-анализатор быстрее (91 ms vs librosa-python) и в нашем пуле бинарей; **не устанавливать**; память проекта уже отмечала его ~70%-overlap |
| zas/mcp-musicbrainz | 🔴 GPL-3.0 | 13★ | метаданные/дискографии — не наш кейс |
| Прочие (mcp-audio*, transcription-серверы) | — | ≤8★ | speech/transcription-направление, не музыкальный анализ |

**Вывод:** готового музыкального MCP-стека уровня нашего (analyzer+generation+DAW-контроль) **на рынке нет** — экосистемная позиция подтверждена: мы — самая полная музыкальная MCP-связка в OSS. Для конкурентного патруля: mcp-music-studio (раз в спринт, методика №3).

## 6. Вердикт

### Установить (топ-5)

| # | Что | Действие |
|---|---|---|
| 1 | **Serena** — уже установлена | **Не «установить», а внедрить**: чек-лист гайда §1 разослать детям (Backend/Frontend/Scout) как рабочий процесс; активация `~/l2t-copilot` при старте задачи |
| 2 | **Context7** — уже установлен | Внедрить: перед API-вопросами (rmcp/tokio/tauri/mcp-sdk) — resolve+query (≤3 вызовов), вместо веб-фетчей |
| 3 | github-mcp-server | ❌ **не устанавливать** (gh CLI покрывает; см. §3) — вычеркнуть из кандидатов |
| 4 | cargo/pytest MCP | ❌ зрелых нет; наблюдать (§4) |
| 5 | музыкальные MCP | ❌ не устанавливать: studio = AGPL-референс, analysis = мёртв; наш стек полнее (§5) |

Итого из новых — **ничего**: обе главные конфетки уже в конфиге ZCode и недоиспользуются. Это и есть оптимизация: не рост стека, а утилизация имеющегося.

### Наблюдать (топ-3)

1. **isaacphi/mcp-language-server** (BSD-3, 1624★) — если Serena начнёт пробуксовывать на Rust-analyzer (LSP-бэкенды иногда конфликтуют на workspace с нестандартными таргетами), это готовый запасной LSP-MCP; критерий пробуждения: push живее 3 мес.
2. **Зрелый test-runner MCP** (критерии §4) — при переходе детей на «короткие заходы» (rate-limit-урок) может пригодиться для экономии shell-раундтрипов.
3. **mcp-music-studio** (AGPL, живой) — конкурентный патруль раз в спринт: их scored-composition UX против нашего midi-gen-стека.

### Что НЕ нужно (анти-каталог)

- **github-mcp-server** — дубль gh CLI (§3);
- **Документационные MCP-серверы** (mcp-documentation-server и под.) — Context7 качественнее на порядок;
- **Тест-раннер MCP текущего рынка** — незрелые, прячет вывод;
- **Любые audio/music MCP в установку** — ниша наша, всё мелкое/мёртвое/AGPL;
- **Memory-MCP** (mem0 и под.) — у нас file-based память проекта с протоколом детей — они решают другую задачу и добавили бы второй источник истины.

### Риски внедрения Serena (честно)

1. 🟡 GPL-3.0 приложение — только как процесс (наш fluidsynth-паттерн); в DEPENDENCIES.md записать «Serena — dev-инструмент процесса, не зависимость артефакта» (артефакты мы ею не собираем — на дистрибуцию не влияет).
2. 152 открытых issue при 31.7k★ — крупный проект с живым тикет-трафиком; при поломке LSP на нашем workspace — fallback Bash/Read, работа не останавливается (Serena — оптимизация, не зависимость).
3. Дети должны помнить 0-based строки и «не перечитывать после символ-редакта» — иначе экономия токенов сгорает.

## Источники (все 2026-11-24)

- GitHub API: oraios/serena (31667★), upstash/context7 (65387★), github/github-mcp-server (34720★), isaacphi/mcp-language-server (1624★), linxule/mcp-music-studio (80★), hugohow/mcp-music-analysis (35★), zas/mcp-musicbrainz (13★), privsim/mcp-test-runner (17★), andrea9293/mcp-documentation-server (347★) + поисковые выборки «mcp language server/lsp/audio/music/test runner/documentation/rust cargo»
- Лицензии из файлов: Serena LICENSE (split MIT/GPL-3.0+), isaacphi LICENSE (BSD-3), метрики music-studio/analysis (AGPL/MIT по API)
- Фактический Serena-manual: получен инструментом `initial_instructions` этой сессии (сессия 32394bfa) — API lsp.*/edit.*/fs.* и цитаты правил
- Локальный конфиг: `~/.zcode/cli/config.json` (mcp.servers: audio-analyzer, midi-gen) + ZCode-встроенные Serena/Context7

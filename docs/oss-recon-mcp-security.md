# OSS-разведка №10 (СЕКЬЮРИТИ-КРИТИЧНАЯ): проверка списка MCP владельца

**Автор:** OSS Scout · **Дата:** 2026-11-24 · **Для:** Lead + владелец · **Тема:** список «MCP для установки» — верификация каждого пункта перед любым `mcp.servers`-изменением
**Контекст правила:** MCP-сервер исполняется **локально с полным доступом к файлам проекта** (вне workspace-песочницы ZCode) — установка = выдача прав процессу из стороннего репо. Политика верификации: **NOVERIFY = reject**; каждое утверждение ниже снабжено источником (GitHub API / LICENSE-файл / PyPI JSON, все сняты 2026-11-24).

---

## Сводная таблица (вердикты)

| # | Пункт списка владельца | Существует? | Вердикт |
|---|---|---|---|
| 1 | V.I.S.O.R. | ⚠️ не как заявлено | **REJECT** — продукта-«V.I.S.O.R.» для кодинг-MCP не существует; единственный кандидат-омоним не совпадает по назначению |
| 2 | CodeShave | ✅ существует | **REJECT** (секьюрити: нет LICENSE-файла, 3-дневный, 1★) |
| 3 | T-Zero Context Architect | ✅ существует (TZeroAlgorithm) | **WATCH** (функциональный дубль Serena; AGPL; маркетинг-паттерн «v12») |
| 4 | zcode-mcp-server | ⚠️ не как заявлено | **REJECT** — точного имени нет; единственный «мост в ZCode-харнесс» от случайного автора не нужен |
| 5 | ZCode Community Memory Integration | ⚠️ не как заявлено | **REJECT** — есть только 0–1★ клоны памяти для чужих платформ; у нас своя file-based память с протоколом |
| 6 | zcode-supervisor | ✅ существует | **REJECT** (для Codex, не ZCode; v0.0.2, тих 4 мес; дублирует нашу мультиагентную систему) |
| 7 | PostgreSQL / Supabase / dbx MCP | ✅ все существуют, качественные | **REJECT по применимости** (у нас нет ни Postgres, ни Supabase, ни Dropbox — инструмент без объекта применения) |

**Итог: 0 из 7 в install.** Ни один пункт списка не проходит верификацию «полезно нам + безопасно + лицензия чистая» одновременно.

---

## Красная секция: НЕ УСТАНАВЛИВАТЬ И ПОЧЕМУ

### 🚫 CodeShave — самый проблемный пункт списка

| Факт | Источник |
|---|---|
| Репо создан **2026-11-21** (за 3 дня до этого отчёта) | GitHub API `created_at` |
| **1 звезда**, push 2026-11-24 | GitHub API |
| **LICENSE-файла в репо НЕТ** (запрос возвращает 404), GitHub API: `license: NONE` | contents API |
| При этом README носит бейдж «license-MIT-green» и «Official MCP Registry Verified» | README, raw |
| PyPI `codeshave 0.2.2`: поле license **пустое**, `requires_dist: None` | PyPI JSON API |
| Автор: gmail-аккаунт, ник jaideepkrishna2008-ui, buy-me-a-coffee в шапке | README |

**Почему красный:** без LICENSE-файла PyPI-пакет юридически «all rights reserved» — установка и исполнение не разрешены явно; ссылка на лицензию есть, файла нет (несоответствие маркетинга и содержимого — классический флаг supply-chain-риска); возраст проекта 3 дня при «Verified»-бейджах; «AST code compressor» — функция, уже покрытая Serena (symbol-level, §сверка). **Не устанавливать; пересмотреть, если появится LICENSE + ≥6 месяцев истории + внешнее комьюнити.**

### 🚫 «V.I.S.O.R.» — продукт не существует как заявлено

Поиск «VISOR» по GitHub (сортировка по звёздам) даёт **гипервизоры** (SimpleVisor 2024★, MiniVisorPkg, WinVisor, NoirVisor — Intel VT-x research, к MCP отношения не имеют) и одну MCP-унцию: [ameshkov/visor-mcp](https://github.com/ameshkov/visor-mcp) — MIT, **9★**, «vision tools for text-only models» (отдаёт картинки LLM), создан 2026-07, **тих с 2026-07-20 (4 мес)**. Ни один не «V.I.S.O.R.» с точками и не совпадает с типичным смыслом пункта. **Вероятная природа пункта: AI-галлюцинация в источнике списка владельца.** Действие: попросить владельца источник ссылки; если имеется в виду visor-mcp (vision) — наш стек не нуждается (playwright-screenshots + image-generation покрывают), REJECT.

### 🚫 «zcode-mcp-server» — имени нет; мост в наш харнесс от третьего лица

Точного репо `zcode-mcp-server` не существует. Ближайший: [BaconWappedBitcoin/zcode-desktop-bridge](https://github.com/BaconWappedBitcoin/zcode-desktop-bridge) — MIT, **9★**, создан 2026-10-03, **тих с 2026-10-07**, описание: «Anthropic-compatible API + MCP server **over the ZCode desktop harness**». Секьюрити-логика: это сторонний мост, выставляющий наружу API совместимый с Anthropic поверх **нашего же desktop-харнесса** — установка означала бы сторонний процесс, сидящий между ZCode и внешними клиентами. Зачем: у нас прямой доступ к ZCode-инструментам; открывать внешнюю API-поверхность над харнессом — расширение атакующей поверхности без выгоды. **REJECT.**

### 🚫 «ZCode Community Memory Integration» — только 0–1★ клоны чужих платформ

Существует россыпь микропроектов (все ≤1★, скан 2026-11-24): Rogers-F/zcode-memory («for PI-Desktop, DSH»), ximeng-y/ZCodex-Memory (1★, «портирует ZCode-память в Codex»), Yukinekoko/zcode-memory-plugin (0★, «OpenViking»), gniquil123/dsh-zcode-memory (0★, «移植了ZCode的记忆功能到DSH»), Qianshi05/zcode-memory-guard (0★, PreToolUse-hook). **Ни один — не «Community Memory Integration» как целостный продукт.** По существу: наша память — собственная file-based система с протоколом детей (memory-file, append-only статусы) — работает и верифицирована месяцами; внешняя «memory-интеграция» создала бы **второй источник истины** — анти-паттерн, который мы запрещали даже внутри своего стека (anti-dual-source, proposal v0.3 §3.3). **REJECT.**

### 🚫 zcode-supervisor — чужой супервизор для другой платформы

[AkiGarage/ZCode-supervisor](https://github.com/AkiGarage/ZCode-supervisor) — MIT, **5★**, v0.0.2, создан 2026-06-18, **тих с 2026-07-14 (4+ мес)**, README: «**Codex-side** supervisor tooling for safely delegating bounded coding tasks». Три причины отказа: (1) написан для Codex-экосистемы (сцепка с чужим агентом), (2) версионная зрелость v0.0.2 при 4 месяцах тишины = заброшенный прототип, (3) **дублирует нашу собственную мультиагентную систему** (Lead + 4 ребёнка, протокол файла-памяти, правило №7 peer-координация) — которая уже работает и отлажена на наших процессах. Установка стороннего супервизора поверх нашей иерархии = конфликт двух систем управления. **REJECT.**

### 🚫 PostgreSQL / Supabase / dbx MCP — качество высокое, применимость нулевая

Это единственные качественные пункты списка — но их объект применения у нас **отсутствует**:

| Продукт | Лицензия | ★ | Активность | Что делает |
|---|---|---|---|---|
| [supabase-community/supabase-mcp](https://github.com/supabase-community/supabase-mcp) | 🟢 Apache-2.0 | 3025★ | push сегодня | управление Supabase-проектами (DB-схемы, миграции, SQL) |
| [crystaldba/postgres-mcp](https://github.com/crystaldba/postgres-mcp) | 🟢 MIT | 3498★ | push 2026-08 (тихо 3 мес) | Postgres admin/health/index-tuning («Postgres MCP Pro») |
| amgadabdelhafez/dbx-mcp-server | ? | 30★ | — | **Dropbox**-файлы |

**Почему reject несмотря на качество:** в l2t-стеке **нет PostgreSQL, нет Supabase, нет Dropbox** — файлы проекта лежат на локальной FS, память в SQLite qwen-stack (если Brain-слот включат). Установка DB-MCP означала бы: агент с правами SQL/облако-хранилища **без легитимной цели** — чистое расширение атакующей поверхности (правило секьюрити-минимума: не держать инструменты без объекта применения). **REJECT; пересмотреть при появлении реального Postgres-потребления** (например, если memory_proxy qwen-stack станет частью прод-стека — тогда crystaldba/postgres-mcp 🟢MIT — кандидат №1, уже верифицирован этим отчётом).

### 🟡 T-Zero Context Architect (= TZeroAlgorithm) — единственный WATCH

[toprakahmetaydogmus/TZeroAlgorithm](https://github.com/toprakahmetaydogmus/TZeroAlgorithm) — 🔴 **AGPL-3.0** (LICENSE-бейдж + API), **89★**, Python+Rust-AST, push 2026-11-23 (живой), создан 2026-07. Что делает (README): «Deterministic AST Context Compressor… 21 Canonical MCP Tools» — сжимает контекст кода для экономии токенов LLM; PyPI `tzero-mcp` v12.1.4, заявки 20k+ загрузок, CodeQL/тесты-бейджи.

**Почему не install, несмотря на живость:** (1) **AGPL** — только как внешний процесс (наш стандарт), но главное — (2) **функциональный дубль Serena**: symbol-level-выборка (§сверка) даёт то же сжатие контекста точнее (семантика vs «компрессия»), и уже встроена; (3) маркетинг-паттерн: «v12.1.4» от соло-автора при 89★ (прыжки мажоров — классика самопиара), «100% Zero-Leak Security» бейдж — самопровозглашённая метрика без внешнего аудита; (4) compressed-context подход противоречит нашему принципу «точечная семантика вместо слепого сжатия». **WATCH**: если Serena начнёт жрать токены на больших сессиях — пересмотреть benchmark tzero против Serena-циклов (критерий: измеримая экономия > 30% на нашем коде без потери точности правок).

---

## Сверка с установленным стеком (дублей из списка НЕТ)

| Установлен | Что даёт | Перекрыл бы из списка? |
|---|---|---|
| audio-analyzer-rs (наш, pinned) | аудио-анализ MCP | — |
| midi-gen (наш код) | генерация MIDI | — |
| **Serena** | symbol-level кодинг, 40+ языков | **перекрывает CodeShave** (AST-компрессия — Serena точнее семантикой) и T-Zero (та же цель) |
| **Context7** | доки библиотек (≤3 вызова/вопрос) | — |
| **playwright** (официальный MS) | браузер/скриншоты | **перекрывает visor-mcp** (vision для LLM — скриншоты уже умеем) |
| gh CLI | GitHub-операции | (github-mcp-server уже отклонён в №9) |

**Дублей нет — но и не «пустое место»**: каждый существующий пункт списка либо секьюрити-красный, либо функционально перекрыт уже работающим стеком. Список владельца, по совокупности фактов, похож на подборку из AI-генерированной рекомендации (два несуществующих имени, маркетинговый 3-дневный проект, инструменты не под наш стек) — рекомендация владельцу: такие списки прогонять через Scout-верификацию до установки (это и есть тема №10 как процесс).

## Рекомендация процесса (для владельца)

1. **Правило установки MCP**: новый сервер попадает в `config.json` только после Scout-верификации по чек-листу этой темы (существует→автор→LICENSE-файл→активность→red flags→дубль-сверка→вередикт).
2. **NOVERIFY = reject** — работает: 2 из 7 пунктов оказались несуществующими именами, 1 — без лицензии.
3. Хранить в DEPENDENCIES.md принцип «MCP = внешние процессы с полным файловым доступом; каждый добавленный = строка с датой верификации».

## Источники (все 2026-11-24)

- GitHub API: ameshkov/visor-mcp, jaideepkrishna2008-ui/codeshave (+ contents LICENSE → 404, + raw README), toprakahmetaydogmus/scoop-tzero, toprakahmetaydogmus/TZeroAlgorithm (+ raw README), BaconWappedBitcoin/zcode-desktop-bridge, AkiGarage/ZCode-supervisor (+ raw README), supabase-community/supabase-mcp, crystaldba/postgres-mcp, amgadabdelhafez/dbx-mcp-server; поисковые выборки «VISOR», «CodeShave», «tzero», «zcode-mcp-server», «zcode memory», «community memory mcp», «zcode-supervisor», «dbx mcp»
- PyPI JSON API: `pypi.org/pypi/codeshave/json` (license пустое, deps None)
- Стек-сверка: конфиг ZCode (audio-analyzer, midi-gen) + встроенные serena/context7/playwright (факты тем №1–9)

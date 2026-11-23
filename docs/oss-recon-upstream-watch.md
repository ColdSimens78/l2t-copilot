# OSS-разведка №4: апстрим-патруль SoundCraft + audio-analyzer-rs

**Автор:** OSS-разведка · **Дата:** 2026-11-22 · **Для:** мейнтейнер (ревью) · **Тема:** статусы наших issue, активность апстрима от overlay-базы acb08ff, ранний чек T1-триггера DECISION.md
**Методика:** GitHub API в день отчёта (gh CLI, аккаунт ColdSimens78); факты, выводы — за мейнтейнером (п. ТЗ).

---

## (а) Статусы наших трёх issue — все OPEN, ответов людей нет

| Issue | Состояние | Триаж | Комментарии |
|---|---|---|---|
| [JuzzyDee/audio-analyzer-rs#3](https://github.com/JuzzyDee/audio-analyzer-rs/issues/3) — sections-паника (`full_analysis`, index out of bounds, sections.rs:235) | OPEN | **Тишина**: 0 лейблов, 0 комментариев, created 2026-11-21 20:51 UTC, updated = created | нет вообще |
| [storytold/soundcraft#1701](https://github.com/storytold/soundcraft/issues/1701) — key-signature API (`event.key_signature`) | OPEN | **Триаж ботом через ~2 мин**: лейблы `priority: low`, `automation`, `backlog` | нет |
| [storytold/soundcraft#1702](https://github.com/storytold/soundcraft/issues/1702) — import-tempo overwrite | OPEN | **Триаж ботом через ~2 мин**: лейбл `priority: medium` + автоматическая ссылка: «Possibly related: **#890** and **#911**» | 1 (бот ticket-craft) |

**Контекст связанных (бот подсказал — проверено):** [#890](https://github.com/storytold/soundcraft/issues/890) «[Audit] SMF tempo and track floods» — CLOSED (labels: multiple issues, priority: medium, performance, security); [#911](https://github.com/storytold/soundcraft/issues/911) «[Audit] A failed web MIDI import is half-applied with no undo step» — CLOSED (priority: low, file-compat). Вывод-факт: SMF/темпо-тематика уже проходила у них аудит (#890), и поведение #1702, возможно, — следствие того фикса (намеренное «принять tempo файла»), а не oversight. Для L2T team: при разговоре про «opt-in half» (#1702) полезно сослаться на #890 как прецедент их подхода.

**Что это значит фактами:** SoundCraft реагирует на issue триажем в минуты (бот-инфраструктура есть), но человеческих ответов на наши два issue пока нет; #1701 отложен в backlog+low. audio-analyzer-rs — ноль реакции (репо тихо, см. ниже).

## (б) Активность SoundCraft-апстрима от acb08ff (наша overlay-база v0.5.0)

| Метрика | Факт |
|---|---|
| База acb08ff | 2026-10-12 «Merge PR #108 sampler-instrument» |
| Коммитов `acb08ff…main` | **1377** за ~41 день (~34/день) |
| Merged PR за тот же период | **490** |
| ★ / push | 4513★, push 2026-11-22 03:55 (сегодня) |
| Последний релиз | **v0.20.1 (2026-11-12)** — наш overlay на v0.5.0: апстрим успел пропустить 15 минорных версий за месяц |
| Лицензия | **dual MIT + Apache-2.0** (LICENSE-MIT / LICENSE-APACHE / NOTICE / ATTRIBUTION.md) — верхний уровень репо |

**Automation/MCP-слой — наш интерес (`crates/automation`): 18 коммитов** за период; по верхнему уровню репо пути `automation/`, `mcp/` отсутствуют — реальный путь `crates/automation/src/mcp.rs`. Значимые для нашего ZCode-плагина/DawBackend:

| Дата | Коммит | Влияние на нас |
|---|---|---|
| 2026-11-20 | [#1673](https://github.com/storytold/soundcraft/pull/1673) `mcp: add protocol transcript tests for initialize, cancel, and batch` | MCP-протокол покрыт транскрипт-тестами (initialize/cancel/batch) — эталонные транскрипты = бесплатный фреймворк для тестов нашего DawBackend-клиента |
| 2026-11-19 | [#1656](https://github.com/storytold/soundcraft/pull/1656) `automation(mcp): delegate MCP framing to craft-mcp-server` | **Ключевое изменение**: framing вынесен в крейт `craft-mcp-server` (в crates/ его нет — не публичный GitHub-репо по поиску; возможно cargo-крейт). Наш overlay-база acb08ff это изменение НЕ содержит — плагин работает как раньше; но будущий ребаз потребует разбора новой архитектуры framing'а |
| 2026-11-18 | #894 `fix(automation): Remote drops a connection whose reply is not its own` | Транспорт-фикс Remote-соединений |
| 2026-11-11 | #1506 «Take audio file formats from craft-audio; remove crates/audio-io» | Крейты переупаковываются под «craft-*» префикс — движение к shared-библиотекам (та же логика, что #1656) |
| 2026-10-31 | #1128 «Return app errors from Remote::call unchanged instead of reconnecting» | Поведенческий фикс: ошибки больше не триггерят reconnect — важно знать нашему stdio-клиенту |
| 2026-10-24 | #824 remote-control-client rejects fix; #979 repeatable automation roots | мелкие, automation-корни |

Прочее крупное за период (контекст, не automation): MIDI input devices live play-through + MIDI recording (#493), Import external-WAV AAF as editable session data (#799), Adopt shared AGENTS.md (RFC-0072), sonar/ci-инфраструктура, локализации.

## (в) Ранний чек T1-триггера (DECISION.md: upstream dead > 6 мес) — только факты

| Апстрим | Последний push | Т1-состояние (факт) |
|---|---|---|
| **storytold/soundcraft** | **2026-11-22** (сегодня, 03:55 UTC) | живой, экстремально активный; T1 к SoundCraft не приближается — вместо этого актуален вопрос **ребаза overlay** (v0.5.0 → v0.20.1) |
| **JuzzyDee/audio-analyzer-rs** | **2026-03-15** — **8+ месяцев тишины** (77★, 2 открытых issue, наш #3 без реакции) | **T1-горизонт 6 мес перекрыт** по календарю; репо не «архивирован», но признаков жизни нет. Мы потребляем его как standalone-бинарники (зафиксированная версия на `~/bin`) — апстрим-смерть не блокирует наш пайплайн; но значит: фикс #3 (sections.rs) **не придёт из апстрима** — наши обходные пути (суб-инструменты вместо full_analysis) остаются долгосрочными |

Факт-приложение: наш плагин-контракт с SoundCraft — overlay (upstream + патч-файлы), не fork (DECISION.md); триггеры T2/T3 не проверялись (это вопрос кода/ревью, не разведки).

## (г) Флаги для L2T team — что требует решения

1. **audio-analyzer-rs — T1-факт**: апстрим мёртв 8+ мес. Решения на выбор: (a) остаться на зафиксированных бинарниках + обходные пути (статус-кво, ничего не делать); (b) заложить в roadmap «свой патч sections.rs» (наш анализатор-модуль) — при этом вопрос лицензии LGPL/MIT самого крейта не возникает: мы НЕ линкуем, мы вызываем бинарник; (c) при появлении другого MCP-анализатора — пересмотреть слот «Анализ». Требует решения в PRD/ROADMAP — у нас висит «upstream issue #3 не ответят» как факт.
2. **Rebase-вопрос overlay v0.5.0 → v0.20.1**: 1377 коммитов/15 версий разрыва; MCP-framing (#1656, делегация в craft-mcp-server) и удаление crates/audio-io (#1506) — структурные изменения, затрагивающие наш патч `002-workspace-automation.patch`. Не форс-мажор (плагин на v0.5.0 работает), но чем дольше ждём, тем дороже ребаз. Предмет решения: окно ребаза (например, после стабилизации этапа 1).
3. **#1702-стратегия**: их триаж (medium + ссылка на закрытый SMF-аудит #890) намекает, что поведение может считаться intended. Наш «opt-in half»-аргумент (PRD: Adopt Loop Settings) стоит оформить как паттерн-запрос (PR с флагом), а не только issue-обсуждение — решение о PR за мейнтейнером.
4. **#1701 low+backlog**: если key-signature нужен для Self-Check-интеграции раньше их backlog — запасной план уже есть (named marker через `markers.add`, проверено в PoC 2); менять ничего не надо, просто не ждать.
5. **craft-mcp-server непубличен** (не нашёлся поиском GitHub): если наш будущий DawBackend-клиент захочет переиспользовать их framing-крейт, доступность под вопросом — проверить при первом ребазе (crates.io/приватный registry).

## Источники (все 2026-11-22)

GitHub API: `gh issue view` ×3 (+ #890/#911), `compare acb08ff...main`, `commits?path=crates/automation`, `search prs --merged`, `releases/latest`, `contents/crates`, `commits/acb08ff`. Даты/счётчики взяты из ответов API дословно.

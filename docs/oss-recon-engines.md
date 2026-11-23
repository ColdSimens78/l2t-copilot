# OSS-разведка №7 (стратегическая): headless-путь к аудио-движку для l2t-core

**Автор:** OSS-разведка · **Дата:** 2026-11-22 · **Для:** мейнтейнер + владелец (решение вместе) · **Тема:** программный доступ к движку БЕЗ хоста-агента (ZCode-плагина)
**Вводные правила темы:** мы НЕ заменяем SoundCraft-UI (микшер/редактор человека остаются — VISION v2); ищем программный доступ к движковой функциональности; лицензионный гейт ДО разбора фич; альтернатива должна быть заметно лучше доказанного пайплайна, не «примерно так же».
**Методика:** исходники/доки апстрима v0.20.1 через GitHub API (`docs/control-protocol.md`, `docs/cli.md`, `docs/mcp.md` — дословные цитаты), наш `BUILD.json` (плагин 0.2.4 в ZCode-кеше), лицензии — из LICENSE-файлов репо (Tracktion/libpd/faust — NOASSERTION в API проверены содержимым), crates.io для Rust-крейтов. Все метрики — 2026-11-22.

---

## Часть A — формализация требований (чек-лист движка L2T)

Источники: `docs/dawbackend-spec.md` (контракт DawBackend), наш верифицированный пайплайн (4-слойный трек end-to-end, Self-Check), USER FLOW v1. Движок обязан:

| # | Требование | Происхождение |
|---|---|---|
| 1 | **Программный контроль из внешнего процесса**: сокет/JSON-строки/MCP/OSC/CLI; headless-режим без GUI | dawbackend-принцип «UI = проекция шины»; наш bus-контракт (stdio-MCP) |
| 2 | **Сессионная модель**: темп-карта, key-маркеры (convention), MIDI-треки, импорт `.mid`/`.wav` | daw.get_session / set_tempo / adopt_loop / import_midi / add_marker |
| 3 | **Встроенные инструменты** (синт + драм-синт или soundfont-хостинг) — чтобы импортированные партии **звучали** при рендере | наш MVP: subtractive_synth/drum_synth auto-assign |
| 4 | **Bounce/render в WAV офлайн** (+ LUFS/peak-отчёт — бонус) | daw.render → Self-Check (LUFS-дельта, keys_match) |
| 5 | **Undo** | dawbackend-принцип 4 «undo хоста — механизм отката» |
| 6 | **Состояние сессии как JSON** (inspect: треки/клипы/маркеры/транспорт) | daw.get_session |
| 7 | **Лицензия**: MIT/Apache/BSD — встраивание; LGPL/GPL — только внешний процесс | наше монетизационное правило (ATRI-урок, DEPENDENCIES.md) |
| 8 | **Язык/рантайм**: Rust-крейт идеален; C/C++ — допустим как sidecar-процесс | l2t-core = Rust (rmcp+tokio) |
| 9 | **Зрелость/активность** | Т1-урок audio-analyzer-rs (8 мес тишины = смерть) |

Дополнительно из практики (не блокеры, но проверка на спайке): workspace-песочница файловых путей (правило 1 контракта), bounded-ошибки без зависаний, быстрый холодный старт (~наш wake-паттерн 8 с — сравнить с CLI).

---

## Часть B — SoundCraft deep-dive (базовый кандидат): headless-стек УЖЕ ЕСТЬ в апстриме

### Что наш плагин оборачивает (факт из BUILD.json)

Плагин ZCode (0.2.4 в кеше) = **WASM-сборка `soundcraft-web`** (40 MB wasm + js, сборка `trunk build --release`), commit **acb08ff (v0.5.0, 2026-10-12)** + патч `002-workspace-automation.patch` (sha256 зафиксирован в BUILD.json). То есть ZCode-плагин — это web-версия движка в WebView плагина; automation идёт через внутренний мост плагина (`execute`).

### Как апстрим v0.20.1 выставляет automation наружу (docs/control-protocol.md, дословно)

| Surface | Как | Статус для нас |
|---|---|---|
| **Control channel живого приложения** | `soundcraft --control <port>` (`0` = свободный порт, печатает `SOUNDCRAFT_CONTROL_PORT=…`) | для гибрида «UI открыт + ядро командует» |
| **CLI к живому приложению** | `soundcraft-cli app --port <port> <method>` | утилитарный доступ |
| **Headless CLI** | `soundcraft-cli run --demo --cmd 'mix.volume={…}' --bounce out.wav` | **наш главный путь: без окна, команды + bounce + save + inspect** |
| **MCP headless** | `soundcraft-cli mcp [--demo]` | **апстримный MCP-сервер на stdio — l2t-core подключается как есть** |
| **MCP bridged** | `soundcraft --control 7801 &` + `soundcraft-cli mcp --connect 7801` | «same tools plus screenshots and clicks» — гибрид с UI |
| **script** | `soundcraft-cli script steps.txt --demo --save out.scraft` | батч-режим |
| **info / convert** | JSON-инфо файла; convert: resample, bit depth, **normalize** | утилиты для пайплайна (опционально) |

**Wire format control channel:** newline-delimited JSON over **TCP на 127.0.0.1**; методы `engine.execute {command, params}` (никогда не открывает диалог!), `engine.commands` (каталог), `session.inspect {detail: full}` — «tracks, clips (with times), inserts (+params), sends, routing, automation, markers, groups, busses, sources, selection, transport, **undo label**» = это ИМЕННО наш `daw.get_session` (расширенный). Позиции в samples/seconds/bars_beats/timecode. `app.quit`. Скриптовый ввод (ui.click/key/…) для UI-тестов.

**Headless MCP уже с песочницей лучше нашего патча:** `--automation-read-root/--automation-write-root` — **мультикорневые** (по несколько флагов; read и write раздельно; симлинки резолвятся; отказ — читаемая bounded-ошибка). Это ровно наше «workspace = граница песочницы» (правило 1 контракта шины), реализованное апстримом.

**Каталог команд**: «every action scriptable» — включая наши верифицированные `event.tempo`, `markers.add`, `file.import_midi` (+`file.import_audio`, `file.bounce_mix`, `file.bounce_stems`, `file.export_midi`, `save_session`, `edit.undo`), встроенные плагины (`soundcraft-cli plugins` — список; README: демо-песня «every sound in it is synthesised by SoundCraft itself» → встроенные синты в headless работают).

### Ответ на ключевой вопрос

**Может ли l2t-core сам поднять/погреть/командовать SoundCraft без ZCode-плагина? — ДА, двумя путями:**

1. **Headless-MCP (основной)**: `spawn soundcraft-cli mcp --automation-read-root <workspace> --automation-write-root <workspace>` из Rust-ядра → stdio-протокол, наш rmcp-клиент подключается как к midi-gen/audio-analyzer. Ноль UI, ноль плагина, песочница штатная. Транспорт наш уже доказан (audio-analyzer-rs работает так же).
2. **Control-TCP (гибрид)**: `spawn soundcraft --control 0` → чтение `SOUNDCRAFT_CONTROL_PORT` из stdout → NDJSON-TCP — когда нужен живой UI (SoundCraft-UI как микшер остаётся открытым по VISION) или скриншоты.

**Wake-паттерн**: наш ~8 с `open_editor` — стоимость UI-плагина; headless-CLI не требует окна/аудио-девайса — холодный старт ожидаемо быстрее, **измерить на спайке** (первая оценка + зачистка «движок просыпается» Screen 0).

**Два факта-ограничения:**
- **soundcraft-cli появился 2026-11-13** (первый коммит по пути apps/soundcraft-cli) — ПОСЛЕ нашей базы acb08ff (2026-10-12). Наш v0.5.0-плагин CLI не содержит → headless-путь требует **релизный бинарь v0.20.x** (Linux: tar.gz/AppImage/deb в release-артефактах; CLI — отдельный артефакт `soundcraft-cli-*.zip` для macOS, для Linux внутри tar.gz/AppImage — проверить на спайке) **или** ребаз оверлея. Наш ZCode-плагин при этом остаётся как UI-интеграция ZCode — каналы не конфликтуют, если Source-of-truth один (сессия; см. риски).
- Статус апстрима — **pre-alpha** (README-бейдж): API/MCP-инструменты дрейфуют (наш патруль №4: 1377 коммитов за 41 день). Смягчения: RFC-0012 CLI-конвенции, MCP transcript-тесты #1673 (initialize/cancel/batch), автоматические релизы с SHA256SUMS+подписью. Дрейф = пин конкретной версии бинаря в нашем стеке (как мы пиннули audio-analyzer-бинарники).

---

## Часть C — рыночный скан: программируемые движки/DAW-ядра

Лицензионный гейт применён до разбора фич. Формат: светофор = для встраивания в MIT-репо.

### Основная таблица

| Кандидат | Лицензия (факт) | ★ / активность | Язык | Сессионная модель | Вердикт по гейту |
|---|---|---|---|---|---|
| **Tracktion Engine** ([Tracktion/tracktion_engine](https://github.com/Tracktion/tracktion_engine)) | 🔴 **dual GPL-3.0 / Commercial** (LICENSE.md прочитан: «dual GPL3 (or later)/Commercial… multiple commercial licensing tiers») | 1468★, push 2026-11-20 | C++ | **самая полная в OSS-мире**: треки/плагины/автоматизация/рендер — реальное ядро Waveform | GPL-вариант = заражение MIT-репо; commercial = платные тиры. Только как «future опция за деньги» (решение владельца), не v0 |
| **libpd** ([libpd/libpd](https://github.com/libpd/libpd)) | 🟢 **«Standard Improved BSD License»** (LICENSE.txt прочитан дословно) | 1256★, push 2026-09-20 | C | **Нет**: патчи Pure Data, не DAW-сессии (темп-карта/undo/треки — строить самим) | Встраивание чисто; но покрывает только требование 3 (синт-хостинг) — это «инструментальный сервер», не движок. Кандидат-расширение, не замена |
| **Pure Data** ([pure-data/pure-data](https://github.com/pure-data/pure-data)) | 🟢 BSD-семейство (libpd = та же лицензионная база) | 2126★, живой | C | нет сессии; headless `-nogui` есть, OSC через объекты | то же, что libpd, но libpd для нас удобнее (embeddable). Не замена |
| **SuperCollider scsynth** ([supercollider/supercollider](https://github.com/supercollider/supercollider)) | 🔴 GPL-3.0 (для встраивания); как **внешний процесс** — обсуждаемо (OSC-сервер, headless по природе) | 6846★, push 2026-11-22 | C++ | нет сессии; OSC-сервер (synth-node graph) | синт-сервер вне сессионной модели; GPL-дистрибуция бинаря пользователю = apt-путь. Не замена |
| **FAUST** ([grame-cncm/faust](https://github.com/grame-cncm/faust)) | 🟡 **LGPL-2.1+** (COPYING.txt прочитан: «GNU Lesser General Public License… version 2.1») — библиотека/компилятор как процесс допустим | 3217★, push 2026-11-22 | C++ (компилирует DSP в код) | **Нет** — это язык/DSP-компилятор, не движок; честно по ТЗ: не сессия, не DAW | Не замена; потенциальный генератор DSP-модулей (наш Rust-DSP-план, PRD V2) — как CLI-компилятор процессом |
| **Meadowlark** | 🔴 **AGPL-3.0**; GitHub-копия заморожена, проект переехал на Codeberg (там тоже тихо: updated 2025-09-22 — 2+ мес) | 1499★ (GH), 37★ (CB) | Rust | incomplete; ветки old/dev-(old) | Двойной удар: гейт + замирание. Не кандидат (T1-паттерн в статусе эмбриона) |
| **bitwig/dawproject** | 🟢 MIT | 1059★, push 2025-07-12 | XML-формат (C#/JS) | **Формат обмена, не движок** — честно по ТЗ | Полезен как future export-формат интеропа (наш `file.export_*` + dawproject → перенос сессий в Bitwig/Live). Не движок |
| **Firewheel** ([BillyDM/Firewheel](https://github.com/BillyDM/Firewheel)) | 🟢 Apache-2.0 | 325★, push 2026-11-13, Rust | Rust | **Нет** — mid-level аудио-граф для игр (node graph, без DAW-сессий/undo/импорта MIDI) | Требование 8 идеально (Rust), но сессию строить самим. Строительный блок — отмечен в watchlist |
| **kira** | 🟢 MIT OR Apache-2.0 (crates.io) | 0.12.6, 1.2M dl, обновлён 2026-10-28 | Rust | нет (soundtrack-движок игр: BPM-sync, tweens; нет офлайн-bounce/MIDI-импорта) | не замена; watchlist |
| **fundsp** | 🟢 MIT OR Apache-2.0 | 0.23.0, 282k dl, 2026-01 | Rust | нет (DSP-граф-библиотека) | строительный блок собственного движка — только если исходим 1/3 не состоятся |
| **Lemon-Studio** | 🔴 GPL-3.0 | 1028★, push 2026-11-22 | Rust | DAW в стиле Logic — **конкурент-референс**, читаем, не используем | отсечён гейтом |
| **Pro-Wave** | 🔴 GPL-3.0 | 282★, push 2026-11-22 | Rust | Logic-style DAW | отсечён гейтом |
| **py_headless_daw** | 🟢 MIT, но **мёртв 3.5 года** (push 2022-06) | 50★ | Python | headless-DAW для электроники (архитектурно близко!) | T1-мёртв; идеи (декларативный пайплайн) — читать |
| **aidaw** | 🔴 AGPL-3.0 | 6★ | JS | headless DAW через MCP | отсечён гейтом (клозед-мир, крошечный) |
| **libsonare** | 🟢 Apache-2.0 | 32★, push 2026-11-08 | C++ | «dependency-free audio engine» C++/Python/Node/WASM — молодой | watchlist (молодой, сессии нет) |
| Прочие DAW (Giada/Element/MusE/Qtractor/LMMS/Zrythm/Helio) | 🔴 GPL/AGPL семейство | — | — | — | отсечены гейтом (Ardour — закрыт собранием №1, не возвращаемся) |

**Паттерн рынка:** полноценная DAW-сессионная модель в permissive-лицензии **не существует вне SoundCraft и Tracktion**. Tracktion — за GPL-стеной или за платой; всё остальное permissive — либо синт-серверы без сессии (libpd/scsynth), либо строительные блоки (Firewheel/kira/fundsp), либо мёртвые/AGPL-DAW-эмбрионы (Meadowlark/aidaw). Rust-сегмент «DAW-ядро» пуст.

---

## Часть D — вердикт

### Матрица «кандидат × требования A»

| Требование | SoundCraft v0.20.1 CLI/MCP (standalone) | Tracktion (GPL/commercial) | libpd | scsynth (процесс) | Firewheel | dawproject |
|---|---|---|---|---|---|---|
| 1 программный контроль/headless | ✅ CLI run + MCP stdio + NDJSON-TCP (все три!) | ⚠️ C++ API, headless вручную | ✅ embeddable | ✅ OSC | ✅ Rust API | ❌ (формат) |
| 2 сессионная модель (tempo/key/ MIDI/wav import) | ✅ верифицировано нами | ✅ | ❌ | ❌ | ❌ | ⚠️ формат сессии, не движок |
| 3 встроенные инструменты | ✅ (subtractive/drum synth, демо-песня полностью синтезирована) | ✅ | ✅ (Pd-патчи) | ✅ (synth graph) | ⚠️ (граф, синты свои) | ❌ |
| 4 офлайн bounce WAV (+LUFS) | ✅ `--bounce`/file.bounce_mix (+stems; LUFS/peak в ответе — наши данные v0.5.0; сверить в CLI на спайке) | ✅ | ⚠️ нетривиально | ⚠️ realtime-сервер, офлайн через NRT-режим (ок, но сложно) | ❌ (realtime) | ❌ |
| 5 undo | ✅ (undo label в session.inspect; edit.undo) | ✅ | ❌ | ❌ | ❌ | ❌ |
| 6 JSON-состояние сессии | ✅ session.inspect full (треки/клипы/маркеры/транспорт) | ⚠️ вручную | ❌ | ❌ | ❌ | ✅ (XML) |
| 7 лицензия для встраивания | ✅ MIT OR Apache-2.0 (мы потребляем как внешний бинарь+stdio) | 🔴 GPL/платно | 🟢 BSD | 🔴 (внешний процесс ок) | 🟢 Apache | 🟢 MIT |
| 8 язык | ⚠️→✅ внешний процесс (наш sidecar-паттерн уже так работает) | C++ sidecar | C | C++ sidecar | ✅ Rust (но не движок-сессия) | — |
| 9 зрелость/активность | ⚠️ pre-alpha, но экстремально живой (1377 коммитов/41 день, RFC-конвенции, transcript-тесты, signed releases) | зрелое, живое | зрелое | зрелое | молодой живой | стагнация 2025-07 |

### Три исхода

**Исход 1 — SoundCraft standalone (CLI/MCP headless).** Как именно: l2t-core spawns `soundcraft-cli mcp --automation-read-root <workspace> --automation-write-root <workspace> --demo|open`; DawBackend-адаптер остаётся 1:1 (инструменты совпадают с нашими верифицированными: `event.tempo`/`markers.add`/`file.import_midi`/`bounce_mix`/`session.inspect`/`edit.undo`); ZCode-плагин сохраняет роль UI-интеграции в ZCode (не каноничен для ядра). Риски: (r1) pre-alpha дрейф — пин бинаря (v0.20.1) + подписанные SHA256SUMS; ребаз-план из патруля №4; (r2) dual-channel (плагин v0.5.0 WASM vs CLI v0.20.x) — разные версии одного движка в одной машине: правило один-движок-на-одну-сессию + единый source-of-truth (файл .scraft) снимает; (r3) headless-старт не измерен (спайк); (r4) `key-signature` (#1701 low) — convention-маркеры как сейчас.

**Исход 2 — альтернатива.** Нет кандидата с permissive-лицензией и сессионной моделью: миграция = Tracktion (GPL-заражение ИЛИ коммерческий контракт — решение владельца и деньги) + собственная сборка DawBackend-слоя на C++ API (недели), потеря доказанного пайплайна; либо «свой движок» на Firewheel/kira/fundsp (месяцы работы по undo/импорту/рендеру). Оба варианта дороже заметно, ничего не дают сверх. **Не оправдано.**

**Исход 3 — гибрид (рекомендация).** SoundCraft standalone-CLI/MCP = DawBackend для l2t-core (основной путь), SoundCraft-UI (плагин или нативный) остаётся открытым как микшер (VISION v2 — не дублируем). Дополнения, отложенные: libpd (BSD) — потенциальный «инструментальный сервер» для кастомных звуков, если встроенных синтов не хватит (v1+); dawproject (MIT) — future export-формат интеропа; Tracktion — только как коммерческая опция, если когда-нибудь понадобится embedded-движок второго хоста (владелец решает отдельно). Watchlist: Firewheel, libsonare, апстрим soundcraft-cli (методика патруля №4).

### Топ-3 и финальная рекомендация

1. **SoundCraft v0.20.1 standalone (CLI/MCP headless, MIT/Apache)** — единственный кандидат, покрывающий 9/9 требований (8 с оговоркой «sidecar-процесс — наш штатный паттерн») и уже доказанный пайплайном. **Берём в v0**: спайк недели 1-2 (l2t-core spawns `soundcraft-cli mcp`, замер холодного старта, bounce+LUFS в headless, undo, пробуждение), DawBackend-адаптер поверх апстримного MCP вместо плагинного моста.
2. **Tracktion Engine — только как «коммерческая опция за стеной»** (GPL-встраивание запрещено нашим гейтом; стоимость тиров — решение владельца при реальном сценарии второго хоста-ядра). Не v0.
3. **libpd (BSD) — инструментальный сервер будущего** (v1+): чистая лицензия, зрелость, но патч-модель ≠ сессия; держим в watchlist, не тащим сейчас.

**Финальная рекомендация:** исход 3 (гибрид) с ядром — SoundCraft standalone. Альтернатива на рынке отсутствует не «примерно так же», а качественно: permissive-сессионного движка, кроме SoundCraft, нет. Стратегическое решение за владельцем+мейнтейнером; мои факты выше. Шаги: (1) «го» на спайк headless-CLI; (2) решение о pin-версии бинаря и месте хранения (apt-deb vs tar.gz в ~/bin — как audio-analyzer); (3) судьба ZCode-плагина (UI-роль остаётся); (4) обновление DECISION.md: «fork-триггеры теперь включают деградацию soundcraft-cli».

## Источники (все 2026-11-22)

- SoundCraft: [docs/control-protocol.md](https://github.com/storytold/soundcraft/blob/main/docs/control-protocol.md), [docs/cli.md](https://github.com/storytold/soundcraft/blob/main/docs/cli.md), [docs/mcp.md](https://github.com/storytold/soundcraft/blob/main/docs/mcp.md), README, release v0.20.1 (assets), commits по paths `apps/soundcraft-cli`/`crates/automation` (GitHub API); наш BUILD.json (`~/.zcode/cli/plugins/cache/zcode-plugins-official/soundcraft/0.2.4/dist/BUILD.json`)
- Лицензии: Tracktion LICENSE.md (contents API), libpd LICENSE.txt, faust COPYING.txt, Meadowlark LICENSE+README (перенос на Codeberg), Codeberg API (Meadowlark updated 2025-09-22)
- crates.io API: kira 0.12.6, fundsp 0.23.0 (license поля версий)
- Локальные: docs/dawbackend-spec.md, память ai-music-ecosystem (PoC 2/3, MVP-верификация, патруль №4)

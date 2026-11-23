# OSS-разведка UI-«конфеток» для L2T Copilot

**Автор:** L2T team · **Дата:** 2026-11-22 · **Ревью:** мейнтейнер
**Контекст:** VISION v2 — AI-нативный кокпит на Tauri + React над MCP-мозгом; SoundCraft-сессия = единственный источник истины; призрачные ноты = контракт данных `{notes[], rationale, confidence, source_tool}`; никакого DSP в UI-процессе (превью = проигрывание отрендеренного WAV).

## Методика и правила лицензий

Все звёзды/лицензии/даты активности сняты через GitHub API **2026-11-22** (не по памяти, не по README-бейджам). Спорные лицензии (GitHub `NOASSERTION`) проверены по содержимому LICENSE-файла. Маркировка:

- 🟢 **MIT / Apache-2.0 / BSD / ISC** — можно копировать код и ставить зависимостью в наш MIT-репозиторий.
- 🟡 **LGPL** — ставить npm-зависимостью допустимо (weak copyleft на библиотеку), код в наш репо не копировать.
- 🔴 **GPL / AGPL** — код не копировать и не линковать; только читать как референс или запускать как внешний процесс.
- ⚫ **лицензии нет** — юридически «all rights reserved», не использовать.

---

## 1. React piano roll / MIDI-редакторы

| Репо | Лицензия | ★ | Активность | Что даёт нам | Риск |
|---|---|---|---|---|---|
| [ouestlabs/audio-ui](https://github.com/ouestlabs/audio-ui) | 🟢 MIT | 211 | 2026-11-19, создан 2024-09, 0 открытых issues | **Главный кандидат.** Piano roll как shadcn-примитив: `piano-roll`, `piano-roll-edits`, `piano-roll-tools` + хук `use-piano-roll-playback` + демо «MIDI file». Модель «копируй и владей» — код попадает в наш репо и мы расширяем его как хотим. Бонус: `sequencer`, `timeline-*`, `waveform-*`, `arrangement-*` в том же registry (см. п.3–4) | Молодой проект (9 форков). Рендер DOM/CSS-based, а не canvas → вопрос перфа на десятках тысяч нот (для v0 некритично: сотни нот) |
| [minagishl/react-piano-roll](https://github.com/minagishl/react-piano-roll) | 🟢 MIT | 8 | 2026-04-14 | Canvas-рендер, TypeScript, zero-deps, теме light/dark, API `notes[]` близок к нашему контракту | Это **визуализатор** (falling notes + WebAudio-плейбек), не редактор; крошечное комьюнити (bus factor) |
| [dpren/react-piano-roll](https://github.com/dpren/react-piano-roll) | 🟢 MIT | 27 | **2024-06-27 (заморожен)** | Pixi-рендер (форк mjhasbach/pixi-piano-roll), только графика: зум, resolution, цвета сетки — идеи API | Не поддерживается 2.5 года; старый React-код; берём идеи, не код |
| [igorski/efflux-tracker](https://github.com/igorski/efflux-tracker) | 🟢 MIT | 263 | 2026-10-29 | Полноценная браузерная музыкальная среда: piano roll + трекер, квантование, loop-редактирование. Read-only кладезь алгоритмов редактирования нот | **Vue+Vuex**, не React; монолит-приложение, не библиотека — только читать |
| [naomiaro/waveform-playlist](https://github.com/naomiaro/waveform-playlist) | 🟢 MIT | 1695 | 2026-11-16 | Multitrack canvas-плейлист: cues, fades, сдвиг клипов — паттерны для нашего read-only Playlist | Только аудио-треки (WebAudio), MIDI-нот нет; DSP в браузере — против нашего правила no-DSP |
| [andremichelle/openDAW](https://github.com/andremichelle/openDAW) | 🔴 AGPL-3.0 | 2478 | 2026-11-21 (живая) | Крупнейшая OSS веб-DAW (TS). В репо `introduction.md` — карта всех компонентов и зависимостей: учебник по архитектуре веб-DAW | AGPL: **код не трогать**. Плюс их манифест «openDAW never generate your music» — готовая рамка для нашего контр-позиционирования |
| [kevinsqi/react-piano](https://github.com/kevinsqi/react-piano) | 🟢 MIT | 319 | 2023-02-02 (заморожен) | Экранная клавиатура для React — подсветка играющих нот | Стабилен, но мёртв; при потребности проще написать самим |
| [unkleho/reactronica](https://github.com/unkleho/reactronica) | 🟢 MIT | 485 | 2026-11-08 | React-компоненты для музыки (StepSequencer, Instrument, Song-декларации) — годится для быстрых UI-моков | WebAudio-движок внутри = DSP в UI-процессе; против правила VISION. Не в прод |

### Про призрачные ноты — главный вывод секции

Поиск «ghost notes piano roll» по GitHub — **пусто**: готового OSS-компонента с ghost/suggestion-слоем не существует. Это одновременно (а) подтверждение VISION: призрачные ноты — не «фича библиотеки», а **наш контракт данных** и дифференциатор; (б) план реализации: берём copy-in piano roll из audio-ui и расширяем тип `Note` полем `layer: 'real' | 'ghost'` + полупрозрачный рендер + tooltip с `rationale/confidence/source_tool`; кнопки accept/reject пишут лог → Acceptance Rate инструментируется с первого дня. У audio-ui уже есть близкая абстракция `NoteLevel = 'velocity' | 'chance'` (probability lane à la Bitwig) — их lanes-механика показывает, куда встраивать второй слой данных.

---

## 2. Tauri + React аудио-референсы (sidecar, IPC, long-running, превью)

| Репо / ресурс | Лицензия | ★ | Активность | Что даёт нам | Риск |
|---|---|---|---|---|---|
| [tauri-apps/plugins-workspace](https://github.com/tauri-apps/plugins-workspace) (+ [v2.tauri.app/develop/sidecar/](https://v2.tauri.app/develop/sidecar/), [plugin/shell](https://v2.tauri.app/plugin/shell/)) | 🟢 Apache-2.0 | 1846 | 2026-11-21 | Официальная механика: embedding external binaries (sidecar), spawn + stdin/stdout события. Ровно то, чем Rust-ядро будет владеть MCP-клиентами (stdio) | Нет; это канонический путь |
| [miskibin/synkopa](https://github.com/miskibin/synkopa) (экс wave-DAW) | 🔴 AGPL-3.0 | 130 | 2026-11-22 (ежедневно) | **Ближайший архитектурный референс и родственный конкурент.** Tauri v2 + Solid.js (сигналы вместо VDOM — аргумент в пользу тонкого рендера), Rust-crates, Playwright e2e, perf-харнесс в `ui/perf`. CLI `synkopa`: JSON в stdout, коды выхода, два режима — «редактирует открытый проект с общей undo-историей» ИЛИ headless `--project FILE`; batch-режим `apply --file ops.json --dry-run` | AGPL: **только читать**. Солo-дев, «vibe-coded with Claude Fable» — качество варьирует. Их CLI-контракт — то, чем наш MCP-слой уже лучше стандартизирован |
| [ZaneH/piano-trainer](https://github.com/ZaneH/piano-trainer) | 🟢 MIT | 2218 | 2026-04-24 | Зелёный мини-референс: Tauri + TS + **Web MIDI** + аудиовоспроизведение — живое доказательство, что MIDI-in и аудио-плейбек в Tauri работают | Не DAW, маленькая кодовая база; паттерны, не архитектура |
| [basharovV/musicat](https://github.com/basharovV/musicat) | 🔴 GPL-3.0 | 957 | 2026-08-08 | Tauri + Svelte + Rust: gapless-плейбек, теггинг, визуализации — как выносят аудио в Rust-сторону | GPL: не копировать; Svelte, не React |
| [nukeop/nuclear](https://github.com/nukeop/nuclear) | 🔴 AGPL-3.0 | 18985 | 2026-11-20 | Стриминг-плеер на Tauri с большим комьюнити — смотрим, как живут с WebView-аудио на трёх ОС | AGPL; плеер, не редактор |

**Паттерны, которые забираем (сводка):**
- **MCP-клиенты**: Rust-ядро порождает stdio-процессы (механика sidecar/Command из shell-плагина), НЕ WebSocket — контракт шины в одном месте (решение VISION подтверждено: synkopa гоняет CLI→running-app через локальный контракт так же).
- **Long-running задачи**: async-команды Tauri + `emit` событий (не блокирующий request/response) — годится для стрима `suggestion`/логов генерации; таймаут≠failure (наш автобусный урок) ложится на события естественно.
- **Аудио-превью**: `<audio>`/`decodeAudioData` в WebView над отрендеренным WAV (файл через asset/custom protocol) — piano-trainer и плееры выше это используют; DSP остаётся в SoundCraft.
- **WebKitGTK**: ни один из найденных референсов не снимает квирки Linux-WebView — правило VISION «тестируем на первой неделе, fallback = локальный web-UI» остаётся в силе.

---

## 3. Canvas-рендер нот и волновых форм

| Репо | Лицензия | ★ | Активность | Что даёт нам | Риск |
|---|---|---|---|---|---|
| [konvajs/konva](https://github.com/konvajs/konva) + [react-konva](https://github.com/konvajs/react-konva) | 🟢 MIT (проверено по LICENSE-файлу; API показывал NOASSERTION) | 15005 / 6447 | 2026-11-20 / 2026-10-15 | Декларативный canvas-2D scenegraph для React; drag/transform/события из коробки — быстрый путь к своему piano roll, если DOM-версии audio-ui не хватит | Canvas 2D: комфортно до нескольких тысяч шейпов (с кэшированием); свой culling для больших плейлистов |
| [pixijs/pixijs](https://github.com/pixijs/pixijs) | 🟢 MIT | 48877 | 2026-11-20 | WebGL/WebGPU batched-спрайты: десятки тысяч объектов; единственный вариант, если read-only Playlist с тысячами клипов/нот станет тормозить | Тяжелее в поддержке; официальных React-биндингов нет (сторонние решения слабее react-konva); оверкилл для v0 (сотни нот) |
| [katspaugh/wavesurfer.js](https://github.com/katspaugh/wavesurfer.js) | 🟢 BSD-3-Clause | 10482 | 2026-11-12 | Де-факто стандарт waveform-плеера в web; регионы/маркеры — готовый рендер Loop X-Ray (волна лупа + границы секций) поверх bounce-файлов | Плеер-центричен (тащит свой WebAudio-плейбек — используем только рендер-часть или аудио из `<audio>`) |
| [bbc/peaks.js](https://github.com/bbc/peaks.js) | 🟡 LGPL-3.0 | 3413 | 2026-10-21 | Waveform + сегменты/точки с precomputed-JSON (waveform-data.js) — паттерн «предрасчитанные пики» для длинных файлов | LGPL: только npm-зависимость, код не копировать; для v0 избыточен |
| Чистый canvas 2D | — | — | — | Максимальный контроль, ноль зависимостей, лучший перф на простых прямоугольниках-нотах + пиках; DPR/скролл/culling руками | Вся интерактивность (drag, marquee, zoom) — своими руками; для v0 это лишняя работа |
| SVG/DOM (путь audio-ui) | — | — | — | Доступность, CSS-темы, простая интеграция с Radix/shadcn; до ~1–2k нот живёт нормально | DOM-потолок на больших аранжировках |

**Оценка под наш сценарий:** v0 рендерит сотни нот (3 генератора × такты) + волны лупа/бонусов → **canvas 2D / DOM достаточно**; в registry audio-ui уже есть `webgl-waveform` на случай тяжёлых волн. Pixi — зарезервированный эскалационный путь, включаем при профилировании, не заранее.

---

## 4. Дизайн-системы для DAW-подобного тёмного UI

| Репо | Лицензия | ★ | Активность | Что даёт нам | Риск |
|---|---|---|---|---|---|
| [shadcn-ui/ui](https://github.com/shadcn-ui/ui) | 🟢 MIT | 128730 | 2026-11-21 | Каркас «компоненты в вашем репо» + registry-механика, через которую распространяется audio-ui; идеально ложится на MIT-репо и философию «code like water» | Нет |
| [radix-ui/primitives](https://github.com/radix-ui/primitives) (+ radix colors, dark-шкалы 12 шагов) | 🟢 MIT | 19537 | 2026-10-14 | Headless-доступность (dialog, popover, tooltip — rationale-тултипы призрачных нот) и тёмные токены | Нет |
| [ouestlabs/audio-ui](https://github.com/ouestlabs/audio-ui) (style `base-luma`) | 🟢 MIT | 211 | 2026-11-19 | Тёмная DAW-тема luma + блоки: `arrangement-editor`, `timeline-clips/markers`, `automation-envelope`, `clip-waveform`, панели устройств — готовый визуальный язык кокпита | Один источник стиля; ответвляемся при первом копировании (модель copy-in это и предполагает) |
| [tailwindlabs/tailwindcss](https://github.com/tailwindlabs/tailwindcss) | 🟢 MIT | 98703 | 2026-11-20 | Утилити-CSS, общая база с shadcn/audio-ui | Нет |
| [lucide-icons/lucide](https://github.com/lucide-icons/lucide) | 🟢 ISC (проверено по LICENSE-файлу) | 25927 | 2026-11-22 | Иконки, включая музыкальные (audio-waveform, music, piano нет — но набор расширяем) | Нет |
| [andremichelle/openDAW](https://github.com/andremichelle/openDAW) | 🔴 AGPL-3.0 | 2478 | 2026-11-21 | Скриншоты/UX веб-DAW как вдохновение тёмного лэйаута | AGPL: смотрим картинки, не код |

Отдельно: `djipco/webmidi` (🟢 Apache-2.0, 1722★, 2026-11-16) — обёртка Web MIDI API: когда появится «MIDI-клавиатура → запись в UI», это готовый зелёный вход.

---

## 5. Конкурент-референс: MAGDA (+ родственные)

| Репо | Лицензия | ★ | Активность | Что даёт нам | Риск |
|---|---|---|---|---|---|
| [Conceptual-Machines/magda-core](https://github.com/Conceptual-Machines/magda-core) | 🔴 GPL-3.0 | 266 | 2026-11-22 (активно, v0.20+) | См. разбор ниже | GPL: ноль копирования; C++/JUCE-десктоп ≠ наш стек |
| [miskibin/synkopa](https://github.com/miskibin/synkopa) | 🔴 AGPL-3.0 | 130 | 2026-11-22 | FL-метафора буквально (Channel Rack, паттерны, piano roll) + AI-агент через CLI — наш прямой «духовный конкурент» | AGPL; идеологически монолит (агент редактирует их проект), а не кокпит над внешним хостом |
| [andremichelle/openDAW](https://github.com/andremichelle/openDAW) | 🔴 AGPL-3.0 | 2478 | 2026-11-21 | Позиционирование «никогда не будем генерировать вашу музыку» — анти-теза L2T, полезна для нарратива README | AGPL |

**Разбор UI-слоя MAGDA** (из README/доки, код не читали — лицензия): гибридные треки (audio+MIDI клипы в одном), три view (Arrangement / Session / Mix), **панельная грамматика: слева Inspector + AI Chat, справа Plugin/Sample Browser, снизу контекстный редактор** — AI-чат как гражданин первого класса в лэйауте, ровно наше «ИИ невидимый помощник, но с местом в кокпите». AI-чат генерирует и исполняет **кастомный DSL** (BYOAK — bring your own API keys). Piano roll с pitchbend/CC-lanes, drum grid, модуляция (16 LFO/макросов на устройство), вложенные rack-цепочки. Что подсмотреть: (1) layout с AI-панелью; (2) DSL-подход к командам (у нас эту роль играет MCP — открыте́е и многоинструментальнее); (3) session-view с launch-клипами для будущих лайв-паттернов. Чего не брать: JUCE-десктоп и GPL.

---

## Топ-3 рекомендации

1. **audio/ui (ouestlabs, MIT)** — фундамент v0: piano roll + timeline + waveform + sequencer + тёмная luma-тема как shadcn-copy-in. Код оказывается в нашем репо → расширяем `Note` слоем `'ghost'` без форка и без GPL-рисков. Закрывает сразу п.1, п.3 (частично) и п.4.
2. **shadcn/ui + Radix + Tailwind + Lucide (все 🟢)** — базовая дизайн-система кокпита: доступные примитивы, тёмные токены, registry-механика уже используется audio-ui. Проверенная связка с максимальными звёздами и здоровьем.
3. **Tauri v2 shell/sidecar (Apache-2.0) + piano-trainer (MIT) как живой мини-референс** — официальная механика порождения stdio-процессов для MCP-клиентов в Rust-ядре; piano-trainer подтверждает аудио+MIDI в Tauri на практике.

## Финальный shortlist

**Брать в v0:**
- `audio-ui` (piano-roll, piano-roll-edits/tools, sequencer, timeline-clips/markers, waveform-lane, use-piano-roll-playback) — MIT, copy-in
- `shadcn/ui` + `radix-ui/primitives/colors` + `tailwindcss` + `lucide` — MIT/MIT/MIT/ISC
- `wavesurfer.js` (рендер волны + regions для Loop X-Ray) — BSD-3
- Tauri v2 + plugins-workspace (shell) — Apache-2.0
- `react-konva` + `konva` — MIT, в резерве, если DOM-рендер нот начнёт тормозить (эскалация без переписывания контрактов)

**Смотреть позже:**
- `pixijs` — если read-only Playlist с тысячами клипов станет узким местом (решаем профилированием, не заранее)
- `webmidi` (Apache-2.0) — когда появится MIDI-вход с клавиатуры
- `reactronica` (MIT) — только для быстрых моков, DSP-компоненты в прод не идут
- `peaks.js` (LGPL 🟡) — предрасчитанные пики для длинных файлов; только как зависимость
- `efflux-tracker` (MIT) — копать алгоритмы квантования/редактирования нот
- `minagishl/react-piano-roll`, `dpren/react-piano-roll` — идеи API (слои, зум), не код
- `react-piano` — экранная клавиатура, если понадобится (мёртв, но тривиален для переписывания)

**Красные (читать можно, копировать нельзя):** `openDAW` (AGPL), `synkopa` (AGPL), `MAGDA` (GPL-3.0), `musicat`/`limusic`/`Audion` (GPL), `nuclear` (AGPL). `noteflow` — ⚫ файл лицензии отсутствует, не трогаем вовсе.

---

## Что пригодится ядроу (добавлено 2026-11-22, конвейерная поддержка этапа 1)

### Rust-крейты для MIDI

| Крейт | Лицензия | Версия / активность | Зачем | Риск |
|---|---|---|---|---|
| [`midly`](https://github.com/negamartin/midly) | 🟢 **Unlicense** (public domain — ноль обязательств) | 0.5.3, 657k загрузок, последняя публикация 2023-01 | Парсинг/запись SMF в Rust: events, chunks, running status — если `core/midi_io` (сейчас Python/mido) переезжает в Rust-ядро или для валидации `.mid` на шине | Крейт стабилен и «закончен» (пуш 2024-07) — для формата-стандарта это плюс, не минус |
| [`midir`](https://github.com/Boddlnagg/midir) | 🟢 MIT | 0.11.1, 1.23M загрузок, обновлён 2026-10 (GitHub 846★) | Realtime MIDI I/O: ALSA (Linux), WinMM, CoreMIDI, Jack, Web MIDI — для будущего «MIDI-клавиатура → запись» (v1+, не v0) | Callback-based API — мостить в async-ядро через каналы (README прямо предлагает) |

Оба крейта не пересекаются с MCP-слоем (ядро = stdio-процессы и файлы); midly — кандидат в `Cargo.toml` при первом Rust-парсинге MIDI, midir — резерв v1.

### Tauri WindowManager — нюансы для FL-паттерна «окно на функцию»

- **Создание окон из Rust:** `WebviewWindowBuilder::new(app, "label", WebviewUrl::default()).title(...).inner_size(...)` в `setup`-closure ([window customization](https://v2.tauri.app/learn/window-customization/), URL проверен). Свойства через builder: `decorations`, `always_on_top`, `maximized`; JS-API `getCurrentWindow()` — только внутри уже созданного окна.
- **Кверки Linux (gh issues tauri-apps/tauri):**
  - [#12589](https://github.com/tauri-apps/tauri/issues/12589) (closed 2025-08, без фикс-комментария): открытие WebviewWindow **после закрытия** одного ломало создание окон на Linux — для динамических FL-окон обязательный ретест на спайке недели 1.
  - [#10746](https://github.com/tauri-apps/tauri/issues/10746) (closed): фокус окна при создании сломан с v2 — флотирующие панели могут приходить без фокуса.
  - [#11814](https://github.com/tauri-apps/tauri/issues/11814) (**open**): «show window без кражи фокуса» на Linux не поддерживается — AI Dock/всплывающие панели проектировать с учётом, что окно всегда забирает фокус.
- **Capabilities:** все window-команды по умолчанию заблокированы — `core:window:allow-close` и прочие вносятся в `src-tauri/capabilities/default.json` явно (не выстрел в ногу при первом «кнопка не работает»).
- **`data-tauri-drag-region`** действует только на сам элемент, не на детей — кастомный тайтлбар FL-окна размечать напрямую.

## Источники

GitHub API (метаданные сняты 2026-11-22): [audio-ui](https://github.com/ouestlabs/audio-ui) · [synkopa](https://github.com/miskibin/synkopa) · [openDAW](https://github.com/andremichelle/openDAW) · [magda-core](https://github.com/Conceptual-Machines/magda-core) · [konva](https://github.com/konvajs/konva) · [react-konva](https://github.com/konvajs/react-konva) · [pixi.js](https://github.com/pixijs/pixijs) · [wavesurfer.js](https://github.com/katspaugh/wavesurfer.js) · [peaks.js](https://github.com/bbc/peaks.js) · [waveform-playlist](https://github.com/naomiaro/waveform-playlist) · [efflux-tracker](https://github.com/igorski/efflux-tracker) · [shadcn/ui](https://github.com/shadcn-ui/ui) · [radix primitives](https://github.com/radix-ui/primitives) · [tailwindcss](https://github.com/tailwindlabs/tailwindcss) · [lucide](https://github.com/lucide-icons/lucide) · [piano-trainer](https://github.com/ZaneH/piano-trainer) · [musicat](https://github.com/basharovV/musicat) · [nuclear](https://github.com/nukeop/nuclear) · [webmidi](https://github.com/djipco/webmidi) · [reactronica](https://github.com/unkleho/reactronica) · [react-piano](https://github.com/kevinsqi/react-piano) · [tauri plugins](https://github.com/tauri-apps/plugins-workspace)
Доки Tauri: [sidecar](https://v2.tauri.app/develop/sidecar/) · [shell plugin](https://v2.tauri.app/plugin/shell/) (URL проверены, HTTP 200). Демки audio-ui: [audio-ui.dev](https://www.audio-ui.dev).

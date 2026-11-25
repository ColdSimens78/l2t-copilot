# OSS-разведка №12: конкурентный патруль — audial и SaaS/локальные музыкальные копайлоты

**Автор:** OSS Scout · **Дата:** 2026-11-25 · **Для:** Lead + владелец · **Тема:** audial-mcp deep-dive + 3–5 копайлотов 2026 (не Suno/Udio — именно ассистенты рядом с DAW) → вердикт для PRD
**Методика:** audial README прочитан полностью (18 tools-таблица), сайт audialmusic.ai (скрейп), GitHub API; конкуренты — web-поиск + gh-скан. Лёгкая тема — только факты, без воды.

---

## 1. audial-mcp: что умеет фактически

18 инструментов, **весь конвейер — облачные воркеры** (hosted; OAuth-браузер при первом вызове, `AUDIAL_API_KEY` для CI; результаты в `~/Audial`; «service_status» показывает «which tools have a worker awake right now, and what a **cold start will cost**» — облачная экономика холодных стартов, зеркало нашего wake-паттерна).

| Категория | Инструменты audial | Пересечение с L2T |
|---|---|---|
| Анализ | `analyze` (BPM/key), `segment` (секции + tempo-map + grid, ~**30 с**), `audio_features` (energy/danceability/loudness/mode/key/tatum), `tag_audio` (жанры/настроения + описание) | ✅ **Loop X-Ray** — но у нас 91 мс локально vs их ~30 с облачно; у них «дескрипторы песни», у нас — тональность+темпо+секции под генерацию |
| Стемы | `stem_split` (vocals/drums/bass/other, **опционально retime/rekey**) | частично (у нас stems через движок `file.bounce_stems`; их модель сильнее — это их главный продукт) |
| Генерация | `generate_midi` (**audio→MIDI конверсия**), `generate_music` (text-to-music/remix — их модель), `generate_samples` (sample-pack из анализа) | ⚠️ audio→MIDI ≠ наша генерация: у midi-gen — **композиция партий по тональности/темпу лупа** (bass/chords/drums), у них — транскрипция существующего аудио. Текст-в-музыку — поле Suno/Udio, мы туда не идём |
| Мастеринг | `master` (**опционально matched to reference**) | ✅ **P-Master** — reference-matching — приём worth adopting (наш Self-Check сравнивает с лупом — та же идея) |
| Тамбры | `sound2vital` / `sound2serum` (one-shot → **редактируемый Vital/Serum 2 пресет**) | ⚠️ **P-Timbre-аналог** — единственный найденный competitor в слоте тамбров; у нас слот пуст (PRD V2) |
| Вокал | `text2vox` (лирика + reference voice → вокал + MIDI) | — (вне нашего среза) |
| Служебные | `pipeline_status`, `service_status`, `usage`, `list_results`, `account` | у нас — bus_log/manifest вместо pipeline-id |

**Чего НЕТ у audial (ключевые отличия L2T):**
1. **DAW-интеграции нет вообще** — ни MCP-инструментов управления DAW, ни плагина; результаты файлами в `~/Audial`, пользователь таскает в DAW руками. Наш DawBackend-контракт + SoundCraft-движок + FL/reaper-адаптеры (перспектива) — уникальны.
2. **Генерации партий по лупу нет** (bass/chords/drums в тональность лупа с voice-leading) — их «generate» = транскрипция или text-to-music. Наш midi-gen v3 (styles/voicing/variation) не покрыт никем из списка.
3. **Loop-centric workflow нет**: луп → X-Ray → Adopt → слои → accept/reject с manifest/Acceptance Rate. Их flow — «загрузил трек → обработал → скачал».
4. **Открытости нет**: закрытый SaaS, код MCP-обёртки MIT, но модели/воркеры — облако. Наш аргумент «локально, приватно, открытый стек» — нетронут.
5. **Acceptance Rate / Self-Check** — ни следов.

**Цены:** за логином на audialmusic.ai (скрейп главной отдал только «Professional Audio Processing»; pricing-страница — Login/Signup-gated). Тарифы не подтверждены — пометить в патруле «выяснить при следующем заходе».

## 2. Ещё копайлоты 2026 (не Suno/Udio)

| Проект | Тип / цена | Что умеет | Чему учимся |
|---|---|---|---|
| **Moises** (SaaS, ~**$35/мес** Pro) | practice-стем-разделение, mobile-first | stems (вкл. дробные drums в Pro), chords, метроном, pitch/BPM | «best for practicing musicians, **middling for producers**» (обзор 2026) — их аудитория ≠ наша (producers). Угрозы нет; цены-ориентир: Pro-сегмент держит $35 |
| **LANDR** (SaaS, ~**$12.99/мес** Studio, промо от $6) | AI-mastering **плагином внутри DAW** + 70+ плагинов + дистрибуция | «unlimited AI mastering **in your DAW**», «Assistive AI music creation tools» (Berklee AIMS 2026) | ⚠️ их паттерн **«mastering-плагин прямо в DAW»** — прямое пересечение с P-Master; и их воронка «mastering→distribution→royalties» — модель монетизации, worth studying для PRD §монетизация |
| **Magenta Studio** (локально, Apache-2.0, 2135★, push 2026-06 — жив) | плагины **внутрь Ableton** (Continue/Generate/Interpolate) | паттерновые MIDI-генераторы на ML | ближайший предок нашего midi-gen; их «Continue» (продолжить клип) — приём для Regenerate-кнопки; но без лупа-анализа и без voice-leading |
| **MAGDA REAPER** ([Conceptual-Machines/magda-reaper](https://github.com/Conceptual-Machines/magda-reaper), GPL-3.0, 2★) | native C++ REAPER-extension | NL-контроль DAW, JSFX-generation, drum-gen, **mix analysis** (наш Pro-путь замысел!), ImGui-чат | ⚠️ **замер через 2 недели после создания (push 2025-12-31, мёртв 11 мес)** — попытка MAGDA выйти на второй хост не взлетела. Урок: DAW-расширение без живого ядра не выживает; наше преимущество — ядро (движок) у нас уже ratified и живое |
| **FLStudioMCP** ([geezoria](https://github.com/geezoria/FLStudioMCP), MIT, 11★, push 2026-11-22 — живой; + мёртвые форки fLMCP/Boyan253) | MCP-сервер **FL Studio 2024–2026**, 176 tools | «mix diagnosis, effects…» — локальный копилот FL через MCP | наш watch DawBackend FL-слота (№11); подтверждает спрос на «агент-рядом-с-DAW» в FL-комьюнити |

(Ранее верифицированные контексты для полноты карты: MAGDA-core — GPL-DAW с AI-чатом/Remote-API, живой; openDAW — «never generate your music»; synkopa — соло FL-образный Tauri-DAW.)

## 3. Вердикт для PRD

**Угроза: НЕТ (в текущем виде), но направление подтверждено рынком.**

- **Audial не атакует наш базовый сценарий**: у них нет ни DAW-интеграции, ни композиции партий по лупу, ни loop-centric flow — они «облачная обработка трека», мы «копилот сборки трека вокруг лупа в DAW». Пересечение — только Loop X-Ray (анализ), и там наш аргумент — 91 мс локально vs ~30 с облако + приватность.
- **Но Cloud-конвейер Audial = валидация спроса** на весь наш Pro-путь (master/stems/audio2midi/тамбры). Если их модель дешёвая и удобная — она откусит «хочу быстро в облако» сегмент. Наш контр-нарратив: **«файлы не покидают машину; открытый стек; editable-MIDI ownership»** (тезис PRD «you own the result» — теперь с прямым анти-примером).
- **Угроза стратегическая одна**: если Audial (или LANDR) добавят DAW-интеграцию (плагин/MCP) поверх своего конвейера — их funnel (облако+DAW) станет прямым конкурентом. Срок: не в 2026 (ни один сигналов не подал), но держать в патруле ежес-принтово.

**Фичи worth adopting (дешёвые, из чужих удачных решений):**
1. **Master-reference-matching** (audial `master match-to-reference`) → в P-Master: normalize не только к −14/−16 LUFS-цели, но и «подтянуть к LUFS/тональному балансу исходного лупа» — у нас уже есть compare-данные (наш Self-Check сравнивает с лупом) — реализуется одной итерацией bounce→delta (тема №8 чек-лист, пункт 4 — уже почти это).
2. **Продолжение клипа** (Magenta «Continue») → в Regenerate-кнопку: «продолжить существующую партию на N тактов» рядом с «перегенерировать с чипами» (PRD V1.1; midi-gen v4-идея).
3. **Тамбры-слот подтверждён рынком** (audial sound2vital/serum): PRD P-Timbre остаётся валидным этапом, конкурентов в локальном исполнении нет.
4. **Монетизационная рамка LANDR** (mastering→distribution→royalties) — для §монетизация PRD: наш аналог — «от кокпита к релизу», но это v2+ дискуссия.

**Патрульные действия:** audialmusic.ai (цены выяснить) + geezoria/FLStudioMCP + MAGDA (core+reaper) — ежес-принтово; Moises/LANDR — раз в квартал (SaaS-цены/фичи).

## Источники (2026-11-25)

- audial-mcp README (полный, tools-таблица + OAuth/CI-механика) — raw GitHub; audialmusic.ai (скрейп главной — pricing gated)
- GitHub API: Conceptual-Machines/magda-reaper (GPL-3.0, 2★, push 2025-12-31), magenta/magenta-js (Apache-2.0, 2135★, push 2026-06-22), geezoria/FLStudioMCP (MIT, 11★, push 2026-11-22)
- Web-поиск 2026: Moises ($35 Pro, «middling for producers» — обзоры 2026), LANDR ($12.99 Studio, «AI mastering in your DAW», Berklee AIMS 2026)
- Контекст: наши темы №3 (SaaS-патруль-методика), №7 (движок), №8 (P-Mix/P-Master каталог), №11 (audial первичная верификация)

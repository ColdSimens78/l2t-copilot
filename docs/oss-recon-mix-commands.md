# OSS-разведка №8: полный каталог mix/мастеринг-команд soundcraft-cli v0.20.1

**Автор:** Разведчик · **Дата:** 2026-11-23 · **Для:** Папа (ревью) · **Тема:** Pro-путь (P-Mix/P-Master) через AI-командование движком — что умеет, чего не хватает
**Методика:** всё снято с **локального релизного бинаря** `~/bin/soundcraft-cli 0.20.1` (`--help`, `plugins`, `commands`, `describe`) + **живые headless-тесты** (`run --demo` с реальными вставками плагинов, параметрами и bounce). Каждое утверждение «работает» ниже — проверено выполнением, не прочитано.

---

## TL;DR

**P-Mix и P-Master покрываются имеющимися командами полностью для v0**: 28 mix-команд (volume/pan/mute/solo/inserts/sends/buses/instruments) + 29 встроенных плагинов (включая полный мастеринг-цепочку: EQ-7band → compressor → maximizer → dither) + **bounce с LUFS/true-peak-отчётом прямо в JSON-ответе** + `normalize` до −0.1 dBFS. Единственный зазор для «анализатор меряет → ядро командует»: **нет measure-команды** (измерение LUFS/EQ-баланса только через bounce→analyzer или bounce-отчёт) — зазор обходится штатно и не блокирует.

---

## 1. Mix-команды движка (mix.*, 28 шт — весь список)

| Команда | Параметры (из describe, дословно) | Для AI Mix Assistant |
|---|---|---|
| `mix.volume` | `{tracks?, db: -144..12 \| delta_db}` | ✅ **баланс громкостей** (delta_db — относительная подстройка: «бас на +1.5 дБ») |
| `mix.pan` | `{tracks?, pan: -1..1, index?: 0\|1}` | ✅ **стерео-образ** (index — для стерео-треков L/R) |
| `mix.mute` / `mix.solo` | `{tracks?, on}` | ✅ A/B-проверки, mute-диагностика маскировки |
| `mix.solo_safe` / `mix.clear_solos` / `mix.clear_mutes` | — | служебные |
| `mix.phase_invert` | `{tracks?}` | ✅ анти-фазная диагностика (наш analyzer умеет phase correlation) |
| `mix.trim` | Input Trim | запись (Pro-путь не про запись) |
| `mix.record_arm` / `mix.input_monitor` | — | запись |
| `mix.automation_mode` | режим автоматизации | v1+ |
| `mix.insert` | `{track?, slot?: 0..9 \| a..j, plugin: id, params?: {id: value}}` | ✅✅ **ключевая**: плагин + параметры одной командой (batch) |
| `mix.insert_remove` / `mix.insert_bypass` / `mix.insert_move` | — | ✅ перестройка цепочки |
| `mix.insert_param` | `{track?, slot, param, value}` | ✅ **одна ручка** («threshold −18») |
| `mix.insert_params` | `{track?, slot, params: {id: value}, preset?: name}` | ✅✅ **batch ручек + пресет** |
| `mix.insert_state` | Store Plugin State | сохранение настроек |
| `mix.send` | `{track?, slot?, bus: name, level_db?: 0, pre_fader?: false}` | ✅ **сенды** (reverb/delay-пространство) |
| `mix.send_remove` / `mix.send_level` | `{track?, slot, db?, pan?, mute?, pre_fader?}` | ✅ уровень/пан сенда |
| `mix.new_bus` | — | ✅ шины (parallel compression) |
| `mix.surround_pan` / `mix.send_surround_pan` | — | surround (не v0) |
| `mix.instrument` / `mix.instrument_param` | — | ✅ параметры встроенных синтов (у нас уже работает в импорте) |
| `mix.sampler_load` / `mix.sampler_clear` | — | ✅ сэмплы в Sampler |

Подтверждено живьём: `mix.insert_param {"track":"Master 1","slot":0,"param":"ceiling","value":-1.0}` → `{"value":-1.0}`; `mix.volume {"track":"Bass","db":-4.5}` → `{"tracks":1}`; `mix.insert` с batch-params на EQ → вставлено.

## 2. Встроенные плагины (29 шт) — мастеринг-набор полный

`soundcraft-cli plugins` (весь список; категории — как отдаёт движок):

| Категория | Плагины | Pro-путь |
|---|---|---|
| **Eq** | `eq_1band`, **`eq_7band`** | ✅ коррективный EQ: 4 полосы (low_shelf/low_mid/mid/high_mid/high_shelf) + **HPF/LPF с on/slope** — параметры сняты из живого inspect |
| **Dynamics** | **`compressor`** (Compressor/Limiter — `limiter`-параметр есть!), `expander_gate`, `de_esser`, **`maximizer`** (ceiling/threshold/release), `channel_strip` | ✅✅ компрессия + **брим-лимитер на Master** (в демо-сессии он уже стоит на Master-треке) |
| **Reverb** | `room_reverb`, `plate_reverb` | ✅ пространство через сенды |
| **Modulation** | `auto_pan`, `chorus`, `flanger`, `phaser`, `ring_mod` | ✅ движение/ширина |
| **Harmonic** | `saturator`, `lofi`, `rectifier`, `subharmonic` | ✅ сатурация/тепло; subharmonic — интересен для баса |
| **PitchShift / Other** | `pitch_shifter`, `time_shift`, `gain`, `trim`, `invert`, `dc_offset_removal`, `signal_generator` | утилиты |
| **Dither** | `dither` | мастеринг |
| **Instrument** | `subtractive_synth`, `drum_synth`, `sampler` | наши (импорт партий звучит) |

Полные параметрические словари движок отдаёт **в `session.inspect {detail:"full"}`** (все ручки с текущими значениями — факт из живого теста): пример `eq_7band`: `low_shelf_{freq,gain,q}, low_mid_{freq,gain,q}, mid_*, high_mid_*, high_shelf_*, hpf_{freq,on,slope}, lpf_{freq,on,slope}, input_gain, output_gain`; `compressor`: `threshold, ratio, attack, release, knee, makeup, mix, limiter, lookahead, sc_hpf_{freq,on}`; `maximizer`: `ceiling, threshold, release`. Это дает AI-слою **самоописание ручек без хардкода в Кодере** — читаем inspect, командуем insert_param.

## 3. Мастеринг/bounce: LUFS-пайплайн (проверено живьём)

| Инструмент | Что делает (факт) |
|---|---|
| **`file.bounce_mix`** | `{path, format?: wav\|aiff\|flac, bit_depth?: 16\|24\|32f, start?, end?, source?: main\|bus name, normalize?: false, dither?: true, fold_down?: stereo}` — ответ: **`{bytes, lufs, peak_db, true_peak_db, seconds, path}`** — измерение в том же вызове! |
| **bounce `normalize:true`** | живой тест: peak стал **−0.1 dBFS**, LUFS-отчёт честный (`-14.786` на демо-материале — практически Apple −16-окно) |
| **`file.bounce_stems`** | по-трековый bounce (диагностика маскировки: слушаем бас отдельно) |
| **`source: bus name`** | bounce отдельной шины (мастер-обработка/верб-бус) |
| **`convert --normalize`** | **peak −0.1 dBFS** (не LUFS) — файловая утилита, для оффлайн-подготовки |
| **`fold_down: stereo`** | mono-проверка (совместимость) |

**LUFS-цель в движке — НЕТ** (normalize = peak-режим). Целевой LUFS достигается циклом: `bounce (normalize:true)` → отчёт даёт lufs → если цель ≠ достигнута → `mix.volume {track: master-ish, delta_db}` или `maximizer.threshold` → re-bounce. Для Self-Check у нас уже есть внешний analyzer — **движковый отчёт lufs/peak/true_peak в bounce-ответе делает даже analyzer-шаг избыточным для быстрого цикла** (анализатор остаётся для тональности/спектра/X-Ray).

**Metering без bounce — НЕТ**: нет measure/analyze-команды в каталоге (проверено grep по measure/meter/analyz/loudness — только view-метры UI и `options.pre_fader_metering`). AI Mix Assistant измеряет: (а) bounce-отчёт (громкость/peak), (б) внешний audio-analyzer (спектральный баланс, ключ, фаза) — наш штатный путь.

## 4. AI Mix Assistant: что годится, чего не хватает

Сценарий P-Mix («анализатор меряет → ядро командует balance/pan/EQ»):

| Шаг ассистента | Команды | Статус |
|---|---|---|
| Снять состояние микса (громкости/паны/цепочки/сенды) | `session.inspect {detail:"full"}` | ✅ всё в одном JSON |
| Измерить спектр/ключ/фазу | audio-analyzer MCP (внешний) на bounce-файле | ✅ наш штатный |
| Выровнять громкости треков | `mix.volume` (db или delta_db) | ✅ |
| Развести стерео-образ | `mix.pan` | ✅ |
| Частотная коррекция (маскировка бас/кик) | `mix.insert eq_7band {params:{hpf_on,hpf_freq,...}}` / `mix.insert_param` | ✅ |
| Компрессия/сатурация | `mix.insert compressor/saturator` + `insert_param` | ✅ |
| Пространство | `mix.new_bus` + `mix.send` + `plate_reverb` на бус | ✅ |
| Мастер-цепочка | `mix.insert` на master-трек (eq_7band→compressor→maximizer) | ✅ (в демо так и сделано) |
| Целевой LUFS (−14/−16) | `bounce normalize:true` → отчёт lufs → delta-подстройка → re-bounce | ✅ циклом (см. §3) |
| Undo неудачной итерации | `edit.undo` | ✅ |
| **Измерение БЕЗ bounce** | — | ❌ нет measure-команды; обход: bounce (1.04 с на 56 с по спайку №7) |
| **Автоматизация по времени (микро-динами)** | `automation.set_point/write_range/thin` есть | ⚠️ возможно, v1 (для микро-микса, не v0) |

**Вердикт: P-Mix покрыт полностью для v0** (единственный зазор — measure-команда — обходится bounce-отчётом + внешним анализатором, оба уже в стеке). **P-Master покрыт**: master-цепочка EQ→comp→maximizer + normalize + LUFS/true-peak-отчёт + dither при bit_depth.

## 5. Чек-лист Кодеру (P-путь v0)

1. **`daw.render` в контракте уже годится** — обогатить ответ полями движка `{lufs, peak_db, true_peak_db}` (bounce-ответ даёт бесплатно); `normalize` параметр прокинуть (у нас в контракте уже есть `normalize?` — совпало с движком).
2. **Mix-фасад ядра** (P-Mix): `set_track_mix {track, volume_db?, pan?}` → `mix.volume`+`mix.pan`; `insert_plugin {track, plugin, params?}` → `mix.insert`; `set_plugin_param {track, slot, param, value}` → `mix.insert_param`. Имена — через ipc-contract bump (правило №7).
3. **Плагин-словарь не хардкодить**: после `mix.insert` читать `session.inspect full` → параметры слота самоописаны (§2). AI-слой видит актуальные ручки, движок владеет диапазонами.
4. **LUFS-цикл P-Master**: bounce `normalize:true` → lufs-отчёт → delta к цели (`mix.volume` delta_db на master-группе или maximizer.threshold) → re-bounce; число итераций ограничить (2–3), фиксировать в manifest.
5. **Сенды/бусы**: `mix.new_bus` → `mix.send {bus}` → плагин на bus-трек — паттерн parallel-processing; для v0 достаточно plate_reverb-сенда.
6. **Не строить в v0**: automation-точки (`automation.*`), surround, record_arm/input_monitor (запись — не наша зона), `mix.surround_pan`.
7. **Смоук-тест** (готовые команды из этого отчёта): `--demo` → `mix.insert eq_7band {params}` → `mix.insert_param ceiling -1.0` → `bounce normalize:true` → assert lufs в ответе.

## Источники

- Локальный релизный бинарь: `~/bin/soundcraft-cli 0.20.1 (linux x86_64)` — `--help`, `plugins`, `commands` (483), `describe` (mix.volume/pan/insert/insert_param(s)/send/send_level/file.bounce_mix), `convert --help`, `run --help`
- Живые headless-тесты (2026-11-23): insert maximizer/eq_7band с batch-params на demo-сессию; insert_param ceiling; volume; bounce с normalize:true → `{lufs:-14.786, peak:-0.1, true_peak:-0.077}`; bounce без сессии → тихий WAV с корректным отчётом
- Апстрим-доки v0.20.1 (контекст): docs/cli.md, docs/control-protocol.md (позиции/references), прочитаны в разведке №7

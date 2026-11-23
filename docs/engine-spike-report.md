# Спайк: SoundCraft v0.20.1 headless-CLI как DawBackend (Исход 3)

**Дата:** 2026-11-22 · **Исполнитель:** ядро · **Статус:** спайк завершён — вердикт владельцу
**Дистрибутив:** `soundcraft-0.20.1-linux-x86_64.deb` (release v0.20.1, 2026-11-12)

## 1. Установка (без системной установки)

- Задача предполагала tar.gz — в релизе v0.20.1 для linux-x86_64 его НЕТ
  (AppImage/deb/flatpak/pkg/rpm). Взята **.deb**: SHA256 сверен по
  `SHA256SUMS.txt` релиза (**ЦЕЛ**), извлечение `dpkg-deb -x` без root,
  `soundcraft-cli` и `soundcraft` → `~/bin/` (паттерн audio-analyzer).
  `soundcraft-cli --version` → `soundcraft-cli 0.20.1 (linux x86_64)`.
- Ман-страница `soundcraft-cli-mcp(1)` документирует headless-режим:
  `--demo` = in-process движок (без GUI), `--automation-read-root` /
  `--automation-write-root` = **песочница файлового доступа, встроенная в
  сам движок**; roots конфликтуют с `--connect` (т.е. headless и
  подключение к живому приложению — два разных режима).

## 2. Замеры (cargo run -p l2t-core --example engine_spike)

Workspace: ZCode-workspace с `bass_am90.mid` (syncopated, 5 нот, A2,
без вшитого темпа — контракт embed_tempo). Прогон 2026-11-22:

| Операция | headless CLI v0.20.1 | ZCode-плагин-мост v0.5.0 (данные PoC) |
|---|---|---|
| **Холодный старт** (spawn → initialize) | **0.15 с** | ~8 с (open_editor + ожидание + retry-паттерн) |
| tools/list | 17 инструментов (execute/batch/inspect_session/bounce_mix/…) | тот же каталог |
| **session.inspect full** | **<1 мс**, 24 ключа (tempo/tracks/markers/undo/…) | работал, но после wake-цикла |
| **event.tempo 90** | **<1 мс**, `{"bpm":90.0,"tick":0}` | работал |
| **file.import_midi** (bass_am90.mid) | **<1 мс**, `{"tracks":[33]}` | ~10 с на импорт (за 30 с таймаут батча из 3) |
| **file.bounce_mix → WAV** | **1.04 с**, 16 MB, 55.9 с контента, `lufs:-19.22, peak_db:-3.27, true_peak_db:-3.08` в ответе | форма ответа та же (LUFS/peak/TP), но через wake-цикл и workspace-танцы |
| Файл на диске | ✅ RIFF WAV по пути write-root | ✅ |

Сверка LUFS с v0.5.0: **формат ответа идентичен** (integrated LUFS +
peak + true peak + path + bytes + seconds) — данные контент-зависимы
(демо-сессия vs наш луп), прямое сравнение чисел бессмысленно;
структурная совместимость подтверждена.

## 3. Песочница (правило шины №1)

Негативные тесты — оба отвергнуты движком как `isError` с внятным
текстом, без зависаний:

- `file.import_midi /etc/passwd` → `automation path rejected: outside
  the read root …`
- `file.import_midi ../../etc/passwd` → rejection (traversal закрыт)

**Это сильнее, чем плагин-мост**: там песочница была свойством
ZCode-плагина; здесь она внутри движка и конфигурируется флагами —
DawBackend-адаптер получает её бесплатно на любом хосте.

## 4. Ограничения / риски (честно)

1. `--demo` поднимает **демо-сессию**: настоящий workflow начнётся с
   `new_session`/`open_session` внутри roots — в спайке не проверено
   (следующий шаг после ратификации).
2. Формат ответов `execute` может отличаться между v0.5.0 и v0.20.1 —
   v0.5.0-данные из ZCode-плагина брались на тех же командах
   (event.tempo/file.import_midi), ключи совпали; но при переключении
   DawBackend нужен контракт-тест на команды, которые мы реально зовём.
3. `--connect` (управление живым GUI-приложением) — отдельный режим;
   если владельцу нужен GUI-микшер, мост можно держать параллельно.
4. Плагин-мост на v0.5.0, standalone на v0.20.1 — версионный зазор
   (upstream-watch: v0.5.0 отстал на 15 минорных).

## 5. Вердикт спайка

**РАБОТАЕТ.** Headless v0.20.1 закрывает все четыре DawBackend-операции
спайка (inspect/tempo/import/bounce) с на 1–2 порядка лучшим временем
отклика, встроенной песочницей и LUFS-отчётом в ответе. Рекомендация:
переключить DawBackend со звука «плагин-мост» на «standalone CLI»
(Исход 3, гибрид из oss-recon-engines.md) — **решение за владельцем**.

## 6. Артефакты

- `~/bin/soundcraft-cli`, `~/bin/soundcraft` (v0.20.1, из deb, не системно)
- `crates/l2t-core/src/config.rs` — `resolve_soundcraft()` пресет
  (env: `L2T_SOUNDCRAFT`, `L2T_SOUNDCRAFT_WORKSPACE`)
- `crates/l2t-core/examples/engine_spike.rs` — воспроизводимый прогон:
  `cargo run -p l2t-core --example engine_spike -- <workspace>`
- Доказательства прогона: workspace/bounce_am90.wav (16 MB, RIFF PCM,
  LUFS −19.22 в ответе движка)

## 7. Follow-up (2026-11-22, факт-добор по зазорам отчёта)

### 7.1 Зазор №1 закрыт: жизненный цикл сессии ВНУТРИ roots — работает

Тот же engine_spike-прогон, фаза 5 (`new_session → event.tempo 90 →
save_session → open_session → inspect full`):

| Операция | Время | Результат |
|---|---|---|
| `new_session {name:"spike-fresh", sample_rate:44100, template:"blank"}` | 0 мс | `{"name":"spike-fresh","sample_rate":44100}` |
| `event.tempo {bpm:90}` на новой сессии | 0 мс | `{"bpm":90.0,"tick":0}` |
| `save_session {path: <ws>/spike_session.scraftz}` | **65 мс** | 2501 байт, `audio_files_written:0` |
| `open_session {path}` | 0 мс | `{"missing":[],"name":"spike_session","tracks":0}` — битых ссылок нет |
| `inspect full` после reopen | — | **tempo = `[{bpm:90.0, tick:0}]` — темп-карта персистентна** |

Два семантических факта (критичны для DawBackend/adopt_loop):

1. **`tempo` в inspect — МАССИВ событий темп-карты `[{bpm, tick}]`, а не
   объект `{bpm}`** (наша первая экстракция промахнулась — выловлено
   спайком). Контракт adopt_loop: после «применить темп лупа» сверяем
   `tempo[last].bpm`, не `tempo.bpm`.
2. **Имя сессии при open_session = стем файла**, аргумент `name` из
   new_session — транзиентный (перезаписывается). DawBackend должен
   именовать файл правильно, а не полагаться на arg name.

Рабочий лист `spike_session.scraftz` + `t2.scraftz` остаются в workspace
как доказательство (пересоздаются прогоном).

### 7.2 План контракт-теста (зазор №2: v0.5.0 ↔ v0.20.1)

**Цель:** доказать, что команды, которые DawBackend реально зовёт,
возвращают на standalone v0.20.1 совместимую форму — или задокументировать
дельты и закрыть их адаптером ДО переключения.

**Команды DawBackend → engine-команды** (по docs/dawbackend-spec.md):

| DawBackend | engine-команда | Fixture-аргументы | Инвариант формы ответа |
|---|---|---|---|
| `get_session` | `session.inspect` (`inspect_session full`) | пустая blank-сессия | ключи из 24-набора спайка; `tempo: [{bpm,tick}…]`, `tracks: []`, `sample_rate: number` |
| `set_tempo` | `execute event.tempo {bpm:90}` | 90 | `{"bpm": number, "tick": number}` |
| `adopt_loop` (C1) | `event.tempo` + `markers.add {name, at, kind}` | bpm из лупа, kind="key" | как выше + маркер в `markers[]` инспекта |
| `import_midi` | `execute file.import_midi {path}` | `bass_am90.mid` (5 нот) | `{"tracks": [number…]}`, после инспекта: у трека `clip.notes == 5` |
| `add_marker` | `execute markers.add {name, at, kind}` | "A minor", at=0 | маркер читается инспектом |
| `render` | `execute file.bounce_mix {path, format:"wav", start, end}` | диапазон 0…4 такта | ключи `bytes/lufs/path/peak_db/seconds/true_peak_db`, WAV на диске |
| откат | `execute edit.undo` | после import | инспект показывает откат (track count −1) |

**Механика прогона:**

1. Канонический fixture: `bass_am90.mid` + blank-сессия 44100 —
   байт-в-байт одинаков для обеих версий (фикстура уже в workspace).
2. Один драйвер (паттерн engine_spike: stdio JSON-RPC, bounded-таймауты)
   прогоняет таблицу на **обеих версиях**: v0.5.0 — через ZCode-плагин-мост
   (stdio из конфига), v0.20.1 — через `soundcraft-cli mcp`.
3. Ответ каждой команды → `golden-<version>.json` (коммитятся в репо).
4. **Сверка формы, не значений**: множества ключей top-level, типы,
   enum-значения. НЕ сверяем: абсолютные LUFS/размеры/ids/длины — они
   контент-зависимы (урок LUFS в §2).
5. Критерий PASS: формы идентичны ИЛИ каждая дельта закрыта решением
   (адаптер-шим в DawBackend / upstream issue). Предварительная дельта
   уже известна из спайка: поле `true_peak_db` (v0.20.1) vs `tp` (как в
   ZCode-обёртке v0.5.0 возвращала `TP −4.78` — сверить точное имя ключа
   на золоте v0.5.0).
6. Дешёвая предпроверка версий: `parity()` + `list_commands()` на обеих
   сторонах — каталог команд diff-ается до прогона (ловит переименования
   типа `event.*`/`file.*`/`session.*`).

**Место реализации после ратификации:** `crates/l2t-core/tests/contract_engine.rs`
(golden-файлы коммитятся; тест skip-ается при отсутствии бинарей —
сложившийся паттерн репозитория).

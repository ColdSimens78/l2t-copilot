# IPC-контракт: кокпит ↔ ядро

**Версия:** 0.2.1 · **Владелец:** мейнтейнер · **Дата:** 2026-11-24
**Это единственное место, где определены типы между React-фронтом и Rust-ядром.**
ядро реализует Rust-сторону (`crates/l2t-core`), UI-модуль — TS-сторону
(`ui/src/types`). Расхождение сторон = баг, ловится на ревью.

## Изменения v0.2 (вердикты мейнтейнера по зазорам C1–C6/T1 из ui-screens-v0.md §7)

- ✅ **C1 `adopt_loop {bpm, key, source}` → `{tempo, marker}`** — принято
  (зеркало dawbackend-spec); реализация в ядре — с приходом SoundCraft-клиента;
  UI-флаг включён.
- ✅ **C2 конвенция превью**: `staging/<part>_v<N>.wav` рядом с .mid, рендерит
  сайдкар GM-синт (fluidsynth); UI ищет файл по конвенции. UI-флаг включён.
- ✅ **C5 `analyze_loop` + optional `copy_into_workspace: bool = false`** —
  принято (лечит фрик правила 1 шины для drop-зоны).
- ✅ **C6 `BusState` + `session_name: string?`** — принято.
- ⏸ **C3 `daw.render {path, normalize}`** — в контракте как optional-команда;
  реализация с хост-клиентом (v0: UI показывает инструкцию экспорта).
  **С v0.2.1 закрыт командой `export_track`.**
- ⏸ **C4 cancel-команда** — v1; v0: [отменить] = «скрыть показ» (семантика
  ui-screens §3).
- ⏸ **T1 транспорт play/stop** — v1.

## Изменения v0.2.1 (Mastering Targets v0)

- ✅ **`export_track {output_path?, target?}` → `ExportTrackOutput`** —
  экспорт микса в WAV с опциональной целью громкости платформы.
- **Что делает ядро.** `file.bounce_mix` движка пишет файл. С целью
  (`spotify` −14 / `apple` −16 LUFS) движок рендерит тот же микс с
  peak-normalize до −0.1 dBFS, после чего analyzer повторно меряет файл.
- **Честный ответ.** Движок не нормализует до LUFS, только по пику, поэтому
  цель не гарантирована: `mastering.delta` — расстояние до неё, а
  `verdict` объясняет сторону: `on_target` (±1 LU) / `below_target` (нужен
  лимитер) / `above_target` (нужно ослабление) / `silent` (громкости нет).
- **Normalize не во вред.** Если нормализация уводит от цели дальше, чем
  сырой bounce (громкий, уже лимитированный материал), файл остаётся как
  есть (`applied: "none"`). Пики выше −0.1 dBFS снимаются всегда.
- **Экспорт не меняет сессию движка** и не подменяет эталон Self-Check: им
  остаётся последний проанализированный луп, а не экспорт.

## Правила изменения схемы

1. Любое изменение = **bump версии** этого файла + согласие мейнтейнера
   (предложение и вердикт фиксируются в журнале проекта).
2. Обе стороны обновляются в одном коммите или двух подряд без промежуточной
   сборки (никто не остаётся на старой схеме).
3. Формат нот — **только `core/midi_io`**: `{note, start, end, velocity, channel}`
   в тиках. Никаких `pitch`/`len`/дублирующих структур (урок унификации v0.4).

## Commands (UI → ядро)

| Команда | Вход | Выход |
|---|---|---|
| `analyze_loop` | `{path}` | `XRayReport {bpm, bpm_confidence, bpm_alt?, key, key_confidence, key_relative?, lufs, true_peak, bands, onset_density}` |
| `generate_part` | `{tool: 'bass'\|'chords'\|'drums', params}` | `Suggestion` |
| `regenerate` | `{part, params_diff}` | `Suggestion` (новая версия) |
| `accept_part` | `{part, version}` | `{imported_tracks[]}` — вызывает DawBackend.import_midi |
| `reject_part` | `{part, version}` | `{}` |
| `get_bus_state` | — | `BusState {tempo, key_marker, tracks[], engine: 'up'\|'waking'\|'down'}` |
| `run_self_check` | `{bounce_path}` | `SelfCheckReport {key_match, tempo_match, lufs_delta, bands_delta, verdict}` |
| `export_track` | `{output_path?, target?: 'none'\|'spotify'\|'apple'}` | `ExportTrackOutput {path, seconds, lufs, peak_db, true_peak_db, target, mastering}` — рендер движком |

## Events (ядро → UI)

| Событие | Payload |
|---|---|
| `bus_log` | `{ts, tool, command, status: 'ok'\|'timeout'\|'error', ms}` |
| `suggestion_updated` | `{part, version, suggestion}` |
| `host_status` | `{engine}` |

## Данные

### Suggestion (контракт §5.1 proposal v0.3)

```json
{
  "version": 2,
  "part": "bass",
  "notes": [{"note": 45, "start": 0, "end": 240, "velocity": 100, "channel": 0}],
  "rationale": "синкопа на 1.5/3.5 с, корень Am",
  "confidence": 0.84,
  "source_tool": "midi-gen.generate_bassline v3",
  "params": {"bpm": 90, "key": "A minor", "style": "syncopated", "embed_tempo": false},
  "status": "generated"
}
```

- `notes` — в точности вывод `core/midi_io.load_notes` (тики, 0-indexed каналы).
- `status`: `generated → auditioned → accepted | rejected` (§5.2 proposal).
- После `accept` запись уходит в manifest.json (Acceptance Rate, §5.3) и
  материализуется дорожкой хоста.

### ExportTrackOutput (v0.2.1)

```json
{
  "path": "<workspace>/export/l2t-export-spotify-1732766400000.wav",
  "seconds": 55.884,
  "lufs": -15.12350845336914,
  "peak_db": -0.10000041872262955,
  "true_peak_db": -0.0775223821401596,
  "target": "spotify",
  "mastering": {
    "target_lufs": -14.0,
    "applied": "normalize",
    "achieved_lufs": -15.1,
    "delta": 1.1,
    "verdict": "below_target",
    "measured_by": "analyzer"
  }
}
```

- `lufs` / `peak_db` / `true_peak_db` — отчёт движка о финальном файле.
- `output_path` лежит внутри workspace движка (automation-roots); по
  умолчанию — `<workspace>/export/l2t-export-<время>.wav`, каталог задаёт
  env `L2T_EXPORT_DIR`.
- `target` по умолчанию `none` — тогда `mastering` равно `null` (ключ есть).
- `mastering.applied`: `none` (файл как есть) | `normalize` (пик −0.1 dBFS).
- `mastering.achieved_lufs` — повторный замер analyzer; `measured_by` равно
  `engine`, если слот analyzer не жив (вердикт тогда по отчёту движка).
- `mastering.delta` = `target_lufs − achieved_lufs`: больше нуля — тише
  цели, меньше — громче.

### Файлы стейджинга (workspace)

```
<workspace>/staging/manifest.json   — список suggestion + решения (лог)
<workspace>/staging/<part>_v<N>.mid — артефакты партий
```

## Синхронизация сторон

- Rust: типы в `crates/l2t-core/src/contract.rs` (serde).
- TS: типы в `ui/src/types/contract.ts` (зеркало, ручная синхронизация до v1).
- Ревью проверяет соответствие обеих сторон этому файлу.

## Примечание: формы ответов движка (контракт-тест v0.5.0 ↔ v0.20.1, 2026-11-22)

Golden снят живым на обеих версиях (см. `crates/l2t-core/tests/golden/`,
тесты `contract_engine.rs`) — **формы совпали поле-в-поле** на всех
командах DawBackend: `new_session`, `event.tempo` `{bpm, tick}`,
`markers.add` `{id, number}`, `file.import_midi` `{tracks: [id…]}`,
`bounce_mix` `{bytes, lufs, path, peak_db, seconds, true_peak_db}`,
`session.inspect` (24 ключа), `edit.undo` `{undone}`. Семантика для
реализаций:

1. **`tempo` в inspect — массив темп-карты `[{bpm, tick}…]`**, не объект:
   текущий BPM = `tempo[last].bpm` (adopt_loop/get_bus_state сверяют так).
2. **`markers.add` kind нормализуется движком в `"Marker"`** — key-конвенция
   живёт в имени: `Key: <тональность>` (get_bus_state парсит её оттуда).
3. **Имя сессии при open_session = стем файла** (аргумент new_session —
   транзиентный).
4. **Клип-длина импорта считается по текущей темп-карте сессии** (сэмплы):
   adopt_loop ДО import_midi, иначе длина неверна.
5. `bounce_mix` v0.5.0-плагин-моста возвращал ВТОРОЙ JSON-объект хвостом
   (`written`); standalone v0.20.1 — одиночный объект. Ядро парсит первый.
6. При `engine: "down"` поля `tempo`/`key_marker` приходят `null`
   (TS-зеркало: `number | null` / `string | null`; Screen 0 их не рисует).
7. **`file.bounce_mix` умеет только peak-normalize**: `normalize: true`
   даёт пик −0.1 dBFS; LUFS-цели и офлайн-гейна у движка нет (`convert` —
   отдельная CLI-команда, в MCP не выставлена). Интегральный LUFS
   сдвигается ровно на величину гейна: демо-сессия −19.37 LUFS при пике
   −4.35 → −15.12 при пике −0.1.

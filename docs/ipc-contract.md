# IPC-контракт: кокпит ↔ ядро

**Версия:** 0.2 · **Владелец:** мейнтейнер · **Дата:** 2026-11-22
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
- ⏸ **C4 cancel-команда** — v1; v0: [отменить] = «скрыть показ» (семантика
  ui-screens §3).
- ⏸ **T1 транспорт play/stop** — v1.

## Правила изменения схемы

1. Любое изменение = **bump версии** этого файла + строка в «ПРЕДЛОЖЕНИЯ ДЕТЕЙ»
   памяти + согласие мейнтейнера.
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
   (TS-зеркало сейчас `number`/`string` — уточнить optional
   при следующей синхронизации; Screen 0 их не рисует).

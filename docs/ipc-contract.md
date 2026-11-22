# IPC-контракт: кокпит ↔ ядро

**Версия:** 0.1 · **Владелец:** Папа · **Дата:** 2026-11-22
**Это единственное место, где определены типы между React-фронтом и Rust-ядром.**
Кодер реализует Rust-сторону (`crates/l2t-core`), Фронтендер — TS-сторону
(`ui/src/types`). Расхождение сторон = баг, ловится на ревью.

## Правила изменения схемы

1. Любое изменение = **bump версии** этого файла + строка в «ПРЕДЛОЖЕНИЯ ДЕТЕЙ»
   памяти + согласие Папы.
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

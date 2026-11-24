# E2E-отчёт: полный контур из окна + «Save WAV» (этап 2, финал)

**Дата:** 2026-11-23 · **Исполнитель:** Кодер · **Коммит:** см. git log (d52f688 + export_track)
**Сценарий владельца:** drop лупа → X-Ray → генерация → аудиция → accept →
экспорт WAV из приложения. Никакого внешнего агента в контуре — только
React-экраны ↔ Tauri IPC ↔ l2t-core ↔ шина.

## 1. Окружение

- Окно: Tauri 2.12.7 + WebKitGTK 2.54 (Debian 13, X11); devUrl vite :5199.
- Движок: `soundcraft-cli 0.20.1` standalone, **без `--demo`** — рабочая
  сессия пользователя `<workspace>/cockpit.scraft` (ratified, d52f688).
- Слоты шины: audio-analyzer (`~/bin/mcp-server`), midi-gen
  (репо-venv `l2t-midi-gen`), fluidsynth 2.4.4 (превью).
- Fixture: `examples/emotional_piano_E-minor.flac` (CC0, Разведчик;
  измерение анализатора: E minor conf 0.88, BPM рубато).

## 2. Шаги контура (все вызовы из webview, форма адаптера `{ input }`)

| # | Команда | Результат живого прогона 2026-11-23 |
|---|---|---|
| 0 | старт окна | `[session] открыта cockpit.scraft: {missing:[], tracks:2}` — рабочая сессия с прошлых прогонов поднялась |
| 1 | `analyze_loop` | `{"bpm":139.7,"key":"E minor","key_conf":0.876}` (кросс-валидация с измерением Разведчика 0.88) |
| 2 | `adopt_loop` | `{"tempo":139.7,"marker":"Key: E minor"}` — event.tempo + key-маркер, автосейв |
| 3 | `get_bus_state` | `{engine:"up", tempo:139.7, key:"E minor", session:"cockpit"}` |
| 4 | `generate_part` (bass, syncopated) | v1, 5 нот, `staging/bass_v1.mid` |
| 5 | fluidsynth-превью | `staging/bass_v1.wav` (конвенция C2) |
| 6 | `accept_part` | `{"imported_tracks":["MIDI 1 2"]}` — импорт в сохранённую сессию + автосейв |
| 7 | verify `get_bus_state` (= session.inspect) | 3 инструментальных трека, у каждого клип `notes:5` — `MIDI 1` (v1, прошлый прогон), `MIDI 1 1` (v2), `MIDI 1 2` (v3, этот) |
| 8 | **`export_track`** («Save WAV») | `{"lufs":-20.66,"path":"…/export/l2t-export-1795454663032.wav","peak_db":-9.31,"seconds":1.718}` |
| 9 | `run_self_check` на экспорте | `key_match:false, tempo_match:true, lufs_delta:7.6, verdict:"fail"` (см. §5) |

Итог e2e: `e2e_done=ok`, ошибок контура нет.

## 3. Верификация WAV на диске

`file`: `RIFF (little-endian) data, WAVE audio`, 455 286 байт.

Парсинг чанков: `JUNK(28) + bext(602) + fmt(40, extensible) + data(454 572)`
— broadcast-метаданные; PCM16 stereo 44 100 Hz, **227 286 сэмплов, 99 %
ненулевых, полный пик 32768** — аудио настоящее, не тишина.

## 4. Песочница (правило №1) — соблюдено

- staging ядра живёт **внутри** automation-roots движка
  (`<workspace>/staging`) — импорт партий принят (факт: без этого движок
  отвечает `automation path rejected`, проверено ранее).
- Экспорт — `<workspace>/export/` (env `L2T_EXPORT_DIR` переопределяет):
  внутри roots, и путь workspace-типа для analyzer — Self-Check на
  экспорте прочитал файл без ограничений.
- Аудио-исходники сессии движок складывает в `<workspace>/Audio Files/`
  (относительные пути в `sources[]` — формат v0.20.1).

## 5. Честные оговорки

1. `verdict:"fail"` на Self-Check — семантически корректно: эталон X-Ray —
   пиано-луп (E minor, 139.7), экспорт — чистый сгенерированный бас;
   анализатор на одиночном басе даёт несводимый ключ (tempo_match:true —
   темп унаследован). На однородном контенте (cargo
   `full_pipeline_on_ratified_engine`) verdict `ok`. Вопрос warn-критерия
   (|lufs_delta| порог) остаётся за владельцем — флаг с этапа 1.
2. Треки `MIDI 1`, `MIDI 1 1`, `MIDI 1 2` — артефакты трёх e2e-прогонов
   (accept каждой версии = новый трек; автонейминг движка). Прод-флоу
   предполагает одну принятую версию на партию; очистка сессии — на
   усмотрение владельца.
3. `bpm:139.7` (рубато) ядро округляет до целого для генераторов —
   примечание №7 ipc-contract.

## 6. Артефакты

- `<workspace>/cockpit.scraft` — рабочая сессия (3 трека, tempo 139.7,
  key-маркер E minor).
- `<workspace>/export/l2t-export-1795454663032.wav` — «Save WAV» из окна.
- `<workspace>/staging/bass_v1.{mid,wav}` + `manifest.json`.
- Код: `CockpitCore::export_track` (+`resolve_export_dir`,
  env `L2T_EXPORT_DIR`), Tauri-команда `export_track {input:{output_path?}}`.
- Лог прогона: SPIKE-строки stdout ядра (механика `L2T_E2E=1`).

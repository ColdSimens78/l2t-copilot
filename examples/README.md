# Примеры: тестовые лупы

Сюда кладутся лупы для проверки пайплайна «анализ → генерация → DAW».

Правила:

- только материалы без лицензионных ограничений (свои записи, **CC0/PD-сэмплы —
  лицензия каждой страницы проверена по месту, см. таблицу ниже**);
  **приватные записи в репозиторий не попадают**;
- нейминг: `<источник>_<bpm>_<key>.flac` (BPM/тональность — фактические
  значения от нашего анализатора, см. таблицу; BPM опускается, если детекция
  ненадёжна — conf < 0.2);
- формат в git — **FLAC** (lossless, git-friendly; WAV/MP3 в репо не кладём).
  `.gitignore` маскирует аудио по всему репо и **разрешает**
  `examples/**/*.flac` и `examples/**/*.mid`;
- получить WAV для SoundCraft-импорта: `ffmpeg -i <файл>.flac loop.wav`.

## CC0-лупы в каталоге (проверено: лицензия каждой страницы OGA = CC0)

BPM/тональность **измерены нашим audio-analyzer-rs** (rhythm_analysis +
harmonic_analysis, 2026-11-22) — то есть эти файлы одновременно и тестовые
данные, и фиксация калибровки нашего анализа.

| Файл | BPM (analyzer) | Тональность (analyzer) | Длительность | Источник (страница OGA, лицензия CC0) | Автор OGA |
|---|---|---|---|---|---|
| `fun_bass_loop_94_D-minor.flac` | 94.0 (conf 0.62, stab 0.85) | D minor (conf 0.66) | 30.9 с | [Fun Bass Loop](https://opengameart.org/content/fun-bass-loop) | MF-BA |
| `emotional_piano_E-minor.flac` | ~140 / рубато — **conf 0.10, не полагаться**; экспрессивная игра без сетки | **E minor (conf 0.88)** | 27.8 с | [Emotional piano loop](https://opengameart.org/content/emotional-piano-loop) | LifeDisarmoniA |
| `minor_piano_strings_161_Fs-minor.flac` | 161.5 (stab 0.94, IBI σ 0.023) — вероятный ×2-лока, истинный ≈ **80.75**; сверить на e2e-спайке | **F# minor (conf 0.80)** | 23.5 с | [Minor Piano + Strings Loop](https://opengameart.org/content/minor-piano-strings-loop) | см. страницу OGA |
| `tense_bass_boost_140_A-minor.flac` | 139.7 (conf 0.56, stab 0.99) — совпадает с заявленными автором 140 BPM | A minor (conf 0.64) | 6.9 с | [Tense Bass Boost Drum Loop 140 BPM](https://opengameart.org/content/tense-bass-boost-drum-loop-140-bpm) | Fupi |
| `bass_loop_v2_181_A-minor.flac` | 181.5 (conf 0.57) — возможно ×2 от ~90.75; сверить на спайке | A minor (conf 0.63) | 32.0 с | [Bass Loop V2](https://opengameart.org/content/bass-loop-v2) | см. страницу OGA |
| `minor_piano_strings_title.mid` | MIDI-исходник лупа из того же пакета (set_tempo внутри — импортировать с embed_tempo-контрактом в уме) | — | — | тот же CC0-пакет, что строка выше | см. страницу OGA |

Примечания:

- Все страницы OGA помечены `license-name: CC0` (проверено парсингом
  `license_images/cc0.png` + `license-name` в HTML, 2026-11-22). CC0 не
  требует attribution — указание авторов вежливость, не обязательство.
- Тональность Fun Bass Loop / tense / v2 — синт-басы с богатыми гармониками,
  conf 0.6-0.7: годится для smoke-тестов keys_match, для калибровки тональности
  эталон — emotional/minor-piano (conf 0.80+).
- Пара лупов даёт проверку ×2-локи ритм-детектора (161.5/80.75 и 181.5/90.75)
  — прямо наш кейс допуска ×2/÷2 в Self-Check.

Восстановить наш тестовый сценарий без приватных данных: любой луп 1-30 c,
44.1 kHz — анализ даст BPM/тональность, дальше сгенерируйте партии в этой
тональности (`l2t-midi-gen`) и сравните результат через `compare`.

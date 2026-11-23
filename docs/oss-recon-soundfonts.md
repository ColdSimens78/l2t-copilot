# OSS-разведка №2: превью-рендер для стейджинга (сайдкар GM-синт)

**Автор:** OSS-разведка · **Дата:** 2026-11-22 · **Для:** мейнтейнер (ревью) · **Тема:** proposal §10.2 вариант (а) — `.mid → .wav` для быстрых итераций прослушивания
**Методика:** лицензии сняты с фактических файлов (Debian copyright-файлы извлечены из .deb, LICENSE.txt из апстрим-репо), метрики GitHub/crates.io API 2026-11-22. apt-факты — с локальной машины (Debian 13 trixie).

## TL;DR — рекомендация

**Берём в v0:** `fluidsynth` (apt) + **MuseScore_General** (apt `musescore-general-soundfont`, MIT, 75.7 MB sf3) как дефолт + **FluidR3_GM** (apt `fluid-soundfont-gm`, MIT, 148 MB sf2) как fallback. Оба soundfont'а MIT — юридически чисты даже для бандла в release-артефакт; но в git-репо бинарники не кладём — пользователь ставит через apt, Rust-ядро авто-детектит путь. GeneralUser GS — опция «пользователь ставит сам» (🟡). TimGM6mb и Arachno — красные, не дистрибутируем.

Рендер-команда (без аудио-девайса, чистый офлайн-рендер):

```bash
fluidsynth -ni -F /tmp/preview.wav -r 44100 -g 0.4 "$SF" input.mid
# -ni: no shell interaction, выйти после рендера; -F: выходной WAV; -r: sample rate; -g: gain
```

---

## 1. FluidSynth — сайдкар-движок

| Параметр | Факт | Источник |
|---|---|---|
| Лицензия | 🟢 **LGPL-2.1+** (Debian copyright: `License: LGPL-2.1+`) | извлечён из `fluidsynth_2.4.4+dfsg-1+deb13u3_amd64.deb` |
| В Debian trixie | **2.4.4+dfsg-1+deb13u3** (бинарник 30 KB + `libfluidsynth3`; зависимости: glib, pipewire, sdl2) | `apt-cache show fluidsynth` |
| Апстрим | [FluidSynth/fluidsynth](https://github.com/FluidSynth/fluidsynth), **v2.6.2** (2026-11-01), 2560★, push 2026-11-22 — живой | GitHub API |
| CLI-рендер | `fluidsynth -ni -F out.wav [-r 44100] [-g 0.4] [опции] sf2/sf3 mid` — порядок: сначала soundfont, потом MIDI; `-ni` = без интерактивной оболочки, выход после рендера | апстрим-док + локальная проверка (совпадает) |
| Драйверы аудио | pipewire/sdl2/pulse — для офлайн-рендера не нужны (`-F` обходит аудио-девайс) | Debian Depends |
| Python-обёртки | pyfluidsynth и форки (255★) — **не рекомендую**: сайдкар = CLI-процесс, ctypes-слой лишний | GitHub search |
| Rust-обёртки | community-биндинги без активного мейнтейнера — **не нужны** по той же причине (и правило: контракт шины = файлы/MCP, не FFI) | GitHub search |

**Лицензионная механика LGPL в нашей архитектуре:** FluidSynth работает как **отдельный процесс** (сайдкар), не линкуется в наш код → LGPL-2.1 выполняется без ограничений на наш MIT-код. Способ поставки: `apt install fluidsynth` пользователем (Debian сам тянет libfluidsynth3). Бандлить бинарник в Tauri sidecar технически возможно (LGPL допускает «system library»-паттерн с указанием на источник), но это лишняя работа — apt-путь проще и безопаснее.

**Альтернативы:**

| Движок | Лицензия | ★ | Активность | Вердикт |
|---|---|---|---|---|
| [sfztools/sfizz](https://github.com/sfztools/sfizz) | 🟢 BSD-2-Clause | 529 | push 2025-03 (тихо ~8 мес) | SFZ-плеер, не GM-sf2; в trixie пакета нет; GM-набор потребовал бы сторонний SFZ-банк → не v0, вспомнить при переходе на SFZ-инструменты |
| timidity (apt) | 🔴 GPL-2+ | — | 2.14.0-8.3 в trixie | Классический .mid→.wav, но устаревший движок и GPL-плагины; FluidSynth покрывает; не берём |
| wildmidi (apt) | 🔴 GPL (библиотека LGPL? бинарник GPL) | — | 0.4.3 в trixie | Плеер, rендер через `-o wavfile`; inferior к FluidSynth; не берём |

---

## 2. GM SoundFonts: лицензии — фактическая проверка

Светофор: 🟢 = можно бандлить в MIT-репо/release (с сохранением уведомления); 🟡 = «пользователь ставит сам» (лицензия custom-разрешающая, но не OSI-чистая); 🔴 = не дистрибутировать вообще.

| Soundfont | Лицензия (факт, цитата) | Размер | apt-пакет (trixie) | Путь в системе | Качество (по докам) | Светофор |
|---|---|---|---|---|---|---|
| **MuseScore_General** 0.2.1 | **MIT** — «the soundfont is licensed under the MIT license» (Debian пакет + MuseScore Handbook); составлен из Fluid R3 + улучшения | **75.7 MB** sf3 (HQ lossy); lossless 329.8 MB | `musescore-general-soundfont` / `-lossless` | `/usr/share/sounds/sf3/MuseScore_General.sf3` | Современный дефолт MuseScore 3/4: полный GM+GS, лучшие басы/ударные из тройки зелёных (свежие сэмплы поверх FluidR3) | 🟢 **дефолт v0** |
| **FluidR3_GM** 3.1 | **MIT** — copyright-файл цитирует README Фрэнка Вена: «I hereby release Fluid under the MIT license, as described in COPYING» | **148 MB** sf2 | `fluid-soundfont-gm` (есть `-gs`) | `/usr/share/sounds/sf2/FluidR3_GM.sf2` | Классика (2000–2008): все 128 GM + GS-набор; сэмплы старее → бас/ударные по-современному звуку уступают MuseScore_General; зато проверен всем миром 20 лет | 🟢 fallback |
| **FluidR3Mono_GM** 2.315 | **MIT** (Debian copyright: «Fluid (R3) Mono GM soundfont (MIT)») | **23.6 MB** sf3 (lossy-ogg) | `fluidr3mono-gm-soundfont` | `/usr/share/sounds/sf3/FluidR3Mono_GM.sf3` | Mono-ремикс FluidR3 (MuseScore 2.1 дефолт): компактный, для dev-тестов быстрее всего ставить | 🟢 dev-вариант |
| **GeneralUser GS** v2.0.3 | **GeneralUser GS License v2.0** (custom): «Please feel free to use it in your software projects, and to modify the SoundFont bank or its packaging» — бандл текстом разрешён; **но** автор честно: «I cannot be 100% sure where all of the samples originated» (провенанс части сэмплов не прослеживается; жалоб не было с 2000) | 32.3 MB sf2 (RAM footprint 30.7 MB) | нет в trixie (Debian кладёт в non-free) | — | «Звучит как банк 2–3× своего размера», детальное программирование модуляторов; требует standards-compliant синт (FluidSynth соответствует) | 🟡 опция «ставит пользователь» |
| **TimGM6mb** 1.3 | 🔴 **GPL-2** (Debian copyright: `License: GPL-2`; сэмплы «public domain or GPL») | 5.97 MB sf2 | `timgm6mb-soundfont` | `/usr/share/sounds/sf2/TimGM6mb.sf2` | Крошечный дефолт MuseScore 1.3 (2004) — качество явно ниже четвёрки выше; и лицензия красная | 🔴 |
| **Arachno SoundFont** 1.0 | 🔴 custom: «personal use, don't distribute with more or less presets / don't modify» (Polyphone listing; AUR: license «custom») | ~110 MB | нет | — | Красиво, но редистрибуция запрещена; MuseScore бандлил «courtesy of Maxime Abbey» = по договорённости | 🔴 |

### Субъективное качество бас/аккорды/ударные (по документации, не по слуху)

- **Бас (наш syncopated bass):** MuseScore_General > FluidR3 (свежее сэмплирование низких инструментов) > FluidR3Mono (mono-сжатие гуляет на басу) > GeneralUser (компактный, но «as good or better than SoundFonts 2-3x its size» по заявлению автора).
- **Аккорды (voiceled triads):** все три зелёных дают корректный GM-пиан/E.Piano; MuseScore_General выигрывает деталью атаки.
- **Ударные (GM ch.10):** MuseScore_General (доп. наборы поверх FluidR3) > FluidR3 > GeneralUser (13 drum kits, плотно упаковано) > FluidR3Mono.
- Для нашего сценария (Self-Check, быстрые итерации, «узнать свою генерацию на слух») разница между двумя зелёными топами не блокирующая; выбор можно сделать флагом конфига.

---

## 3. Лицензионный гейт: варианты дистрибуции

| Вариант | FluidR3_GM / FluidR3Mono / MuseScore_General (MIT) | GeneralUser GS (custom) | TimGM6mb / Arachno |
|---|---|---|---|
| Копировать sf-файл в наш git-репозиторий | ⚠️ Юридически да, но **не делаем**: git не для 23–329 MB бинарников | ❌ Не делаем (sample provenance) | ❌ **Запрещено** |
| Копировать в release-артефакт (.deb/AppImage/установщик) | 🟢 Да — MIT это прямо разрешает, приложить лицензию в `THIRD_PARTY_NOTICES` | 🟡 Текст лицензии разрешает, но provenance-риск → не в дефолт | ❌ |
| apt-пакет, ставит пользователь | 🟢 **Рекомендуемый путь v0**: `sudo apt install fluidsynth musescore-general-soundfont` (+ опц. `fluid-soundfont-gm`) | 🟡 Пользователь скачивает с сайта автора сам; мы только имя и путь в конфиге | ❌ (TimGM технически возможен как apt, но смысла нет) |
| Динамическая загрузка пользовательского sf2/sf3 через UI-настройку | 🟢🟡 любой файл, который пользователь выбрал сам — наш код лицензии файла не распространяет | 🟡 | 🔴 советовать нельзя, грузить файл по явному выбору пользователя формально можно |

**Ключевой вывод:** всё 🟢 решается **двумя apt-пакетами** — наш репо остаётся чистым (только INSTALL-инструкция + THIRD_PARTY_NOTICES с MIT-текстами), пользователь получает звук одной командой. Никаких бинарников в git.

**Авто-детект в Rust-ядре** (предложение, порядок поиска): `MuseScore_General.sf3` → `FluidR3_GM.sf2` → `FluidR3Mono_GM.sf3` → путь из конфига/`SOUNDFONT_PATH` env; если ничего не найдено — bounded-ошибка с текстом «apt install musescore-general-soundfont» (наш урок bounded errors).

---

## 4. Интеграционные заметки для сайдкара (из фактов)

1. **Таймаут на процесс обязателен** (урок sections.rs): `tokio::process::Command` + `timeout` на 30–60 с; «timeout ≠ failure» → после таймаута проверить, появился ли WAV (рендер мог успеться).
2. **stdout/stderr:** FluidSynth пишет логи в stderr; `stdout` при `-F` пустой. Парсить нечего — просто капчить в лог.
3. **Пути Debian-пакетов** стандартны (`/usr/share/sounds/sf2|sf3/`) — glob-поиск по двум директориям покрывает все три зелёных bank.
4. **sf3 = сжатый sf2 (Ogg)** — FluidSynth грузит оба формата нативно, разницы в команде нет.
5. **Громкость:** `-g 0.4…0.8` — при 0.3 по умолчанию FluidR3/MuseScore_General тихие; LUFS самплинга проверить на первом же спайке (Self-Check сравнивает LUFS лупа и превью — рендер должен быть детерминирован: фиксируем `-r`, `-g`, reverb/chorus флаги в контракт превью).

---

## Источники (все проверены 2026-11-22)

- Debian copyright-файлы: извлечены из `fluidsynth`, `timgm6mb-soundfont`, `fluid-soundfont-gm`, `fluidr3mono-gm-soundfont` (dpkg-deb -x, локальная машина trixie)
- apt-метаданные: `apt-cache show` (trixie)
- [FluidSynth/fluidsynth](https://github.com/FluidSynth/fluidsynth) (GitHub API: LGPL-2.1, v2.6.2 2026-11-01, 2560★)
- [mrbumpy409/GeneralUser-GS](https://github.com/mrbumpy409/GeneralUser-GS) — `documentation/LICENSE.txt` прочитан дословно (License v2.0, 2317 B)
- [ScanCode LicenseDB: generaluser-gs-2.0](https://scancode-licensedb.aboutcode.org/generaluser-gs-2.0) (категория Permissive, LicenseRef-scancode-generaluser-gs-2.0)
- MuseScore_General лицензия: [Debian пакет musescore-general-soundfont-lossless](https://packages.debian.org/trixie/musescore-general-soundfont-lossless) + MuseScore Handbook «SoundFonts and SFZ files»
- Arachno: [Polyphone listing](https://www.polyphone.io/en/soundfonts/instrument-sets/255-arachno-soundfont) + MuseScore docs («courtesy of Maxime Abbey»)
- [sfztools/sfizz](https://github.com/sfztools/sfizz) (GitHub API: BSD-2-Clause, 529★, push 2025-03)
- ⚠ Полный текст FluidR3 COPYING из апстрим-тарболла не скачан (Debian copyright цитирует README автора) — при бандле в release-артефакт взять COPYING из `fluid-soundfont.tar.gz` и приложить как есть

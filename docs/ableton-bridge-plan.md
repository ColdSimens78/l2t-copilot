# План Ableton Bridge (Волна 2)

**Цель:** подключить возможности L2T (анализ, генерация, DAW-операции) к
Ableton Live через существующий open-source мост, не написав ни строчки
«своего» транспортного кода — философия экосистемы: форкнуть/подключить
готовое, свой код держать тонким адаптером.

## 0. Ключевой принцип: что вообще нужно мостить

Генераторы L2T **DAW-агностичны по построению** — они принимают пути и
пишут файлы (`.mid`/`.wav`) в workspace. Поэтому:

| Возможность | Нужен мост? | Почему |
|---|---|---|
| Loop X-Ray (audio-analyzer) | **Нет** | читает WAV с диска напрямую |
| midi-gen (все 3 инструмента) | **Нет** | пишет `.mid` файлы |
| Adopt Loop Settings (tempo/key в сессию) | **Да** | работа с Live Object Model |
| Импорт MIDI на дорожки | **Да** | создание MIDI-треков и клипов |
| Bounce/рендер | **Да, но с оговоркой** | см. риски ниже |
| Self-Check | **Нет** | анализ файла баунса |

Мост — это только «тело»: узкий набор DAW-операций поверх Live API.

## 1. Ландшафт OSS-мостов (результаты ресёрча)

| Проект | Архитектура | Примечания |
|---|---|---|
| [ahujasid/ableton-mcp](https://github.com/ahujasid/ableton-mcp) | MIDI Remote Script (socket-сервер внутри Live) + Python MCP-сервер | самый популярный; клиенты: Claude Desktop, Cursor |
| [nozomi-koborinai/ableton-osc-mcp](https://github.com/nozomi-koborinai/ableton-osc-mcp) | MCP-сервер поверх [AbletonOSC](https://github.com/josiahwolfoberholtzer/AbletonOSC) + свой remote-script-патч | OSC-подход |
| [uisato/ableton-mcp-extended](https://github.com/uisato/ableton-mcp-extended) | форк ableton-mcp с командами через официальный Live API | расширение |
| AbletonOSC (Josiah Wolf Oberholtzer) | OSC Remote Script для Live | общий субстрат нескольких проектов, зрелый API-сёрфейс |

**Лицензии:** в сообществах указывают MIT для ableton-mcp и AbletonOSC, но
**перед подключением проверить файл LICENSE в каждом репо** (P0 ниже) —
правило экосистемы: в наш MIT-контур не тянуть копролевый код; GPL-мост
допустимо использовать как отдельный процесс, но не копировать в репо.

## 2. Рекомендуемый путь

**Вариант A (основной):** подключить `ableton-mcp` как есть (второй
MCP-сервер) и написать поверх него наш **тонкий адаптер словаря шины**.
**Вариант B (если A окажется слишком «чат-ориентированным»):** взять
AbletonOSC как субстрат (OSC-протокол стабильнее) и обернуть в свой
MCP-сервер — это ~200 строк Python, а не «свой мост».

В обоих вариантах наш код — только `src/mcp_servers/ableton_bridge/` с
контрактом по образцу `DawBackend`-трейта dawmcp:

```
daw.get_session()     → состояние (треки, темп, клипы)
daw.set_tempo(bpm)    → Live Song.tempo
daw.adopt_loop(bpm, key) → set_tempo + запись key в name/маркер (см. риски)
daw.import_midi(path, at) → создать MIDI-трек + клип + ноты из файла
daw.render(path)      → см. риски
```

### Маппинг на Live Object Model

| Наш контракт (SoundCraft) | Ableton Live API |
|---|---|
| `event.tempo {bpm}` | `Song.tempo = bpm` |
| `file.import_midi {path}` | `Song.tracks.append(create_midi_track)` → `Track.create_midi_clip` → запись нот из mido-файла |
| `markers.add {name}` | name-конвенция клипа/сцены (key-signature объекта в API нет) |
| `inspect_session` | `Song` снапшот (tracks, tempo, clips) |
| `bounce_mix {path}` | ⚠️ см. риски |

## 3. Риски и митигации

1. **Рендер не скриптуется полноценно.** У Live нет командного экспорта
   аудио через Remote Script. Митигации: (a) live-запись мастербуса в клип
   через loopback (BlackHole/JACK на macOS/Linux, VB-Cable на Windows);
   (b) оставить экспорт пользователю (File → Export), Self-Check гонять по
   файлу, который указал человек; (c) принимать решение на спайке (P3).
2. **Версии Python в Remote Scripts.** Live 11/12 несут свой встроенный
   интерпретатор — проверить версию на целевых Live и не тащить
   зависимости в Remote Script (держать его stdio/OSC-тупым, умное —
   снаружи).
3. **Установка Remote Script per-OS.** Пути различаются
   (macOS: `~/Music/Ableton/User Library/Remote Scripts`, Windows:
   `%APPDATA%\Ableton\...\User Library\Remote Scripts`, Linux/Wine — свой
   кейс) — включить в docs установки.
4. **Тональность.** В Live API нет key-signature объекта — хранить в имени
   клипа/сцены (тот же workaround, что с маркерами SoundCraft) или в
   стороне через наш core/keys.
5. **Лицензия моста** — подтвердить до первого импорта кода.

## 4. Фазы

| Фаза | Содержание | Критерий готовности |
|---|---|---|
| **P0** | Лицензионный аудит ableton-mcp / AbletonOSC; выбор варианта A/B | LICENSE подтверждена, выбор записан |
| **P1** | Спайк: установить мост, Live отвечает на tempo get/set | «120.0 → 130.0 → 120.0» из агента |
| **P2** | Наш адаптер: `daw.get_session`, `daw.set_tempo`, `daw.import_midi` | наш `.mid` из midi-gen звучит в Live-сессии |
| **P3** | Рендер-стратегия: выбрать loopback / user-export; Self-Check | LUFS-кросс-чек двух серверов на Live-рендере |
| **P4** | Упаковка: `pip install -e '.[ableton]'`, docs, демо-сценарий | README Волны 2 обновлён |

Сроки: P0–P2 — один рабочий день агента после подтверждения лицензий;
P3 — половина дня (стратегия) + запас на loopback-квесты; P4 — час.

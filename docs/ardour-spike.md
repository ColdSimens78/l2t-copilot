# Спайк: Ardour как второй хост (Wave 2)

**Цель спайка:** доказать управление Ardour из нашего агента — Phase A
(транспорт + темп через OSC) в один вечер; Phase B (импорт MIDI) —
по результатам Phase A. Критерий успеха Phase A: **агент меняет BPM сессии
 Ardour и видит это в GUI**.

## Phase A — транспорт и темп через OSC (час)

### 1. Установка Ardour на Debian 13

```bash
sudo apt install ardour          # Ardour 8.x из репо Debian
# аудио: Debian 13 использует PipeWire — Ardour работает с ним из коробки
# первый запуск: жмёте Realtime-кнопку по желанию, создаёте сессию
ardour                           # создать тестовую сессию «l2t-spike»
```

### 2. Включить OSC

В Ardour: **Preferences → Control Surfaces → отметить OSC → кнопка Show
Protocol Settings**. Параметры по умолчанию: **UDP port 3819** — оставляем.
Осторожно: не назначайте порт 3819 другим контроллерам на этой же машине —
конфликт портов ломает всё (предупреждение из мануала Ardour). Отправка
confirmed-адресов: `/ardour/transport_play`, `/ardour/transport_stop`,
`/ardour/set_tempo` (BPM float). Полный список — раздел OSC мануала Ardour.

### 3. Тест из терминала (python-osc в нашем venv)

```bash
/home/ilmir/l2t-copilot/.venv/bin/pip install python-osc
/home/ilmir/l2t-copilot/.venv/bin/python - <<'EOF'
from pythonosc.udp_client import SimpleUDPClient
c = SimpleUDPClient("127.0.0.1", 3819)
c.send_message("/ardour/transport_play", [1])   # транспорт поехал?
c.send_message("/ardour/set_tempo", [90.0])     # BPM в GUI стал 90?
EOF
```

Если BPM в Ardour изменился — Phase A закрыта: control-plane второго хоста
доказан. Зафиксировать в этом файле: дату, версию Ardour, скриншот-факт.

### 4. Что подтверждено / что нет

| Проверка | Статус |
|---|---|
| transport play/stop | ✅ (2026-11-22, Ilmir) |
| set_tempo 60→90 через OSC | ✅ **BPM в Ardour стал 90.0** — второй хост подчинился шине |
| get-фидбек состояния (OSC feedback) | 🔲 |
| import MIDI через OSC | ❌ не существует → Phase B |
| export/render через OSC | ❌ вероятно нет (см. Phase B) |

## Phase B — MIDI внутрь Ardour: инструкция

**Прямой ответ:** «просто импортировать .mid» Ardour умеет **только вручную**
(Session → Import, или drag-drop файла на таймлайн — .mid он ест нативно,
вплоть до раскладки каналов по трекам). OSC-сёрфейс нот не передаёт, а
Lua-скрипты нельзя дёрнуть по OSC напрямую. Поэтому Phase B — три уровня:

### B.0 — сегодня, ноль кода (human-in-loop MVP)

1. Агент: `generate_bassline/chords/drums` → `.mid` в workspace
2. Вы: в Ardour **Session → Import** → выбрать файл(ы) → в диалоге
   импорта отметить «MIDI-файлы», назначение — новые треки
3. Агент: `set_tempo` через OSC (уже доказано) → Self-Check по баунсу

Один клик человеком на партию — честный MVP Wave 2, всё остальное
автоматизировано.

### B.1 — сделано: `core/midi_io.py`

`mido → notes JSON` (`{start, end, note, velocity, channel}` в тиках,
BPM только если файл темп несёт — контракт embed_tempo). Это ядро ЛЮБОГО
автоматического пути: Lua-мосту не нужен свой MIDI-парсер (в Lua его нет),
ноты конвертируем у себя и передаём JSON-ом. Тесты round-trip: 10/10.

```python
from core.midi_io import load_notes
load_notes("workspace/bass.mid")   # → notes[] для вставки в Ardour
```

### B.2 — автоматизация (спайк следующей сессии)

Найденная в Lua-API структура Ardour даёт механизм: **Session Script
выполняется каждый аудио-цикл** — это готовый polling-мост (тот же паттерн,
что наши wake-хуки):

1. Session Script (Session → Scripting) проверяет раз в N циклов файл
   `workspace/ardour_inbox.json` (команда: `import_midi` / `create_track`
   с notes[] из midi_io)
2. Команда исполняется через Lua-биндинги: `Session:new_midi_track {...}`
   существует (подтверждено форумом), `Editor:import_files` + ImportStatus
   существует для импорта файлов
3. **Открытый вопрос спайка:** доступен ли `Editor` из контекста
   session-script (или только из action-script) — проверить в Script
   Console: `typeof(Editor)`; если нет — вариант: Session-only путь
   (new_midi_track + вставка нот через LuaAPI.build_note) или action-script
   + шорткат
4. Рендер вне OSC: выбрать между GUI-export / CLI / loopback — не блокер,
   Self-Check работает по любому WAV

**Критерии B:** notes[] из midi_io превращаются в звучащий клип в
Ardour-сессии без ручного импорта.

## Критерии завершения спайка

- Phase A: transport + tempo из агента — ✅ **2026-11-22**
- Phase B: выбран канал, `.mid` от midi-gen звучит в Ardour-сессии 🔲
  (B.0 доступен уже сейчас, B.2 — следующая сессия)
- Решение: `src/mcp_servers/daw_ardour/` пишется или Wave 2 → REAPER
  (dawmcp уже готов — fallback без стыда)

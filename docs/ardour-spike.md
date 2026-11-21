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
| transport play/stop | 🔲 |
| set_tempo 60→90→60 | 🔲 |
| get-фидбек состояния (OSC feedback) | 🔲 |
| import MIDI через OSC | ❌ не существует (см. Phase B) |
| export/render через OSC | ❌ вероятно нет (см. Phase B) |

## Phase B — MIDI внутрь Ardour (по результатам Phase A)

OSC-сёрфейс Ardour не работает с нотами — два кандидата, решить на спайке:

1. **Lua-скриптинг Ardour** (Session → Scripting): скрипт внутри Ardour
   создаёт MIDI-трек и импортирует/создаёт клипы. Проверить в Lua-API:
   импорт MIDI-файла (`Session` bindings) и создание клипов с нотами.
   Если импорт файла есть — это наш путь, Python-адаптер дёргает скрипт.
2. **midi_io.py в нашем репо** (~40 строк: mido → notes JSON) — если Lua
   читать файл не умеет, конвертируем ourselves и вставляем ноты тем
   каналом, который найдём (Lua create_clip + note insertion).

**Связка с midi-gen:** переписывать midi-gen НЕ нужно — он DAW-агностичен
(файлы + пути). Поток: `generate_*` → `.mid` в workspace → Phase B-канал
импортирует в Ardour → `adopt_loop` через OSC (темп) → Self-Check. Правило
embed_tempo=True — только для standalone-файлов вне пайплайна.

**Рендер:** через OSC не скриптуется — варианты на спайке: GUI-export
(пользователь), либо CLI-экспорт Ardour, либо(loopback-запись). Не блокер
для адаптера: Self-Check работает по любому WAV.

## Критерии завершения спайка

- Phase A: transport + tempo из агента ✅/❌ (дата)
- Phase B: выбран канал, `.mid` от midi-gen звучит в Ardour-сессии ✅/❌
- Решение: `src/mcp_servers/daw_ardour/` пишется или Wave 2 → REAPER
  (dawmcp уже готов — fallback без стыда)

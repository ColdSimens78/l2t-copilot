# OSS-разведка №3: Telegram-доставка (PRD волна 1 — бот-фронт L2T)

**Статус:** ⛔ ОТКЛОНЕНО решением владельца (2026-11-23) — продукт = самостоятельное приложение, пользователь работает только внутри него (луп читается приложением напрямую, трек экспортируется напрямую). Документ сохранён как справка (качественная разведка aiogram/лимитов), в roadmap не входит.
**Автор:** OSS-разведка · **Дата:** 2026-11-22 · **Для:** мейнтейнер (ревью) · **Тема:** приём лупа → пайплайн → возврат баунса через tg-api-relay
**Методика:** лицензии — из LICENSE-файлов в репо (фактически); поведение aiogram 3.33.0 — из распакованного PyPI-wheel (то, что реально поставится); лимиты Bot API — из официальной доки [core.telegram.org/bots/api](https://core.telegram.org/bots/api) (Bot API 10.4, ноябрь 2026), проценты — дословные цитаты. Совместимость с релеем — по DEEP AUDIT из памяти (relay.py: asyncio HTTP/1.1, hosts-pinning api.telegram.org→127.0.0.1 → Caddy TLS (self-signed) → relay :8443 → CF Worker → api.telegram.org; long-poll клэмпнут до 25 с; воркер пропускает `(file/)?bot<token>/`; IPv4-first; UA-header из-за CF 1010).

## TL;DR — рекомендация

**Берём в v0: [aiogram](https://github.com/aiogram/aiogram) (🟢 MIT, v3.33.0 от 2026-11-19)** + long-polling через релей с `TelegramAPIServer.from_base("http://127.0.0.1:8443")` (если релей слушает plain HTTP — проверить на спайке; иначе ходить на hosts-pinned api.telegram.org и решать TLS через cafile). **python-telegram-bot отклонён: GPL-3.0 🔴** — линкуется в наш MIT-процесс, не внешние процессы.
Бот = тонкий фронт: луп ≤20 MB → workspace-inbox → анализ/генерация (наши CLI/MCP) → превью-WAV рендерится **FluidSynth-сайдкаром (разведка №2)** → MP3 → sendAudio + MIDI как document. Статусы — `sendChatAction` + **`sendMessageDraft`** (новое в Bot API 10.3+, готовый механизм нашего 3-уровневого AI-thinking UX в чате).

---

## 1. Фреймворки: aiogram vs python-telegram-bot

| Критерий | [aiogram](https://github.com/aiogram/aiogram) | [python-telegram-bot](https://github.com/python-telegram-bot/python-telegram-bot) |
|---|---|---|
| Лицензия (факт) | 🟢 **MIT** — LICENSE: «Copyright (c) 2017 Alex Root Junior. Permission is hereby granted…» | 🔴 **GPL-3.0** — LICENSE: «GNU GENERAL PUBLIC LICENSE Version 3…» |
| ★ / релизы | 5948★, **v3.33.0 (2026-11-19)**, push 2026-11-22 | 29614★, v22.8 (2026-06-12) — реже релизы |
| Асинхронность | asyncio-native (aiohttp), Pydantic v2-типизация API-объектов | async (с v20),sync API объявлен устаревшим; свой httpx-слой |
| Кастомный API-сервер | **Да, фактическая проверка из wheel 3.33.0**: `BaseSession.__init__(api: TelegramAPIServer = PRODUCTION, …)`; `TelegramAPIServer.from_base(base)` генерирует `{base}/bot{token}/{method}` + `{base}/file/bot{token}/{path}`; подключение: `Bot(token, session=AiohttpSession(api=TelegramAPIServer.from_base("http://127.0.0.1:8443")))` | Да: `Bot(token, base_url="…")` — документирован для Local Bot API Server, **но лицензия красная** |
| Long-polling | getUpdates с `timeout` параметром API; polling через `Dispatcher.start_polling` | аналогично |
| Пригодность для агентного пайплайна | HTTP-объекты = Pydantic-модели → прямой мост в наш bus-контракт (JSON-в-JSN); handlers декоративно-плоские, легко вызывать CLI/MCP-инструменты | хорош, но GPL-гейт решает |
| Риск | Обновления активные (3.x серия каждые ~2 недели) — pin-версию в requirements; приватный `_connector_init` для TLS-хака (ниже) — фикс-версия обязательна | GPL-3: наш код линкует GPL-библиотеку → производная обязанность; против правила «GPL = только внешние процессы» |

**Вердикт:** aiogram — единственный из пары, совместимый с MIT-репо. Комьюнити меньше PTB (6k против 30k★), но для нашего кейса (private chat, polling, файлы) оба избыточны — берём aiogram и pin-уем `aiogram==3.33.*`.

---

## 2. Лимиты Bot API (дословно из официальной доки, Bot API 10.4)

| Операция | Лимит / формат | Цитата |
|---|---|---|
| **getFile (скачивание лупа)** | **≤20 MB** | «For the moment, bots can download files of up to 20MB in size» / «The maximum file size to download is 20 MB» |
| Ссылка на скачивание | `https://api.telegram.org/file/bot<token>/<file_path>`, валидна **≥1 час**, потом новый getFile | «It is guaranteed that the link will be valid for at least 1 hour» |
| **sendAudio (баунс)** | **.MP3 или .M4A**, **≤50 MB** | «Your audio must be in the .MP3 or .M4A format… Bots can currently send audio files of up to 50 MB» |
| **sendVoice** | .OGG/OPUS **или .MP3/.M4A**, ≤50 MB | «your audio must be in an .OGG file encoded with OPUS, or in .MP3 format, or in .M4A format» |
| multipart-upload (наши sendAudio) | ≤50 MB (фото ≤10 MB) | «Post the file using multipart/form-data… 10 MB max size for photos, 50 MB for other files» |
| отправка по URL | ≤20 MB (не наш кейс) | «5 MB max size for photos and 20 MB max for other types of content» |
| по file_id (повторная отправка) | без лимитов | «There are no limits for files sent this way» |
| getUpdates | `timeout` (default 0 = short polling; должен быть положительным), updates хранятся **≤24 ч**, offset-подтверждение | «Timeout in seconds for long polling… updates will not be kept longer than 24 hours» |
| **Local Bot API Server** (апстрим telegram-bot-api, GPL-2 — сам по себе процесс, не библиотека) | download **без лимита**, upload до **2000 MB**, getFile возвращает **абсолютный локальный путь** (повторное скачивание не нужно) | «Download files without a size limit… Upload files up to 2000 MB… Receive the absolute local path as a value of the file_path» |
| **sendMessageDraft** (новое, 10.3–10.4) | стриминг частичного текста в чат, «Thinking…»-плейсхолдер (пустой text), кнопка Stop (`can_stop`), ephemeral 30-с, потом обязателен sendMessage | «stream a partial message to a user while the message is being generated… Pass an empty text to show a "Thinking…" placeholder» |
| sendChatAction | «typing» / «upload_voice» / «upload_document» — статус на 5 с | «The status is set for 5 seconds or less» |
| deleteMessage | ≤48 ч после отправки | — |

**Вытекает для пайплайна:** луп пользователя ≤20 MB (30-с mp3@320k ≈ 1.2 MB, m4a ≈ 0.6 MB — запас огромный; WAV-исходник >20 MB попросить как документ и локально перекодировать). Баунс: наш WAV (30 с/44.1k ≈ 5.3 MB) **конвертируем в MP3** (sendAudio формально не заявляет OGG; MP3 гарантирован) — ffmpeg как внешний процесс (apt; лицензия комбинация GPL/LGPL, но процесс, не линковка). Полный WYSIWYG-баунс SoundCraft >50 MB — только через Local Bot API Server (2000 MB) или разделение на stem'ы; в v0 баунс = превью FluidSynth (см. разведку №2), не финальный микс.

---

## 3. Совместимость с tg-api-relay (факты + чек-лист спайка)

| Фактор | Совместимость | Детали |
|---|---|---|
| **base URL** | ✅ полный контроль | `TelegramAPIServer.from_base()` — фактически в wheel; дефолтный PRODUCTION (`api.telegram.org`) тоже работает из-за hosts-pinning: путь остаётся `…/bot<token>/<method>` — воркер-regex `(file/)?bot<token>/` совпадает и для методов, и для скачивания файлов |
| **TLS (self-signed Caddy)** | ⚠️ главный подводный камень | aiogram создаёт `ssl.create_default_context(cafile=certifi.where())` — certifi-бандл, системный store НЕ читает → self-signed cert Caddy для api.telegram.org будет отвергнут. Пути: **(а) предпочтительно** — идти на `http://127.0.0.1:8443` напрямую (релей = plain HTTP/1.1-сервер, TLS — только Caddy-layer; DEEP AUDIT: «optional own TLS»); **(б)** cafile-хак: `session._connector_init["ssl"] = ssl.create_default_context(cafile="/path/caddy-root.pem")` — **приватный атрибут**, pin aiogram-версию; **(в)** подкласс AiohttpSession, переопределяющий create_session. Пункт (а) проверить первым на спайке |
| **Клэмп long-poll 25 с** | ✅ не ломает | getUpdates с `timeout=20` (< клэмпа): релей просто ответит не позже 25 с — протокол честный. Критично лишь, чтобы HTTP-таймаут клиента **> 25 с** (aiogram `BaseSession(timeout=…)` default — проверить, выставить 30–40 с явно) |
| **IPv4-first** | ✅ | релей сам патчит getaddrinfo; клиент ходит на 127.0.0.1 (или резолвит hosts-пин в 127.0.0.1) — IPv6 не участвует |
| **CF 1010 (UA)** | ✅ | aiogram шлёт свой User-Agent (`… aiogram/3.33.0`), не python-urllib; плюс релей добавляет UA к upstream-запросам |
| **Retries** | ⚠️ наша дисциплина | релей ретраит только connect-failures (no duplicate sendMessage); на клиенте — наш урок timeout≠failure: после таймаута **сверить состояние** (getUpdates offset) перед повтором, никаких слепых ретраев отправки |
| **getFile-ссылка** | ✅ | URL `…/file/bot<token>/<path>` идёт через тот же релей/воркер (regex разрешает `file/`) — скачивание лупа работает без байпаса |
| **Webhook** | ❌ не наш вариант | relay-стек не завершает входящий TLS снаружи (CF→Caddy для исходящих); polling = выбор по умолчанию, webhook в v0 не поднимаем |

---

## 4. Мини-архитектура бот-фронта L2T (v0-срез волны 1)

```
[Telegram-клиент Ilmir]
   ⇅ HTTPS
[api.telegram.org]  ⇄  [CF Worker tg-bridge]  ⇄  [relay.py :8443]  ⇄  [Caddy :443, self-signed]
   (hosts: api.telegram.org → 127.0.0.1 на хосте)
   ⇅ long-poll (getUpdates timeout=20) + sendAudio/sendMessageDraft
[l2t-telegram-bot]  (aiogram, python, systemd --user unit)
   ⇅ файлы (workspace = точка обмена на шине; правило проекта)
[~/music-workspace/inbox/<ts>/loop.(mp3|ogg|m4a|wav)]
   ⇅ ffmpeg (процесс) → loop.wav 44.1k
[v0-пайплайн] audio-analyzer CLI (X-Ray: bpm/key/conf) → l2t-midi-gen CLI (3 генератора) → fluidsynth-сайдкар (превью .mid→.wav, разведка №2) → ffmpeg → .mp3
   ⇅
[бот] sendAudio(mp3, title="L2T preview", performer="midi-gen v3") + sendDocument(басслайн.mid) + sendMessageDraft для прогресса
```

- **Живёт:** systemd --user (`l2t-bot.service`, `Restart=on-failure`), рядом с релеем — та же машина, hosts/Caddy уже настроены; паттерн systemd units уже практикуется в qwen-stack.
- **Состояние бота:** минимальное (chat_id → активная job); пайплайн — subprocess с таймаутом (уроки timeout≠failure: после таймаута проверить артефакты, не ретраить вслепую).
- **UX-маппинг на USER FLOW:** дроп лупа = Screen 0 «Разбудить движок» через Telegram (уже упомянут в USER FLOW v1); X-Ray-плашка = текст «Loop: 90 BPM · A minor (conf .91)»; 3 генератора = 3 превью-трека одним сообщением или inline-кнопками; Self-Check-светофор = текст после баунса.
- **Превью ≠ WYSIWYG:** v0 возвращает превью FluidSynth (детерминированное, быстрое); финальный SoundCraft-микс — v1, требует пробуждённого engine (open_editor-жизненный цикл) и Local Bot API Server для >50 MB.
- **Приватность:** бот private-chat-only (ilmir как единственный пользователь), токен бота в env, никакого публичного ingress — релей остаётся единственным наружным каналом.

---

## 5. Конкурентный патруль (с отчёта №1, 2026-11-22)

| Проект | Динамика за сутки | Что значит |
|---|---|---|
| [synkopa](https://github.com/miskibin/synkopa) (🔴AGPL, Tauri-DAW + AI-CLI) | **v0.9.31 (2026-11-21)** — релиз почти каждый день, «Pre-release review fixes and complete CHANGELOG»; 130★ | Соло-дев темпом повторяет наш ранний темп MVP; конкурентов давления пока нет (звёзды стоят), но канал их CLI — «редактирует открытый проект с undo-историей» — это то, что мы делаем через MCP-шину у SoundCraft. Читаем их CHANGELOG раз в спринт |
| [MAGDA](https://github.com/Conceptual-Machines/magda-core) (🔴GPL-3, C++23 JUCE AI-DAW) | **v1.0.0-beta.2 (2026-11-07)** — вошёл в беты 1.0 (v0.20 → 1.0-beta за месяц); коммиты сегодня: «Remote API reads filter the device catalogue and parameter lists, and **magda-cli**…», «Remote API writes can answer in short form, and **batch.apply** builds content…», «Double-clicking a track header opens the Track Chain panel»; 266★ | ⚠ **Главный сигнал патруля:** MAGDA строит **Remote API + magda-cli + batch.apply** — то есть внешний программный доступ к DAW = прямое сближение с нашим «UI/агент управляет DAW через контракт». Их DSL/batch-модель — конкурент нашему DawBackend/MCP-контракту. Следить: если magda-cli обрастёт note-level операциями, их CLI станет и «агентным хостом» — надо будет обновить таблицу конкурентов в PRD (их AI chat + Remote API = «hears nothing» всё ещё, но «agent-driven» они наращивают) |
| [openDAW](https://github.com/andremichelle/openDAW) (🔴AGPL, web-DAW) | push 2026-11-21, 2479★ (+1); GitHub Releases не обновляются (npm-теги сентябрь) | Ровный темп, «never generate your music» — позиционирование-анти-теза остаётся; для патруля раз в спринт достаточно |

---

## 6. Рекомендации «берём в v0»

1. **aiogram==3.33.* (🟢 MIT)** — фреймворк бота; pin-версия (активные релизы + приватный TLS-хак).
2. **Long-polling через релей**, `TelegramAPIServer.from_base("http://127.0.0.1:8443")` — спайк-чеклист: (а) релей отвечает plain HTTP на 8443? (б) getUpdates timeout=20 проходит клэмп? (в) скачивание `file/…` через релей? (г) sendAudio 5 MB сквозь CF Worker проходит?
3. **MP3-конверт ffmpeg** для sendAudio (процесс, не библиотека); луп-приём: mp3/m4a/ogg ≤20 MB → ffmpeg → WAV.
4. **sendMessageDraft для прогресса** (Bot API 10.3+): «Thinking…» → частичный текст «X-Ray: 90 BPM, A minor (conf 0.91)…» → sendMessage финалом — 1:1 наш AI-thinking UX в чат-канале.
5. **Не брать:** python-telegram-bot (GPL-3 🔴), webhook-режим (не совместим со стеком релея), Local Bot API Server (только опция v1 для >50 MB баунсов).
6. **Спайк-владелец:** сам бот ~150–200 строк Python (handlers + subprocess-пайплайн) — после ревью этой доки поставить в очередь задач мейнтейнеру (не сам: правило «новых задач не начинать»).

## Источники (все проверены 2026-11-22)

- [Telegram Bot API (официальная)](https://core.telegram.org/bots/api) — Bot API 10.4, ноябрь 2026; лимиты getFile/sendAudio/sendVoice/sendMessageDraft/Local Bot API Server процитированы дословно
- [aiogram/aiogram](https://github.com/aiogram/aiogram) (GitHub API: MIT, v3.33.0) + LICENSE из репо; поведение `TelegramAPIServer`/`AiohttpSession._connector_init` — из распакованного wheel `aiogram-3.33.0-py3-none-any.whl` (PyPI)
- [python-telegram-bot](https://github.com/python-telegram-bot/python-telegram-bot) (GitHub API: GPL-3.0) + LICENSE из репо
- DEEP AUDIT tg-api-relay (раздел памяти ai-music-ecosystem): relay.py механика, клэмп 25 с, воркер-regex `(file/)?bot<token>/`, IPv4-first, UA/CF 1010
- Конкурентный патруль: GitHub API releases/commits (2026-11-22): synkopa v0.9.31; MAGDA v1.0.0-beta.2 + commits «Remote API… magda-cli», «batch.apply»; openDAW push 2026-11-21

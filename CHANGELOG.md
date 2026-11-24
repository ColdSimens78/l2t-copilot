# CHANGELOG

Все заметные изменения L2T Copilot документируются в этом файле.
Формат: [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/),
версионирование — [SemVer](https://semver.org/lang/ru/).

## [Unreleased]

### Added
- **Mastering Targets v0** — `export_track` с целью громкости (`spotify` −14 /
  `apple` −16 LUFS): экспорт микса в WAV, peak-normalize движком до −0.1 dBFS,
  повторный замер analyzer и честный отчёт о дистанции до цели
  (`achieved_lufs`, `delta`, `verdict`); контракт IPC v0.2.1.

### Planned (этап 3)
- Экраны S0–S7 на реальном IPC (адаптер tauri), панель Acceptance Rate (C7),
  SoundCraft-клиент: adopt_loop / настоящий get_bus_state (BusState DAW-сессии),
  Telegram-доставка (волна 1).

## [0.1.0] — 2026-11-22

MVP-милстоун: полный контур «анализ лупа → генерация партий → DAW →
рендер → Self-Check» верифицирован end-to-end; кокпит подключён к
standalone-движку из webview.

### Added
- **midi-gen MCP-сервер** (`src/mcp_servers/midi_gen`): `generate_bassline`
  (5 рукописных стилей: basic/octaves/syncopated/walking/sub),
  `generate_chord_progression` (minor i-VI-III-VII / major I-V-vi-IV,
  voiceled-голосоведение: движение голосов 4 против 7 у block),
  `generate_drum_pattern` (kick/snare/hat + вариации-филлы на 4-м такте);
  детерминированный вывод, контракт `embed_tempo=False` (сессия — источник
  истины темпа).
- **qwen_bridge MCP-сервер** (`src/mcp_servers/qwen_bridge`): слот «Мозг» —
  brain.chat/memory_search/forget/personas/vision_analyze поверх локального
  LLM-стека (OpenAI-совместимый :5000), bounded-ошибки, мок-тесты.
- **l2t-core** (`crates/l2t-core`): Rust-ядро — MCP-клиенты (rmcp 3.11 +
  tokio), типизированные фасады (analyze_loop-композит с обходом sections-
  паники апстрима), staging/manifest (инструментация Acceptance Rate),
  render_preview (fluidsynth-сайдкар + авто-детект soundfont), engine slot
  (SoundCraft standalone).
- **Кокпит** (`ui/`): Tauri v2 + React — CockpitApi (mock/tauri адаптеры),
  призрачные ноты (ghost piano roll), TopBar/AI Dock/toasts, S0–S7-каркас.
- **Контракт фронт↔ядро** (`docs/ipc-contract.md` v0.2): команды/события/
  данные; зазоры C1–C6 закрыты, T1 — v1.
- **core**: `keys.py` (relative-key equivalence для Self-Check),
  `midi_io.py` (единый формат нот {note, start, end, velocity, channel}).
- **Разведки** (`docs/oss-recon-*.md`): UI-библиотеки (audio-ui copy-in),
  движки (SoundCraft standalone — единственный permissive кандидат;
  рынок проверен), soundfonts (MuseScore_General/FluidR3 MIT), Telegram
  (aiogram MIT / python-telegram-bot GPL-3.0 — не брать), upstream-watch.
- **Спеки**: `ui-screens-v0.md` (S0–S7 + матрица «кнопка→контракт»),
  `ui-acceptance-rate-v0.md`, `ui-architecture-proposal.md` v0.4 («Кокпит
  над шиной»), `dawbackend-spec.md`, DECISION.md (форк-триггеры).
- **CI** (`.github/workflows/ci.yml`): pytest + cargo test на каждый push.
- **examples/**: 5 CC0-лупов + 1 MIDI (лицензии проверены по страницам OGA,
  BPM/тональность проставлены анализатором).
- **DEPENDENCIES.md**: лицензионный манифест (39 Py + 118 Rust крейтов,
  0 копилефт).

### Fixed
- **isError-текст на mcp SDK 2.x**: произвольные исключения теряли текст —
  `_bounded`-обёртка через `ToolError` (`mcp.server.mcpserver.exceptions`).
- **embed_tempo-контракт**: генераторы не вшивают set_tempo по умолчанию —
  импорт MIDI больше не перезаписывает темп-карту сессии молча (upstream
  issue storytold/soundcraft#1702, opt-in-часть).
- **Фантомные NoteOn-события** убраны из вывода генератора (пауза вместо
  фантома).

### Known issues
- audio-analyzer-rs: `full_analysis` паникует в sections-анализе на коротких
  файлах (upstream issue JuzzyDee/audio-analyzer-rs#3; обход — композит
  саб-тулов в ядре). Апстрим неактивен 8+ мес — бинари пинсятся.
- SoundCraft-плагин (ZCode) не содержит CLI-стека — кокпит использует
  standalone v0.20.1 (обе версии не смешиваются: правило один-движок-на-сессию).

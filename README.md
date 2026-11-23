# L2T Copilot — Loop-to-Track Copilot

[![CI](https://github.com/ColdSimens78/l2t-copilot/actions/workflows/ci.yml/badge.svg)](https://github.com/ColdSimens78/l2t-copilot/actions/workflows/ci.yml)

**AI-нативный кокпит для музыканта: десктоп-приложение, которое превращает
найденный аудио-луп в законченный, полностью редактируемый трек.**

> **Боль:** вы нашли классный луп, но не знаете его BPM и тональность, а час
> на подбор баса, аккордов и бита убивает вдохновение.
> **Ответ:** L2T слышит луп (BPM, тональность, LUFS, спектр), генерирует
> гармонически совместимые партии — бас, аккорды, ударные — показывает их
> **«призрачными нотами»** в Piano Roll и раскладывает по DAW одной кнопкой.
> Всё остаётся редактируемым MIDI — вы владеете каждой нотой (не «чёрный
> ящик» вроде генеративного аудио и не закрытые библиотеки аккордов).

## Статус: этап 2 закрыт — полный контур работает

Десктоп-окно (Tauri) → Rust-ядро → живой SoundCraft standalone (headless
MCP): анализ лупа → генерация партий → превью (fluidsynth-сайдкар) →
accept → импорт в сессию → bounce → Self-Check. Дорожка пройдена
end-to-end и верифицирована (см. `docs/engine-spike-report.md`).

## Архитектура: «Кокпит над шиной»

**UI = проекция MCP-шины.** Кнопка = MCP-инструмент; у кокпита нет скрытой
логики. Контрол-плейн (решения) отделён от дата-плейна (сэмплы ходят
файлами через workspace, по MCP — только пути).

```
┌────────────── L2T Cockpit (Tauri v2 + React, десктоп-окно) ─────────────┐
│  Loop X-Ray · Стейджинг с «призрачными нотами» · Self-Check · AI Dock   │
│  Rust-ядро (Tauri main) — единственный владелец MCP-клиентов (stdio),   │
│  staging/manifest.json = инструментация метрики Acceptance Rate         │
└──────────┬──────────────────────┬──────────────────────┬────────────────┘
           │ stdio                │ stdio                │ stdio
           ▼                      ▼                      ▼
   ┌───────────────┐   ┌───────────────────┐   ┌──────────────────────────┐
   │ audio-analyzer│   │ midi-gen          │   │ SoundCraft engine        │
   │ «уши» (Rust)  │   │ «руки» (Python)   │   │ standalone CLI/MCP       │
   │ BPM, тональ-  │   │ бас/аккорды/бит   │   │ (v0.20.1 headless)       │
   │ ность, LUFS,  │   │ в тональности     │   │ сессия, темп-карта,      │
   │ спектр        │   │ лупа, voice-led   │   │ импорт MIDI, bounce,     │
   │               │   │                   │   │ undo, встроенные синты   │
   └───────────────┘   └───────────────────┘   └──────────────────────────┘
                        + qwen_bridge («Мозг»: локальный LLM, этап 4)
```

**SoundCraft остаётся движком, редактором нот и микшером** — кокпит готовит
и предлагает, хост звучит и хранит. Никаких фейдеров в кокпите: до accept
партия существует только в UI-слое и workspace, после accept — материа-
лизуется дорожкой DAW (правило anti-dual-source, `docs/ipc-contract.md`).

## Ключевые механизмы

- **Призрачные ноты = контракт данных**: `suggestion = {notes[] (формат
  midi_io), rationale, confidence, source_tool, params, status}`. Accept/
  reject логируется в manifest → **метрика Acceptance Rate** (доля партий,
  которые вы оставили) считается с первого дня, локально, без облака.
- **Regenerate = видимый diff параметров** (`style: basic → syncopated`)
  — регенерация от «ИИ-магии» превратилась в управляемую глубину.
- **Self-Check = светофор доверия**: тональность (с relative-key
  эквивалентностью A minor ≡ C major), темп (×2-гипотезы рядом), LUFS-дельта
  до стриминговой цели, Δ полос «что добавили слои» против плана X-Ray.

## Структура репозитория

```
crates/l2t-core/       Rust-ядро: MCP-клиенты (rmcp+tokio), типизированные
                       IPC-фасады, staging/manifest, contract.rs, preview
ui/                    Tauri v2 + React кокпит: CockpitApi, mock/tairi-адаптеры,
                       ghost-piano-roll, панели (S0–S7 по спеке)
src/mcp_servers/       MCP-серверы: midi_gen (генерация партий),
                       qwen_bridge («Мозг»: локальный LLM qwen-stack)
src/core/              общие контракты: keys (relative-key), midi_io
tests/                 pytest: контракты генерации и midi_io (20 тестов)
docs/                  PRD, спецификации, разведки, спайк-отчёты
examples/              CC0-лупы для demo/e2e (лицензии проверены)
DECISION.md            архитектурные решения и триггеры форка
DEPENDENCIES.md        лицензионный манифест зависимостей (39 Py + 118 crates)
```

## Быстрый старт

Требования и детали окружения: [`docs/frontend-env-setup.md`](docs/frontend-env-setup.md)
(Debian 13: build-essential, webkit2gtk-4.1-dev, pkg-config, rustup, nvm+Node,
pnpm) и [`docs/frontend-env-setup.md §3`](docs/frontend-env-setup.md).

### 1. Python-пакет (midi-gen + qwen_bridge)

```bash
git clone https://github.com/ColdSimens78/l2t-copilot.git && cd l2t-copilot
python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
.venv/bin/pytest tests/                       # 20 контрактов генерации
.venv/bin/l2t-midi-gen --cli 90 "E minor" /tmp/b.mid   # CLI без MCP
```

### 2. Rust: ядро и кокпит

```bash
. ~/.cargo/env
cargo test -p l2t-core                        # ядро: bus/facade/preview
cd ui && pnpm install && pnpm dev --port 5199 # фронт (hot-reload)
cd ui/src-tauri && cargo build && ./target/debug/l2t-cockpit  # окно
```

### 3. Rust-анализатор (audio-analyzer) — готовый бинарь

```bash
# release: https://github.com/JuzzyDee/audio-analyzer-rs/releases
mkdir -p ~/bin && tar xzf audio-analyzer-*.tar.gz -C ~/bin && chmod +x ~/bin/mcp-server
```

### 4. SoundCraft standalone — движок

```bash
# release v0.20.1+: https://github.com/storytold/soundcraft/releases
dpkg-deb -x soundcraft-0.20.1-linux-x86_64.deb ~/soundcraft && \
  cp ~/soundcraft/usr/bin/soundcraft* ~/bin/        # паттерн audio-analyzer
soundcraft-cli --version                             # 0.20.1
```

### 5. MCP-конфиг клиента (для агентного режима)

`~/.zcode/cli/config.json` (Claude Desktop / Cursor — аналогично `mcpServers`):

```json
{
  "mcp": {
    "servers": {
      "audio-analyzer": {"type": "stdio", "command": "/home/ВЫ/bin/mcp-server", "timeoutMs": 30000},
      "midi-gen": {"type": "stdio", "command": "/home/ВЫ/l2t-copilot/.venv/bin/l2t-midi-gen", "timeoutMs": 30000},
      "qwen-brain": {"type": "stdio", "command": "/home/ВЫ/l2t-copilot/.venv/bin/l2t-qwen-brain", "timeoutMs": 30000}
    }
  }
}
```

Правила конфига: **абсолютные** пути, без `${...}`-шаблонов, строгая схема
(лишний ключ = сервер молча выбрасывается).

## Контракт шины (7 правил — выжаты из реальных инцидентов)

1. **Workspace — граница песочницы**: `import_*` читают только из workspace,
   баунсы пишутся туда же (у SoundCraft — `--automation-*-root`).
2. **`timeoutMs` на каждый вызов; таймаут ≠ отказ** — после таймаута ядро
   само делает `inspect` и отдаёт вердикт, никакого молчаливого ретрая.
3. **Паника в хендлере → JSON-RPC error** с текстом (на SDK 2.x — только
   через `ToolError`), никогда — молчаливое зависание.
4. **Сессия — источник истины**: генераторы не вшивают `set_tempo`
   (`embed_tempo=False`); хост применяет настройки лупа только по явному
   opt-in пользователя.
5. **Lifecycle движка**: wake-паттерн (поднять → подождать → retry) для
   GUI-хостов; headless-CLI стартует за 0.15 с.
6. **Дублирование клипов экспоненциально** («duplicate selection»):
   N копий = `ceil(log2 N)` вызовов.
7. **Self-Check принимает relative-key equivalence** (A minor ≡ C major,
   правило в `core.keys.keys_match`) и перепроверяет тональность ПОСЛЕ
   завершения аранжировки.

## Документация

- [docs/prd-l2t-v0.2.md](docs/prd-l2t-v0.2.md) — PRD: видение, аудитория (волны), метрика Acceptance Rate
- [docs/ipc-contract.md](docs/ipc-contract.md) — контракт фронт↔ядро v0.2 (единый источник типов)
- [docs/ui-screens-v0.md](docs/ui-screens-v0.md) — поэкранная интеракция-спека
- [docs/ui-architecture-proposal.md](docs/ui-architecture-proposal.md) — «Кокпит над шиной» v0.4
- [docs/oss-recon-engines.md](docs/oss-recon-engines.md) — выбор движка ( SoundCraft standalone vs рынок)
- [docs/oss-recon-ui.md](docs/oss-recon-ui.md) / [docs/oss-recon-soundfonts.md](docs/oss-recon-soundfonts.md) / [docs/oss-recon-telegram.md](docs/oss-recon-telegram.md) — OSS-разведки
- [DECISION.md](DECISION.md) — форк-триггеры и история решений · [DEPENDENCIES.md](DEPENDENCIES.md) — лицензионный манифест

## Roadmap

- ✅ **Этап 1** — ядро (l2t-core: bus/facade/preview, 9 cargo-тестов), WebKitGTK-спайк **GO**, UI-скаффолд + ghost notes (моки), CI
- ✅ **Этап 2** — production connect: engine slot, adopt_loop, настоящий get_bus_state, staging manifest, accept через движок, e2e из webview
- 🔨 **Этап 3** — экраны S0–S7 на реальном IPC, SoundCraft-клиент (adopt_loop/get_bus_state), панель Acceptance Rate, экспорт трека из кокпита
- ⏳ **Этап 4** — «Мозг»: автопилот через qwen_bridge, стоп-кран, лимиты

## Лицензия

MIT — см. [LICENSE](LICENSE). Обязательства по зависимостям: [DEPENDENCIES.md](DEPENDENCIES.md).

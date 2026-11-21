# L2T Copilot — Loop-to-Track Copilot

**Открытая MCP-экосистема, которая превращает найденный аудио-луп в законченный, полностью редактируемый трек.**

> **Боль:** вы нашли классный луп, но не знаете его BPM и тональность, а час
> на подбор баса, аккордов и бита убивает вдохновение.
> **Ответ:** L2T слышит луп, генерирует гармонически совместимые партии,
> раскладывает их по DAW и сам проверяет результат. Всё остаётся
> редактируемым MIDI — вы владеете каждой нотой (не «чёрный ящик» вроде
> генеративного аудио и не закрытые библиотеки аккордов).

## Архитектура

Контрол-плейн (решения) отделён от дата-плейна (сэмплы). Агент командует,
данные ходят файлами через workspace, по MCP передаются только пути.

```
        ┌───────────────────── Агент (ZCode / Claude / Cursor) ─────────────────────┐
        │        оркестрация: анализ → генерация → DAW → рендер → Self-Check        │
        └──────────┬──────────────────────┬───────────────────────┬──────────────────┘
                   │ MCP stdio            │ MCP stdio             │ MCP / plugin
                   ▼                      ▼                       ▼
          ┌────────────────┐    ┌──────────────────┐    ┌──────────────────────┐
          │ audio-analyzer │    │ midi-gen         │    │ SoundCraft DAW       │
          │ «уши» (Rust)   │    │ «руки» (Python)  │    │ «тело» (Rust DAW)    │
          │ BPM, тональ-   │    │ бас / аккорды /  │    │ сессия, темп-карта,  │
          │ ность, LUFS,   │    │ ударные в тонал. │    │ импорт MIDI, баунс   │
          │ спектр, секции │    │ лупа, голосовед. │    │ (Ableton — Волна 2)  │
          └───────┬────────┘    └────────┬─────────┘    └──────────┬───────────┘
                  │                      │                         │
                  └──────────────────────┴─────────────────────────┘
                       Data plane: файлы в workspace (WAV / MIDI / JSON)
```

| Компонент | Стек | Откуда |
|---|---|---|
| audio-analyzer | Rust (Symphonia, RustFFT, rmcp) | внешний бинарь [JuzzyDee/audio-analyzer-rs](https://github.com/JuzzyDee/audio-analyzer-rs), MIT |
| midi-gen | Python (mido + MCP SDK) | этот репозиторий, `src/mcp_servers/midi_gen` |
| DAW-хост | Rust DAW | ZCode-плагин [storytold/soundcraft](https://github.com/storytold/soundcraft) (MIT/Apache-2.0) |

## Быстрый старт

### 1. Python-пакет (midi-gen)

```bash
git clone https://github.com/ColdSimens78/l2t-copilot.git
cd l2t-copilot
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/pytest tests/          # смоук-тесты контракта
```

### 2. Rust-анализатор (audio-analyzer)

Скачайте готовый релиз — собирать Rust не нужно:

```bash
# со страницы https://github.com/JuzzyDee/audio-analyzer-rs/releases
# скачайте audio-analyzer-x86_64-unknown-linux-gnu.tar.gz и распакуйте:
mkdir -p ~/bin && tar xzf audio-analyzer-*.tar.gz -C ~/bin
chmod +x ~/bin/mcp-server ~/bin/cli
~/bin/cli /path/to/loop.wav      # проверка CLI
```

### 3. MCP-конфиг клиента

`~/.zcode/cli/config.json` (в Claude Desktop / Cursor — аналогичный блок `mcpServers`):

```json
{
  "mcp": {
    "servers": {
      "audio-analyzer": {
        "type": "stdio",
        "command": "/home/ВЫ/bin/mcp-server",
        "args": [],
        "timeoutMs": 30000
      },
      "midi-gen": {
        "type": "stdio",
        "command": "/home/ВЫ/l2t-copilot/.venv/bin/l2t-midi-gen",
        "args": [],
        "timeoutMs": 30000
      }
    }
  }
}
```

Правила конфига (нарушение = сервер молча не поднимется): **абсолютные**
пути, никакого `${...}`-шаблонизатора в конфиг-файлах, строгая схема —
только `type/command/args/env/timeoutMs/enabled`.

### 4. Проверка

Перезапустите клиент → Settings → MCP → оба сервера `connected` →
инструменты `mcp__audio-analyzer__*` и `mcp__midi-gen__*` доступны агенту.

## Пример сценария (промпт агенту)

```
Проанализируй examples/loop.wav: BPM и тональность. Создай DAW-сессию с этим
темпом, сгенерируй бас (style=syncopated), аккорды (voicing=voiceled, bars=4)
и ударные (variation=true, bars=8) в тональности лупа, импортируй всё в
сессию, сделай bounce и прогони через compare с исходником.
```

## Контракт шины (7 правил)

Правила выжаты из реальных инцидентов — соблюдайте их в своих модулях:

1. **Workspace — граница песочницы**: `import_*`-команды DAW читают файлы
   только из workspace; баунсы пишутся туда же.
2. **`timeoutMs` на каждый сервер; таймаут ≠ отказ** — после таймаута сначала
   `inspect` состояния, потом решать про ретрай.
3. **Паника в хендлере → JSON-RPC error**, никогда не молчаливое зависание;
   чужие серверы закрываются таймаутом.
4. **Сессия — источник истины** для темпа/тональности: генераторы не вшивают
   `set_tempo` по умолчанию (`embed_tempo=False`).
5. **Lifecycle DAW-движка**: поднять редактор → подождать загрузку → retry.
6. **Дублирование клипов экспоненциально** («duplicate selection»): N копий =
   `ceil(log2 N)` вызовов; undo откатывает по одному удвоению.
7. **Self-Check принимает relative-key equivalence** (A minor ≡ C major) и
   перепроверяет тональность ПОСЛЕ завершения аранжировки.

## Структура репозитория

```
src/core/                  общие контракты (нотация тональностей, keys_match для Self-Check)
src/mcp_servers/midi_gen/ MCP-сервер генерации: logic.py (чистая логика) + server.py (MCP/CLI)
tests/                     смоук-тесты контракта (детерминированность, embed_tempo, GM-канал)
docs/                      PRD, план Ableton Bridge
examples/                  тестовые лупы (CC0/свои; приватное не коммитим)
```

## Документация

- [docs/prd-l2t-v0.2.md](docs/prd-l2t-v0.2.md) — PRD: видение, аудитория (волны),
  метрика Acceptance Rate
- [docs/ableton-bridge-plan.md](docs/ableton-bridge-plan.md) — план Волны 2

## Roadmap

- **v1.0 ✅** — MVP на SoundCraft: полный контур анализ → генерация → DAW →
  рендер → Self-Check
- **Волна 2** — Ableton Live через существующий OSS-мост (см. план)
- **Волна 3** — другие DAW через адаптеры по паттерну `DawBackend`

## Лицензия

MIT — см. [LICENSE](LICENSE).

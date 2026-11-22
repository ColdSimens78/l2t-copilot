# DEPENDENCIES.md — лицензионный манифест L2T Copilot

**Цель:** у MIT-репо с планами монетизации всегда под рукой чистый ответ «что мы тащим и что нам за это будет».
**Дата аудита:** 2026-11-22 (Разведчик, тема №5 конвейера). **Методика:** лицензии сняты не по памяти — Python: метаданные **установленных** пакетов (`importlib.metadata`, repo `.venv`); Rust: crates.io API для **всех 118 крейтов из `crates/l2t-core/Cargo.lock`** (поле `license` версии; JSON-дамп проверки — фиксируется при каждом обновлении); JS: GitHub/npm-метаданные из разведки №1 (`docs/oss-recon-ui.md`).

**Правило обязательств (сводное):** MIT/BSD/ISC/Apache-2.0/MIT-0/Zlib/Unlicense/CC0 — включаем текст лицензии + копирайт в `THIRD_PARTY_NOTICES` при дистрибуции (PyPI/sdist этого достаточно автоматически; для бандлов бинарников — вручную). Apache-2.0 дополнительно: NOTICE-файл + пометка изменений при модификации. MPL-2.0 — file-level copyleft: наши модификации MPL-файлов открываются, использование как есть — просто notice. GPL/AGPL/LGPL-только — **запрещены как зависимости** (внешние процессы — ок; см. docs/oss-recon-soundfonts.md).

**Сводка:** Python 39 пакетов — **0 копилефт-красных** (1 жёлтый MPL-2.0). Rust 118 крейтов — **0 копилефт-красных, 100% permissive** (77× MIT OR Apache-2.0, 19× MIT, 8× Apache OR MIT, 4× Apache-2.0/LLVM-exception, 2× +Unicode-3.0, 1× Unlicense, 1× Unlicense OR MIT, 1× Zlib-дизъюнкция, 1× дизъюнкция с LGPL-опцией — используется permissive-вариант). JS (планируемые) — все 🟢.

---

## 1. Python (`pyproject.toml` → `.venv`, mcp SDK 2.3.0)

**Прямые зависимости:**

| Пакет | Версия | Лицензия (факт) | Источник проверки | Обязательства |
|---|---|---|---|---|
| `mido` | 1.3.3 | MIT | importlib.metadata | notice |
| `mcp` | 2.3.0 | MIT | importlib.metadata | notice |
| `httpx` | 0.28.1 | BSD-3-Clause | importlib.metadata | notice |
| `pytest` (dev) | 9.2.0 | MIT | importlib.metadata | notice |

**Ключевые транзитивы (в т.ч. нестандартные):**

| Пакет | Версия | Лицензия | Примечание |
|---|---|---|---|
| `httpx2` | 2.16.2 | BSD-3-Clause | **форк, тянет mcp 2.x** — причина явного `httpx` в pyproject; следить, не станет ли источником конфликтов |
| `httpcore2` | 2.16.2 | BSD-3-Clause | пара к httpx2 |
| `httpcore` | 1.0.9 | BSD-3-Clause | для httpx |
| `anyio` | 4.16.0 | MIT | async-ядро mcp |
| `pydantic` + `pydantic_core` | — | MIT | типизация mcp |
| `certifi` | — | 🟡 **MPL-2.0** (file-level) | единственный неком-MIT в дереве; мы не модифицируем файлы → достаточно notice; при бинарной дистрибуции включить MPL-текст |
| `python-osc` | 1.10.3 | **Unlicense** («free and unencumbered software released into the public domain») | тянет python-osc — транзитив mcp? (присутствует в venv; фактически CC0-эквивалент) |
| `typing_extensions` | — | PSF-2.0 | permissive |
| `opentelemetry-api` | 1.45.2 | Apache-2.0 | notice |
| `cryptography` | — | Apache-2.0 OR BSD-3-Clause | notice |
| `starlette`/`uvicorn`/`sse-starlette`/`python-multipart` | — | BSD-3 / BSD-3 / BSD-3 / Apache-2.0 | веб-слой mcp (stdio нам нужен; HTTP-фасады не поднимаем) |
| `jsonschema` (+specifications, referencing, rpds-py) | — | MIT | mcp-схемы |
| `Pygments`, `PyJWT`, `attrs`, `click`, `cffi`+`pycparser`, `h11`, `idna`, `packaging`, `pip`, `pluggy`, `iniconfig`, `annotated-types`, `truststore`, `typing-inspection` | — | MIT/BSD/MIT-0/Apache | стандартные permissive |

Полный список версий воспроизводится: `pip list --format=freeze` в `.venv` (генерируется `pip install -e '.[dev]'`). Зависимостей GPL/AGPL в дереве нет. ⚠ `mcp>=1.2,<3` pin уже держит ветку 2.x — при мажорных апгрейдах mcp прогонять этот аудит заново (состав транзитивов меняется).

## 2. Rust (`crates/l2t-core`, Cargo.lock: 118 крейтов)

**Прямые зависимости (`Cargo.toml`):**

| Крейт | Версия | Лицензия (crates.io, факт) | Обязательства |
|---|---|---|---|
| `midly` | 0.5.3 | **Unlicense** (public domain) | никаких; упоминание опционально |
| `rmcp` (+`rmcp-macros`) | 3.11.0 | MIT OR Apache-2.0 | notice |
| `tokio` (+macros/stream/util) | 1.54.1 | MIT OR Apache-2.0 | notice |
| `serde` (+core/derive) | 1.0.229 | MIT OR Apache-2.0 | notice |
| `serde_json` | 1.0.154 | MIT OR Apache-2.0 | notice |
| `thiserror` (+impl) | 2.0.21 | MIT OR Apache-2.0 | notice |
| `tempfile` (dev) | 3.27.0 | MIT OR Apache-2.0 | notice |

**Транзитивное дерево (111 остальных крейтов):** распределение лицензий по crates.io — `MIT OR Apache-2.0` (77), `MIT` (19), `Apache-2.0 OR MIT` (8), `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT` (4: linux-raw-sys, rustix, wasi…), `Apache-2.0` (3), `(MIT OR Apache-2.0) AND Unicode-3.0` (2: unicode-ident/normalization — Unicode-3.0 permissive, notice), `Unlicense OR MIT` (1: memchr), `Zlib OR Apache-2.0 OR MIT` (1: tinyvec), `MIT OR Apache-2.0 OR LGPL-2.1-or-later` (1: **r-efi** — дизъюнкция, мы используем permissive-вариант, LGPL-обязательства не возникают).

**Специфика разбора дизъюнкций:** `A OR B` означает «соблюдаешь A ИЛИ B»; для (MIT OR Apache OR LGPL) обязательства LGPL не наследуются пока не выбран LGPL-вариант. Итог: **все 118 крейтов используются под permissive-лицензиями; ни одного GPL/AGPL; ни одного обязательного copyleft**.

При бандле нативного бинарника в release-артефакт: приложить генерируемый `cargo-license`/`about`-дамп в `THIRD_PARTY_NOTICES` (план — автоматизировать на этапе packaging). Рекомендация на этап packaging: `cargo-deny` в CI (запрет GPL/AGPL-появления в будущем дереве — дифф этого манифеста).

## 3. JS/UI (планируемые — после copy-in Фронтендером заменить фактом `ui/package.json`)

| Пакет | Лицензия | Статус | Источник проверки |
|---|---|---|---|
| `audio-ui` (ouestlabs) | MIT | планируется (copy-in piano-roll/timeline/waveform/sequencer) | docs/oss-recon-ui.md №1 (GitHub API + demo-сайт) |
| `shadcn/ui` + `radix-ui/primitives` (+radix colors) | MIT | планируется | docs/oss-recon-ui.md №4 |
| `tailwindcss` | MIT | планируется | docs/oss-recon-ui.md №4 |
| `lucide` | ISC (LICENSE-файл проверен вручную — API давал NOASSERTION) | планируется | docs/oss-recon-ui.md №4 |
| `wavesurfer.js` | BSD-3-Clause | планируется (Loop X-Ray рендер) | docs/oss-recon-ui.md №3 |
| `tauri` v2 core + `plugins-workspace` (shell) | MIT/Apache-2.0 | планируется (Rust-ядро Кодера уже на rmcp; Tauri-скаффолд следующий) | docs/oss-recon-ui.md №2 |
| `konva`/`react-konva` | MIT (LICENSE-файл проверен) | резерв перфа | docs/oss-recon-ui.md №3 |
| `pixijs` | MIT | резерв (отсечён до профилирования) | docs/oss-recon-ui.md №3 |
| `react`, `react-dom`, `vite`, `typescript` | MIT/MIT/MIT/Apache-2.0 | типовые | подтвердить фактом при скаффолде |

Copy-in-модель audio-ui: код **становится нашим** (шадн-реестр копирует файлы в репо) → лицензионные обязательства MIT сохраняются (сохранить оригинальный LICENSE-заголовок файла при копировании, если есть).

**Не тащим никогда (из разведок):** python-telegram-bot (GPL-3.0 🔴), код openDAW/synkopa/MAGDA/nuclear (AGPL/GPL 🔴 — только read-only референсы), TimGM6mb-soundfont в дистрибуцию (GPL-2 🔴), Arachno (custom no-distribute 🔴), GeneralUser GS в дефолт-бандл (🟡 provenance — «пользователь ставит сам»). Внешние процессы — разрешены: fluidsynth (LGPL-2.1+), ffmpeg (GPL/LGPL-комбинация), audio-analyzer (статические бинарники), aiogram (MIT — будущая зависимость бот-фронта, см. docs/oss-recon-telegram.md).

## 4. Процедура поддержания манифеста

1. При любом изменении `pyproject.toml` / `Cargo.toml` / `ui/package.json` — обновить соответствующую секцию этого файла (версии + при новых пакетах лицензию из метаданных, не из памяти).
2. Периодический аудит (раз в этап): перегенерация списков (`pip list`, Cargo.lock-парс + crates.io) и diff с этой таблицей; красные лицензии = блокер коммита.
3. При первом release-артефакте — собрать `THIRD_PARTY_NOTICES` (Python: `pip-licenses`; Rust: `cargo-license`/`about`; JS: `license-checker`) и закоммитить рядом.
4. Дистрибуция звуковых/тестовых ассетов — только CC0/PD с проверкой в месте скачивания (образец процедуры: `examples/README.md`, тема №6).

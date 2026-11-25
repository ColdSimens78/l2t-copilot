# Окружение фронтенда: Debian 13 → Tauri v2 + React

**Автор:** L2T team · **Дата:** 2026-11-22
**Статус:** проверка выполнена, команды доустановки задокументированы (sudo НЕ выполнялся — право установки у владельца).
**Контекст:** proposal `ui-architecture-proposal.md` v0.3 §10.2 (железные правила: никакого DSP в UI-процессе; WebKitGTK-спайк недели 1), §10.3 этап 1; shortlist библиотек — `oss-recon-ui.md`. Код UI не пишется до утверждения спеки владельцем.

## 1. Сводка

Платформа: **Debian 13.7 (trixie), x86_64, сессия X11** (`DISPLAY=:0`, Wayland не активен — для WebKitGTK это самый стабильный путь). RAM 30 GiB (19 свободно), диск `/` — 95 GiB свободно. Ресурсов для Tauri-сборки достаточно с запасом.

Ситуация одним абзацем: **системный тулчейн наполовину готов** (gcc/g++/make/git/curl/wget/file есть; runtime-библиотеки webkit2gtk-4.1, ayatana-appindicator, gtk-3 уже стоят — их привёл SoundCraft/десктоп), но **нет ни Node.js, ни Rust, ни pkg-config, ни `-dev`-пакетов** библиотек. Т.е. Rust-сторонa и JS-сторона кокпита ставятся с нуля.

## 2. Таблица компонентов

| Компонент | Статус | Версия / примечание |
|---|---|---|
| Debian | ✅ есть | 13.7 trixie, x86_64, X11-сессия |
| gcc / g++ / make (build-essential) | ✅ есть | gcc 14.2.0, GNU Make 4.4.1 |
| git | ✅ есть | 2.47.3 |
| curl / wget / file | ✅ есть | 8.14.1 / 1.25.0 / 5.46 |
| libwebkit2gtk-4.1-0 (runtime) | ✅ есть | 2.54.0 (очень свежая, трикси) |
| libgtk-3-0t64 (runtime) | ✅ есть | транзитивно от webkit |
| libayatana-appindicator3-1 (runtime) | ✅ есть | 0.5.94 |
| **pkg-config / pkgconf** | ❌ нет | кандидат 1.8.1; **критично** — `*-sys` крейты (glib/gtk/webkit) без него не собираются |
| **libwebkit2gtk-4.1-dev** | ❌ нет | кандидат 2.54.0; официальная-headline-зависимость Tauri v2 |
| **libayatana-appindicator3-dev** | ❌ нет | runtime есть, dev-файлов нет |
| **librsvg2-dev** | ❌ нет | кандидат 2.60.0 |
| **libxdo-dev** | ❌ нет | кандидат 3.20160805.1 |
| **libssl-dev** | ❌ нет | кандидат 3.5.9 |
| patchelf | ❌ нет | кандидат 0.18.0; **в официальном списке Tauri отсутствует** — нужен только для AppImage-бандлинга; для v0 (формат `.deb`) не требуется |
| cmake | ❌ нет | кандидат 3.31.6; в официальном списке нет; опционально (отдельные крейты экосистемы) |
| **Node.js** | ❌ нет | в репо трикси — 20.19.2 (устаревающая LTS); рекомендую nvm + Node 22 LTS |
| **npm** | ❌ нет | идёт вместе с Node |
| **pnpm** | ❌ нет | рекомендую ставить глобально через npm |
| **rustc / cargo / rustup** | ❌ нет | в репо трикси — 1.85.1 (отстаёт от stable); рекомендую rustup |
| RAM / диск | ✅ есть | 30 GiB / 95 GiB свободно |

Проверка выполнялась: `node/npm/pnpm/rustc/cargo --version`, `dpkg-query`, `apt-cache policy/depends`, поиск скрытых установок (`~/.nvm`, `~/.cargo`, `~/.rustup`, `/usr/local/bin/node*` — ничего нет; rustup до этого не ставился — осознанное решение).

## 3. Команды доустановки (владелец выполняет сам)

### 3.1. Системные пакеты (sudo, одна блок-команда)

Официальный список Tauri v2 для Debian/Ubuntu (v2.tauri.app/start/prerequisites, сверено 2026-11-22) + одно добавление от меня:

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
                 libxdo-dev libssl-dev libayatana-appindicator3-dev \
                 librsvg2-dev pkg-config
```

- `build-essential`, `curl`, `wget`, `file` уже стоят — в команде оставлены безвредно (apt идемпотентен).
- **`pkg-config` — моё добавление к официальному списку**: проверил `apt-cache depends libwebkit2gtk-4.1-dev` — pkgconf им не тянется ни Depends, ни Recommends, а без бинарника `pkg-config` сборка падает на первом же `*-sys` крейте.
- `patchelf` — НЕ ставим сейчас: в официальных пререквизитах отсутствует, нужен только для AppImage-бандлинга. Добавить позже одной строкой (`sudo apt install patchelf`), если решим собирать AppImage.
- Транзитивно от `libwebkit2gtk-4.1-dev` придут `libgtk-3-dev`, `libjavascriptcoregtk-4.1-dev`, `libsoup-3.0-dev`, `glib`-dev и т.п. — отдельные строки не нужны.

### 3.2. Rust (rustup, без sudo — ставится в `~/.cargo` и `~/.rustup`)

```bash
curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh
# совет из доков Tauri: скрипт стоит сначала посмотреть (скачать без | sh)
source "$HOME/.cargo/env"   # или переоткрыть терминал
rustc --version && cargo --version
```

Альтернатива `sudo apt install rustc cargo` (1.85.1 в трикси) — **не рекомендую**: Tauri-экосистема быстро двигает MSRV, apt-версия застынет; rustup даёт `rustup update` без sudo.

### 3.3. Node.js (nvm, без sudo — ставится в `~/.nvm`)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
# переоткрыть терминал (или source предложенного файла), затем:
nvm install --lts          # поставит актуальную LTS (22.x Jod)
node --version && npm --version
```

Альтернатива `sudo apt install nodejs npm` (20.19.2 + npm 9.2) — **не рекомендую**: npm 9 стар (v10+ идёт с Node 22), версия прибита к дистро. nvm = веновский паттерн, к которому проект уже привык (`~/midi-env`, `.venv`), плюс переключение версий без sudo.

### 3.4. pnpm

```bash
npm install -g pnpm@latest-10
pnpm --version
```

(`corepack enable` тоже работает, но corepack у Node в процессе вывода из дистрибутива — прямая установка через npm устойчивее.)

### 3.5. Проверка после установки (смока, без UI-кода)

```bash
node -v && npm -v && pnpm -v && rustc -V && cargo -V
pkg-config --modversion webkit2gtk-4.1 gtk+-3.0   # -dev-пакеты видны из pkg-config
cargo new /tmp/rust-smoke && cd /tmp/rust-smoke && cargo run   # линкер работает
```

Гарантированно рабочая первая сборка Tauri — уже часть этапа 1 (после утверждения спеки), не окружение.

## 4. Рекомендация пакетного менеджера: **pnpm**

| Критерий | pnpm | npm |
|---|---|---|
| Поддержка Tauri | first-class: `create-tauri-app --package-manager pnpm` | first-class |
| Диск | content-addressable store, один глобальный на машину; жёсткие ссылки | дублирование в каждом `node_modules` |
| Скорость холодных установок | заметно быстрее | медленнее |
| Чистота зависимостей | строгий `node_modules` — «фантомных» зависимостей нет | hoisting — можно импорттировать незадекларированное |
| Монорепо | `pnpm workspace` из коробки (`src/` + будущий `ui/`) | воркспейсы есть, слабее |

Обоснование под наш проект: (1) модель **copy-in из shadcn-registry** (audio-ui) приносит в репо много исходников с точными зависимостями — строгий `node_modules` pnpm ловит недопрописанные импорты сразу, npm молча простит; (2) монорепо `l2t-copilot` получит JS-пакет (`ui/`) рядом с Python-пакетом — `pnpm workspace` склеит это чище; (3) дисковая экономия на машине одна, проектов с JS у Ilmir станет несколько. npm остаётся нулевым fallback'ом (идёт с Node), но раз мы всё равно ставим rustup и nvm, порог «лишний инструмент» уже пройден. Итог: **pnpm как менеджер проекта, npm — только как установщик самого pnpm.**

## 5. Замечания по платформе (вход в спайк недели 1)

- **WebKitGTK 2.54.0 в трикси — очень свежая**; Tauri v2 использует API 4.1 — совместимо. Свежесть = возможны квирки нового DMA-BUF-рендера — именно их проверяет спайк §10.2 (шрифты, HTML-audio gapless-луп, drag-and-drop, always-on-top, память). Fallback из VISION v2 остаётся в силе: тот же React-бандл как локальный web-UI.
- **Сессия X11, не Wayland** — убирает целый класс WebKitGTK-on-Wayland квирков до старта (скриншоты,IME, дробное масштабирование). Хорошая стартовая позиция.
- 30 GiB RAM / 95 GiB диска — `cargo` + `node_modules` + WebView-профили живут без стеснения.

## 6. План моих работ после утверждения спеки

(по §10.3 этап 1 proposal v0.3; порядок = приоритет; никакого кода до слов владельца «спека утверждена»)

1. **WebKitGTK-спайк недели 1** — минимальное Tauri-окно с чек-листом §10.2: шрифты/рендер текста, латентность и стабильность HTML-audio в gapless-лупе, drag-and-drop файлов из менеджера, always-on-top, потребление памяти. Выход: go/no-go по WebKitGTK + выбор варианта превью-рендера (§11 в.3: сайдкар GM-синт vs headless-баунс SoundCraft).
2. **Tauri-скаффолд** (`create-tauri-app`, React+TS, pnpm): каркас Rust-ядра — типизированные IPC-commands/events (§6.2: `analyze_loop`, `generate_part`, `import_accepted`, `get_bus_state`...), владелец MCP-клиентов stdio в ядре, фронт без прямого доступа к MCP.
3. **База дизайн-системы**: shadcn/ui + Radix + Tailwind + Lucide (короткий путь из oss-recon-ui.md), тёмная тема.
4. **audio-ui copy-in**: piano-roll (+edits/tools), timeline, waveform из registry MIT — код в нашем репо, расширяем `Note` слоем `'ghost'`.
5. **Призрачные ноты v0**: контракт suggestion §5.1 (`notes/rationale/confidence/source_tool/params`) → read-only piano-roll-просмотр поверх лупа, карточки слоёв стейджинга, manifest + логирование accept/reject — Acceptance Rate инструментируется с первого дня.
6. **Loop X-Ray-карточка** (числа из audio-analyzer через ядро) и **WAV-превью** (HTML audio, без DSP) — замыкают минимальный hero-кусочек воронки.

Каждый шаг — отдельным коммитом явных путей (правило №6: никаких `git add -A`), на ревью мейнтейнера.

## 7. Источники

- Официальные пререквизиты Tauri v2 (Linux): https://v2.tauri.app/start/prerequisites/ — список apt-пакетов сверен 2026-11-22 (в этой дате patchelf отсутствует; rustup и Node LTS — их рекомендации).
- `docs/ui-architecture-proposal.md` v0.3 §6, §10.2, §10.3; `docs/oss-recon-ui.md` (shortlist); память `ai-music-ecosystem` (правила мультиагентной системы, VISION v2).
- Локальные проверки: `dpkg-query -W`, `apt-cache policy/depends`, `--version` прогоны 2026-11-22.

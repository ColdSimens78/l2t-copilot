# OSS-разведка №11: верификация второго списка MCP владельца

**Автор:** OSS Scout · **Дата:** 2026-11-24 · **Для:** Lead + владелец · **Тема:** Firecrawl, Crawl4AI, Fetch, audial-mcp, OmniDB, fLMCP, MidOS
**Методика:** №10-методика (существует → автор → LICENSE-файл → активность → red flags → дубль-сверка); гипотезы Lead'а проверены досконально, каждое подтверждение/опровержение снабжено источником. Спецвопрос владельца («чем агентов прокачать») — отдельная колонка: «даёт ли что-то, чего НЕТ в WebFetch/WebSearch/serena/context7/gh».

---

## Сводная таблица

| # | Пункт | Гипотеза Lead'а | Факт | Вердикт |
|---|---|---|---|---|
| 1 | Firecrawl | реален, AGPL-ядро + MIT-SDK, cloud-key | ✅ подтверждена, + уточнение: MCP = клиент облачного API | **REJECT** (применимость + cloud) |
| 2 | Crawl4AI | реален, Apache-2.0, популярен | ✅ подтверждена (LICENSE-файлом) | **REJECT** (применимость — нет задач массового краулинга) |
| 3 | Fetch (official) | MIT, но дубль WebFetch | ✅ подтверждена (MIT, Anthropic; монорепо в переходе MIT→Apache) | **REJECT сейчас; кандидат при выходе за пределы ZCode** |
| 4 | audial-mcp | не знает такого; аудио-домен = критично проверить | существует: MIT, **0★**, **HOSTED SaaS** — полный музыкальный конвейер в облаке | **REJECT** (privacy + 0★) — но **ГЛАВНАЯ конкурентная находка темы** (§4) |
| 5 | OmniDB | заморожен 2020, GPL, archived | ⚠️ уточнено: **не archived, MIT, но мёртв — последний push 2023-02** (3.9 года); DB-GUI, не MCP | **REJECT** двойной (мёртв + не наш кейс) |
| 6 | fLMCP | не знает; NOVERIFY если нет | существует: MIT, **0★, создан и умер в один день** (2026-09-03); форк живого апстрима | **REJECT для установки; апстрим FLStudioMCP — WATCH** (FL-слот DawBackend) |
| 7 | MidOS | не знает; NOVERIFY если нет | **НЕ СУЩЕСТВУЕТ** (все совпадения = Xiaomi «mido» device-tree false-positives) | **REJECT** (NOVERIFY доказан поиском) |

**Итог: 0 из 7 в install.** Список второго захода — качественнее первого (№10): здесь 5 из 7 реально существуют, лицензии у существующих чистые (MIT/Apache), но **ни один не даёт того, чего НЕТ в текущем стеке агентов** (спецвопрос владельца — ответ «ничем», разбор в каждом пункте).

---

## 1. Firecrawl — гипотеза подтверждена досконально

| Компонент | Лицензия (факт) | ★ / активность |
|---|---|---|
| Ядро [firecrawl/firecrawl](https://github.com/firecrawl/firecrawl) | **AGPL-3.0** (LICENSE прочитан: «GNU AFFERO GENERAL PUBLIC LICENSE») | **208583★**, push сегодня |
| MCP [firecrawl/firecrawl-mcp-server](https://github.com/firecrawl/firecrawl-mcp-server) | **MIT** (LICENSE прочитан: «Copyright (c) 2025 vrknetha») | 7899★, push сегодня |

**Уточнение к гипотезе (важнее лицензии):** MIT-лицензия MCP-обёртки не делает инструмент локальным — это **клиент облачного Firecrawl API**: keyless-режим даёт лишь 3 инструмента (scrape/search/parse) с rate-limit; полный набор (34 инструмента: crawl/map/agent/research/enrich) требует **API-key с firecrawl.dev** (платный сервис); self-hosted варианта движка — это уже AGPL-развертывание. README прямо: «Prefer OAuth or an API key… higher limits».

**Для агентов — чего нет в стеке:** массовый краулинг сайтов (crawl/map), enrichment-API (people/company search), research-paper поиск. **Наших задач такого рода нет** — дети ходят в конкретные документации (Context7) и точечные страницы (WebFetch). Секьюрити-минус: URL-трафик проекта через сторонний cloud + оплата key. **REJECT**; пересмотреть, если появится задача «индексация сайтов-доноров сэмплов» (вряд ли — CC0-источники мы уже верифицировали вручную в №6).

## 2. Crawl4AI — гипотеза подтверждена, вердикт по применимости

[unclecode/crawl4ai](https://github.com/unclecode/crawl4ai) — **Apache-2.0** (LICENSE-файл прочитан: «Apache License, Version 2.0»), **87746★**, push 2026-11-23 — гипотеза Lead'а верна по всем трём пунктам. MCP-слой — **сторонние обёртки** (лучший: walksoda/crawl-mcp 49★; официальный MCP в ядре не замечен при скане).

**Чего нет в стеке:** LLM-friendly-краулинг в масштабе (тысячи страниц, структурированный extraction). **Наших задач нет**: документации — точечно (WebFetch/Context7), аудио-файлы — локальные (не HTML). Установка Python-библиотеки 87k★ ради несуществующих задач = токен-оверhead и новый ranti-плейна поверхности. **REJECT по применимости** (качество проекта при этом отличное — записать в справочник «если понадобится краулинг»).

## 3. Fetch (official reference) — дубль подтверждён честно

[modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) — монорепо **92k★**, push сегодня; лицензия репо в **переходе MIT → Apache-2.0** (корневой LICENSE: «undergoing a licensing transition…»; `src/fetch/LICENSE` = **MIT, «Copyright (c) 2024 Anthropic, PBC»** — прочитан).

**Честная проверка гипотезы дубля:** да, подтверждена — родной `WebFetch` (markdown-конверсия, кэш 15 мин, URL-фоллоу) + `WebSearch` покрывают сценарии fetch-сервера для наших детей; fetch-MCP добавляет опции (raw-content, кастомные заголовки, robots-режимы), которых **нет ни одной текущей задачи**. Токен-стоимость ещё одного MCP на каждого ребёнка > выгода.

**Watch-условие (важное):** если какая-то часть агентов выйдет за пределы ZCode (например, qwen-stack-оркестратор без встроенных WebFetch-инструментов) — официальный fetch станет **безопасным MIT-выбором по умолчанию** (Anthropic-авторство, reference-качество). Пока — **REJECT**.

## 4. audial-mcp — не знал Lead не зря: это ГЛАВНАЯ находка темы

[AudialAI/audial-mcp](https://github.com/AudialAI/audial-mcp) — MIT, **0★**, создан 2026-09-29, push 2026-11-23 (вчера), Python. README (прочитан): «run **Audial's hosted** audio tools from any MCP client: **split stems, analyze audio, find a song's sections, tempo and bars**, … **master tracks**, build sample packs, **convert audio to MIDI, generate music**, turn a one-shot into an editable Audial Synth or **Serum 2 preset**, and sing lyrics in a reference voice». Установка: **нужен Audial-аккаунт** (audialmusic.ai), OAuth-через-браузер при первом вызове, результаты в `~/Audial`.

**Пересечение с нашим стеком — почти полное, но со стороны облака:**

| Наш локальный компонент | Аналогичная функция у Audial (hosted) |
|---|---|
| audio-analyzer-rs (tempo/sections/key) | «analyze audio, find sections, tempo and bars» |
| midi-gen (генерация партий) | «generate music», «audio to MIDI» |
| P-Master (§тема №8) | «master tracks» |
| fluidsynth-превью / stems | «split stems» |
| Serum/Synth-тамбры (PRD P-Timbre) | «editable Audial Synth or Serum 2 preset» |

**Секьюрити-разбор (почему REJECT при MIT-лицензии):** (1) **все аудио-данные уходят в облако третьей стороны** — наши пользовательские лупы приватны (пример: приватные записи запрещены в репо правилом examples/), отправка их в hosted-сервис = утечка пользовательского материала; (2) OAuth-токен хранится локально у процесса; (3) бейдж «AllMCPs Verified» — **сторонний самозваный верификатор** (allmcps.com — не официальная инфраструктура MCP); (4) 0★ = нулевое комьюнити-испытание. **REJECT**.

**Экосистемный сигнал (для Lead/владельца — ценнее установки):** Audial делает **ровно наш Pro-путь как облачный SaaS** (stems→master→audio2MIDI→presets). Это подтверждает рыночность направления PRD и даёт готовую сравнительную рамку: **наш ответ — «локально, приватно, файлы остаются у пользователя, открытый стек»** — добавить в позиционирование v2.2. В конкурентный патруль (тема №3-методика) добавить audialmusic.ai ежес-принтово.

## 5. OmniDB — гипотеза подтверждена с уточнением дат

[OmniDB/OmniDB](https://github.com/OmniDB/OmniDB) — **не archived** (формально жив), лицензия **MIT** (гипотеза «GPL» — не подтвердилась; возможно Lead помнил старые версии), 3278★, **последний push 2023-02-01 — код мёртв 3.9 года** (гипотеза «заморожен» — подтверждена; дату Lead помнил как 2020 — уточнено до 2023). Сущность: web-GUI **DB-администрирование** (не MCP-проект вовсе — пункта MCP в списке владельца не существует под этим именем).

**REJECT двойной:** (1) мёртв 3.9 года (T1-правило превышено кратно); (2) DB-админ — у нас нет БД (тот же вывод, что в №10 для postgres/supabase).

## 6. fLMCP — существует, но мёртворожденный форк; апстрим жив

[nymphaea-a/fLMCP](https://github.com/nymphaea-a/fLMCP) — MIT, **0★**, создан **и последний push — один день 2026-09-03** (жизнь < суток как активного проекта). Является форком-доработкой: «基于 [geezoria/FLStudioMCP] 上游主项目… 增加了 Layer 2 安全操作工具、钢琴卷帘读取、三种写入模式» — FL Studio MCP (китайский README, англ. версия есть).

**Апстрим живее форка:** [geezoria/FLStudioMCP](https://github.com/geezoria/FLStudioMCP) — MIT, 11★, создан 2026-04-22, **push 2026-11-22 (вчера)**, «FL Studio 2024–2026 with **176 tools: mix diagnosis, effects**…»; Boyan253/fl-studio-2025-ai-bridge (MIT, 4★) — совместимость с FL 2025.

**Для нас:** FL Studio control-MCP — это **готовый DawBackend-слот для FL-пользователей** (позиционирование v2.2 «десктоп-компаньон к любой DAW»: deep-интеграция = DawBackend-адаптеры). Но: у нас FL нет, Wave 2 (второй хост) закрыт владельцем («Ardour закрыт, больше не возвращаемся»), а универсальная .mid/.wav-интеграция уже покрывает FL-пользователей без bridge. **REJECT для установки**; **апстрим geezoria/FLStudioMCP — в watch-список DawBackend** (критерий активации: владелец решает сделать deep-FL-интеграцию → верифицировать 176-инструментный каталог по методике №8).

## 7. MidOS — не существует (NOVERIFY доказан)

Два запроса («MidOS mcp», «midos» по звёздам): все совпадения — **Xiaomi «mido» device-trees** (zeelog/android_device_xiaomi_mido 131★ и пр.) и midi-visualization — ни одного MCP-продукта. **Вероятна AI-галлюцинация источника списка (как V.I.S.O.R. в №10).** **REJECT.**

---

## Спецвопрос владельца: «чем агентов прокачать?»

Честный ответ по каждому: **ничем** — ни один из 7 не даёт способности, которой нет в WebFetch/WebSearch/Serena/Context7/gh+playwright:

| Пункт | Что добавил бы | Что уже есть |
|---|---|---|
| Firecrawl | масштабный crawl/enrich | WebFetch (точечно) + gh (код-поиск) — задачи crawl нет |
| Crawl4AI | LLM-краулинг в масштабе | — (задачи нет) |
| Fetch | raw-content/заголовки | WebFetch покрывает все текущие сценарии |
| audial-mcp | аудио-конвейер в облаке | наш ЛОКАЛЬНЫЙ стек полнее и приватнее (это наша ценность!) |
| OmniDB | DB-админ | БД нет (serde-файлы + SQLite qwen-stack при необходимости) |
| fLMCP | FL Studio control | .mid/.wav универсальная интеграция; FL-слот DawBackend = будущее, не сейчас |
| MidOS | — | — |

**Рекомендация Lead'у/владельцу:** для «прокачки агентов» эффективнее не новые MCP, а (а) внедрение Serena/Context7-процессов из №9 (чек-листы ещё не разосланы детям — это бесплатная прокачка уже установленным), (б) при будущем расширении — верификация по №10-методике до установки.

## Патрульные действия (из этой темы)

1. **audialmusic.ai / AudialAI** — добавить в конкурентный патруль (тема №3-методика): их SaaS = прямой конкурент PRD-направления; наш контр-нарратив «локально, приватно, открытый стек».
2. **geezoria/FLStudioMCP** — в watch DawBackend-слотов (условие активации: решение владельца о deep-FL).
3. Firecrawl/Crawl4AI — в справочник «если появится задача краулинга» (верификация уже сделана, не повторять).

## Источники (все 2026-11-24)

- GitHub API: firecrawl/firecrawl (AGPL-3.0, 208583★), firecrawl/firecrawl-mcp-server (MIT, LICENSE прочитан, 7899★), unclecode/crawl4ai (Apache-2.0, LICENSE прочитан, 87746★), modelcontextprotocol/servers (92k★, корневой LICENSE + src/fetch/LICENSE прочитаны), AudialAI/audial-mcp (MIT, 0★, README прочитан), OmniDB/OmniDB (MIT, push 2023-02-01), nymphaea-a/fLMCP (MIT, 0★, README прочитан), geezoria/FLStudioMCP (MIT, 11★, push 2026-11-22), Boyan253/fl-studio-2025-ai-bridge (MIT, 4★); поисковые выборки «firecrawl mcp», «crawl4ai mcp», «audial», «OmniDB», «fLMCP», «MidOS/midos»
- Firecrawl README (keyless/cloud-API механика), audial README (hosted-инструменты, OAuth-flow)
- Стек-сверка: встроенные WebFetch/WebSearch/Serena/Context7/playwright/gh (факты тем №1–10)

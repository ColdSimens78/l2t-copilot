//! Типизированные команды-фасады = Rust-реализация ipc-контракта v0.1
//! (docs/ipc-contract.md). Фронтенд зовёт эти методы через Tauri IPC;
//! ядро транслирует их в вызовы инструментов шины. Контракт шины (7 правил
//! README) живёт здесь в одном месте.
//!
//! Этап 1 реализует: analyze_loop / generate_part / regenerate /
//! reject_part / get_bus_state (engine: down) / run_self_check.
//! `accept_part` требует DAW-хоста (DawBackend — следующий этап) и честно
//! отвечает bounded-ошибкой, а не тихой заглушкой.
//!
//! Стейджинг (контракт § «Файлы стейджинга»): staging/<part>_v<N>.mid +
//! staging/manifest.json (лог решений — Acceptance Rate §5.3).

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{json, Map, Value};

use crate::bus::{BusServer, DEFAULT_CALL_TIMEOUT};
use crate::config::{resolve_audio_analyzer, resolve_midi_gen, ServerConfig};
use crate::contract::{
    AcceptResult, AdoptResult, BusLog, BusLogStatus, BusState, EngineState, Part,
    SelfCheckReport, Suggestion, SuggestionStatus, XRayReport,
};
use crate::error::{CoreError, CoreResult};
use crate::notes;
use crate::staging;
use crate::{analyzer_parse as ap, keys};

/// Ядро кокпита: единственный владелец MCP-клиентов шины.
pub struct CockpitCore {
    audio_analyzer: Option<BusServer>,
    midi_gen: Option<BusServer>,
    /// Слот «Движок» (SoundCraft standalone, ратифицирован владельцем).
    /// Опционален: без бинаря кокпит живёт — engine: down.
    engine: Option<BusServer>,
    call_timeout: Duration,
    staging_dir: PathBuf,
    /// Текущее (последнее) предложение по каждой партии.
    suggestions: HashMap<Part, Suggestion>,
    /// Последний проанализированный луп — эталон run_self_check.
    last_loop_xray: Option<XRayReport>,
    /// Журнал шины (источник Tauri-события bus_log).
    bus_log: VecDeque<BusLog>,
}

impl CockpitCore {
    /// Прод-подключение кокпита: analyzer + midi-gen + ратифицированный
    /// движок (roots на workspace владельца) + staging ВНУТРИ workspace
    /// (правило №1: песочница движка должна покрывать стейджинг — иначе
    /// импорт партий отвергается, факт e2e). Битые слоты не убивают ядро.
    pub async fn connect() -> Self {
        let ws = std::env::var("L2T_SOUNDCRAFT_WORKSPACE")
            .unwrap_or_else(|_| crate::config::SOUNDCRAFT_WORKSPACE.into());
        let mut core =
            Self::connect_in(resolve_audio_analyzer(), resolve_midi_gen(), PathBuf::from(&ws).join("staging")).await;
        if crate::config::resolve_soundcraft().command.is_file() {
            if let Err(e) = core.attach_engine(crate::config::resolve_soundcraft()).await {
                eprintln!("[engine] не поднялся: {e}");
            } else {
                let _ = core.session_new("cockpit").await;
            }
        }
        core
    }

    /// Все зависимости — явными аргументами (тесты и будущий Tauri-слой).
    pub async fn connect_in(
        audio_analyzer: ServerConfig,
        midi_gen: ServerConfig,
        staging_dir: PathBuf,
    ) -> Self {
        let audio_analyzer = BusServer::connect(audio_analyzer).await.ok();
        let midi_gen = BusServer::connect(midi_gen).await.ok();
        Self {
            audio_analyzer,
            midi_gen,
            engine: None,
            call_timeout: DEFAULT_CALL_TIMEOUT,
            staging_dir,
            suggestions: HashMap::new(),
            last_loop_xray: None,
            bus_log: VecDeque::new(),
        }
    }

    /// Подключить слот «Движок» (SoundCraft standalone). Битый движок не
    /// убивает ядро — get_bus_state останется Down.
    pub async fn attach_engine(&mut self, config: ServerConfig) -> CoreResult<()> {
        let server = BusServer::connect(config).await?;
        self.engine = Some(server);
        Ok(())
    }

    /// Подключён ли слот движка (для host_status при старте кокпита).
    pub fn has_engine(&self) -> bool {
        self.engine.is_some()
    }

    // ------------------------------------------------------ analyze_loop ----

    /// **Loop X-Ray** (контрактная команда): анализ лупа → `XRayReport`.
    /// Композит из суб-инструментов analyzer (обход upstream-паники
    /// sections.rs, issue #3) + нормализация текстовых отчётов. Результат
    /// запоминается как эталон Self-Check.
    pub async fn analyze_loop(&mut self, path: &Path) -> CoreResult<XRayReport> {
        let rhythm = self.analyzer_text(path, "rhythm_analysis").await?;
        let info = self.analyzer_text(path, "audio_info").await?;
        let spectral = self.analyzer_text(path, "spectral_features").await?;
        let harmonic = self.analyzer_text(path, "harmonic_analysis").await?;
        let (key, key_confidence) = ap::key_of(&harmonic)?;
        let (bpm, bpm_confidence) = ap::tempo_of(&rhythm)?;
        let (lufs, true_peak) = ap::loudness_of(&spectral)?;
        let report = XRayReport {
            bpm,
            bpm_confidence,
            // текстовый режим analyzer альтернативный темп не отдаёт
            bpm_alt: None,
            key,
            key_confidence,
            // relative-key определяет Self-Check (keys_match), не анализатор
            key_relative: None,
            lufs,
            true_peak,
            bands: ap::bands_of(&spectral)?,
            // beats/сек — прокси (текстовый режим onset-density не отдаёт)
            onset_density: ap::onset_density_of(&rhythm, &info),
        };
        self.last_loop_xray = Some(report.clone());
        Ok(report)
    }

    /// C5 (ipc-контракт v0.2): analyze_loop с `copy_into_workspace` —
    /// дроп-зона отдаёт путь вне workspace, а правило шины №1 требует,
    /// чтобы всё живое в staging. Копируем в `staging/loops/` и анализируем
    /// копию (X-Ray-эталон Self-Check привязывается к ней же).
    pub async fn analyze_loop_copied(&mut self, path: &Path) -> CoreResult<XRayReport> {
        self.ensure_staging()?;
        let loops = self.staging_dir.join("loops");
        std::fs::create_dir_all(&loops).map_err(|e| CoreError::Tool {
            tool: "staging".into(),
            message: format!("не создал {}: {e}", loops.display()),
        })?;
        let stem = path
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "loop.wav".into());
        let dest = loops.join(format!("{}_{}", now_ms(), stem));
        std::fs::copy(path, &dest).map_err(|e| CoreError::Tool {
            tool: "analyze_loop".into(),
            message: format!("не скопировал {} в workspace: {e}", path.display()),
        })?;
        self.analyze_loop(&dest).await
    }

    /// **adopt_loop** (C1, ipc-контракт v0.2): применить BPM и тональность
    /// лупа к сессии движка — `event.tempo {bpm}` + key-маркер по конвенции
    /// имени `Key: <тональность>` (kind движок нормализует в "Marker",
    /// конвенция — в имени; факт спайка). Вызывается ДО generate/accept:
    /// клипы считаются по текущей темп-карте сессии.
    pub async fn adopt_loop(&mut self, bpm: f64, key: &str, source: &str) -> CoreResult<AdoptResult> {
        if !(20.0..=300.0).contains(&bpm) {
            return Err(CoreError::Tool {
                tool: "event.tempo".into(),
                message: format!("bpm должен быть 20..300, получил {bpm}"),
            });
        }
        let (pc, mode) = keys::parse_key(key).map_err(|e| CoreError::Tool {
            tool: "adopt_loop".into(),
            message: e,
        })?;
        let key = format!("{} {}", crate::keys::PC_NAMES[pc as usize], mode.as_str());
        let engine = self.engine.as_ref().ok_or_else(|| CoreError::Tool {
            tool: "daw".into(),
            message: "движок SoundCraft не подключён (см. get_mcp_slots / Screen 0)".into(),
        })?;

        let (ms, _) = call_logged(
            &mut self.bus_log,
            engine,
            "execute",
            "adopt_loop",
            json!({"command": "event.tempo", "params": {"bpm": bpm}}),
            self.call_timeout,
        )
        .await?;
        let marker_name = format!("Key: {key}");
        let (_, marker) = call_logged(
            &mut self.bus_log,
            engine,
            "execute",
            "adopt_loop",
            json!({"command": "markers.add",
                   "params": {"name": marker_name, "at": 0, "kind": "key"}}),
            self.call_timeout,
        )
        .await?;
        println!("[adopt_loop] {key} @ {bpm} BPM от {source:?}: {} мс, маркер {marker}",
            ms.as_millis());
        Ok(AdoptResult { tempo: bpm, marker_name })
    }

    /// Вызов суб-инструмента analyzer с журналированием; текст отчёта.
    async fn analyzer_text(&mut self, path: &Path, tool: &str) -> CoreResult<String> {
        let server = self
            .audio_analyzer
            .as_ref()
            .ok_or_else(|| unavailable("audio-analyzer"))?;
        let mut args = Map::new();
        args.insert("path".into(), json!(path.display().to_string()));
        let (_, v) = call_logged(
            &mut self.bus_log,
            server,
            tool,
            "analyze_loop",
            Value::Object(args),
            self.call_timeout,
        )
        .await?;
        // текстовый режим: call_json отдал {"raw": "..."} — разворачиваем
        let text = v
            .as_object()
            .and_then(|o| o.get("raw"))
            .and_then(Value::as_str)
            .or_else(|| v.as_str())
            .ok_or_else(|| CoreError::EmptyResponse {
                tool: tool.into(),
                structured: Some(v.clone()),
            })?;
        Ok(text.to_string())
    }

    // ---------------------------------------------------- generate_part ----

    /// **AI Layering** (контрактная команда): сгенерировать партию →
    /// `Suggestion`. `output_path` ядро назначает само по контракту
    /// стейджинга (staging/<part>_v<N>.mid), независимо от params.
    pub async fn generate_part(&mut self, tool: Part, params: Value) -> CoreResult<Suggestion> {
        let version = self.suggestions.get(&tool).map_or(1, |s| s.version + 1);
        let mut eff: Map<String, Value> = params
            .as_object()
            .cloned()
            .ok_or_else(|| CoreError::Tool {
                tool: tool.mcp_tool().into(),
                message: "params должен быть JSON-объектом".into(),
            })?;
        self.ensure_staging()?;
        // bpm из X-Ray бывает дробным (рубато: 139.7) — генераторы принимают
        // целые: ядро нормализует (контракт-тест примечание №7 в ipc-contract)
        if let Some(bpm) = eff.get("bpm").and_then(Value::as_f64) {
            eff.insert("bpm".into(), json!(bpm.round() as i64));
        }
        let file = self.staging_dir.join(format!("{}_v{version}.mid", part_str(tool)));
        eff.insert("output_path".into(), json!(file.display().to_string()));

        let server = self.midi_gen.as_ref().ok_or_else(|| unavailable("midi-gen"))?;
        let (_, res) = call_logged(
            &mut self.bus_log,
            server,
            tool.mcp_tool(),
            "generate_part",
            Value::Object(eff.clone()),
            self.call_timeout,
        )
        .await?;
        let envelope = notes::load_notes(&file)?;
        let suggestion = Suggestion {
            version,
            part: tool,
            notes: envelope.notes,
            rationale: rationale_of(&res, tool),
            // midi-gen v3 — детерминированные рукописные паттерны: уверенность
            // алгоритма 1.0; для вероятностных генераторов значение придёт
            // от них самих
            confidence: 1.0,
            source_tool: format!("midi-gen.{}", tool.mcp_tool()),
            params: Value::Object(eff),
            status: SuggestionStatus::Generated,
        };
        self.suggestions.insert(tool, suggestion.clone());
        // §5.3: полный снимок suggestion → manifest (decision: None = generated)
        staging::staging_append(&self.staging_dir, &suggestion)?;
        // C2 (v0.2): превью по конвенции staging/<part>_v<N>.wav — рендерим
        // сразу после генерации (best-effort: нет fluidsynth/soundfont —
        // партия валидна, UI просто не найдёт wav и покажет «нет превью»).
        if let Err(e) = crate::preview::render_preview(&file).await {
            eprintln!("[preview] {} ({})", e, file.display());
        }
        Ok(suggestion)
    }

    /// Контрактная команда: новая версия с изменёнными параметрами.
    /// `params_diff` накладывается на params предыдущей версии (§7.1
    /// proposal: регенерация = тот же вызов с другими params).
    pub async fn regenerate(&mut self, part: Part, params_diff: Value) -> CoreResult<Suggestion> {
        let last = self.suggestions.get(&part).cloned().ok_or_else(|| CoreError::Tool {
            tool: part.mcp_tool().into(),
            message: "нет предыдущей версии — сначала generate_part".into(),
        })?;
        let mut merged = last.params.as_object().cloned().unwrap_or_default();
        if let Some(diff) = params_diff.as_object() {
            for (k, v) in diff {
                merged.insert(k.clone(), v.clone());
            }
        }
        // версию пути предыдущей итерации ядро назначит само заново
        merged.remove("output_path");
        self.generate_part(part, Value::Object(merged)).await
    }

    // --------------------------------------------------- accept / reject ----

    /// Контрактная команда: импортировать партию в сессию движка
    /// (`file.import_midi` на staging-артефакт) + запись решения в
    /// manifest. Порядок контура: adopt_loop ДО accept — клип считается
    /// по текущей темп-карте сессии (факт спайка: length в сэмплах).
    pub async fn accept_part(&mut self, part: Part, version: u64) -> CoreResult<AcceptResult> {
        let current = self.suggestions.get(&part).ok_or_else(|| CoreError::Tool {
            tool: "daw.import_midi".into(),
            message: format!("нет предложения для партии {}", part_str(part)),
        })?;
        if current.version != version {
            return Err(CoreError::Tool {
                tool: "daw.import_midi".into(),
                message: format!("версия {version} не текущая (текущая {})", current.version),
            });
        }
        let mid = self.staging_dir.join(format!("{}_v{version}.mid", part_str(part)));
        if !mid.is_file() {
            return Err(CoreError::Tool {
                tool: "daw.import_midi".into(),
                message: format!("нет стейджинг-артефакта {}", mid.display()),
            });
        }
        let engine = self.engine.as_ref().ok_or_else(|| CoreError::Tool {
            tool: "daw.import_midi".into(),
            message: "движок SoundCraft не подключён (см. get_mcp_slots / Screen 0)".into(),
        })?;
        let (ms, res) = call_logged(
            &mut self.bus_log,
            engine,
            "execute",
            "accept_part",
            json!({"command": "file.import_midi",
                   "params": {"path": mid.display().to_string()}}),
            self.call_timeout,
        )
        .await?;
        let ids: Vec<u64> = res
            .get("tracks")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(|x| x.as_u64()).collect())
            .unwrap_or_default();
        // имена треков (TS-зеркало: imported_tracks: string[] — тост UI)
        let (_, insp) = call_logged(
            &mut self.bus_log,
            engine,
            "inspect_session",
            "accept_part",
            json!({"detail": "full"}),
            self.call_timeout,
        )
        .await?;
        let names: Vec<String> = insp
            .get("tracks")
            .and_then(Value::as_array)
            .map(|tracks| {
                tracks
                    .iter()
                    .filter(|t| t.get("id").and_then(Value::as_u64).map(|id| ids.contains(&id)).unwrap_or(false))
                    .filter_map(|t| t.get("name").and_then(Value::as_str).map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();

        self.suggestions.get_mut(&part).unwrap().status = SuggestionStatus::Accepted;
        staging::staging_log_decision(&self.staging_dir, part, version, SuggestionStatus::Accepted)?;
        println!("[accept] {part:?} v{version}: {} мс, треки {names:?}", ms.as_millis());
        Ok(AcceptResult { imported_tracks: names })
    }

    /// Контрактная команда: пометить версию отклонённой + запись в manifest
    /// (manifest-only: материализации нет).
    pub fn reject_part(&mut self, part: Part, version: u64) -> CoreResult<()> {
        let Some(s) = self.suggestions.get_mut(&part) else {
            return Err(CoreError::Tool {
                tool: part.mcp_tool().into(),
                message: format!("нет предложения для партии {}", part_str(part)),
            });
        };
        if s.version != version {
            return Err(CoreError::Tool {
                tool: part.mcp_tool().into(),
                message: format!("версия {version} не текущая (текущая {})", s.version),
            });
        }
        s.status = SuggestionStatus::Rejected;
        staging::staging_log_decision(&self.staging_dir, part, version, SuggestionStatus::Rejected)?;
        Ok(())
    }

    // ----------------------------------------------- get_bus_state и пр. ----

    /// Контрактная команда: состояние DAW-сессии из движка (inspect full).
    /// Движок не подключён → engine: down, поля пустые (Screen 0).
    pub async fn get_bus_state(&mut self) -> BusState {
        let Some(engine) = self.engine.as_ref() else {
            return BusState {
                tempo: None,
                key_marker: None,
                tracks: vec![],
                engine: EngineState::Down,
                session_name: None,
            };
        };
        let Ok((_, v)) = call_logged(
            &mut self.bus_log,
            engine,
            "inspect_session",
            "get_bus_state",
            json!({"detail": "full"}),
            self.call_timeout,
        )
        .await
        else {
            return BusState {
                tempo: None,
                key_marker: None,
                tracks: vec![],
                engine: EngineState::Down,
                session_name: None,
            };
        };
        // tempo = МАССИВ событий темп-карты [{bpm, tick}] — берём последнее
        let tempo = v
            .get("tempo")
            .and_then(Value::as_array)
            .and_then(|a| a.last())
            .and_then(|e| e.get("bpm"))
            .and_then(Value::as_f64);
        // key-маркер — конвенция имени "Key: <тональность>" (adopt_loop)
        let key_marker = v
            .get("markers")
            .and_then(Value::as_array)
            .and_then(|ms| {
                ms.iter().rev().find_map(|m| {
                    m.get("name")
                        .and_then(Value::as_str)
                        .filter(|n| n.starts_with("Key: "))
                        .map(|n| n["Key: ".len()..].trim().to_string())
                })
            });
        // компактная проекция треков (TS tracks: unknown[])
        let tracks: Vec<Value> = v
            .get("tracks")
            .and_then(Value::as_array)
            .map(|ts| {
                ts.iter()
                    .map(|t| {
                        json!({
                            "id": t.get("id"),
                            "name": t.get("name"),
                            "kind": t.get("kind"),
                            "instrument": t.get("instrument"),
                            "clips": t.get("clips").and_then(Value::as_array).map(|cs| {
                                cs.iter().map(|c| json!({
                                    "start": c.get("start"),
                                    "end": c.get("end"),
                                    "notes": c.get("notes"),
                                })).collect::<Vec<_>>()
                            }).unwrap_or_default(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        BusState {
            tempo,
            key_marker,
            tracks,
            engine: EngineState::Up,
            session_name: v.get("name").and_then(Value::as_str).map(str::to_string),
        }
    }

    /// Контрактная команда **Self-Check** (PRD §4): сравнить баунс с
    /// последним проанализированным лупом. Relative-key equivalence —
    /// правило №7 (A minor ≡ C major); темп допускает ×2/÷2 hat-lock
    /// (урок full-track v3: hat-секта на 60 BPM детектится как 120).
    pub async fn run_self_check(&mut self, bounce_path: &Path) -> CoreResult<SelfCheckReport> {
        let loop_xray = self.last_loop_xray.clone().ok_or_else(|| CoreError::Tool {
            tool: "run_self_check".into(),
            message: "нет эталона — сначала analyze_loop(loop.wav)".into(),
        })?;
        let bounce = self.analyze_loop(bounce_path).await?;
        let key_match = keys::keys_match(&loop_xray.key, &bounce.key);
        let tempo_match = tempo_match(loop_xray.bpm, bounce.bpm);
        let lufs_delta = round2(bounce.lufs - loop_xray.lufs);
        let mut bands_delta = Map::new();
        for (name, v) in &bounce.bands {
            if let Some(base) = loop_xray.bands.get(name) {
                bands_delta.insert(name.clone(), json!(round2(v - base)));
            }
        }
        Ok(SelfCheckReport {
            key_match,
            tempo_match,
            lufs_delta,
            bands_delta: Value::Object(bands_delta),
            verdict: if key_match && tempo_match { "ok" } else { "fail" }.into(),
        })
    }

    /// Быстрая проверка живости слотов (Screen 0 «Разбудить движок»).
    /// ВНЕ ipc-контракта: снимок MCP-слотов шины для AI Dock/инспектора.
    pub async fn get_mcp_slots(&self) -> Value {
        let mut servers = Vec::new();
        for (slot, server) in
            [("audio-analyzer", &self.audio_analyzer), ("midi-gen", &self.midi_gen)]
        {
            let entry = match server {
                Some(s) => match s.tool_names().await {
                    Ok(tools) => json!({"slot": slot, "alive": true, "tools": tools}),
                    Err(e) => json!({"slot": slot, "alive": false, "error": e.to_string()}),
                },
                None => json!({"slot": slot, "alive": false,
                               "error": "не подключён (бинарь не найден или initialize не прошёл)"}),
            };
            servers.push(entry);
        }
        json!({"servers": servers})
    }

    pub async fn health(&self) -> Value {
        json!({"ok": self.audio_analyzer.is_some() || self.midi_gen.is_some()})
    }

    /// Новая пустая сессия в движке (headless-воркфлоу — follow-up спайка:
    /// create/save/open внутри roots работает). Best-effort при старте кокпита.
    pub async fn session_new(&mut self, name: &str) -> CoreResult<Value> {
        let engine = self.engine.as_ref().ok_or_else(|| CoreError::Tool {
            tool: "new_session".into(),
            message: "движок SoundCraft не подключён".into(),
        })?;
        let (_, v) = call_logged(
            &mut self.bus_log,
            engine,
            "new_session",
            "session_new",
            json!({"name": name, "sample_rate": 44100, "template": "blank"}),
            self.call_timeout,
        )
        .await?;
        Ok(v)
    }

    /// Bounce сессии движком (`file.bounce_mix`) — правило №5: ядро
    /// оркестрирует, не синтезирует. Путь — внутри automation-roots.
    pub async fn bounce_engine(&mut self, path: &Path) -> CoreResult<Value> {
        let engine = self.engine.as_ref().ok_or_else(|| CoreError::Tool {
            tool: "file.bounce_mix".into(),
            message: "движок SoundCraft не подключён".into(),
        })?;
        let (_, v) = call_logged(
            &mut self.bus_log,
            engine,
            "execute",
            "bounce_engine",
            json!({"command": "file.bounce_mix",
                   "params": {"path": path.display().to_string(), "format": "wav"}}),
            self.call_timeout,
        )
        .await?;
        Ok(v)
    }

    /// Превью-партии: оффлайн-рендер staging-.mid в WAV сайдкаром FluidSynth
    /// (правило №5: ядро не синтезирует, только оркестрирует; фронт
    /// проигрывает готовый WAV). Не входит в ipc-контракт v0.1 — внутренний
    /// метод ядра для двухступенчатой аудиции (§10.2).
    pub async fn render_preview(&self, mid_path: &Path) -> CoreResult<PathBuf> {
        crate::preview::render_preview(mid_path).await
    }

    /// Забрать накопленный журнал шины (источник Tauri-события bus_log).
    pub fn take_bus_log(&mut self) -> Vec<BusLog> {
        self.bus_log.drain(..).collect()
    }

    pub fn staging_dir(&self) -> &Path {
        &self.staging_dir
    }

    /// Грейсфулл-шатдаун всех серверов шины.
    pub async fn shutdown(self) {
        if let Some(s) = self.audio_analyzer {
            s.shutdown().await;
        }
        if let Some(s) = self.midi_gen {
            s.shutdown().await;
        }
    }

    /// Текущее предложение партии (источник события suggestion_updated).
    pub fn suggestion(&self, part: Part) -> Option<&Suggestion> {
        self.suggestions.get(&part)
    }

    // ------------------------------------------------------- внутреннее ----

    fn ensure_staging(&self) -> CoreResult<()> {
        std::fs::create_dir_all(&self.staging_dir).map_err(|e| CoreError::Tool {
            tool: "staging".into(),
            message: format!("не создал {}: {e}", self.staging_dir.display()),
        })
    }
}

/// Вызов с журналированием (событие bus_log: ts/tool/command/status/ms).
/// Свободная функция: журнал и сервер — разные поля фасада, так borrow-
/// checker пускает одновременный `&mut bus_log` и `&server`.
async fn call_logged(
    log: &mut VecDeque<BusLog>,
    server: &BusServer,
    tool: &str,
    command: &str,
    args: Value,
    timeout: Duration,
) -> CoreResult<(Duration, Value)> {
    let started = std::time::Instant::now();
    let res = server
        .call_json(tool, args.as_object().cloned().unwrap_or_default(), timeout)
        .await;
    let ms = started.elapsed();
    let status = match &res {
        Ok(_) => BusLogStatus::Ok,
        Err(CoreError::Timeout { .. }) => BusLogStatus::Timeout,
        Err(_) => BusLogStatus::Error,
    };
    log.push_back(BusLog {
        ts: now_ms(),
        tool: tool.into(),
        command: command.into(),
        status,
        ms: ms.as_millis() as u64,
    });
    res.map(|v| (ms, v))
}

fn part_str(part: Part) -> &'static str {
    match part {
        Part::Bass => "bass",
        Part::Chords => "chords",
        Part::Drums => "drums",
    }
}

fn rationale_of(res: &Value, part: Part) -> String {
    let key = res.get("key").and_then(Value::as_str).unwrap_or("?");
    let bpm = res.get("bpm").cloned().unwrap_or(json!("?"));
    match part {
        Part::Bass => {
            let style = res.get("style").and_then(Value::as_str).unwrap_or("basic");
            format!("{style} бас в {key} @ {bpm} BPM (midi-gen v3, детерминированный)")
        }
        Part::Chords => {
            let motion = res.get("max_voice_motion").cloned().unwrap_or(json!("?"));
            format!("voiceled прогрессия в {key} @ {bpm} BPM, движение голосов ≤ {motion} пт")
        }
        Part::Drums => {
            let hits = res.get("hits").cloned().unwrap_or(json!("?"));
            format!("базовый бит @ {bpm} BPM, {hits} ударов (GM канал 10)")
        }
    }
}

/// ±1 BPM или классический ×2/÷2 hat-lock.
fn tempo_match(a: f64, b: f64) -> bool {
    if (a - b).abs() <= 1.0 {
        return true;
    }
    let ratio = b / a;
    (ratio - 2.0).abs() <= 0.06 || (ratio - 0.5).abs() <= 0.03
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}


fn unavailable(slot: &str) -> CoreError {
    CoreError::Tool {
        tool: slot.into(),
        message: "сервер слота не подключён (см. get_mcp_slots)".into(),
    }
}

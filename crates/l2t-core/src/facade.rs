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
    AcceptResult, AdoptResult, BusLog, BusLogStatus, BusState, EngineState, ExportTrackOutput,
    LoudnessSource, MasteringApplied, MasteringReport, MasteringVerdict, MasterTarget, Part,
    SelfCheckReport, Suggestion, SuggestionStatus, XRayReport, ON_TARGET_LU, SILENCE_LUFS,
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
    /// Конфиг слота движка — для служебных процессов (точный гейн экспорта
    /// v0.2.2 поднимает второй движок с теми же roots).
    engine_config: Option<ServerConfig>,
    call_timeout: Duration,
    staging_dir: PathBuf,
    /// Текущее (последнее) предложение по каждой партии.
    suggestions: HashMap<Part, Suggestion>,
    /// Последний проанализированный луп — эталон run_self_check.
    last_loop_xray: Option<XRayReport>,
    /// Рабочая сессия пользователя (файл .scraft в automation-roots).
    /// None = сессия не открыта (автосейв пропускается).
    session_path: Option<PathBuf>,
    /// Журнал шины (источник Tauri-события bus_log).
    bus_log: VecDeque<BusLog>,
}

impl CockpitCore {
    /// Прод-подключение кокпита: analyzer + midi-gen + ратифицированный
    /// движок (roots на workspace владельца) + staging ВНУТРИ workspace
    /// (правило №1: песочница движка должна покрывать стейджинг — иначе
    /// импорт партий отвергается, факт e2e). Битые слоты не убивают ядро.
    pub async fn connect() -> Self {
        let ws = crate::config::resolve_soundcraft_workspace();
        // roots движка должны существовать до его старта (факт спайка)
        let _ = std::fs::create_dir_all(&ws);
        let mut core = Self::connect_in(
            resolve_audio_analyzer(),
            resolve_midi_gen(),
            ws.join("staging"),
        )
        .await;
        if crate::config::resolve_soundcraft().command.is_file() {
            if let Err(e) = core.attach_engine(crate::config::resolve_soundcraft()).await {
                eprintln!("[engine] не поднялся: {e}");
            } else {
                let session = crate::config::resolve_session_path(&ws);
                if let Err(e) = core.session_open_or_create(&session).await {
                    eprintln!("[engine] рабочая сессия не открылась: {e}");
                }
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
            engine_config: None,
            call_timeout: DEFAULT_CALL_TIMEOUT,
            staging_dir,
            suggestions: HashMap::new(),
            last_loop_xray: None,
            session_path: None,
            bus_log: VecDeque::new(),
        }
    }

    /// Подключить слот «Движок» (SoundCraft standalone). Битый движок не
    /// убивает ядро — get_bus_state останется Down.
    pub async fn attach_engine(&mut self, config: ServerConfig) -> CoreResult<()> {
        let server = BusServer::connect(config.clone()).await?;
        self.engine = Some(server);
        self.engine_config = Some(config);
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
        let rhythm = self
            .analyzer_text(path, "rhythm_analysis", "analyze_loop")
            .await?;
        let info = self
            .analyzer_text(path, "audio_info", "analyze_loop")
            .await?;
        let spectral = self
            .analyzer_text(path, "spectral_features", "analyze_loop")
            .await?;
        let harmonic = self
            .analyzer_text(path, "harmonic_analysis", "analyze_loop")
            .await?;
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
        const NOT_UP: &str = "движок SoundCraft не подключён (см. get_mcp_slots / Screen 0)";

        let (ms, _) = call_logged(
            &mut self.bus_log,
            self.engine.as_ref().ok_or_else(|| CoreError::Tool { tool: "daw".into(), message: NOT_UP.into() })?,
            "execute",
            "adopt_loop",
            json!({"command": "event.tempo", "params": {"bpm": bpm}}),
            self.call_timeout,
        )
        .await?;
        let marker = format!("Key: {key}");
        // повторный adopt не копит дубли: старые key-маркеры стираем
        delete_stale_key_markers(
            &mut self.bus_log,
            self.engine.as_ref().ok_or_else(|| CoreError::Tool { tool: "daw".into(), message: NOT_UP.into() })?,
            &marker,
            self.call_timeout,
        )
        .await;
        let (_, marker_res) = call_logged(
            &mut self.bus_log,
            self.engine.as_ref().ok_or_else(|| CoreError::Tool { tool: "daw".into(), message: NOT_UP.into() })?,
            "execute",
            "adopt_loop",
            json!({"command": "markers.add",
                   "params": {"name": marker, "at": 0, "kind": "key"}}),
            self.call_timeout,
        )
        .await?;
        // автосейв: adoption — изменение сессии пользователя, файл должен
        // быть актуален сразу (падение процесса не теряет adopt)
        if let Err(e) = self.session_save().await {
            eprintln!("[adopt_loop] автосейв не удался (изменение живо в памяти движка): {e}");
        }
        println!(
            "[adopt_loop] {key} @ {bpm} BPM от {source:?}: {} мс, маркер {marker} ({marker_res})",
            ms.as_millis()
        );
        Ok(AdoptResult { tempo: bpm, marker })
    }

    /// Вызов суб-инструмента analyzer с журналированием; текст отчёта.
    /// `command` — команда кокпита, из-за которой идёт вызов (журнал шины).
    async fn analyzer_text(
        &mut self,
        path: &Path,
        tool: &str,
        command: &str,
    ) -> CoreResult<String> {
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
            command,
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

    /// Громкость файла по analyzer — повторная проверка экспорта с целью.
    /// Не касается `last_loop_xray`: эталон Self-Check остаётся лупом, а не
    /// экспортом. `None` — слот analyzer не жив либо отчёт не читается
    /// (ошибка остаётся в журнале шины).
    async fn measure_lufs(&mut self, path: &Path) -> Option<f64> {
        let spectral = self
            .analyzer_text(path, "spectral_features", "export_track")
            .await
            .ok()?;
        let lufs = ap::loudness_of(&spectral).ok()?.0;
        lufs.is_finite().then_some(lufs)
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
        // идемпотентность: повторный Accept той же версии не плодит дубль-трек
        // (пользователь может кликнуть дважды; import_midi каждый раз создаёт
        // новый трек — факт спайка)
        if current.status == SuggestionStatus::Accepted {
            return Err(CoreError::Tool {
                tool: "daw.import_midi".into(),
                message: format!(
                    "партия {} v{version} уже принята в сессию; для новой версии жми Regenerate",
                    part_str(part)
                ),
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
        // автосейв: партия уже в сессии движка — файл должен это помнить.
        // Best-effort: контрактный ответ (импортировано) уже истинен; неудача
        // сохранения не откатывает его (следующий автосейв догонит).
        if let Err(e) = self.session_save().await {
            eprintln!("[accept] автосейв не удался (партия жива в памяти движка): {e}");
        }
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

    /// **Рабочая сессия пользователя** (зазор №1 спайка, ратифицировано):
    /// если файл существует — `open_session`, иначе — `new_session` (имя =
    /// стем файла: open всегда берёт стем, факт спайка) + немедленный
    /// `save_session`, чтобы файл существовал с первого запуска. Путь
    /// запоминается — автосейв после adopt/accept пишет в него.
    pub async fn session_open_or_create(&mut self, path: &Path) -> CoreResult<Value> {
        if path.extension().is_none_or(|e| e != "scraft" && e != "scraftz") {
            return Err(CoreError::Tool {
                tool: "session".into(),
                message: format!(
                    "ожидал .scraft/.scraftz, получил {}: расширение сессии обязательно",
                    path.display()
                ),
            });
        }
        let engine = self.engine.as_ref().ok_or_else(|| CoreError::Tool {
            tool: "session".into(),
            message: "движок SoundCraft не подключён".into(),
        })?;
        let v = if path.is_file() {
            let (_, v) = call_logged(
                &mut self.bus_log,
                engine,
                "open_session",
                "session_open",
                json!({"path": path.display().to_string()}),
                self.call_timeout,
            )
            .await?;
            println!("[session] открыта {}: {}", path.display(), v);
            v
        } else {
            let stem = path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "cockpit".into());
            let (_, _) = call_logged(
                &mut self.bus_log,
                engine,
                "new_session",
                "session_new",
                json!({"name": stem, "sample_rate": 44100, "template": "blank"}),
                self.call_timeout,
            )
            .await?;
            let (_, sv) = call_logged(
                &mut self.bus_log,
                engine,
                "save_session",
                "session_save",
                json!({"path": path.display().to_string()}),
                self.call_timeout,
            )
            .await?;
            println!("[session] создана {} ({sv})", path.display());
            json!({"created": true, "name": stem, "path": path.display().to_string()})
        };
        self.session_path = Some(path.to_path_buf());
        Ok(v)
    }

    /// Сохранить рабочую сессию (без сессии — no-op с пометкой).
    pub async fn session_save(&mut self) -> CoreResult<Value> {
        let Some(path) = self.session_path.clone() else {
            return Ok(json!({"saved": false, "reason": "рабочая сессия не открыта"}));
        };
        let engine = self.engine.as_ref().ok_or_else(|| CoreError::Tool {
            tool: "save_session".into(),
            message: "движок SoundCraft не подключён".into(),
        })?;
        let (_, v) = call_logged(
            &mut self.bus_log,
            engine,
            "save_session",
            "session_save",
            json!({"path": path.display().to_string()}),
            self.call_timeout,
        )
        .await?;
        Ok(v)
    }

    /// Путь рабочей сессии (для Tauri-слоя и отчётов).
    pub fn session_path(&self) -> Option<&Path> {
        self.session_path.as_deref()
    }

    /// **Экспорт трека из окна** («Save WAV», принцип владельца: трек уходит
    /// напрямую из приложения): bounce сессии движком в путь экспорта.
    /// Default: `<export-dir>/l2t-export-<время>.wav`, где export-dir =
    /// env L2T_EXPORT_DIR или `<workspace>/export` (внутри automation-roots —
    /// правило №1). С целью громкости (Mastering Targets, контракт v0.2.2)
    /// к отчёту движка добавляется блок `mastering`; при достаточном запасе
    /// по пику цель достигается точным гейном — см. `export_mastered`.
    /// Сессию движка экспорт не меняет.
    pub async fn export_track(
        &mut self,
        output_path: Option<&Path>,
        target: MasterTarget,
    ) -> CoreResult<ExportTrackOutput> {
        let path = match output_path {
            Some(p) => p.to_path_buf(),
            None => {
                let dir = crate::config::resolve_export_dir();
                create_dir(&dir, "export_track")?;
                let stamp = now_ms();
                dir.join(match target {
                    MasterTarget::Bypass => format!("l2t-export-{stamp}.wav"),
                    _ => format!("l2t-export-{}-{stamp}.wav", target.as_str()),
                })
            }
        };
        if let Some(parent) = path.parent() {
            create_dir(parent, "export_track")?;
        }
        let engine = self.engine.as_ref().ok_or_else(|| CoreError::Tool {
            tool: "export_track".into(),
            message: "движок SoundCraft не подключён".into(),
        })?;
        let engine_config = self.engine_config.clone();
        let (report, mastered) = match target.target_lufs() {
            None => (
                bounce_to(&mut self.bus_log, engine, &path, false, self.call_timeout).await?,
                None,
            ),
            Some(target_lufs) => {
                let (report, applied, silent) = export_mastered(
                    &mut self.bus_log,
                    engine,
                    engine_config.as_ref(),
                    &path,
                    target_lufs,
                    self.call_timeout,
                )
                .await?;
                (report, Some((applied, silent)))
            }
        };
        // повторная проверка анализатором: вердикт — по независимому замеру
        let mastering = match (target.target_lufs(), mastered) {
            (Some(target_lufs), Some((applied, silent))) => {
                let (achieved_lufs, measured_by) = match self.measure_lufs(&path).await {
                    Some(lufs) => (lufs, LoudnessSource::Analyzer),
                    None => (report.lufs, LoudnessSource::Engine),
                };
                Some(mastering_report(
                    target_lufs,
                    applied,
                    achieved_lufs,
                    silent,
                    measured_by,
                ))
            }
            _ => None,
        };
        let output = ExportTrackOutput {
            path: path.display().to_string(),
            seconds: report.seconds,
            lufs: report.lufs,
            peak_db: report.peak_db,
            true_peak_db: report.true_peak_db,
            target,
            mastering,
        };
        println!(
            "[export] {} ({:.2} с): {:.2} LUFS, пик {:.2} dBFS{}",
            path.display(),
            output.seconds,
            output.lufs,
            output.peak_db,
            output
                .mastering
                .as_ref()
                .map(|m| format!(
                    ", mastering {}",
                    serde_json::to_string(m).unwrap_or_default()
                ))
                .unwrap_or_default()
        );
        Ok(output)
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


/// Стереть прежние key-маркеры (конвенция «Key: …») перед добавлением
/// нового: повторный adopt_loop не копит дубли. Ошибки отдельных удалений
/// не фатальны (маркер мог исчезнуть). Свободная функция: log и engine —
/// разные поля фасада (disjoint borrows).
async fn delete_stale_key_markers(
    log: &mut VecDeque<BusLog>,
    engine: &BusServer,
    keep: &str,
    timeout: Duration,
) {
    let Ok((_, insp)) = call_logged(
        log, engine, "inspect_session", "adopt_loop",
        json!({"detail": "full"}), timeout,
    )
    .await
    else {
        return;
    };
    let stale: Vec<u64> = insp
        .get("markers")
        .and_then(Value::as_array)
        .map(|ms| {
            ms.iter()
                .filter_map(|m| {
                    let id = m.get("id").and_then(Value::as_u64)?;
                    let name = m.get("name").and_then(Value::as_str)?;
                    (name.starts_with("Key: ") && name != keep).then_some(id)
                })
                .collect()
        })
        .unwrap_or_default();
    for id in stale {
        let _ = call_logged(
            log, engine, "execute", "adopt_loop",
            json!({"command": "markers.delete", "params": {"id": id}}), timeout,
        )
        .await;
    }
}

/// Потолок пика нормализации движка (`file.bounce_mix {normalize}`), dBFS.
const PEAK_CEILING_DBFS: f64 = -0.1;

/// Отчёт движка о bounce (`file.bounce_mix`) — форма контракт-теста движка.
#[derive(Debug, Clone, PartialEq)]
struct BounceReport {
    seconds: f64,
    lufs: f64,
    peak_db: f64,
    true_peak_db: f64,
}

/// Bounce сессии движком в `path`. Сессию не меняет: экспорт читает её,
/// а не редактирует.
async fn bounce_to(
    log: &mut VecDeque<BusLog>,
    engine: &BusServer,
    path: &Path,
    normalize: bool,
    timeout: Duration,
) -> CoreResult<BounceReport> {
    let (_, v) = call_logged(
        log, engine, "execute", "export_track",
        json!({"command": "file.bounce_mix",
               "params": {"path": path.display().to_string(), "format": "wav", "normalize": normalize}}),
        timeout,
    )
    .await?;
    bounce_report(&v)
}

/// Разбор отчёта движка: пропавшее или нечисловое поле — bounded-ошибка,
/// никаких выдуманных значений.
fn bounce_report(v: &Value) -> CoreResult<BounceReport> {
    let number = |key: &str| {
        v.get(key)
            .and_then(Value::as_f64)
            .filter(|x| x.is_finite())
            .ok_or_else(|| CoreError::Tool {
                tool: "file.bounce_mix".into(),
                message: format!("в отчёте bounce нет числа «{key}»: {v}"),
            })
    };
    Ok(BounceReport {
        seconds: number("seconds")?,
        lufs: number("lufs")?,
        peak_db: number("peak_db")?,
        true_peak_db: number("true_peak_db")?,
    })
}

/// Экспорт с целью громкости (Mastering Targets, v0.2.2). Контур: сырой
/// bounce в соседний временный файл → решение (`plan_mastering`) → файл
/// как есть, normalize-потолок по пику либо точный гейн scratch-сессией.
/// Возвращает отчёт о финальном файле, применённый шаг и признак тишины.
async fn export_mastered(
    log: &mut VecDeque<BusLog>,
    engine: &BusServer,
    engine_config: Option<&ServerConfig>,
    path: &Path,
    target_lufs: f64,
    timeout: Duration,
) -> CoreResult<(BounceReport, MasteringApplied, bool)> {
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "l2t-export".into());
    let raw = path.with_file_name(format!(".{stem}.l2t-raw-{}.wav", now_ms()));
    let outcome = async {
        let first = bounce_to(log, engine, &raw, false, timeout).await?;
        let silent = first.lufs <= SILENCE_LUFS;
        match plan_mastering(first.lufs, first.peak_db, target_lufs) {
            MasteringPlan::Untouched => {
                std::fs::rename(&raw, path).map_err(|e| CoreError::Tool {
                    tool: "export_track".into(),
                    message: format!("не перенёс {} в {}: {e}", raw.display(), path.display()),
                })?;
                Ok((first, MasteringApplied::Untouched, silent))
            }
            MasteringPlan::Normalize => {
                let report = bounce_to(log, engine, path, true, timeout).await?;
                Ok((report, MasteringApplied::Normalized, silent))
            }
            MasteringPlan::Gain(gain_db) => {
                let gained = match engine_config {
                    Some(cfg) => scratch_gain(log, engine, cfg, &raw, path, gain_db, timeout).await,
                    None => Err(CoreError::Tool {
                        tool: "export_track".into(),
                        message: "нет конфига движка для служебной scratch-сессии".into(),
                    }),
                };
                match gained {
                    Ok(report) => Ok((report, MasteringApplied::Gain, silent)),
                    // точный гейн — лучшая попытка: без него честно отдаём
                    // сырой bounce (контрактный ответ остаётся истинным)
                    Err(e) => {
                        eprintln!("[export] точный гейн не удался ({e}); экспорт без обработки");
                        std::fs::rename(&raw, path).map_err(|err| CoreError::Tool {
                            tool: "export_track".into(),
                            message: format!(
                                "не перенёс {} в {}: {err}",
                                raw.display(),
                                path.display()
                            ),
                        })?;
                        Ok((first, MasteringApplied::Untouched, silent))
                    }
                }
            }
        }
    }
    .await;
    // сырой bounce — промежуточный файл; после rename его уже нет
    let _ = std::fs::remove_file(&raw);
    outcome
}

/// Точный гейн до цели (v0.2.2, рецепт из разведки): второй процесс
/// движка с теми же roots поднимает служебную scratch-сессию, импортирует
/// сырой bounce, применяет `mix.volume delta_db` на импортированном треке
/// и рендерит финальный файл. Рабочую сессию пользователя не трогает;
/// scratch-сессия живёт в памяти и не сохраняется.
async fn scratch_gain(
    log: &mut VecDeque<BusLog>,
    engine: &BusServer,
    engine_config: &ServerConfig,
    src: &Path,
    dst: &Path,
    gain_db: f64,
    timeout: Duration,
) -> CoreResult<BounceReport> {
    // частота сессии — из рабочей сессии, чтобы импорт лёг без ресемплинга
    let (_, insp) = call_logged(
        log, engine, "inspect_session", "export_track",
        json!({"detail": "summary"}), timeout,
    )
    .await?;
    let sample_rate = insp.get("sample_rate").and_then(Value::as_i64).unwrap_or(48_000);
    let scratch = BusServer::connect(engine_config.clone()).await?;
    let outcome = async {
        let name = format!("l2t-gain-{}", now_ms());
        call_logged(
            log, &scratch, "new_session", "export_track",
            json!({"name": name, "sample_rate": sample_rate, "template": "blank"}),
            timeout,
        )
        .await?;
        let (_, imported) = call_logged(
            log, &scratch, "import_audio", "export_track",
            json!({"path": src.display().to_string()}),
            timeout,
        )
        .await?;
        let track = imported
            .get("imported")
            .and_then(Value::as_array)
            .and_then(|a| a.first())
            .and_then(|e| e.get("track"))
            .and_then(Value::as_u64)
            .ok_or_else(|| CoreError::Tool {
                tool: "export_track".into(),
                message: format!("в ответе import_audio нет трека: {imported}"),
            })?;
        call_logged(
            log, &scratch, "execute", "export_track",
            json!({"command": "mix.volume",
                   "params": {"tracks": [track], "delta_db": round2(gain_db)}}),
            timeout,
        )
        .await?;
        bounce_to(log, &scratch, dst, false, timeout).await
    }
    .await;
    scratch.shutdown().await;
    outcome
}

/// Решение по цели для bounce с измерениями `lufs`/`peak`. Громкость
/// линейно следует чистому гейну (сверено на демо-сессии движка), запас
/// громкости ограничен потолком пика, поэтому решение известно до рендера:
/// хватает запаса — точный гейн до цели; не хватает — normalize-потолок.
#[derive(Debug, Clone, Copy, PartialEq)]
enum MasteringPlan {
    /// Файл остаётся как есть.
    Untouched,
    /// Peak-normalize движком (максимум громкости, ниже цели).
    Normalize,
    /// Точный гейн, дБ (положительный — подъём, отрицательный — ослабление).
    Gain(f64),
}

fn plan_mastering(lufs: f64, peak: f64, target_lufs: f64) -> MasteringPlan {
    // тише гейта EBU R128 громкости нет
    if lufs <= SILENCE_LUFS {
        return MasteringPlan::Untouched;
    }
    let needed = target_lufs - lufs;
    // цель уже достигнута
    if needed.abs() < 0.05 {
        return MasteringPlan::Untouched;
    }
    // пики выше безопасного потолка снимаются всегда, цель ни при чём
    if peak > PEAK_CEILING_DBFS {
        return MasteringPlan::Normalize;
    }
    let headroom = PEAK_CEILING_DBFS - peak;
    if needed > 0.0 {
        if headroom < 0.05 {
            // пик уже на потолке — громче некуда
            MasteringPlan::Untouched
        } else if needed > headroom {
            // запаса до цели не хватает: максимум громкости, дальше лимитер
            MasteringPlan::Normalize
        } else {
            MasteringPlan::Gain(needed)
        }
    } else {
        // ослабление до цели — без ограничений
        MasteringPlan::Gain(needed)
    }
}

/// Отчёт по цели из измерений финального файла.
fn mastering_report(
    target_lufs: f64,
    applied: MasteringApplied,
    achieved_lufs: f64,
    silent: bool,
    measured_by: LoudnessSource,
) -> MasteringReport {
    let achieved_lufs = round2(achieved_lufs);
    let delta = round2(target_lufs - achieved_lufs);
    let verdict = if silent {
        MasteringVerdict::Silent
    } else if delta.abs() <= ON_TARGET_LU {
        MasteringVerdict::OnTarget
    } else if delta > 0.0 {
        MasteringVerdict::BelowTarget
    } else {
        MasteringVerdict::AboveTarget
    };
    MasteringReport {
        target_lufs,
        applied,
        achieved_lufs,
        delta,
        verdict,
        measured_by,
    }
}

fn create_dir(dir: &Path, tool: &str) -> CoreResult<()> {
    std::fs::create_dir_all(dir).map_err(|e| CoreError::Tool {
        tool: tool.into(),
        message: format!("не создал {}: {e}", dir.display()),
    })
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::{APPLE_LUFS, SPOTIFY_LUFS};

    /// Демо-сессия движка v0.20.1: сырой bounce −19.37 LUFS при пике −4.35
    /// (запас до потолка 4.25 дБ), с normalize −15.12 при пике −0.1.
    const DEMO_RAW: (f64, f64) = (-19.37, -4.35);

    /// Spotify −14 требует +5.37 при запасе 4.25 — только normalize-потолок;
    /// Apple −16 требует +3.37 — запаса хватает, и план даёт точный гейн.
    #[test]
    fn plan_normalizes_when_headroom_is_short_and_gains_exactly_otherwise() {
        assert_eq!(
            plan_mastering(DEMO_RAW.0, DEMO_RAW.1, SPOTIFY_LUFS),
            MasteringPlan::Normalize
        );
        match plan_mastering(DEMO_RAW.0, DEMO_RAW.1, APPLE_LUFS) {
            MasteringPlan::Gain(gain) => assert!(
                (gain - 3.37).abs() < 0.01,
                "точный гейн до Apple: {gain}"
            ),
            other => panic!("ожидался точный гейн, получили {other:?}"),
        }
    }

    /// Громкий материал ослабляется до цели точно: гейну вниз ограничений нет.
    #[test]
    fn plan_attenuates_loud_material_to_exact_target() {
        // −14.5 LUFS при пике −1: до Apple −16 не хватает −1.5
        assert_eq!(
            plan_mastering(-14.5, -1.0, APPLE_LUFS),
            MasteringPlan::Gain(-1.5)
        );
    }

    /// Тишина, достигнутая цель и пик на потолке (громче некуда) — файл
    /// остаётся как есть; пики выше потолка нормализуются всегда.
    #[test]
    fn plan_skips_silence_on_target_and_ceiling_cases() {
        assert_eq!(
            plan_mastering(-144.0, -144.0, SPOTIFY_LUFS),
            MasteringPlan::Untouched
        );
        assert_eq!(
            plan_mastering(-14.02, -2.0, SPOTIFY_LUFS),
            MasteringPlan::Untouched,
            "цель достигнута в допуске — рендер не нужен"
        );
        assert_eq!(
            plan_mastering(-15.1, -0.1, SPOTIFY_LUFS),
            MasteringPlan::Untouched,
            "пик на потолке: громче некуда, pointless-рендер не нужен"
        );
        assert_eq!(
            plan_mastering(-20.0, 0.5, APPLE_LUFS),
            MasteringPlan::Normalize,
            "пик выше −0.1 dBFS снимается независимо от цели"
        );
    }

    /// Вердикт следует знаку дельты и допуску; тишина перекрывает всё.
    #[test]
    fn verdict_follows_delta_sign_and_tolerance() {
        let report = |achieved, silent| {
            mastering_report(
                SPOTIFY_LUFS,
                MasteringApplied::Normalized,
                achieved,
                silent,
                LoudnessSource::Analyzer,
            )
        };
        let m = report(-15.1, false);
        assert_eq!(
            (m.achieved_lufs, m.delta, m.verdict),
            (-15.1, 1.1, MasteringVerdict::BelowTarget)
        );
        assert_eq!(report(-14.6, false).verdict, MasteringVerdict::OnTarget);
        // 1.12 LU — уже за допуском 1.0
        assert_eq!(report(-15.12, false).verdict, MasteringVerdict::BelowTarget);
        let loud = report(-12.4, false);
        assert_eq!(
            (loud.delta, loud.verdict),
            (-1.6, MasteringVerdict::AboveTarget)
        );
        assert_eq!(report(-70.0, true).verdict, MasteringVerdict::Silent);
    }

    /// Отчёт движка читается по форме контракт-теста; пропавшее поле —
    /// bounded-ошибка с именем поля.
    #[test]
    fn bounce_report_requires_finite_numbers() {
        let v = json!({
            "bytes": 16095306,
            "lufs": -15.12350845336914,
            "path": "/ws/n.wav",
            "peak_db": -0.10000041872262955,
            "seconds": 55.884,
            "true_peak_db": -0.0775223821401596
        });
        let r = bounce_report(&v).unwrap();
        assert_eq!(r.seconds, 55.884);
        assert_eq!(r.lufs, -15.12350845336914);
        assert_eq!(r.peak_db, -0.10000041872262955);
        assert_eq!(r.true_peak_db, -0.0775223821401596);

        let mut broken = v.clone();
        broken.as_object_mut().unwrap().remove("lufs");
        let err = bounce_report(&broken).unwrap_err().to_string();
        assert!(err.contains("«lufs»"), "текст: {err}");
    }
}

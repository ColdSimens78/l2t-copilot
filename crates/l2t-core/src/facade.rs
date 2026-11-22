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
    AcceptResult, BusLog, BusLogStatus, BusState, EngineState, ManifestEntry, Part,
    SelfCheckReport, Suggestion, SuggestionStatus, XRayReport,
};
use crate::error::{CoreError, CoreResult};
use crate::notes;
use crate::{analyzer_parse as ap, keys};

/// Ядро кокпита: единственный владелец MCP-клиентов шины.
pub struct CockpitCore {
    audio_analyzer: Option<BusServer>,
    midi_gen: Option<BusServer>,
    call_timeout: Duration,
    staging_dir: PathBuf,
    /// Текущее (последнее) предложение по каждой партии.
    suggestions: HashMap<Part, Suggestion>,
    /// Лог решений (staging/manifest.json).
    manifest: Vec<ManifestEntry>,
    /// Последний проанализированный луп — эталон run_self_check.
    last_loop_xray: Option<XRayReport>,
    /// Журнал шины (источник Tauri-события bus_log).
    bus_log: VecDeque<BusLog>,
}

impl CockpitCore {
    /// Поднять серверы шины; стейджинг — во временном каталоге.
    pub async fn connect() -> Self {
        let staging = std::env::temp_dir().join("l2t-staging");
        Self::connect_in(resolve_audio_analyzer(), resolve_midi_gen(), staging).await
    }

    /// Все зависимости — явными аргументами (тесты и будущий Tauri-слой).
    pub async fn connect_in(
        audio_analyzer: ServerConfig,
        midi_gen: ServerConfig,
        staging_dir: PathBuf,
    ) -> Self {
        let audio_analyzer = BusServer::connect(audio_analyzer).await.ok();
        let midi_gen = BusServer::connect(midi_gen).await.ok();
        let manifest = read_manifest(&staging_dir);
        Self {
            audio_analyzer,
            midi_gen,
            call_timeout: DEFAULT_CALL_TIMEOUT,
            staging_dir,
            suggestions: HashMap::new(),
            manifest,
            last_loop_xray: None,
            bus_log: VecDeque::new(),
        }
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

    /// Вызов суб-инструмента analyzer с журналированием; текст отчёта.
    async fn analyzer_text(&mut self, path: &Path, tool: &str) -> CoreResult<String> {
        let server = self
            .audio_analyzer
            .as_ref()
            .ok_or_else(|| unavailable("audio-analyzer"))?;
        let mut args = Map::new();
        args.insert("path".into(), json!(path.display().to_string()));
        let v = call_logged(&mut self.bus_log, server, tool, "analyze_loop", args, self.call_timeout)
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
        let file = self.staging_dir.join(format!("{}_v{version}.mid", part_str(tool)));
        eff.insert("output_path".into(), json!(file.display().to_string()));

        let server = self.midi_gen.as_ref().ok_or_else(|| unavailable("midi-gen"))?;
        let res = call_logged(
            &mut self.bus_log,
            server,
            tool.mcp_tool(),
            "generate_part",
            eff.clone(),
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

    /// Контрактная команда: требует DawBackend.import_midi. Хост-слот —
    /// следующий этап; пока честная bounded-ошибка (решение НЕ логируется:
    /// материализации нет).
    pub fn accept_part(&mut self, part: Part, _version: u64) -> CoreResult<AcceptResult> {
        if !self.suggestions.contains_key(&part) {
            return Err(CoreError::Tool {
                tool: "daw.import_midi".into(),
                message: format!("нет предложения для партии {}", part_str(part)),
            });
        }
        Err(CoreError::Tool {
            tool: "daw.import_midi".into(),
            message: "DAW-хост не подключён (DawBackend — следующий этап); \
                      импорт невозможен, решение не залогировано"
                .into(),
        })
    }

    /// Контрактная команда: пометить версию отклонённой + запись в manifest.
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
        self.manifest.push(ManifestEntry {
            part,
            version,
            decision: SuggestionStatus::Rejected,
            ts: now_ms(),
        });
        write_manifest(&self.staging_dir, &self.manifest)
    }

    // ----------------------------------------------- get_bus_state и пр. ----

    /// Контрактная команда: состояние хоста (daw.get_session). На этапе 1
    /// хоста нет — engine: down, поля пустые (Фронтендер рисует Screen 0).
    pub async fn get_bus_state(&self) -> BusState {
        BusState {
            tempo: None,
            key_marker: None,
            tracks: vec![],
            engine: EngineState::Down,
            session_name: None,
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
    args: Map<String, Value>,
    timeout: Duration,
) -> CoreResult<Value> {
    let started = std::time::Instant::now();
    let res = server.call_json(tool, args, timeout).await;
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
        ms: started.elapsed().as_millis() as u64,
    });
    res
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

fn read_manifest(dir: &Path) -> Vec<ManifestEntry> {
    let path = dir.join("manifest.json");
    std::fs::read(&path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn write_manifest(dir: &Path, entries: &[ManifestEntry]) -> CoreResult<()> {
    std::fs::create_dir_all(dir).map_err(|e| CoreError::Tool {
        tool: "manifest".into(),
        message: format!("не создал {}: {e}", dir.display()),
    })?;
    let path = dir.join("manifest.json");
    let json = serde_json::to_vec_pretty(entries).map_err(|e| CoreError::Tool {
        tool: "manifest".into(),
        message: format!("сериализация manifest: {e}"),
    })?;
    std::fs::write(&path, json).map_err(|e| CoreError::Tool {
        tool: "manifest".into(),
        message: format!("не записал {}: {e}", path.display()),
    })
}

fn unavailable(slot: &str) -> CoreError {
    CoreError::Tool {
        tool: slot.into(),
        message: "сервер слота не подключён (см. get_mcp_slots)".into(),
    }
}

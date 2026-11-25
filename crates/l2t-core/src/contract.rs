//! Rust-реализация ipc-контракта (docs/ipc-contract.md) — serde-типы
//! команд, событий и данных. Это зеркало контракта, НЕ источник: любое
//! изменение схемы = bump версии контракта + согласие мейнтейнера;
//! TS-сторона (ui/src/types/contract.ts) синхронизируется тем же коммитом.
//!
//! Формат нот — только core/midi_io (`{note, start, end, velocity,
//! channel}`, тики, каналы 0-indexed; см. notes.rs — порт load_notes).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

// ---------------------------------------------------------------- данные ----

/// Нота в формате core/midi_io (§ Данные контракта, §5.1 proposal).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Note {
    pub note: u8,
    pub start: u64,
    pub end: u64,
    pub velocity: u8,
    pub channel: u8,
}

/// Партия (§ команда generate_part: tool: 'bass'|'chords'|'drums').
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Part {
    Bass,
    Chords,
    Drums,
}

impl Part {
    /// Инструмент midi-gen, обслуживающий партию.
    pub fn mcp_tool(self) -> &'static str {
        match self {
            Part::Bass => "generate_bassline",
            Part::Chords => "generate_chord_progression",
            Part::Drums => "generate_drum_pattern",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "bass" => Some(Part::Bass),
            "chords" => Some(Part::Chords),
            "drums" => Some(Part::Drums),
            _ => None,
        }
    }
}

/// Жизненный цикл предложения (§5.2): generated → auditioned → accepted | rejected.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SuggestionStatus {
    Generated,
    Auditioned,
    Accepted,
    Rejected,
}

/// Suggestion — «призрачные ноты» как контракт данных (§ Данные).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Suggestion {
    pub version: u64,
    pub part: Part,
    pub notes: Vec<Note>,
    pub rationale: String,
    pub confidence: f64,
    pub source_tool: String,
    /// В точности параметры MCP-инструмента (регенерация = тот же вызов
    /// с другими params).
    pub params: Value,
    pub status: SuggestionStatus,
}

// --------------------------------------------------------------- команды ----

/// Выход `analyze_loop` (Loop X-Ray).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XRayReport {
    pub bpm: f64,
    pub bpm_confidence: f64,
    pub bpm_alt: Option<f64>,
    pub key: String,
    pub key_confidence: f64,
    pub key_relative: Option<String>,
    pub lufs: f64,
    pub true_peak: f64,
    /// Энергия по полосам (sub_bass..brilliance) из spectral_features.
    pub bands: BTreeMap<String, f64>,
    /// Прокси beats/сек из rhythm-отчёта (текстовый режим analyzer не отдаёт
    /// onset-density напрямую; None, если битов не найдено).
    pub onset_density: Option<f64>,
}

/// Выход `get_bus_state` (по daw.get_session; на этапе 1 хоста нет — engine down).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BusState {
    pub tempo: Option<f64>,
    pub key_marker: Option<String>,
    /// Треки хоста (форма уточнится с DawBackend-хостом; пока пусто).
    pub tracks: Vec<Value>,
    pub engine: EngineState,
    /// Имя сессии хоста (C6, ipc-контракт v0.2). Ключ присутствует всегда:
    /// `null`, пока движок не подключён (TS-зеркало: `string | null`).
    #[serde(default)]
    pub session_name: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EngineState {
    Up,
    Waking,
    Down,
}

/// Выход `accept_part`: имена созданных движком треков (TS-зеркало v0.2:
/// `imported_tracks: string[]` — для тоста «импортировано в MIDI 1»).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcceptResult {
    pub imported_tracks: Vec<String>,
}

/// Выход `adopt_loop` (C1, ipc-контракт v0.2): tempo применён, key-маркер
/// создан по конвенции имени `Key: <тональность>` (kind движок
/// нормализует в "Marker", конвенция — в имени).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdoptResult {
    pub tempo: f64,
    /// Имя key-маркера сессии: `Key: <тональность>`.
    pub marker: String,
}

/// Выход `run_self_check`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelfCheckReport {
    pub key_match: bool,
    pub tempo_match: bool,
    pub lufs_delta: f64,
    pub bands_delta: Value,
    pub verdict: String,
}

// ------------------------------------------------- Mastering Targets v0 ----

/// Цель громкости экспорта (v0.2.1): нормализация стриминговых платформ.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MasterTarget {
    /// Без цели: bounce уходит как есть.
    #[serde(rename = "none")]
    Bypass,
    #[serde(rename = "spotify")]
    Spotify,
    #[serde(rename = "apple")]
    Apple,
}

/// Нормализация громкости Spotify, LUFS.
pub const SPOTIFY_LUFS: f64 = -14.0;
/// Нормализация громкости Apple Music (Sound Check), LUFS.
pub const APPLE_LUFS: f64 = -16.0;
/// Допуск вердикта `on_target`, LU.
pub const ON_TARGET_LU: f64 = 1.0;
/// Гейт EBU R128: тише этой громкости измеримой громкости нет.
pub const SILENCE_LUFS: f64 = -70.0;

impl MasterTarget {
    /// Имя цели на проводе (оно же — часть имени файла экспорта).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Bypass => "none",
            Self::Spotify => "spotify",
            Self::Apple => "apple",
        }
    }

    /// Целевая громкость, LUFS; `None` — цель не задана.
    pub fn target_lufs(self) -> Option<f64> {
        match self {
            Self::Bypass => None,
            Self::Spotify => Some(SPOTIFY_LUFS),
            Self::Apple => Some(APPLE_LUFS),
        }
    }
}

/// Что применено к bounce ради цели (`MasteringReport.applied`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MasteringApplied {
    /// Ничего: цели нет, тишина, цель уже достигнута либо громче некуда.
    #[serde(rename = "none")]
    Untouched,
    /// Peak-normalize движком до −0.1 dBFS: максимум громкости, когда
    /// запаса по пику до цели не хватает.
    #[serde(rename = "normalize")]
    Normalized,
    /// Точный гейн до цели (v0.2.2): служебная scratch-сессия движка,
    /// рабочая сессия не затрагивается.
    #[serde(rename = "gain")]
    Gain,
}

/// Вердикт по цели (`MasteringReport.verdict`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MasteringVerdict {
    /// В пределах `ON_TARGET_LU`.
    OnTarget,
    /// Тише цели: пик уже на потолке, чистым гейном дальше нельзя — нужна
    /// компрессия или лимитер.
    BelowTarget,
    /// Громче цели: нужно ослабление, а офлайн-этап v0 умеет только
    /// нормализацию по пику.
    AboveTarget,
    /// Громкости нет (тише гейта EBU R128) — цель неприменима.
    Silent,
}

/// Кто измерил `MasteringReport.achieved_lufs`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LoudnessSource {
    Analyzer,
    Engine,
}

/// Отчёт о целевой громкости экспорта. С v0.2.2 цель достигается точно
/// (точный гейн), когда хватает запаса по пику; иначе — normalize-потолок
/// и честная дистанция в `delta`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MasteringReport {
    pub target_lufs: f64,
    pub applied: MasteringApplied,
    /// Громкость финального файла: повторный замер analyzer, а если его
    /// слот не жив — отчёт движка (см. `measured_by`).
    pub achieved_lufs: f64,
    /// `target_lufs − achieved_lufs`: больше нуля — тише цели, меньше — громче.
    pub delta: f64,
    pub verdict: MasteringVerdict,
    pub measured_by: LoudnessSource,
}

/// Выход `export_track`: отчёт движка о финальном файле и блок цели.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExportTrackOutput {
    pub path: String,
    pub seconds: f64,
    pub lufs: f64,
    pub peak_db: f64,
    pub true_peak_db: f64,
    /// Цель экспорта; `none` — без мастеринга.
    pub target: MasterTarget,
    /// `None`, если `target` = `none` (ключ на проводе есть всегда).
    pub mastering: Option<MasteringReport>,
}

// Входы команд — имена полей 1:1 с TS-зеркалом (ui/src/types/contract.ts,
// `*Input`), snake_case. На проводе Tauri-адаптер передаёт вход одним
// объектом: `invoke("<command>", { input })` — команды принимают `input`.

/// Вход `analyze_loop`.
#[derive(Debug, Clone, Deserialize)]
pub struct AnalyzeLoopInput {
    pub path: String,
    /// v0.2 (C5): скопировать файл в workspace при drop извне песочницы.
    #[serde(default)]
    pub copy_into_workspace: Option<bool>,
}

/// Вход `generate_part`.
#[derive(Debug, Clone, Deserialize)]
pub struct GeneratePartParams {
    pub tool: Part,
    pub params: Value,
}

/// Вход `regenerate`.
#[derive(Debug, Clone, Deserialize)]
pub struct RegenerateParams {
    pub part: Part,
    pub params_diff: Value,
}

/// Вход `accept_part` / `reject_part`.
#[derive(Debug, Clone, Deserialize)]
pub struct PartVersion {
    pub part: Part,
    pub version: u64,
}

/// Вход `adopt_loop` (C1).
#[derive(Debug, Clone, Deserialize)]
pub struct AdoptLoopParams {
    pub bpm: f64,
    pub key: String,
    pub source: String,
}

/// Вход `run_self_check`.
#[derive(Debug, Clone, Deserialize)]
pub struct RunSelfCheckInput {
    pub bounce_path: String,
}

/// Вход `export_track` (v0.2.1).
#[derive(Debug, Clone, Default, Deserialize)]
pub struct ExportTrackInput {
    /// Путь WAV внутри workspace движка; по умолчанию ядро назначает
    /// `<export-dir>/l2t-export-<время>.wav`.
    #[serde(default)]
    pub output_path: Option<String>,
    /// Цель громкости; по умолчанию `none`.
    #[serde(default)]
    pub target: Option<MasterTarget>,
}

// --------------------------------------------------------------- события ----

/// `bus_log` — каждый вызов шины с таймингом (для AI Dock и инспектора).
#[derive(Debug, Clone, Serialize)]
pub struct BusLog {
    /// Unix-ms.
    pub ts: u64,
    pub tool: String,
    pub command: String,
    pub status: BusLogStatus,
    pub ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BusLogStatus {
    Ok,
    Timeout,
    Error,
}

impl BusLogStatus {
    pub fn is_ok(self) -> bool {
        matches!(self, BusLogStatus::Ok)
    }
}

/// `suggestion_updated`.
#[derive(Debug, Clone, Serialize)]
pub struct SuggestionUpdated {
    pub part: Part,
    pub version: u64,
    pub suggestion: Suggestion,
}

/// `host_status`.
#[derive(Debug, Clone, Serialize)]
pub struct HostStatus {
    pub engine: EngineState,
}

// ------------------------------------------------------------ manifest ------

/// Запись staging/manifest.json (§5.3 proposal, Acceptance Rate): полный
/// снимок suggestion-инстанса + решение (None = ещё не решено).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestRecord {
    pub suggestion: Suggestion,
    /// None = generated (ожидает решения); Some = решено.
    pub decision: Option<SuggestionStatus>,
    /// Unix-ms последнего изменения записи.
    pub ts: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Сериализация Suggestion обязана совпадать с примером из контракта
    /// (§ Данные) — поле-в-поле, snake_case, статусы lowercase.
    #[test]
    fn suggestion_serializes_like_contract_example() {
        let s = Suggestion {
            version: 2,
            part: Part::Bass,
            notes: vec![Note { note: 45, start: 0, end: 240, velocity: 100, channel: 0 }],
            rationale: "синкопа на 1.5/3.5 с, корень Am".into(),
            confidence: 0.84,
            source_tool: "midi-gen.generate_bassline".into(),
            params: serde_json::json!({"bpm": 90, "key": "A minor"}),
            status: SuggestionStatus::Generated,
        };
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["version"], serde_json::json!(2));
        assert_eq!(v["part"], serde_json::json!("bass"));
        assert_eq!(v["status"], serde_json::json!("generated"));
        assert_eq!(v["notes"][0]["note"], serde_json::json!(45));
        assert_eq!(v["notes"][0]["end"], serde_json::json!(240));
    }

    #[test]
    fn part_tool_mapping() {
        assert_eq!(Part::parse("drums"), Some(Part::Drums));
        assert_eq!(Part::parse("pad"), None);
        assert_eq!(Part::Bass.mcp_tool(), "generate_bassline");
        assert_eq!(Part::Chords.mcp_tool(), "generate_chord_progression");
        assert_eq!(Part::Drums.mcp_tool(), "generate_drum_pattern");
    }

    #[test]
    fn bus_state_serializes_engine_lowercase() {
        let v = serde_json::to_value(BusState {
            tempo: None,
            key_marker: None,
            tracks: vec![],
            engine: EngineState::Down,
            session_name: None,
        })
        .unwrap();
        assert_eq!(v["engine"], serde_json::json!("down"));
        // C6 (v0.2): ключ session_name присутствует всегда — null без движка
        // (TS-зеркало: `session_name: string | null`)
        assert!(v.get("session_name").is_some(), "ключ session_name обязан быть");
        assert!(v["session_name"].is_null());
    }

    /// Входы команд обязаны читаться из того JSON, что шлёт Tauri-адаптер
    /// (ui/src/ipc/tauri-adapter.ts: `invoke(cmd, { input })`), а выходы —
    /// сериализоваться в форму TS-зеркала. Ловит расхождение сторон на
    /// уровне имён полей без запуска окна.
    #[test]
    fn inputs_match_ts_mirror() {
        let x: AnalyzeLoopInput =
            serde_json::from_value(serde_json::json!({"path": "/l.wav"})).unwrap();
        assert_eq!(x.path, "/l.wav");
        assert_eq!(x.copy_into_workspace, None, "C5-флаг опционален");
        let x: AnalyzeLoopInput =
            serde_json::from_value(serde_json::json!({"path": "/l.wav", "copy_into_workspace": true}))
                .unwrap();
        assert_eq!(x.copy_into_workspace, Some(true));

        let x: GeneratePartParams =
            serde_json::from_value(serde_json::json!({"tool": "drums", "params": {"bpm": 90}}))
                .unwrap();
        assert_eq!(x.tool, Part::Drums);

        let x: RegenerateParams = serde_json::from_value(
            serde_json::json!({"part": "bass", "params_diff": {"style": "octaves"}}),
        )
        .unwrap();
        assert_eq!(x.part, Part::Bass);

        let x: PartVersion =
            serde_json::from_value(serde_json::json!({"part": "chords", "version": 2})).unwrap();
        assert_eq!((x.part, x.version), (Part::Chords, 2));

        let x: AdoptLoopParams = serde_json::from_value(serde_json::json!({
            "bpm": 94.5, "key": "D minor", "source": "x-ray"
        }))
        .unwrap();
        assert_eq!((x.bpm, x.key.as_str()), (94.5, "D minor"));

        let x: RunSelfCheckInput =
            serde_json::from_value(serde_json::json!({"bounce_path": "/b.wav"})).unwrap();
        assert_eq!(x.bounce_path, "/b.wav");

        // неизвестная партия — ошибка десериализации, а не молчаливый bass
        assert!(serde_json::from_value::<PartVersion>(
            serde_json::json!({"part": "pad", "version": 1})
        )
        .is_err());
    }

    /// AdoptLoopOutput TS-зеркала: `{tempo: number, marker: string}`.
    #[test]
    fn adopt_result_serializes_tempo_and_marker() {
        let v = serde_json::to_value(AdoptResult { tempo: 94.0, marker: "Key: D minor".into() })
            .unwrap();
        assert_eq!(v, serde_json::json!({"tempo": 94.0, "marker": "Key: D minor"}));
    }

    /// v0.2.1: цели на проводе — те же строки, что в TS-зеркале, у каждой
    /// ровно одна LUFS-константа.
    #[test]
    fn master_targets_roundtrip_with_lufs() {
        for (wire, lufs) in [
            ("none", None),
            ("spotify", Some(-14.0)),
            ("apple", Some(-16.0)),
        ] {
            let t: MasterTarget = serde_json::from_value(serde_json::json!(wire)).unwrap();
            assert_eq!(serde_json::to_value(t).unwrap(), serde_json::json!(wire));
            assert_eq!(t.target_lufs(), lufs);
            assert_eq!(t.as_str(), wire);
        }
        // неизвестная цель — ошибка десериализации, а не молчаливый none
        assert!(serde_json::from_value::<MasterTarget>(serde_json::json!("tidal")).is_err());
    }

    /// v0.2.1: вход export_track читается и из пустого input (все поля
    /// опциональны), и из полной формы адаптера.
    #[test]
    fn export_track_input_defaults_and_full_form() {
        let x: ExportTrackInput = serde_json::from_value(serde_json::json!({})).unwrap();
        assert_eq!((x.output_path.clone(), x.target), (None, None));

        let x: ExportTrackInput = serde_json::from_value(serde_json::json!({
            "output_path": "/ws/export/track.wav", "target": "spotify"
        }))
        .unwrap();
        assert_eq!(x.output_path.as_deref(), Some("/ws/export/track.wav"));
        assert_eq!(x.target, Some(MasterTarget::Spotify));
    }

    /// v0.2.1: выход export_track — форма TS-зеркала `ExportTrackOutput`;
    /// без цели `mastering` = null, но ключ на проводе есть.
    #[test]
    fn export_track_output_serializes_like_ts_mirror() {
        let plain = ExportTrackOutput {
            path: "/ws/export/a.wav".into(),
            seconds: 55.884,
            lufs: -19.37,
            peak_db: -4.35,
            true_peak_db: -4.32,
            target: MasterTarget::Bypass,
            mastering: None,
        };
        let v = serde_json::to_value(&plain).unwrap();
        assert_eq!(
            v.as_object().map(|o| o.len()),
            Some(7),
            "путь + отчёт движка (4) + target + mastering: {v}"
        );
        assert_eq!(v["target"], serde_json::json!("none"));
        assert!(v.get("mastering").is_some() && v["mastering"].is_null());

        let mastered = ExportTrackOutput {
            target: MasterTarget::Spotify,
            mastering: Some(MasteringReport {
                target_lufs: SPOTIFY_LUFS,
                applied: MasteringApplied::Normalized,
                achieved_lufs: -15.1,
                delta: 1.1,
                verdict: MasteringVerdict::BelowTarget,
                measured_by: LoudnessSource::Analyzer,
            }),
            ..plain.clone()
        };
        let v = serde_json::to_value(&mastered).unwrap();
        assert_eq!(v["target"], serde_json::json!("spotify"));
        assert_eq!(
            v["mastering"],
            serde_json::json!({
                "target_lufs": -14.0,
                "applied": "normalize",
                "achieved_lufs": -15.1,
                "delta": 1.1,
                "verdict": "below_target",
                "measured_by": "analyzer",
            })
        );
    }
}

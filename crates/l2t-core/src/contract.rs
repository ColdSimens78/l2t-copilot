//! Rust-реализация ipc-контракта v0.1 (docs/ipc-contract.md) — serde-типы
//! команд, событий и данных. Это зеркало контракта, НЕ источник: любое
//! изменение схемы = bump версии контракта + предложение в память +
//! согласие Папы; TS-сторона (ui/src/types/contract.ts) синхронизируется
//! тем же коммитом.
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
    /// Имя сессии хоста (C6, ipc-контракт v0.2); None, пока хост не подключён.
    #[serde(default, skip_serializing_if = "Option::is_none")]
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
    pub marker_name: String,
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

/// Вход `analyze_loop` / `run_self_check`.
#[derive(Debug, Clone, Deserialize)]
pub struct PathParams {
    pub path: String,
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
        // C6 (v0.2): session_name опционален — отсутствует, а не null
        assert!(v.get("session_name").is_none());
    }
}

//! l2t-core — Rust-ядро кокпита L2T: единственный владелец MCP-клиентов
//! шины (stdio), типизированные команды-фасады для Tauri IPC (§6 proposal
//! v0.3). Без tauri-зависимости: webkit2gtk-dev не нужен, `cargo test`
//! собирается и проходит на чистом окружении.
//!
//! Слоты этапа 1: audio-analyzer («уши»), midi-gen («руки»). Контракт шины
//! (7 правил README) — per-call таймаут, таймаут ≠ отказ → авто-инспект,
//! bounded-ошибки текстом, сессия — источник истины (генераторы зовутся
//! без вшивания темпа — это их контракт, ядро его не нарушает).

pub mod analyzer_parse;
pub mod bus;
pub mod config;
pub mod contract;
pub mod error;
pub mod facade;
pub mod keys;
pub mod notes;
pub mod preview;
pub mod staging;

pub use bus::{BusServer, DEFAULT_CALL_TIMEOUT, INSPECT_TIMEOUT};
pub use config::{
    resolve_audio_analyzer, resolve_export_dir, resolve_midi_gen, resolve_session_path,
    resolve_soundcraft, resolve_soundcraft_workspace, ServerConfig, SESSION_STEM,
};
pub use contract::{
    AcceptResult, AdoptLoopParams, AdoptResult, AnalyzeLoopInput, BusLog, BusState, EngineState,
    ExportTrackInput, ExportTrackOutput, GeneratePartParams, LoudnessSource, MasteringApplied,
    MasteringReport, MasteringVerdict, MasterTarget, Note, Part, PartVersion, RegenerateParams,
    RunSelfCheckInput, SelfCheckReport, Suggestion, SuggestionStatus, XRayReport, APPLE_LUFS,
    ON_TARGET_LU, SILENCE_LUFS, SPOTIFY_LUFS,
};
pub use error::{CoreError, CoreResult};
pub use facade::CockpitCore;
pub use preview::render_preview;

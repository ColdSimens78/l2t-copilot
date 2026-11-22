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

pub use bus::{BusServer, DEFAULT_CALL_TIMEOUT, INSPECT_TIMEOUT};
pub use config::{resolve_audio_analyzer, resolve_midi_gen, ServerConfig};
pub use contract::{
    AcceptResult, BusLog, BusState, EngineState, Note, Part, SelfCheckReport, Suggestion,
    SuggestionStatus, XRayReport,
};
pub use error::{CoreError, CoreResult};
pub use facade::CockpitCore;
pub use preview::render_preview;

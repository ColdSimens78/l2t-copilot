//! l2t-core — Rust-ядро кокпита L2T: единственный владелец MCP-клиентов
//! шины (stdio), типизированные команды-фасады для Tauri IPC (§6 proposal
//! v0.3). Без tauri-зависимости: webkit2gtk-dev не нужен, `cargo test`
//! собирается и проходит на чистом окружении.
//!
//! Слоты этапа 1: audio-analyzer («уши»), midi-gen («руки»). Контракт шины
//! (7 правил README) — per-call таймаут, таймаут ≠ отказ → авто-инспект,
//! bounded-ошибки текстом, сессия — источник истины (генераторы зовутся
//! без вшивания темпа — это их контракт, ядро его не нарушает).

pub mod bus;
pub mod config;
pub mod error;
pub mod facade;

pub use bus::{BusServer, DEFAULT_CALL_TIMEOUT, INSPECT_TIMEOUT};
pub use config::{resolve_audio_analyzer, resolve_midi_gen, ServerConfig};
pub use error::{CoreError, CoreResult};
pub use facade::{CockpitCore, GENERATION_TOOLS};

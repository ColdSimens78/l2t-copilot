//! Bounded-ошибки ядра (правила шины №2/№3): любая неудача — это
//! `CoreError` с внятным текстом, никогда паника и никогда зависание.

use serde_json::Value;

/// Ошибка ядра. Тексты адресованы фронту (UI показывает их в AI Dock),
/// поэтому они человекочитаемые, а `Timeout` явно напоминает, что
/// таймаут ≠ отказ.
#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    /// Не смогли поднять stdio-процесс сервера (бинарь не найден и т.п.).
    #[error("не удалось запустить сервер «{server}» ({command}): {detail}")]
    Spawn { server: String, command: String, detail: String },

    /// Initialize/handshake не уложился в отведённое время.
    #[error("сервер «{server}» не прошёл initialize за {secs:.0} с: {detail}")]
    Handshake { server: String, secs: f64, detail: String },

    /// Per-call таймаут. Внимание: по правилу шины №2 команда МОГЛА
    /// примениться — `server_alive` это вердикт авто-инспекта, а не
    /// результат команды; перед ретраем проверь состояние.
    #[error("таймаут «{tool}» на «{server}» после {secs:.0} с (авто-инспект: сервер {server_alive:?}) — таймаут ≠ отказ, команда могла примениться; проверь состояние перед ретраем")]
    Timeout {
        server: String,
        tool: String,
        secs: f64,
        /// `Some(true/false)` — инспект прошёл и дал вердикт; `None` —
        /// сервер не ответил и на инспект (лежит целиком).
        server_alive: Option<bool>,
    },

    /// Сервер вернул isError с текстом — доносим текст как есть.
    #[error("инструмент «{tool}» вернул ошибку: {message}")]
    Tool { tool: String, message: String },

    /// Ответ без полезной нагрузки.
    #[error("пустой ответ от «{tool}» (structured: {structured:?})")]
    EmptyResponse { tool: String, structured: Option<Value> },

    /// Транспорт/протокол (сервис упал после коннекта и т.п.).
    #[error("транспорт «{server}»: {detail}")]
    Transport { server: String, detail: String },
}

impl CoreError {
    pub(crate) fn spawn(server: &str, command: &str, detail: impl std::fmt::Display) -> Self {
        Self::Spawn {
            server: server.into(),
            command: command.into(),
            detail: detail.to_string(),
        }
    }

    pub(crate) fn transport(server: &str, detail: impl std::fmt::Display) -> Self {
        Self::Transport {
            server: server.into(),
            detail: detail.to_string(),
        }
    }
}

pub type CoreResult<T> = Result<T, CoreError>;

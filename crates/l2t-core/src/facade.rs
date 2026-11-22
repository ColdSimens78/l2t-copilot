//! Типизированные команды-фасады (§6.2 proposal v0.3): фронтенд зовёт их,
//! ядро транслирует в вызовы инструментов шины. Контракт шины живёт здесь
//! в одном месте — UI не знает про MCP/JSON-RPC.
//!
//! Этап 1: analyze_loop / generate_part / get_bus_state / health.
//! (`import_accepted` / `run_self_check` приходят с DawBackend-хостом.)

use std::path::Path;
use std::time::Duration;

use serde_json::{json, Map, Value};

use crate::bus::{BusServer, DEFAULT_CALL_TIMEOUT};
use crate::config::{resolve_audio_analyzer, resolve_midi_gen, ServerConfig};
use crate::error::{CoreError, CoreResult};

/// Инструменты midi-gen, которые ядро готово вызывать (whitelist: unknown
/// tool = bounded-ошибка сразу, без похода на шину).
pub const GENERATION_TOOLS: &[&str] = &[
    "generate_bassline",
    "generate_chord_progression",
    "generate_drum_pattern",
];

/// Анализ без sections (upstream-паника JuzzyDee/audio-analyzer-rs#3 на
/// треках с кандидатами секций): Loop X-Ray собирается из суб-инструментов.
const ANALYSIS_TOOLS: &[&str] = &[
    "audio_info",
    "spectral_features",
    "harmonic_analysis",
    "rhythm_analysis",
];

/// Ядро кокпита: единственный владелец MCP-клиентов шины.
pub struct CockpitCore {
    audio_analyzer: Option<BusServer>,
    midi_gen: Option<BusServer>,
    call_timeout: Duration,
}

impl CockpitCore {
    /// Поднять все серверы шины. Сервер, чей бинарь не найден, не убивает
    /// ядро: слот остаётся `None`, его состояние видит `get_bus_state`
    /// (UI покажет error-состояние с «починить за меня»).
    pub async fn connect() -> Self {
        Self::connect_with(resolve_audio_analyzer(), resolve_midi_gen()).await
    }

    pub async fn connect_with(
        audio_analyzer: ServerConfig,
        midi_gen: ServerConfig,
    ) -> Self {
        let audio_analyzer = BusServer::connect(audio_analyzer).await.ok();
        let midi_gen = BusServer::connect(midi_gen).await.ok();
        Self { audio_analyzer, midi_gen, call_timeout: DEFAULT_CALL_TIMEOUT }
    }

    /// **Loop X-Ray**: анализ лупа суб-инструментами аудио-анализатора.
    /// Возвращает компактный JSON {"path", "info", "spectral", "harmonic",
    /// "rhythm"} — поля-объекты ответов соответствующих инструментов.
    pub async fn analyze_loop(&self, path: &Path) -> CoreResult<Value> {
        let server = self.audio_analyzer.as_ref().ok_or_else(|| unavailable("audio-analyzer"))?;
        let mut out = Map::new();
        out.insert("path".into(), json!(path.display().to_string()));
        for tool in ANALYSIS_TOOLS {
            let mut args = Map::new();
            args.insert("path".into(), json!(path.display().to_string()));
            let v = server.call_json(tool, args, self.call_timeout).await?;
            // параметры срезов не задаём: полный трек, summary-режим
            let key = tool.strip_prefix("audio_").unwrap_or(tool);
            out.insert(short_name(key).into(), v);
        }
        Ok(Value::Object(out))
    }

    /// **AI Layering**: вызвать генератор midi-gen. `params` — JSON-объект
    /// аргументов инструмента (bpm/key/output_path/style/...), ответ
    /// midi-gen возвращается как есть (path, bytes, notes, ...).
    pub async fn generate_part(&self, tool: &str, params: Value) -> CoreResult<Value> {
        if !GENERATION_TOOLS.contains(&tool) {
            return Err(CoreError::Tool {
                tool: tool.into(),
                message: format!(
                    "неизвестный генератор; доступны: {GENERATION_TOOLS:?}"
                ),
            });
        }
        let server = self.midi_gen.as_ref().ok_or_else(|| unavailable("midi-gen"))?;
        let args = params
            .as_object()
            .cloned()
            .ok_or_else(|| CoreError::Tool {
                tool: tool.into(),
                message: "params должен быть JSON-объектом".into(),
            })?;
        server.call_json(tool, args, self.call_timeout).await
    }

    /// Снимок шины: по каждому слоту — alive, инструменты или причина.
    /// Инспекшен-команда: ошибок не возвращает, всё кладётся в JSON
    /// (pull-семантика для UI-инспектора).
    pub async fn get_bus_state(&self) -> Value {
        let mut servers = Vec::new();
        for (slot, server) in [("audio-analyzer", &self.audio_analyzer), ("midi-gen", &self.midi_gen)]
        {
            let entry = match server {
                Some(s) => match s.tool_names().await {
                    Ok(tools) => json!({"slot": slot, "alive": true, "tools": tools}),
                    Err(e) => json!({"slot": slot, "alive": false, "error": e.to_string()}),
                },
                None => json!({"slot": slot, "alive": false, "error": "не подключён (бинарь не найден или initialize не прошёл)"}),
            };
            servers.push(entry);
        }
        json!({"servers": servers})
    }

    /// Быстрая проверка живости (для Screen 0 «Разбудить движок» и AI Dock).
    pub async fn health(&self) -> Value {
        let ok = self.audio_analyzer.is_some() || self.midi_gen.is_some();
        json!({"ok": ok})
    }

    /// Грейсфулл-шатдаун всех серверов.
    pub async fn shutdown(self) {
        if let Some(s) = self.audio_analyzer {
            s.shutdown().await;
        }
        if let Some(s) = self.midi_gen {
            s.shutdown().await;
        }
    }
}

fn unavailable(slot: &str) -> CoreError {
    CoreError::Tool {
        tool: slot.into(),
        message: "сервер слота не подключён (см. get_bus_state)".into(),
    }
}

/// audio_info -> info, spectral_features -> spectral, harmonic_analysis ->
/// harmonic, rhythm_analysis -> rhythm.
fn short_name(tool: &str) -> &str {
    match tool {
        "info" => "info",
        "spectral_features" => "spectral",
        "harmonic_analysis" => "harmonic",
        "rhythm_analysis" => "rhythm",
        other => other,
    }
}

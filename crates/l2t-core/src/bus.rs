//! Владение одним MCP-сервером шины (stdio): spawn, вызовы с per-call
//! таймаутом, авто-инспект после таймаута, bounded-ошибки.
//!
//! Здесь живут правила шины №2 и №3 из README:
//! - каждый вызов обёрнут в `tokio::time::timeout`; дроп future отменяет
//!   JSON-RPC-запрос (rmcp cancel-on-drop), но НЕ убивает процесс сервера —
//!   команда могла примениться;
//! - после таймаута ядро само делает инспект (`tools/list`) и вкладывает
//!   вердикт в ошибку: «сервер жив» ≠ «команда не применилась»;
//! - isError сервера доносится текстом как есть (урок qwen_bridge: текст
//!   обязан дойти до UI).

use std::time::Duration;

use rmcp::model::{CallToolRequestParams, JsonObject};
use rmcp::service::{serve_client, RunningService, RoleClient};
use rmcp::transport::TokioChildProcess;
use rmcp::ServiceError;
use serde_json::{json, Value};
use tokio::process::Command;
use tokio::time::timeout;

use crate::config::ServerConfig;
use crate::error::{CoreError, CoreResult};

/// Таймаут на initialize/handshake при spawn.
pub const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(15);
/// Таймаут авто-инспекта после пер-call таймаута (короткий: сервер лежит —
/// не ждём ещё полминуты).
pub const INSPECT_TIMEOUT: Duration = Duration::from_secs(5);
/// Таймаут одного вызова инструмента по умолчанию (как timeoutMs в конфиге
/// ZCode-клиентов: 30 с).
pub const DEFAULT_CALL_TIMEOUT: Duration = Duration::from_secs(30);

/// Подключённый (или не сумевший подключиться) сервер шины.
pub struct BusServer {
    config: ServerConfig,
    service: RunningService<RoleClient, ()>,
}

impl BusServer {
    /// Поднять stdio-процесс и пройти initialize. `Ok` = сервер на связи.
    pub async fn connect(config: ServerConfig) -> CoreResult<Self> {
        let mut command = Command::new(&config.command);
        command
            .args(&config.args)
            .envs(&config.env)
            .kill_on_drop(true); // ядро — единственный владелец процесса

        let transport = TokioChildProcess::new(command)
            .map_err(|e| CoreError::spawn(config.name, &config.command.display().to_string(), e))?;

        let service = timeout(HANDSHAKE_TIMEOUT, serve_client((), transport))
            .await
            .map_err(|_| {
                CoreError::Handshake {
                    server: config.name.into(),
                    secs: HANDSHAKE_TIMEOUT.as_secs_f64(),
                    detail: "сервер не ответил на initialize".into(),
                }
            })?
            .map_err(|e| CoreError::spawn(config.name, &config.command.display().to_string(), e))?;

        Ok(Self { config, service })
    }

    pub fn name(&self) -> &str {
        self.config.name
    }

    /// Доступ к сырому сервису rmcp (для tools/list со схемами и т.п.).
    pub fn service_raw(&self) -> &RunningService<RoleClient, ()> {
        &self.service
    }

    /// Вызвать инструмент и вернуть компактный JSON. Первый text-блок
    /// парсится как JSON (все наши серверы отвечают JSON-строкой); если
    /// парсинг не удался — отдаём `{"raw": "..."}`.
    pub async fn call_json(
        &self,
        tool: &str,
        args: JsonObject,
        call_timeout: Duration,
    ) -> CoreResult<Value> {
        let params = CallToolRequestParams::new(tool.to_string()).with_arguments(args);
        let result = match timeout(call_timeout, self.service.call_tool(params)).await {
            Ok(r) => r,
            Err(_) => {
                // Правило №2: таймаут ≠ отказ. Авто-инспект кладёт вердикт
                // прямо в ошибку — фронт показывает «⏱ → inspect → ✓/✗».
                let alive = match timeout(INSPECT_TIMEOUT, self.list_tools_raw()).await {
                    Ok(Ok(_)) => Some(true),   // ответил на tools/list — жив
                    Ok(Err(_)) => Some(false), // пайп закрыт / сервис умер
                    Err(_) => None,            // не ответил и на инспект
                };
                return Err(CoreError::Timeout {
                    server: self.config.name.into(),
                    tool: tool.into(),
                    secs: call_timeout.as_secs_f64(),
                    server_alive: alive,
                });
            }
        };
        let result = result.map_err(|e| self.transport_error(e))?;
        if result.is_error.unwrap_or(false) {
            return Err(CoreError::Tool {
                tool: tool.into(),
                message: first_text(&result.content).unwrap_or_default(),
            });
        }
        if let Some(v) = result.structured_content {
            return Ok(v);
        }
        let text = first_text(&result.content)
            .ok_or_else(|| CoreError::EmptyResponse { tool: tool.into(), structured: None })?;
        Ok(serde_json::from_str(&text).unwrap_or(json!({ "raw": text })))
    }

    /// Имена инструментов (для `get_bus_state` и авто-инспекта).
    pub async fn tool_names(&self) -> CoreResult<Vec<String>> {
        self.list_tools_raw().await.map_err(|e| self.transport_error(e))
    }

    async fn list_tools_raw(&self) -> Result<Vec<String>, ServiceError> {
        // rmcp кэширует tools/list — для pull-семантики инспект-вызовов это
        // и требуется: без курсора ответ консистентен.
        let result = self.service.list_tools(None).await?;
        Ok(result.tools.into_iter().map(|t| t.name.to_string()).collect())
    }

    fn transport_error(&self, e: ServiceError) -> CoreError {
        CoreError::transport(self.config.name, e)
    }

    /// Грейсфулл-шатдаун (rmcp шлёт завещание и ждёт процесс).
    pub async fn shutdown(self) {
        let _ = self.service.cancel().await;
    }
}

fn first_text(content: &[rmcp::model::ContentBlock]) -> Option<String> {
    content.iter().find_map(|c| match c {
        rmcp::model::ContentBlock::Text(t) => Some(t.text.clone()),
        _ => None,
    })
}

//! Rust-ядро кокпита: Tauri-обёртка над l2t-core (CockpitCore).
//!
//! Граница по §6 proposal v0.3 + docs/ipc-contract.md v0.1: React зовёт
//! типизированные команды, ЯДРО — единственный владелец MCP-клиентов
//! (stdio). Серверы шины на WebSocket не переводятся. События (bus_log /
//! suggestion_updated / host_status) эмитятся после каждого вызова.
//!
//! Спайк-харнесс spike_report (Фронтендер) сохранён — WebKitGTK-спайк
//! продолжается параллельно основной работе.

use std::io::Write;

use l2t_core::contract::{
    AcceptResult, BusState, EngineState, HostStatus, Part, SelfCheckReport, Suggestion,
    SuggestionUpdated, XRayReport,
};
use l2t_core::CockpitCore;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;

/// Спайк-харнесс: JS пишет результат проверки, Rust печатает `SPIKE key=value`
/// в stdout родительского процесса — программное доказательство для отчёта.
#[tauri::command]
fn spike_report(key: String, value: String) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "SPIKE {}={}", key, value);
    let _ = out.flush();
}

// ---------------------------------------------------------- события ------

/// Разослать накопленный журнал шины (правило «таймаут ≠ отказ»: UI
/// показывает ⏱ → inspect → ✓/✗, а не молчаливый ретрай).
fn emit_bus_log(app: &AppHandle, core: &mut CockpitCore) {
    for entry in core.take_bus_log() {
        let _ = app.emit("bus_log", entry);
    }
}

fn emit_suggestion(app: &AppHandle, suggestion: &Suggestion) {
    let _ = app.emit(
        "suggestion_updated",
        SuggestionUpdated {
            part: suggestion.part,
            version: suggestion.version,
            suggestion: suggestion.clone(),
        },
    );
}

// ---------------------------------------------------------- команды ------

#[tauri::command]
async fn analyze_loop(
    app: AppHandle,
    core: State<'_, Mutex<CockpitCore>>,
    path: String,
    copy_into_workspace: Option<bool>,
) -> Result<XRayReport, String> {
    let mut core = core.lock().await;
    // C5 (v0.2): дроп-зона может дать путь вне workspace — тогда копию
    // в staging/loops анализируем (правило шины №1).
    let report = if copy_into_workspace.unwrap_or(false) {
        core.analyze_loop_copied(std::path::Path::new(&path)).await
    } else {
        core.analyze_loop(std::path::Path::new(&path)).await
    }
    .map_err(|e| e.to_string())?;
    emit_bus_log(&app, &mut core);
    Ok(report)
}

#[tauri::command]
async fn generate_part(
    app: AppHandle,
    core: State<'_, Mutex<CockpitCore>>,
    tool: Part,
    params: Value,
) -> Result<Suggestion, String> {
    let mut core = core.lock().await;
    let suggestion = core.generate_part(tool, params).await.map_err(|e| e.to_string())?;
    emit_bus_log(&app, &mut core);
    emit_suggestion(&app, &suggestion);
    Ok(suggestion)
}

#[tauri::command]
async fn regenerate(
    app: AppHandle,
    core: State<'_, Mutex<CockpitCore>>,
    part: Part,
    params_diff: Value,
) -> Result<Suggestion, String> {
    let mut core = core.lock().await;
    let suggestion = core.regenerate(part, params_diff).await.map_err(|e| e.to_string())?;
    emit_bus_log(&app, &mut core);
    emit_suggestion(&app, &suggestion);
    Ok(suggestion)
}

#[tauri::command]
async fn accept_part(
    app: AppHandle,
    core: State<'_, Mutex<CockpitCore>>,
    part: Part,
    version: u64,
) -> Result<AcceptResult, String> {
    let mut core = core.lock().await;
    let result = core.accept_part(part, version).map_err(|e| e.to_string())?;
    emit_bus_log(&app, &mut core);
    Ok(result)
}

#[tauri::command]
async fn reject_part(
    app: AppHandle,
    core: State<'_, Mutex<CockpitCore>>,
    part: Part,
    version: u64,
) -> Result<(), String> {
    let mut core = core.lock().await;
    core.reject_part(part, version).map_err(|e| e.to_string())?;
    emit_bus_log(&app, &mut core);
    if let Some(s) = core.suggestion(part).cloned() {
        emit_suggestion(&app, &s);
    }
    Ok(())
}

/// Контрактная команда: состояние DAW-хоста. Этап 1 — engine: down
/// (host_status эмитится и при старте: Screen 0 «Разбудить движок»).
#[tauri::command]
async fn get_bus_state(core: State<'_, Mutex<CockpitCore>>) -> Result<BusState, String> {
    Ok(core.lock().await.get_bus_state().await)
}

/// Снимок MCP-слотов шины (AI Dock / инспектор / Screen 0) — вне
/// ipc-контракта v0.1, внутренняя команда ядра.
#[tauri::command]
async fn get_mcp_slots(
    app: AppHandle,
    core: State<'_, Mutex<CockpitCore>>,
) -> Result<Value, String> {
    let mut core = core.lock().await;
    let slots = core.get_mcp_slots().await;
    emit_bus_log(&app, &mut core);
    Ok(slots)
}

#[tauri::command]
async fn run_self_check(
    app: AppHandle,
    core: State<'_, Mutex<CockpitCore>>,
    bounce_path: String,
) -> Result<SelfCheckReport, String> {
    let mut core = core.lock().await;
    let report =
        core.run_self_check(std::path::Path::new(&bounce_path)).await.map_err(|e| e.to_string())?;
    emit_bus_log(&app, &mut core);
    Ok(report)
}

/// Превью-рендер .mid → .wav сайдкаром FluidSynth (C2, конвенция
/// staging/<part>_v<N>.wav). Вне таблицы команд v0.2 — форс-рендер для
/// аудиции; generate_part уже рендерит автоматически.
#[tauri::command]
async fn render_preview(mid_path: String) -> Result<String, String> {
    l2t_core::preview::render_preview(std::path::Path::new(&mid_path))
        .await
        .map(|p| p.display().to_string())
        .map_err(|e| e.to_string())
}

// ------------------------------------------------------------- вход ------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            spike_report,
            analyze_loop,
            generate_part,
            regenerate,
            accept_part,
            reject_part,
            get_bus_state,
            get_mcp_slots,
            run_self_check,
            render_preview
        ])
        .setup(|app| {
            // Поднять шину (stdio-клиенты) и расшарить ядро командам.
            // Битый слот не убивает приложение — get_mcp_slots покажет его.
            let core = tauri::async_runtime::block_on(CockpitCore::connect());
            app.manage(Mutex::new(core));
            // Хост ещё не подключён (DawBackend — следующий этап): фронт
            // сразу знает, что рисовать Screen 0.
            let _ = app.handle().emit(
                "host_status",
                HostStatus { engine: EngineState::Down },
            );
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}

//! Rust-ядро кокпита: Tauri-обёртка над l2t-core (CockpitCore).
//!
//! Граница по §6 proposal v0.3 + docs/ipc-contract.md v0.1: React зовёт
//! типизированные команды, ЯДРО — единственный владелец MCP-клиентов
//! (stdio). Серверы шины на WebSocket не переводятся. События (bus_log /
//! suggestion_updated / host_status) эмитятся после каждого вызова.
//!
//! Спайк-харнесс spike_report (UI-модуль) сохранён — WebKitGTK-спайк
//! продолжается параллельно основной работе.

use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use l2t_core::contract::{
    AcceptResult, AdoptLoopParams, AdoptResult, AnalyzeLoopInput, BusState, EngineState,
    ExportTrackInput, ExportTrackOutput, GeneratePartParams, HostStatus, MasterTarget,
    PartVersion, RegenerateParams, RunSelfCheckInput, SelfCheckReport, Suggestion,
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
    input: AnalyzeLoopInput,
) -> Result<XRayReport, String> {
    let mut core = core.lock().await;
    // C5 (v0.2): дроп-зона может дать путь вне workspace — тогда копию
    // в staging/loops анализируем (правило шины №1).
    let report = if input.copy_into_workspace.unwrap_or(false) {
        core.analyze_loop_copied(std::path::Path::new(&input.path)).await
    } else {
        core.analyze_loop(std::path::Path::new(&input.path)).await
    }
    .map_err(|e| e.to_string())?;
    emit_bus_log(&app, &mut core);
    Ok(report)
}

#[tauri::command]
async fn generate_part(
    app: AppHandle,
    core: State<'_, Mutex<CockpitCore>>,
    input: GeneratePartParams,
) -> Result<Suggestion, String> {
    let mut core = core.lock().await;
    let suggestion = core
        .generate_part(input.tool, input.params)
        .await
        .map_err(|e| e.to_string())?;
    emit_bus_log(&app, &mut core);
    emit_suggestion(&app, &suggestion);
    Ok(suggestion)
}

#[tauri::command]
async fn regenerate(
    app: AppHandle,
    core: State<'_, Mutex<CockpitCore>>,
    input: RegenerateParams,
) -> Result<Suggestion, String> {
    let mut core = core.lock().await;
    let suggestion = core
        .regenerate(input.part, input.params_diff)
        .await
        .map_err(|e| e.to_string())?;
    emit_bus_log(&app, &mut core);
    emit_suggestion(&app, &suggestion);
    Ok(suggestion)
}

#[tauri::command]
async fn accept_part(
    app: AppHandle,
    core: State<'_, Mutex<CockpitCore>>,
    input: PartVersion,
) -> Result<AcceptResult, String> {
    let mut core = core.lock().await;
    let result = core
        .accept_part(input.part, input.version)
        .await
        .map_err(|e| e.to_string())?;
    emit_bus_log(&app, &mut core);
    // статус сменился на accepted — фронт обязан увидеть новую версию
    if let Some(s) = core.suggestion(input.part).cloned() {
        emit_suggestion(&app, &s);
    }
    Ok(result)
}

#[tauri::command]
async fn reject_part(
    app: AppHandle,
    core: State<'_, Mutex<CockpitCore>>,
    input: PartVersion,
) -> Result<(), String> {
    let mut core = core.lock().await;
    core.reject_part(input.part, input.version).map_err(|e| e.to_string())?;
    emit_bus_log(&app, &mut core);
    if let Some(s) = core.suggestion(input.part).cloned() {
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
    input: RunSelfCheckInput,
) -> Result<SelfCheckReport, String> {
    let mut core = core.lock().await;
    let report = core
        .run_self_check(std::path::Path::new(&input.bounce_path))
        .await
        .map_err(|e| e.to_string())?;
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

/// «Save WAV» из окна (принцип владельца: трек уходит напрямую из
/// приложения): bounce движка в путь экспорта (default: workspace/export,
/// env L2T_EXPORT_DIR). С целью громкости — Mastering Targets v0
/// (контракт v0.2.1): normalize по пику + честный отчёт о дистанции до цели.
#[tauri::command]
async fn export_track(
    app: AppHandle,
    core: State<'_, Mutex<CockpitCore>>,
    input: ExportTrackInput,
) -> Result<ExportTrackOutput, String> {
    let mut core = core.lock().await;
    let result = core
        .export_track(
            input.output_path.as_deref().map(std::path::Path::new),
            input.target.unwrap_or(MasterTarget::Bypass),
        )
        .await
        .map_err(|e| e.to_string())?;
    emit_bus_log(&app, &mut core);
    Ok(result)
}

/// adopt_loop (C1, контракт v0.2): BPM+key лупа → сессия движка
/// (event.tempo + key-маркер «Key: <тоналность>»).
#[tauri::command]
async fn adopt_loop(
    app: AppHandle,
    core: State<'_, Mutex<CockpitCore>>,
    input: AdoptLoopParams,
) -> Result<AdoptResult, String> {
    let mut core = core.lock().await;
    let result = core
        .adopt_loop(input.bpm, &input.key, &input.source)
        .await
        .map_err(|e| e.to_string())?;
    emit_bus_log(&app, &mut core);
    Ok(result)
}

/// Bounce сессии движком (правило №5: ядро оркестрирует). Вне таблицы
/// v0.2 (daw.render — optional с хост-клиентом); путь внутри roots.
#[tauri::command]
async fn bounce(
    app: AppHandle,
    core: State<'_, Mutex<CockpitCore>>,
    path: String,
) -> Result<Value, String> {
    let mut core = core.lock().await;
    let result = core.bounce_engine(std::path::Path::new(&path)).await.map_err(|e| e.to_string())?;
    emit_bus_log(&app, &mut core);
    Ok(result)
}

// ------------------------------------------------------------- e2e ------

/// E2E-самопроверка «команда из webview» (этап 1, финал): после загрузки
/// страницы (при L2T_E2E=1) инъектим JS, который из КОНТЕКСТА ВЕБВЬЮ зовёт
/// те же invoke-команды, что и React: analyze_loop (examples/, CC0) →
/// generate_part → render_preview. Результаты — через spike_report в
/// stdout ядра (SPIKE-строки) — доказательство цепочки webview → l2t-core
/// → живой midi-gen → .mid → fluidsynth → .wav.
static E2E_DONE: AtomicBool = AtomicBool::new(false);

fn e2e_js() -> Option<String> {
    // CC0-лупы OSS-разведки; берём первый найденный FLAC
    let examples = PathBuf::from("/home/ilmir/l2t-copilot/examples");
    let mut flacs: Vec<PathBuf> = std::fs::read_dir(&examples)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "flac"))
        .collect();
    flacs.sort();
    // fixture e2e по отчёту: emotional_piano (рубато — проверка округления bpm)
    let loop_wav = match flacs.iter().find(|p| p.to_string_lossy().contains("emotional_piano")) {
        Some(p) => p.clone(),
        None => flacs.into_iter().next()?,
    };
    let loop_path = loop_wav.display().to_string().replace('\'', "");
    Some(format!(
        r#"(async () => {{
  const t = window.__TAURI__;
  if (!t) return;
  // Tauri v2: invoke живёт в core (v1 — топ-уровень); поддержим оба
  const invoke = (t.core && t.core.invoke) ? t.core.invoke : t.invoke;
  const say = (k, v) => invoke('spike_report', {{ key: k, value: String(v) }}).catch(() => {{}});
  try {{
    const xray = await invoke('analyze_loop', {{ input: {{ path: '{loop_path}' }} }});
    await say('e2e_loop_path', '{loop_path}');
    await say('e2e_xray', JSON.stringify({{ bpm: xray.bpm, key: xray.key, key_conf: xray.key_confidence }}));
    // Полный контур этапа 2 (критерий): adopt → bus → generate → preview
    // → accept → bounce → self-check
    const adopt = await invoke('adopt_loop', {{ input: {{ bpm: xray.bpm, key: xray.key, source: 'e2e-loop' }} }});
    await say('e2e_adopt', JSON.stringify(adopt));
    const st = await invoke('get_bus_state');
    await say('e2e_bus', JSON.stringify({{ engine: st.engine, tempo: st.tempo, key: st.key_marker, tracks: st.tracks.length, session: st.session_name }}));
    const s = await invoke('generate_part', {{ input: {{ tool: 'bass', params: {{ bpm: Math.round(xray.bpm), key: xray.key, style: 'syncopated' }} }} }});
    const mid = s.params.output_path;
    await say('e2e_bass', JSON.stringify({{ version: s.version, notes: s.notes.length, mid }}));
    const wav = await invoke('render_preview', {{ midPath: mid }});
    await say('e2e_preview', wav);
    const acc = await invoke('accept_part', {{ input: {{ part: 'bass', version: s.version }} }});
    await say('e2e_accept', JSON.stringify(acc));
    // verify в session.inspect: треки/клипы сессии после accept
    const insp = await invoke('get_bus_state');
    await say('e2e_inspect', JSON.stringify(insp.tracks.map(t => ({{ name: t.name, kind: t.kind, clips: (t.clips || []).map(c => c.notes) }}))));
    // «Save WAV»: экспорт сессии движком (default: workspace/export)
    const exp = await invoke('export_track', {{ input: {{}} }});
    await say('e2e_export', JSON.stringify(exp));
    // Mastering Targets v0: цель Spotify −14 LUFS (normalize движком + замер analyzer)
    const mastered = await invoke('export_track', {{ input: {{ target: 'spotify' }} }});
    await say('e2e_mastering', JSON.stringify(mastered.mastering));
    // Self-Check на ЭКСПОРТЕ (файл в workspace — правило 1 соблюдено)
    const check = await invoke('run_self_check', {{ input: {{ bounce_path: exp.path }} }});
    await say('e2e_selfcheck', JSON.stringify(check));
    await say('e2e_done', 'ok');
  }} catch (e) {{
    await say('e2e_error', (e && e.message) ? e.message : String(e));
  }}
}})();"#,
        loop_path = loop_path,
    ))
}

fn run_e2e_once(webview: &tauri::Webview) {
    if !cfg!(debug_assertions) || std::env::var_os("L2T_E2E").is_none_or(|v| v != "1") {
        return;
    }
    println!("SPIKE e2e_page_load=seen");
    let _ = std::io::stdout().flush();
    if E2E_DONE.swap(true, Ordering::SeqCst) {
        return;
    }
    match e2e_js() {
        Some(js) => {
            let _ = std::fs::write("/tmp/l2t-e2e.js", &js);
            println!("SPIKE e2e_js_len={}", js.len());
            if let Err(e) = webview.eval(&js) {
                println!("SPIKE e2e_error=eval: {e}");
            }
        }
        None => println!("SPIKE e2e_error=нет примера для анализа"),
    }
    let _ = std::io::stdout().flush();
}

// ------------------------------------------------------------- вход ------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .on_page_load(|webview, payload| {
            // страница (spike.html или React из devUrl) загрузилась — можно
            // звать invoke из контекста окна
            if payload.event() == tauri::webview::PageLoadEvent::Finished {
                run_e2e_once(webview);
            }
        })
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
            render_preview,
            adopt_loop,
            bounce,
            export_track
        ])
        .setup(|app| {
            // Поднять шину: analyzer + midi-gen + ратифицированный движок
            // (roots на workspace, staging внутри roots) — CockpitCore::connect().
            // Битый слот не убивает приложение — get_mcp_slots покажет его.
            let core = tauri::async_runtime::block_on(CockpitCore::connect());
            let engine_state = if core.has_engine() { EngineState::Up } else { EngineState::Down };
            app.manage(Mutex::new(core));
            let _ = app.handle().emit("host_status", HostStatus { engine: engine_state });
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

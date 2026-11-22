use std::io::Write;

/// Спайк-харнесс: JS пишет результат проверки, Rust печатает `SPIKE key=value`
/// в stdout родительского процесса — программное доказательство для отчёта.
#[tauri::command]
fn spike_report(key: String, value: String) {
  let mut out = std::io::stdout().lock();
  let _ = writeln!(out, "SPIKE {}={}", key, value);
  let _ = out.flush();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![spike_report])
    .setup(|app| {
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

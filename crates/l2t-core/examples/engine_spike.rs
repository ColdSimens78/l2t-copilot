//! Спайк headless-движка SoundCraft v0.20.1 (этап 1, финал — факты
//! владельцу на ратификацию DawBackend; см. docs/engine-spike-report.md).
//!
//! Запуск:
//!   cargo run -p l2t-core --example engine_spike -- <workspace>
//!
//! Поднимает `soundcraft-cli mcp --demo --automation-*-root <workspace>`
//! как rmcp-клиент и замеряет: холодный старт, session.inspect full,
//! event.tempo, file.import_midi (bass_am90.mid), file.bounce_mix →
//! WAV + LUFS. Все вызовы bounded (таймауты); процессы kill_on_drop.
//!
//! env: L2T_SOUNDCRAFT (бинарь, дефолт /home/ilmir/bin/soundcraft-cli)

use std::path::Path;
use std::time::{Duration, Instant};

use rmcp::model::{CallToolRequestParams, ContentBlock};
use rmcp::service::{serve_client, RunningService, RoleClient};
use rmcp::transport::TokioChildProcess;
use serde_json::{json, Value};
use tokio::process::Command;
use tokio::time::timeout;

const HANDSHAKE: Duration = Duration::from_secs(30);
const CALL: Duration = Duration::from_secs(90);

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let bin =
        std::env::var("L2T_SOUNDCRAFT").unwrap_or_else(|_| l2t_core::config::SOUNDCRAFT_BIN.into());
    let ws = std::env::args()
        .nth(1)
        .unwrap_or_else(|| l2t_core::config::SOUNDCRAFT_WORKSPACE.into());
    let ws_path = Path::new(&ws).canonicalize()?;
    let mid = ws_path.join("bass_am90.mid");
    if !mid.is_file() {
        return Err(format!("нет {} — положи bass_am90.mid в workspace", mid.display()).into());
    }
    let ws_str = ws_path.display().to_string();

    println!("# engine spike: {bin} @ {ws_str}");
    let mut cmd = Command::new(&bin);
    cmd.args([
        "mcp".to_string(),
        "--demo".to_string(),
        "--automation-read-root".to_string(),
        ws_str.clone(),
        "--automation-write-root".to_string(),
        ws_str,
    ])
    .kill_on_drop(true);

    // --- холодный старт: spawn → initialize завершён ---
    let t0 = Instant::now();
    let transport = TokioChildProcess::new(cmd)?;
    let service: RunningService<RoleClient, ()> =
        timeout(HANDSHAKE, serve_client((), transport)).await??;
    let cold_start = t0.elapsed();
    println!("cold_start_sec={:.2}", cold_start.as_secs_f64());

    // --- tools list (для отчёта) ---
    let tools = service.list_tools(None).await?;
    println!(
        "tools={}",
        tools.tools.iter().map(|t| t.name.to_string()).collect::<Vec<_>>().join(",")
    );

    // --- 1. session.inspect full (execute; fallback на прямой tool) ---
    let (ms, v) = match call(
        &service,
        "execute",
        json!({"command": "session.inspect", "params": {"detail": "full"}}),
        "session.inspect",
    )
    .await
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[execute session.inspect не удался: {e} → inspect_session]");
            call(&service, "inspect_session", json!({"detail": "full"}), "inspect_session").await?
        }
    };
    println!(
        "session.inspect_ms={} keys={:?}",
        ms.as_millis(),
        v.as_object().map(|o| o.keys().cloned().collect::<Vec<_>>()).unwrap_or_default()
    );

    // --- 2. event.tempo 90 ---
    let (ms, v) = call(
        &service,
        "execute",
        json!({"command": "event.tempo", "params": {"bpm": 90}}),
        "event.tempo",
    )
    .await?;
    println!("event.tempo_ms={} result={v}", ms.as_millis());

    // --- 3. file.import_midi bass_am90.mid ---
    let (ms, v) = call(
        &service,
        "execute",
        json!({"command": "file.import_midi", "params": {"path": mid.display().to_string()}}),
        "file.import_midi",
    )
    .await?;
    println!("file.import_midi_ms={} result={}", ms.as_millis(), compact(&v, 260));

    // --- 4. file.bounce_mix → WAV + LUFS ---
    let bounce = ws_path.join("bounce_am90.wav");
    let _ = std::fs::remove_file(&bounce);
    let (ms, v) = match call(
        &service,
        "execute",
        json!({"command": "file.bounce_mix", "params": {"path": bounce.display().to_string(), "format": "wav"}}),
        "file.bounce_mix",
    )
    .await
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[execute file.bounce_mix не удался: {e} → инструмент bounce_mix]");
            call(
                &service,
                "bounce_mix",
                json!({"path": bounce.display().to_string(), "format": "wav"}),
                "bounce_mix",
            )
            .await?
        }
    };
    println!("file.bounce_mix_ms={} result={}", ms.as_millis(), compact(&v, 260));
    let wav_ok = bounce.is_file();
    println!(
        "wav_exists={wav_ok} size={}",
        std::fs::metadata(&bounce).map(|m| m.len()).unwrap_or(0)
    );

    // --- сводка для отчёта ---
    println!("cold_start_sec={:.2}", cold_start.as_secs_f64());
    service.cancel().await.ok();
    Ok(())
}

/// Один tools/call с per-call таймаутом; isError → Err с текстом.
async fn call(
    service: &RunningService<RoleClient, ()>,
    name: &str,
    args: Value,
    label: &str,
) -> Result<(Duration, Value), String> {
    let t = Instant::now();
    let params =
        CallToolRequestParams::new(name.to_string()).with_arguments(args.as_object().cloned().unwrap_or_default());
    let res = timeout(CALL, service.call_tool(params)).await;
    let ms = t.elapsed();
    match res {
        Err(_) => Err(format!("{label}: таймаут {} с", CALL.as_secs())),
        Ok(Err(e)) => Err(format!("{label}: {e}")),
        Ok(Ok(result)) => {
            if result.is_error.unwrap_or(false) {
                let text = first_text(&result.content).unwrap_or_default();
                Err(format!("{label}: isError — {}", text.chars().take(200).collect::<String>()))
            } else {
                let v = result
                    .structured_content
                    .or_else(|| first_text(&result.content).and_then(|t| serde_json::from_str(&t).ok()))
                    .unwrap_or(Value::Null);
                Ok((ms, v))
            }
        }
    }
}

fn first_text(content: &[ContentBlock]) -> Option<String> {
    content.iter().find_map(|c| match c {
        ContentBlock::Text(t) => Some(t.text.clone()),
        _ => None,
    })
}

fn compact(v: &Value, max: usize) -> String {
    let s = serde_json::to_string(v).unwrap_or_default();
    if s.len() > max {
        format!("{}…", s.chars().take(max).collect::<String>())
    } else {
        s
    }
}

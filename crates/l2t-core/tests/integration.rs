//! Интеграционные тесты l2t-core: реальный stdio-транспорт.
//!
//! Правило: тесты не требуют webkit/tauri и не ломаются на машине без
//! слотов шины — мок-сервер поднимается из fixtures/, а живые серверы
//! (midi-gen, audio-analyzer) проверяются с skip, если бинаря нет.

use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;

use l2t_core::bus::BusServer;
use l2t_core::config::{resolve_audio_analyzer, resolve_midi_gen, ServerConfig};
use l2t_core::error::CoreError;
use l2t_core::facade::CockpitCore;
use serde_json::json;

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(name)
}

fn mock_config() -> Option<ServerConfig> {
    // системный python3 есть почти всюду; skip если вдруг нет
    let py = which("python3")?;
    Some(ServerConfig {
        name: "mock",
        command: py,
        args: vec![fixture("mock_sleepy_server.py").display().to_string()],
        env: HashMap::new(),
    })
}

fn which(bin: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(bin))
        .find(|p| p.is_file())
}

fn args(v: serde_json::Value) -> serde_json::Map<String, serde_json::Value> {
    v.as_object().cloned().expect("объект")
}

// ---------------------------------------------------------------- мок ----

#[tokio::test]
async fn timeout_triggers_auto_inspect_server_alive() {
    let Some(cfg) = mock_config() else {
        eprintln!("SKIP: python3 не найден");
        return;
    };
    let server = BusServer::connect(cfg).await.expect("mock должен подняться");

    // echo_ok работает
    let ok = server.call_json("echo_ok", args(json!({})), Duration::from_secs(5)).await.unwrap();
    assert_eq!(ok, json!({"ok": true}));

    // sleep_forever: per-call таймаут 500 мс → авто-инспект → сервер ЖИВ
    let err = server
        .call_json("sleep_forever", args(json!({})), Duration::from_millis(500))
        .await
        .expect_err("должен быть таймаут");
    match &err {
        CoreError::Timeout { server_alive: Some(true), tool, secs, .. } => {
            assert_eq!(tool, "sleep_forever");
            assert!(*secs < 5.0);
        }
        other => panic!("ожидался Timeout с живым инспектом, получили {other:?}"),
    }

    // после таймаута сервер продолжает отвечать (таймаут ≠ отказ)
    let ok = server.call_json("echo_ok", args(json!({})), Duration::from_secs(5)).await.unwrap();
    assert_eq!(ok, json!({"ok": true}));
    server.shutdown().await;
}

#[tokio::test]
async fn tool_error_text_is_carried_through() {
    let Some(cfg) = mock_config() else {
        eprintln!("SKIP: python3 не найден");
        return;
    };
    let server = BusServer::connect(cfg).await.unwrap();
    let err = server
        .call_json("fail_tool", args(json!({})), Duration::from_secs(5))
        .await
        .expect_err("isError должен стать CoreError::Tool");
    match &err {
        CoreError::Tool { tool, message } => {
            assert_eq!(tool, "fail_tool");
            assert_eq!(message, "busted by mock");
        }
        other => panic!("ожидался Tool, получили {other:?}"),
    }
    server.shutdown().await;
}

// ------------------------------------------------------- живой midi-gen ----

#[tokio::test]
async fn midi_gen_bassline_via_bus() {
    let cfg = resolve_midi_gen();
    if !cfg.command.is_file() {
        eprintln!("SKIP: midi-gen не найден ({})", cfg.command.display());
        return;
    }
    let server = BusServer::connect(cfg).await.expect("midi-gen должен подняться");
    let out = std::env::temp_dir().join("l2t-core-test-bass.mid");
    let res = server
        .call_json(
            "generate_bassline",
            args(json!({"bpm": 60, "key": "A minor", "output_path": out.display().to_string()})),
            Duration::from_secs(30),
        )
        .await
        .expect("generate_bassline должен сработать");
    assert_eq!(res["bpm"], json!(60));
    assert_eq!(res["key"], json!("A minor"));
    assert!(out.is_file(), "MIDI-файл должен существовать");
    server.shutdown().await;
}

#[tokio::test]
async fn midi_gen_unknown_style_is_bounded_error() {
    let cfg = resolve_midi_gen();
    if !cfg.command.is_file() {
        eprintln!("SKIP: midi-gen не найден");
        return;
    }
    let server = BusServer::connect(cfg).await.unwrap();
    let out = std::env::temp_dir().join("l2t-core-test-bad.mid");
    let err = server
        .call_json(
            "generate_bassline",
            args(json!({"bpm": 60, "key": "A minor", "style": "jazzberry",
                        "output_path": out.display().to_string()})),
            Duration::from_secs(30),
        )
        .await
        .expect_err("unknown style — isError");
    match &err {
        CoreError::Tool { message, .. } => assert!(message.contains("jazzberry")),
        other => panic!("ожидался Tool, получили {other:?}"),
    }
    server.shutdown().await;
}

// -------------------------------------------------- живой audio-analyzer ----

/// Минимальный RIFF/WAVE PCM16 mono 44100 — синус 0.5 с.
fn write_sine_wav(path: &Path) {
    let sr = 44100u32;
    let n = sr / 2;
    let mut data = Vec::with_capacity((n * 2) as usize);
    for i in 0..n {
        let t = i as f32 / sr as f32;
        let s = (2.0 * std::f32::consts::PI * 440.0 * t).sin() * 12000.0;
        data.extend_from_slice(&(s as i16).to_le_bytes());
    }
    let mut f = std::fs::File::create(path).unwrap();
    f.write_all(b"RIFF").unwrap();
    f.write_all(&(36 + data.len() as u32).to_le_bytes()).unwrap();
    f.write_all(b"WAVEfmt ").unwrap();
    f.write_all(&16u32.to_le_bytes()).unwrap();       // fmt chunk size
    f.write_all(&1u16.to_le_bytes()).unwrap();        // PCM
    f.write_all(&1u16.to_le_bytes()).unwrap();        // mono
    f.write_all(&sr.to_le_bytes()).unwrap();
    f.write_all(&(sr * 2).to_le_bytes()).unwrap();    // byte rate
    f.write_all(&2u16.to_le_bytes()).unwrap();        // block align
    f.write_all(&16u16.to_le_bytes()).unwrap();       // bits
    f.write_all(b"data").unwrap();
    f.write_all(&(data.len() as u32).to_le_bytes()).unwrap();
    f.write_all(&data).unwrap();
}

#[tokio::test]
async fn analyze_loop_composite_on_sine() {
    let an_cfg = resolve_audio_analyzer();
    if !an_cfg.command.is_file() {
        eprintln!("SKIP: audio-analyzer не найден ({})", an_cfg.command.display());
        return;
    }
    // midi-gen слот намеренно битый: analyze_loop не должен от него зависеть
    let broken_midi = ServerConfig {
        name: "midi-gen",
        command: PathBuf::from("/nonexistent/l2t-midi-gen"),
        args: vec![],
        env: HashMap::new(),
    };
    let core = CockpitCore::connect_with(an_cfg, broken_midi).await;

    let wav = std::env::temp_dir().join("l2t-core-test-sine.wav");
    write_sine_wav(&wav);
    let xray = core.analyze_loop(&wav).await.expect("Loop X-Ray на синусе должен работать");
    for key in ["path", "info", "spectral", "harmonic", "rhythm"] {
        assert!(xray.get(key).is_some(), "в X-Ray должно быть поле {key}");
    }
    // наш самописный WAV декодируется как 44100 mono
    let info_txt = serde_json::to_string(&xray["info"]).unwrap();
    assert!(info_txt.contains("44100"), "sample_rate в info: {info_txt}");

    // слот midi-gen не подключён, но ядро живо; bus_state это отражает
    let state = core.get_bus_state().await;
    let servers = state["servers"].as_array().unwrap();
    let midi = servers.iter().find(|s| s["slot"] == json!("midi-gen")).unwrap();
    assert_eq!(midi["alive"], json!(false));
    core.shutdown().await;
}

#[tokio::test]
async fn generate_part_whitelist_and_flow() {
    let cfg = resolve_midi_gen();
    if !cfg.command.is_file() {
        eprintln!("SKIP: midi-gen не найден");
        return;
    }
    let broken_an = ServerConfig {
        name: "audio-analyzer",
        command: PathBuf::from("/nonexistent/mcp-server"),
        args: vec![],
        env: HashMap::new(),
    };
    let core = CockpitCore::connect_with(broken_an, cfg).await;

    // whitelist: неизвестный генератор — bounded-ошибка без похода на шину
    let err = core.generate_part("generate_synth_pad", json!({})).await.unwrap_err();
    match &err {
        CoreError::Tool { message, .. } => assert!(message.contains("generate_bassline")),
        other => panic!("ожидался Tool-whitelist, получили {other:?}"),
    }

    let out = std::env::temp_dir().join("l2t-core-test-drums.mid");
    let res = core
        .generate_part(
            "generate_drum_pattern",
            json!({"bpm": 90, "output_path": out.display().to_string(),
                   "bars": 4, "variation": true}),
        )
        .await
        .expect("generate_drum_pattern через фасад");
    assert_eq!(res["bpm"], json!(90));
    assert_eq!(res["hits"], json!(49)); // 4 такта: 48 базовых + филл (данные B.0)
    core.shutdown().await;
}

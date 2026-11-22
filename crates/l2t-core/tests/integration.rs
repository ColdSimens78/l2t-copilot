//! Интеграционные тесты l2t-core: реальный stdio-транспорт + ipc-контракт.
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
use l2t_core::contract::{Part, SuggestionStatus};
use l2t_core::error::CoreError;
use l2t_core::CockpitCore;
use serde_json::json;

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(name)
}

fn mock_config() -> Option<ServerConfig> {
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
async fn generate_part_produces_contract_suggestion() {
    let cfg = resolve_midi_gen();
    if !cfg.command.is_file() {
        eprintln!("SKIP: midi-gen не найден ({})", cfg.command.display());
        return;
    }
    let broken_an = ServerConfig {
        name: "audio-analyzer",
        command: PathBuf::from("/nonexistent/mcp-server"),
        args: vec![],
        env: HashMap::new(),
    };
    let staging = tempfile_staging("gen");
    let mut core = CockpitCore::connect_in(broken_an, cfg, staging.clone()).await;

    // v1: basic-бас в Am — PoC-паттерн A2 E3 A3 C3 по четвертям
    let s1 = core
        .generate_part(
            Part::Bass,
            json!({"bpm": 60, "key": "A minor", "style": "basic"}),
        )
        .await
        .expect("generate_part v1");
    assert_eq!(s1.version, 1);
    assert_eq!(s1.status, SuggestionStatus::Generated);
    assert_eq!(s1.source_tool, "midi-gen.generate_bassline");
    assert!(s1.confidence > 0.0);
    assert_eq!(s1.notes.iter().map(|n| n.note).collect::<Vec<_>>(), vec![45, 52, 57, 48]);
    assert_eq!(s1.notes.iter().map(|n| n.start).collect::<Vec<_>>(), vec![0, 480, 960, 1440]);
    assert_eq!(s1.notes.iter().map(|n| n.channel).collect::<Vec<_>>(), vec![0; 4]);
    let file1 = staging.join("bass_v1.mid");
    assert!(file1.is_file(), "стейджинг-артефакт по контракту");

    // v2: regenerate с diff-параметром — стиль меняется, версия растёт
    let s2 = core
        .regenerate(Part::Bass, json!({"style": "octaves"}))
        .await
        .expect("regenerate v2");
    assert_eq!(s2.version, 2);
    assert_eq!(s2.notes[0].note, 45); // октавный баунс от того же корня
    assert_ne!(s2.notes.len(), s1.notes.len());
    assert!(staging.join("bass_v2.mid").is_file());

    // reject текущей версии → manifest + статус
    core.reject_part(Part::Bass, 2).expect("reject");
    assert_eq!(core.suggestion(Part::Bass).unwrap().status, SuggestionStatus::Rejected);
    let manifest: serde_json::Value =
        serde_json::from_slice(&std::fs::read(staging.join("manifest.json")).unwrap()).unwrap();
    assert_eq!(manifest.as_array().unwrap().len(), 1);
    assert_eq!(manifest[0]["part"], json!("bass"));
    assert_eq!(manifest[0]["decision"], json!("rejected"));

    // accept без хоста — честная bounded-ошибка, НЕ тихая заглушка
    let err = core.accept_part(Part::Bass, 2).unwrap_err();
    assert!(err.to_string().contains("DawBackend"));

    // журнал шины накопился (для события bus_log)
    let log = core.take_bus_log();
    assert!(log.iter().any(|e| e.command == "generate_part" && e.status.is_ok()));
    core.shutdown().await;
}

#[tokio::test]
async fn drums_suggestion_keeps_gm_channel() {
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
    let mut core = CockpitCore::connect_in(broken_an, cfg, tempfile_staging("drums")).await;
    let s = core
        .generate_part(
            Part::Drums,
            json!({"bpm": 90, "bars": 4, "variation": true}),
        )
        .await
        .expect("generate_part drums");
    // GM drum channel 10 (0-indexed 9) обязан сохраниться в notes-контракте
    assert!(!s.notes.is_empty());
    assert!(s.notes.iter().all(|n| n.channel == 9));
    core.shutdown().await;
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
    f.write_all(&16u32.to_le_bytes()).unwrap();
    f.write_all(&1u16.to_le_bytes()).unwrap();
    f.write_all(&1u16.to_le_bytes()).unwrap();
    f.write_all(&sr.to_le_bytes()).unwrap();
    f.write_all(&(sr * 2).to_le_bytes()).unwrap();
    f.write_all(&2u16.to_le_bytes()).unwrap();
    f.write_all(&16u16.to_le_bytes()).unwrap();
    f.write_all(b"data").unwrap();
    f.write_all(&(data.len() as u32).to_le_bytes()).unwrap();
    f.write_all(&data).unwrap();
}

fn tempfile_staging(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("l2t-core-it-{tag}"));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

#[tokio::test]
async fn analyze_loop_returns_xray_report_and_self_check() {
    let an_cfg = resolve_audio_analyzer();
    if !an_cfg.command.is_file() {
        eprintln!("SKIP: audio-analyzer не найден ({})", an_cfg.command.display());
        return;
    }
    let broken_midi = ServerConfig {
        name: "midi-gen",
        command: PathBuf::from("/nonexistent/l2t-midi-gen"),
        args: vec![],
        env: HashMap::new(),
    };
    let mut core = CockpitCore::connect_in(an_cfg, broken_midi, tempfile_staging("xray")).await;

    let wav = std::env::temp_dir().join("l2t-core-test-sine.wav");
    write_sine_wav(&wav);
    let xray = core.analyze_loop(&wav).await.expect("Loop X-Ray на синусе");
    // значения сверены с живым дампом на этом же файле
    assert_eq!(xray.key, "A minor");
    assert!((xray.key_confidence - 0.682).abs() < 0.01);
    assert!((xray.bpm - 120.0).abs() < 0.01);
    assert!((xray.lufs - -9.5).abs() < 0.1);
    assert!((xray.true_peak - -8.7).abs() < 0.1);
    assert!(xray.bands.contains_key("low_mid"));
    assert!(xray.onset_density.is_some());

    // Self-Check: баунс == тот же файл → ok (relative-key и ×2 учтены)
    let check = core.run_self_check(&wav).await.expect("Self-Check");
    assert!(check.key_match);
    assert!(check.tempo_match);
    assert_eq!(check.verdict, "ok");
    assert!((check.lufs_delta - 0.0).abs() < 0.05);

    // контрактный get_bus_state: хоста нет — engine down, поля пустые
    let state = core.get_bus_state().await;
    assert_eq!(serde_json::to_value(&state).unwrap()["engine"], json!("down"));

    // а слоты шины видит и внутренний снимок get_mcp_slots
    let slots = core.get_mcp_slots().await;
    let an = slots["servers"].as_array().unwrap().iter()
        .find(|s| s["slot"] == json!("audio-analyzer")).unwrap();
    assert_eq!(an["alive"], json!(true));
    core.shutdown().await;
}

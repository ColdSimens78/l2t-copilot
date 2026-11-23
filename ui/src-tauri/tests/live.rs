//! Живой смоук интеграции: те же вызовы, что делают Tauri-команды, но без
//! окна (окно и кнопки — сторона UI-модуля). Доказывает, что path-dep
//! на l2t-core и контрактные типы работают из tauri-проекта с РЕАЛЬНЫМИ
//! audio-analyzer и midi-gen.

use std::path::PathBuf;

use l2t_core::contract::Part;
use l2t_core::CockpitCore;
use serde_json::json;

fn write_sine_wav(path: &std::path::Path) {
    let sr = 44100u32;
    let n = sr / 2;
    let mut data = Vec::with_capacity((n * 2) as usize);
    for i in 0..n {
        let t = i as f32 / sr as f32;
        let s = (2.0 * std::f32::consts::PI * 440.0 * t).sin() * 12000.0;
        data.extend_from_slice(&(s as i16).to_le_bytes());
    }
    let mut f = std::fs::File::create(path).unwrap();
    use std::io::Write;
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

#[tokio::test]
async fn cockpit_core_live_from_tauri_project() {
    let an = l2t_core::config::resolve_audio_analyzer();
    let mg = l2t_core::config::resolve_midi_gen();
    if !an.command.is_file() || !mg.command.is_file() {
        eprintln!("SKIP: живые слоты шины недоступны");
        return;
    }
    let staging = std::env::temp_dir().join("l2t-tauri-live-test");
    let _ = std::fs::remove_dir_all(&staging);
    let mut core = CockpitCore::connect_in(an, mg, staging.clone()).await;

    // analyze_loop: живой audio-analyzer → XRayReport контракта
    let wav = PathBuf::from("/tmp/l2t-tauri-live-sine.wav");
    write_sine_wav(&wav);
    let xray = core.analyze_loop(&wav).await.expect("живой analyze_loop");
    assert_eq!(xray.key, "A minor");

    // generate_part: живой midi-gen → Suggestion контракта
    let s = core
        .generate_part(Part::Bass, json!({"bpm": 60, "key": "A minor"}))
        .await
        .expect("живой generate_part");
    assert!(!s.notes.is_empty());
    assert!(staging.join("bass_v1.mid").is_file());

    // журнал шины накопился — источник события bus_log
    assert!(!core.take_bus_log().is_empty());

    core.shutdown().await;
}

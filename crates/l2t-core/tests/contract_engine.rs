//! Контракт-тест движка (зазор №2 спайка): инварианты форм ответов
//! v0.20.1 против golden-файлов. Golden v0.5.0 снят ЖИВЫМ с ZCode-плагин-моста
//! 2026-11-22 (commands: new_session/event.tempo/markers.add/file.import_midi/
//! bounce_mix/session.inspect/edit.undo) — формы совпали поле-в-поле
//! (ALL_FORMS_MATCH), миграция DawBackend контртно-безопасна.
//!
//! Тест читает golden-v0201.json (зафиксированный прогон standalone) и
//! проверяет инварианты, на которых стоит DawBackend. Живой движок не нужен.

use serde_json::Value;

const GOLDEN: &str = include_str!("golden/engine-v0201.json");
const GOLDEN_V050: &str = include_str!("golden/engine-v050.json");

#[test]
fn engine_v0201_golden_invariants() {
    let g: Value = serde_json::from_str(GOLDEN).expect("golden v0.20.1 валиден");

    // event.tempo: {bpm, tick}
    let tempo = &g["event.tempo"];
    assert!(tempo["bpm"].is_f64() || tempo["bpm"].is_u64(), "bpm — число");
    assert!(tempo["tick"].is_u64(), "tick — число");

    // markers.add: {id, number}; kind нормализуется движком в "Marker",
    // key-конвенция живёт в ИМЕНИ (adopt_loop)
    let marker = &g["markers.add"];
    assert!(marker["id"].is_u64() && marker["number"].is_u64());

    // file.import_midi: {tracks: [id…]}
    let imp = g["file.import_midi"]["tracks"].as_array().expect("tracks — массив id");
    assert!(imp.iter().all(|v| v.is_u64()));

    // bounce_mix: полный набор ключей LUFS-отчёта (форма v0.5.0 идентична)
    let bounce = &g["bounce_mix"];
    for key in ["bytes", "lufs", "path", "peak_db", "seconds", "true_peak_db"] {
        assert!(bounce.get(key).is_some(), "bounce_mix.{key} обязан быть");
    }

    // session.inspect: 24 ключа top-level; tempo — МАССИВ темп-карты;
    // маркер kind="Marker", key-конвенция в имени
    let insp = &g["session.inspect"];
    let keys = insp.as_object().expect("inspect — объект").keys().count();
    assert_eq!(keys, 24);
    assert_eq!(insp["tempo"][0]["bpm"], serde_json::json!(90.0));
    assert_eq!(insp["markers"][0]["kind"], serde_json::json!("Marker"));
    assert_eq!(insp["markers"][0]["name"], serde_json::json!("Key: A minor"));
    assert_eq!(insp["tracks"][0]["clips"][0]["notes"], serde_json::json!(5));
}

#[test]
fn golden_v050_and_v0201_forms_match() {
    let old: Value = serde_json::from_str(GOLDEN_V050).unwrap();
    let new: Value = serde_json::from_str(GOLDEN).unwrap();
    // верхнеуровневые формы обеих версий совпали поле-в-поле (спайк §7.2)
    for cmd in ["new_session", "event.tempo", "markers.add", "file.import_midi", "edit.undo"] {
        let a = old[cmd].as_object().expect(cmd).keys().collect::<Vec<_>>();
        let b = new[cmd].as_object().expect(cmd).keys().collect::<Vec<_>>();
        assert_eq!(a, b, "форма {cmd} разошлась между v0.5.0 и v0.20.1");
    }
    let bounce_old = old["bounce_mix"].as_object().unwrap().keys().collect::<Vec<_>>();
    let bounce_new = new["bounce_mix"].as_object().unwrap().keys().collect::<Vec<_>>();
    assert_eq!(bounce_old, bounce_new, "форма bounce_mix разошлась");
}

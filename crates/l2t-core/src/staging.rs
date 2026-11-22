//! Стейджинг-манифест (контракт § «Файлы стейджинга», §5.3 proposal —
//! Acceptance Rate с первого дня): staging/manifest.json = список
//! ManifestRecord {suggestion-снимок, decision, ts}.
//!
//! Правило записи: read-modify-write целиком (файл маленький, один писатель
//! — ядро; конкурентных правок из UI нет — UI ходит через команды).

use std::path::Path;

use serde_json::Value;

use crate::contract::{ManifestRecord, Part, SuggestionStatus};
use crate::error::{CoreError, CoreResult};

pub const MANIFEST_FILE: &str = "manifest.json";

/// Прочитать манифест (отсутствует/битый → пустой список, не ошибка:
/// manifest — лог, повреждение не блокирует UI — решение Собрания №1).
pub fn staging_read(dir: &Path) -> Vec<ManifestRecord> {
    let path = dir.join(MANIFEST_FILE);
    std::fs::read(&path)
        .ok()
        .and_then(|b| serde_json::from_slice::<Vec<ManifestRecord>>(&b).ok())
        .unwrap_or_default()
}

/// Записать манифест целиком (создаёт staging-dir при необходимости).
pub fn staging_write(dir: &Path, records: &[ManifestRecord]) -> CoreResult<()> {
    std::fs::create_dir_all(dir).map_err(|e| staging_err(format!("не создал {}: {e}", dir.display())))?;
    let path = dir.join(MANIFEST_FILE);
    let json = serde_json::to_vec_pretty(records)
        .map_err(|e| staging_err(format!("сериализация manifest: {e}")))?;
    std::fs::write(&path, json).map_err(|e| staging_err(format!("не записал {}: {e}", path.display())))
}

/// Добавить suggestion-инстанс (decision: None = generated).
pub fn staging_append(dir: &Path, suggestion: &crate::contract::Suggestion) -> CoreResult<()> {
    let mut records = staging_read(dir);
    records.push(ManifestRecord {
        suggestion: suggestion.clone(),
        decision: None,
        ts: now_ms(),
    });
    staging_write(dir, &records)
}

/// Залогировать решение (accept/reject) по (part, version): находит запись,
/// ставит decision + ts. Возвращает false, если записи нет.
pub fn staging_log_decision(
    dir: &Path,
    part: Part,
    version: u64,
    decision: SuggestionStatus,
) -> CoreResult<bool> {
    let mut records = staging_read(dir);
    let mut found = false;
    for r in records.iter_mut().rev() {
        if r.suggestion.part == part && r.suggestion.version == version {
            r.decision = Some(decision);
            r.ts = now_ms();
            found = true;
            break;
        }
    }
    if found {
        staging_write(dir, &records)?;
    }
    Ok(found)
}

/// Acceptance Rate по манифесту: accepted / (accepted + rejected); None,
/// если решённых записей нет (UI показывает no-data, урок ui-acceptance-rate).
pub fn acceptance_rate(dir: &Path) -> Option<f64> {
    let records = staging_read(dir);
    let accepted = records.iter().filter(|r| r.decision == Some(SuggestionStatus::Accepted)).count();
    let rejected = records.iter().filter(|r| r.decision == Some(SuggestionStatus::Rejected)).count();
    let total = accepted + rejected;
    if total == 0 {
        None
    } else {
        Some(accepted as f64 / total as f64)
    }
}

/// Сырой манифест для фронта (вкладка Статистика) — компактный JSON.
pub fn staging_json(dir: &Path) -> Value {
    serde_json::to_value(staging_read(dir)).unwrap_or(Value::Array(vec![]))
}

fn staging_err(message: String) -> CoreError {
    CoreError::Tool { tool: "manifest".into(), message }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::{Note, Part, Suggestion, SuggestionStatus};

    fn sug(version: u64, part: Part) -> Suggestion {
        Suggestion {
            version,
            part,
            notes: vec![Note { note: 45, start: 0, end: 240, velocity: 100, channel: 0 }],
            rationale: "тест".into(),
            confidence: 1.0,
            source_tool: "midi-gen.generate_bassline".into(),
            params: serde_json::json!({"bpm": 90}),
            status: SuggestionStatus::Generated,
        }
    }

    #[test]
    fn append_then_decide_roundtrip() {
        let dir = std::env::temp_dir().join("l2t-staging-test-1");
        let _ = std::fs::remove_dir_all(&dir);
        assert!(staging_read(&dir).is_empty(), "нет файла — пустой лог");

        staging_append(&dir, &sug(1, Part::Bass)).unwrap();
        staging_append(&dir, &sug(1, Part::Drums)).unwrap();
        staging_append(&dir, &sug(2, Part::Bass)).unwrap();

        // решение по (bass, 1)
        assert!(staging_log_decision(&dir, Part::Bass, 1, SuggestionStatus::Accepted).unwrap());
        assert!(!staging_log_decision(&dir, Part::Bass, 9, SuggestionStatus::Rejected).unwrap());

        let records = staging_read(&dir);
        assert_eq!(records.len(), 3);
        assert_eq!(records[0].decision, Some(SuggestionStatus::Accepted));
        assert_eq!(records[1].decision, None); // чужая партия не задета
        assert_eq!(records[1].suggestion.part, Part::Drums);
        assert_eq!(records[2].decision, None);

        // rate: 1 accepted / 1 решённая = 1.0
        assert_eq!(acceptance_rate(&dir), Some(1.0));
        staging_log_decision(&dir, Part::Drums, 1, SuggestionStatus::Rejected).unwrap();
        assert_eq!(acceptance_rate(&dir), Some(0.5));
    }

    #[test]
    fn corrupted_manifest_is_empty_not_error() {
        let dir = std::env::temp_dir().join("l2t-staging-test-2");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(MANIFEST_FILE), b"{broken json").unwrap();
        assert!(staging_read(&dir).is_empty());
        // лог восстанавливается перезаписью
        staging_append(&dir, &sug(1, Part::Bass)).unwrap();
        assert_eq!(staging_read(&dir).len(), 1);
    }
}

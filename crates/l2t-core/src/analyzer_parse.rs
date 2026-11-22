//! Нормализация текстовых отчётов audio-analyzer в `XRayReport`.
//!
//! Наш локальный бинарь (rmcp 1.x-сервер JuzzyDee/audio-analyzer-rs)
//! отвечает человекочитаемым текстом с фиксированными метками — JSON-режима
//! у суб-инструментов нет (сверено живым дампом: resolution лишь добавляет
//! таймлайны). Парсим по меткам; пропавшая метка = bounded-ошибка с именем
//! метки, никаких паник и никаких выдуманных значений.

use std::collections::BTreeMap;

use crate::error::{CoreError, CoreResult};

fn tool_err(what: &str) -> CoreError {
    CoreError::Tool {
        tool: "audio-analyzer".into(),
        message: what.into(),
    }
}

fn after<'a>(text: &'a str, label: &str) -> CoreResult<&'a str> {
    let idx = text
        .find(label)
        .ok_or_else(|| tool_err(&format!("в отчёте нет метки «{label}»")))?;
    Ok(text[idx + label.len()..].trim_start())
}

fn number_after(text: &str, label: &str) -> CoreResult<f64> {
    let rest = after(text, label)?;
    let token: String = rest
        .chars()
        .take_while(|c| c.is_ascii_digit() || matches!(c, '-' | '+' | '.' | 'e' | 'E'))
        .collect();
    token
        .parse::<f64>()
        .map_err(|_| tool_err(&format!("после «{label}» не число: {token:?}")))
}

/// "Estimated Key: A minor (confidence: 0.682)"
pub fn key_of(harmonic: &str) -> CoreResult<(String, f64)> {
    let rest = after(harmonic, "Estimated Key:")?;
    let key: String = rest
        .chars()
        .take_while(|c| !matches!(c, '(' | '\n'))
        .collect();
    let key = key.trim().to_string();
    if key.is_empty() {
        return Err(tool_err("пустая тональность в harmonic-отчёте"));
    }
    // валидируем парсером тональностей (ловит мусор вида "A minor (conf…")
    let conf = number_after(harmonic, "(confidence:")?;
    crate::keys::parse_key(&key).map_err(|e| tool_err(&e))?;
    Ok((key, conf))
}

/// "Estimated Tempo: 120.0 BPM (confidence: 0.000)"
pub fn tempo_of(rhythm: &str) -> CoreResult<(f64, f64)> {
    let bpm = number_after(rhythm, "Estimated Tempo:")?;
    let conf = number_after(rhythm, "(confidence:")?;
    Ok((bpm, conf))
}

/// "Integrated:      -9.5 LUFS" и "True peak:       -8.7 dBTP"
pub fn loudness_of(spectral: &str) -> CoreResult<(f64, f64)> {
    let lufs = number_after(spectral, "Integrated:")?;
    let peak = number_after(spectral, "True peak:")?;
    Ok((lufs, peak))
}

/// Секция "Frequency Band Energy:\n  sub_bass (20–60 Hz): 0.000005\n…"
/// до ближайшей пустой строки.
pub fn bands_of(spectral: &str) -> CoreResult<BTreeMap<String, f64>> {
    let rest = after(spectral, "Frequency Band Energy:")?;
    let mut bands = BTreeMap::new();
    for line in rest.lines().take_while(|l| !l.trim().is_empty()) {
        let line = line.trim();
        // "sub_bass (20–60 Hz): 0.000005"
        let (name_part, value_part) = line
            .split_once(':')
            .ok_or_else(|| tool_err(&format!("строка полосы без значения: {line:?}")))?;
        let name = name_part.split('(').next().unwrap_or("").trim().to_string();
        let value: f64 = value_part
            .trim()
            .parse()
            .map_err(|_| tool_err(&format!("полоса {name:?}: не число {value_part:?}")))?;
        bands.insert(name, value);
    }
    if bands.is_empty() {
        return Err(tool_err("секция Frequency Band Energy пуста"));
    }
    Ok(bands)
}

/// "Detected Beats: 1" + duration из audio_info ("Duration: 0.50 seconds")
/// → beats/sec (прокси onset-density; None при нулевых битах).
pub fn onset_density_of(rhythm: &str, info: &str) -> Option<f64> {
    let beats = number_after(rhythm, "Detected Beats:").ok()?;
    let secs = number_after(info, "Duration:").ok()?;
    if beats > 0.0 && secs > 0.0 {
        Some((beats / secs * 10_000.0).round() / 10_000.0)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Фрагменты живого дампа на синусе (см. tests/dump.rs, удалён).
    const SPECTRAL: &str = "Spectral Analysis: /tmp/sine.wav\nDuration: 0.46 sec\n\nCentroid (brightness):     avg 446 Hz — dark/warm\n\nFrequency Band Energy:\n  sub_bass (20–60 Hz): 0.000005\n  bass (60–250 Hz): 0.000018\n  low_mid (250–500 Hz): 0.033792\n  mid (500–2000 Hz): 0.000256\n\nSpectral Contrast (peak–valley):\n  sub_bass (20–60 Hz): 1.3 dB\n\n── Loudness (EBU R128) ──\nIntegrated:      -9.5 LUFS\nTrue peak:       -8.7 dBTP\nLoudness range:  0.0 LU\n";
    const HARMONIC: &str = "Harmonic Analysis: /tmp/sine.wav\n\nEstimated Key: A minor (confidence: 0.682)\n\nPitch Class Distribution:\n   1. A  1.000";
    const RHYTHM: &str = "Rhythm Analysis: /tmp/sine.wav\n\nEstimated Tempo: 120.0 BPM (confidence: 0.000)\nDetected Beats: 1\n\nFirst 1 beats: 0.05s";
    const INFO: &str = "File: /tmp/sine.wav\nSample rate: 44100 Hz\nSamples: 22050\nDuration: 0.50 seconds";

    #[test]
    fn parses_live_dump_fragments() {
        assert_eq!(key_of(HARMONIC).unwrap(), ("A minor".into(), 0.682));
        assert_eq!(tempo_of(RHYTHM).unwrap(), (120.0, 0.0));
        assert_eq!(loudness_of(SPECTRAL).unwrap(), (-9.5, -8.7));
        let bands = bands_of(SPECTRAL).unwrap();
        assert_eq!(bands.len(), 4);
        assert!((bands["low_mid"] - 0.033792).abs() < 1e-9);
        let od = onset_density_of(RHYTHM, INFO).unwrap();
        assert!((od - 2.0).abs() < 0.01); // 1 бит / 0.5 с
    }

    #[test]
    fn missing_label_is_bounded_error() {
        let err = key_of("нет ничего").unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("Estimated Key"), "текст: {msg}");
    }
}

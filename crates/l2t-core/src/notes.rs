//! Порт `src/core/midi_io.py::load_notes`: MIDI-файл → компактный конверт
//! нот в формате контракта (`{note, start, end, velocity, channel}` в
//! тиках, каналы 0-indexed). Семантика 1:1 с питон-версией:
//! - bpm — из первого `set_tempo` (None, если файла темпа нет —
//!   контракт `embed_tempo=false`);
//! - форшлаг-ретриг раскрыт ОЧЕРЕДЬЮ (python `pop(0)`): первый
//!   note_off закрывает самый ранний открытый note_on той же ноты;
//! - сортировка (start, note).

use std::collections::VecDeque;
use std::path::Path;

use midly::num::{u4, u7};
use midly::{MetaMessage, MidiMessage, Smf, TrackEventKind};
use serde::Serialize;

use crate::contract::Note;
use crate::error::{CoreError, CoreResult};

/// Конверт `load_notes` (поля те же, что у питон-версии).
#[derive(Debug, Clone, Serialize)]
pub struct NotesEnvelope {
    pub path: String,
    pub ticks_per_beat: u16,
    /// None по контракту embed_tempo=false (сессия — источник истины).
    pub bpm: Option<f64>,
    pub duration_ticks: u64,
    pub note_count: usize,
    pub notes: Vec<Note>,
}

/// Открытые ноты: (channel, note) → FIFO-очередь (start, velocity).
/// Очередь, а не стек — семантика python `pop(0)`: первый note_off
/// закрывает самый ранний note_on той же ноты (форшлаг-ретриг).
type ActiveNotes = Vec<((u8, u8), VecDeque<(u64, u8)>)>;

/// Прочитать .mid в конверт нот. Ошибка формата — bounded `CoreError::Tool`.
pub fn load_notes(path: &Path) -> CoreResult<NotesEnvelope> {
    let bytes = std::fs::read(path).map_err(|e| {
        CoreError::Tool {
            tool: "midi_io.load_notes".into(),
            message: format!("не прочитал {}: {e}", path.display()),
        }
    })?;
    let smf = Smf::parse(&bytes).map_err(|e| CoreError::Tool {
        tool: "midi_io.load_notes".into(),
        message: format!("битый MIDI {}: {e}", path.display()),
    })?;
    let ticks_per_beat = match smf.header.timing {
        midly::Timing::Metrical(tpq) => tpq.as_int(),
        midly::Timing::Timecode(..) => {
            return Err(CoreError::Tool {
                tool: "midi_io.load_notes".into(),
                message: "SMPTE-timecode не поддерживается (ждём Metrical/TPQ)".into(),
            })
        }
    };
    let mut bpm: Option<f64> = None;
    let mut notes: Vec<Note> = Vec::new();
    for track in &smf.tracks {
        let mut t: u64 = 0;
        let mut active: ActiveNotes = Vec::new();
        for event in track {
            t += event.delta.as_int() as u64;
            match event.kind {
                TrackEventKind::Meta(MetaMessage::Tempo(us_per_quarter)) => {
                    if bpm.is_none() {
                        bpm = Some(round2(60_000_000.0 / us_per_quarter.as_int() as f64));
                    }
                }
                TrackEventKind::Midi { channel, message } => {
                    let ch = channel.as_int();
                    match message {
                        MidiMessage::NoteOn { key, vel } if vel.as_int() > 0 => {
                            let q = queue_of(&mut active, ch, key.as_int());
                            q.push_back((t, vel.as_int()));
                        }
                        MidiMessage::NoteOff { key, .. } => {
                            close(&mut active, ch, key.as_int(), t, &mut notes);
                        }
                        MidiMessage::NoteOn { key, vel } if vel.as_int() == 0 => {
                            close(&mut active, ch, key.as_int(), t, &mut notes);
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }
    }
    notes.sort_by_key(|n| (n.start, n.note as u64));
    let duration_ticks = notes.iter().map(|n| n.end).max().unwrap_or(0);
    Ok(NotesEnvelope {
        path: path.display().to_string(),
        ticks_per_beat,
        bpm,
        duration_ticks,
        note_count: notes.len(),
        notes,
    })
}

fn queue_of(
    active: &mut ActiveNotes,
    channel: u8,
    note: u8,
) -> &mut VecDeque<(u64, u8)> {
    if let Some(idx) = active.iter().position(|(k, _)| *k == (channel, note)) {
        &mut active[idx].1
    } else {
        active.push(((channel, note), VecDeque::new()));
        let last = active.len() - 1;
        &mut active[last].1
    }
}

fn close(active: &mut ActiveNotes, channel: u8, note: u8, end: u64, out: &mut Vec<Note>) {
    if let Some(idx) = active.iter().position(|(k, _)| *k == (channel, note))
        && let Some((start, velocity)) = active[idx].1.pop_front()
    {
        out.push(Note { note, start, end, velocity, channel });
    }
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

#[allow(unused)]
fn _type_assertions(_c: u4, _n: u7) {} // держит импорты числа-типов при рефакторах

#[cfg(test)]
mod tests {
    use super::*;

    /// Временный MIDI в tmp: одна нота C4 (60) на канале 0, тик 0..240.
    #[test]
    fn parses_simple_note() {
        let dir = std::env::temp_dir().join("l2t-core-notes-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("simple.mid");
        let mut smf = Smf::new(midly::Header {
            format: midly::Format::SingleTrack,
            timing: midly::Timing::Metrical(midly::num::u15::from(480)),
        });
        let track = vec![
            midly::TrackEvent {
                delta: midly::num::u28::from(0),
                kind: midly::TrackEventKind::Midi {
                    channel: midly::num::u4::from(0),
                    message: MidiMessage::NoteOn {
                        key: midly::num::u7::from(60),
                        vel: midly::num::u7::from(100),
                    },
                },
            },
            midly::TrackEvent {
                delta: midly::num::u28::from(240),
                kind: midly::TrackEventKind::Midi {
                    channel: midly::num::u4::from(0),
                    message: MidiMessage::NoteOff {
                        key: midly::num::u7::from(60),
                        vel: midly::num::u7::from(0),
                    },
                },
            },
        ];
        smf.tracks.push(track);
        let mut buf = Vec::new();
        smf.write_std(&mut buf).unwrap();
        std::fs::write(&path, &buf).unwrap();

        let env = load_notes(&path).unwrap();
        assert_eq!(env.ticks_per_beat, 480);
        assert_eq!(env.bpm, None);
        assert_eq!(env.note_count, 1);
        assert_eq!(
            env.notes[0],
            Note { note: 60, start: 0, end: 240, velocity: 100, channel: 0 }
        );
    }
}

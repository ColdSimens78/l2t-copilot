//! Порт `src/core/keys.py`: парсер тональностей и relative-key equivalence
//! для Self-Check (правило шины №7). Семантика 1:1 с питон-версией,
//! тесты — те же инварианты (A minor ≡ C major; A minor ≢ A major).

pub const PC_NAMES: [&str; 12] =
    ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/// `'A minor' | 'Am' | 'C#' | 'Bbm' -> (питч-класс тоники, minor|major)`.
pub fn parse_key(key: &str) -> Result<(u8, Mode), String> {
    let key = key.trim();
    let mut chars = key.chars();
    let letter = chars.next().ok_or_else(|| bad(key))?;
    if !matches!(letter, 'A'..='G' | 'a'..='g') {
        return Err(bad(key));
    }
    // диез/бемоль (юникодные тоже — как в питон-версии)
    let mut name = letter.to_ascii_uppercase().to_string();
    if let Some(acc) = chars.clone().next() {
        match acc {
            '#' | '♯' => {
                name.push('#');
                chars.next();
            }
            'b' | '♭' => {
                // 'b' после буквы — бемоль, если дальше не идёт 'maj'/'min'
                // (редкий случай "Bbm" разбирается правильно: b+bm)
                let rest: String = chars.clone().collect();
                if !rest.is_empty() && !rest.starts_with("min") && !rest.starts_with("maj") {
                    name.push('b');
                    chars.next();
                }
            }
            _ => {}
        }
    }
    // питон-версия переводит бемоли в диезы
    if let Some(sharp) = flat_to_sharp(&name) {
        name = sharp.to_string();
    }
    let pc = PC_NAMES
        .iter()
        .position(|n| *n == name)
        .ok_or_else(|| bad(key))? as u8;
    let rest: String = chars.collect::<String>().trim().to_lowercase();
    let mode = match rest.as_str() {
        "m" | "min" | "minor" => Mode::Minor,
        "" | "maj" | "major" => Mode::Major,
        other => return Err(format!("неизвестный лад {other:?} в {key:?}")),
    };
    Ok((pc, mode))
}

fn bad(key: &str) -> String {
    format!("не разобрал тональность {key:?}; примеры: 'A minor', 'C# major', 'Ebm'")
}

fn flat_to_sharp(name: &str) -> Option<&'static str> {
    Some(match name {
        "Db" => "C#",
        "Eb" => "D#",
        "Gb" => "F#",
        "Ab" => "G#",
        "Bb" => "A#",
        _ => return None,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Minor,
    Major,
}

impl Mode {
    pub fn as_str(self) -> &'static str {
        match self {
            Mode::Minor => "minor",
            Mode::Major => "major",
        }
    }
}

/// Идентификатор ключевых знаков: питч-класс тоники относительного мажора.
pub fn signature_pc(pc: u8, mode: Mode) -> u8 {
    match mode {
        Mode::Major => pc,
        Mode::Minor => (pc + 3) % 12,
    }
}

/// Relative-key equivalence: один набор ключевых знаков.
pub fn keys_match(key_a: &str, key_b: &str) -> bool {
    let (pc_a, mode_a) = parse_key(key_a).expect("валидная тональность A");
    let (pc_b, mode_b) = parse_key(key_b).expect("валидная тональность B");
    signature_pc(pc_a, mode_a) == signature_pc(pc_b, mode_b)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Те же инварианты, что в tests/test_generation.py (питон-ядро).
    #[test]
    fn relative_key_equivalence() {
        assert!(keys_match("A minor", "C major"));
        assert!(keys_match("C major", "A minor"));
        assert!(!keys_match("A minor", "A major"));
        assert!(!keys_match("A minor", "E minor"));
        assert!(keys_match("Ebm", "Gb major")); // бемоли → диезы, relative
    }

    #[test]
    fn parse_forms() {
        assert_eq!(parse_key("Am"), Ok((9, Mode::Minor)));
        assert_eq!(parse_key("C#"), Ok((1, Mode::Major)));
        assert_eq!(parse_key("Bbm"), Ok((10, Mode::Minor)));
        assert!(parse_key("H major").is_err());
    }
}

//! Конфигурация серверов шины: что и как спавнить.
//!
//! Пресеты — машина Ilmir (пути этапа 1); каждый переопределяется
//! переменной окружения, чтобы ядро работало в другом окружении без
//! правки кода. Правила конфига из README действуют и здесь: абсолютные
//! пути, никакого шаблонизатора.

use std::collections::HashMap;
use std::env;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

/// Описание одного MCP-сервера шины (stdio).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerConfig {
    /// Имя слота на шине: "midi-gen", "audio-analyzer".
    pub name: &'static str,
    /// Абсолютный путь к исполняемому файлу.
    pub command: PathBuf,
    pub args: Vec<String>,
    /// Доп. окружение процесса (например PYTHONPATH для fallback-режима).
    pub env: HashMap<String, String>,
}

pub const MIDI_GEN_PRIMARY: &str = "/home/ilmir/l2t-copilot/.venv/bin/l2t-midi-gen";
pub const MIDI_GEN_FALLBACK_PY: &str = "/home/ilmir/midi-env/bin/python";
pub const MIDI_GEN_PYTHONPATH: &str = "/home/ilmir/l2t-copilot/src";
pub const AUDIO_ANALYZER_BIN: &str = "/home/ilmir/bin/mcp-server";

fn executable(path: &Path) -> bool {
    path.is_file()
        && path
            .metadata()
            .map(|m| m.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
}

/// Пресет midi-gen с fallback-резолвом: консольный скрипт репо-venv,
/// а если его нет — python из midi-env с PYTHONPATH на src репозитория.
pub fn resolve_midi_gen() -> ServerConfig {
    if let Some(over) = env::var_os("L2T_MIDI_GEN") {
        return ServerConfig {
            name: "midi-gen",
            command: PathBuf::from(over),
            args: vec![],
            env: HashMap::new(),
        };
    }
    let primary = Path::new(MIDI_GEN_PRIMARY);
    if executable(primary) {
        ServerConfig {
            name: "midi-gen",
            command: primary.to_path_buf(),
            args: vec![],
            env: HashMap::new(),
        }
    } else {
        ServerConfig {
            name: "midi-gen",
            command: PathBuf::from(MIDI_GEN_FALLBACK_PY),
            args: vec!["-m".into(), "mcp_servers.midi_gen.server".into()],
            env: [("PYTHONPATH".to_string(), MIDI_GEN_PYTHONPATH.to_string())]
                .into_iter()
                .collect(),
        }
    }
}

/// Пресет audio-analyzer (внешний Rust-бинарь, JuzzyDee/audio-analyzer-rs).
pub fn resolve_audio_analyzer() -> ServerConfig {
    let command = env::var_os("L2T_AUDIO_ANALYZER")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(AUDIO_ANALYZER_BIN));
    ServerConfig {
        name: "audio-analyzer",
        command,
        args: vec![],
        env: HashMap::new(),
    }
}

pub const SOUNDCRAFT_BIN: &str = "/home/ilmir/bin/soundcraft-cli";
pub const SOUNDCRAFT_WORKSPACE: &str = "/home/ilmir/music-workspace";

/// Пресет слота «Движок»: SoundCraft v0.20.1 standalone headless-MCP
/// (спайк Исход 3 — docs/oss-recon-engines.md, docs/engine-spike-report.md).
///
/// `--demo` поднимает in-process движок без GUI; automation-roots —
/// песочница правила шины №1, встроенная в сам движок. workspace задаётся
/// env L2T_SOUNDCRAFT_WORKSPACE (по умолчанию ~/music-workspace); бинарь —
/// L2T_SOUNDCRAFT. Слот пока НЕ входит в CockpitCore: подключение движка —
/// после ратификации DawBackend владельцем (спайк → facts).
pub fn resolve_soundcraft() -> ServerConfig {
    let command = env::var_os("L2T_SOUNDCRAFT")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(SOUNDCRAFT_BIN));
    let workspace =
        env::var_os("L2T_SOUNDCRAFT_WORKSPACE").unwrap_or_else(|| SOUNDCRAFT_WORKSPACE.into());
    let ws = workspace.to_string_lossy().to_string();
    ServerConfig {
        name: "soundcraft",
        command,
        args: vec![
            "mcp".into(),
            "--demo".into(),
            "--automation-read-root".into(),
            ws.clone(),
            "--automation-write-root".into(),
            ws,
        ],
        env: HashMap::new(),
    }
}

/// Все серверы шины, которыми владеет ядро на этапе 1.
pub fn bus_configs() -> Vec<ServerConfig> {
    vec![resolve_audio_analyzer(), resolve_midi_gen()]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn midi_gen_resolves_to_runnable_form() {
        let cfg = resolve_midi_gen();
        assert_eq!(cfg.name, "midi-gen");
        if cfg.command == Path::new(MIDI_GEN_PRIMARY) {
            // primary должен быть исполняемым — иначе взяли бы fallback
            assert!(executable(&cfg.command));
            assert!(cfg.args.is_empty());
        } else {
            // fallback: python -m mcp_servers.midi_gen.server + PYTHONPATH
            assert_eq!(cfg.command, Path::new(MIDI_GEN_FALLBACK_PY));
            assert_eq!(cfg.args, vec!["-m", "mcp_servers.midi_gen.server"]);
            assert_eq!(
                cfg.env.get("PYTHONPATH").map(String::as_str),
                Some(MIDI_GEN_PYTHONPATH)
            );
        }
    }

    #[test]
    fn audio_analyzer_preset_is_absolute() {
        let cfg = resolve_audio_analyzer();
        assert_eq!(cfg.name, "audio-analyzer");
        assert!(cfg.command.is_absolute());
        assert!(cfg.args.is_empty());
    }

    #[test]
    fn bus_configs_cover_both_slots() {
        let names: Vec<_> = bus_configs().iter().map(|c| c.name).collect();
        assert_eq!(names, vec!["audio-analyzer", "midi-gen"]);
    }
}

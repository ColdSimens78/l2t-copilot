//! Превью-рендер MIDI → WAV сайдкаром FluidSynth (§10.2 proposal, вердикт
//! Разведчика: сайдкар-процесс = LGPL-чист, доки docs/oss-recon-soundfonts.md).
//!
//! Никакого DSP в ядре (правило №5 proposal §6.2): ядро лишь оркестрирует
//! оффлайн-рендер и отдаёт фронту путь к готовому WAV для HTML-audio.
//!
//! Soundfont-детект (порядок гейта Разведчика): системный sf3 → системный
//! sf2 → env L2T_SOUNDFONT; отсутствуют — bounded-ошибка с apt-подсказкой.
//! Рендер — bounded: таймаут 30 с, вывод stderr в текст ошибки.

use std::path::{Path, PathBuf};
use std::time::Duration;

use tokio::process::Command;

use crate::error::{CoreError, CoreResult};

/// Системные дефолты (пакеты Debian: musescore-general-soundfont,
/// fluid-soundfont-gm — оба MIT, лицензионный гейт пройден).
pub const SF3_DEFAULT: &str = "/usr/share/sounds/sf3/MuseScore_General.sf3";
pub const SF2_DEFAULT: &str = "/usr/share/sounds/sf2/FluidR3_GM.sf2";
pub const RENDER_TIMEOUT: Duration = Duration::from_secs(30);

/// Команда рендера из разведки: `fluidsynth -ni -F out.wav -r 44100 -g 0.4
/// "$SF" in.mid` (-g 0.4 ≈ −12 dBFS headroom, не клипует GM-стек).
pub fn fluidsynth_command(sf: &Path, mid: &Path, wav: &Path) -> Command {
    let mut cmd = Command::new("fluidsynth");
    cmd.arg("-ni")
        .arg("-F")
        .arg(wav)
        .arg("-r")
        .arg("44100")
        .arg("-g")
        .arg("0.4")
        .arg(sf)
        .arg(mid)
        .kill_on_drop(true);
    cmd
}

/// Авто-детект soundfont: sf3 → sf2 → env L2T_SOUNDFONT.
pub fn detect_soundfont() -> Option<PathBuf> {
    [SF3_DEFAULT, SF2_DEFAULT]
        .iter()
        .map(PathBuf::from)
        .find(|p| p.is_file())
        .or_else(|| std::env::var_os("L2T_SOUNDFONT").map(PathBuf::from))
        .filter(|p| p.is_file())
}

fn preview_err(message: impl Into<String>) -> CoreError {
    CoreError::Tool { tool: "render_preview".into(), message: message.into() }
}

/// Отрендерить WAV рядом с .mid (same stem, расширение .wav).
/// Возвращает путь к готовому WAV — фронт проигрывает его HTML-audio.
pub async fn render_preview(mid_path: &Path) -> CoreResult<PathBuf> {
    if !mid_path.is_file() {
        return Err(preview_err(format!("нет файла {}", mid_path.display())));
    }
    let Some(sf) = detect_soundfont() else {
        return Err(preview_err(
            "GM-soundfont не найден. Установи: sudo apt install \
             fluidsynth musescore-general-soundfont (sf3) или задай L2T_SOUNDFONT",
        ));
    };
    let wav = mid_path.with_extension("wav");
    let output = tokio::time::timeout(
        RENDER_TIMEOUT,
        fluidsynth_command(&sf, mid_path, &wav).output(),
    )
    .await
    .map_err(|_| CoreError::Timeout {
        server: "fluidsynth".into(),
        tool: "render_preview".into(),
        secs: RENDER_TIMEOUT.as_secs_f64(),
        server_alive: None,
    })?
    .map_err(|e| preview_err(format!(
        "fluidsynth не запустился: {e}. apt install fluidsynth?"
    )))?;
    if !output.status.success() {
        return Err(preview_err(format!(
            "fluidsynth exit {}: {}",
            output.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    if !wav.is_file() {
        return Err(preview_err("fluidsynth не создал WAV (молча)"));
    }
    Ok(wav)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn soundfont_detect_order() {
        // на этой машине оба системных на месте; порядок sf3-первый
        let sf = detect_soundfont();
        if let Some(sf) = sf {
            assert!(sf.is_file());
            // если системные есть — env не должен их перебивать (буква
            // вердикта: sf3 → sf2 → env)
            assert!(
                sf.to_str().is_some_and(|s| s == SF3_DEFAULT || s == SF2_DEFAULT),
                "системный SF должен быть дефолтом, а не {sf:?}"
            );
        }
    }

    #[tokio::test]
    async fn missing_mid_is_bounded_error() {
        let err = render_preview(Path::new("/nonexistent/x.mid")).await.unwrap_err();
        assert!(err.to_string().contains("нет файла"));
    }

    /// Живой рендер — только если fluidsynth и soundfont установлены
    /// (CI и машины без сайдкара пропускают).
    #[tokio::test]
    async fn renders_sine_bass_to_wav() {
        if which("fluidsynth").is_none() || detect_soundfont().is_none() {
            eprintln!("SKIP: fluidsynth или soundfont не установлены");
            return;
        }
        // генерируем бас через midi-gen (если слот есть) — иначе skip
        let cfg = crate::config::resolve_midi_gen();
        if !cfg.command.is_file() {
            eprintln!("SKIP: midi-gen не найден");
            return;
        }
        let server = crate::bus::BusServer::connect(cfg).await.unwrap();
        let mid = std::env::temp_dir().join("l2t-preview-test.mid");
        let mut args = serde_json::Map::new();
        args.insert("bpm".into(), serde_json::json!(60));
        args.insert("key".into(), serde_json::json!("A minor"));
        args.insert("output_path".into(), serde_json::json!(mid.display().to_string()));
        server
            .call_json("generate_bassline", args, Duration::from_secs(30))
            .await
            .unwrap();
        server.shutdown().await;
        let _ = std::fs::remove_file(mid.with_extension("wav"));
        let wav = render_preview(&mid).await.expect("рендер баса в WAV");
        assert!(wav.is_file());
        assert!(std::fs::metadata(&wav).unwrap().len() > 1000, "WAV не пустой");
        // RIFF-магия
        let mut head = [0u8; 4];
        use std::io::Read;
        std::io::BufReader::new(std::fs::File::open(&wav).unwrap())
            .read_exact(&mut head)
            .unwrap();
        assert_eq!(&head, b"RIFF");
    }

    fn which(bin: &str) -> Option<PathBuf> {
        std::env::var_os("PATH").and_then(|path| {
            std::env::split_paths(&path).map(|dir| dir.join(bin)).find(|p| p.is_file())
        })
    }
}

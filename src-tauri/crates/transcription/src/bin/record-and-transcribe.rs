//! End-to-end spike: spawn the audio-capture sidecar, record for N seconds,
//! then transcribe the captured PCM through WhisperTranscriber.
//!
//! This mirrors the production post-hoc recording flow: the sidecar writes
//! samples to a file while the user records, the duration ends (or Stop is
//! pressed), and the Rust host hands the finalized samples to the
//! transcription layer.
//!
//! For now only --mode mic is supported; system + both come in follow-up work.
//!
//! Usage:
//!   record-and-transcribe <bundle-path> <model-path> <duration-seconds> [language]
//!
//! <bundle-path> points at the signed PanesAudioCapture.app produced by the
//! sidecar's build.sh. The binary inside the bundle is launched via `open`
//! so TCC attributes to the bundle identity (required on macOS 14.2+).

use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

use panes_transcription::{
    Transcriber, TranscriptionOptions, WhisperTranscriber,
};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 4 {
        eprintln!("usage: record-and-transcribe <bundle-path> <model-path> <duration-seconds> [language]");
        eprintln!();
        eprintln!("  bundle-path:  path to PanesAudioCapture.app");
        eprintln!("  model-path:   path to a ggml whisper model file");
        eprintln!("  duration:     recording length in seconds");
        eprintln!("  language:     ISO language code (en, pt, ...). Omit for auto-detect.");
        std::process::exit(2);
    }

    let bundle_path = PathBuf::from(&args[1]);
    let model_path = PathBuf::from(&args[2]);
    let duration_secs: u64 = args[3].parse()?;
    let language = args.get(4).cloned();

    if !bundle_path.exists() {
        anyhow::bail!("bundle not found: {}", bundle_path.display());
    }
    if !model_path.exists() {
        anyhow::bail!("model not found: {}", model_path.display());
    }

    let tmp_pcm = std::env::temp_dir().join(format!(
        "panes-record-{}.f32",
        std::process::id()
    ));
    eprintln!("recording for {}s to {}", duration_secs, tmp_pcm.display());

    let status = Command::new("open")
        .arg(&bundle_path)
        .arg("--args")
        .arg("--mode").arg("mic")
        .arg("--output-file").arg(&tmp_pcm)
        .arg("--duration").arg(duration_secs.to_string())
        .status()?;
    if !status.success() {
        anyhow::bail!("failed to launch sidecar: {status}");
    }

    // `open` returns immediately; the sidecar self-terminates after
    // --duration. Wait a couple of extra seconds for file finalization.
    let wait = Duration::from_secs(duration_secs + 2);
    eprintln!("waiting {:.0}s for sidecar to finish...", wait.as_secs_f64());
    std::thread::sleep(wait);

    let bytes = std::fs::read(&tmp_pcm)?;
    if bytes.len() % 4 != 0 {
        anyhow::bail!(
            "PCM file {} has {} bytes, not a multiple of 4",
            tmp_pcm.display(),
            bytes.len()
        );
    }
    let sample_count = bytes.len() / 4;
    let mut samples = Vec::with_capacity(sample_count);
    for chunk in bytes.chunks_exact(4) {
        samples.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
    }
    // Mic mode: 44.1 kHz mono float32 per the sidecar.
    let source_rate: u32 = 44_100;
    let channels: u8 = 1;
    let recorded_secs = sample_count as f64 / source_rate as f64;
    eprintln!(
        "recorded {} samples ({:.2}s at {} Hz x{} ch)",
        sample_count, recorded_secs, source_rate, channels
    );

    if sample_count == 0 {
        anyhow::bail!("no samples recorded — check mic permission for the bundle");
    }

    eprintln!("transcribing...");
    let transcriber = WhisperTranscriber::new(model_path)?;
    let options = TranscriptionOptions {
        language,
        n_threads: Some(num_threads()),
        translate: false,
    };

    let start = std::time::Instant::now();
    let transcript = transcriber
        .transcribe_pcm_f32(samples, source_rate, channels, options)
        .await?;
    let elapsed = start.elapsed();

    eprintln!();
    eprintln!(
        "=== transcript ({} segments, lang={}) ===",
        transcript.segments.len(),
        transcript.language
    );
    for segment in &transcript.segments {
        println!(
            "[{:>6}ms → {:>6}ms] {}",
            segment.start_ms,
            segment.end_ms,
            segment.text.trim()
        );
    }
    eprintln!();
    eprintln!("=== full text ===");
    println!("{}", transcript.full_text.trim());
    eprintln!();
    eprintln!(
        "transcription wall time: {:.2}s ({:.1}x realtime)",
        elapsed.as_secs_f64(),
        recorded_secs / elapsed.as_secs_f64().max(0.001)
    );

    let _ = std::fs::remove_file(&tmp_pcm);
    Ok(())
}

fn num_threads() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
}

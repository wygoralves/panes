//! Transcribe a raw float32 PCM file produced by the audio-capture sidecar.
//!
//! Usage:
//!   transcribe-pcm <model-path> <pcm-path> <sample-rate> <channels> [language]
//!
//! Example (mic mode output: 44.1 kHz mono):
//!   transcribe-pcm ~/.agent-workspace/models/whisper/ggml-base.bin \
//!                  /tmp/panes-mic-test.pcm 44100 1 en
//!
//! The binary handles downmix to mono and linear resampling to whisper's
//! required 16 kHz internally.

use std::path::PathBuf;

use panes_transcription::{
    Transcriber, TranscriptionOptions, WhisperTranscriber,
};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 5 {
        eprintln!("usage: transcribe-pcm <model-path> <pcm-path> <sample-rate> <channels> [language]");
        eprintln!("  pcm-path: raw little-endian float32 samples (interleaved if stereo)");
        eprintln!("  language: ISO code like 'en' or 'pt'. Omit for auto-detect.");
        std::process::exit(2);
    }

    let model_path = PathBuf::from(&args[1]);
    let pcm_path = PathBuf::from(&args[2]);
    let source_rate: u32 = args[3].parse()?;
    let channels: u8 = args[4].parse()?;
    let language = args.get(5).cloned();

    eprintln!("model:    {}", model_path.display());
    eprintln!("pcm:      {}", pcm_path.display());
    eprintln!("rate:     {} Hz", source_rate);
    eprintln!("channels: {}", channels);
    eprintln!("language: {}", language.as_deref().unwrap_or("(auto)"));

    let bytes = std::fs::read(&pcm_path)?;
    if bytes.len() % 4 != 0 {
        anyhow::bail!("PCM file length {} is not a multiple of 4 (expected float32 samples)", bytes.len());
    }
    let sample_count = bytes.len() / 4;
    let mut samples = Vec::with_capacity(sample_count);
    for chunk in bytes.chunks_exact(4) {
        samples.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
    }
    let duration_secs = sample_count as f64 / (source_rate as f64 * channels as f64);
    eprintln!("loaded {} samples (~{:.2}s of audio)", sample_count, duration_secs);

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
    eprintln!("transcription wall time: {:.2}s", elapsed.as_secs_f64());

    Ok(())
}

fn num_threads() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
}

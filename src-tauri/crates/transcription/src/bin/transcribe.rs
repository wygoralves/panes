//! CLI for exercising the transcription layer end-to-end during M1/M2 spike work.
//!
//! Usage:
//!   transcribe <model-path> <wav-path> [language]
//!
//! Example:
//!   transcribe ~/.agent-workspace/models/whisper/ggml-base.bin samples/jfk.wav en

use std::path::PathBuf;

use panes_transcription::{
    Transcriber, TranscriptionOptions, WhisperTranscriber,
};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        eprintln!("usage: transcribe <model-path> <wav-path> [language]");
        eprintln!("  language: ISO code like 'en' or 'pt'. Omit for auto-detect.");
        std::process::exit(2);
    }

    let model_path = PathBuf::from(&args[1]);
    let wav_path = PathBuf::from(&args[2]);
    let language = args.get(3).cloned();

    eprintln!("model:    {}", model_path.display());
    eprintln!("wav:      {}", wav_path.display());
    eprintln!("language: {}", language.as_deref().unwrap_or("(auto)"));

    let transcriber = WhisperTranscriber::new(model_path)?;

    let options = TranscriptionOptions {
        language,
        n_threads: Some(num_threads()),
        translate: false,
    };

    let start = std::time::Instant::now();
    let transcript = transcriber.transcribe_wav(wav_path, options).await?;
    let elapsed = start.elapsed();

    eprintln!();
    eprintln!("=== transcript ({} segments, lang={}) ===", transcript.segments.len(), transcript.language);
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

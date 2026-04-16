//! Transcription layer for Panes meetings.
//!
//! Exposes a `Transcriber` trait and a `WhisperTranscriber` implementation
//! backed by `whisper.cpp` (via the `whisper-rs` crate) with Metal
//! acceleration on Apple Silicon. Consumers pass a path to a 16 kHz mono
//! 16-bit WAV file and receive a `Transcript` with per-segment timestamps
//! and a concatenated full-text string.
//!
//! Non-16 kHz / non-mono inputs are rejected today. Resampling and channel
//! conversion belong in the caller (or a later milestone that takes the
//! meeting sidecar's native-rate PCM directly).

use std::path::{Path, PathBuf};

use async_trait::async_trait;
use thiserror::Error;
use whisper_rs::{
    FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters,
};

#[derive(Debug, Clone, Default)]
pub struct TranscriptionOptions {
    /// ISO language code (e.g. `"en"`, `"pt"`). `None` lets Whisper auto-detect.
    pub language: Option<String>,
    /// Thread count for whisper.cpp. `None` delegates to a sensible default.
    pub n_threads: Option<usize>,
    /// Translate to English when `true` (Whisper's translate mode).
    pub translate: bool,
}

#[derive(Debug, Clone)]
pub struct TranscriptSegment {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}

#[derive(Debug, Clone)]
pub struct Transcript {
    /// Requested language, or `"auto"` when auto-detection was used.
    pub language: String,
    pub segments: Vec<TranscriptSegment>,
    /// Concatenation of every segment's text. Spaces/newlines are preserved
    /// as produced by whisper.cpp.
    pub full_text: String,
}

#[derive(Debug, Error)]
pub enum TranscriptionError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("wav decode error: {0}")]
    WavDecode(#[from] hound::Error),
    #[error("model load failed: {0}")]
    ModelLoad(String),
    #[error("transcription failed: {0}")]
    Transcription(String),
    #[error("unsupported audio format: {0}")]
    UnsupportedFormat(String),
    #[error("background task failed: {0}")]
    Join(String),
}

#[async_trait]
pub trait Transcriber: Send + Sync {
    async fn transcribe_wav(
        &self,
        wav_path: PathBuf,
        options: TranscriptionOptions,
    ) -> Result<Transcript, TranscriptionError>;
}

pub struct WhisperTranscriber {
    model_path: PathBuf,
}

impl WhisperTranscriber {
    pub fn new(model_path: PathBuf) -> Result<Self, TranscriptionError> {
        if !model_path.exists() {
            return Err(TranscriptionError::ModelLoad(format!(
                "model file not found: {}",
                model_path.display()
            )));
        }
        Ok(Self { model_path })
    }
}

#[async_trait]
impl Transcriber for WhisperTranscriber {
    async fn transcribe_wav(
        &self,
        wav_path: PathBuf,
        options: TranscriptionOptions,
    ) -> Result<Transcript, TranscriptionError> {
        let model_path = self.model_path.clone();
        tokio::task::spawn_blocking(move || {
            transcribe_blocking(&model_path, &wav_path, options)
        })
        .await
        .map_err(|e| TranscriptionError::Join(e.to_string()))?
    }
}

fn transcribe_blocking(
    model_path: &Path,
    wav_path: &Path,
    options: TranscriptionOptions,
) -> Result<Transcript, TranscriptionError> {
    let ctx = WhisperContext::new_with_params(
        model_path,
        WhisperContextParameters::default(),
    )
    .map_err(|e| TranscriptionError::ModelLoad(format!("{e:?}")))?;

    let samples = read_wav_as_f32_mono_16k(wav_path)?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    if let Some(lang) = options.language.as_deref() {
        params.set_language(Some(lang));
    }
    let threads = options.n_threads.unwrap_or(4).max(1);
    params.set_n_threads(threads as i32);
    params.set_translate(options.translate);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_special(false);
    params.set_print_timestamps(false);

    let mut state = ctx
        .create_state()
        .map_err(|e| TranscriptionError::Transcription(format!("create_state: {e:?}")))?;
    state
        .full(params, &samples)
        .map_err(|e| TranscriptionError::Transcription(format!("full: {e:?}")))?;

    let num_segments = state.full_n_segments();
    let mut segments = Vec::with_capacity(num_segments.max(0) as usize);
    let mut full_text = String::new();
    for i in 0..num_segments {
        let segment = state.get_segment(i).ok_or_else(|| {
            TranscriptionError::Transcription(format!("segment {i} not available"))
        })?;
        let text = segment
            .to_str()
            .map_err(|e| TranscriptionError::Transcription(format!("segment text: {e:?}")))?
            .to_string();
        // whisper.cpp timestamps are in 10ms (centisecond) units.
        let start_ms = segment.start_timestamp().max(0) as u64 * 10;
        let end_ms = segment.end_timestamp().max(0) as u64 * 10;

        segments.push(TranscriptSegment {
            start_ms,
            end_ms,
            text: text.clone(),
        });
        full_text.push_str(&text);
    }

    Ok(Transcript {
        language: options.language.unwrap_or_else(|| "auto".to_string()),
        segments,
        full_text,
    })
}

fn read_wav_as_f32_mono_16k(path: &Path) -> Result<Vec<f32>, TranscriptionError> {
    let mut reader = hound::WavReader::open(path)?;
    let spec = reader.spec();

    if spec.sample_rate != 16_000 {
        return Err(TranscriptionError::UnsupportedFormat(format!(
            "expected 16000 Hz, got {} Hz (caller must resample)",
            spec.sample_rate
        )));
    }
    if spec.channels != 1 {
        return Err(TranscriptionError::UnsupportedFormat(format!(
            "expected mono, got {} channels (caller must downmix)",
            spec.channels
        )));
    }

    let samples: Vec<f32> = match (spec.sample_format, spec.bits_per_sample) {
        (hound::SampleFormat::Int, 16) => reader
            .samples::<i16>()
            .map(|s| s.map(|v| v as f32 / 32_768.0))
            .collect::<Result<Vec<_>, _>>()?,
        (hound::SampleFormat::Float, 32) => reader
            .samples::<f32>()
            .collect::<Result<Vec<_>, _>>()?,
        (fmt, bits) => {
            return Err(TranscriptionError::UnsupportedFormat(format!(
                "unsupported WAV sample format: {:?} / {} bits",
                fmt, bits
            )));
        }
    };

    Ok(samples)
}

//! Transcription layer for Panes meetings.
//!
//! Exposes a `Transcriber` trait and a `WhisperTranscriber` implementation
//! backed by `whisper.cpp` (via the `whisper-rs` crate) with Metal
//! acceleration on Apple Silicon. Two entry points:
//!
//! - `transcribe_wav(path, options)` — accepts any WAV the bundled reader
//!   understands (16 kHz mono, currently).
//! - `transcribe_pcm_f32(samples, source_rate, channels, options)` — takes
//!   raw float32 samples at arbitrary rate/channel count, downmixes to mono
//!   and linear-resamples to 16 kHz internally. This is the path the
//!   audio-capture sidecar feeds into.

use std::path::{Path, PathBuf};

use async_trait::async_trait;
use thiserror::Error;
use whisper_rs::{
    FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters,
};

#[derive(Debug, Clone, Default)]
pub struct TranscriptionOptions {
    pub language: Option<String>,
    pub n_threads: Option<usize>,
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
    pub language: String,
    pub segments: Vec<TranscriptSegment>,
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

    async fn transcribe_pcm_f32(
        &self,
        samples: Vec<f32>,
        source_rate: u32,
        channels: u8,
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
            let samples = read_wav_as_f32_mono_16k(&wav_path)?;
            run_whisper(&model_path, &samples, options)
        })
        .await
        .map_err(|e| TranscriptionError::Join(e.to_string()))?
    }

    async fn transcribe_pcm_f32(
        &self,
        samples: Vec<f32>,
        source_rate: u32,
        channels: u8,
        options: TranscriptionOptions,
    ) -> Result<Transcript, TranscriptionError> {
        let model_path = self.model_path.clone();
        tokio::task::spawn_blocking(move || {
            let mono = downmix_to_mono(&samples, channels)?;
            let resampled = resample_linear(&mono, source_rate, 16_000);
            run_whisper(&model_path, &resampled, options)
        })
        .await
        .map_err(|e| TranscriptionError::Join(e.to_string()))?
    }
}

fn run_whisper(
    model_path: &Path,
    samples: &[f32],
    options: TranscriptionOptions,
) -> Result<Transcript, TranscriptionError> {
    let ctx = WhisperContext::new_with_params(
        model_path,
        WhisperContextParameters::default(),
    )
    .map_err(|e| TranscriptionError::ModelLoad(format!("{e:?}")))?;

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
        .full(params, samples)
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
            "expected 16000 Hz, got {} Hz",
            spec.sample_rate
        )));
    }
    if spec.channels != 1 {
        return Err(TranscriptionError::UnsupportedFormat(format!(
            "expected mono, got {} channels",
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

fn downmix_to_mono(samples: &[f32], channels: u8) -> Result<Vec<f32>, TranscriptionError> {
    match channels {
        1 => Ok(samples.to_vec()),
        n if n >= 2 => {
            let n = n as usize;
            let out_len = samples.len() / n;
            let mut out = Vec::with_capacity(out_len);
            let scale = 1.0 / n as f32;
            for frame in samples.chunks_exact(n) {
                let sum: f32 = frame.iter().sum();
                out.push(sum * scale);
            }
            Ok(out)
        }
        _ => Err(TranscriptionError::UnsupportedFormat(format!(
            "expected channels >= 1, got {}",
            channels
        ))),
    }
}

/// Linear interpolation resampler. Fast and dependency-free. Adequate for
/// speech recognition with whisper, which does significant frontend processing
/// (mel spectrogram) that smooths over minor aliasing. For music or
/// archival-quality audio this would be replaced with a proper polyphase
/// resampler like `rubato`.
fn resample_linear(input: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate || input.is_empty() {
        return input.to_vec();
    }
    let ratio = from_rate as f64 / to_rate as f64;
    let out_len = ((input.len() as f64) / ratio).floor() as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src_f = i as f64 * ratio;
        let src_i = src_f.floor() as usize;
        if src_i >= input.len() {
            break;
        }
        let frac = (src_f - src_f.floor()) as f32;
        let s0 = input[src_i];
        let s1 = if src_i + 1 < input.len() {
            input[src_i + 1]
        } else {
            s0
        };
        out.push(s0 * (1.0 - frac) + s1 * frac);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resample_identity_when_rates_match() {
        let input = vec![0.1, 0.2, 0.3, 0.4];
        assert_eq!(resample_linear(&input, 16_000, 16_000), input);
    }

    #[test]
    fn resample_downsample_length() {
        let input: Vec<f32> = (0..44_100).map(|i| (i as f32) / 44_100.0).collect();
        let out = resample_linear(&input, 44_100, 16_000);
        // ~16k samples ± 1 from floor()
        assert!((out.len() as i64 - 16_000).abs() <= 2, "got {}", out.len());
    }

    #[test]
    fn downmix_stereo_to_mono_averages_channels() {
        let stereo = vec![1.0, -1.0, 0.5, -0.5];
        let mono = downmix_to_mono(&stereo, 2).unwrap();
        assert_eq!(mono, vec![0.0, 0.0]);
    }

    #[test]
    fn downmix_mono_pass_through() {
        let mono = vec![0.1, 0.2, 0.3];
        assert_eq!(downmix_to_mono(&mono, 1).unwrap(), mono);
    }
}

//! Tauri commands exposing the transcription layer to the frontend.
//!
//! For v1 of the meetings feature we expose a single WAV-in, transcript-out
//! command. The actual meeting recording flow (sidecar spawn, live audio,
//! crash-recovery) lands in a later milestone; this command is enough for
//! the frontend to exercise the transcription layer during M2 integration
//! and for early debug UIs.
//!
//! All heavy lifting — model loading, whisper.cpp invocation, Metal
//! acceleration — is delegated to the `panes-transcription` crate.

use std::path::PathBuf;

use panes_transcription::{
    Transcriber, TranscriptionOptions, WhisperTranscriber,
};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSegmentDto {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptDto {
    pub language: String,
    pub full_text: String,
    pub segments: Vec<TranscriptSegmentDto>,
    pub duration_ms: u64,
}

/// Transcribe a 16 kHz mono WAV file using a local ggml whisper model.
///
/// `model_path` must point at a ggml-format Whisper weight file the caller
/// has already downloaded (e.g. `~/.agent-workspace/models/whisper/ggml-base.bin`).
/// `language` is an ISO code like `"en"` or `"pt"`; pass `None` to let
/// whisper auto-detect.
#[tauri::command]
pub async fn transcribe_wav_file(
    wav_path: String,
    model_path: String,
    language: Option<String>,
) -> Result<TranscriptDto, String> {
    let transcriber = WhisperTranscriber::new(PathBuf::from(&model_path))
        .map_err(|e| e.to_string())?;

    let options = TranscriptionOptions {
        language,
        n_threads: None,
        translate: false,
    };

    let transcript = transcriber
        .transcribe_wav(PathBuf::from(&wav_path), options)
        .await
        .map_err(|e| e.to_string())?;

    let duration_ms = transcript
        .segments
        .last()
        .map(|s| s.end_ms)
        .unwrap_or_default();

    Ok(TranscriptDto {
        language: transcript.language,
        full_text: transcript.full_text,
        segments: transcript
            .segments
            .into_iter()
            .map(|s| TranscriptSegmentDto {
                start_ms: s.start_ms,
                end_ms: s.end_ms,
                text: s.text,
            })
            .collect(),
        duration_ms,
    })
}

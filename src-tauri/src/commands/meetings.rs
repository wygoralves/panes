//! Tauri commands for the meetings feature.
//!
//! Two groups right now:
//!   1. Transcription: a thin wrapper over `panes-transcription` so the
//!      frontend can turn a WAV into a transcript.
//!   2. Storage: listing and creating meeting markdown documents under
//!      the user-level meetings directory. Opening / editing the files
//!      themselves reuses the existing file editor, so there is nothing
//!      meeting-specific about reads; this module only owns the
//!      write-side and the list view.
//!
//! The meetings directory is currently `~/Documents/Panes Meetings/` on
//! macOS / Linux, auto-created on demand. A user-configurable override
//! ships with the settings UX in a later milestone.

use std::path::PathBuf;

use chrono::{DateTime, Utc};
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingDto {
    pub path: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub size_bytes: u64,
}

/// List meeting documents in the user's meetings directory, newest first.
/// Creates the directory if it does not yet exist.
#[tauri::command]
pub async fn list_meetings() -> Result<Vec<MeetingDto>, String> {
    let dir = meetings_dir().map_err(|e| e.to_string())?;
    tokio::task::spawn_blocking(move || -> Result<Vec<MeetingDto>, String> {
        let mut out = Vec::new();
        for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("md") {
                continue;
            }
            let metadata = entry.metadata().map_err(|e| e.to_string())?;
            let title = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("untitled")
                .to_string();
            out.push(MeetingDto {
                path: path.to_string_lossy().to_string(),
                title,
                created_at: systime_to_iso(metadata.created().ok()),
                updated_at: systime_to_iso(metadata.modified().ok()),
                size_bytes: metadata.len(),
            });
        }
        out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Create a new meeting document seeded with standard frontmatter and the
/// empty `## Notes` / `## Transcript` sections. Returns the new meeting's
/// DTO so the frontend can open it in the editor.
#[tauri::command]
pub async fn create_meeting(title: Option<String>) -> Result<MeetingDto, String> {
    let dir = meetings_dir().map_err(|e| e.to_string())?;
    let now = Utc::now();
    let timestamp = now.format("%Y-%m-%d-%H%M%S").to_string();
    let display_title = title
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| format!("Meeting {}", now.format("%Y-%m-%d %H:%M")));
    let slug = slugify(&display_title);
    let filename = if slug.is_empty() {
        format!("{}.md", timestamp)
    } else {
        format!("{}-{}.md", timestamp, slug)
    };
    let path = dir.join(filename);

    let body = format!(
        "---\ntitle: {title}\ndate: {date}\nduration: 0\nlanguage: en\nrecording: false\n---\n\n# {title}\n\n## Notes\n\n## Transcript\n",
        title = display_title,
        date = now.to_rfc3339(),
    );

    {
        let path = path.clone();
        tokio::task::spawn_blocking(move || std::fs::write(&path, body))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
    }

    let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    Ok(MeetingDto {
        path: path.to_string_lossy().to_string(),
        title: display_title,
        created_at: systime_to_iso(metadata.created().ok()),
        updated_at: systime_to_iso(metadata.modified().ok()),
        size_bytes: metadata.len(),
    })
}

fn meetings_dir() -> Result<PathBuf, std::io::Error> {
    let home = std::env::var_os("HOME").ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::NotFound, "HOME environment variable not set")
    })?;
    let dir = PathBuf::from(home).join("Documents").join("Panes Meetings");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn systime_to_iso(time: Option<std::time::SystemTime>) -> String {
    time.and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| {
            let dt: DateTime<Utc> =
                DateTime::<Utc>::from(std::time::UNIX_EPOCH + d);
            dt.to_rfc3339()
        })
        .unwrap_or_default()
}

fn slugify(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut last_was_dash = true;
    for c in s.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            last_was_dash = false;
        } else if !last_was_dash {
            out.push('-');
            last_was_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

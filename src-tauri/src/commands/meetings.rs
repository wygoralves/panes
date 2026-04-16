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

/// Record a short mic capture through the audio-capture sidecar, transcribe
/// the result with the bundled whisper.cpp, and append the transcript to the
/// meeting document.
///
/// For v1 this is a single blocking flow: start sidecar → wait `duration_seconds`
/// → read audio → transcribe → rewrite .md. The UI awaits the whole thing.
/// Proper Stop button + streaming progress arrive in a later milestone.
#[tauri::command]
pub async fn record_meeting(
    meeting_path: String,
    duration_seconds: u64,
    language: Option<String>,
    model_filename: String,
) -> Result<TranscriptDto, String> {
    if duration_seconds == 0 || duration_seconds > 600 {
        return Err("duration must be between 1 and 600 seconds".to_string());
    }

    let meeting_path = PathBuf::from(&meeting_path);
    if !meeting_path.exists() {
        return Err(format!("meeting file not found: {}", meeting_path.display()));
    }

    let model_path = model_dir()
        .map_err(|e| e.to_string())?
        .join(&model_filename);
    if !model_path.exists() {
        return Err(format!(
            "whisper model not found: {}",
            model_path.display()
        ));
    }

    let bundle_path = audio_capture_bundle_path();
    if !bundle_path.exists() {
        return Err(format!(
            "audio capture bundle not found at {}. Build it with src/sidecars/audio_capture/build.sh",
            bundle_path.display()
        ));
    }

    // Audio lives in a sibling audio/ directory next to the meeting markdown.
    let audio_dir = meeting_path
        .parent()
        .ok_or_else(|| "meeting has no parent directory".to_string())?
        .join("audio");
    std::fs::create_dir_all(&audio_dir).map_err(|e| e.to_string())?;
    let audio_stem = meeting_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("recording");
    let audio_path = audio_dir.join(format!("{}.f32", audio_stem));
    let _ = std::fs::remove_file(&audio_path); // ignore if missing

    let status = std::process::Command::new("open")
        .arg(&bundle_path)
        .arg("--args")
        .arg("--mode")
        .arg("mic")
        .arg("--output-file")
        .arg(&audio_path)
        .arg("--duration")
        .arg(duration_seconds.to_string())
        .status()
        .map_err(|e| format!("failed to spawn audio sidecar: {e}"))?;
    if !status.success() {
        return Err(format!("audio sidecar launch exited with {status}"));
    }

    // `open` returns immediately; wait for the sidecar's self-timed --duration,
    // plus a small grace window for file-system flush before we read the PCM.
    tokio::time::sleep(std::time::Duration::from_secs(duration_seconds + 2)).await;

    let audio_bytes = tokio::task::spawn_blocking({
        let audio_path = audio_path.clone();
        move || std::fs::read(&audio_path)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("failed to read captured audio at {}: {e}", audio_path.display()))?;

    if audio_bytes.is_empty() {
        return Err("audio sidecar produced no samples — check mic permission".to_string());
    }
    if audio_bytes.len() % 4 != 0 {
        return Err(format!(
            "captured audio length {} is not a multiple of 4",
            audio_bytes.len()
        ));
    }
    let mut samples = Vec::with_capacity(audio_bytes.len() / 4);
    for chunk in audio_bytes.chunks_exact(4) {
        samples.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
    }

    let transcriber = WhisperTranscriber::new(model_path).map_err(|e| e.to_string())?;
    let options = TranscriptionOptions {
        language: language.clone(),
        n_threads: None,
        translate: false,
    };
    // Mic mode output: 44.1 kHz, 1 channel.
    let transcript = transcriber
        .transcribe_pcm_f32(samples, 44_100, 1, options)
        .await
        .map_err(|e| e.to_string())?;

    update_meeting_transcript_section(&meeting_path, &transcript.full_text, &audio_path, &language)
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

fn model_dir() -> Result<PathBuf, std::io::Error> {
    let home = std::env::var_os("HOME").ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::NotFound, "HOME environment variable not set")
    })?;
    Ok(PathBuf::from(home)
        .join(".agent-workspace")
        .join("models")
        .join("whisper"))
}

fn audio_capture_bundle_path() -> PathBuf {
    // During development the sidecar's .app bundle lives inside the Panes
    // source tree. A future packaged release will bundle this alongside
    // Panes.app's Resources; resolving at runtime via Tauri's resource API
    // is the follow-up.
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("src/sidecars/audio_capture/.build/PanesAudioCapture.app")
}

/// Rewrite the meeting markdown: update `recording: false`, stamp the audio
/// path, and replace the `## Transcript` section body with the new text.
fn update_meeting_transcript_section(
    meeting_path: &std::path::Path,
    transcript: &str,
    audio_path: &std::path::Path,
    language: &Option<String>,
) -> anyhow::Result<()> {
    let existing = std::fs::read_to_string(meeting_path)?;
    let (frontmatter, body) = split_frontmatter(&existing);
    let frontmatter = update_frontmatter(
        frontmatter,
        [
            ("recording", "false".to_string()),
            ("audio", audio_path.to_string_lossy().to_string()),
            (
                "language",
                language.clone().unwrap_or_else(|| "en".to_string()),
            ),
        ],
    );
    let body = replace_section(body, "Transcript", transcript);
    let new_contents = format!("---\n{}---\n{}", frontmatter, body);
    std::fs::write(meeting_path, new_contents)?;
    Ok(())
}

fn split_frontmatter(input: &str) -> (String, &str) {
    if let Some(rest) = input.strip_prefix("---\n") {
        if let Some(end) = rest.find("\n---\n") {
            let fm = &rest[..end + 1];
            let body = &rest[end + 5..];
            return (fm.to_string(), body);
        }
    }
    (String::new(), input)
}

fn update_frontmatter<I>(existing: String, updates: I) -> String
where
    I: IntoIterator<Item = (&'static str, String)>,
{
    let mut lines: Vec<String> = existing.lines().map(|l| l.to_string()).collect();
    for (key, value) in updates {
        let prefix = format!("{key}:");
        let new_line = format!("{key}: {value}");
        let mut replaced = false;
        for line in lines.iter_mut() {
            if line.trim_start().starts_with(&prefix) {
                *line = new_line.clone();
                replaced = true;
                break;
            }
        }
        if !replaced {
            lines.push(new_line);
        }
    }
    let mut result = lines.join("\n");
    if !result.ends_with('\n') {
        result.push('\n');
    }
    result
}

/// Replace the body of a `## <name>` section with `new_body`, preserving
/// surrounding sections. If the section is missing it's appended.
fn replace_section(body: &str, name: &str, new_body: &str) -> String {
    let header = format!("## {name}");
    let mut out = String::new();
    let mut lines = body.lines().peekable();
    let mut replaced = false;
    while let Some(line) = lines.next() {
        if line.trim() == header && !replaced {
            out.push_str(line);
            out.push('\n');
            out.push('\n');
            out.push_str(new_body.trim_end());
            out.push('\n');
            replaced = true;
            // skip existing section body until next heading or EOF
            while let Some(peek) = lines.peek() {
                if peek.starts_with("## ") || peek.starts_with("# ") {
                    break;
                }
                lines.next();
            }
            continue;
        }
        out.push_str(line);
        out.push('\n');
    }
    if !replaced {
        if !out.ends_with("\n\n") {
            out.push('\n');
        }
        out.push_str(&header);
        out.push_str("\n\n");
        out.push_str(new_body.trim_end());
        out.push('\n');
    }
    out
}

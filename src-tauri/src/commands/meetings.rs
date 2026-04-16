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

use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use panes_transcription::{
    Transcriber, TranscriptionOptions, WhisperTranscriber,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

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
    /// Non-fatal issues detected during capture — e.g. system-audio permission
    /// was silently denied, producing a mic-only recording. Frontend surfaces
    /// these as toasts without blocking the flow.
    pub warnings: Vec<String>,
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
        warnings: Vec::new(),
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
/// Creates the directory if it does not yet exist, and sweeps `audio/*.pid`
/// files that belong to sidecar processes no longer running (or running but
/// orphaned from a previous Panes session). Orphaned processes are SIGTERM'd.
#[tauri::command]
pub async fn list_meetings() -> Result<Vec<MeetingDto>, String> {
    let dir = meetings_dir().map_err(|e| e.to_string())?;
    tokio::task::spawn_blocking(move || -> Result<Vec<MeetingDto>, String> {
        cleanup_orphaned_recordings(&dir);
        let mut out = Vec::new();
        for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("md") {
                continue;
            }
            let metadata = entry.metadata().map_err(|e| e.to_string())?;
            let title = read_frontmatter_title(&path).unwrap_or_else(|| {
                path.file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("untitled")
                    .to_string()
            });
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

    // The header shows the title from frontmatter, so we don't seed a `#`
    // heading in the body. Users who want an in-body heading can add one.
    let body = format!(
        "---\ntitle: {title}\ndate: {date}\nduration: 0\nlanguage: en\nrecording: false\n---\n\n## Notes\n\n## Transcript\n",
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

/// Update a subset of frontmatter fields on a meeting document and return
/// the refreshed DTO so callers can re-render list rows. Unknown keys are
/// written through; empty string values remove a field.
#[tauri::command]
pub async fn set_meeting_frontmatter(
    meeting_path: String,
    updates: std::collections::HashMap<String, String>,
) -> Result<MeetingDto, String> {
    let meeting_path = PathBuf::from(&meeting_path);
    if !meeting_path.exists() {
        return Err(format!("meeting file not found: {}", meeting_path.display()));
    }
    let updates_clone = updates.clone();
    let path_clone = meeting_path.clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let existing = std::fs::read_to_string(&path_clone).map_err(|e| e.to_string())?;
        let (frontmatter, body) = split_frontmatter(&existing);
        let mut lines: Vec<String> = frontmatter.lines().map(|l| l.to_string()).collect();
        for (key, value) in updates_clone.iter() {
            let prefix = format!("{key}:");
            let new_line = if value.is_empty() {
                None
            } else {
                Some(format!("{key}: {value}"))
            };
            let position = lines.iter().position(|l| l.trim_start().starts_with(&prefix));
            match (position, new_line) {
                (Some(idx), Some(line)) => lines[idx] = line,
                (Some(idx), None) => {
                    lines.remove(idx);
                }
                (None, Some(line)) => lines.push(line),
                (None, None) => {}
            }
        }
        let mut rebuilt = lines.join("\n");
        if !rebuilt.ends_with('\n') {
            rebuilt.push('\n');
        }
        let new_contents = format!("---\n{rebuilt}---\n{body}");
        std::fs::write(&path_clone, new_contents).map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())??;

    let metadata = std::fs::metadata(&meeting_path).map_err(|e| e.to_string())?;
    let title = updates
        .get("title")
        .filter(|t| !t.is_empty())
        .cloned()
        .unwrap_or_else(|| {
            meeting_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Untitled")
                .to_string()
        });
    Ok(MeetingDto {
        path: meeting_path.to_string_lossy().to_string(),
        title,
        created_at: systime_to_iso(metadata.created().ok()),
        updated_at: systime_to_iso(metadata.modified().ok()),
        size_bytes: metadata.len(),
    })
}

/// Read just the first few KB of a meeting markdown file and return the
/// `title:` frontmatter value if present. Falls back to `None` for files
/// without frontmatter or with a non-standard layout.
fn read_frontmatter_title(path: &Path) -> Option<String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path).ok()?;
    let mut buf = [0u8; 4096];
    let n = file.read(&mut buf).ok()?;
    let text = std::str::from_utf8(&buf[..n]).ok()?;
    let rest = text.strip_prefix("---\n")?;
    let end = rest.find("\n---")?;
    let fm = &rest[..end];
    for line in fm.lines() {
        if let Some(value) = line.strip_prefix("title:") {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
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

/// Start an unbounded mic + system audio recording for the given meeting.
/// The audio-capture sidecar is spawned via `open` (so TCC attributes to the
/// signed bundle) and runs until `stop_meeting_recording` sends it SIGTERM.
/// The sidecar's PID is saved in a sibling `.pid` file so a later Stop call
/// knows which process to signal — this survives a Panes relaunch, which
/// keeps the interrupted-recording crash-recovery story open for later.
#[tauri::command]
pub async fn start_meeting_recording(meeting_path: String) -> Result<(), String> {
    let meeting_path = PathBuf::from(&meeting_path);
    if !meeting_path.exists() {
        return Err(format!("meeting file not found: {}", meeting_path.display()));
    }

    let bundle_path = audio_capture_bundle_path();
    if !bundle_path.exists() {
        return Err(format!(
            "audio capture bundle not found at {}. Build it with src/sidecars/audio_capture/build.sh",
            bundle_path.display()
        ));
    }

    let audio_path = meeting_audio_path(&meeting_path)?;
    let pid_path = recording_pid_path(&meeting_path)?;
    let _ = std::fs::remove_file(&audio_path);
    let _ = std::fs::remove_file(&pid_path);

    // Launch via LaunchServices so the bundle's Info.plist keys (mic + system
    // audio usage descriptions) drive the TCC prompt on first run.
    let status = std::process::Command::new("open")
        .arg(&bundle_path)
        .arg("--args")
        .arg("--mode")
        .arg("both")
        .arg("--output-file")
        .arg(&audio_path)
        .status()
        .map_err(|e| format!("failed to spawn audio sidecar: {e}"))?;
    if !status.success() {
        return Err(format!("audio sidecar launch exited with {status}"));
    }

    // `open` returns before the spawned process is necessarily runnable via
    // pgrep; give the OS a beat, then find the newest PanesAudioCapture PID.
    let pid = find_sidecar_pid().await.map_err(|e| e.to_string())?;
    std::fs::write(&pid_path, pid.to_string())
        .map_err(|e| format!("failed to write pid file: {e}"))?;

    Ok(())
}

/// Pause the sidecar by sending SIGSTOP so the kernel suspends it.
/// AVAudioEngine + Core Audio tap threads stop receiving time; no samples
/// are written while paused, so the on-disk audio has no gap after resume.
#[tauri::command]
pub async fn pause_meeting_recording(meeting_path: String) -> Result<(), String> {
    let pid = read_recording_pid(&meeting_path)?;
    std::process::Command::new("kill")
        .arg("-STOP")
        .arg(pid.to_string())
        .status()
        .map_err(|e| format!("SIGSTOP failed: {e}"))?;
    Ok(())
}

/// Resume a paused recording via SIGCONT.
#[tauri::command]
pub async fn resume_meeting_recording(meeting_path: String) -> Result<(), String> {
    let pid = read_recording_pid(&meeting_path)?;
    std::process::Command::new("kill")
        .arg("-CONT")
        .arg(pid.to_string())
        .status()
        .map_err(|e| format!("SIGCONT failed: {e}"))?;
    Ok(())
}

/// Terminate the recording started by `start_meeting_recording`, wait briefly
/// for the sidecar to flush, and update the meeting's frontmatter to reflect
/// the captured audio. Does NOT transcribe — call `transcribe_meeting`
/// separately when the user is ready.
#[tauri::command]
pub async fn stop_meeting_recording(meeting_path: String) -> Result<(), String> {
    let meeting_path = PathBuf::from(&meeting_path);
    if !meeting_path.exists() {
        return Err(format!("meeting file not found: {}", meeting_path.display()));
    }

    let pid_path = recording_pid_path(&meeting_path)?;
    let pid_contents = std::fs::read_to_string(&pid_path).map_err(|e| {
        format!("no active recording for this meeting (missing pid file: {e})")
    })?;
    let pid: u32 = pid_contents
        .trim()
        .parse()
        .map_err(|e| format!("invalid pid in {}: {e}", pid_path.display()))?;

    // Make sure a paused sidecar is running again before SIGTERM so its
    // signal handler actually runs and flushes. (SIGTERM to a SIGSTOP'd
    // process queues the signal; it won't run until SIGCONT.)
    let _ = std::process::Command::new("kill")
        .arg("-CONT")
        .arg(pid.to_string())
        .status();
    let _ = std::process::Command::new("kill")
        .arg("-TERM")
        .arg(pid.to_string())
        .status();

    tokio::time::sleep(std::time::Duration::from_millis(800)).await;
    let _ = std::fs::remove_file(&pid_path);

    let audio_path = meeting_audio_path(&meeting_path)?;
    update_meeting_audio_metadata(&meeting_path, &audio_path)
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Transcribe an already-captured recording. The meeting must have been
/// stopped first (the audio .bin file exists) — this command does not touch
/// the sidecar, it just reads the file, mixes mic + system, runs whisper,
/// and writes the transcript into the meeting's `## Transcript` section.
#[tauri::command]
pub async fn transcribe_meeting(
    meeting_path: String,
    language: Option<String>,
    model_filename: String,
) -> Result<TranscriptDto, String> {
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

    let audio_path = meeting_audio_path(&meeting_path)?;
    if !audio_path.exists() {
        return Err(format!(
            "no recorded audio for this meeting at {}",
            audio_path.display()
        ));
    }
    let audio_bytes = tokio::task::spawn_blocking({
        let audio_path = audio_path.clone();
        move || std::fs::read(&audio_path)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("failed to read captured audio at {}: {e}", audio_path.display()))?;

    if audio_bytes.is_empty() {
        return Err("captured audio file is empty".to_string());
    }

    let (mic, system) = parse_framed_pcm(&audio_bytes).map_err(|e| e.to_string())?;
    let mixed_samples = mix_sources(&mic, &system);
    let common_rate = mic.rate.max(system.rate.max(1));
    if mixed_samples.is_empty() {
        return Err("no audio samples decoded from captured stream".to_string());
    }

    let transcriber = WhisperTranscriber::new(model_path).map_err(|e| e.to_string())?;
    let options = TranscriptionOptions {
        language: language.clone(),
        n_threads: None,
        translate: false,
    };
    let mut warnings = Vec::new();
    if let Some(warning) = detect_silent_tap(&mic, &system) {
        warnings.push(warning);
    }
    let transcript = transcriber
        .transcribe_pcm_f32(mixed_samples, common_rate, 1, options)
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
        warnings,
    })
}

fn read_recording_pid(meeting_path: &str) -> Result<u32, String> {
    let path = recording_pid_path(&PathBuf::from(meeting_path))?;
    let contents = std::fs::read_to_string(&path)
        .map_err(|e| format!("no active recording: {e}"))?;
    contents
        .trim()
        .parse::<u32>()
        .map_err(|e| format!("invalid pid in {}: {e}", path.display()))
}

fn update_meeting_audio_metadata(meeting_path: &Path, audio_path: &Path) -> anyhow::Result<()> {
    let existing = std::fs::read_to_string(meeting_path)?;
    let (frontmatter, body) = split_frontmatter(&existing);
    let frontmatter = update_frontmatter(
        frontmatter,
        [
            ("recording", "false".to_string()),
            ("audio", audio_path.to_string_lossy().to_string()),
        ],
    );
    let new_contents = format!("---\n{}---\n{}", frontmatter, body);
    std::fs::write(meeting_path, new_contents)?;
    Ok(())
}

/// Heuristic for the "silent system tap" failure mode called out in the spec.
/// macOS provides no API to query whether a Core Audio tap's permission was
/// denied — the tap just produces zero-amplitude samples. We check the first
/// ~3 seconds of captured audio: if the mic channel has real signal but the
/// system channel is essentially silent, something is wrong. In practice
/// that almost always means the user declined the System Audio Recording
/// TCC prompt. Thresholds are intentionally conservative so a meeting with
/// zero remote audio in its first seconds (everyone muted) doesn't trigger
/// a false positive.
fn detect_silent_tap(mic: &SourceAudio, system: &SourceAudio) -> Option<String> {
    if mic.samples.is_empty() || system.samples.is_empty() {
        return None;
    }
    let mic_channels = mic.channels.max(1) as usize;
    let system_channels = system.channels.max(1) as usize;
    if mic.rate == 0 || system.rate == 0 {
        return None;
    }
    let mic_window = (mic.rate as usize * 3 * mic_channels).min(mic.samples.len());
    let system_window = (system.rate as usize * 3 * system_channels).min(system.samples.len());
    if mic_window == 0 || system_window == 0 {
        return None;
    }
    let mic_mean = mic.samples[..mic_window]
        .iter()
        .map(|x| x.abs())
        .sum::<f32>()
        / mic_window as f32;
    let system_mean = system.samples[..system_window]
        .iter()
        .map(|x| x.abs())
        .sum::<f32>()
        / system_window as f32;

    if mic_mean > 0.001 && system_mean < 0.00005 {
        Some(
            "System audio appears blocked — only your microphone was captured. \
             Open System Settings → Privacy & Security → System Audio Recording and make sure PanesAudioCapture is allowed."
                .to_string(),
        )
    } else {
        None
    }
}

fn meeting_audio_path(meeting_path: &Path) -> Result<PathBuf, String> {
    let audio_dir = meeting_path
        .parent()
        .ok_or_else(|| "meeting has no parent directory".to_string())?
        .join("audio");
    std::fs::create_dir_all(&audio_dir).map_err(|e| e.to_string())?;
    let stem = meeting_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("recording");
    Ok(audio_dir.join(format!("{}.bin", stem)))
}

fn recording_pid_path(meeting_path: &Path) -> Result<PathBuf, String> {
    let audio_dir = meeting_path
        .parent()
        .ok_or_else(|| "meeting has no parent directory".to_string())?
        .join("audio");
    std::fs::create_dir_all(&audio_dir).map_err(|e| e.to_string())?;
    let stem = meeting_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("recording");
    Ok(audio_dir.join(format!("{}.pid", stem)))
}

/// Scan `<meetings_dir>/audio/*.pid` for orphaned sidecar recordings from
/// a previous session and clean them up. If the referenced PID is still
/// alive, send SIGTERM so the sidecar doesn't keep recording audio for a
/// session the user can no longer reach. Remove the pid file in either
/// case.
fn cleanup_orphaned_recordings(meetings_dir: &Path) {
    let audio_dir = meetings_dir.join("audio");
    let Ok(entries) = std::fs::read_dir(&audio_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("pid") {
            continue;
        }
        if let Ok(content) = std::fs::read_to_string(&path) {
            if let Ok(pid) = content.trim().parse::<u32>() {
                let alive = std::process::Command::new("kill")
                    .arg("-0")
                    .arg(pid.to_string())
                    .status()
                    .map(|s| s.success())
                    .unwrap_or(false);
                if alive {
                    let _ = std::process::Command::new("kill")
                        .arg("-TERM")
                        .arg(pid.to_string())
                        .status();
                }
            }
        }
        let _ = std::fs::remove_file(&path);
    }
}

async fn find_sidecar_pid() -> Result<u32, String> {
    // Wait up to ~1.5s for the sidecar to register with the process list.
    for _ in 0..6 {
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        let output = std::process::Command::new("pgrep")
            .arg("-n") // newest
            .arg("-f")
            .arg("PanesAudioCapture")
            .output();
        if let Ok(out) = output {
            let text = String::from_utf8_lossy(&out.stdout);
            let trimmed = text.trim();
            if let Ok(pid) = trimmed.parse::<u32>() {
                return Ok(pid);
            }
        }
    }
    Err("could not locate PanesAudioCapture process after launch".to_string())
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

// -- Whisper model catalog ---------------------------------------------------

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WhisperModelTier {
    Testing,
    Fast,
    Balanced,
    High,
    Recommended,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperModelDto {
    pub name: String,
    pub display_name: String,
    pub size_bytes: u64,
    pub description: String,
    pub tier: WhisperModelTier,
    pub downloaded: bool,
    pub downloaded_bytes: u64,
    pub in_progress_bytes: u64,
}

struct CatalogEntry {
    name: &'static str,
    display_name: &'static str,
    size_bytes: u64,
    description: &'static str,
    tier: WhisperModelTier,
}

/// Approximate sizes are from the ggerganov/whisper.cpp HuggingFace mirror;
/// exact bytes may vary ±small with model updates, but the numbers are close
/// enough to drive progress bars and disk-space warnings.
const WHISPER_CATALOG: &[CatalogEntry] = &[
    CatalogEntry {
        name: "ggml-tiny.bin",
        display_name: "Tiny",
        size_bytes: 77_691_713,
        description: "Testing only — low accuracy, 39M params.",
        tier: WhisperModelTier::Testing,
    },
    CatalogEntry {
        name: "ggml-base.bin",
        display_name: "Base",
        size_bytes: 147_951_465,
        description: "Basic quality, small download. 74M params.",
        tier: WhisperModelTier::Fast,
    },
    CatalogEntry {
        name: "ggml-small.bin",
        display_name: "Small",
        size_bytes: 487_601_967,
        description: "Good balance for short clips. 244M params.",
        tier: WhisperModelTier::Balanced,
    },
    CatalogEntry {
        name: "ggml-medium.bin",
        display_name: "Medium",
        size_bytes: 1_533_763_059,
        description: "High quality, slower downloads. 769M params.",
        tier: WhisperModelTier::High,
    },
    CatalogEntry {
        name: "ggml-large-v3-turbo.bin",
        display_name: "Large v3 Turbo",
        size_bytes: 1_624_555_275,
        description: "Best accuracy/speed for full meetings. 809M params.",
        tier: WhisperModelTier::Recommended,
    },
];

fn whisper_model_url(name: &str) -> String {
    format!(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{}",
        name
    )
}

#[tauri::command]
pub async fn list_whisper_models() -> Result<Vec<WhisperModelDto>, String> {
    let dir = model_dir().map_err(|e| e.to_string())?;
    tokio::task::spawn_blocking(move || -> Result<Vec<WhisperModelDto>, String> {
        let _ = std::fs::create_dir_all(&dir);
        let mut out = Vec::with_capacity(WHISPER_CATALOG.len());
        for entry in WHISPER_CATALOG {
            let final_path = dir.join(entry.name);
            let part_path = dir.join(format!("{}.part", entry.name));
            let (downloaded, downloaded_bytes) = match std::fs::metadata(&final_path) {
                Ok(m) => (true, m.len()),
                Err(_) => (false, 0),
            };
            let in_progress_bytes = std::fs::metadata(&part_path).map(|m| m.len()).unwrap_or(0);
            out.push(WhisperModelDto {
                name: entry.name.to_string(),
                display_name: entry.display_name.to_string(),
                size_bytes: entry.size_bytes,
                description: entry.description.to_string(),
                tier: entry.tier,
                downloaded,
                downloaded_bytes,
                in_progress_bytes,
            });
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress<'a> {
    name: &'a str,
    downloaded: u64,
    total: u64,
    done: bool,
}

#[tauri::command]
pub async fn download_whisper_model(app: AppHandle, name: String) -> Result<(), String> {
    let entry = WHISPER_CATALOG
        .iter()
        .find(|e| e.name == name)
        .ok_or_else(|| format!("unknown model: {}", name))?;

    let dir = model_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let final_path = dir.join(&name);
    let part_path = dir.join(format!("{}.part", name));

    if final_path.exists() {
        // Already present — emit a final "done" event so the UI refreshes cleanly.
        let _ = app.emit(
            "meetings:model-download-progress",
            DownloadProgress {
                name: &name,
                downloaded: std::fs::metadata(&final_path).map(|m| m.len()).unwrap_or(0),
                total: entry.size_bytes,
                done: true,
            },
        );
        return Ok(());
    }

    let url = whisper_model_url(&name);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60 * 30))
        .build()
        .map_err(|e| e.to_string())?;
    let mut response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("download failed: HTTP {}", response.status()));
    }
    let total = response.content_length().unwrap_or(entry.size_bytes);

    let mut file = tokio::fs::File::create(&part_path)
        .await
        .map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;
    let mut last_emit: u64 = 0;

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("stream error: {e}"))?
    {
        file.write_all(&chunk)
            .await
            .map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        if downloaded - last_emit > 1_048_576 {
            last_emit = downloaded;
            let _ = app.emit(
                "meetings:model-download-progress",
                DownloadProgress {
                    name: &name,
                    downloaded,
                    total,
                    done: false,
                },
            );
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);

    tokio::fs::rename(&part_path, &final_path)
        .await
        .map_err(|e| format!("rename failed: {e}"))?;

    let _ = app.emit(
        "meetings:model-download-progress",
        DownloadProgress {
            name: &name,
            downloaded,
            total,
            done: true,
        },
    );

    Ok(())
}

#[tauri::command]
pub async fn delete_whisper_model(name: String) -> Result<(), String> {
    let dir = model_dir().map_err(|e| e.to_string())?;
    let target = dir.join(&name);
    let part = dir.join(format!("{}.part", name));
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        if target.exists() {
            std::fs::remove_file(&target).map_err(|e| e.to_string())?;
        }
        if part.exists() {
            let _ = std::fs::remove_file(&part);
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// One channel's worth of decoded audio at its native sample rate.
struct SourceAudio {
    samples: Vec<f32>,
    rate: u32,
    channels: u8,
}

impl SourceAudio {
    fn empty() -> Self {
        SourceAudio { samples: Vec::new(), rate: 0, channels: 0 }
    }
}

/// Parse the framed output produced by the audio-capture sidecar in
/// `--mode both`. Frame layout:
///   u8  sourceId   (0 = mic, 1 = system)
///   u32 sampleRate (Hz, little-endian)
///   u8  channels
///   u32 sampleCount (number of float32 samples, little-endian; includes all channels)
///   f32[sampleCount] interleaved samples
fn parse_framed_pcm(bytes: &[u8]) -> Result<(SourceAudio, SourceAudio), String> {
    let mut mic = SourceAudio::empty();
    let mut system = SourceAudio::empty();
    let mut offset = 0usize;
    while offset + 10 <= bytes.len() {
        let source_id = bytes[offset];
        offset += 1;
        let rate = u32::from_le_bytes([
            bytes[offset],
            bytes[offset + 1],
            bytes[offset + 2],
            bytes[offset + 3],
        ]);
        offset += 4;
        let channels = bytes[offset];
        offset += 1;
        let sample_count = u32::from_le_bytes([
            bytes[offset],
            bytes[offset + 1],
            bytes[offset + 2],
            bytes[offset + 3],
        ]) as usize;
        offset += 4;

        let payload_bytes = sample_count
            .checked_mul(4)
            .ok_or_else(|| "sample count overflow".to_string())?;
        if offset + payload_bytes > bytes.len() {
            return Err(format!("truncated frame payload at offset {offset}"));
        }
        let target = match source_id {
            0 => &mut mic,
            1 => &mut system,
            other => {
                return Err(format!("unknown source id {other} at offset {offset}"));
            }
        };
        target.rate = rate;
        target.channels = channels;
        target.samples.reserve(sample_count);
        for i in 0..sample_count {
            let base = offset + i * 4;
            target.samples.push(f32::from_le_bytes([
                bytes[base],
                bytes[base + 1],
                bytes[base + 2],
                bytes[base + 3],
            ]));
        }
        offset += payload_bytes;
    }
    if offset != bytes.len() {
        return Err(format!(
            "framed stream has {} trailing bytes",
            bytes.len() - offset
        ));
    }
    Ok((mic, system))
}

fn downmix_to_mono(samples: &[f32], channels: u8) -> Vec<f32> {
    if channels <= 1 || samples.is_empty() {
        return samples.to_vec();
    }
    let channels = channels as usize;
    let mut out = Vec::with_capacity(samples.len() / channels);
    let scale = 1.0 / channels as f32;
    for frame in samples.chunks_exact(channels) {
        out.push(frame.iter().sum::<f32>() * scale);
    }
    out
}

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

/// Additive mix of mic and system streams at a common rate. Each stream is
/// first downmixed to mono (if multi-channel), then resampled to the higher
/// of the two native rates. Samples are summed and divided by 2 to keep the
/// output within [-1, 1] under typical conditions. Longer stream controls
/// output length; the shorter one is padded with zeros.
fn mix_sources(mic: &SourceAudio, system: &SourceAudio) -> Vec<f32> {
    if mic.samples.is_empty() && system.samples.is_empty() {
        return Vec::new();
    }
    let mic_mono = downmix_to_mono(&mic.samples, mic.channels.max(1));
    let system_mono = downmix_to_mono(&system.samples, system.channels.max(1));
    let target_rate = mic.rate.max(system.rate);
    let mic_aligned = if mic.rate == target_rate || mic.rate == 0 {
        mic_mono
    } else {
        resample_linear(&mic_mono, mic.rate, target_rate)
    };
    let system_aligned = if system.rate == target_rate || system.rate == 0 {
        system_mono
    } else {
        resample_linear(&system_mono, system.rate, target_rate)
    };
    let len = mic_aligned.len().max(system_aligned.len());
    let mut mixed = Vec::with_capacity(len);
    for i in 0..len {
        let a = mic_aligned.get(i).copied().unwrap_or(0.0);
        let b = system_aligned.get(i).copied().unwrap_or(0.0);
        mixed.push((a + b) * 0.5);
    }
    mixed
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

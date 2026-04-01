use std::process::Command;

use serde_json::Value;
use tauri::State;

use crate::{
    db,
    models::{ContextDto, ContextUpdateDto, PrCommentDto, PrMetadataDto, PrReviewCommentDto},
    process_utils, runtime_env,
    state::AppState,
};

async fn run_db<T, F>(db: crate::db::Database, operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&crate::db::Database) -> anyhow::Result<T> + Send + 'static,
{
    tokio::task::spawn_blocking(move || operation(&db))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn create_context(
    state: State<'_, AppState>,
    ctx: ContextDto,
) -> Result<ContextDto, String> {
    run_db(state.db.clone(), move |db| {
        db::contexts::create_context(db, &ctx)
    })
    .await
}

#[tauri::command]
pub async fn list_contexts(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<ContextDto>, String> {
    run_db(state.db.clone(), move |db| {
        db::contexts::list_contexts(db, &workspace_id)
    })
    .await
}

#[tauri::command]
pub async fn update_context(
    state: State<'_, AppState>,
    id: String,
    update: ContextUpdateDto,
) -> Result<(), String> {
    run_db(state.db.clone(), move |db| {
        db::contexts::update_context(db, &id, &update)
    })
    .await
}

#[tauri::command]
pub async fn get_context_for_thread(
    state: State<'_, AppState>,
    thread_id: String,
) -> Result<Option<ContextDto>, String> {
    run_db(state.db.clone(), move |db| {
        db::contexts::get_context_for_thread(db, &thread_id)
    })
    .await
}

#[tauri::command]
pub async fn archive_context(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    run_db(state.db.clone(), move |db| {
        db::contexts::archive_context(db, &id)
    })
    .await
}

#[tauri::command]
pub async fn fetch_pr_metadata(pr_url: String) -> Result<PrMetadataDto, String> {
    tokio::task::spawn_blocking(move || fetch_pr_metadata_blocking(&pr_url))
        .await
        .map_err(|e| e.to_string())?
}

fn fetch_pr_metadata_blocking(pr_url: &str) -> Result<PrMetadataDto, String> {
    // Resolve gh CLI path
    let gh_path = runtime_env::resolve_executable("gh")
        .ok_or_else(|| "GitHub CLI (gh) is not installed or not on PATH. Install it from https://cli.github.com to use PR integration.".to_string())?;

    // Parse owner/repo and PR number from URL
    // Supports: https://github.com/owner/repo/pull/123
    let (repo_slug, pr_number) = parse_pr_url(pr_url)
        .ok_or_else(|| format!("Could not parse PR URL: {pr_url}. Expected format: https://github.com/owner/repo/pull/123"))?;

    // Run gh pr view
    let mut cmd = Command::new(&gh_path);
    process_utils::configure_std_command(&mut cmd);
    let output = cmd
        .args([
            "pr", "view",
            &pr_number.to_string(),
            "--repo", &repo_slug,
            "--json", "number,title,body,headRefName,comments,reviews",
        ])
        .output()
        .map_err(|e| format!("Failed to run gh CLI: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("gh pr view failed: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse gh output: {e}"))?;

    // Extract PR metadata
    let title = json["title"].as_str().unwrap_or("").to_string();
    let body = json["body"].as_str().unwrap_or("").to_string();
    let head_ref_name = json["headRefName"].as_str().unwrap_or("").to_string();
    let number = json["number"].as_i64().unwrap_or(pr_number as i64);

    // Extract review comments from the reviews array
    let mut review_comments = Vec::new();
    if let Some(reviews) = json["reviews"].as_array() {
        for review in reviews {
            let author = review["author"]["login"].as_str().unwrap_or("unknown");
            let review_body = review["body"].as_str().unwrap_or("");
            if !review_body.is_empty() {
                review_comments.push(PrReviewCommentDto {
                    author: author.to_string(),
                    body: review_body.to_string(),
                    path: None,
                    line: None,
                });
            }
        }
    }

    // Extract issue-level comments
    let mut comments = Vec::new();
    if let Some(comment_list) = json["comments"].as_array() {
        for comment in comment_list {
            let author = comment["author"]["login"].as_str().unwrap_or("unknown");
            let comment_body = comment["body"].as_str().unwrap_or("");
            if !comment_body.is_empty() {
                comments.push(PrCommentDto {
                    author: author.to_string(),
                    body: comment_body.to_string(),
                });
            }
        }
    }

    Ok(PrMetadataDto {
        number,
        title,
        body,
        head_ref_name,
        review_comments,
        comments,
    })
}

fn parse_pr_url(url: &str) -> Option<(String, u64)> {
    // Match: https://github.com/owner/repo/pull/123
    // Also handles trailing slashes, query params, fragments
    let url = url.trim().trim_end_matches('/');
    let parts: Vec<&str> = url.split('/').collect();

    // Find the "pull" segment and extract owner/repo + number
    for (i, part) in parts.iter().enumerate() {
        if *part == "pull" && i >= 2 && i + 1 < parts.len() {
            let owner = parts[i - 2];
            let repo = parts[i - 1];
            let number_str = parts[i + 1].split(&['?', '#'][..]).next()?;
            let number = number_str.parse::<u64>().ok()?;
            if !owner.is_empty() && !repo.is_empty() {
                return Some((format!("{owner}/{repo}"), number));
            }
        }
    }
    None
}

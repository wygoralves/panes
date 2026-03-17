pub mod protocol;
pub mod router;
pub mod server;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::state::AppState;

pub fn emit_app_event<T>(app: &AppHandle, channel: &str, payload: &T)
where
    T: Serialize,
{
    let _ = app.emit(channel, payload);
    app.state::<AppState>()
        .remote_host
        .publish_event(channel, payload);
}

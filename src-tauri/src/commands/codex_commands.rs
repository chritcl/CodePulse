use tauri::State;

use crate::codex::{CodexRuntime, CodexStatusSnapshot};

#[tauri::command]
pub fn get_codex_status_snapshot(runtime: State<'_, CodexRuntime>) -> CodexStatusSnapshot {
    runtime.snapshot()
}

#[tauri::command]
pub fn clear_failed_codex_task(runtime: State<'_, CodexRuntime>, session_id: String) -> bool {
    runtime.clear_failed_task(&session_id)
}

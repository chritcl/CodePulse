use tauri::State;

use crate::agent::runtime::AgentRuntime;
use crate::claude::ClaudeStatusSnapshot;

#[tauri::command]
pub fn get_claude_status_snapshot(runtime: State<'_, AgentRuntime>) -> ClaudeStatusSnapshot {
    runtime.claude_snapshot()
}

#[tauri::command]
pub fn clear_failed_claude_task(runtime: State<'_, AgentRuntime>, task_key: String) -> bool {
    runtime.clear_failed_claude_task(&task_key)
}

#[tauri::command]
pub fn set_claude_task_summary_capture(
    runtime: State<'_, AgentRuntime>,
    enabled: bool,
) -> Result<(), String> {
    runtime
        .set_claude_task_summary_capture(enabled)
        .map_err(|error| error.to_string())
}

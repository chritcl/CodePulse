use tauri::{AppHandle, Emitter, State};

use crate::agent::runtime::AgentRuntime;
use crate::agent::AgentProvider;
use crate::claude::{
    ClaudeIntegration, ClaudeIntegrationAction, ClaudeIntegrationActionResult,
    ClaudeIntegrationPreview, ClaudeIntegrationStatus, CLAUDE_INTEGRATION_UPDATED_EVENT,
};

#[tauri::command]
pub fn get_claude_integration_status(
    integration: State<'_, ClaudeIntegration>,
) -> ClaudeIntegrationStatus {
    integration.check()
}

#[tauri::command]
pub fn preview_claude_integration(
    integration: State<'_, ClaudeIntegration>,
    action: ClaudeIntegrationAction,
) -> Result<ClaudeIntegrationPreview, String> {
    integration.preview(action).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn confirm_claude_integration(
    app: AppHandle,
    integration: State<'_, ClaudeIntegration>,
    runtime: State<'_, AgentRuntime>,
    preview_id: String,
) -> Result<ClaudeIntegrationActionResult, String> {
    let integration = integration.inner().clone();
    let confirmation = integration.clone();
    let mut result =
        tauri::async_runtime::spawn_blocking(move || confirmation.confirm(&preview_id))
            .await
            .map_err(|error| format!("确认 Claude Code 集成操作失败: {error}"))?
            .map_err(|error| error.to_string())?;

    if result.action == ClaudeIntegrationAction::InstallOrRepair {
        if runtime
            .start_provider(AgentProvider::Claude, integration.app_data_dir())
            .await
            .is_err()
        {
            result.listener_start_failed = true;
        }
    } else {
        runtime.stop_provider(AgentProvider::Claude).await;
    }

    let _ = app.emit(CLAUDE_INTEGRATION_UPDATED_EVENT, integration.check());
    Ok(result)
}

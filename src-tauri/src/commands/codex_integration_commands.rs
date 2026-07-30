use tauri::{AppHandle, Emitter, State};

use crate::codex::{
    CodexIntegration, CodexIntegrationPreview, CodexIntegrationStatus, CodexRuntime,
    IntegrationAction, IntegrationActionResult, CODEX_INTEGRATION_UPDATED_EVENT,
};

#[tauri::command]
pub fn get_codex_integration_status(
    integration: State<'_, CodexIntegration>,
) -> CodexIntegrationStatus {
    integration.check()
}

#[tauri::command]
pub fn preview_codex_integration(
    integration: State<'_, CodexIntegration>,
    action: IntegrationAction,
) -> Result<CodexIntegrationPreview, String> {
    integration.preview(action).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn confirm_codex_integration(
    app: AppHandle,
    integration: State<'_, CodexIntegration>,
    runtime: State<'_, CodexRuntime>,
    preview_id: String,
) -> Result<IntegrationActionResult, String> {
    let integration = integration.inner().clone();
    let confirmation = integration.clone();
    let mut result =
        tauri::async_runtime::spawn_blocking(move || confirmation.confirm(&preview_id))
            .await
            .map_err(|error| format!("确认 Codex 集成操作失败: {error}"))?
            .map_err(|error| error.to_string())?;

    if result.action == IntegrationAction::InstallOrRepair {
        if runtime.start(integration.app_data_dir()).await.is_err() {
            result.listener_start_failed = true;
        }
    } else {
        runtime.stop().await;
    }

    let _ = app.emit(CODEX_INTEGRATION_UPDATED_EVENT, integration.check());
    Ok(result)
}

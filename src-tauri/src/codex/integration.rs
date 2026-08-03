use std::collections::HashMap;
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use super::bridge_install::{
    bridge_target_path, install_bridge, verify_bridge_minimally, BridgeInstallError,
};
use super::config::{ConfigError, HookMutation};

mod inspection;
mod mutation;

pub(super) use self::inspection::bridge_command;
pub use self::inspection::resolve_bridge_source;
use self::inspection::{
    inspect_bridge, inspect_candidate, inspect_global_hooks, select_candidate, CandidateSelection,
};
use self::mutation::{
    configuration_digest, hook_config_format, remove_unreferenced_bridge, update_configuration,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SelectedConfigRepresentation {
    HooksJson,
    ConfigToml,
    Ambiguous,
    Invalid,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GlobalHooksStatus {
    Enabled,
    ManualEnablementRequired,
    OrganizationManaged,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CodePulseHookStatus {
    NotInstalled,
    Installed,
    WaitingTrust,
    NeedsRepair,
    ManualIntervention,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BridgeStatus {
    Ready,
    Missing,
    NeedsRepair,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexIntegrationStatus {
    pub selected_config: SelectedConfigRepresentation,
    pub global_hooks: GlobalHooksStatus,
    pub hook: CodePulseHookStatus,
    pub bridge: BridgeStatus,
    pub codex_home_exists: bool,
    pub selected_config_file: Option<String>,
    pub bridge_file: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum IntegrationAction {
    InstallOrRepair,
    Uninstall,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexIntegrationPreview {
    pub id: String,
    pub action: IntegrationAction,
    pub target_file: String,
    pub bridge_file: String,
    pub changes: Vec<String>,
    pub warnings: Vec<String>,
    pub can_confirm: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationActionResult {
    pub action: IntegrationAction,
    pub backup_file: Option<String>,
    pub bridge_cleanup_pending: bool,
    pub listener_start_failed: bool,
}

#[derive(Debug)]
pub enum IntegrationError {
    Invalid(String),
    Io(std::io::Error),
    Bridge(BridgeInstallError),
    Config(ConfigError),
    PreviewNotFound,
    ConfigurationChanged,
    Unsupported,
}

impl fmt::Display for IntegrationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Invalid(reason) => write!(formatter, "Codex 集成配置无效: {reason}"),
            Self::Io(error) => write!(formatter, "Codex 集成配置 IO 错误: {error}"),
            Self::Bridge(error) => write!(formatter, "Codex 集成 Bridge 错误: {error}"),
            Self::Config(error) => write!(formatter, "Codex 集成 Hook 错误: {error}"),
            Self::PreviewNotFound => formatter.write_str("预览已失效，请重新生成"),
            Self::ConfigurationChanged => formatter.write_str("配置已变化，请重新生成预览"),
            Self::Unsupported => formatter.write_str("该确认操作尚未实现"),
        }
    }
}

impl std::error::Error for IntegrationError {}

impl From<std::io::Error> for IntegrationError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<BridgeInstallError> for IntegrationError {
    fn from(error: BridgeInstallError) -> Self {
        Self::Bridge(error)
    }
}

impl From<ConfigError> for IntegrationError {
    fn from(error: ConfigError) -> Self {
        Self::Config(error)
    }
}

#[derive(Debug, Clone)]
pub struct IntegrationPaths {
    codex_home: PathBuf,
    app_data_dir: PathBuf,
    bridge_source: PathBuf,
    codex_home_overridden: bool,
}

impl IntegrationPaths {
    pub fn new(codex_home: PathBuf, app_data_dir: PathBuf, bridge_source: PathBuf) -> Self {
        Self {
            codex_home,
            app_data_dir,
            bridge_source,
            codex_home_overridden: false,
        }
    }

    pub fn from_current_user(
        app_data_dir: PathBuf,
        bridge_source: PathBuf,
    ) -> Result<Self, IntegrationError> {
        let user_profile = std::env::var_os("USERPROFILE")
            .ok_or_else(|| IntegrationError::Invalid("未找到 Windows 用户目录".to_string()))?;
        let codex_home_overridden =
            std::env::var_os("CODEX_HOME").is_some_and(|value| !value.is_empty());

        Ok(Self {
            codex_home: PathBuf::from(user_profile).join(".codex"),
            app_data_dir,
            bridge_source,
            codex_home_overridden,
        })
    }
}

type BridgeVerifier = dyn Fn(&Path) -> Result<(), BridgeInstallError> + Send + Sync;

#[derive(Clone)]
pub struct CodexIntegration {
    paths: IntegrationPaths,
    previews: Arc<Mutex<HashMap<String, PendingPreview>>>,
    bridge_verifier: Arc<BridgeVerifier>,
}

#[derive(Debug, Clone)]
struct PendingPreview {
    action: IntegrationAction,
    representation: SelectedConfigRepresentation,
    target_path: PathBuf,
    digest: Option<[u8; 32]>,
}

impl CodexIntegration {
    pub fn new(paths: IntegrationPaths) -> Self {
        Self::with_bridge_verifier(paths, Arc::new(verify_bridge_minimally))
    }

    #[cfg(test)]
    pub(super) fn new_for_test(paths: IntegrationPaths) -> Self {
        Self::with_bridge_verifier(paths, Arc::new(|_: &Path| Ok::<(), BridgeInstallError>(())))
    }

    fn with_bridge_verifier(paths: IntegrationPaths, bridge_verifier: Arc<BridgeVerifier>) -> Self {
        Self {
            paths,
            previews: Arc::new(Mutex::new(HashMap::new())),
            bridge_verifier,
        }
    }

    pub fn check(&self) -> CodexIntegrationStatus {
        let bridge_path = bridge_target_path(&self.paths.app_data_dir);
        if self.paths.codex_home_overridden {
            return CodexIntegrationStatus {
                selected_config: SelectedConfigRepresentation::Invalid,
                global_hooks: GlobalHooksStatus::ManualEnablementRequired,
                hook: CodePulseHookStatus::ManualIntervention,
                bridge: inspect_bridge(&self.paths.bridge_source, &bridge_path),
                codex_home_exists: false,
                selected_config_file: None,
                bridge_file: bridge_path.display().to_string(),
                message: Some(
                    "检测到 CODEX_HOME 覆盖，CodePulse 不会写入非默认用户层配置".to_string(),
                ),
            };
        }
        let expected_command = bridge_command(&bridge_path);
        let hooks_json = inspect_candidate(
            SelectedConfigRepresentation::HooksJson,
            self.paths.codex_home.join("hooks.json"),
            &expected_command,
        );
        let config_toml = inspect_candidate(
            SelectedConfigRepresentation::ConfigToml,
            self.paths.codex_home.join("config.toml"),
            &expected_command,
        );
        let global_hooks = inspect_global_hooks(&config_toml);
        let bridge = inspect_bridge(&self.paths.bridge_source, &bridge_path);
        let selected = select_candidate(&hooks_json, &config_toml);

        let (selected_config, selected_config_file, hook, message) = match selected {
            CandidateSelection::Candidate(candidate) => {
                let hook = if candidate.inspection.marked_handlers == 0 {
                    CodePulseHookStatus::NotInstalled
                } else if candidate.inspection.is_correct() && bridge == BridgeStatus::Ready {
                    if global_hooks == GlobalHooksStatus::Enabled {
                        CodePulseHookStatus::WaitingTrust
                    } else {
                        CodePulseHookStatus::Installed
                    }
                } else {
                    CodePulseHookStatus::NeedsRepair
                };
                (
                    candidate.representation.clone(),
                    candidate
                        .path
                        .file_name()
                        .and_then(|name| name.to_str())
                        .map(ToString::to_string),
                    hook,
                    None,
                )
            }
            CandidateSelection::Invalid(reason) => (
                SelectedConfigRepresentation::Invalid,
                None,
                CodePulseHookStatus::ManualIntervention,
                Some(reason),
            ),
            CandidateSelection::Ambiguous => (
                SelectedConfigRepresentation::Ambiguous,
                None,
                CodePulseHookStatus::ManualIntervention,
                Some("同时存在多个用户层 Hook 表示，无法安全选择写入目标".to_string()),
            ),
        };

        CodexIntegrationStatus {
            selected_config,
            global_hooks,
            hook,
            bridge,
            codex_home_exists: self.paths.codex_home.is_dir(),
            selected_config_file,
            bridge_file: bridge_path.display().to_string(),
            message,
        }
    }

    pub fn preview(
        &self,
        action: IntegrationAction,
    ) -> Result<CodexIntegrationPreview, IntegrationError> {
        if self.paths.codex_home_overridden {
            return Err(IntegrationError::Invalid(
                "检测到 CODEX_HOME 覆盖，无法安全修改默认用户层配置".to_string(),
            ));
        }
        let bridge_path = bridge_target_path(&self.paths.app_data_dir);
        let expected_command = bridge_command(&bridge_path);
        let hooks_json = inspect_candidate(
            SelectedConfigRepresentation::HooksJson,
            self.paths.codex_home.join("hooks.json"),
            &expected_command,
        );
        let config_toml = inspect_candidate(
            SelectedConfigRepresentation::ConfigToml,
            self.paths.codex_home.join("config.toml"),
            &expected_command,
        );
        let candidate = match select_candidate(&hooks_json, &config_toml) {
            CandidateSelection::Candidate(candidate) => candidate,
            CandidateSelection::Invalid(reason) => return Err(IntegrationError::Invalid(reason)),
            CandidateSelection::Ambiguous => {
                return Err(IntegrationError::Invalid(
                    "同时存在多个用户层 Hook 表示，无法安全选择写入目标".to_string(),
                ));
            }
        };

        if action == IntegrationAction::Uninstall && candidate.inspection.marked_handlers == 0 {
            return Err(IntegrationError::Invalid(
                "未找到可由 CodePulse 卸载的 Hook 标记".to_string(),
            ));
        }
        if action == IntegrationAction::InstallOrRepair {
            let metadata = fs::metadata(&self.paths.bridge_source)?;
            if !metadata.is_file() || metadata.len() == 0 {
                return Err(IntegrationError::Invalid("发布 Bridge 不可用".to_string()));
            }
        }

        let id = uuid::Uuid::new_v4().to_string();
        let digest = configuration_digest(&candidate.path)?;
        let pending = PendingPreview {
            action,
            representation: candidate.representation.clone(),
            target_path: candidate.path.clone(),
            digest,
        };
        self.previews
            .lock()
            .expect("Codex 集成预览锁不应中毒")
            .insert(id.clone(), pending);

        let target_file = candidate.path.display().to_string();
        let changes = match action {
            IntegrationAction::InstallOrRepair => vec![
                "仅新增或修复带 CodePulse 标记的 Hook 处理器".to_string(),
                "不会修改 Codex 的全局 Hooks 开关".to_string(),
            ],
            IntegrationAction::Uninstall => {
                vec!["仅移除带 CodePulse 标记的 Hook 处理器".to_string()]
            }
        };
        let warnings = if inspect_global_hooks(&config_toml) == GlobalHooksStatus::Enabled {
            Vec::new()
        } else {
            vec!["请先在 Codex 中手动启用 Hooks，CodePulse 不会代替你修改此设置".to_string()]
        };

        Ok(CodexIntegrationPreview {
            id,
            action,
            target_file,
            bridge_file: bridge_path.display().to_string(),
            changes,
            warnings,
            can_confirm: true,
        })
    }

    pub fn confirm(&self, preview_id: &str) -> Result<IntegrationActionResult, IntegrationError> {
        let pending = self
            .previews
            .lock()
            .expect("Codex 集成预览锁不应中毒")
            .remove(preview_id)
            .ok_or(IntegrationError::PreviewNotFound)?;
        let current_digest = configuration_digest(&pending.target_path)?;
        if current_digest != pending.digest {
            return Err(IntegrationError::ConfigurationChanged);
        }

        let format = hook_config_format(&pending.representation)?;
        let bridge_path = bridge_target_path(&self.paths.app_data_dir);
        let bridge_command = bridge_command(&bridge_path);
        match pending.action {
            IntegrationAction::InstallOrRepair => {
                let bridge_verifier = self.bridge_verifier.clone();
                install_bridge(
                    &self.paths.bridge_source,
                    &bridge_path,
                    move |temporary_path| bridge_verifier(temporary_path),
                )?;
                let backup_file = update_configuration(
                    &pending.target_path,
                    format,
                    &bridge_command,
                    HookMutation::InstallOrRepair,
                )?;
                Ok(IntegrationActionResult {
                    action: pending.action,
                    backup_file,
                    bridge_cleanup_pending: false,
                    listener_start_failed: false,
                })
            }
            IntegrationAction::Uninstall => {
                let backup_file = update_configuration(
                    &pending.target_path,
                    format,
                    &bridge_command,
                    HookMutation::Uninstall,
                )?;
                let bridge_cleanup_pending =
                    remove_unreferenced_bridge(&self.paths.codex_home, &bridge_path);
                Ok(IntegrationActionResult {
                    action: pending.action,
                    backup_file,
                    bridge_cleanup_pending,
                    listener_start_failed: false,
                })
            }
        }
    }

    pub fn app_data_dir(&self) -> &Path {
        &self.paths.app_data_dir
    }

    pub fn should_start_listener(&self) -> bool {
        matches!(
            self.check().hook,
            CodePulseHookStatus::Installed | CodePulseHookStatus::WaitingTrust
        )
    }
}

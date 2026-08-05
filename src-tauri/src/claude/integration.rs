use std::collections::HashMap;
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::agent::integration_io::{
    configuration_digest, write_json_configuration_atomically, IntegrationIoError,
};
use crate::codex::bridge_install::{
    bridge_matches_source, install_bridge, verify_bridge_minimally, BridgeInstallError,
};

use super::config::{
    apply_claude_hook_mutation, inspect_claude_hooks, ClaudeConfigError, ClaudeHookMutation,
};

pub const CLAUDE_BRIDGE_FILE_NAME: &str = "codepulse-claude-bridge.exe";
pub const MINIMUM_CLAUDE_VERSION: &str = "2.1.221";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ClaudeCliStatus {
    Missing,
    Unsupported,
    Ready,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ClaudeHookStatus {
    NotInstalled,
    Installed,
    NeedsRepair,
    ManualIntervention,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ClaudeBridgeStatus {
    Ready,
    Missing,
    NeedsRepair,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeIntegrationStatus {
    pub cli: ClaudeCliStatus,
    pub cli_version: Option<String>,
    pub minimum_cli_version: String,
    pub hook: ClaudeHookStatus,
    pub bridge: ClaudeBridgeStatus,
    pub settings_file: String,
    pub bridge_file: String,
    pub cli_file: String,
    pub disable_all_hooks: bool,
    pub allow_managed_hooks_only: bool,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ClaudeIntegrationAction {
    InstallOrRepair,
    Uninstall,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeIntegrationPreview {
    pub id: String,
    pub action: ClaudeIntegrationAction,
    pub target_file: String,
    pub bridge_file: String,
    pub changes: Vec<String>,
    pub warnings: Vec<String>,
    pub can_confirm: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeIntegrationActionResult {
    pub action: ClaudeIntegrationAction,
    pub backup_file: Option<String>,
    pub bridge_cleanup_pending: bool,
    pub listener_start_failed: bool,
}

#[derive(Debug)]
pub enum ClaudeIntegrationError {
    Invalid(String),
    Io(std::io::Error),
    Bridge(BridgeInstallError),
    Config(ClaudeConfigError),
    Transaction(IntegrationIoError),
    PreviewNotFound,
    ConfigurationChanged,
}

impl fmt::Display for ClaudeIntegrationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Invalid(reason) => write!(formatter, "Claude Code 集成配置无效: {reason}"),
            Self::Io(error) => write!(formatter, "Claude Code 集成 IO 错误: {error}"),
            Self::Bridge(error) => write!(formatter, "Claude Code Bridge 错误: {error}"),
            Self::Config(error) => write!(formatter, "Claude Code Hook 错误: {error}"),
            Self::Transaction(error) => write!(formatter, "Claude Code 配置事务失败: {error}"),
            Self::PreviewNotFound => formatter.write_str("预览已失效，请重新生成"),
            Self::ConfigurationChanged => formatter.write_str("配置已变化，请重新生成预览"),
        }
    }
}

impl std::error::Error for ClaudeIntegrationError {}

impl From<std::io::Error> for ClaudeIntegrationError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<BridgeInstallError> for ClaudeIntegrationError {
    fn from(error: BridgeInstallError) -> Self {
        Self::Bridge(error)
    }
}

impl From<ClaudeConfigError> for ClaudeIntegrationError {
    fn from(error: ClaudeConfigError) -> Self {
        Self::Config(error)
    }
}

impl From<IntegrationIoError> for ClaudeIntegrationError {
    fn from(error: IntegrationIoError) -> Self {
        Self::Transaction(error)
    }
}

#[derive(Debug, Clone)]
pub struct ClaudeIntegrationPaths {
    claude_home: PathBuf,
    app_data_dir: PathBuf,
    bridge_source: PathBuf,
    cli_executable: PathBuf,
}

impl ClaudeIntegrationPaths {
    pub fn new(
        claude_home: PathBuf,
        app_data_dir: PathBuf,
        bridge_source: PathBuf,
        cli_executable: PathBuf,
    ) -> Self {
        Self {
            claude_home,
            app_data_dir,
            bridge_source,
            cli_executable,
        }
    }

    pub fn from_current_user(
        app_data_dir: PathBuf,
        bridge_source: PathBuf,
    ) -> Result<Self, ClaudeIntegrationError> {
        let user_profile = std::env::var_os("USERPROFILE").ok_or_else(|| {
            ClaudeIntegrationError::Invalid("未找到 Windows 用户目录".to_string())
        })?;
        let user_profile = PathBuf::from(user_profile);
        let preferred_cli = user_profile.join(".local/bin/claude.exe");
        let cli_executable = if preferred_cli.is_file() {
            preferred_cli
        } else {
            resolve_cli_from_path().unwrap_or(preferred_cli)
        };
        Ok(Self::new(
            user_profile.join(".claude"),
            app_data_dir,
            bridge_source,
            cli_executable,
        ))
    }

    pub fn claude_home(&self) -> &Path {
        &self.claude_home
    }

    pub fn app_data_dir(&self) -> &Path {
        &self.app_data_dir
    }

    pub fn settings_file(&self) -> PathBuf {
        self.claude_home.join("settings.json")
    }
}

#[derive(Debug, Clone)]
struct CliInspection {
    status: ClaudeCliStatus,
    version: Option<String>,
}

type CliProbe = dyn Fn(&Path) -> CliInspection + Send + Sync;
type BridgeVerifier = dyn Fn(&Path) -> Result<(), BridgeInstallError> + Send + Sync;

#[derive(Clone)]
pub struct ClaudeIntegration {
    paths: ClaudeIntegrationPaths,
    previews: Arc<Mutex<HashMap<String, PendingPreview>>>,
    cli_probe: Arc<CliProbe>,
    bridge_verifier: Arc<BridgeVerifier>,
}

#[derive(Debug, Clone)]
struct PendingPreview {
    action: ClaudeIntegrationAction,
    target_path: PathBuf,
    digest: Option<[u8; 32]>,
}

impl ClaudeIntegration {
    pub fn new(paths: ClaudeIntegrationPaths) -> Self {
        Self::with_dependencies(
            paths,
            Arc::new(inspect_cli),
            Arc::new(verify_bridge_minimally),
        )
    }

    #[cfg(test)]
    pub(super) fn new_for_test(paths: ClaudeIntegrationPaths, version: Option<&str>) -> Self {
        let version = version.map(ToString::to_string);
        Self::with_dependencies(
            paths,
            Arc::new(move |_| match version.clone() {
                Some(version) => CliInspection {
                    status: if version_is_supported(&version) {
                        ClaudeCliStatus::Ready
                    } else {
                        ClaudeCliStatus::Unsupported
                    },
                    version: Some(version),
                },
                None => CliInspection {
                    status: ClaudeCliStatus::Missing,
                    version: None,
                },
            }),
            Arc::new(|_| Ok(())),
        )
    }

    fn with_dependencies(
        paths: ClaudeIntegrationPaths,
        cli_probe: Arc<CliProbe>,
        bridge_verifier: Arc<BridgeVerifier>,
    ) -> Self {
        Self {
            paths,
            previews: Arc::new(Mutex::new(HashMap::new())),
            cli_probe,
            bridge_verifier,
        }
    }

    pub fn check(&self) -> ClaudeIntegrationStatus {
        let settings_path = self.paths.settings_file();
        let bridge_path = self.bridge_path();
        let cli = (self.cli_probe)(&self.paths.cli_executable);
        let bridge = inspect_bridge(&self.paths.bridge_source, &bridge_path);
        let inspected = read_settings(&settings_path).and_then(|content| {
            let value = serde_json::from_str::<Value>(&content).map_err(|error| {
                ClaudeIntegrationError::Invalid(format!("settings.json 解析失败: {error}"))
            })?;
            let inspection = inspect_claude_hooks(&content, &bridge_path.display().to_string())?;
            Ok((value, inspection))
        });

        let (hook, disable_all_hooks, allow_managed_hooks_only, message) = match inspected {
            Ok((value, inspection)) => {
                let disable_all_hooks =
                    value.get("disableAllHooks").and_then(Value::as_bool).unwrap_or(false);
                let allow_managed_hooks_only =
                    value.get("allowManagedHooksOnly").and_then(Value::as_bool).unwrap_or(false);
                let hook = if inspection.marked_handlers == 0 {
                    ClaudeHookStatus::NotInstalled
                } else if inspection.is_correct() && bridge == ClaudeBridgeStatus::Ready {
                    ClaudeHookStatus::Installed
                } else {
                    ClaudeHookStatus::NeedsRepair
                };
                let message = if allow_managed_hooks_only {
                    Some("allowManagedHooksOnly 已启用，CodePulse 不会安装或修复 Hook".to_string())
                } else if disable_all_hooks {
                    Some(
                        "disableAllHooks 已启用，Hook 当前不会执行；CodePulse 不会修改该设置"
                            .to_string(),
                    )
                } else if cli.status == ClaudeCliStatus::Missing {
                    Some("未找到 Windows 原生 Claude Code CLI".to_string())
                } else if cli.status == ClaudeCliStatus::Unsupported {
                    Some(format!(
                        "Claude Code CLI 版本需为 {MINIMUM_CLAUDE_VERSION} 或更高"
                    ))
                } else {
                    None
                };
                (hook, disable_all_hooks, allow_managed_hooks_only, message)
            }
            Err(error) => (
                ClaudeHookStatus::ManualIntervention,
                false,
                false,
                Some(error.to_string()),
            ),
        };

        ClaudeIntegrationStatus {
            cli: cli.status,
            cli_version: cli.version,
            minimum_cli_version: MINIMUM_CLAUDE_VERSION.to_string(),
            hook,
            bridge,
            settings_file: settings_path.display().to_string(),
            bridge_file: bridge_path.display().to_string(),
            cli_file: self.paths.cli_executable.display().to_string(),
            disable_all_hooks,
            allow_managed_hooks_only,
            message,
        }
    }

    pub fn preview(
        &self,
        action: ClaudeIntegrationAction,
    ) -> Result<ClaudeIntegrationPreview, ClaudeIntegrationError> {
        let target_path = self.paths.settings_file();
        let content = read_settings(&target_path)?;
        let value = serde_json::from_str::<Value>(&content).map_err(|error| {
            ClaudeIntegrationError::Invalid(format!("settings.json 解析失败: {error}"))
        })?;
        let bridge_path = self.bridge_path();
        let bridge_text = bridge_path.display().to_string();
        let inspection = inspect_claude_hooks(&content, &bridge_text)?;
        if action == ClaudeIntegrationAction::Uninstall && inspection.marked_handlers == 0 {
            return Err(ClaudeIntegrationError::Invalid(
                "未找到可由 CodePulse 卸载的 Claude Hook 标记".to_string(),
            ));
        }
        if action == ClaudeIntegrationAction::InstallOrRepair {
            let cli = (self.cli_probe)(&self.paths.cli_executable);
            if cli.status != ClaudeCliStatus::Ready {
                return Err(ClaudeIntegrationError::Invalid(format!(
                    "需要 Windows 原生 Claude Code CLI {MINIMUM_CLAUDE_VERSION} 或更高版本"
                )));
            }
            if value.get("allowManagedHooksOnly").and_then(Value::as_bool).unwrap_or(false) {
                return Err(ClaudeIntegrationError::Invalid(
                    "allowManagedHooksOnly 明确阻止用户 Hook 安装".to_string(),
                ));
            }
            let metadata = fs::metadata(&self.paths.bridge_source)?;
            if !metadata.is_file() || metadata.len() == 0 {
                return Err(ClaudeIntegrationError::Invalid(
                    "发布 Bridge 不可用".to_string(),
                ));
            }
        }

        let id = uuid::Uuid::new_v4().to_string();
        self.previews.lock().expect("Claude 集成预览锁不应中毒").insert(
            id.clone(),
            PendingPreview {
                action,
                target_path: target_path.clone(),
                digest: configuration_digest(&target_path)?,
            },
        );
        let changes = match action {
            ClaudeIntegrationAction::InstallOrRepair => vec![
                "仅新增或修复带 codepulse-claude-v1 参数的 Hook 处理器".to_string(),
                "保留其他 Hook、权限、环境变量、插件与 statusLine".to_string(),
            ],
            ClaudeIntegrationAction::Uninstall => {
                vec!["仅移除带 codepulse-claude-v1 参数的 Hook 处理器".to_string()]
            }
        };
        let warnings = value
            .get("disableAllHooks")
            .and_then(Value::as_bool)
            .filter(|enabled| *enabled)
            .map(|_| vec!["disableAllHooks 已启用；CodePulse 不会修改该设置".to_string()])
            .unwrap_or_default();
        Ok(ClaudeIntegrationPreview {
            id,
            action,
            target_file: target_path.display().to_string(),
            bridge_file: bridge_text,
            changes,
            warnings,
            can_confirm: true,
        })
    }

    pub fn confirm(
        &self,
        preview_id: &str,
    ) -> Result<ClaudeIntegrationActionResult, ClaudeIntegrationError> {
        let pending = self
            .previews
            .lock()
            .expect("Claude 集成预览锁不应中毒")
            .remove(preview_id)
            .ok_or(ClaudeIntegrationError::PreviewNotFound)?;
        if configuration_digest(&pending.target_path)? != pending.digest {
            return Err(ClaudeIntegrationError::ConfigurationChanged);
        }
        let content = read_settings(&pending.target_path)?;
        let bridge_path = self.bridge_path();
        let bridge_text = bridge_path.display().to_string();
        let mutation = match pending.action {
            ClaudeIntegrationAction::InstallOrRepair => ClaudeHookMutation::InstallOrRepair,
            ClaudeIntegrationAction::Uninstall => ClaudeHookMutation::Uninstall,
        };
        let updated = apply_claude_hook_mutation(&content, &bridge_text, mutation)?;

        if pending.action == ClaudeIntegrationAction::InstallOrRepair {
            let verifier = self.bridge_verifier.clone();
            install_bridge(&self.paths.bridge_source, &bridge_path, move |path| {
                verifier(path)
            })?;
        }
        let backup_file = write_json_configuration_atomically(&pending.target_path, &updated)?;
        let bridge_cleanup_pending = if pending.action == ClaudeIntegrationAction::Uninstall {
            remove_unreferenced_bridge(&updated, &bridge_path)
        } else {
            false
        };
        Ok(ClaudeIntegrationActionResult {
            action: pending.action,
            backup_file,
            bridge_cleanup_pending,
            listener_start_failed: false,
        })
    }

    pub fn app_data_dir(&self) -> &Path {
        &self.paths.app_data_dir
    }

    pub fn should_start_listener(&self) -> bool {
        self.check().hook == ClaudeHookStatus::Installed
    }

    fn bridge_path(&self) -> PathBuf {
        self.paths.app_data_dir.join(CLAUDE_BRIDGE_FILE_NAME)
    }
}

pub fn resolve_bridge_source(resource_dir: Option<&Path>) -> PathBuf {
    if let Some(resource_dir) = resource_dir {
        let candidate = resource_dir.join(CLAUDE_BRIDGE_FILE_NAME);
        if candidate.is_file() {
            return candidate;
        }
    }
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.join(CLAUDE_BRIDGE_FILE_NAME)))
        .unwrap_or_else(|| PathBuf::from(CLAUDE_BRIDGE_FILE_NAME))
}

fn read_settings(path: &Path) -> Result<String, ClaudeIntegrationError> {
    if !path.exists() {
        return Ok("{}\n".to_string());
    }
    if !path.is_file() {
        return Err(ClaudeIntegrationError::Invalid(
            "settings.json 不是普通文件".to_string(),
        ));
    }
    Ok(fs::read_to_string(path)?)
}

fn inspect_bridge(source: &Path, target: &Path) -> ClaudeBridgeStatus {
    if !target.is_file() {
        return ClaudeBridgeStatus::Missing;
    }
    match bridge_matches_source(source, target) {
        Ok(true) => ClaudeBridgeStatus::Ready,
        Ok(false) | Err(_) => ClaudeBridgeStatus::NeedsRepair,
    }
}

fn inspect_cli(path: &Path) -> CliInspection {
    if !path.is_file() {
        return CliInspection {
            status: ClaudeCliStatus::Missing,
            version: None,
        };
    }
    let output = Command::new(path).arg("--version").output();
    let Ok(output) = output else {
        return CliInspection {
            status: ClaudeCliStatus::Missing,
            version: None,
        };
    };
    let text = format!(
        "{} {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let version = Regex::new(r"\d+\.\d+\.\d+")
        .expect("Claude 版本正则必须有效")
        .find(&text)
        .map(|value| value.as_str().to_string());
    match version {
        Some(version) => CliInspection {
            status: if output.status.success() && version_is_supported(&version) {
                ClaudeCliStatus::Ready
            } else {
                ClaudeCliStatus::Unsupported
            },
            version: Some(version),
        },
        None => CliInspection {
            status: ClaudeCliStatus::Unsupported,
            version: None,
        },
    }
}

fn version_is_supported(version: &str) -> bool {
    parse_version(version).is_some_and(|version| version >= (2, 1, 221))
}

fn parse_version(version: &str) -> Option<(u64, u64, u64)> {
    let mut parts = version.split('.');
    let parsed = (
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
    );
    parts.next().is_none().then_some(parsed)
}

fn resolve_cli_from_path() -> Option<PathBuf> {
    std::env::var_os("PATH").and_then(|path| {
        std::env::split_paths(&path)
            .map(|directory| directory.join("claude.exe"))
            .find(|candidate| candidate.is_file())
    })
}

fn remove_unreferenced_bridge(updated_settings: &str, bridge_path: &Path) -> bool {
    let bridge_text = bridge_path.display().to_string();
    if serde_json::from_str::<Value>(updated_settings)
        .map(|value| json_references_text(&value, &bridge_text))
        .unwrap_or(true)
    {
        return false;
    }
    match fs::remove_file(bridge_path) {
        Ok(()) => false,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(_) => true,
    }
}

fn json_references_text(value: &Value, text: &str) -> bool {
    match value {
        Value::String(value) => value == text,
        Value::Array(values) => values.iter().any(|value| json_references_text(value, text)),
        Value::Object(values) => values.values().any(|value| json_references_text(value, text)),
        Value::Null | Value::Bool(_) | Value::Number(_) => false,
    }
}

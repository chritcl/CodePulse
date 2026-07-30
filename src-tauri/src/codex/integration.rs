use std::collections::HashMap;
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use toml_edit::{DocumentMut, Item, Value as TomlValue};

use super::bridge_install::{
    bridge_matches_source, bridge_target_path, install_bridge, verify_bridge_minimally,
    BridgeInstallError,
};
use super::config::{
    apply_codepulse_hook_mutation, ConfigError, HookConfigFormat, HookMutation,
    CODEPULSE_HOOK_EVENTS, CODEPULSE_HOOK_MARKER, CODEPULSE_HOOK_TIMEOUT_SECONDS,
};

static NEXT_TEMP_FILE_ID: AtomicUsize = AtomicUsize::new(0);

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

#[derive(Debug)]
struct ConfigCandidate {
    representation: SelectedConfigRepresentation,
    path: PathBuf,
    exists: bool,
    inspection: HookInspection,
    invalid_reason: Option<String>,
}

#[derive(Debug, Default, Clone)]
struct HookInspection {
    marked_handlers: usize,
    valid_handlers: usize,
    valid_events: HashMap<String, usize>,
}

#[derive(Debug, Clone)]
struct PendingPreview {
    action: IntegrationAction,
    representation: SelectedConfigRepresentation,
    target_path: PathBuf,
    digest: Option<[u8; 32]>,
}

impl HookInspection {
    fn is_correct(&self) -> bool {
        self.marked_handlers == CODEPULSE_HOOK_EVENTS.len()
            && self.valid_handlers == CODEPULSE_HOOK_EVENTS.len()
            && CODEPULSE_HOOK_EVENTS
                .iter()
                .all(|event| self.valid_events.get(*event) == Some(&1))
    }
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

enum CandidateSelection<'a> {
    Candidate(&'a ConfigCandidate),
    Invalid(String),
    Ambiguous,
}

fn inspect_candidate(
    representation: SelectedConfigRepresentation,
    path: PathBuf,
    expected_command: &str,
) -> ConfigCandidate {
    if !path.exists() {
        return ConfigCandidate {
            representation,
            path,
            exists: false,
            inspection: HookInspection::default(),
            invalid_reason: None,
        };
    }

    let inspected = fs::read_to_string(&path)
        .map_err(|error| format!("无法读取 {}: {error}", path.display()))
        .and_then(|content| match representation {
            SelectedConfigRepresentation::HooksJson => {
                inspect_json_hooks(&content, expected_command)
            }
            SelectedConfigRepresentation::ConfigToml => {
                inspect_toml_hooks(&content, expected_command)
            }
            SelectedConfigRepresentation::Ambiguous | SelectedConfigRepresentation::Invalid => {
                Err("无效的配置表示".to_string())
            }
        });

    match inspected {
        Ok(inspection) => ConfigCandidate {
            representation,
            path,
            exists: true,
            inspection,
            invalid_reason: None,
        },
        Err(reason) => ConfigCandidate {
            representation,
            path,
            exists: true,
            inspection: HookInspection::default(),
            invalid_reason: Some(reason),
        },
    }
}

fn select_candidate<'a>(
    hooks_json: &'a ConfigCandidate,
    config_toml: &'a ConfigCandidate,
) -> CandidateSelection<'a> {
    if let Some(reason) = hooks_json.invalid_reason.as_ref().or(config_toml.invalid_reason.as_ref())
    {
        return CandidateSelection::Invalid(reason.clone());
    }

    let json_has_marker = hooks_json.inspection.marked_handlers > 0;
    let toml_has_marker = config_toml.inspection.marked_handlers > 0;
    if json_has_marker && toml_has_marker {
        return CandidateSelection::Ambiguous;
    }
    if json_has_marker {
        return CandidateSelection::Candidate(hooks_json);
    }
    if toml_has_marker {
        return CandidateSelection::Candidate(config_toml);
    }
    if hooks_json.exists && config_toml.exists {
        return CandidateSelection::Ambiguous;
    }
    if hooks_json.exists {
        return CandidateSelection::Candidate(hooks_json);
    }
    if config_toml.exists {
        return CandidateSelection::Candidate(config_toml);
    }

    CandidateSelection::Candidate(hooks_json)
}

fn inspect_global_hooks(config_toml: &ConfigCandidate) -> GlobalHooksStatus {
    if !config_toml.exists || config_toml.invalid_reason.is_some() {
        return GlobalHooksStatus::ManualEnablementRequired;
    }
    let Ok(content) = fs::read_to_string(&config_toml.path) else {
        return GlobalHooksStatus::ManualEnablementRequired;
    };
    let Ok(document) = content.parse::<DocumentMut>() else {
        return GlobalHooksStatus::ManualEnablementRequired;
    };
    let Some(features) = document["features"].as_table() else {
        return GlobalHooksStatus::ManualEnablementRequired;
    };
    let enabled = features
        .get("hooks")
        .or_else(|| features.get("codex_hooks"))
        .and_then(Item::as_value)
        .and_then(TomlValue::as_bool)
        .unwrap_or(false);

    if enabled {
        GlobalHooksStatus::Enabled
    } else {
        GlobalHooksStatus::ManualEnablementRequired
    }
}

fn inspect_bridge(source_path: &Path, target_path: &Path) -> BridgeStatus {
    if !target_path.is_file() {
        return BridgeStatus::Missing;
    }

    match bridge_matches_source(source_path, target_path) {
        Ok(true) => BridgeStatus::Ready,
        Ok(false) | Err(_) => BridgeStatus::NeedsRepair,
    }
}

fn inspect_json_hooks(content: &str, expected_command: &str) -> Result<HookInspection, String> {
    let root: Value = serde_json::from_str(content).map_err(|error| error.to_string())?;
    let root = root.as_object().ok_or_else(|| "hooks.json 根节点必须是对象".to_string())?;
    let Some(hooks) = root.get("hooks") else {
        return Ok(HookInspection::default());
    };
    let hooks = hooks
        .as_object()
        .ok_or_else(|| "hooks.json 的 hooks 字段必须是对象".to_string())?;
    let mut inspection = HookInspection::default();

    for (event, groups) in hooks {
        let groups = groups.as_array().ok_or_else(|| format!("{event} Hook 必须是数组"))?;
        for group in groups {
            let handlers = group
                .as_object()
                .and_then(|group| group.get("hooks"))
                .and_then(Value::as_array)
                .ok_or_else(|| format!("{event} Hook 分组的 hooks 必须是数组"))?;
            for handler in handlers {
                if is_codepulse_json_handler(handler) {
                    inspection.marked_handlers += 1;
                    if is_valid_json_handler(handler, event, expected_command) {
                        inspection.valid_handlers += 1;
                        *inspection.valid_events.entry(event.clone()).or_default() += 1;
                    }
                }
            }
        }
    }

    Ok(inspection)
}

fn inspect_toml_hooks(content: &str, expected_command: &str) -> Result<HookInspection, String> {
    let document = content.parse::<DocumentMut>().map_err(|error| error.to_string())?;
    let Some(hooks) = document.get("hooks").and_then(Item::as_table) else {
        return Ok(HookInspection::default());
    };
    let mut inspection = HookInspection::default();

    for (event, groups) in hooks.iter() {
        if event == "state" {
            continue;
        }
        let Some(groups) = groups.as_array_of_tables() else {
            continue;
        };
        for group in groups.iter() {
            let handlers = group
                .get("hooks")
                .and_then(Item::as_value)
                .and_then(TomlValue::as_array)
                .ok_or_else(|| format!("{event} Hook 分组的 hooks 必须是数组"))?;
            for handler in handlers.iter() {
                if is_codepulse_toml_handler(handler) {
                    inspection.marked_handlers += 1;
                    if is_valid_toml_handler(handler, event, expected_command) {
                        inspection.valid_handlers += 1;
                        *inspection.valid_events.entry(event.to_string()).or_default() += 1;
                    }
                }
            }
        }
    }

    Ok(inspection)
}

fn is_codepulse_json_handler(handler: &Value) -> bool {
    handler
        .get("statusMessage")
        .and_then(Value::as_str)
        .is_some_and(|value| value == CODEPULSE_HOOK_MARKER)
}

fn is_valid_json_handler(handler: &Value, event: &str, expected_command: &str) -> bool {
    CODEPULSE_HOOK_EVENTS.contains(&event)
        && handler.get("type").and_then(Value::as_str) == Some("command")
        && handler.get("command").and_then(Value::as_str) == Some(expected_command)
        && handler.get("timeout").and_then(Value::as_i64) == Some(CODEPULSE_HOOK_TIMEOUT_SECONDS)
}

fn is_codepulse_toml_handler(handler: &TomlValue) -> bool {
    handler
        .as_inline_table()
        .and_then(|handler| handler.get("statusMessage"))
        .and_then(TomlValue::as_str)
        .is_some_and(|value| value == CODEPULSE_HOOK_MARKER)
}

fn is_valid_toml_handler(handler: &TomlValue, event: &str, expected_command: &str) -> bool {
    let Some(handler) = handler.as_inline_table() else {
        return false;
    };

    CODEPULSE_HOOK_EVENTS.contains(&event)
        && handler.get("type").and_then(TomlValue::as_str) == Some("command")
        && handler.get("command").and_then(TomlValue::as_str) == Some(expected_command)
        && handler.get("timeout").and_then(TomlValue::as_integer)
            == Some(CODEPULSE_HOOK_TIMEOUT_SECONDS)
}

pub(super) fn bridge_command(path: &Path) -> String {
    format!(r#"cmd.exe /D /S /C ""{}" --source app""#, path.display())
}

pub fn resolve_bridge_source(resource_dir: Option<&Path>) -> PathBuf {
    if let Some(resource_dir) = resource_dir {
        let candidate = resource_dir.join(super::bridge_install::CODEX_BRIDGE_FILE_NAME);
        if candidate.is_file() {
            return candidate;
        }
    }

    std::env::current_exe()
        .ok()
        .and_then(|path| {
            path.parent()
                .map(|parent| parent.join(super::bridge_install::CODEX_BRIDGE_FILE_NAME))
        })
        .unwrap_or_else(|| PathBuf::from(super::bridge_install::CODEX_BRIDGE_FILE_NAME))
}

fn configuration_digest(path: &Path) -> Result<Option<[u8; 32]>, IntegrationError> {
    if !path.exists() {
        return Ok(None);
    }
    if !path.is_file() {
        return Err(IntegrationError::Invalid(format!(
            "配置目标不是普通文件: {}",
            path.display()
        )));
    }

    let bytes = fs::read(path)?;
    Ok(Some(Sha256::digest(bytes).into()))
}

fn hook_config_format(
    representation: &SelectedConfigRepresentation,
) -> Result<HookConfigFormat, IntegrationError> {
    match representation {
        SelectedConfigRepresentation::HooksJson => Ok(HookConfigFormat::HooksJson),
        SelectedConfigRepresentation::ConfigToml => Ok(HookConfigFormat::ConfigToml),
        SelectedConfigRepresentation::Ambiguous | SelectedConfigRepresentation::Invalid => Err(
            IntegrationError::Invalid("无法安全选择 Hook 配置表示".to_string()),
        ),
    }
}

fn update_configuration(
    path: &Path,
    format: HookConfigFormat,
    bridge_command: &str,
    mutation: HookMutation,
) -> Result<Option<String>, IntegrationError> {
    let original = if path.exists() {
        fs::read_to_string(path)?
    } else {
        default_configuration_content(format).to_string()
    };
    let updated = apply_codepulse_hook_mutation(format, &original, bridge_command, mutation)?;

    write_configuration_atomically(path, format, &updated)
}

fn default_configuration_content(format: HookConfigFormat) -> &'static str {
    match format {
        HookConfigFormat::HooksJson => "{\n  \"hooks\": {}\n}\n",
        HookConfigFormat::ConfigToml => "",
    }
}

fn write_configuration_atomically(
    path: &Path,
    format: HookConfigFormat,
    content: &str,
) -> Result<Option<String>, IntegrationError> {
    validate_configuration_content(format, content)?;
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| IntegrationError::Invalid("配置缺少父目录".to_string()))?;
    fs::create_dir_all(parent)?;
    if path.exists() && !path.is_file() {
        return Err(IntegrationError::Invalid(
            "配置目标不是普通文件".to_string(),
        ));
    }

    let backup = if path.exists() {
        let backup_path = backup_path(path)?;
        copy_file_with_sync(path, &backup_path)?;
        backup_path.file_name().and_then(|name| name.to_str()).map(ToString::to_string)
    } else {
        None
    };
    let temporary_path = temporary_configuration_path(path)?;
    let result = write_configuration_file(&temporary_path, content)
        .and_then(|_| {
            let temporary_content = fs::read_to_string(&temporary_path)?;
            validate_configuration_content(format, &temporary_content)
        })
        .and_then(|_| replace_configuration_file_atomically(&temporary_path, path));

    if result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    result?;

    Ok(backup)
}

fn validate_configuration_content(
    format: HookConfigFormat,
    content: &str,
) -> Result<(), IntegrationError> {
    match format {
        HookConfigFormat::HooksJson => {
            serde_json::from_str::<Value>(content).map_err(|error| {
                IntegrationError::Invalid(format!("hooks.json 校验失败: {error}"))
            })?;
        }
        HookConfigFormat::ConfigToml => {
            content.parse::<DocumentMut>().map_err(|error| {
                IntegrationError::Invalid(format!("config.toml 校验失败: {error}"))
            })?;
        }
    }
    Ok(())
}

fn backup_path(path: &Path) -> Result<PathBuf, IntegrationError> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| IntegrationError::Invalid("配置缺少父目录".to_string()))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| IntegrationError::Invalid("配置文件名无效".to_string()))?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();

    for suffix in 0_u32.. {
        let suffix = if suffix == 0 {
            String::new()
        } else {
            format!("-{suffix}")
        };
        let backup = parent.join(format!("{file_name}.codepulse-{timestamp}{suffix}.bak"));
        if !backup.exists() {
            return Ok(backup);
        }
    }

    unreachable!("备份文件序号应始终可用")
}

fn temporary_configuration_path(path: &Path) -> Result<PathBuf, IntegrationError> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| IntegrationError::Invalid("配置缺少父目录".to_string()))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| IntegrationError::Invalid("配置文件名无效".to_string()))?;
    let suffix = NEXT_TEMP_FILE_ID.fetch_add(1, Ordering::Relaxed);

    Ok(parent.join(format!(
        ".{file_name}.codepulse-{}-{suffix}.tmp",
        std::process::id()
    )))
}

fn copy_file_with_sync(source_path: &Path, target_path: &Path) -> Result<(), IntegrationError> {
    let mut source = File::open(source_path)?;
    let mut target = OpenOptions::new().write(true).create_new(true).open(target_path)?;
    io::copy(&mut source, &mut target)?;
    target.flush()?;
    target.sync_all()?;
    Ok(())
}

fn write_configuration_file(path: &Path, content: &str) -> Result<(), IntegrationError> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    file.write_all(content.as_bytes())?;
    file.sync_all()?;
    Ok(())
}

fn remove_unreferenced_bridge(codex_home: &Path, bridge_path: &Path) -> bool {
    let bridge_reference = bridge_path.display().to_string();
    for (name, format) in [
        ("hooks.json", HookConfigFormat::HooksJson),
        ("config.toml", HookConfigFormat::ConfigToml),
    ] {
        let path = codex_home.join(name);
        if !path.exists() {
            continue;
        }
        if !path.is_file() {
            return true;
        }
        let Ok(content) = fs::read_to_string(path) else {
            return true;
        };
        if configuration_references_bridge(format, &content, &bridge_reference) {
            return false;
        }
    }

    match fs::remove_file(bridge_path) {
        Ok(()) => false,
        Err(error) if error.kind() == io::ErrorKind::NotFound => false,
        Err(_) => true,
    }
}

fn configuration_references_bridge(
    format: HookConfigFormat,
    content: &str,
    bridge_reference: &str,
) -> bool {
    match format {
        HookConfigFormat::HooksJson => serde_json::from_str::<Value>(content)
            .map(|value| json_value_references_bridge(&value, bridge_reference))
            .unwrap_or(true),
        HookConfigFormat::ConfigToml => content
            .parse::<DocumentMut>()
            .map(|document| toml_document_references_bridge(&document, bridge_reference))
            .unwrap_or(true),
    }
}

fn json_value_references_bridge(value: &Value, bridge_reference: &str) -> bool {
    match value {
        Value::String(text) => text.contains(bridge_reference),
        Value::Array(items) => {
            items.iter().any(|item| json_value_references_bridge(item, bridge_reference))
        }
        Value::Object(entries) => entries
            .values()
            .any(|item| json_value_references_bridge(item, bridge_reference)),
        Value::Null | Value::Bool(_) | Value::Number(_) => false,
    }
}

fn toml_document_references_bridge(document: &DocumentMut, bridge_reference: &str) -> bool {
    document
        .iter()
        .any(|(_, item)| toml_item_references_bridge(item, bridge_reference))
}

fn toml_item_references_bridge(item: &Item, bridge_reference: &str) -> bool {
    match item {
        Item::None => false,
        Item::Value(value) => toml_value_references_bridge(value, bridge_reference),
        Item::Table(table) => table
            .iter()
            .any(|(_, value)| toml_item_references_bridge(value, bridge_reference)),
        Item::ArrayOfTables(tables) => tables.iter().any(|table| {
            table
                .iter()
                .any(|(_, value)| toml_item_references_bridge(value, bridge_reference))
        }),
    }
}

fn toml_value_references_bridge(value: &TomlValue, bridge_reference: &str) -> bool {
    value.as_str().is_some_and(|text| text.contains(bridge_reference))
        || value.as_array().is_some_and(|values| {
            values.iter().any(|value| toml_value_references_bridge(value, bridge_reference))
        })
        || value.as_inline_table().is_some_and(|table| {
            table
                .iter()
                .any(|(_, value)| toml_value_references_bridge(value, bridge_reference))
        })
}

#[cfg(target_os = "windows")]
fn replace_configuration_file_atomically(from: &Path, to: &Path) -> Result<(), IntegrationError> {
    use std::os::windows::ffi::OsStrExt;

    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let from = from.as_os_str().encode_wide().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let to = to.as_os_str().encode_wide().chain(std::iter::once(0)).collect::<Vec<u16>>();

    // 安全性：两个 UTF-16 缓冲区在调用期间保持存活且以 NUL 结尾，路径均由本函数的 Path 参数提供。
    unsafe {
        MoveFileExW(
            PCWSTR::from_raw(from.as_ptr()),
            PCWSTR::from_raw(to.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    }
    .map_err(|error| IntegrationError::Io(io::Error::other(error.to_string())))
}

#[cfg(not(target_os = "windows"))]
fn replace_configuration_file_atomically(from: &Path, to: &Path) -> Result<(), IntegrationError> {
    fs::rename(from, to)?;
    Ok(())
}

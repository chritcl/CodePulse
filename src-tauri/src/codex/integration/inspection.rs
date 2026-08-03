use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;
use toml_edit::{DocumentMut, Item, Value as TomlValue};

use super::super::bridge_install::{bridge_matches_source, CODEX_BRIDGE_FILE_NAME};
use super::super::config::{
    CODEPULSE_HOOK_EVENTS, CODEPULSE_HOOK_MARKER, CODEPULSE_HOOK_TIMEOUT_SECONDS,
};
use super::{BridgeStatus, GlobalHooksStatus, SelectedConfigRepresentation};

#[derive(Debug)]
pub(super) struct ConfigCandidate {
    pub(super) representation: SelectedConfigRepresentation,
    pub(super) path: PathBuf,
    pub(super) exists: bool,
    pub(super) inspection: HookInspection,
    pub(super) invalid_reason: Option<String>,
}

#[derive(Debug, Default, Clone)]
pub(super) struct HookInspection {
    pub(super) marked_handlers: usize,
    pub(super) valid_handlers: usize,
    pub(super) valid_events: HashMap<String, usize>,
}

impl HookInspection {
    pub(super) fn is_correct(&self) -> bool {
        self.marked_handlers == CODEPULSE_HOOK_EVENTS.len()
            && self.valid_handlers == CODEPULSE_HOOK_EVENTS.len()
            && CODEPULSE_HOOK_EVENTS
                .iter()
                .all(|event| self.valid_events.get(*event) == Some(&1))
    }
}

pub(super) enum CandidateSelection<'a> {
    Candidate(&'a ConfigCandidate),
    Invalid(String),
    Ambiguous,
}

pub(super) fn inspect_candidate(
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

pub(super) fn select_candidate<'a>(
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

pub(super) fn inspect_global_hooks(config_toml: &ConfigCandidate) -> GlobalHooksStatus {
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

pub(super) fn inspect_bridge(source_path: &Path, target_path: &Path) -> BridgeStatus {
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

pub(in crate::codex) fn bridge_command(path: &Path) -> String {
    format!(r#"cmd.exe /D /S /C ""{}" --source app""#, path.display())
}

pub fn resolve_bridge_source(resource_dir: Option<&Path>) -> PathBuf {
    if let Some(resource_dir) = resource_dir {
        let candidate = resource_dir.join(CODEX_BRIDGE_FILE_NAME);
        if candidate.is_file() {
            return candidate;
        }
    }

    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.join(CODEX_BRIDGE_FILE_NAME)))
        .unwrap_or_else(|| PathBuf::from(CODEX_BRIDGE_FILE_NAME))
}

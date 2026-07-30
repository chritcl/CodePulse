use std::fmt;

use serde_json::{json, Map, Value};
use toml_edit::{Array, ArrayOfTables, DocumentMut, InlineTable, Item, Table, Value as TomlValue};

pub const CODEPULSE_HOOK_MARKER: &str = "CodePulse Codex 状态岛";
pub const CODEPULSE_HOOK_TIMEOUT_SECONDS: i64 = 3;
pub const CODEPULSE_HOOK_EVENTS: [&str; 7] = [
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PermissionRequest",
    "Stop",
    "SessionEnd",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HookConfigFormat {
    HooksJson,
    ConfigToml,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HookMutation {
    InstallOrRepair,
    Uninstall,
}

#[derive(Debug)]
pub struct ConfigError(String);

impl ConfigError {
    fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

impl fmt::Display for ConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for ConfigError {}

pub fn apply_codepulse_hook_mutation(
    format: HookConfigFormat,
    content: &str,
    bridge_command: &str,
    mutation: HookMutation,
) -> Result<String, ConfigError> {
    match format {
        HookConfigFormat::HooksJson => apply_json_mutation(content, bridge_command, mutation),
        HookConfigFormat::ConfigToml => apply_toml_mutation(content, bridge_command, mutation),
    }
}

fn apply_toml_mutation(
    content: &str,
    bridge_command: &str,
    mutation: HookMutation,
) -> Result<String, ConfigError> {
    let mut document = content
        .parse::<DocumentMut>()
        .map_err(|error| ConfigError::new(format!("config.toml 解析失败: {error}")))?;
    let hooks = toml_hooks_table(&mut document)?;

    remove_marked_toml_handlers(hooks)?;

    if mutation == HookMutation::InstallOrRepair {
        for event in CODEPULSE_HOOK_EVENTS {
            let groups = toml_hook_groups(hooks, event)?;
            let mut group = Table::new();
            let mut handlers = Array::new();
            let mut handler = InlineTable::new();
            handler.insert("type", TomlValue::from("command"));
            handler.insert("command", TomlValue::from(bridge_command));
            handler.insert("timeout", TomlValue::from(CODEPULSE_HOOK_TIMEOUT_SECONDS));
            handler.insert("statusMessage", TomlValue::from(CODEPULSE_HOOK_MARKER));
            handlers.push(TomlValue::InlineTable(handler));
            group.insert("hooks", Item::Value(TomlValue::Array(handlers)));
            groups.push(group);
        }
    }

    let serialized = document.to_string();
    Ok(if serialized.ends_with('\n') {
        serialized
    } else {
        format!("{serialized}\n")
    })
}

fn apply_json_mutation(
    content: &str,
    bridge_command: &str,
    mutation: HookMutation,
) -> Result<String, ConfigError> {
    let mut root: Value = serde_json::from_str(content)
        .map_err(|error| ConfigError::new(format!("hooks.json 解析失败: {error}")))?;
    let root = root
        .as_object_mut()
        .ok_or_else(|| ConfigError::new("hooks.json 根节点必须是对象"))?;
    let hooks = hooks_object(root)?;

    remove_marked_json_handlers(hooks)?;

    if mutation == HookMutation::InstallOrRepair {
        for event in CODEPULSE_HOOK_EVENTS {
            let groups = hooks
                .entry(event.to_string())
                .or_insert_with(|| Value::Array(Vec::new()))
                .as_array_mut()
                .ok_or_else(|| ConfigError::new(format!("{event} Hook 必须是数组")))?;
            groups.push(json!({
                "hooks": [
                    {
                        "type": "command",
                        "command": bridge_command,
                        "timeout": CODEPULSE_HOOK_TIMEOUT_SECONDS,
                        "statusMessage": CODEPULSE_HOOK_MARKER
                    }
                ]
            }));
        }
    }

    serde_json::to_string_pretty(&Value::Object(root.clone()))
        .map(|serialized| format!("{serialized}\n"))
        .map_err(|error| ConfigError::new(format!("hooks.json 序列化失败: {error}")))
}

fn hooks_object(root: &mut Map<String, Value>) -> Result<&mut Map<String, Value>, ConfigError> {
    let hooks = root.entry("hooks".to_string()).or_insert_with(|| Value::Object(Map::new()));
    hooks
        .as_object_mut()
        .ok_or_else(|| ConfigError::new("hooks.json 的 hooks 字段必须是对象"))
}

fn remove_marked_json_handlers(hooks: &mut Map<String, Value>) -> Result<(), ConfigError> {
    for (event, groups) in hooks {
        let groups = groups
            .as_array_mut()
            .ok_or_else(|| ConfigError::new(format!("{event} Hook 必须是数组")))?;
        let mut group_index = 0;

        while group_index < groups.len() {
            let group = groups[group_index]
                .as_object_mut()
                .ok_or_else(|| ConfigError::new(format!("{event} Hook 分组必须是对象")))?;
            let handlers = group
                .get_mut("hooks")
                .ok_or_else(|| ConfigError::new(format!("{event} Hook 分组缺少 hooks 字段")))?
                .as_array_mut()
                .ok_or_else(|| ConfigError::new(format!("{event} Hook 分组的 hooks 必须是数组")))?;
            handlers.retain(|handler| !is_codepulse_json_handler(handler));

            if handlers.is_empty() {
                groups.remove(group_index);
            } else {
                group_index += 1;
            }
        }
    }

    Ok(())
}

fn is_codepulse_json_handler(handler: &Value) -> bool {
    handler
        .get("statusMessage")
        .and_then(Value::as_str)
        .is_some_and(|value| value == CODEPULSE_HOOK_MARKER)
}

fn toml_hooks_table(document: &mut DocumentMut) -> Result<&mut Table, ConfigError> {
    if document.get("hooks").is_none() {
        document["hooks"] = Item::Table(Table::new());
    }

    document["hooks"]
        .as_table_mut()
        .ok_or_else(|| ConfigError::new("config.toml 的 hooks 字段必须是表"))
}

fn toml_hook_groups<'a>(
    hooks: &'a mut Table,
    event: &str,
) -> Result<&'a mut ArrayOfTables, ConfigError> {
    if hooks.get(event).is_none() {
        hooks.insert(event, Item::ArrayOfTables(ArrayOfTables::new()));
    }

    hooks
        .get_mut(event)
        .and_then(Item::as_array_of_tables_mut)
        .ok_or_else(|| ConfigError::new(format!("{event} Hook 必须是表数组")))
}

fn remove_marked_toml_handlers(hooks: &mut Table) -> Result<(), ConfigError> {
    for event in CODEPULSE_HOOK_EVENTS {
        let Some(groups) = hooks.get_mut(event) else {
            continue;
        };
        let groups = groups
            .as_array_of_tables_mut()
            .ok_or_else(|| ConfigError::new(format!("{event} Hook 必须是表数组")))?;
        let mut group_index = 0;

        while group_index < groups.len() {
            let group = groups
                .get_mut(group_index)
                .ok_or_else(|| ConfigError::new(format!("{event} Hook 分组不存在")))?;
            let handlers = group
                .get_mut("hooks")
                .and_then(Item::as_value_mut)
                .and_then(TomlValue::as_array_mut)
                .ok_or_else(|| ConfigError::new(format!("{event} Hook 分组的 hooks 必须是数组")))?;
            let mut handler_index = 0;

            while handler_index < handlers.len() {
                let handler = handlers
                    .get(handler_index)
                    .ok_or_else(|| ConfigError::new(format!("{event} Hook 处理器不存在")))?;
                if is_codepulse_toml_handler(handler) {
                    handlers.remove(handler_index);
                } else {
                    handler_index += 1;
                }
            }

            if handlers.is_empty() {
                groups.remove(group_index);
            } else {
                group_index += 1;
            }
        }
    }

    Ok(())
}

fn is_codepulse_toml_handler(handler: &TomlValue) -> bool {
    handler
        .as_inline_table()
        .and_then(|handler| handler.get("statusMessage"))
        .and_then(TomlValue::as_str)
        .is_some_and(|value| value == CODEPULSE_HOOK_MARKER)
}

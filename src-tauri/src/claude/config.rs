use std::collections::HashSet;
use std::fmt;

use serde_json::{json, Map, Value};

pub const CLAUDE_HOOK_MARKER: &str = "codepulse-claude-v1";
pub const CLAUDE_HOOK_TIMEOUT_SECONDS: i64 = 2;
pub const CLAUDE_HOOK_EVENTS: [&str; 17] = [
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "PermissionRequest",
    "SubagentStart",
    "SubagentStop",
    "TaskCreated",
    "TaskCompleted",
    "Stop",
    "StopFailure",
    "SessionEnd",
    "PreCompact",
    "PostCompact",
    "Elicitation",
    "ElicitationResult",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClaudeHookMutation {
    InstallOrRepair,
    Uninstall,
}

#[derive(Debug)]
pub struct ClaudeConfigError(String);

impl ClaudeConfigError {
    fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

impl fmt::Display for ClaudeConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for ClaudeConfigError {}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ClaudeHookInspection {
    pub marked_handlers: usize,
    pub valid_handlers: usize,
    valid_events: HashSet<String>,
}

impl ClaudeHookInspection {
    pub fn is_correct(&self) -> bool {
        self.marked_handlers == CLAUDE_HOOK_EVENTS.len()
            && self.valid_handlers == CLAUDE_HOOK_EVENTS.len()
            && self.valid_events.len() == CLAUDE_HOOK_EVENTS.len()
    }
}

pub fn apply_claude_hook_mutation(
    content: &str,
    bridge_path: &str,
    mutation: ClaudeHookMutation,
) -> Result<String, ClaudeConfigError> {
    let mut root: Value = serde_json::from_str(content)
        .map_err(|error| ClaudeConfigError::new(format!("settings.json 解析失败: {error}")))?;
    let root = root
        .as_object_mut()
        .ok_or_else(|| ClaudeConfigError::new("settings.json 根节点必须是对象"))?;
    let hooks = hooks_object(root)?;

    remove_marked_handlers(hooks)?;
    if mutation == ClaudeHookMutation::InstallOrRepair {
        for event in CLAUDE_HOOK_EVENTS {
            let groups = hooks
                .entry(event.to_string())
                .or_insert_with(|| Value::Array(Vec::new()))
                .as_array_mut()
                .ok_or_else(|| ClaudeConfigError::new(format!("{event} Hook 必须是数组")))?;
            groups.push(json!({
                "hooks": [{
                    "type": "command",
                    "command": bridge_path,
                    "args": [CLAUDE_HOOK_MARKER],
                    "timeout": CLAUDE_HOOK_TIMEOUT_SECONDS
                }]
            }));
        }
    }

    serde_json::to_string_pretty(&Value::Object(root.clone()))
        .map(|serialized| format!("{serialized}\n"))
        .map_err(|error| ClaudeConfigError::new(format!("settings.json 序列化失败: {error}")))
}

pub fn inspect_claude_hooks(
    content: &str,
    bridge_path: &str,
) -> Result<ClaudeHookInspection, ClaudeConfigError> {
    let root: Value = serde_json::from_str(content)
        .map_err(|error| ClaudeConfigError::new(format!("settings.json 解析失败: {error}")))?;
    let hooks = root
        .get("hooks")
        .map(|value| {
            value
                .as_object()
                .ok_or_else(|| ClaudeConfigError::new("settings.json 的 hooks 字段必须是对象"))
        })
        .transpose()?;
    let mut inspection = ClaudeHookInspection::default();
    let Some(hooks) = hooks else {
        return Ok(inspection);
    };

    for (event, groups) in hooks {
        let groups = groups
            .as_array()
            .ok_or_else(|| ClaudeConfigError::new(format!("{event} Hook 必须是数组")))?;
        for group in groups {
            let handlers = group.get("hooks").and_then(Value::as_array).ok_or_else(|| {
                ClaudeConfigError::new(format!("{event} Hook 分组的 hooks 必须是数组"))
            })?;
            for handler in handlers {
                if !is_codepulse_handler(handler) {
                    continue;
                }
                inspection.marked_handlers += 1;
                if CLAUDE_HOOK_EVENTS.contains(&event.as_str())
                    && handler.get("type").and_then(Value::as_str) == Some("command")
                    && handler.get("command").and_then(Value::as_str) == Some(bridge_path)
                    && handler.get("timeout").and_then(Value::as_i64)
                        == Some(CLAUDE_HOOK_TIMEOUT_SECONDS)
                    && handler.get("args").and_then(Value::as_array).is_some_and(|args| {
                        args.len() == 1 && args[0].as_str() == Some(CLAUDE_HOOK_MARKER)
                    })
                {
                    inspection.valid_handlers += 1;
                    inspection.valid_events.insert(event.clone());
                }
            }
        }
    }
    Ok(inspection)
}

fn hooks_object(
    root: &mut Map<String, Value>,
) -> Result<&mut Map<String, Value>, ClaudeConfigError> {
    root.entry("hooks".to_string())
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .ok_or_else(|| ClaudeConfigError::new("settings.json 的 hooks 字段必须是对象"))
}

fn remove_marked_handlers(hooks: &mut Map<String, Value>) -> Result<(), ClaudeConfigError> {
    let events = hooks.keys().cloned().collect::<Vec<_>>();
    for event in events {
        let groups = hooks
            .get_mut(&event)
            .and_then(Value::as_array_mut)
            .ok_or_else(|| ClaudeConfigError::new(format!("{event} Hook 必须是数组")))?;
        let mut group_index = 0;
        while group_index < groups.len() {
            let handlers =
                groups[group_index].get_mut("hooks").and_then(Value::as_array_mut).ok_or_else(
                    || ClaudeConfigError::new(format!("{event} Hook 分组的 hooks 必须是数组")),
                )?;
            handlers.retain(|handler| !is_codepulse_handler(handler));
            if handlers.is_empty() {
                groups.remove(group_index);
            } else {
                group_index += 1;
            }
        }
        if groups.is_empty() {
            hooks.remove(&event);
        }
    }
    Ok(())
}

fn is_codepulse_handler(handler: &Value) -> bool {
    handler.get("args").and_then(Value::as_array).is_some_and(|args| {
        args.iter().any(|argument| argument.as_str() == Some(CLAUDE_HOOK_MARKER))
    })
}

use std::sync::LazyLock;

use regex::Regex;
use serde::{Deserialize, Serialize};

pub const MAX_EVENT_ID_CHARS: usize = 128;
pub const MAX_SESSION_ID_CHARS: usize = 128;
pub const MAX_CHILD_ID_CHARS: usize = 128;
pub const MAX_PROJECT_NAME_CHARS: usize = 80;
pub const MAX_SUMMARY_CHARS: usize = 160;

static ASSIGNED_SECRET: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)(?:api[_-]?key|token|secret|password|authorization)\s*(?:=|:)\s*(?:bearer\s+)?[^\s,;]+",
    )
    .expect("敏感字段正则必须有效")
});
static BEARER_SECRET: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\bbearer\s+[a-z0-9._~+/=-]{8,}").expect("Bearer 正则必须有效")
});
static KEY_LIKE_SECRET: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}").expect("密钥前缀正则必须有效"));

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentProvider {
    #[default]
    Codex,
    Claude,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentEventType {
    SessionStarted,
    TurnStarted,
    ToolStarted,
    ToolFinished,
    ContextCompactionStarted,
    ContextCompactionFinished,
    PermissionRequested,
    InputRequested,
    InputResolved,
    ChildStarted,
    ChildStopped,
    TurnStopped,
    SessionEnded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentTaskPhase {
    Analyzing,
    Reading,
    Editing,
    RunningCommand,
    RunningTests,
    WaitingInput,
    Browsing,
    Generating,
    Delegating,
    Waiting,
    Compacting,
    WaitingApproval,
    Completed,
    Failed,
    Interrupted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentListenerStatus {
    Stopped,
    WaitingForEvent,
    Running,
    Failed,
}

pub fn validate_identifier(value: &str, limit: usize) -> bool {
    !value.trim().is_empty()
        && value.chars().count() <= limit
        && !value.chars().any(char::is_control)
}

pub fn sanitize_optional_text(value: Option<String>, limit: usize) -> Option<String> {
    let value = value?;
    let normalized = value
        .chars()
        .map(|character| {
            if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect::<String>();
    let normalized = normalized.split_whitespace().collect::<Vec<_>>().join(" ");
    let value = ASSIGNED_SECRET.replace_all(&normalized, "[已隐藏]");
    let value = BEARER_SECRET.replace_all(&value, "[已隐藏]");
    let value = KEY_LIKE_SECRET.replace_all(&value, "[已隐藏]");
    let truncated = value.chars().take(limit).collect::<String>();

    (!truncated.is_empty()).then_some(truncated)
}

pub fn is_running_phase(phase: AgentTaskPhase) -> bool {
    matches!(
        phase,
        AgentTaskPhase::Analyzing
            | AgentTaskPhase::Reading
            | AgentTaskPhase::Editing
            | AgentTaskPhase::RunningCommand
            | AgentTaskPhase::RunningTests
            | AgentTaskPhase::Browsing
            | AgentTaskPhase::Generating
            | AgentTaskPhase::Delegating
            | AgentTaskPhase::Waiting
            | AgentTaskPhase::Compacting
    )
}

pub fn is_terminal_phase(phase: AgentTaskPhase) -> bool {
    matches!(
        phase,
        AgentTaskPhase::Completed | AgentTaskPhase::Failed | AgentTaskPhase::Interrupted
    )
}

pub fn task_priority(phase: AgentTaskPhase) -> u8 {
    match phase {
        AgentTaskPhase::WaitingInput | AgentTaskPhase::WaitingApproval => 0,
        AgentTaskPhase::Failed => 1,
        AgentTaskPhase::Completed | AgentTaskPhase::Interrupted => 2,
        _ => 3,
    }
}

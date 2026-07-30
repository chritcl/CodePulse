use std::sync::LazyLock;

use regex::Regex;
use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u8 = 1;
pub const MAX_EVENT_ID_CHARS: usize = 128;
pub const MAX_SESSION_ID_CHARS: usize = 128;
pub const MAX_TURN_ID_CHARS: usize = 128;
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CodexEventSource {
    Cli,
    App,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CodexEventType {
    SessionStarted,
    TurnStarted,
    ToolStarted,
    ToolFinished,
    PermissionRequested,
    TurnStopped,
    SessionEnded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CodexTaskPhase {
    Analyzing,
    Reading,
    Editing,
    RunningCommand,
    RunningTests,
    WaitingApproval,
    Completed,
    Failed,
    Interrupted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexBridgeEvent {
    pub version: u8,
    pub event_id: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    pub source: CodexEventSource,
    pub event_type: CodexEventType,
    pub phase: CodexTaskPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation_summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_summary: Option<String>,
    pub occurred_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProtocolError {
    UnsupportedVersion,
    InvalidEventId,
    InvalidSessionId,
    InvalidTurnId,
    InvalidOccurredAt,
}

impl CodexBridgeEvent {
    pub fn sanitize_and_validate(mut self) -> Result<Self, ProtocolError> {
        if self.version != PROTOCOL_VERSION {
            return Err(ProtocolError::UnsupportedVersion);
        }

        validate_identifier(
            &self.event_id,
            MAX_EVENT_ID_CHARS,
            ProtocolError::InvalidEventId,
        )?;
        validate_identifier(
            &self.session_id,
            MAX_SESSION_ID_CHARS,
            ProtocolError::InvalidSessionId,
        )?;
        if let Some(turn_id) = &self.turn_id {
            validate_identifier(turn_id, MAX_TURN_ID_CHARS, ProtocolError::InvalidTurnId)?;
        }
        if self.occurred_at_ms <= 0 {
            return Err(ProtocolError::InvalidOccurredAt);
        }

        self.project_name = sanitize_optional_text(self.project_name, MAX_PROJECT_NAME_CHARS);
        self.task_summary = sanitize_optional_text(self.task_summary, MAX_SUMMARY_CHARS);
        self.operation_summary = sanitize_optional_text(self.operation_summary, MAX_SUMMARY_CHARS);
        self.error_summary = sanitize_optional_text(self.error_summary, MAX_SUMMARY_CHARS);

        Ok(self)
    }
}

fn validate_identifier(
    value: &str,
    limit: usize,
    error: ProtocolError,
) -> Result<(), ProtocolError> {
    if value.trim().is_empty()
        || value.chars().count() > limit
        || value.chars().any(char::is_control)
    {
        return Err(error);
    }

    Ok(())
}

fn sanitize_optional_text(value: Option<String>, limit: usize) -> Option<String> {
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
    let redacted = redact_sensitive_text(&normalized);
    let truncated = truncate_characters(&redacted, limit);

    (!truncated.is_empty()).then_some(truncated)
}

fn redact_sensitive_text(value: &str) -> String {
    let value = ASSIGNED_SECRET.replace_all(value, "[已隐藏]");
    let value = BEARER_SECRET.replace_all(&value, "[已隐藏]");
    KEY_LIKE_SECRET.replace_all(&value, "[已隐藏]").into_owned()
}

fn truncate_characters(value: &str, limit: usize) -> String {
    value.chars().take(limit).collect()
}

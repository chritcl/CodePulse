use serde::{Deserialize, Serialize};

use crate::agent::protocol::{
    sanitize_optional_text, validate_identifier, AgentEventType, AgentProvider, AgentTaskPhase,
    MAX_CHILD_ID_CHARS, MAX_EVENT_ID_CHARS, MAX_PROJECT_NAME_CHARS, MAX_SESSION_ID_CHARS,
    MAX_SUMMARY_CHARS,
};

pub const CLAUDE_PROTOCOL_VERSION: u8 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClaudeChildKind {
    Subagent,
    Task,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeBridgeEvent {
    pub version: u8,
    #[serde(default)]
    pub provider: AgentProvider,
    pub event_id: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub child_kind: Option<ClaudeChildKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub child_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_child_id: Option<String>,
    pub event_type: AgentEventType,
    pub phase: AgentTaskPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation_summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_summary: Option<String>,
    pub occurred_at_ms: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClaudeProtocolError {
    UnsupportedVersion,
    InvalidProvider,
    InvalidEventId,
    InvalidSessionId,
    InvalidChild,
    InvalidOccurredAt,
}

impl ClaudeBridgeEvent {
    pub fn sanitize_and_validate(mut self) -> Result<Self, ClaudeProtocolError> {
        if self.version != CLAUDE_PROTOCOL_VERSION {
            return Err(ClaudeProtocolError::UnsupportedVersion);
        }
        if self.provider != AgentProvider::Claude {
            return Err(ClaudeProtocolError::InvalidProvider);
        }
        if !validate_identifier(&self.event_id, MAX_EVENT_ID_CHARS) {
            return Err(ClaudeProtocolError::InvalidEventId);
        }
        if !validate_identifier(&self.session_id, MAX_SESSION_ID_CHARS) {
            return Err(ClaudeProtocolError::InvalidSessionId);
        }
        if self.child_kind.is_some() != self.child_id.is_some()
            || self
                .child_id
                .as_deref()
                .is_some_and(|value| !validate_identifier(value, MAX_CHILD_ID_CHARS))
            || self
                .parent_child_id
                .as_deref()
                .is_some_and(|value| !validate_identifier(value, MAX_CHILD_ID_CHARS))
        {
            return Err(ClaudeProtocolError::InvalidChild);
        }
        if self.occurred_at_ms <= 0 {
            return Err(ClaudeProtocolError::InvalidOccurredAt);
        }

        self.project_name = sanitize_optional_text(self.project_name, MAX_PROJECT_NAME_CHARS);
        self.session_label = sanitize_optional_text(self.session_label, MAX_PROJECT_NAME_CHARS);
        self.task_summary = sanitize_optional_text(self.task_summary, MAX_SUMMARY_CHARS);
        self.operation_summary = sanitize_optional_text(self.operation_summary, MAX_SUMMARY_CHARS);
        self.error_summary = sanitize_optional_text(self.error_summary, MAX_SUMMARY_CHARS);
        Ok(self)
    }
}

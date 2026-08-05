use serde::{Deserialize, Serialize};

use crate::agent::protocol::{sanitize_optional_text, validate_identifier};
pub use crate::agent::protocol::{
    AgentTaskPhase as CodexTaskPhase, MAX_EVENT_ID_CHARS, MAX_PROJECT_NAME_CHARS,
    MAX_SESSION_ID_CHARS, MAX_SUMMARY_CHARS,
};

pub const PROTOCOL_VERSION: u8 = 1;
pub const MAX_TURN_ID_CHARS: usize = 128;

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
    ContextCompactionStarted,
    ContextCompactionFinished,
    PermissionRequested,
    TurnStopped,
    SessionEnded,
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

        if !validate_identifier(&self.event_id, MAX_EVENT_ID_CHARS) {
            return Err(ProtocolError::InvalidEventId);
        }
        if !validate_identifier(&self.session_id, MAX_SESSION_ID_CHARS) {
            return Err(ProtocolError::InvalidSessionId);
        }
        if self
            .turn_id
            .as_deref()
            .is_some_and(|turn_id| !validate_identifier(turn_id, MAX_TURN_ID_CHARS))
        {
            return Err(ProtocolError::InvalidTurnId);
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

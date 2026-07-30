use crate::codex::protocol::{
    CodexBridgeEvent, CodexEventSource, CodexEventType, CodexTaskPhase, MAX_PROJECT_NAME_CHARS,
    MAX_SUMMARY_CHARS, PROTOCOL_VERSION,
};

fn valid_event() -> CodexBridgeEvent {
    CodexBridgeEvent {
        version: PROTOCOL_VERSION,
        event_id: "event-123".to_string(),
        session_id: "session-123".to_string(),
        turn_id: Some("turn-123".to_string()),
        source: CodexEventSource::Cli,
        event_type: CodexEventType::ToolStarted,
        phase: CodexTaskPhase::RunningCommand,
        project_name: Some("CodePulse".to_string()),
        task_summary: Some("整理状态接收器".to_string()),
        operation_summary: Some("运行测试".to_string()),
        error_summary: None,
        occurred_at_ms: 1_784_001_234_567,
    }
}

#[test]
fn public_event_serializes_with_stable_camel_case_fields() {
    let value = serde_json::to_value(valid_event()).unwrap();

    assert_eq!(value["version"], 1);
    assert_eq!(value["eventId"], "event-123");
    assert_eq!(value["sessionId"], "session-123");
    assert_eq!(value["turnId"], "turn-123");
    assert_eq!(value["eventType"], "tool_started");
    assert_eq!(value["occurredAtMs"], 1_784_001_234_567_i64);
    assert!(value.get("event_id").is_none());
}

#[test]
fn rejects_an_event_without_a_session_id() {
    let mut event = valid_event();
    event.session_id = "  ".to_string();

    assert!(event.sanitize_and_validate().is_err());
}

#[test]
fn rejects_an_event_with_an_unsupported_protocol_version() {
    let mut event = valid_event();
    event.version = PROTOCOL_VERSION + 1;

    assert!(event.sanitize_and_validate().is_err());
}

#[test]
fn sanitizes_public_text_before_it_is_forwarded() {
    let mut event = valid_event();
    event.project_name = Some(format!(
        "项目{}{}",
        char::from(0),
        "甲".repeat(MAX_PROJECT_NAME_CHARS + 10)
    ));
    event.operation_summary = Some(format!(
        "运行命令\r\ntoken=private-value {}",
        "乙".repeat(MAX_SUMMARY_CHARS + 10)
    ));

    let sanitized = event.sanitize_and_validate().unwrap();
    let project_name = sanitized.project_name.unwrap();
    let operation_summary = sanitized.operation_summary.unwrap();

    assert!(project_name.chars().count() <= MAX_PROJECT_NAME_CHARS);
    assert!(!project_name.chars().any(char::is_control));
    assert!(operation_summary.chars().count() <= MAX_SUMMARY_CHARS);
    assert!(!operation_summary.chars().any(char::is_control));
    assert!(operation_summary.contains("[已隐藏]"));
    assert!(!operation_summary.contains("private-value"));
}

#[test]
fn redacts_a_secret_assignment_adjacent_to_non_ascii_text() {
    let mut event = valid_event();
    event.error_summary = Some("失败原因token=private-adjacent-value".to_string());

    let sanitized = event.sanitize_and_validate().unwrap();
    let error_summary = sanitized.error_summary.unwrap();

    assert!(error_summary.contains("[已隐藏]"));
    assert!(!error_summary.contains("private-adjacent-value"));
}

#[test]
fn ignores_raw_hook_fields_that_are_not_part_of_the_public_event() {
    let mut value = serde_json::to_value(valid_event()).unwrap();
    let object = value.as_object_mut().unwrap();
    object.insert("cwd".to_string(), serde_json::json!("C:\\private\\project"));
    object.insert(
        "transcriptPath".to_string(),
        serde_json::json!("C:\\private\\session.jsonl"),
    );
    object.insert("toolInput".to_string(), serde_json::json!("secret command"));

    let event: CodexBridgeEvent = serde_json::from_value(value).unwrap();
    let serialized = serde_json::to_value(event.sanitize_and_validate().unwrap()).unwrap();

    assert!(serialized.get("cwd").is_none());
    assert!(serialized.get("transcriptPath").is_none());
    assert!(serialized.get("toolInput").is_none());
}

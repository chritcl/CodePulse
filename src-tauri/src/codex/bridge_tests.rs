use std::fs;
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

use tokio::net::TcpListener;
use tokio::time::{timeout, Duration};

use super::bridge::{
    event_from_hook_input, forward_hook_input, read_limited_hook_input, BridgeConfig,
    BridgeOutcome, MAX_HOOK_INPUT_BYTES,
};
use super::protocol::{CodexEventSource, CodexEventType, CodexTaskPhase};
use super::runtime_discovery::{
    write_discovery_atomically, RuntimeDiscovery, RUNTIME_DISCOVERY_VERSION,
};
use super::server::start_receiver;

static NEXT_DIRECTORY_ID: AtomicUsize = AtomicUsize::new(0);

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new() -> Self {
        let directory = std::env::temp_dir().join(format!(
            "codepulse-codex-bridge-{}-{}",
            std::process::id(),
            NEXT_DIRECTORY_ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&directory).unwrap();
        Self(directory)
    }

    fn join(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn turns_a_valid_tool_hook_into_a_safe_public_event() {
    let input = br#"
    {
      "session_id": "session-1",
      "turn_id": "turn-1",
      "hook_event_name": "PreToolUse",
      "cwd": "C:\\Users\\example\\projects\\CodePulse",
      "tool_name": "Bash",
      "tool_input": { "command": "cargo test --token private-value" },
      "transcript_path": "C:\\Users\\example\\.codex\\sessions\\private.jsonl"
    }
    "#;

    let event = event_from_hook_input(
        input,
        CodexEventSource::Cli,
        "event-1",
        1_784_001_234_567,
        false,
    )
    .unwrap();
    let serialized = serde_json::to_value(&event).unwrap();

    assert_eq!(event.event_type, CodexEventType::ToolStarted);
    assert_eq!(event.phase, CodexTaskPhase::RunningTests);
    assert_eq!(event.project_name.as_deref(), Some("CodePulse"));
    assert_eq!(event.operation_summary.as_deref(), Some("运行测试"));
    assert!(event.task_summary.is_none());
    assert!(serialized.get("cwd").is_none());
    assert!(serialized.get("toolInput").is_none());
    assert!(serialized.get("transcriptPath").is_none());
    assert!(!serialized.to_string().contains("private-value"));
}

#[test]
fn ignores_empty_or_invalid_hook_input() {
    assert!(event_from_hook_input(b"", CodexEventSource::Cli, "event-1", 1, false).is_none());
    assert!(
        event_from_hook_input(b"{invalid", CodexEventSource::Cli, "event-1", 1, false).is_none()
    );
}

#[test]
fn maps_permission_requests_without_copying_the_requested_command() {
    let input = br#"
    {
      "session_id": "session-1",
      "hook_event_name": "PermissionRequest",
      "tool_name": "Bash",
      "tool_input": { "command": "type C:\\private\\token.txt" }
    }
    "#;

    let event = event_from_hook_input(input, CodexEventSource::App, "event-2", 2, false).unwrap();
    let serialized = serde_json::to_string(&event).unwrap();

    assert_eq!(event.event_type, CodexEventType::PermissionRequested);
    assert_eq!(event.phase, CodexTaskPhase::WaitingApproval);
    assert_eq!(event.operation_summary.as_deref(), Some("等待授权"));
    assert!(!serialized.contains("private"));
}

#[test]
fn preserves_an_explicit_failed_stop_result_for_the_aggregator() {
    let input = br#"
    {
      "session_id": "session-1",
      "hook_event_name": "Stop",
      "stop_reason": "failed"
    }
    "#;

    let event = event_from_hook_input(input, CodexEventSource::Cli, "event-3", 3, false).unwrap();

    assert_eq!(event.event_type, CodexEventType::TurnStopped);
    assert_eq!(event.phase, CodexTaskPhase::Failed);
    assert_eq!(event.operation_summary.as_deref(), Some("任务失败"));
}

#[test]
fn ignores_hook_events_without_a_session_id() {
    let input = br#"{ "hook_event_name": "SessionStart" }"#;

    assert!(event_from_hook_input(input, CodexEventSource::Unknown, "event-3", 3, false).is_none());
}

#[test]
fn maps_request_user_input_before_and_after_without_copying_question_content() {
    let before = r#"
    {
      "session_id": "session-1",
      "hook_event_name": "PreToolUse",
      "tool_name": "request_user_input",
      "tool_input": { "questions": [{ "question": "原始问题不得外传" }] }
    }
    "#;
    let after = r#"
    {
      "session_id": "session-1",
      "hook_event_name": "PostToolUse",
      "tool_name": "request_user_input",
      "tool_response": { "answers": ["原始答案不得外传"] }
    }
    "#;

    let waiting = event_from_hook_input(
        before.as_bytes(),
        CodexEventSource::App,
        "event-4",
        4,
        false,
    )
    .unwrap();
    let resumed =
        event_from_hook_input(after.as_bytes(), CodexEventSource::App, "event-5", 5, false)
            .unwrap();

    assert_eq!(waiting.event_type, CodexEventType::ToolStarted);
    assert_eq!(waiting.phase, CodexTaskPhase::WaitingInput);
    assert_eq!(waiting.operation_summary.as_deref(), Some("等待回答"));
    assert_eq!(resumed.event_type, CodexEventType::ToolFinished);
    assert_eq!(resumed.phase, CodexTaskPhase::Analyzing);
    assert_eq!(resumed.operation_summary.as_deref(), Some("继续分析"));
    let serialized = serde_json::to_string(&(waiting, resumed)).unwrap();
    assert!(!serialized.contains("原始问题"));
    assert!(!serialized.contains("原始答案"));
}

#[test]
fn maps_new_tool_categories_and_unknown_tools_to_safe_phases() {
    let cases = [
        ("browser_open", CodexTaskPhase::Browsing, "浏览网页"),
        ("web.run", CodexTaskPhase::Browsing, "浏览网页"),
        ("imagegen", CodexTaskPhase::Generating, "生成内容"),
        ("spawn_agent", CodexTaskPhase::Delegating, "分派子任务"),
        ("wait_agent", CodexTaskPhase::Waiting, "等待任务"),
        ("future_tool", CodexTaskPhase::Analyzing, "执行工具"),
    ];

    for (index, (tool_name, phase, summary)) in cases.into_iter().enumerate() {
        let input = format!(
            r#"{{"session_id":"session-1","hook_event_name":"PreToolUse","tool_name":"{tool_name}"}}"#
        );
        let event = event_from_hook_input(
            input.as_bytes(),
            CodexEventSource::App,
            &format!("event-{index}"),
            index as i64 + 1,
            false,
        )
        .unwrap();

        assert_eq!(event.phase, phase);
        assert_eq!(event.operation_summary.as_deref(), Some(summary));
    }
}

#[test]
fn only_marks_shell_commands_as_tests_when_the_command_matches_a_safe_test_shape() {
    let test_input = br#"
    {
      "session_id": "session-1",
      "hook_event_name": "PreToolUse",
      "tool_name": "shell_command",
      "tool_input": { "command": "pnpm run test -- --run" }
    }
    "#;
    let arbitrary_input = br#"
    {
      "session_id": "session-1",
      "hook_event_name": "PreToolUse",
      "tool_name": "shell_command",
      "tool_input": { "command": "Write-Output test; Get-Content C:\\private.txt" }
    }
    "#;

    let test_event =
        event_from_hook_input(test_input, CodexEventSource::Cli, "event-test", 1, false).unwrap();
    let command_event = event_from_hook_input(
        arbitrary_input,
        CodexEventSource::Cli,
        "event-command",
        2,
        false,
    )
    .unwrap();

    assert_eq!(test_event.phase, CodexTaskPhase::RunningTests);
    assert_eq!(command_event.phase, CodexTaskPhase::RunningCommand);
    let serialized = serde_json::to_string(&(test_event, command_event)).unwrap();
    assert!(!serialized.contains("private.txt"));
}

#[test]
fn maps_compaction_hooks_to_compacting_and_resumed_analysis() {
    let before = br#"{ "session_id": "session-1", "hook_event_name": "PreCompact" }"#;
    let after = br#"{ "session_id": "session-1", "hook_event_name": "PostCompact" }"#;

    let compacting =
        event_from_hook_input(before, CodexEventSource::App, "event-before", 1, false).unwrap();
    let resumed =
        event_from_hook_input(after, CodexEventSource::App, "event-after", 2, false).unwrap();

    assert_eq!(
        compacting.event_type,
        CodexEventType::ContextCompactionStarted
    );
    assert_eq!(compacting.phase, CodexTaskPhase::Compacting);
    assert_eq!(
        resumed.event_type,
        CodexEventType::ContextCompactionFinished
    );
    assert_eq!(resumed.phase, CodexTaskPhase::Analyzing);
}

#[test]
fn captures_only_a_sanitized_user_prompt_when_the_privacy_gate_is_enabled() {
    let input = r#"
    {
      "session_id": "session-1",
      "hook_event_name": "UserPromptSubmit",
      "prompt": "实现状态岛 token=private-value 并保持界面简洁"
    }
    "#;

    let hidden = event_from_hook_input(
        input.as_bytes(),
        CodexEventSource::App,
        "event-hidden",
        1,
        false,
    )
    .unwrap();
    let visible = event_from_hook_input(
        input.as_bytes(),
        CodexEventSource::App,
        "event-visible",
        2,
        true,
    )
    .unwrap();

    assert!(hidden.task_summary.is_none());
    assert_eq!(
        visible.task_summary.as_deref(),
        Some("实现状态岛 [已隐藏] 并保持界面简洁")
    );
}

#[test]
fn limits_the_hook_input_before_json_parsing() {
    let mut oversized_input = Cursor::new(vec![b'x'; MAX_HOOK_INPUT_BYTES + 1]);
    let mut valid_input = Cursor::new(br#"{ "session_id": "session-1" }"#);

    assert!(read_limited_hook_input(&mut oversized_input).is_none());
    assert_eq!(
        read_limited_hook_input(&mut valid_input).unwrap(),
        br#"{ "session_id": "session-1" }"#
    );
}

#[tokio::test]
async fn ignores_a_hook_when_the_runtime_discovery_file_is_missing() {
    let directory = TestDirectory::new();
    let config = BridgeConfig::new(directory.join("missing.json"), CodexEventSource::Cli);

    let outcome = forward_hook_input(
        br#"{ "session_id": "session-1", "hook_event_name": "SessionStart" }"#,
        &config,
    )
    .await;

    assert_eq!(outcome, BridgeOutcome::Ignored);
}

#[tokio::test]
async fn silently_ignores_an_unreachable_runtime_after_the_request_times_out() {
    let directory = TestDirectory::new();
    let discovery_path = directory.join("runtime.json");
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    write_discovery_atomically(
        &discovery_path,
        &RuntimeDiscovery {
            version: RUNTIME_DISCOVERY_VERSION,
            port,
            token: "runtime-token".to_string(),
            process_id: std::process::id(),
            created_at_ms: 1,
            capture_task_summary: false,
        },
    )
    .unwrap();
    let config = BridgeConfig::new(discovery_path, CodexEventSource::Cli)
        .with_request_timeout(Duration::from_millis(50));

    let outcome = forward_hook_input(
        br#"{ "session_id": "session-1", "hook_event_name": "SessionStart" }"#,
        &config,
    )
    .await;

    assert_eq!(outcome, BridgeOutcome::Ignored);
    drop(listener);
}

#[tokio::test]
async fn forwards_a_safe_event_to_the_authenticated_local_receiver() {
    let directory = TestDirectory::new();
    let (server, mut receiver) = start_receiver(&directory.0, 1, false).await.unwrap();
    let config = BridgeConfig::new(server.discovery_path().to_path_buf(), CodexEventSource::App);

    let outcome = forward_hook_input(
        br#"
        {
          "session_id": "session-1",
          "hook_event_name": "PreToolUse",
          "cwd": "C:\\private\\CodePulse",
          "tool_name": "Bash",
          "tool_input": { "command": "type C:\\private\\token.txt" }
        }
        "#,
        &config,
    )
    .await;
    let event = timeout(Duration::from_millis(500), receiver.recv()).await.unwrap().unwrap();

    assert_eq!(outcome, BridgeOutcome::Delivered);
    assert_eq!(event.source, CodexEventSource::App);
    assert_eq!(event.project_name.as_deref(), Some("CodePulse"));
    assert_eq!(event.operation_summary.as_deref(), Some("运行命令"));
    assert!(event.task_summary.is_none());
    assert!(event.error_summary.is_none());

    server.stop().await;
}

#[tokio::test]
async fn forwards_a_sanitized_prompt_only_when_the_runtime_gate_is_enabled() {
    let directory = TestDirectory::new();
    let (server, mut receiver) = start_receiver(&directory.0, 1, true).await.unwrap();
    let config = BridgeConfig::new(server.discovery_path().to_path_buf(), CodexEventSource::App);

    let outcome = forward_hook_input(
        r#"{
          "session_id": "session-1",
          "hook_event_name": "UserPromptSubmit",
          "prompt": "实现状态岛 token=private-value 并验证隐私门禁"
        }"#
        .as_bytes(),
        &config,
    )
    .await;
    let event = timeout(Duration::from_millis(500), receiver.recv()).await.unwrap().unwrap();

    assert_eq!(outcome, BridgeOutcome::Delivered);
    assert_eq!(
        event.task_summary.as_deref(),
        Some("实现状态岛 [已隐藏] 并验证隐私门禁")
    );

    server.stop().await;
}

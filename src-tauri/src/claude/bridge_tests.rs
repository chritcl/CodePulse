use std::io::Cursor;

use serde_json::{json, Value};

use crate::agent::{AgentEventType, AgentProvider, AgentTaskPhase};

use super::bridge::{
    event_from_hook_reader, forward_hook_reader, BridgeConfig, BridgeOutcome, MAX_HOOK_INPUT_BYTES,
};
use super::protocol::ClaudeChildKind;

fn parse(value: Value, capture_task_summary: bool) -> super::protocol::ClaudeBridgeEvent {
    let bytes = serde_json::to_vec(&value).unwrap();
    event_from_hook_reader(
        &mut Cursor::new(bytes),
        "event-1",
        1_000,
        capture_task_summary,
    )
    .expect("应解析受支持的 Claude Hook")
}

#[test]
fn 大体积工具正文被流式跳过且不会进入规范化事件() {
    let content = "敏感正文".repeat(80_000);
    let event = parse(
        json!({
            "session_id": "session-1",
            "hook_event_name": "PostToolUse",
            "cwd": "C:\\work\\CodePulse",
            "tool_name": "Write",
            "tool_input": { "file_path": "C:\\secret.txt", "content": content },
            "tool_response": { "stdout": "token=very-secret", "content": content }
        }),
        false,
    );

    assert_eq!(event.provider, AgentProvider::Claude);
    assert_eq!(event.event_type, AgentEventType::ToolFinished);
    assert_eq!(event.phase, AgentTaskPhase::Analyzing);
    assert_eq!(event.project_name.as_deref(), Some("CodePulse"));
    assert_eq!(event.operation_summary.as_deref(), Some("继续分析"));
    assert!(event.task_summary.is_none());
    assert!(event.error_summary.is_none());
    assert!(serde_json::to_vec(&event).unwrap().len() <= 16 * 1024);
}

#[test]
fn 超过八兆的_hook_输入被拒绝() {
    let oversized = json!({
        "session_id": "session-1",
        "hook_event_name": "PostToolUse",
        "tool_response": "x".repeat(MAX_HOOK_INPUT_BYTES)
    });
    let bytes = serde_json::to_vec(&oversized).unwrap();

    assert!(bytes.len() > MAX_HOOK_INPUT_BYTES);
    assert!(event_from_hook_reader(&mut Cursor::new(bytes), "event-1", 1_000, false).is_none());
}

#[test]
fn 映射工具阶段与等待事件且不复制命令或问题正文() {
    let cases = [
        ("Read", AgentTaskPhase::Reading, "读取项目"),
        ("Write", AgentTaskPhase::Editing, "修改代码"),
        ("Bash", AgentTaskPhase::RunningCommand, "运行命令"),
        ("WebSearch", AgentTaskPhase::Browsing, "浏览网页"),
        ("Agent", AgentTaskPhase::Delegating, "分派子任务"),
        ("AskUserQuestion", AgentTaskPhase::WaitingInput, "等待回答"),
        ("ExitPlanMode", AgentTaskPhase::WaitingApproval, "等待授权"),
    ];

    for (tool_name, phase, summary) in cases {
        let event = parse(
            json!({
                "session_id": "session-1",
                "hook_event_name": "PreToolUse",
                "tool_name": tool_name,
                "tool_input": { "command": "git status -- token=secret", "question": "密钥是什么" }
            }),
            false,
        );
        assert_eq!(event.phase, phase, "工具 {tool_name} 的阶段不正确");
        assert_eq!(event.operation_summary.as_deref(), Some(summary));
        assert!(!serde_json::to_string(&event).unwrap().contains("token=secret"));
        assert!(!serde_json::to_string(&event).unwrap().contains("密钥是什么"));
    }

    let test_event = parse(
        json!({
            "session_id": "session-1",
            "hook_event_name": "PreToolUse",
            "tool_name": "Bash",
            "tool_input": { "command": "pnpm run test" }
        }),
        false,
    );
    assert_eq!(test_event.phase, AgentTaskPhase::RunningTests);
}

#[test]
fn 映射父会话子智能体任务与停止失败事件() {
    let subagent = parse(
        json!({
            "session_id": "session-1",
            "hook_event_name": "SubagentStart",
            "agent_id": "agent-1",
            "agent_type": "Explore"
        }),
        false,
    );
    assert_eq!(subagent.event_type, AgentEventType::ChildStarted);
    assert_eq!(subagent.child_kind, Some(ClaudeChildKind::Subagent));
    assert_eq!(subagent.child_id.as_deref(), Some("agent-1"));

    let task = parse(
        json!({
            "session_id": "session-1",
            "hook_event_name": "TaskCreated",
            "task_id": "task-1",
            "subject": "不要默认采集的标题"
        }),
        false,
    );
    assert_eq!(task.event_type, AgentEventType::ChildStarted);
    assert_eq!(task.child_kind, Some(ClaudeChildKind::Task));
    assert!(task.task_summary.is_none());

    let failed = parse(
        json!({
            "session_id": "session-1",
            "hook_event_name": "StopFailure",
            "error": "token=very-secret"
        }),
        true,
    );
    assert_eq!(failed.event_type, AgentEventType::TurnStopped);
    assert_eq!(failed.phase, AgentTaskPhase::Failed);
    assert!(failed.error_summary.is_none());
}

#[test]
fn 工具失败只恢复分析而交互结果解除等待() {
    let tool_failure = parse(
        json!({
            "session_id": "session-1",
            "hook_event_name": "PostToolUseFailure",
            "tool_name": "Bash",
            "error": "命令失败"
        }),
        false,
    );
    assert_eq!(tool_failure.event_type, AgentEventType::ToolFinished);
    assert_eq!(tool_failure.phase, AgentTaskPhase::Analyzing);

    let elicitation = parse(
        json!({
            "session_id": "session-1",
            "hook_event_name": "Elicitation",
            "prompt": "输入密钥"
        }),
        false,
    );
    assert_eq!(elicitation.event_type, AgentEventType::InputRequested);
    assert_eq!(elicitation.phase, AgentTaskPhase::WaitingInput);

    let result = parse(
        json!({
            "session_id": "session-1",
            "hook_event_name": "ElicitationResult",
            "result": "secret"
        }),
        false,
    );
    assert_eq!(result.event_type, AgentEventType::InputResolved);
    assert_eq!(result.phase, AgentTaskPhase::Analyzing);
}

#[test]
fn 任务摘要只在显式开启时采集并经过脱敏截断() {
    let value = json!({
        "session_id": "session-1",
        "hook_event_name": "UserPromptSubmit",
        "prompt": format!("实现功能 token=very-secret {}", "长文本".repeat(100))
    });

    assert!(parse(value.clone(), false).task_summary.is_none());
    let summary = parse(value, true).task_summary.unwrap();
    assert!(summary.contains("[已隐藏]"));
    assert!(!summary.contains("very-secret"));
    assert!(summary.chars().count() <= 160);
}

#[tokio::test]
async fn 使用三百毫秒预算投递到共享本机接收器() {
    use crate::agent::runtime_discovery::AgentSummaryCapture;
    use crate::agent::server::{start_receiver, AgentBridgeEvent};

    let directory = std::env::temp_dir().join(format!(
        "codepulse-claude-bridge-forward-{}-{}",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&directory).unwrap();
    let (receiver, mut events) = start_receiver(
        &directory,
        1,
        AgentSummaryCapture {
            codex: false,
            claude: true,
        },
    )
    .await
    .unwrap();
    let config = BridgeConfig::new(receiver.discovery_path().to_path_buf());
    let input = serde_json::to_vec(&json!({
        "session_id": "session-1",
        "hook_event_name": "UserPromptSubmit",
        "prompt": "实现任务"
    }))
    .unwrap();

    let outcome = forward_hook_reader(&mut Cursor::new(input), &config).await;
    assert_eq!(outcome, BridgeOutcome::Delivered);
    let event = events.recv().await.unwrap();
    let AgentBridgeEvent::Claude(event) = event else {
        panic!("应收到 Claude 事件");
    };
    assert_eq!(event.task_summary.as_deref(), Some("实现任务"));

    receiver.stop().await;
    std::fs::remove_dir_all(directory).unwrap();
}

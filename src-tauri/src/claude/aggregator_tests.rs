use crate::agent::{AgentEventType, AgentListenerStatus, AgentProvider, AgentTaskPhase};

use super::aggregator::ClaudeAggregator;
use super::protocol::{ClaudeBridgeEvent, ClaudeChildKind, CLAUDE_PROTOCOL_VERSION};

fn event(
    event_id: &str,
    event_type: AgentEventType,
    phase: AgentTaskPhase,
    child: Option<(ClaudeChildKind, &str)>,
    occurred_at_ms: i64,
) -> ClaudeBridgeEvent {
    ClaudeBridgeEvent {
        version: CLAUDE_PROTOCOL_VERSION,
        provider: AgentProvider::Claude,
        event_id: event_id.to_string(),
        session_id: "session-1".to_string(),
        child_kind: child.map(|value| value.0),
        child_id: child.map(|value| value.1.to_string()),
        parent_child_id: None,
        event_type,
        phase,
        project_name: Some("CodePulse".to_string()),
        session_label: None,
        task_summary: None,
        operation_summary: Some("状态更新".to_string()),
        error_summary: None,
        occurred_at_ms,
    }
}

#[test]
fn 子智能体等待与失败会提升父会话有效阶段() {
    let mut aggregator = ClaudeAggregator::new(32);
    assert!(aggregator.apply(event(
        "root",
        AgentEventType::SessionStarted,
        AgentTaskPhase::Analyzing,
        None,
        1_000,
    )));
    assert!(aggregator.apply(event(
        "child",
        AgentEventType::ChildStarted,
        AgentTaskPhase::Analyzing,
        Some((ClaudeChildKind::Subagent, "agent-1")),
        1_010,
    )));
    assert!(aggregator.apply(event(
        "waiting",
        AgentEventType::InputRequested,
        AgentTaskPhase::WaitingInput,
        Some((ClaudeChildKind::Subagent, "agent-1")),
        1_020,
    )));

    let waiting = aggregator.snapshot(AgentListenerStatus::Running, 1_020);
    assert_eq!(waiting.sessions[0].phase, AgentTaskPhase::Analyzing);
    assert_eq!(
        waiting.sessions[0].effective_phase,
        AgentTaskPhase::WaitingInput
    );
    assert_eq!(waiting.sessions[0].children.len(), 1);
    assert_eq!(
        waiting.sessions[0].children[0].task_key,
        "claude:subagent:session-1:agent-1"
    );

    assert!(aggregator.apply(event(
        "failed",
        AgentEventType::ChildStopped,
        AgentTaskPhase::Failed,
        Some((ClaudeChildKind::Subagent, "agent-1")),
        1_030,
    )));
    let failed = aggregator.snapshot(AgentListenerStatus::Running, 1_030);
    assert_eq!(failed.sessions[0].effective_phase, AgentTaskPhase::Failed);
    assert!(failed.has_failed_task);
}

#[test]
fn 停止事件在后台任务活动时等待否则完成() {
    let mut aggregator = ClaudeAggregator::new(32);
    aggregator.apply(event(
        "root",
        AgentEventType::SessionStarted,
        AgentTaskPhase::Analyzing,
        None,
        1_000,
    ));
    aggregator.apply(event(
        "task",
        AgentEventType::ChildStarted,
        AgentTaskPhase::Analyzing,
        Some((ClaudeChildKind::Task, "task-1")),
        1_010,
    ));
    aggregator.apply(event(
        "stop-1",
        AgentEventType::TurnStopped,
        AgentTaskPhase::Completed,
        None,
        1_020,
    ));
    assert_eq!(
        aggregator.snapshot(AgentListenerStatus::Running, 1_020).sessions[0].phase,
        AgentTaskPhase::Waiting
    );

    aggregator.apply(event(
        "task-done",
        AgentEventType::ChildStopped,
        AgentTaskPhase::Completed,
        Some((ClaudeChildKind::Task, "task-1")),
        1_030,
    ));
    assert_eq!(
        aggregator.snapshot(AgentListenerStatus::Running, 1_030).sessions[0].phase,
        AgentTaskPhase::Completed
    );
}

#[test]
fn 后台任务开始事件晚到时会恢复等待并在任务结束后完成() {
    let mut aggregator = ClaudeAggregator::new(32);
    aggregator.apply(event(
        "root",
        AgentEventType::SessionStarted,
        AgentTaskPhase::Analyzing,
        None,
        1_000,
    ));
    aggregator.apply(event(
        "stop",
        AgentEventType::TurnStopped,
        AgentTaskPhase::Completed,
        None,
        1_020,
    ));
    aggregator.apply(event(
        "task-late",
        AgentEventType::ChildStarted,
        AgentTaskPhase::Analyzing,
        Some((ClaudeChildKind::Task, "task-1")),
        1_010,
    ));
    assert_eq!(
        aggregator.snapshot(AgentListenerStatus::Running, 1_020).sessions[0].phase,
        AgentTaskPhase::Waiting
    );

    aggregator.apply(event(
        "task-done",
        AgentEventType::ChildStopped,
        AgentTaskPhase::Completed,
        Some((ClaudeChildKind::Task, "task-1")),
        1_030,
    ));
    assert_eq!(
        aggregator.snapshot(AgentListenerStatus::Running, 1_030).sessions[0].phase,
        AgentTaskPhase::Completed
    );
}

#[test]
fn 清除失败父会话删除整棵树而清除失败子项只删除子项() {
    let mut aggregator = ClaudeAggregator::new(32);
    aggregator.apply(event(
        "root",
        AgentEventType::SessionStarted,
        AgentTaskPhase::Analyzing,
        None,
        1_000,
    ));
    aggregator.apply(event(
        "child",
        AgentEventType::ChildStarted,
        AgentTaskPhase::Analyzing,
        Some((ClaudeChildKind::Subagent, "agent-1")),
        1_010,
    ));
    aggregator.apply(event(
        "child-failed",
        AgentEventType::ChildStopped,
        AgentTaskPhase::Failed,
        Some((ClaudeChildKind::Subagent, "agent-1")),
        1_020,
    ));

    assert!(aggregator.clear_failed_task("claude:subagent:session-1:agent-1"));
    let child_cleared = aggregator.snapshot(AgentListenerStatus::Running, 1_020);
    assert_eq!(child_cleared.sessions.len(), 1);
    assert!(child_cleared.sessions[0].children.is_empty());

    aggregator.apply(event(
        "child-2",
        AgentEventType::ChildStarted,
        AgentTaskPhase::Analyzing,
        Some((ClaudeChildKind::Task, "task-2")),
        1_030,
    ));
    aggregator.apply(event(
        "root-failed",
        AgentEventType::TurnStopped,
        AgentTaskPhase::Failed,
        None,
        1_040,
    ));
    assert!(aggregator.clear_failed_task("claude:session:session-1"));
    assert!(aggregator.snapshot(AgentListenerStatus::Running, 1_040).sessions.is_empty());
}

#[test]
fn 失败父会话在等待子项上浮时仍可识别并清除() {
    let mut aggregator = ClaudeAggregator::new(32);
    aggregator.apply(event(
        "root",
        AgentEventType::SessionStarted,
        AgentTaskPhase::Analyzing,
        None,
        1_000,
    ));
    aggregator.apply(event(
        "child",
        AgentEventType::ChildStarted,
        AgentTaskPhase::Analyzing,
        Some((ClaudeChildKind::Subagent, "agent-1")),
        1_010,
    ));
    aggregator.apply(event(
        "child-waiting",
        AgentEventType::InputRequested,
        AgentTaskPhase::WaitingInput,
        Some((ClaudeChildKind::Subagent, "agent-1")),
        1_020,
    ));
    aggregator.apply(event(
        "root-failed",
        AgentEventType::TurnStopped,
        AgentTaskPhase::Failed,
        None,
        1_030,
    ));

    let snapshot = aggregator.snapshot(AgentListenerStatus::Running, 1_030);
    assert_eq!(snapshot.sessions[0].phase, AgentTaskPhase::Failed);
    assert_eq!(
        snapshot.sessions[0].effective_phase,
        AgentTaskPhase::WaitingInput
    );
    assert!(snapshot.has_failed_task);
    assert!(aggregator.clear_failed_task("claude:session:session-1"));
    assert!(aggregator.snapshot(AgentListenerStatus::Running, 1_030).sessions.is_empty());
}

#[test]
fn 重复和乱序事件不会回退状态() {
    let mut aggregator = ClaudeAggregator::new(2);
    assert!(aggregator.apply(event(
        "root",
        AgentEventType::SessionStarted,
        AgentTaskPhase::Analyzing,
        None,
        2_000,
    )));
    assert!(!aggregator.apply(event(
        "root",
        AgentEventType::TurnStarted,
        AgentTaskPhase::Analyzing,
        None,
        2_010,
    )));
    assert!(!aggregator.apply(event(
        "old",
        AgentEventType::ToolStarted,
        AgentTaskPhase::Editing,
        None,
        1_999,
    )));
    assert_eq!(
        aggregator.snapshot(AgentListenerStatus::Running, 2_010).sessions[0].phase,
        AgentTaskPhase::Analyzing
    );
}

#[test]
fn 不同子任务的乱序到达不会互相覆盖或丢失() {
    let mut aggregator = ClaudeAggregator::new(16);
    aggregator.apply(event(
        "root",
        AgentEventType::SessionStarted,
        AgentTaskPhase::Analyzing,
        None,
        1_000,
    ));
    aggregator.apply(event(
        "newer-child",
        AgentEventType::ChildStarted,
        AgentTaskPhase::Analyzing,
        Some((ClaudeChildKind::Subagent, "agent-newer")),
        2_000,
    ));

    assert!(aggregator.apply(event(
        "older-other-child",
        AgentEventType::ChildStarted,
        AgentTaskPhase::Analyzing,
        Some((ClaudeChildKind::Task, "task-older")),
        1_900,
    )));
    let snapshot = aggregator.snapshot(AgentListenerStatus::Running, 2_000);
    assert_eq!(snapshot.sessions[0].children.len(), 2);
    assert_eq!(snapshot.sessions[0].last_activity_at_ms, 2_000);
}

#[test]
fn 等待状态会超时中断而失败状态持续保留() {
    use super::aggregator::INACTIVITY_TIMEOUT_MS;

    let mut waiting = ClaudeAggregator::new(16);
    waiting.apply(event(
        "root",
        AgentEventType::SessionStarted,
        AgentTaskPhase::Analyzing,
        None,
        1_000,
    ));
    waiting.apply(event(
        "wait",
        AgentEventType::InputRequested,
        AgentTaskPhase::WaitingInput,
        None,
        1_100,
    ));
    assert!(waiting.expire(1_100 + INACTIVITY_TIMEOUT_MS));
    assert_eq!(
        waiting.snapshot(AgentListenerStatus::Running, 2_000).sessions[0].phase,
        AgentTaskPhase::Interrupted
    );

    let mut failed = ClaudeAggregator::new(16);
    failed.apply(event(
        "failed",
        AgentEventType::TurnStopped,
        AgentTaskPhase::Failed,
        None,
        1_000,
    ));
    assert!(!failed.expire(1_000 + INACTIVITY_TIMEOUT_MS * 10));
    assert_eq!(
        failed.snapshot(AgentListenerStatus::Running, 2_000).sessions[0].phase,
        AgentTaskPhase::Failed
    );
}

#[test]
fn 完成父会话中的失败子项持续保留到手动清除() {
    use super::aggregator::COMPLETED_RETENTION_MS;

    let mut aggregator = ClaudeAggregator::new(16);
    aggregator.apply(event(
        "root",
        AgentEventType::SessionStarted,
        AgentTaskPhase::Analyzing,
        None,
        1_000,
    ));
    aggregator.apply(event(
        "child-failed",
        AgentEventType::ChildStopped,
        AgentTaskPhase::Failed,
        Some((ClaudeChildKind::Subagent, "agent-1")),
        1_100,
    ));
    aggregator.apply(event(
        "root-completed",
        AgentEventType::TurnStopped,
        AgentTaskPhase::Completed,
        None,
        1_200,
    ));

    aggregator.expire(1_200 + COMPLETED_RETENTION_MS);

    let snapshot = aggregator.snapshot(AgentListenerStatus::Running, 40_000);
    assert_eq!(snapshot.sessions.len(), 1);
    assert_eq!(snapshot.sessions[0].effective_phase, AgentTaskPhase::Failed);
    assert_eq!(
        snapshot.sessions[0].children[0].phase,
        AgentTaskPhase::Failed
    );
}

#[test]
fn 相同字符串的子智能体与任务标识保持为两个独立子项() {
    let mut aggregator = ClaudeAggregator::new(16);
    aggregator.apply(event(
        "root",
        AgentEventType::SessionStarted,
        AgentTaskPhase::Analyzing,
        None,
        1_000,
    ));
    aggregator.apply(event(
        "subagent",
        AgentEventType::ChildStarted,
        AgentTaskPhase::Analyzing,
        Some((ClaudeChildKind::Subagent, "shared-id")),
        1_100,
    ));
    aggregator.apply(event(
        "task",
        AgentEventType::ChildStarted,
        AgentTaskPhase::Analyzing,
        Some((ClaudeChildKind::Task, "shared-id")),
        1_200,
    ));

    let snapshot = aggregator.snapshot(AgentListenerStatus::Running, 1_200);
    assert_eq!(snapshot.sessions[0].children.len(), 2);
    assert!(snapshot.sessions[0]
        .children
        .iter()
        .any(|child| child.task_key == "claude:subagent:session-1:shared-id"));
    assert!(snapshot.sessions[0]
        .children
        .iter()
        .any(|child| child.task_key == "claude:task:session-1:shared-id"));
}

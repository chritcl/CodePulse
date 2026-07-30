use super::aggregator::{
    CodexAggregator, CodexListenerStatus, COMPLETED_RETENTION_MS, INACTIVITY_TIMEOUT_MS,
};
use super::protocol::{
    CodexBridgeEvent, CodexEventSource, CodexEventType, CodexTaskPhase, PROTOCOL_VERSION,
};

fn session_started_event() -> CodexBridgeEvent {
    CodexBridgeEvent {
        version: PROTOCOL_VERSION,
        event_id: "event-1".to_string(),
        session_id: "session-1".to_string(),
        turn_id: Some("turn-1".to_string()),
        source: CodexEventSource::Cli,
        event_type: CodexEventType::SessionStarted,
        phase: CodexTaskPhase::Analyzing,
        project_name: Some("CodePulse".to_string()),
        task_summary: Some("实现 Codex 状态岛".to_string()),
        operation_summary: Some("开始任务".to_string()),
        error_summary: None,
        occurred_at_ms: 1_784_001_234_567,
    }
}

#[test]
fn creates_a_task_snapshot_from_a_session_started_event() {
    let mut aggregator = CodexAggregator::new(8);

    assert!(aggregator.apply(session_started_event()));

    let snapshot = aggregator.snapshot(CodexListenerStatus::WaitingForEvent, 1_784_001_234_568);
    assert_eq!(snapshot.revision, 1);
    assert_eq!(snapshot.generated_at_ms, 1_784_001_234_568);
    assert_eq!(
        snapshot.listener_status,
        CodexListenerStatus::WaitingForEvent
    );
    assert_eq!(snapshot.tasks.len(), 1);
    assert_eq!(snapshot.tasks[0].session_id, "session-1");
    assert_eq!(snapshot.tasks[0].turn_id.as_deref(), Some("turn-1"));
    assert_eq!(snapshot.tasks[0].source, CodexEventSource::Cli);
    assert_eq!(snapshot.tasks[0].phase, CodexTaskPhase::Analyzing);
    assert_eq!(snapshot.tasks[0].project_name.as_deref(), Some("CodePulse"));
    assert_eq!(
        snapshot.tasks[0].task_summary.as_deref(),
        Some("实现 Codex 状态岛")
    );
    assert_eq!(
        snapshot.representative_task,
        Some(snapshot.tasks[0].clone())
    );
    assert!(!snapshot.has_waiting_approval);
    assert!(!snapshot.has_failed_task);
}

#[test]
fn ignores_a_duplicate_event_id_without_advancing_the_revision() {
    let mut aggregator = CodexAggregator::new(8);
    let event = session_started_event();

    assert!(aggregator.apply(event.clone()));
    assert!(!aggregator.apply(event));

    let snapshot = aggregator.snapshot(CodexListenerStatus::Running, 1_784_001_234_568);
    assert_eq!(snapshot.revision, 1);
    assert_eq!(snapshot.tasks.len(), 1);
}

#[test]
fn preserves_existing_safe_metadata_when_a_later_event_omits_it() {
    let mut aggregator = CodexAggregator::new(8);
    let mut later_event = session_started_event();
    later_event.event_id = "event-2".to_string();
    later_event.event_type = CodexEventType::ToolStarted;
    later_event.phase = CodexTaskPhase::RunningTests;
    later_event.project_name = None;
    later_event.task_summary = None;
    later_event.operation_summary = Some("运行测试".to_string());
    later_event.occurred_at_ms += 1;

    assert!(aggregator.apply(session_started_event()));
    assert!(aggregator.apply(later_event));

    let snapshot = aggregator.snapshot(CodexListenerStatus::Running, 1_784_001_234_569);
    assert_eq!(snapshot.tasks[0].phase, CodexTaskPhase::RunningTests);
    assert_eq!(snapshot.tasks[0].project_name.as_deref(), Some("CodePulse"));
    assert_eq!(
        snapshot.tasks[0].task_summary.as_deref(),
        Some("实现 Codex 状态岛")
    );
    assert_eq!(
        snapshot.tasks[0].operation_summary.as_deref(),
        Some("运行测试")
    );
}

#[test]
fn only_a_turn_stop_event_can_mark_a_task_as_failed() {
    let mut aggregator = CodexAggregator::new(8);
    let mut invalid_tool_event = session_started_event();
    invalid_tool_event.event_id = "event-2".to_string();
    invalid_tool_event.event_type = CodexEventType::ToolFinished;
    invalid_tool_event.phase = CodexTaskPhase::Failed;
    invalid_tool_event.error_summary = Some("工具失败".to_string());
    invalid_tool_event.occurred_at_ms += 1;

    assert!(aggregator.apply(session_started_event()));
    assert!(aggregator.apply(invalid_tool_event));

    let snapshot = aggregator.snapshot(CodexListenerStatus::Running, 1_784_001_234_569);
    assert_ne!(snapshot.tasks[0].phase, CodexTaskPhase::Failed);
    assert!(!snapshot.has_failed_task);
}

#[test]
fn does_not_reactivate_a_failed_task_until_a_new_turn_starts() {
    let mut aggregator = CodexAggregator::new(8);
    let mut failed_event = session_started_event();
    failed_event.event_id = "event-failed".to_string();
    failed_event.event_type = CodexEventType::TurnStopped;
    failed_event.phase = CodexTaskPhase::Failed;
    failed_event.occurred_at_ms = 1_784_001_234_600;

    let mut later_tool_event = session_started_event();
    later_tool_event.event_id = "event-later-tool".to_string();
    later_tool_event.event_type = CodexEventType::ToolStarted;
    later_tool_event.phase = CodexTaskPhase::RunningCommand;
    later_tool_event.occurred_at_ms = 1_784_001_234_601;

    assert!(aggregator.apply(failed_event));
    assert!(!aggregator.apply(later_tool_event));

    let snapshot = aggregator.snapshot(CodexListenerStatus::Running, 1_784_001_234_602);
    assert_eq!(snapshot.tasks[0].phase, CodexTaskPhase::Failed);
    assert!(snapshot.has_failed_task);
    assert_eq!(snapshot.revision, 1);
}

#[test]
fn starts_a_new_turn_by_clearing_the_previous_terminal_failure() {
    let mut aggregator = CodexAggregator::new(8);
    let mut failed_event = session_started_event();
    failed_event.event_id = "event-failed".to_string();
    failed_event.event_type = CodexEventType::TurnStopped;
    failed_event.phase = CodexTaskPhase::Failed;
    failed_event.error_summary = Some("测试失败".to_string());
    failed_event.occurred_at_ms = 1_784_001_234_600;

    let mut turn_started_event = session_started_event();
    turn_started_event.event_id = "event-new-turn".to_string();
    turn_started_event.turn_id = Some("turn-2".to_string());
    turn_started_event.event_type = CodexEventType::TurnStarted;
    turn_started_event.phase = CodexTaskPhase::Failed;
    turn_started_event.error_summary = None;
    turn_started_event.occurred_at_ms = 1_784_001_234_601;

    assert!(aggregator.apply(failed_event));
    assert!(aggregator.apply(turn_started_event));

    let snapshot = aggregator.snapshot(CodexListenerStatus::Running, 1_784_001_234_602);
    assert_eq!(snapshot.tasks[0].turn_id.as_deref(), Some("turn-2"));
    assert_eq!(snapshot.tasks[0].phase, CodexTaskPhase::Analyzing);
    assert!(snapshot.tasks[0].error_summary.is_none());
    assert!(!snapshot.has_failed_task);
}

#[test]
fn chooses_a_waiting_approval_task_as_the_representative_over_newer_running_work() {
    let mut aggregator = CodexAggregator::new(8);
    let mut approval_event = session_started_event();
    approval_event.event_id = "event-approval".to_string();
    approval_event.session_id = "session-approval".to_string();
    approval_event.event_type = CodexEventType::PermissionRequested;
    approval_event.phase = CodexTaskPhase::WaitingApproval;
    approval_event.occurred_at_ms = 1_784_001_234_500;

    let mut running_event = session_started_event();
    running_event.event_id = "event-running".to_string();
    running_event.session_id = "session-running".to_string();
    running_event.event_type = CodexEventType::ToolStarted;
    running_event.phase = CodexTaskPhase::RunningCommand;
    running_event.occurred_at_ms = 1_784_001_234_600;

    assert!(aggregator.apply(approval_event));
    assert!(aggregator.apply(running_event));

    let snapshot = aggregator.snapshot(CodexListenerStatus::Running, 1_784_001_234_700);
    assert_eq!(snapshot.tasks[0].session_id, "session-running");
    assert_eq!(
        snapshot.representative_task.as_ref().map(|task| task.session_id.as_str()),
        Some("session-approval")
    );
    assert!(snapshot.has_waiting_approval);
}

#[test]
fn chooses_a_waiting_input_task_as_the_representative_and_keeps_it_until_a_tool_finishes() {
    let mut aggregator = CodexAggregator::new(8);
    let mut waiting_event = session_started_event();
    waiting_event.event_id = "event-waiting-input".to_string();
    waiting_event.session_id = "session-waiting-input".to_string();
    waiting_event.event_type = CodexEventType::ToolStarted;
    waiting_event.phase = CodexTaskPhase::WaitingInput;
    waiting_event.occurred_at_ms = 1_784_001_234_500;

    let mut running_event = session_started_event();
    running_event.event_id = "event-running".to_string();
    running_event.session_id = "session-running".to_string();
    running_event.event_type = CodexEventType::ToolStarted;
    running_event.phase = CodexTaskPhase::Generating;
    running_event.occurred_at_ms = 1_784_001_234_600;

    assert!(aggregator.apply(waiting_event.clone()));
    assert!(aggregator.apply(running_event));
    assert!(!aggregator.expire(waiting_event.occurred_at_ms + INACTIVITY_TIMEOUT_MS));

    let snapshot = aggregator.snapshot(CodexListenerStatus::Running, 1_784_001_534_600);
    assert_eq!(
        snapshot.representative_task.as_ref().map(|task| task.session_id.as_str()),
        Some("session-waiting-input")
    );
    assert_eq!(
        snapshot
            .tasks
            .iter()
            .find(|task| task.session_id == "session-waiting-input")
            .map(|task| task.phase),
        Some(CodexTaskPhase::WaitingInput)
    );

    let mut resumed_event = waiting_event;
    resumed_event.event_id = "event-resumed".to_string();
    resumed_event.event_type = CodexEventType::ToolFinished;
    resumed_event.phase = CodexTaskPhase::Analyzing;
    resumed_event.occurred_at_ms += INACTIVITY_TIMEOUT_MS + 1;
    assert!(aggregator.apply(resumed_event));

    let resumed_snapshot = aggregator.snapshot(CodexListenerStatus::Running, 1_784_001_534_601);
    assert_eq!(
        resumed_snapshot
            .representative_task
            .as_ref()
            .map(|task| task.session_id.as_str()),
        Some("session-waiting-input")
    );
    assert_eq!(
        resumed_snapshot.representative_task.as_ref().map(|task| task.phase),
        Some(CodexTaskPhase::Analyzing)
    );
}

#[test]
fn applies_context_compaction_events_and_clears_all_task_summaries() {
    let mut aggregator = CodexAggregator::new(8);
    let mut compacting_event = session_started_event();
    compacting_event.event_id = "event-compacting".to_string();
    compacting_event.event_type = CodexEventType::ContextCompactionStarted;
    compacting_event.phase = CodexTaskPhase::Compacting;
    compacting_event.occurred_at_ms += 1;

    assert!(aggregator.apply(session_started_event()));
    assert!(aggregator.apply(compacting_event));
    assert!(aggregator.clear_task_summaries());

    let snapshot = aggregator.snapshot(CodexListenerStatus::Running, 1_784_001_234_569);
    assert_eq!(snapshot.tasks[0].phase, CodexTaskPhase::Compacting);
    assert!(snapshot.tasks[0].task_summary.is_none());
    assert!(!aggregator.clear_task_summaries());
}

#[test]
fn removes_a_completed_task_after_its_retention_period() {
    let mut aggregator = CodexAggregator::new(8);
    let mut completed_event = session_started_event();
    completed_event.event_id = "event-completed".to_string();
    completed_event.event_type = CodexEventType::TurnStopped;
    completed_event.phase = CodexTaskPhase::Completed;
    completed_event.occurred_at_ms = 1_784_001_234_600;

    assert!(aggregator.apply(session_started_event()));
    assert!(aggregator.apply(completed_event));
    assert!(!aggregator.expire(1_784_001_234_600 + COMPLETED_RETENTION_MS - 1));
    assert!(aggregator.expire(1_784_001_234_600 + COMPLETED_RETENTION_MS));

    let snapshot = aggregator.snapshot(CodexListenerStatus::Running, 1_784_001_264_600);
    assert!(snapshot.tasks.is_empty());
    assert_eq!(snapshot.revision, 3);
}

#[test]
fn removes_an_interrupted_task_after_its_retention_period() {
    let mut aggregator = CodexAggregator::new(8);
    let mut interrupted_event = session_started_event();
    interrupted_event.event_id = "event-interrupted".to_string();
    interrupted_event.event_type = CodexEventType::TurnStopped;
    interrupted_event.phase = CodexTaskPhase::Interrupted;
    interrupted_event.occurred_at_ms = 1_784_001_234_600;

    assert!(aggregator.apply(session_started_event()));
    assert!(aggregator.apply(interrupted_event));
    assert!(aggregator.expire(1_784_001_234_600 + COMPLETED_RETENTION_MS));

    let snapshot = aggregator.snapshot(CodexListenerStatus::Running, 1_784_001_264_600);
    assert!(snapshot.tasks.is_empty());
}

#[test]
fn marks_an_inactive_running_task_as_interrupted() {
    let mut aggregator = CodexAggregator::new(8);
    let mut running_event = session_started_event();
    running_event.event_type = CodexEventType::ToolStarted;
    running_event.phase = CodexTaskPhase::RunningCommand;
    running_event.occurred_at_ms = 1_784_001_234_600;

    assert!(aggregator.apply(running_event));
    assert!(!aggregator.expire(1_784_001_234_600 + INACTIVITY_TIMEOUT_MS - 1));
    assert!(aggregator.expire(1_784_001_234_600 + INACTIVITY_TIMEOUT_MS));

    let snapshot = aggregator.snapshot(CodexListenerStatus::Running, 1_784_001_534_600);
    assert_eq!(snapshot.tasks[0].phase, CodexTaskPhase::Interrupted);
    assert_eq!(snapshot.revision, 2);
}

#[test]
fn clears_only_the_requested_failed_task() {
    let mut aggregator = CodexAggregator::new(8);
    let mut failed_event = session_started_event();
    failed_event.event_id = "event-failed".to_string();
    failed_event.session_id = "session-failed".to_string();
    failed_event.event_type = CodexEventType::TurnStopped;
    failed_event.phase = CodexTaskPhase::Failed;

    let mut active_event = session_started_event();
    active_event.event_id = "event-active".to_string();
    active_event.session_id = "session-active".to_string();
    active_event.event_type = CodexEventType::ToolStarted;
    active_event.phase = CodexTaskPhase::RunningCommand;
    active_event.occurred_at_ms += 1;

    assert!(aggregator.apply(failed_event));
    assert!(aggregator.apply(active_event));
    assert!(!aggregator.clear_failed_task("session-active"));
    assert!(aggregator.clear_failed_task("session-failed"));

    let snapshot = aggregator.snapshot(CodexListenerStatus::Running, 1_784_001_234_569);
    assert_eq!(snapshot.tasks.len(), 1);
    assert_eq!(snapshot.tasks[0].session_id, "session-active");
    assert!(!snapshot.has_failed_task);
    assert_eq!(snapshot.revision, 3);
}

#[test]
fn ignores_an_out_of_order_event_that_would_regress_a_session_state() {
    let mut aggregator = CodexAggregator::new(8);
    let mut newer_event = session_started_event();
    newer_event.event_id = "event-newer".to_string();
    newer_event.event_type = CodexEventType::ToolStarted;
    newer_event.phase = CodexTaskPhase::RunningTests;
    newer_event.occurred_at_ms = 1_784_001_234_600;

    let mut older_event = session_started_event();
    older_event.event_id = "event-older".to_string();
    older_event.event_type = CodexEventType::TurnStopped;
    older_event.phase = CodexTaskPhase::Failed;
    older_event.occurred_at_ms = 1_784_001_234_500;

    assert!(aggregator.apply(newer_event));
    assert!(!aggregator.apply(older_event));

    let snapshot = aggregator.snapshot(CodexListenerStatus::Running, 1_784_001_234_700);
    assert_eq!(snapshot.tasks[0].phase, CodexTaskPhase::RunningTests);
    assert!(!snapshot.has_failed_task);
    assert_eq!(snapshot.revision, 1);
}

#[test]
fn does_not_advance_the_revision_when_a_new_event_keeps_the_task_unchanged() {
    let mut aggregator = CodexAggregator::new(8);
    let event = session_started_event();
    let mut identical_event = event.clone();
    identical_event.event_id = "event-2".to_string();

    assert!(aggregator.apply(event));
    assert!(!aggregator.apply(identical_event));

    let snapshot = aggregator.snapshot(CodexListenerStatus::Running, 1_784_001_234_568);
    assert_eq!(snapshot.revision, 1);
}

#[test]
fn reset_clears_tasks_and_allows_events_from_a_new_runtime() {
    let mut aggregator = CodexAggregator::new(8);
    let event = session_started_event();

    assert!(aggregator.apply(event.clone()));
    aggregator.reset();
    assert!(aggregator.apply(event));

    let snapshot = aggregator.snapshot(CodexListenerStatus::WaitingForEvent, 1_784_001_234_568);
    assert_eq!(snapshot.tasks.len(), 1);
    assert_eq!(snapshot.revision, 3);
}

#[test]
fn snapshot_omits_absent_optional_text_fields_from_the_public_contract() {
    let mut aggregator = CodexAggregator::new(8);
    let mut event = session_started_event();
    event.turn_id = None;
    event.project_name = None;
    event.task_summary = None;
    event.operation_summary = None;

    assert!(aggregator.apply(event));

    let snapshot = aggregator.snapshot(CodexListenerStatus::Running, 1_784_001_234_568);
    let task = &serde_json::to_value(snapshot).unwrap()["tasks"][0];
    assert!(task.get("turnId").is_none());
    assert!(task.get("projectName").is_none());
    assert!(task.get("taskSummary").is_none());
    assert!(task.get("operationSummary").is_none());
    assert!(task.get("errorSummary").is_none());
}

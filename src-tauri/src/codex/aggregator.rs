use std::collections::{HashMap, HashSet, VecDeque};

use serde::Serialize;

pub use crate::agent::AgentListenerStatus as CodexListenerStatus;

use super::protocol::{CodexBridgeEvent, CodexEventSource, CodexEventType, CodexTaskPhase};

pub const COMPLETED_RETENTION_MS: i64 = 30_000;
pub const INACTIVITY_TIMEOUT_MS: i64 = 5 * 60 * 1_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexTaskSnapshot {
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    pub source: CodexEventSource,
    pub phase: CodexTaskPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation_summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_summary: Option<String>,
    pub last_activity_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexStatusSnapshot {
    pub revision: u64,
    pub generated_at_ms: i64,
    pub tasks: Vec<CodexTaskSnapshot>,
    pub representative_task: Option<CodexTaskSnapshot>,
    pub has_waiting_approval: bool,
    pub has_failed_task: bool,
    pub listener_status: CodexListenerStatus,
}

pub struct CodexAggregator {
    tasks: HashMap<String, CodexTaskSnapshot>,
    processed_event_ids: HashSet<String>,
    processed_event_order: VecDeque<String>,
    event_cache_capacity: usize,
    revision: u64,
}

impl CodexAggregator {
    pub fn new(event_cache_capacity: usize) -> Self {
        Self {
            tasks: HashMap::new(),
            processed_event_ids: HashSet::new(),
            processed_event_order: VecDeque::new(),
            event_cache_capacity: event_cache_capacity.max(1),
            revision: 0,
        }
    }

    pub fn apply(&mut self, event: CodexBridgeEvent) -> bool {
        if !self.remember_event_id(event.event_id.clone()) {
            return false;
        }

        if self
            .tasks
            .get(&event.session_id)
            .is_some_and(|task| event.occurred_at_ms < task.last_activity_at_ms)
        {
            return false;
        }

        let existing_task = self.tasks.get(&event.session_id);
        let phase = phase_for_event(event.event_type, event.phase);
        if existing_task.is_some_and(|task| {
            is_terminal_phase(task.phase)
                && !is_terminal_phase(phase)
                && !matches!(
                    event.event_type,
                    CodexEventType::SessionStarted | CodexEventType::TurnStarted
                )
        }) {
            return false;
        }
        let project_name = event
            .project_name
            .or_else(|| existing_task.and_then(|task| task.project_name.clone()));
        let task_summary = event
            .task_summary
            .or_else(|| existing_task.and_then(|task| task.task_summary.clone()));

        let task = CodexTaskSnapshot {
            session_id: event.session_id.clone(),
            turn_id: event.turn_id,
            source: event.source,
            phase,
            project_name,
            task_summary,
            operation_summary: event.operation_summary,
            error_summary: event.error_summary,
            last_activity_at_ms: event.occurred_at_ms,
        };

        if existing_task.is_some_and(|existing_task| existing_task == &task) {
            return false;
        }

        self.tasks.insert(event.session_id, task);
        self.revision += 1;
        true
    }

    pub fn snapshot(
        &self,
        listener_status: CodexListenerStatus,
        generated_at_ms: i64,
    ) -> CodexStatusSnapshot {
        let mut tasks = self.tasks.values().cloned().collect::<Vec<_>>();
        tasks.sort_by(|left, right| {
            right
                .last_activity_at_ms
                .cmp(&left.last_activity_at_ms)
                .then_with(|| left.session_id.cmp(&right.session_id))
        });

        let representative_task = tasks
            .iter()
            .min_by(|left, right| {
                task_priority(left.phase)
                    .cmp(&task_priority(right.phase))
                    .then_with(|| right.last_activity_at_ms.cmp(&left.last_activity_at_ms))
                    .then_with(|| left.session_id.cmp(&right.session_id))
            })
            .cloned();
        let has_waiting_approval =
            tasks.iter().any(|task| task.phase == CodexTaskPhase::WaitingApproval);
        let has_failed_task = tasks.iter().any(|task| task.phase == CodexTaskPhase::Failed);

        CodexStatusSnapshot {
            revision: self.revision,
            generated_at_ms,
            tasks,
            representative_task,
            has_waiting_approval,
            has_failed_task,
            listener_status,
        }
    }

    pub fn expire(&mut self, now_ms: i64) -> bool {
        let expired_session_ids = self
            .tasks
            .iter()
            .filter(|(_, task)| {
                matches!(
                    task.phase,
                    CodexTaskPhase::Completed | CodexTaskPhase::Interrupted
                ) && now_ms.saturating_sub(task.last_activity_at_ms) >= COMPLETED_RETENTION_MS
            })
            .map(|(session_id, _)| session_id.clone())
            .collect::<Vec<_>>();
        let inactive_session_ids = self
            .tasks
            .iter()
            .filter(|(_, task)| {
                is_running_phase(task.phase)
                    && now_ms.saturating_sub(task.last_activity_at_ms) >= INACTIVITY_TIMEOUT_MS
            })
            .map(|(session_id, _)| session_id.clone())
            .collect::<Vec<_>>();

        if expired_session_ids.is_empty() && inactive_session_ids.is_empty() {
            return false;
        }

        for session_id in expired_session_ids {
            self.tasks.remove(&session_id);
        }
        for session_id in inactive_session_ids {
            if let Some(task) = self.tasks.get_mut(&session_id) {
                task.phase = CodexTaskPhase::Interrupted;
                task.last_activity_at_ms = now_ms;
            }
        }
        self.revision += 1;
        true
    }

    pub fn clear_failed_task(&mut self, session_id: &str) -> bool {
        if self
            .tasks
            .get(session_id)
            .is_none_or(|task| task.phase != CodexTaskPhase::Failed)
        {
            return false;
        }

        self.tasks.remove(session_id);
        self.revision += 1;
        true
    }

    pub fn clear_task_summaries(&mut self) -> bool {
        let mut changed = false;
        for task in self.tasks.values_mut() {
            changed |= task.task_summary.take().is_some();
        }
        if changed {
            self.revision += 1;
        }
        changed
    }

    pub(crate) fn reset(&mut self) {
        self.tasks.clear();
        self.processed_event_ids.clear();
        self.processed_event_order.clear();
        self.revision += 1;
    }

    fn remember_event_id(&mut self, event_id: String) -> bool {
        if !self.processed_event_ids.insert(event_id.clone()) {
            return false;
        }

        self.processed_event_order.push_back(event_id);
        if self.processed_event_order.len() > self.event_cache_capacity {
            if let Some(expired_event_id) = self.processed_event_order.pop_front() {
                self.processed_event_ids.remove(&expired_event_id);
            }
        }

        true
    }
}

fn phase_for_event(event_type: CodexEventType, phase: CodexTaskPhase) -> CodexTaskPhase {
    match event_type {
        CodexEventType::SessionStarted | CodexEventType::TurnStarted => CodexTaskPhase::Analyzing,
        CodexEventType::ToolStarted | CodexEventType::ToolFinished => {
            if is_active_tool_phase(phase) {
                phase
            } else {
                CodexTaskPhase::Analyzing
            }
        }
        CodexEventType::ContextCompactionStarted => CodexTaskPhase::Compacting,
        CodexEventType::ContextCompactionFinished => CodexTaskPhase::Analyzing,
        CodexEventType::PermissionRequested => CodexTaskPhase::WaitingApproval,
        CodexEventType::TurnStopped => {
            if is_terminal_phase(phase) {
                phase
            } else {
                CodexTaskPhase::Interrupted
            }
        }
        CodexEventType::SessionEnded => CodexTaskPhase::Interrupted,
    }
}

fn is_running_phase(phase: CodexTaskPhase) -> bool {
    matches!(
        phase,
        CodexTaskPhase::Analyzing
            | CodexTaskPhase::Reading
            | CodexTaskPhase::Editing
            | CodexTaskPhase::RunningCommand
            | CodexTaskPhase::RunningTests
            | CodexTaskPhase::Browsing
            | CodexTaskPhase::Generating
            | CodexTaskPhase::Delegating
            | CodexTaskPhase::Waiting
            | CodexTaskPhase::Compacting
    )
}

fn is_active_tool_phase(phase: CodexTaskPhase) -> bool {
    is_running_phase(phase) || phase == CodexTaskPhase::WaitingInput
}

fn is_terminal_phase(phase: CodexTaskPhase) -> bool {
    matches!(
        phase,
        CodexTaskPhase::Completed | CodexTaskPhase::Failed | CodexTaskPhase::Interrupted
    )
}

fn task_priority(phase: CodexTaskPhase) -> u8 {
    match phase {
        CodexTaskPhase::WaitingInput | CodexTaskPhase::WaitingApproval => 0,
        CodexTaskPhase::Failed => 1,
        CodexTaskPhase::Completed | CodexTaskPhase::Interrupted => 2,
        CodexTaskPhase::Analyzing
        | CodexTaskPhase::Reading
        | CodexTaskPhase::Editing
        | CodexTaskPhase::RunningCommand
        | CodexTaskPhase::RunningTests
        | CodexTaskPhase::Browsing
        | CodexTaskPhase::Generating
        | CodexTaskPhase::Delegating
        | CodexTaskPhase::Waiting
        | CodexTaskPhase::Compacting => 3,
    }
}

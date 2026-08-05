use std::collections::{HashMap, HashSet, VecDeque};

use serde::Serialize;

use crate::agent::protocol::{
    is_terminal_phase, task_priority, AgentEventType, AgentListenerStatus, AgentTaskPhase,
};

use super::protocol::{ClaudeBridgeEvent, ClaudeChildKind};

pub const COMPLETED_RETENTION_MS: i64 = 30_000;
pub const INACTIVITY_TIMEOUT_MS: i64 = 5 * 60 * 1_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeChildTaskSnapshot {
    pub task_key: String,
    pub child_kind: ClaudeChildKind,
    pub child_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_task_key: Option<String>,
    pub phase: AgentTaskPhase,
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
pub struct ClaudeSessionSnapshot {
    pub task_key: String,
    pub session_id: String,
    pub phase: AgentTaskPhase,
    pub effective_phase: AgentTaskPhase,
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
    pub children: Vec<ClaudeChildTaskSnapshot>,
    pub last_activity_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeStatusSnapshot {
    pub revision: u64,
    pub generated_at_ms: i64,
    pub sessions: Vec<ClaudeSessionSnapshot>,
    pub representative_session: Option<ClaudeSessionSnapshot>,
    pub has_waiting_approval: bool,
    pub has_failed_task: bool,
    pub listener_status: AgentListenerStatus,
}

#[derive(Debug, Clone)]
struct SessionState {
    session_id: String,
    phase: AgentTaskPhase,
    project_name: Option<String>,
    session_label: Option<String>,
    task_summary: Option<String>,
    operation_summary: Option<String>,
    error_summary: Option<String>,
    children: HashMap<String, ClaudeChildTaskSnapshot>,
    root_last_activity_at_ms: i64,
    last_activity_at_ms: i64,
}

pub struct ClaudeAggregator {
    sessions: HashMap<String, SessionState>,
    processed_event_ids: HashSet<String>,
    processed_event_order: VecDeque<String>,
    event_cache_capacity: usize,
    revision: u64,
}

impl ClaudeAggregator {
    pub fn new(event_cache_capacity: usize) -> Self {
        Self {
            sessions: HashMap::new(),
            processed_event_ids: HashSet::new(),
            processed_event_order: VecDeque::new(),
            event_cache_capacity: event_cache_capacity.max(1),
            revision: 0,
        }
    }

    pub fn apply(&mut self, event: ClaudeBridgeEvent) -> bool {
        if !self.remember_event_id(event.event_id.clone()) {
            return false;
        }
        if let Some(child_id) = event.child_id.clone() {
            return self.apply_child(event, child_id);
        }
        self.apply_session(event)
    }

    pub fn snapshot(
        &self,
        listener_status: AgentListenerStatus,
        generated_at_ms: i64,
    ) -> ClaudeStatusSnapshot {
        let mut sessions = self.sessions.values().map(session_snapshot).collect::<Vec<_>>();
        sessions.sort_by(|left, right| {
            right
                .last_activity_at_ms
                .cmp(&left.last_activity_at_ms)
                .then_with(|| left.session_id.cmp(&right.session_id))
        });
        let representative_session = sessions
            .iter()
            .min_by(|left, right| {
                task_priority(left.effective_phase)
                    .cmp(&task_priority(right.effective_phase))
                    .then_with(|| right.last_activity_at_ms.cmp(&left.last_activity_at_ms))
                    .then_with(|| left.session_id.cmp(&right.session_id))
            })
            .cloned();
        let has_waiting_approval = sessions
            .iter()
            .any(|session| session.effective_phase == AgentTaskPhase::WaitingApproval);
        let has_failed_task = sessions.iter().any(|session| {
            session.phase == AgentTaskPhase::Failed
                || session.children.iter().any(|child| child.phase == AgentTaskPhase::Failed)
        });

        ClaudeStatusSnapshot {
            revision: self.revision,
            generated_at_ms,
            sessions,
            representative_session,
            has_waiting_approval,
            has_failed_task,
            listener_status,
        }
    }

    pub fn clear_failed_task(&mut self, task_key: &str) -> bool {
        let failed_session_id = self.sessions.iter().find_map(|(session_id, session)| {
            let snapshot = session_snapshot(session);
            (snapshot.task_key == task_key && snapshot.phase == AgentTaskPhase::Failed)
                .then(|| session_id.clone())
        });
        if let Some(session_id) = failed_session_id {
            self.sessions.remove(&session_id);
            self.revision += 1;
            return true;
        }

        for session in self.sessions.values_mut() {
            let failed_child_key = session.children.iter().find_map(|(child_key, child)| {
                (child.task_key == task_key && child.phase == AgentTaskPhase::Failed)
                    .then(|| child_key.clone())
            });
            if let Some(child_key) = failed_child_key {
                session.children.remove(&child_key);
                self.revision += 1;
                return true;
            }
        }
        false
    }

    pub fn clear_task_summaries(&mut self) -> bool {
        let mut changed = false;
        for session in self.sessions.values_mut() {
            changed |= session.task_summary.take().is_some();
            for child in session.children.values_mut() {
                changed |= child.task_summary.take().is_some();
            }
        }
        if changed {
            self.revision += 1;
        }
        changed
    }

    pub fn expire(&mut self, now_ms: i64) -> bool {
        let mut changed = false;
        self.sessions.retain(|_, session| {
            let has_failed_child =
                session.children.values().any(|child| child.phase == AgentTaskPhase::Failed);
            let expired = matches!(
                session.phase,
                AgentTaskPhase::Completed | AgentTaskPhase::Interrupted
            ) && !has_failed_child
                && now_ms.saturating_sub(session.last_activity_at_ms) >= COMPLETED_RETENTION_MS;
            changed |= expired;
            !expired
        });
        for session in self.sessions.values_mut() {
            if !is_terminal_phase(session.phase)
                && now_ms.saturating_sub(session.last_activity_at_ms) >= INACTIVITY_TIMEOUT_MS
            {
                session.phase = AgentTaskPhase::Interrupted;
                session.last_activity_at_ms = now_ms;
                for child in session.children.values_mut() {
                    if !is_terminal_phase(child.phase) {
                        child.phase = AgentTaskPhase::Interrupted;
                        child.last_activity_at_ms = now_ms;
                    }
                }
                changed = true;
            }
            session.children.retain(|_, child| {
                let expired = matches!(
                    child.phase,
                    AgentTaskPhase::Completed | AgentTaskPhase::Interrupted
                ) && now_ms.saturating_sub(child.last_activity_at_ms)
                    >= COMPLETED_RETENTION_MS;
                changed |= expired;
                !expired
            });
        }
        if changed {
            self.revision += 1;
        }
        changed
    }

    pub(crate) fn reset(&mut self) {
        self.sessions.clear();
        self.processed_event_ids.clear();
        self.processed_event_order.clear();
        self.revision += 1;
    }

    fn apply_session(&mut self, event: ClaudeBridgeEvent) -> bool {
        if self
            .sessions
            .get(&event.session_id)
            .is_some_and(|session| event.occurred_at_ms < session.root_last_activity_at_ms)
        {
            return false;
        }
        if self.sessions.get(&event.session_id).is_some_and(|session| {
            matches!(
                event.event_type,
                AgentEventType::TurnStopped | AgentEventType::SessionEnded
            ) && event.occurred_at_ms < session.last_activity_at_ms
        }) {
            return false;
        }

        let existing = self.sessions.get(&event.session_id);
        let previous_phase = existing.map(|session| session.phase);
        let phase = session_phase_for_event(&event, existing);
        if previous_phase.is_some_and(|phase| {
            is_terminal_phase(phase)
                && !is_terminal_phase(event.phase)
                && !matches!(
                    event.event_type,
                    AgentEventType::SessionStarted | AgentEventType::TurnStarted
                )
        }) {
            return false;
        }

        let session =
            self.sessions.entry(event.session_id.clone()).or_insert_with(|| SessionState {
                session_id: event.session_id.clone(),
                phase: AgentTaskPhase::Analyzing,
                project_name: None,
                session_label: None,
                task_summary: None,
                operation_summary: None,
                error_summary: None,
                children: HashMap::new(),
                root_last_activity_at_ms: 0,
                last_activity_at_ms: 0,
            });
        session.phase = phase;
        session.project_name = event.project_name.or_else(|| session.project_name.clone());
        session.session_label = event.session_label.or_else(|| session.session_label.clone());
        session.task_summary = event.task_summary.or_else(|| session.task_summary.clone());
        session.operation_summary = event.operation_summary;
        session.error_summary = event.error_summary;
        session.root_last_activity_at_ms = event.occurred_at_ms;
        session.last_activity_at_ms = session.last_activity_at_ms.max(event.occurred_at_ms);
        if event.event_type == AgentEventType::SessionEnded {
            for child in session.children.values_mut() {
                if !is_terminal_phase(child.phase) {
                    child.phase = AgentTaskPhase::Interrupted;
                    child.last_activity_at_ms = event.occurred_at_ms;
                }
            }
        }
        self.revision += 1;
        true
    }

    fn apply_child(&mut self, event: ClaudeBridgeEvent, child_id: String) -> bool {
        let child_kind = match event.child_kind {
            Some(value) => value,
            None => return false,
        };
        let task_key = child_task_key(child_kind, &event.session_id, &child_id);
        let session =
            self.sessions.entry(event.session_id.clone()).or_insert_with(|| SessionState {
                session_id: event.session_id.clone(),
                phase: AgentTaskPhase::Analyzing,
                project_name: event.project_name.clone(),
                session_label: event.session_label.clone(),
                task_summary: None,
                operation_summary: None,
                error_summary: None,
                children: HashMap::new(),
                root_last_activity_at_ms: 0,
                last_activity_at_ms: event.occurred_at_ms,
            });
        if session
            .children
            .get(&task_key)
            .is_some_and(|child| event.occurred_at_ms < child.last_activity_at_ms)
        {
            return false;
        }
        let phase = child_phase_for_event(event.event_type, event.phase);
        if session.children.get(&task_key).is_some_and(|child| {
            is_terminal_phase(child.phase)
                && !is_terminal_phase(phase)
                && event.event_type != AgentEventType::ChildStarted
        }) {
            return false;
        }
        let parent_task_key = event.parent_child_id.as_ref().map(|parent_id| {
            child_task_key(ClaudeChildKind::Subagent, &event.session_id, parent_id)
        });
        let existing = session.children.get(&task_key);
        let child = ClaudeChildTaskSnapshot {
            task_key: task_key.clone(),
            child_kind,
            child_id: child_id.clone(),
            parent_task_key,
            phase,
            task_summary: event
                .task_summary
                .or_else(|| existing.and_then(|child| child.task_summary.clone())),
            operation_summary: event.operation_summary,
            error_summary: event.error_summary,
            last_activity_at_ms: event.occurred_at_ms,
        };
        if existing == Some(&child) {
            return false;
        }
        session.children.insert(task_key, child);
        let has_active_children =
            session.children.values().any(|child| !is_terminal_phase(child.phase));
        if session.phase == AgentTaskPhase::Completed && has_active_children {
            session.phase = AgentTaskPhase::Waiting;
        } else if session.phase == AgentTaskPhase::Waiting && !has_active_children {
            session.phase = AgentTaskPhase::Completed;
        }
        session.project_name = event.project_name.or_else(|| session.project_name.clone());
        session.last_activity_at_ms = session.last_activity_at_ms.max(event.occurred_at_ms);
        self.revision += 1;
        true
    }

    fn remember_event_id(&mut self, event_id: String) -> bool {
        if !self.processed_event_ids.insert(event_id.clone()) {
            return false;
        }
        self.processed_event_order.push_back(event_id);
        if self.processed_event_order.len() > self.event_cache_capacity {
            if let Some(expired) = self.processed_event_order.pop_front() {
                self.processed_event_ids.remove(&expired);
            }
        }
        true
    }
}

fn session_snapshot(session: &SessionState) -> ClaudeSessionSnapshot {
    let mut children = session.children.values().cloned().collect::<Vec<_>>();
    children.sort_by(|left, right| {
        right
            .last_activity_at_ms
            .cmp(&left.last_activity_at_ms)
            .then_with(|| left.task_key.cmp(&right.task_key))
    });
    let effective_phase = children
        .iter()
        .filter(|child| {
            matches!(
                child.phase,
                AgentTaskPhase::WaitingInput
                    | AgentTaskPhase::WaitingApproval
                    | AgentTaskPhase::Failed
            )
        })
        .min_by(|left, right| {
            task_priority(left.phase)
                .cmp(&task_priority(right.phase))
                .then_with(|| right.last_activity_at_ms.cmp(&left.last_activity_at_ms))
        })
        .map(|child| child.phase)
        .unwrap_or(session.phase);

    ClaudeSessionSnapshot {
        task_key: session_task_key(&session.session_id),
        session_id: session.session_id.clone(),
        phase: session.phase,
        effective_phase,
        project_name: session.project_name.clone(),
        session_label: session.session_label.clone(),
        task_summary: session.task_summary.clone(),
        operation_summary: session.operation_summary.clone(),
        error_summary: session.error_summary.clone(),
        children,
        last_activity_at_ms: session.last_activity_at_ms,
    }
}

fn session_phase_for_event(
    event: &ClaudeBridgeEvent,
    existing: Option<&SessionState>,
) -> AgentTaskPhase {
    match event.event_type {
        AgentEventType::SessionStarted | AgentEventType::TurnStarted => AgentTaskPhase::Analyzing,
        AgentEventType::ToolStarted => event.phase,
        AgentEventType::ToolFinished
        | AgentEventType::ContextCompactionFinished
        | AgentEventType::InputResolved => AgentTaskPhase::Analyzing,
        AgentEventType::ContextCompactionStarted => AgentTaskPhase::Compacting,
        AgentEventType::PermissionRequested => AgentTaskPhase::WaitingApproval,
        AgentEventType::InputRequested => AgentTaskPhase::WaitingInput,
        AgentEventType::TurnStopped if event.phase == AgentTaskPhase::Failed => {
            AgentTaskPhase::Failed
        }
        AgentEventType::TurnStopped => {
            if existing.is_some_and(|session| {
                session.children.values().any(|child| !is_terminal_phase(child.phase))
            }) {
                AgentTaskPhase::Waiting
            } else {
                AgentTaskPhase::Completed
            }
        }
        AgentEventType::SessionEnded => AgentTaskPhase::Interrupted,
        AgentEventType::ChildStarted | AgentEventType::ChildStopped => {
            existing.map(|session| session.phase).unwrap_or(AgentTaskPhase::Analyzing)
        }
    }
}

fn child_phase_for_event(event_type: AgentEventType, phase: AgentTaskPhase) -> AgentTaskPhase {
    match event_type {
        AgentEventType::ChildStarted => AgentTaskPhase::Analyzing,
        AgentEventType::ChildStopped => {
            if is_terminal_phase(phase) {
                phase
            } else {
                AgentTaskPhase::Completed
            }
        }
        AgentEventType::ToolStarted => phase,
        AgentEventType::ToolFinished
        | AgentEventType::ContextCompactionFinished
        | AgentEventType::InputResolved => AgentTaskPhase::Analyzing,
        AgentEventType::ContextCompactionStarted => AgentTaskPhase::Compacting,
        AgentEventType::PermissionRequested => AgentTaskPhase::WaitingApproval,
        AgentEventType::InputRequested => AgentTaskPhase::WaitingInput,
        AgentEventType::SessionEnded => AgentTaskPhase::Interrupted,
        _ => phase,
    }
}

fn session_task_key(session_id: &str) -> String {
    format!("claude:session:{session_id}")
}

fn child_task_key(kind: ClaudeChildKind, session_id: &str, child_id: &str) -> String {
    let kind = match kind {
        ClaudeChildKind::Subagent => "subagent",
        ClaudeChildKind::Task => "task",
    };
    format!("claude:{kind}:{session_id}:{child_id}")
}

use std::io::Read;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::agent::hook_input::{
    parse_agent_hook_input, AgentHookInput, MAX_AGENT_HOOK_INPUT_BYTES,
};
use crate::agent::runtime_discovery::{read_agent_discovery, RUNTIME_DISCOVERY_FILE_NAME};
use crate::agent::{AgentEventType, AgentProvider, AgentTaskPhase};
use uuid::Uuid;

use super::protocol::{ClaudeBridgeEvent, ClaudeChildKind, CLAUDE_PROTOCOL_VERSION};

pub const MAX_HOOK_INPUT_BYTES: usize = MAX_AGENT_HOOK_INPUT_BYTES;
const DEFAULT_REQUEST_TIMEOUT: Duration = Duration::from_millis(300);
const APPLICATION_DATA_DIRECTORY: &str = "com.codepulse.app";

#[derive(Debug, Clone)]
pub struct BridgeConfig {
    discovery_path: PathBuf,
    request_timeout: Duration,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BridgeOutcome {
    Delivered,
    Ignored,
}

impl BridgeConfig {
    pub fn new(discovery_path: PathBuf) -> Self {
        Self {
            discovery_path,
            request_timeout: DEFAULT_REQUEST_TIMEOUT,
        }
    }

    pub fn from_process_environment() -> Option<Self> {
        bridge_discovery_path().map(Self::new)
    }

    pub fn with_request_timeout(mut self, request_timeout: Duration) -> Self {
        self.request_timeout = request_timeout;
        self
    }
}

pub fn event_from_hook_reader(
    reader: &mut impl Read,
    event_id: &str,
    occurred_at_ms: i64,
    capture_task_summary: bool,
) -> Option<ClaudeBridgeEvent> {
    let input = parse_agent_hook_input(reader, capture_task_summary)?;
    event_from_hook_input(input, event_id, occurred_at_ms, capture_task_summary)
}

pub async fn run_from_stdin() {
    let Some(config) = BridgeConfig::from_process_environment() else {
        return;
    };
    let mut stdin = std::io::stdin().lock();
    let _ = forward_hook_reader(&mut stdin, &config).await;
}

pub async fn forward_hook_reader(reader: &mut impl Read, config: &BridgeConfig) -> BridgeOutcome {
    let Ok(discovery) = read_agent_discovery(&config.discovery_path) else {
        return BridgeOutcome::Ignored;
    };
    let Some(event) = event_from_hook_reader(
        reader,
        &Uuid::new_v4().to_string(),
        current_time_ms(),
        discovery.capture_task_summary_for(AgentProvider::Claude),
    ) else {
        return BridgeOutcome::Ignored;
    };
    let Ok(client) = reqwest::Client::builder().timeout(config.request_timeout).build() else {
        return BridgeOutcome::Ignored;
    };
    let url = format!("http://127.0.0.1:{}/events", discovery.runtime.port);
    match client
        .post(url)
        .header(
            "Authorization",
            format!("Bearer {}", discovery.runtime.token),
        )
        .json(&event)
        .send()
        .await
    {
        Ok(response) if response.status().as_u16() == 202 => BridgeOutcome::Delivered,
        _ => BridgeOutcome::Ignored,
    }
}

fn event_from_hook_input(
    input: AgentHookInput,
    event_id: &str,
    occurred_at_ms: i64,
    capture_task_summary: bool,
) -> Option<ClaudeBridgeEvent> {
    let session_id = input.session_id.clone()?;
    let hook_event_name = input.hook_event_name.clone()?;
    let (event_type, phase, operation_summary) = classify_hook(&hook_event_name, &input)?;
    let (child_kind, child_id) = child_identity(&hook_event_name, &input);
    let task_summary = if capture_task_summary {
        match hook_event_name.as_str() {
            "UserPromptSubmit" => input.prompt,
            "TaskCreated" => input.subject,
            _ => None,
        }
    } else {
        None
    };

    ClaudeBridgeEvent {
        version: CLAUDE_PROTOCOL_VERSION,
        provider: AgentProvider::Claude,
        event_id: event_id.to_string(),
        session_id,
        child_kind,
        child_id,
        parent_child_id: input.parent_agent_id,
        event_type,
        phase,
        project_name: project_name_from_cwd(input.cwd.as_deref()),
        session_label: None,
        task_summary,
        operation_summary: Some(operation_summary.to_string()),
        error_summary: None,
        occurred_at_ms,
    }
    .sanitize_and_validate()
    .ok()
}

fn classify_hook(
    hook_event_name: &str,
    input: &AgentHookInput,
) -> Option<(AgentEventType, AgentTaskPhase, &'static str)> {
    match hook_event_name {
        "SessionStart" => Some((
            AgentEventType::SessionStarted,
            AgentTaskPhase::Analyzing,
            "开始会话",
        )),
        "UserPromptSubmit" => Some((
            AgentEventType::TurnStarted,
            AgentTaskPhase::Analyzing,
            "分析任务",
        )),
        "PreToolUse" => {
            let (phase, summary) =
                classify_tool(input.tool_name.as_deref(), input.command_prefix.as_deref());
            Some((AgentEventType::ToolStarted, phase, summary))
        }
        "PostToolUse" | "PostToolUseFailure" => Some((
            AgentEventType::ToolFinished,
            AgentTaskPhase::Analyzing,
            "继续分析",
        )),
        "PermissionRequest" => Some((
            AgentEventType::PermissionRequested,
            AgentTaskPhase::WaitingApproval,
            "等待授权",
        )),
        "SubagentStart" | "TaskCreated" => Some((
            AgentEventType::ChildStarted,
            AgentTaskPhase::Analyzing,
            if hook_event_name == "SubagentStart" {
                "分派子任务"
            } else {
                "创建任务"
            },
        )),
        "SubagentStop" => Some((
            AgentEventType::ChildStopped,
            if has_failed_status(input.status.as_deref()) {
                AgentTaskPhase::Failed
            } else {
                AgentTaskPhase::Completed
            },
            if has_failed_status(input.status.as_deref()) {
                "子任务失败"
            } else {
                "子任务完成"
            },
        )),
        "TaskCompleted" => Some((
            AgentEventType::ChildStopped,
            AgentTaskPhase::Completed,
            "任务完成",
        )),
        "Stop" => Some((
            AgentEventType::TurnStopped,
            AgentTaskPhase::Completed,
            "本轮完成",
        )),
        "StopFailure" => Some((
            AgentEventType::TurnStopped,
            AgentTaskPhase::Failed,
            "执行失败",
        )),
        "SessionEnd" => Some((
            AgentEventType::SessionEnded,
            AgentTaskPhase::Interrupted,
            "会话结束",
        )),
        "PreCompact" => Some((
            AgentEventType::ContextCompactionStarted,
            AgentTaskPhase::Compacting,
            "整理上下文",
        )),
        "PostCompact" => Some((
            AgentEventType::ContextCompactionFinished,
            AgentTaskPhase::Analyzing,
            "继续分析",
        )),
        "Elicitation" => Some((
            AgentEventType::InputRequested,
            AgentTaskPhase::WaitingInput,
            "等待回答",
        )),
        "ElicitationResult" => Some((
            AgentEventType::InputResolved,
            AgentTaskPhase::Analyzing,
            "继续分析",
        )),
        _ => None,
    }
}

fn child_identity(
    hook_event_name: &str,
    input: &AgentHookInput,
) -> (Option<ClaudeChildKind>, Option<String>) {
    if matches!(hook_event_name, "TaskCreated" | "TaskCompleted") {
        return (
            input.task_id.as_ref().map(|_| ClaudeChildKind::Task),
            input.task_id.clone(),
        );
    }
    if let Some(agent_id) = input.agent_id.clone() {
        return (Some(ClaudeChildKind::Subagent), Some(agent_id));
    }
    (None, None)
}

fn classify_tool(tool_name: Option<&str>, command: Option<&str>) -> (AgentTaskPhase, &'static str) {
    match tool_name.unwrap_or_default().to_ascii_lowercase().as_str() {
        "read" | "glob" | "grep" => (AgentTaskPhase::Reading, "读取项目"),
        "edit" | "write" | "notebookedit" => (AgentTaskPhase::Editing, "修改代码"),
        "bash" => {
            if command.is_some_and(is_test_command) {
                (AgentTaskPhase::RunningTests, "运行测试")
            } else {
                (AgentTaskPhase::RunningCommand, "运行命令")
            }
        }
        "webfetch" | "websearch" => (AgentTaskPhase::Browsing, "浏览网页"),
        "agent" => (AgentTaskPhase::Delegating, "分派子任务"),
        "askuserquestion" => (AgentTaskPhase::WaitingInput, "等待回答"),
        "exitplanmode" => (AgentTaskPhase::WaitingApproval, "等待授权"),
        _ => (AgentTaskPhase::Analyzing, "执行工具"),
    }
}

fn is_test_command(command: &str) -> bool {
    let command = command.trim().to_ascii_lowercase();
    [
        "cargo test",
        "pnpm test",
        "pnpm run test",
        "pytest",
        "python -m pytest",
        "vitest",
        "go test",
        "dotnet test",
    ]
    .into_iter()
    .any(|prefix| command == prefix || command.starts_with(&format!("{prefix} ")))
}

fn has_failed_status(status: Option<&str>) -> bool {
    status.is_some_and(|value| {
        matches!(
            value.to_ascii_lowercase().as_str(),
            "failed" | "failure" | "error" | "errored"
        )
    })
}

fn project_name_from_cwd(cwd: Option<&str>) -> Option<String> {
    let project_name = cwd?.rsplit(['\\', '/']).next()?.trim();
    (!project_name.is_empty()).then(|| project_name.to_string())
}

fn bridge_discovery_path() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("CODEPULSE_AGENT_DISCOVERY_FILE")
        .or_else(|| std::env::var_os("CODEPULSE_CODEX_DISCOVERY_FILE"))
    {
        return Some(PathBuf::from(path));
    }
    let app_data_dir = std::env::var_os("APPDATA").or_else(|| std::env::var_os("LOCALAPPDATA"))?;
    Some(
        PathBuf::from(app_data_dir)
            .join(APPLICATION_DATA_DIRECTORY)
            .join(RUNTIME_DISCOVERY_FILE_NAME),
    )
}

fn current_time_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(1)
}

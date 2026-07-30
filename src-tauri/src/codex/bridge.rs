use std::io::Read;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::Value;
use uuid::Uuid;

use super::protocol::{
    CodexBridgeEvent, CodexEventSource, CodexEventType, CodexTaskPhase, PROTOCOL_VERSION,
};
use super::runtime_discovery::{read_discovery, RUNTIME_DISCOVERY_FILE_NAME};

pub const MAX_HOOK_INPUT_BYTES: usize = 16 * 1024;
const DEFAULT_REQUEST_TIMEOUT: Duration = Duration::from_millis(750);
const APPLICATION_DATA_DIRECTORY: &str = "com.ryen.nsd";

#[derive(Debug, Clone)]
pub struct BridgeConfig {
    discovery_path: PathBuf,
    source: CodexEventSource,
    request_timeout: Duration,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BridgeOutcome {
    Delivered,
    Ignored,
}

impl BridgeConfig {
    pub fn new(discovery_path: PathBuf, source: CodexEventSource) -> Self {
        Self {
            discovery_path,
            source,
            request_timeout: DEFAULT_REQUEST_TIMEOUT,
        }
    }

    pub fn from_process_environment(source: CodexEventSource) -> Option<Self> {
        bridge_discovery_path().map(|path| Self::new(path, source))
    }

    pub fn with_request_timeout(mut self, request_timeout: Duration) -> Self {
        self.request_timeout = request_timeout;
        self
    }
}

pub fn event_from_hook_input(
    input: &[u8],
    source: CodexEventSource,
    event_id: &str,
    occurred_at_ms: i64,
    capture_task_summary: bool,
) -> Option<CodexBridgeEvent> {
    let input: Value = serde_json::from_slice(input).ok()?;
    let session_id = input.get("session_id")?.as_str()?.to_string();
    let turn_id = input.get("turn_id").and_then(Value::as_str).map(ToString::to_string);
    let hook_event_name = input.get("hook_event_name")?.as_str()?;
    let tool_name = input.get("tool_name").and_then(Value::as_str);
    let (event_type, phase, operation_summary) = classify_hook(hook_event_name, tool_name, &input)?;
    let task_summary = if capture_task_summary && hook_event_name == "UserPromptSubmit" {
        input.get("prompt").and_then(Value::as_str).map(ToString::to_string)
    } else {
        None
    };

    CodexBridgeEvent {
        version: PROTOCOL_VERSION,
        event_id: event_id.to_string(),
        session_id,
        turn_id,
        source,
        event_type,
        phase,
        project_name: project_name_from_input(&input),
        task_summary,
        operation_summary: Some(operation_summary.to_string()),
        error_summary: None,
        occurred_at_ms,
    }
    .sanitize_and_validate()
    .ok()
}

pub fn read_limited_hook_input(reader: &mut impl Read) -> Option<Vec<u8>> {
    let mut input = Vec::new();
    let mut limited_reader = reader.take((MAX_HOOK_INPUT_BYTES + 1) as u64);
    limited_reader.read_to_end(&mut input).ok()?;

    (!input.is_empty() && input.len() <= MAX_HOOK_INPUT_BYTES).then_some(input)
}

pub async fn run_from_stdin(source: CodexEventSource) {
    let mut stdin = std::io::stdin().lock();
    let Some(input) = read_limited_hook_input(&mut stdin) else {
        return;
    };
    let Some(config) = BridgeConfig::from_process_environment(source) else {
        return;
    };

    let _ = forward_hook_input(&input, &config).await;
}

pub async fn forward_hook_input(input: &[u8], config: &BridgeConfig) -> BridgeOutcome {
    let Ok(discovery) = read_discovery(&config.discovery_path) else {
        return BridgeOutcome::Ignored;
    };
    let Some(event) = event_from_hook_input(
        input,
        config.source,
        &Uuid::new_v4().to_string(),
        current_time_ms(),
        discovery.capture_task_summary,
    ) else {
        return BridgeOutcome::Ignored;
    };
    let Ok(client) = reqwest::Client::builder().timeout(config.request_timeout).build() else {
        return BridgeOutcome::Ignored;
    };
    let url = format!("http://127.0.0.1:{}/events", discovery.port);
    let response = client
        .post(url)
        .header("Authorization", format!("Bearer {}", discovery.token))
        .json(&event)
        .send()
        .await;

    match response {
        Ok(response) if response.status().as_u16() == 202 => BridgeOutcome::Delivered,
        _ => BridgeOutcome::Ignored,
    }
}

pub fn source_from_process_arguments() -> CodexEventSource {
    let mut arguments = std::env::args().skip(1);

    while let Some(argument) = arguments.next() {
        if let Some(source) = argument.strip_prefix("--source=") {
            return parse_source(source);
        }
        if argument == "--source" {
            return arguments
                .next()
                .map(|source| parse_source(&source))
                .unwrap_or(CodexEventSource::Unknown);
        }
    }

    CodexEventSource::Unknown
}

fn bridge_discovery_path() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("CODEPULSE_CODEX_DISCOVERY_FILE") {
        return Some(PathBuf::from(path));
    }

    let app_data_dir = std::env::var_os("APPDATA").or_else(|| std::env::var_os("LOCALAPPDATA"))?;
    Some(
        PathBuf::from(app_data_dir)
            .join(APPLICATION_DATA_DIRECTORY)
            .join(RUNTIME_DISCOVERY_FILE_NAME),
    )
}

fn parse_source(source: &str) -> CodexEventSource {
    match source {
        "cli" => CodexEventSource::Cli,
        "app" => CodexEventSource::App,
        _ => CodexEventSource::Unknown,
    }
}

fn current_time_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(1)
}

fn classify_hook(
    hook_event_name: &str,
    tool_name: Option<&str>,
    input: &Value,
) -> Option<(CodexEventType, CodexTaskPhase, &'static str)> {
    match hook_event_name {
        "SessionStart" | "SubagentStart" => Some((
            CodexEventType::SessionStarted,
            CodexTaskPhase::Analyzing,
            "开始任务",
        )),
        "UserPromptSubmit" => Some((
            CodexEventType::TurnStarted,
            CodexTaskPhase::Analyzing,
            "分析任务",
        )),
        "PreToolUse" => {
            let (phase, summary) = classify_tool(tool_name, input);
            Some((CodexEventType::ToolStarted, phase, summary))
        }
        "PostToolUse" => Some((
            CodexEventType::ToolFinished,
            CodexTaskPhase::Analyzing,
            "继续分析",
        )),
        "PreCompact" => Some((
            CodexEventType::ContextCompactionStarted,
            CodexTaskPhase::Compacting,
            "整理上下文",
        )),
        "PostCompact" => Some((
            CodexEventType::ContextCompactionFinished,
            CodexTaskPhase::Analyzing,
            "继续分析",
        )),
        "PermissionRequest" => Some((
            CodexEventType::PermissionRequested,
            CodexTaskPhase::WaitingApproval,
            "等待授权",
        )),
        "Stop" | "SubagentStop" => {
            let (phase, summary) = classify_stop(input);
            Some((CodexEventType::TurnStopped, phase, summary))
        }
        "SessionEnd" => Some((
            CodexEventType::SessionEnded,
            CodexTaskPhase::Interrupted,
            "任务结束",
        )),
        _ => None,
    }
}

fn classify_stop(input: &Value) -> (CodexTaskPhase, &'static str) {
    let result = ["stop_reason", "outcome", "status"]
        .into_iter()
        .find_map(|field| input.get(field).and_then(Value::as_str))
        .unwrap_or_default()
        .to_ascii_lowercase();

    if matches!(result.as_str(), "failed" | "failure" | "error" | "errored") {
        return (CodexTaskPhase::Failed, "任务失败");
    }
    if matches!(
        result.as_str(),
        "interrupted" | "cancelled" | "canceled" | "aborted" | "stopped"
    ) {
        return (CodexTaskPhase::Interrupted, "任务中断");
    }

    (CodexTaskPhase::Completed, "任务完成")
}

fn classify_tool(tool_name: Option<&str>, input: &Value) -> (CodexTaskPhase, &'static str) {
    let tool_name = tool_name.unwrap_or_default().to_ascii_lowercase();

    if tool_name.contains("request_user_input") {
        return (CodexTaskPhase::WaitingInput, "等待回答");
    }
    if tool_name.contains("browser") || tool_name.starts_with("web") {
        return (CodexTaskPhase::Browsing, "浏览网页");
    }
    if tool_name.contains("imagegen")
        || tool_name.contains("image_gen")
        || tool_name.contains("generate_image")
        || tool_name.contains("generate")
    {
        return (CodexTaskPhase::Generating, "生成内容");
    }
    if tool_name.contains("spawn_agent")
        || tool_name.contains("subagent")
        || tool_name.contains("dispatch")
    {
        return (CodexTaskPhase::Delegating, "分派子任务");
    }
    if tool_name.contains("wait") {
        return (CodexTaskPhase::Waiting, "等待任务");
    }
    if is_shell_tool(&tool_name) {
        if shell_input_is_safe_test(input) {
            return (CodexTaskPhase::RunningTests, "运行测试");
        }
        return (CodexTaskPhase::RunningCommand, "运行命令");
    }
    if tool_name.contains("test") {
        return (CodexTaskPhase::RunningTests, "运行测试");
    }
    if tool_name.contains("read") || tool_name.contains("list") || tool_name.contains("search") {
        return (CodexTaskPhase::Reading, "读取项目");
    }
    if tool_name.contains("edit") || tool_name.contains("write") || tool_name == "apply_patch" {
        return (CodexTaskPhase::Editing, "修改代码");
    }
    (CodexTaskPhase::Analyzing, "执行工具")
}

fn is_shell_tool(tool_name: &str) -> bool {
    tool_name == "bash"
        || tool_name.contains("shell")
        || tool_name.contains("exec")
        || tool_name.contains("command")
        || tool_name.contains("powershell")
}

fn shell_input_is_safe_test(input: &Value) -> bool {
    let Some(command) = input
        .get("tool_input")
        .and_then(|tool_input| tool_input.get("command"))
        .and_then(Value::as_str)
    else {
        return false;
    };
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

fn project_name_from_input(input: &Value) -> Option<String> {
    let cwd = input.get("cwd")?.as_str()?;
    let project_name = cwd.rsplit(['\\', '/']).next()?.trim();

    (!project_name.is_empty()).then(|| project_name.to_string())
}

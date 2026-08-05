use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use crate::claude::protocol::{ClaudeBridgeEvent, CLAUDE_PROTOCOL_VERSION};
use crate::codex::protocol::{
    CodexBridgeEvent, CodexEventSource, CodexEventType, CodexTaskPhase, PROTOCOL_VERSION,
};

use super::protocol::{AgentEventType, AgentProvider, AgentTaskPhase};
use super::runtime::AgentRuntime;
use super::runtime_discovery::read_agent_discovery;

fn temporary_directory() -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "codepulse-agent-runtime-{}-{}",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    fs::create_dir_all(&path).unwrap();
    path
}

#[tokio::test]
async fn 两个_provider_共用接收器并按单方启停隔离状态() {
    let directory = temporary_directory();
    let runtime = AgentRuntime::with_publishers(16, Arc::new(|_| {}), Arc::new(|_| {}));
    let codex_start = runtime.start_provider(AgentProvider::Codex, &directory).await.unwrap();
    let claude_start = runtime.start_provider(AgentProvider::Claude, &directory).await.unwrap();
    assert_eq!(codex_start.address, claude_start.address);

    let discovery = read_agent_discovery(&codex_start.discovery_path).unwrap();
    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{}/events", discovery.runtime.port);
    let codex = CodexBridgeEvent {
        version: PROTOCOL_VERSION,
        event_id: "codex-event".to_string(),
        session_id: "codex-session".to_string(),
        turn_id: None,
        source: CodexEventSource::Cli,
        event_type: CodexEventType::SessionStarted,
        phase: CodexTaskPhase::Analyzing,
        project_name: None,
        task_summary: None,
        operation_summary: None,
        error_summary: None,
        occurred_at_ms: 1_000,
    };
    let claude = ClaudeBridgeEvent {
        version: CLAUDE_PROTOCOL_VERSION,
        provider: AgentProvider::Claude,
        event_id: "claude-event".to_string(),
        session_id: "claude-session".to_string(),
        child_kind: None,
        child_id: None,
        parent_child_id: None,
        event_type: AgentEventType::SessionStarted,
        phase: AgentTaskPhase::Analyzing,
        project_name: None,
        session_label: None,
        task_summary: None,
        operation_summary: None,
        error_summary: None,
        occurred_at_ms: 1_001,
    };
    for payload in [
        serde_json::to_value(codex).unwrap(),
        serde_json::to_value(claude).unwrap(),
    ] {
        assert!(client
            .post(&url)
            .bearer_auth(&discovery.runtime.token)
            .json(&payload)
            .send()
            .await
            .unwrap()
            .status()
            .is_success());
    }
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            if !runtime.snapshot().tasks.is_empty()
                && !runtime.claude_snapshot().sessions.is_empty()
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();

    runtime.stop_provider(AgentProvider::Codex).await;
    assert!(runtime.snapshot().tasks.is_empty());
    assert_eq!(runtime.claude_snapshot().sessions.len(), 1);
    assert!(codex_start.discovery_path.exists());

    runtime.stop_provider(AgentProvider::Claude).await;
    assert!(runtime.claude_snapshot().sessions.is_empty());
    assert!(!codex_start.discovery_path.exists());
    fs::remove_dir_all(directory).unwrap();
}

#[tokio::test]
async fn 分_provider_摘要开关同步到同一发现文件() {
    let directory = temporary_directory();
    let runtime = AgentRuntime::with_publishers(8, Arc::new(|_| {}), Arc::new(|_| {}));
    let start = runtime.start_provider(AgentProvider::Codex, &directory).await.unwrap();
    runtime.start_provider(AgentProvider::Claude, &directory).await.unwrap();
    runtime.set_task_summary_capture(true).unwrap();
    runtime.set_claude_task_summary_capture(true).unwrap();

    let discovery = read_agent_discovery(&start.discovery_path).unwrap();
    assert!(discovery.capture_task_summary_for(AgentProvider::Codex));
    assert!(discovery.capture_task_summary_for(AgentProvider::Claude));

    runtime.stop_provider(AgentProvider::Codex).await;
    runtime.stop_provider(AgentProvider::Claude).await;
    fs::remove_dir_all(directory).unwrap();
}

#[tokio::test]
async fn 第二个_provider_启动失败时不留下半启用状态() {
    let directory = temporary_directory();
    let runtime = AgentRuntime::with_publishers(8, Arc::new(|_| {}), Arc::new(|_| {}));
    let start = runtime.start_provider(AgentProvider::Codex, &directory).await.unwrap();
    fs::remove_file(&start.discovery_path).unwrap();

    assert!(runtime.start_provider(AgentProvider::Claude, &directory).await.is_err());
    assert!(!runtime.is_provider_enabled(AgentProvider::Claude));
    assert_eq!(
        runtime.claude_snapshot().listener_status,
        crate::agent::AgentListenerStatus::Failed
    );

    runtime.stop_provider(AgentProvider::Codex).await;
    fs::remove_dir_all(directory).unwrap();
}

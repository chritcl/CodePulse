use std::fs;
use std::path::PathBuf;

use reqwest::StatusCode;
use serde_json::json;

use super::runtime_discovery::{read_agent_discovery, AgentSummaryCapture};
use super::server::{start_receiver, AgentBridgeEvent};

fn temporary_directory() -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "codepulse-agent-server-{}-{}",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    fs::create_dir_all(&path).unwrap();
    path
}

#[tokio::test]
async fn 同一接收器兼容旧_codex_payload_并接收_claude_provider() {
    let directory = temporary_directory();
    let (receiver, mut events) =
        start_receiver(&directory, 4, AgentSummaryCapture::default()).await.unwrap();
    let discovery = read_agent_discovery(receiver.discovery_path()).unwrap();
    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{}/events", discovery.runtime.port);

    let codex = json!({
        "version": 1,
        "eventId": "codex-1",
        "sessionId": "session-codex",
        "source": "cli",
        "eventType": "session_started",
        "phase": "analyzing",
        "occurredAtMs": 1000
    });
    let claude = json!({
        "version": 1,
        "provider": "claude",
        "eventId": "claude-1",
        "sessionId": "session-claude",
        "eventType": "session_started",
        "phase": "analyzing",
        "occurredAtMs": 1001
    });

    for payload in [codex, claude] {
        let status = client
            .post(&url)
            .bearer_auth(&discovery.runtime.token)
            .json(&payload)
            .send()
            .await
            .unwrap()
            .status();
        assert_eq!(status, StatusCode::ACCEPTED);
    }

    assert!(matches!(
        events.recv().await,
        Some(AgentBridgeEvent::Codex(_))
    ));
    assert!(matches!(
        events.recv().await,
        Some(AgentBridgeEvent::Claude(_))
    ));
    let discovery_path = receiver.discovery_path().to_path_buf();
    receiver.stop().await;
    assert!(!discovery_path.exists());
    fs::remove_dir_all(directory).unwrap();
}

#[tokio::test]
async fn 未知_provider_鉴权失败和队列满分别降级() {
    let directory = temporary_directory();
    let (receiver, _events) =
        start_receiver(&directory, 1, AgentSummaryCapture::default()).await.unwrap();
    let discovery = read_agent_discovery(receiver.discovery_path()).unwrap();
    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{}/events", discovery.runtime.port);
    let payload = json!({
        "version": 1,
        "eventId": "event-1",
        "sessionId": "session-1",
        "source": "cli",
        "eventType": "session_started",
        "phase": "analyzing",
        "occurredAtMs": 1000
    });

    let unauthorized = client.post(&url).json(&payload).send().await.unwrap().status();
    assert_eq!(unauthorized, StatusCode::UNAUTHORIZED);
    let accepted = client
        .post(&url)
        .bearer_auth(&discovery.runtime.token)
        .json(&payload)
        .send()
        .await
        .unwrap()
        .status();
    assert_eq!(accepted, StatusCode::ACCEPTED);
    let full = client
        .post(&url)
        .bearer_auth(&discovery.runtime.token)
        .json(&json!({
            "version": 1,
            "eventId": "event-2",
            "sessionId": "session-1",
            "source": "cli",
            "eventType": "session_started",
            "phase": "analyzing",
            "occurredAtMs": 1001
        }))
        .send()
        .await
        .unwrap()
        .status();
    assert_eq!(full, StatusCode::SERVICE_UNAVAILABLE);

    let unknown = client
        .post(&url)
        .bearer_auth(&discovery.runtime.token)
        .json(&json!({
            "version": 1,
            "provider": "other",
            "eventId": "event-3",
            "sessionId": "session-1",
            "eventType": "session_started",
            "phase": "analyzing",
            "occurredAtMs": 1000
        }))
        .send()
        .await
        .unwrap()
        .status();
    assert_eq!(unknown, StatusCode::BAD_REQUEST);

    receiver.stop().await;
    fs::remove_dir_all(directory).unwrap();
}

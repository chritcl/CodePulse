use std::fs;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::{timeout, Duration};

use super::protocol::{
    CodexBridgeEvent, CodexEventSource, CodexEventType, CodexTaskPhase, PROTOCOL_VERSION,
};
use super::runtime_discovery::read_discovery;
use super::server::{start_receiver, MAX_REQUEST_BODY_BYTES};

static NEXT_DIRECTORY_ID: AtomicUsize = AtomicUsize::new(0);

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new() -> Self {
        let directory = std::env::temp_dir().join(format!(
            "codepulse-codex-server-{}-{}",
            std::process::id(),
            NEXT_DIRECTORY_ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&directory).unwrap();
        Self(directory)
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn valid_event(event_id: &str) -> CodexBridgeEvent {
    CodexBridgeEvent {
        version: PROTOCOL_VERSION,
        event_id: event_id.to_string(),
        session_id: "session-1".to_string(),
        turn_id: Some("turn-1".to_string()),
        source: CodexEventSource::Cli,
        event_type: CodexEventType::ToolStarted,
        phase: CodexTaskPhase::RunningCommand,
        project_name: Some("CodePulse".to_string()),
        task_summary: None,
        operation_summary: Some("运行命令".to_string()),
        error_summary: None,
        occurred_at_ms: 1_784_001_234_567,
    }
}

async fn post_json(address: SocketAddr, token: &str, body: &[u8]) -> String {
    let mut stream = TcpStream::connect(address).await.unwrap();
    let request = format!(
        "POST /events HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(request.as_bytes()).await.unwrap();
    stream.write_all(body).await.unwrap();

    let mut response = Vec::new();
    stream.read_to_end(&mut response).await.unwrap();
    String::from_utf8(response).unwrap()
}

#[tokio::test]
async fn accepts_an_authorized_event_and_publishes_the_receiver_discovery() {
    let directory = TestDirectory::new();
    let (server, mut receiver) = start_receiver(&directory.0, 2).await.unwrap();
    let event = valid_event("event-1");
    let body = serde_json::to_vec(&event).unwrap();

    let discovery = read_discovery(server.discovery_path()).unwrap();
    let response = post_json(server.address(), &discovery.token, &body).await;
    let received = timeout(Duration::from_millis(500), receiver.recv()).await.unwrap().unwrap();

    assert_eq!(server.address().ip(), IpAddr::V4(Ipv4Addr::LOCALHOST));
    assert_eq!(discovery.port, server.address().port());
    assert!(response.starts_with("HTTP/1.1 202 Accepted"));
    assert_eq!(received, event);

    server.stop().await;
}

#[tokio::test]
async fn rejects_an_event_with_a_wrong_token_before_it_reaches_the_queue() {
    let directory = TestDirectory::new();
    let (server, mut receiver) = start_receiver(&directory.0, 1).await.unwrap();
    let body = serde_json::to_vec(&valid_event("event-1")).unwrap();

    let response = post_json(server.address(), "wrong-token", &body).await;

    assert!(response.starts_with("HTTP/1.1 401 Unauthorized"));
    assert!(timeout(Duration::from_millis(100), receiver.recv()).await.is_err());

    server.stop().await;
}

#[tokio::test]
async fn rejects_an_event_body_that_exceeds_the_limit() {
    let directory = TestDirectory::new();
    let (server, _receiver) = start_receiver(&directory.0, 1).await.unwrap();
    let body = vec![b'x'; MAX_REQUEST_BODY_BYTES + 1];
    let token = read_discovery(server.discovery_path()).unwrap().token;

    let response = post_json(server.address(), &token, &body).await;

    assert!(response.starts_with("HTTP/1.1 413 Payload Too Large"));

    server.stop().await;
}

#[tokio::test]
async fn rejects_an_invalid_protocol_event() {
    let directory = TestDirectory::new();
    let (server, _receiver) = start_receiver(&directory.0, 1).await.unwrap();
    let mut event = valid_event("event-1");
    event.version = PROTOCOL_VERSION + 1;
    let body = serde_json::to_vec(&event).unwrap();
    let token = read_discovery(server.discovery_path()).unwrap().token;

    let response = post_json(server.address(), &token, &body).await;

    assert!(response.starts_with("HTTP/1.1 400 Bad Request"));

    server.stop().await;
}

#[tokio::test]
async fn returns_service_unavailable_when_the_event_queue_is_full() {
    let directory = TestDirectory::new();
    let (server, _receiver) = start_receiver(&directory.0, 1).await.unwrap();
    let token = read_discovery(server.discovery_path()).unwrap().token;
    let first_body = serde_json::to_vec(&valid_event("event-1")).unwrap();
    let second_body = serde_json::to_vec(&valid_event("event-2")).unwrap();

    let first_response = post_json(server.address(), &token, &first_body).await;
    let second_response = post_json(server.address(), &token, &second_body).await;

    assert!(first_response.starts_with("HTTP/1.1 202 Accepted"));
    assert!(second_response.starts_with("HTTP/1.1 503 Service Unavailable"));

    server.stop().await;
}

#[tokio::test]
async fn stops_accepting_connections_after_it_is_stopped() {
    let directory = TestDirectory::new();
    let (server, _receiver) = start_receiver(&directory.0, 1).await.unwrap();
    let address = server.address();

    server.stop().await;

    assert!(TcpStream::connect(address).await.is_err());
}

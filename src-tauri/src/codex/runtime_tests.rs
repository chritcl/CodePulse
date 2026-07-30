use std::fs;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio::time::{timeout, Duration};

use super::aggregator::{CodexListenerStatus, CodexStatusSnapshot};
use super::protocol::{
    CodexBridgeEvent, CodexEventSource, CodexEventType, CodexTaskPhase, PROTOCOL_VERSION,
};
use super::runtime::{CodexRuntime, SnapshotPublisher};
use super::runtime_discovery::read_discovery;

static NEXT_DIRECTORY_ID: AtomicUsize = AtomicUsize::new(0);

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new() -> Self {
        let directory = std::env::temp_dir().join(format!(
            "codepulse-codex-runtime-{}-{}",
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

fn valid_event() -> CodexBridgeEvent {
    CodexBridgeEvent {
        version: PROTOCOL_VERSION,
        event_id: "event-1".to_string(),
        session_id: "session-1".to_string(),
        turn_id: Some("turn-1".to_string()),
        source: CodexEventSource::Cli,
        event_type: CodexEventType::ToolStarted,
        phase: CodexTaskPhase::RunningCommand,
        project_name: Some("CodePulse".to_string()),
        task_summary: None,
        operation_summary: Some("运行命令".to_string()),
        error_summary: None,
        occurred_at_ms: current_time_ms(),
    }
}

fn current_time_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as i64
}

fn snapshot_publisher(sender: mpsc::UnboundedSender<CodexStatusSnapshot>) -> SnapshotPublisher {
    Arc::new(move |snapshot| {
        let _ = sender.send(snapshot);
    })
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
async fn starts_a_receiver_and_broadcasts_a_running_snapshot_for_an_incoming_event() {
    let directory = TestDirectory::new();
    let (snapshot_sender, mut snapshots) = mpsc::unbounded_channel();
    let runtime = CodexRuntime::with_publisher(8, snapshot_publisher(snapshot_sender));

    let start = runtime.start(&directory.0).await.unwrap();
    let waiting_snapshot =
        timeout(Duration::from_millis(500), snapshots.recv()).await.unwrap().unwrap();
    let discovery = read_discovery(&start.discovery_path).unwrap();
    let response = post_json(
        start.address,
        &discovery.token,
        &serde_json::to_vec(&valid_event()).unwrap(),
    )
    .await;
    let running_snapshot =
        timeout(Duration::from_millis(500), snapshots.recv()).await.unwrap().unwrap();

    assert_eq!(
        waiting_snapshot.listener_status,
        CodexListenerStatus::WaitingForEvent
    );
    assert!(waiting_snapshot.tasks.is_empty());
    assert!(response.starts_with("HTTP/1.1 202 Accepted"));
    assert_eq!(
        running_snapshot.listener_status,
        CodexListenerStatus::Running
    );
    assert_eq!(
        running_snapshot.tasks[0].phase,
        CodexTaskPhase::RunningCommand
    );
    assert!(running_snapshot.revision > waiting_snapshot.revision);

    runtime.stop().await;
}

#[tokio::test]
async fn stopping_the_runtime_closes_the_receiver_and_broadcasts_an_empty_snapshot() {
    let directory = TestDirectory::new();
    let (snapshot_sender, mut snapshots) = mpsc::unbounded_channel();
    let runtime = CodexRuntime::with_publisher(8, snapshot_publisher(snapshot_sender));
    let start = runtime.start(&directory.0).await.unwrap();
    let waiting_snapshot =
        timeout(Duration::from_millis(500), snapshots.recv()).await.unwrap().unwrap();
    let discovery = read_discovery(&start.discovery_path).unwrap();
    let _ = post_json(
        start.address,
        &discovery.token,
        &serde_json::to_vec(&valid_event()).unwrap(),
    )
    .await;
    let running_snapshot =
        timeout(Duration::from_millis(500), snapshots.recv()).await.unwrap().unwrap();

    assert_eq!(
        waiting_snapshot.listener_status,
        CodexListenerStatus::WaitingForEvent
    );
    assert_eq!(
        running_snapshot.listener_status,
        CodexListenerStatus::Running
    );

    runtime.stop().await;

    let stopped_snapshot =
        timeout(Duration::from_millis(500), snapshots.recv()).await.unwrap().unwrap();
    assert_eq!(
        stopped_snapshot.listener_status,
        CodexListenerStatus::Stopped
    );
    assert!(stopped_snapshot.tasks.is_empty());
    assert!(TcpStream::connect(start.address).await.is_err());
}

#[tokio::test]
async fn restarting_the_runtime_rejects_events_authenticated_with_the_old_token() {
    let directory = TestDirectory::new();
    let (snapshot_sender, mut snapshots) = mpsc::unbounded_channel();
    let runtime = CodexRuntime::with_publisher(8, snapshot_publisher(snapshot_sender));
    let first_start = runtime.start(&directory.0).await.unwrap();
    let _ = timeout(Duration::from_millis(500), snapshots.recv()).await.unwrap();
    let old_discovery = read_discovery(&first_start.discovery_path).unwrap();
    let delivered_response = post_json(
        first_start.address,
        &old_discovery.token,
        &serde_json::to_vec(&valid_event()).unwrap(),
    )
    .await;
    let old_task_snapshot =
        timeout(Duration::from_millis(500), snapshots.recv()).await.unwrap().unwrap();

    let second_start = runtime.start(&directory.0).await.unwrap();
    let stopped_snapshot =
        timeout(Duration::from_millis(500), snapshots.recv()).await.unwrap().unwrap();
    let restarted_snapshot =
        timeout(Duration::from_millis(500), snapshots.recv()).await.unwrap().unwrap();
    let new_discovery = read_discovery(&second_start.discovery_path).unwrap();
    let response = post_json(
        second_start.address,
        &old_discovery.token,
        &serde_json::to_vec(&valid_event()).unwrap(),
    )
    .await;

    assert_ne!(old_discovery.token, new_discovery.token);
    assert!(delivered_response.starts_with("HTTP/1.1 202 Accepted"));
    assert_eq!(old_task_snapshot.tasks.len(), 1);
    assert_eq!(
        stopped_snapshot.listener_status,
        CodexListenerStatus::Stopped
    );
    assert!(stopped_snapshot.tasks.is_empty());
    assert_eq!(
        restarted_snapshot.listener_status,
        CodexListenerStatus::WaitingForEvent
    );
    assert!(restarted_snapshot.tasks.is_empty());
    assert!(response.starts_with("HTTP/1.1 401 Unauthorized"));
    assert!(runtime.snapshot().tasks.is_empty());

    runtime.stop().await;
}

#[tokio::test]
async fn clearing_a_failed_task_broadcasts_the_updated_snapshot() {
    let directory = TestDirectory::new();
    let (snapshot_sender, mut snapshots) = mpsc::unbounded_channel();
    let runtime = CodexRuntime::with_publisher(8, snapshot_publisher(snapshot_sender));
    let start = runtime.start(&directory.0).await.unwrap();
    let _ = timeout(Duration::from_millis(500), snapshots.recv()).await.unwrap();
    let discovery = read_discovery(&start.discovery_path).unwrap();
    let mut failed_event = valid_event();
    failed_event.event_type = CodexEventType::TurnStopped;
    failed_event.phase = CodexTaskPhase::Failed;
    let _ = post_json(
        start.address,
        &discovery.token,
        &serde_json::to_vec(&failed_event).unwrap(),
    )
    .await;
    let failed_snapshot =
        timeout(Duration::from_millis(500), snapshots.recv()).await.unwrap().unwrap();

    assert!(runtime.clear_failed_task("session-1"));

    let cleared_snapshot =
        timeout(Duration::from_millis(500), snapshots.recv()).await.unwrap().unwrap();
    assert!(failed_snapshot.has_failed_task);
    assert!(cleared_snapshot.tasks.is_empty());
    assert!(!cleared_snapshot.has_failed_task);
    assert!(!runtime.clear_failed_task("session-1"));

    runtime.stop().await;
}

#[tokio::test]
async fn syncs_the_summary_capture_gate_and_clears_existing_summaries_when_disabled() {
    let directory = TestDirectory::new();
    let (snapshot_sender, mut snapshots) = mpsc::unbounded_channel();
    let runtime = CodexRuntime::with_publisher(8, snapshot_publisher(snapshot_sender));
    runtime.set_task_summary_capture(true).unwrap();
    let start = runtime.start(&directory.0).await.unwrap();
    let _ = timeout(Duration::from_millis(500), snapshots.recv()).await.unwrap();
    let enabled_discovery = read_discovery(&start.discovery_path).unwrap();
    let mut event = valid_event();
    event.task_summary = Some("不得持久化的任务摘要".to_string());
    let _ = post_json(
        start.address,
        &enabled_discovery.token,
        &serde_json::to_vec(&event).unwrap(),
    )
    .await;
    let captured_snapshot =
        timeout(Duration::from_millis(500), snapshots.recv()).await.unwrap().unwrap();

    assert!(enabled_discovery.capture_task_summary);
    assert_eq!(
        captured_snapshot.tasks[0].task_summary.as_deref(),
        Some("不得持久化的任务摘要")
    );

    runtime.set_task_summary_capture(false).unwrap();

    let cleared_snapshot =
        timeout(Duration::from_millis(500), snapshots.recv()).await.unwrap().unwrap();
    let disabled_discovery = read_discovery(&start.discovery_path).unwrap();
    assert!(!disabled_discovery.capture_task_summary);
    assert!(cleared_snapshot.tasks[0].task_summary.is_none());
    assert!(runtime.snapshot().tasks[0].task_summary.is_none());

    runtime.stop().await;
}

#[tokio::test]
async fn reports_a_failed_listener_snapshot_when_the_receiver_cannot_start() {
    let directory = TestDirectory::new();
    let blocked_path = directory.0.join("not-a-directory");
    fs::write(&blocked_path, "blocked").unwrap();
    let (snapshot_sender, mut snapshots) = mpsc::unbounded_channel();
    let runtime = CodexRuntime::with_publisher(8, snapshot_publisher(snapshot_sender));

    assert!(runtime.start(&blocked_path).await.is_err());

    let failed_snapshot =
        timeout(Duration::from_millis(500), snapshots.recv()).await.unwrap().unwrap();
    assert_eq!(failed_snapshot.listener_status, CodexListenerStatus::Failed);
    assert!(failed_snapshot.tasks.is_empty());
    assert_eq!(
        runtime.snapshot().listener_status,
        CodexListenerStatus::Failed
    );
}

use std::fmt;
use std::net::{Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::routing::post;
use axum::Router;
use tokio::net::TcpListener;
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;
use uuid::Uuid;

use super::protocol::CodexBridgeEvent;
use super::runtime_discovery::{
    discovery_file_path, write_discovery_atomically, DiscoveryError, RuntimeDiscovery,
    RUNTIME_DISCOVERY_VERSION,
};

pub const MAX_REQUEST_BODY_BYTES: usize = 16 * 1024;

#[derive(Debug)]
pub enum ReceiverError {
    Io(std::io::Error),
    Discovery(DiscoveryError),
    InvalidQueueCapacity,
}

impl fmt::Display for ReceiverError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "Codex 接收器 IO 错误: {error}"),
            Self::Discovery(error) => write!(formatter, "Codex 发现文件错误: {error}"),
            Self::InvalidQueueCapacity => write!(formatter, "Codex 接收器队列容量必须大于零"),
        }
    }
}

impl std::error::Error for ReceiverError {}

impl From<std::io::Error> for ReceiverError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<DiscoveryError> for ReceiverError {
    fn from(error: DiscoveryError) -> Self {
        Self::Discovery(error)
    }
}

#[derive(Clone)]
struct ReceiverState {
    token: Arc<str>,
    sender: mpsc::Sender<CodexBridgeEvent>,
}

pub struct CodexEventReceiver {
    address: SocketAddr,
    discovery_path: PathBuf,
    shutdown_sender: Option<oneshot::Sender<()>>,
    task: Option<JoinHandle<()>>,
}

impl CodexEventReceiver {
    pub fn address(&self) -> SocketAddr {
        self.address
    }

    pub fn discovery_path(&self) -> &Path {
        &self.discovery_path
    }

    pub async fn stop(mut self) {
        if let Some(shutdown_sender) = self.shutdown_sender.take() {
            let _ = shutdown_sender.send(());
        }
        if let Some(task) = self.task.take() {
            let _ = task.await;
        }
    }
}

impl Drop for CodexEventReceiver {
    fn drop(&mut self) {
        if let Some(shutdown_sender) = self.shutdown_sender.take() {
            let _ = shutdown_sender.send(());
        }
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}

pub async fn start_receiver(
    app_data_dir: &Path,
    queue_capacity: usize,
    capture_task_summary: bool,
) -> Result<(CodexEventReceiver, mpsc::Receiver<CodexBridgeEvent>), ReceiverError> {
    if queue_capacity == 0 {
        return Err(ReceiverError::InvalidQueueCapacity);
    }

    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await?;
    let address = listener.local_addr()?;
    let discovery_path = discovery_file_path(app_data_dir);
    let discovery = RuntimeDiscovery {
        version: RUNTIME_DISCOVERY_VERSION,
        port: address.port(),
        token: Uuid::new_v4().simple().to_string(),
        process_id: std::process::id(),
        created_at_ms: current_time_ms(),
        capture_task_summary,
    };
    write_discovery_atomically(&discovery_path, &discovery)?;

    let (sender, receiver) = mpsc::channel(queue_capacity);
    let state = ReceiverState {
        token: Arc::from(discovery.token),
        sender,
    };
    let router = Router::new()
        .route("/events", post(receive_event))
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BODY_BYTES))
        .with_state(state);
    let (shutdown_sender, shutdown_receiver) = oneshot::channel();
    let task = tokio::spawn(async move {
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(async {
                let _ = shutdown_receiver.await;
            })
            .await;
    });

    Ok((
        CodexEventReceiver {
            address,
            discovery_path,
            shutdown_sender: Some(shutdown_sender),
            task: Some(task),
        },
        receiver,
    ))
}

async fn receive_event(
    State(state): State<ReceiverState>,
    headers: HeaderMap,
    body: Bytes,
) -> StatusCode {
    if !has_valid_token(&headers, state.token.as_ref()) {
        return StatusCode::UNAUTHORIZED;
    }

    let event = match serde_json::from_slice::<CodexBridgeEvent>(&body)
        .ok()
        .and_then(|event| event.sanitize_and_validate().ok())
    {
        Some(event) => event,
        None => return StatusCode::BAD_REQUEST,
    };

    match state.sender.try_send(event) {
        Ok(()) => StatusCode::ACCEPTED,
        Err(mpsc::error::TrySendError::Full(_)) | Err(mpsc::error::TrySendError::Closed(_)) => {
            StatusCode::SERVICE_UNAVAILABLE
        }
    }
}

fn has_valid_token(headers: &HeaderMap, expected_token: &str) -> bool {
    let Some(value) = headers.get(header::AUTHORIZATION).and_then(|value| value.to_str().ok())
    else {
        return false;
    };
    let Some(token) = value.strip_prefix("Bearer ") else {
        return false;
    };

    constant_time_equals(expected_token.as_bytes(), token.as_bytes())
}

fn constant_time_equals(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }

    left.iter().zip(right).fold(0_u8, |difference, (left, right)| {
        difference | (left ^ right)
    }) == 0
}

fn current_time_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(1)
}

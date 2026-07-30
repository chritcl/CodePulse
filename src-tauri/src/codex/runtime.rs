use std::fmt;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;

use super::aggregator::{CodexAggregator, CodexListenerStatus, CodexStatusSnapshot};
use super::protocol::CodexBridgeEvent;
use super::runtime_discovery::{read_discovery, write_discovery_atomically, DiscoveryError};
use super::server::{start_receiver, CodexEventReceiver, ReceiverError};

pub const DEFAULT_EVENT_CACHE_CAPACITY: usize = 512;
pub const RECEIVER_QUEUE_CAPACITY: usize = 64;
const EXPIRATION_CHECK_INTERVAL: Duration = Duration::from_secs(1);

pub type SnapshotPublisher = Arc<dyn Fn(CodexStatusSnapshot) + Send + Sync>;

#[derive(Debug)]
pub enum RuntimeError {
    Receiver(ReceiverError),
    Discovery(DiscoveryError),
}

impl fmt::Display for RuntimeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Receiver(error) => write!(formatter, "Codex 运行时启动失败: {error}"),
            Self::Discovery(error) => write!(formatter, "Codex 捕获偏好同步失败: {error}"),
        }
    }
}

impl std::error::Error for RuntimeError {}

impl From<ReceiverError> for RuntimeError {
    fn from(error: ReceiverError) -> Self {
        Self::Receiver(error)
    }
}

impl From<DiscoveryError> for RuntimeError {
    fn from(error: DiscoveryError) -> Self {
        Self::Discovery(error)
    }
}

#[derive(Debug, Clone)]
pub struct CodexRuntimeStart {
    pub address: SocketAddr,
    pub discovery_path: PathBuf,
}

#[derive(Clone)]
pub struct CodexRuntime {
    state: Arc<Mutex<RuntimeState>>,
}

struct RuntimeState {
    aggregator: CodexAggregator,
    listener_status: CodexListenerStatus,
    capture_task_summary: bool,
    generation: u64,
    publisher: SnapshotPublisher,
    running: Option<RunningRuntime>,
}

struct RunningRuntime {
    receiver: CodexEventReceiver,
    shutdown_sender: oneshot::Sender<()>,
    aggregation_task: JoinHandle<()>,
}

impl CodexRuntime {
    pub(crate) fn with_publisher(
        event_cache_capacity: usize,
        publisher: SnapshotPublisher,
    ) -> Self {
        Self {
            state: Arc::new(Mutex::new(RuntimeState {
                aggregator: CodexAggregator::new(event_cache_capacity),
                listener_status: CodexListenerStatus::Stopped,
                capture_task_summary: false,
                generation: 0,
                publisher,
                running: None,
            })),
        }
    }

    pub async fn start(&self, app_data_dir: &Path) -> Result<CodexRuntimeStart, RuntimeError> {
        if self.is_running() {
            self.stop().await;
        }

        let capture_task_summary = lock_state(&self.state).capture_task_summary;
        let (receiver, events) =
            match start_receiver(app_data_dir, RECEIVER_QUEUE_CAPACITY, capture_task_summary).await
            {
                Ok(receiver) => receiver,
                Err(error) => {
                    self.mark_start_failed();
                    return Err(error.into());
                }
            };
        let start = CodexRuntimeStart {
            address: receiver.address(),
            discovery_path: receiver.discovery_path().to_path_buf(),
        };
        let (shutdown_sender, shutdown_receiver) = oneshot::channel();
        let generation = {
            let mut state = lock_state(&self.state);
            state.generation += 1;
            state.aggregator.reset();
            state.listener_status = CodexListenerStatus::WaitingForEvent;
            state.publish_snapshot();
            state.generation
        };

        let state = Arc::downgrade(&self.state);
        let aggregation_task = tokio::spawn(run_aggregation_loop(
            state,
            generation,
            events,
            shutdown_receiver,
        ));
        let mut state = lock_state(&self.state);
        state.running = Some(RunningRuntime {
            receiver,
            shutdown_sender,
            aggregation_task,
        });

        Ok(start)
    }

    pub async fn stop(&self) {
        let running = {
            let mut state = lock_state(&self.state);
            if state.running.is_none() && state.listener_status == CodexListenerStatus::Stopped {
                return;
            }
            state.generation += 1;
            state.running.take()
        };

        if let Some(running) = running {
            running.receiver.stop().await;
            let _ = running.shutdown_sender.send(());
            let _ = running.aggregation_task.await;
        }

        {
            let mut state = lock_state(&self.state);
            state.aggregator.reset();
            state.listener_status = CodexListenerStatus::Stopped;
            state.publish_snapshot();
        }
    }

    pub fn snapshot(&self) -> CodexStatusSnapshot {
        lock_state(&self.state).snapshot()
    }

    pub fn clear_failed_task(&self, session_id: &str) -> bool {
        let mut state = lock_state(&self.state);
        if !state.aggregator.clear_failed_task(session_id) {
            return false;
        }
        state.publish_snapshot();
        true
    }

    pub fn set_task_summary_capture(&self, enabled: bool) -> Result<(), RuntimeError> {
        let mut state = lock_state(&self.state);
        if let Some(running) = state.running.as_ref() {
            let path = running.receiver.discovery_path();
            let mut discovery = read_discovery(path)?;
            if discovery.capture_task_summary != enabled {
                discovery.capture_task_summary = enabled;
                write_discovery_atomically(path, &discovery)?;
            }
        }

        state.capture_task_summary = enabled;
        if !enabled && state.aggregator.clear_task_summaries() {
            state.publish_snapshot();
        }
        Ok(())
    }

    fn is_running(&self) -> bool {
        lock_state(&self.state).running.is_some()
    }

    fn mark_start_failed(&self) {
        {
            let mut state = lock_state(&self.state);
            state.generation += 1;
            state.aggregator.reset();
            state.listener_status = CodexListenerStatus::Failed;
            state.publish_snapshot();
        }
    }
}

impl Drop for CodexRuntime {
    fn drop(&mut self) {
        if Arc::strong_count(&self.state) != 1 {
            return;
        }

        let Ok(mut state) = self.state.lock() else {
            return;
        };
        if let Some(running) = state.running.take() {
            let _ = running.shutdown_sender.send(());
            running.aggregation_task.abort();
        }
    }
}

impl RuntimeState {
    fn snapshot(&self) -> CodexStatusSnapshot {
        self.aggregator.snapshot(self.listener_status, current_time_ms())
    }

    fn publish_snapshot(&self) {
        (self.publisher)(self.snapshot());
    }
}

async fn run_aggregation_loop(
    state: Weak<Mutex<RuntimeState>>,
    generation: u64,
    mut events: mpsc::Receiver<CodexBridgeEvent>,
    mut shutdown_receiver: oneshot::Receiver<()>,
) {
    let mut expiration_interval = tokio::time::interval(EXPIRATION_CHECK_INTERVAL);

    loop {
        tokio::select! {
            _ = &mut shutdown_receiver => return,
            event = events.recv() => {
                let Some(event) = event else {
                    return;
                };
                publish_event_update(&state, generation, event);
            }
            _ = expiration_interval.tick() => {
                publish_expiration_update(&state, generation);
            }
        }
    }
}

fn publish_event_update(
    state: &Weak<Mutex<RuntimeState>>,
    generation: u64,
    event: CodexBridgeEvent,
) {
    let Some(state) = state.upgrade() else {
        return;
    };
    let mut state = lock_state(&state);
    if state.generation != generation || !state.aggregator.apply(event) {
        return;
    }
    state.listener_status = CodexListenerStatus::Running;
    state.publish_snapshot();
}

fn publish_expiration_update(state: &Weak<Mutex<RuntimeState>>, generation: u64) {
    let Some(state) = state.upgrade() else {
        return;
    };
    let mut state = lock_state(&state);
    if state.generation != generation || !state.aggregator.expire(current_time_ms()) {
        return;
    }
    state.publish_snapshot();
}

fn lock_state(state: &Arc<Mutex<RuntimeState>>) -> std::sync::MutexGuard<'_, RuntimeState> {
    state.lock().expect("Codex 运行时状态锁不应中毒")
}

fn current_time_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(1)
}

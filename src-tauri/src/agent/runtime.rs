use std::collections::HashSet;
use std::fmt;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;

use crate::claude::aggregator::{ClaudeAggregator, ClaudeStatusSnapshot};
use crate::codex::aggregator::{CodexAggregator, CodexStatusSnapshot};

use super::protocol::{AgentListenerStatus, AgentProvider};
use super::runtime_discovery::{
    read_agent_discovery, write_agent_discovery_atomically, AgentSummaryCapture, DiscoveryError,
};
use super::server::{start_receiver, AgentBridgeEvent, AgentEventReceiver, ReceiverError};

pub const DEFAULT_EVENT_CACHE_CAPACITY: usize = 512;
pub const RECEIVER_QUEUE_CAPACITY: usize = 64;
const EXPIRATION_CHECK_INTERVAL: Duration = Duration::from_secs(1);

pub type SnapshotPublisher = Arc<dyn Fn(CodexStatusSnapshot) + Send + Sync>;
pub type ClaudeSnapshotPublisher = Arc<dyn Fn(ClaudeStatusSnapshot) + Send + Sync>;

#[derive(Debug)]
pub enum RuntimeError {
    Receiver(ReceiverError),
    Discovery(DiscoveryError),
}

impl fmt::Display for RuntimeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Receiver(error) => write!(formatter, "Agent 运行时启动失败: {error}"),
            Self::Discovery(error) => write!(formatter, "Agent 捕获偏好同步失败: {error}"),
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
pub struct AgentRuntimeStart {
    pub address: SocketAddr,
    pub discovery_path: PathBuf,
}

#[derive(Clone)]
pub struct AgentRuntime {
    state: Arc<Mutex<RuntimeState>>,
    lifecycle: Arc<tokio::sync::Mutex<()>>,
}

struct RuntimeState {
    codex: CodexAggregator,
    claude: ClaudeAggregator,
    codex_listener_status: AgentListenerStatus,
    claude_listener_status: AgentListenerStatus,
    enabled_providers: HashSet<AgentProvider>,
    capture: AgentSummaryCapture,
    generation: u64,
    codex_publisher: SnapshotPublisher,
    claude_publisher: ClaudeSnapshotPublisher,
    running: Option<RunningRuntime>,
}

struct RunningRuntime {
    receiver: AgentEventReceiver,
    shutdown_sender: oneshot::Sender<()>,
    aggregation_task: JoinHandle<()>,
}

impl AgentRuntime {
    #[cfg(test)]
    pub(crate) fn with_publisher(
        event_cache_capacity: usize,
        publisher: SnapshotPublisher,
    ) -> Self {
        Self::with_publishers(event_cache_capacity, publisher, Arc::new(|_| {}))
    }

    pub(crate) fn with_publishers(
        event_cache_capacity: usize,
        codex_publisher: SnapshotPublisher,
        claude_publisher: ClaudeSnapshotPublisher,
    ) -> Self {
        Self {
            state: Arc::new(Mutex::new(RuntimeState {
                codex: CodexAggregator::new(event_cache_capacity),
                claude: ClaudeAggregator::new(event_cache_capacity),
                codex_listener_status: AgentListenerStatus::Stopped,
                claude_listener_status: AgentListenerStatus::Stopped,
                enabled_providers: HashSet::new(),
                capture: AgentSummaryCapture::default(),
                generation: 0,
                codex_publisher,
                claude_publisher,
                running: None,
            })),
            lifecycle: Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    pub async fn start(&self, app_data_dir: &Path) -> Result<AgentRuntimeStart, RuntimeError> {
        if self.is_provider_enabled(AgentProvider::Codex) {
            self.stop_provider(AgentProvider::Codex).await;
        }
        self.start_provider(AgentProvider::Codex, app_data_dir).await
    }

    pub async fn stop(&self) {
        self.stop_provider(AgentProvider::Codex).await;
    }

    pub async fn start_provider(
        &self,
        provider: AgentProvider,
        app_data_dir: &Path,
    ) -> Result<AgentRuntimeStart, RuntimeError> {
        let _lifecycle = self.lifecycle.lock().await;
        if let Some(start) = self.current_start_for_enabled(provider) {
            return Ok(start);
        }

        if self.has_running_receiver() {
            if let Err(error) = self.sync_discovery_capture() {
                let mut state = lock_state(&self.state);
                state.reset_provider(provider);
                state.set_listener_status(provider, AgentListenerStatus::Failed);
                state.publish_provider(provider);
                return Err(error);
            }
            let start = {
                let mut state = lock_state(&self.state);
                state.enabled_providers.insert(provider);
                state.reset_provider(provider);
                state.set_listener_status(provider, AgentListenerStatus::WaitingForEvent);
                state.publish_provider(provider);
                state.current_start().expect("运行中的接收器必须提供地址")
            };
            return Ok(start);
        }

        let capture = lock_state(&self.state).capture;
        let (receiver, events) =
            match start_receiver(app_data_dir, RECEIVER_QUEUE_CAPACITY, capture).await {
                Ok(value) => value,
                Err(error) => {
                    let mut state = lock_state(&self.state);
                    state.reset_provider(provider);
                    state.set_listener_status(provider, AgentListenerStatus::Failed);
                    state.publish_provider(provider);
                    return Err(error.into());
                }
            };
        let start = AgentRuntimeStart {
            address: receiver.address(),
            discovery_path: receiver.discovery_path().to_path_buf(),
        };
        let (shutdown_sender, shutdown_receiver) = oneshot::channel();
        let generation = {
            let mut state = lock_state(&self.state);
            state.generation += 1;
            state.enabled_providers.insert(provider);
            state.reset_provider(provider);
            state.set_listener_status(provider, AgentListenerStatus::WaitingForEvent);
            state.publish_provider(provider);
            state.generation
        };
        let aggregation_task = tokio::spawn(run_aggregation_loop(
            Arc::downgrade(&self.state),
            generation,
            events,
            shutdown_receiver,
        ));
        lock_state(&self.state).running = Some(RunningRuntime {
            receiver,
            shutdown_sender,
            aggregation_task,
        });
        Ok(start)
    }

    pub async fn stop_provider(&self, provider: AgentProvider) {
        let _lifecycle = self.lifecycle.lock().await;
        let running = {
            let mut state = lock_state(&self.state);
            if !state.enabled_providers.remove(&provider)
                && state.listener_status(provider) == AgentListenerStatus::Stopped
            {
                return;
            }
            state.reset_provider(provider);
            state.set_listener_status(provider, AgentListenerStatus::Stopped);
            state.publish_provider(provider);
            if state.enabled_providers.is_empty() {
                state.generation += 1;
                state.running.take()
            } else {
                None
            }
        };
        if let Some(running) = running {
            running.receiver.stop().await;
            let _ = running.shutdown_sender.send(());
            let _ = running.aggregation_task.await;
        }
    }

    pub fn snapshot(&self) -> CodexStatusSnapshot {
        let state = lock_state(&self.state);
        state.codex.snapshot(state.codex_listener_status, current_time_ms())
    }

    pub fn claude_snapshot(&self) -> ClaudeStatusSnapshot {
        let state = lock_state(&self.state);
        state.claude.snapshot(state.claude_listener_status, current_time_ms())
    }

    pub fn clear_failed_task(&self, session_id: &str) -> bool {
        let mut state = lock_state(&self.state);
        if !state.codex.clear_failed_task(session_id) {
            return false;
        }
        state.publish_codex();
        true
    }

    pub fn clear_failed_claude_task(&self, task_key: &str) -> bool {
        let mut state = lock_state(&self.state);
        if !state.claude.clear_failed_task(task_key) {
            return false;
        }
        state.publish_claude();
        true
    }

    pub fn set_task_summary_capture(&self, enabled: bool) -> Result<(), RuntimeError> {
        self.set_provider_summary_capture(AgentProvider::Codex, enabled)
    }

    pub fn set_claude_task_summary_capture(&self, enabled: bool) -> Result<(), RuntimeError> {
        self.set_provider_summary_capture(AgentProvider::Claude, enabled)
    }

    pub fn is_provider_enabled(&self, provider: AgentProvider) -> bool {
        lock_state(&self.state).enabled_providers.contains(&provider)
    }

    fn set_provider_summary_capture(
        &self,
        provider: AgentProvider,
        enabled: bool,
    ) -> Result<(), RuntimeError> {
        let mut state = lock_state(&self.state);
        let previous = match provider {
            AgentProvider::Codex => state.capture.codex,
            AgentProvider::Claude => state.capture.claude,
        };
        if previous == enabled {
            return Ok(());
        }
        let mut discovery = state
            .running
            .as_ref()
            .map(|running| read_agent_discovery(running.receiver.discovery_path()))
            .transpose()?;
        if let Some(discovery) = discovery.as_mut() {
            match provider {
                AgentProvider::Codex => discovery.capture_task_summary_by_provider.codex = enabled,
                AgentProvider::Claude => {
                    discovery.capture_task_summary_by_provider.claude = enabled
                }
            }
            write_agent_discovery_atomically(
                state.running.as_ref().expect("发现文件来源仍应存在").receiver.discovery_path(),
                discovery,
            )?;
        }
        match provider {
            AgentProvider::Codex => state.capture.codex = enabled,
            AgentProvider::Claude => state.capture.claude = enabled,
        }
        if !enabled {
            let changed = match provider {
                AgentProvider::Codex => state.codex.clear_task_summaries(),
                AgentProvider::Claude => state.claude.clear_task_summaries(),
            };
            if changed {
                state.publish_provider(provider);
            }
        }
        Ok(())
    }

    fn current_start_for_enabled(&self, provider: AgentProvider) -> Option<AgentRuntimeStart> {
        let state = lock_state(&self.state);
        state
            .enabled_providers
            .contains(&provider)
            .then(|| state.current_start())
            .flatten()
    }

    fn has_running_receiver(&self) -> bool {
        lock_state(&self.state).running.is_some()
    }

    fn sync_discovery_capture(&self) -> Result<(), RuntimeError> {
        let state = lock_state(&self.state);
        let Some(running) = state.running.as_ref() else {
            return Ok(());
        };
        let mut discovery = read_agent_discovery(running.receiver.discovery_path())?;
        discovery.capture_task_summary_by_provider = state.capture;
        write_agent_discovery_atomically(running.receiver.discovery_path(), &discovery)?;
        Ok(())
    }
}

impl Drop for AgentRuntime {
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
            drop(running.receiver);
        }
    }
}

impl RuntimeState {
    fn listener_status(&self, provider: AgentProvider) -> AgentListenerStatus {
        match provider {
            AgentProvider::Codex => self.codex_listener_status,
            AgentProvider::Claude => self.claude_listener_status,
        }
    }

    fn set_listener_status(&mut self, provider: AgentProvider, status: AgentListenerStatus) {
        match provider {
            AgentProvider::Codex => self.codex_listener_status = status,
            AgentProvider::Claude => self.claude_listener_status = status,
        }
    }

    fn reset_provider(&mut self, provider: AgentProvider) {
        match provider {
            AgentProvider::Codex => self.codex.reset(),
            AgentProvider::Claude => self.claude.reset(),
        }
    }

    fn publish_provider(&self, provider: AgentProvider) {
        match provider {
            AgentProvider::Codex => self.publish_codex(),
            AgentProvider::Claude => self.publish_claude(),
        }
    }

    fn publish_codex(&self) {
        (self.codex_publisher)(self.codex.snapshot(self.codex_listener_status, current_time_ms()));
    }

    fn publish_claude(&self) {
        (self.claude_publisher)(
            self.claude.snapshot(self.claude_listener_status, current_time_ms()),
        );
    }

    fn current_start(&self) -> Option<AgentRuntimeStart> {
        let running = self.running.as_ref()?;
        Some(AgentRuntimeStart {
            address: running.receiver.address(),
            discovery_path: running.receiver.discovery_path().to_path_buf(),
        })
    }
}

async fn run_aggregation_loop(
    state: Weak<Mutex<RuntimeState>>,
    generation: u64,
    mut events: mpsc::Receiver<AgentBridgeEvent>,
    mut shutdown_receiver: oneshot::Receiver<()>,
) {
    let mut expiration_interval = tokio::time::interval(EXPIRATION_CHECK_INTERVAL);
    loop {
        tokio::select! {
            _ = &mut shutdown_receiver => return,
            event = events.recv() => {
                let Some(event) = event else { return; };
                publish_event_update(&state, generation, event);
            }
            _ = expiration_interval.tick() => publish_expiration_update(&state, generation),
        }
    }
}

fn publish_event_update(
    state: &Weak<Mutex<RuntimeState>>,
    generation: u64,
    event: AgentBridgeEvent,
) {
    let Some(state) = state.upgrade() else {
        return;
    };
    let mut state = lock_state(&state);
    if state.generation != generation {
        return;
    }
    match event {
        AgentBridgeEvent::Codex(event) => {
            if !state.enabled_providers.contains(&AgentProvider::Codex) || !state.codex.apply(event)
            {
                return;
            }
            state.codex_listener_status = AgentListenerStatus::Running;
            state.publish_codex();
        }
        AgentBridgeEvent::Claude(event) => {
            if !state.enabled_providers.contains(&AgentProvider::Claude)
                || !state.claude.apply(event)
            {
                return;
            }
            state.claude_listener_status = AgentListenerStatus::Running;
            state.publish_claude();
        }
    }
}

fn publish_expiration_update(state: &Weak<Mutex<RuntimeState>>, generation: u64) {
    let Some(state) = state.upgrade() else {
        return;
    };
    let mut state = lock_state(&state);
    if state.generation != generation {
        return;
    }
    let now = current_time_ms();
    if state.enabled_providers.contains(&AgentProvider::Codex) && state.codex.expire(now) {
        state.publish_codex();
    }
    if state.enabled_providers.contains(&AgentProvider::Claude) && state.claude.expire(now) {
        state.publish_claude();
    }
}

fn lock_state(state: &Arc<Mutex<RuntimeState>>) -> std::sync::MutexGuard<'_, RuntimeState> {
    state.lock().expect("Agent 运行时状态锁不应中毒")
}

fn current_time_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(1)
}

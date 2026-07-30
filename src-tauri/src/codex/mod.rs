pub mod aggregator;
pub mod bridge;
pub mod bridge_install;
pub mod config;
pub mod integration;
pub mod protocol;
pub mod runtime;
pub mod runtime_discovery;
pub mod server;

pub const CODEX_SNAPSHOT_UPDATED_EVENT: &str = "codex-snapshot-updated";
pub const CODEX_INTEGRATION_UPDATED_EVENT: &str = "codex-integration-updated";

pub use aggregator::{CodexListenerStatus, CodexStatusSnapshot, CodexTaskSnapshot};
pub use integration::{
    CodexIntegration, CodexIntegrationPreview, CodexIntegrationStatus, IntegrationAction,
    IntegrationActionResult, IntegrationPaths,
};
pub use runtime::{CodexRuntime, DEFAULT_EVENT_CACHE_CAPACITY};

#[cfg(test)]
mod aggregator_tests;
#[cfg(test)]
mod bridge_install_tests;
#[cfg(test)]
mod bridge_tests;
#[cfg(test)]
mod config_tests;
#[cfg(test)]
mod integration_tests;
#[cfg(test)]
mod protocol_tests;
#[cfg(test)]
mod runtime_discovery_tests;
#[cfg(test)]
mod runtime_tests;
#[cfg(test)]
mod server_tests;

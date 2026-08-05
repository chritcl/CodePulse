pub mod aggregator;
pub mod bridge;
pub mod config;
pub mod integration;
pub mod protocol;

pub const CLAUDE_SNAPSHOT_UPDATED_EVENT: &str = "claude-snapshot-updated";
pub const CLAUDE_INTEGRATION_UPDATED_EVENT: &str = "claude-integration-updated";

pub use aggregator::{ClaudeChildTaskSnapshot, ClaudeSessionSnapshot, ClaudeStatusSnapshot};
pub use integration::{
    ClaudeIntegration, ClaudeIntegrationAction, ClaudeIntegrationActionResult,
    ClaudeIntegrationPaths, ClaudeIntegrationPreview, ClaudeIntegrationStatus,
};

#[cfg(test)]
mod aggregator_tests;
#[cfg(test)]
mod bridge_tests;
#[cfg(test)]
mod config_tests;
#[cfg(test)]
mod integration_tests;

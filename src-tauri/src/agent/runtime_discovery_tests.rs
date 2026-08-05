use std::fs;
use std::path::PathBuf;

use super::protocol::AgentProvider;
use super::runtime_discovery::{
    read_agent_discovery, write_agent_discovery_atomically, AgentRuntimeDiscovery,
    AgentSummaryCapture, RuntimeDiscovery, RUNTIME_DISCOVERY_VERSION,
};

fn temporary_directory() -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "codepulse-agent-discovery-{}-{}",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    fs::create_dir_all(&path).unwrap();
    path
}

#[test]
fn 旧发现文件按_codex_摘要开关兼容读取() {
    let directory = temporary_directory();
    let path = directory.join("runtime.json");
    fs::write(
        &path,
        r#"{"version":1,"port":3210,"token":"token","processId":42,"createdAtMs":1000,"captureTaskSummary":true}"#,
    )
    .unwrap();

    let discovery = read_agent_discovery(&path).unwrap();
    assert!(discovery.capture_task_summary_for(AgentProvider::Codex));
    assert!(!discovery.capture_task_summary_for(AgentProvider::Claude));

    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn 新发现文件保留旧字段并写入分_provider_摘要开关() {
    let directory = temporary_directory();
    let path = directory.join("runtime.json");
    let discovery = AgentRuntimeDiscovery {
        runtime: RuntimeDiscovery {
            version: RUNTIME_DISCOVERY_VERSION,
            port: 3210,
            token: "token".to_string(),
            process_id: 42,
            created_at_ms: 1_000,
            capture_task_summary: true,
        },
        capture_task_summary_by_provider: AgentSummaryCapture {
            codex: true,
            claude: true,
        },
    };

    write_agent_discovery_atomically(&path, &discovery).unwrap();
    let value: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert_eq!(value["captureTaskSummary"], true);
    assert_eq!(value["captureTaskSummaryByProvider"]["codex"], true);
    assert_eq!(value["captureTaskSummaryByProvider"]["claude"], true);

    fs::remove_dir_all(directory).unwrap();
}

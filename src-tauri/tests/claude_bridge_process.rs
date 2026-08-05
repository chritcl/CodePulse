use std::fs;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use codepulse_lib::agent::runtime_discovery::AgentSummaryCapture;
use codepulse_lib::agent::server::{start_receiver, AgentBridgeEvent};
use codepulse_lib::agent::{AgentEventType, AgentProvider};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::time::timeout;

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new() -> Self {
        let directory = std::env::temp_dir().join(format!(
            "codepulse-claude-bridge-process-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&directory).expect("应创建 Bridge 进程测试目录");
        Self(directory)
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[tokio::test]
async fn claude_bridge_进程把标准输入事件转发到共享接收器() {
    let directory = TestDirectory::new();
    let (server, mut events) = start_receiver(
        &directory.0,
        1,
        AgentSummaryCapture {
            codex: false,
            claude: true,
        },
    )
    .await
    .expect("应启动共享接收器");
    let mut child = Command::new(env!("CARGO_BIN_EXE_codepulse-claude-bridge"))
        .arg("codepulse-claude-v1")
        .env("CODEPULSE_AGENT_DISCOVERY_FILE", server.discovery_path())
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .expect("应启动 Claude Bridge 进程");

    let mut stdin = child.stdin.take().expect("Bridge 标准输入应可写");
    stdin
        .write_all(
            br#"{"session_id":"process-test","hook_event_name":"SessionStart","cwd":"C:\\work\\CodePulse"}"#,
        )
        .await
        .expect("应写入 Hook 输入");
    drop(stdin);

    let output = timeout(Duration::from_secs(2), child.wait_with_output())
        .await
        .expect("Bridge 进程应在 Hook 超时前退出")
        .expect("应取得 Bridge 退出状态");
    assert!(
        output.status.success(),
        "Bridge 应静默成功退出，stderr={}",
        String::from_utf8_lossy(&output.stderr)
    );
    let event = timeout(Duration::from_secs(2), events.recv())
        .await
        .expect("接收器应收到 Bridge 事件")
        .expect("Bridge 事件通道不应关闭");
    let AgentBridgeEvent::Claude(event) = event else {
        panic!("应收到 Claude Provider 事件");
    };
    assert_eq!(event.provider, AgentProvider::Claude);
    assert_eq!(event.event_type, AgentEventType::SessionStarted);

    server.stop().await;
}

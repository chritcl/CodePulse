use std::fs;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use netspeed_dynamic_lib::codex::protocol::{CodexEventSource, CodexEventType};
use netspeed_dynamic_lib::codex::server::start_receiver;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::time::timeout;

static NEXT_DIRECTORY_ID: AtomicUsize = AtomicUsize::new(0);

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new() -> Self {
        let directory = std::env::temp_dir().join(format!(
            "codepulse-codex-bridge-process-{}-{}",
            std::process::id(),
            NEXT_DIRECTORY_ID.fetch_add(1, Ordering::Relaxed)
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
async fn bridge_进程把标准输入事件转发到本机接收器() {
    let directory = TestDirectory::new();
    let (server, mut receiver) =
        start_receiver(&directory.0, 1, false).await.expect("应启动本机接收器");
    let mut child = Command::new(env!("CARGO_BIN_EXE_codepulse-codex-bridge"))
        .args(["--source", "app"])
        .env("CODEPULSE_CODEX_DISCOVERY_FILE", server.discovery_path())
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .expect("应启动 Bridge 进程");

    let mut stdin = child.stdin.take().expect("Bridge 标准输入应可写");
    stdin
        .write_all(br#"{"session_id":"process-test","hook_event_name":"SessionStart"}"#)
        .await
        .expect("应写入 Hook 输入");
    drop(stdin);

    let output = timeout(Duration::from_secs(2), child.wait_with_output())
        .await
        .expect("Bridge 进程应及时退出")
        .expect("应取得 Bridge 退出状态");
    assert!(
        output.status.success(),
        "Bridge 应成功退出，stderr={}",
        String::from_utf8_lossy(&output.stderr)
    );

    let event = timeout(Duration::from_secs(2), receiver.recv())
        .await
        .expect("接收器应收到 Bridge 事件")
        .expect("Bridge 事件通道不应关闭");
    assert_eq!(event.source, CodexEventSource::App);
    assert_eq!(event.event_type, CodexEventType::SessionStarted);

    server.stop().await;
}

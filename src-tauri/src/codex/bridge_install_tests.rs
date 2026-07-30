use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

use super::bridge_install::{install_bridge, BridgeInstallError};

static NEXT_DIRECTORY_ID: AtomicUsize = AtomicUsize::new(0);

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new() -> Self {
        let directory = std::env::temp_dir().join(format!(
            "codepulse-codex-bridge-install-{}-{}",
            std::process::id(),
            NEXT_DIRECTORY_ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&directory).expect("应创建测试目录");
        Self(directory)
    }

    fn join(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn 写入_bridge_时先验证临时副本再原子替换固定路径() {
    let directory = TestDirectory::new();
    let source = directory.join("published-bridge.exe");
    let target = directory.join("app-data/codepulse-codex-bridge.exe");
    fs::write(&source, b"bridge-v1").expect("应写入测试 Bridge");

    install_bridge(&source, &target, |temporary| {
        assert!(temporary.is_file(), "验证时应使用同目录临时副本");
        assert_eq!(fs::read(temporary).expect("应读取临时副本"), b"bridge-v1");
        Ok(())
    })
    .expect("应写入并替换固定 Bridge 路径");

    assert_eq!(fs::read(&target).expect("应读取固定 Bridge"), b"bridge-v1");
    assert!(
        fs::read_dir(target.parent().expect("目标应有父目录"))
            .expect("应读取目标目录")
            .all(|entry| {
                entry
                    .expect("目录项应可读取")
                    .file_name()
                    .to_string_lossy()
                    .contains("codepulse-codex-bridge")
            }),
        "成功后不应残留临时 Bridge 文件"
    );
}

#[test]
fn bridge_验证失败时不替换已有固定文件() {
    let directory = TestDirectory::new();
    let source = directory.join("published-bridge.exe");
    let target = directory.join("app-data/codepulse-codex-bridge.exe");
    fs::create_dir_all(target.parent().expect("目标应有父目录")).expect("应创建目标目录");
    fs::write(&source, b"bridge-v2").expect("应写入测试 Bridge");
    fs::write(&target, b"bridge-v1").expect("应写入已有固定 Bridge");

    let result = install_bridge(&source, &target, |_| {
        Err(BridgeInstallError::Verification(
            "模拟最小可运行检查失败".to_string(),
        ))
    });

    assert!(result.is_err());
    assert_eq!(
        fs::read(&target).expect("验证失败后应读取已有固定 Bridge"),
        b"bridge-v1"
    );
}

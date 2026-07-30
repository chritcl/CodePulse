use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use super::runtime_discovery::{read_discovery, write_discovery_atomically, RuntimeDiscovery};

static NEXT_DIRECTORY_ID: AtomicUsize = AtomicUsize::new(0);

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new() -> Self {
        let directory = std::env::temp_dir().join(format!(
            "codepulse-codex-discovery-{}-{}",
            std::process::id(),
            NEXT_DIRECTORY_ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&directory).unwrap();
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

fn discovery(port: u16, token: &str) -> RuntimeDiscovery {
    RuntimeDiscovery {
        version: 1,
        port,
        token: token.to_string(),
        process_id: 1234,
        created_at_ms: 1_784_001_234_567,
    }
}

#[test]
fn replaces_an_existing_discovery_file_with_the_new_runtime() {
    let directory = TestDirectory::new();
    let path = directory.join("runtime.json");

    write_discovery_atomically(&path, &discovery(41001, "old-token")).unwrap();
    write_discovery_atomically(&path, &discovery(41002, "new-token")).unwrap();

    assert_eq!(
        read_discovery(&path).unwrap(),
        discovery(41002, "new-token")
    );
}

#[test]
fn rejects_discovery_data_with_an_unusable_port_or_token() {
    assert!(discovery(0, "valid-token").validate().is_err());
    assert!(discovery(41001, " ").validate().is_err());
}

#[test]
fn rejects_a_malformed_discovery_file() {
    let directory = TestDirectory::new();
    let path = directory.join("runtime.json");
    fs::write(&path, "{not-json}").unwrap();

    assert!(read_discovery(Path::new(&path)).is_err());
}

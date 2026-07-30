use std::fmt;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use serde::{Deserialize, Serialize};

pub const RUNTIME_DISCOVERY_VERSION: u8 = 1;
pub const RUNTIME_DISCOVERY_FILE_NAME: &str = "codepulse-codex-runtime.json";

static NEXT_TEMP_FILE_ID: AtomicUsize = AtomicUsize::new(0);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDiscovery {
    pub version: u8,
    pub port: u16,
    pub token: String,
    pub process_id: u32,
    pub created_at_ms: i64,
    #[serde(default)]
    pub capture_task_summary: bool,
}

#[derive(Debug)]
pub enum DiscoveryError {
    Io(std::io::Error),
    Serialization(serde_json::Error),
    Invalid(&'static str),
}

impl fmt::Display for DiscoveryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "发现文件 IO 错误: {error}"),
            Self::Serialization(error) => write!(formatter, "发现文件序列化错误: {error}"),
            Self::Invalid(reason) => write!(formatter, "发现文件无效: {reason}"),
        }
    }
}

impl std::error::Error for DiscoveryError {}

impl From<std::io::Error> for DiscoveryError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<serde_json::Error> for DiscoveryError {
    fn from(error: serde_json::Error) -> Self {
        Self::Serialization(error)
    }
}

impl RuntimeDiscovery {
    pub fn validate(&self) -> Result<(), DiscoveryError> {
        if self.version != RUNTIME_DISCOVERY_VERSION {
            return Err(DiscoveryError::Invalid("版本不受支持"));
        }
        if self.port == 0 {
            return Err(DiscoveryError::Invalid("端口不能为空"));
        }
        if self.token.trim().is_empty()
            || self.token.chars().count() > 256
            || self.token.chars().any(char::is_control)
        {
            return Err(DiscoveryError::Invalid("令牌无效"));
        }
        if self.process_id == 0 {
            return Err(DiscoveryError::Invalid("进程号不能为空"));
        }
        if self.created_at_ms <= 0 {
            return Err(DiscoveryError::Invalid("创建时间无效"));
        }

        Ok(())
    }
}

pub fn discovery_file_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(RUNTIME_DISCOVERY_FILE_NAME)
}

pub fn read_discovery(path: &Path) -> Result<RuntimeDiscovery, DiscoveryError> {
    let discovery = serde_json::from_slice::<RuntimeDiscovery>(&fs::read(path)?)?;
    discovery.validate()?;
    Ok(discovery)
}

pub fn write_discovery_atomically(
    path: &Path,
    discovery: &RuntimeDiscovery,
) -> Result<(), DiscoveryError> {
    discovery.validate()?;
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or(DiscoveryError::Invalid("缺少父目录"))?;
    fs::create_dir_all(parent)?;

    let temporary_path = temporary_path(path)?;
    let write_result = write_discovery_file(&temporary_path, discovery)
        .and_then(|_| replace_file_atomically(&temporary_path, path));

    if write_result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }

    write_result
}

fn temporary_path(path: &Path) -> Result<PathBuf, DiscoveryError> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or(DiscoveryError::Invalid("缺少父目录"))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or(DiscoveryError::Invalid("文件名无效"))?;
    let suffix = NEXT_TEMP_FILE_ID.fetch_add(1, Ordering::Relaxed);

    Ok(parent.join(format!(".{file_name}.tmp-{}-{suffix}", std::process::id())))
}

fn write_discovery_file(path: &Path, discovery: &RuntimeDiscovery) -> Result<(), DiscoveryError> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    serde_json::to_writer(&mut file, discovery)?;
    file.write_all(b"\n")?;
    file.sync_all()?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn replace_file_atomically(from: &Path, to: &Path) -> Result<(), DiscoveryError> {
    use std::os::windows::ffi::OsStrExt;

    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let from = from.as_os_str().encode_wide().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let to = to.as_os_str().encode_wide().chain(std::iter::once(0)).collect::<Vec<u16>>();

    // 安全性：两个 UTF-16 缓冲区在调用期间保持存活且以 NUL 结尾，路径均由本函数的 Path 参数提供。
    unsafe {
        MoveFileExW(
            PCWSTR::from_raw(from.as_ptr()),
            PCWSTR::from_raw(to.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    }
    .map_err(|error| DiscoveryError::Io(std::io::Error::other(error.to_string())))
}

#[cfg(not(target_os = "windows"))]
fn replace_file_atomically(from: &Path, to: &Path) -> Result<(), DiscoveryError> {
    fs::rename(from, to)?;
    Ok(())
}

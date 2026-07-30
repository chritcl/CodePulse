use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use sha2::{Digest, Sha256};

pub const CODEX_BRIDGE_FILE_NAME: &str = "codepulse-codex-bridge.exe";

static NEXT_TEMP_FILE_ID: AtomicUsize = AtomicUsize::new(0);

#[derive(Debug)]
pub enum BridgeInstallError {
    Io(io::Error),
    Invalid(&'static str),
    Verification(String),
}

impl fmt::Display for BridgeInstallError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "Bridge 文件 IO 错误: {error}"),
            Self::Invalid(reason) => write!(formatter, "Bridge 文件无效: {reason}"),
            Self::Verification(reason) => write!(formatter, "Bridge 验证失败: {reason}"),
        }
    }
}

impl std::error::Error for BridgeInstallError {}

impl From<io::Error> for BridgeInstallError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

pub fn bridge_target_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(CODEX_BRIDGE_FILE_NAME)
}

pub fn install_bridge<F>(
    source_path: &Path,
    target_path: &Path,
    verify: F,
) -> Result<(), BridgeInstallError>
where
    F: FnOnce(&Path) -> Result<(), BridgeInstallError>,
{
    validate_bridge_file(source_path)?;
    let parent = target_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or(BridgeInstallError::Invalid("缺少目标目录"))?;
    fs::create_dir_all(parent)?;

    let temporary_path = temporary_path(target_path)?;
    let write_result = copy_bridge_file(source_path, &temporary_path)
        .and_then(|_| verify(&temporary_path))
        .and_then(|_| replace_file_atomically(&temporary_path, target_path));

    if write_result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }

    write_result
}

pub fn verify_bridge_minimally(path: &Path) -> Result<(), BridgeInstallError> {
    validate_bridge_file(path)?;
    let status = std::process::Command::new(path)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map_err(BridgeInstallError::Io)?;

    if status.success() {
        Ok(())
    } else {
        Err(BridgeInstallError::Verification(format!(
            "退出码 {:?}",
            status.code()
        )))
    }
}

pub fn bridge_matches_source(
    source_path: &Path,
    target_path: &Path,
) -> Result<bool, BridgeInstallError> {
    if !source_path.is_file() || !target_path.is_file() {
        return Ok(false);
    }

    Ok(bridge_digest(source_path)? == bridge_digest(target_path)?)
}

fn validate_bridge_file(path: &Path) -> Result<(), BridgeInstallError> {
    let metadata = fs::metadata(path)?;
    if !metadata.is_file() {
        return Err(BridgeInstallError::Invalid("不是普通文件"));
    }
    if metadata.len() == 0 {
        return Err(BridgeInstallError::Invalid("文件为空"));
    }

    Ok(())
}

fn copy_bridge_file(source_path: &Path, target_path: &Path) -> Result<(), BridgeInstallError> {
    let mut source = File::open(source_path)?;
    let mut target = OpenOptions::new().write(true).create_new(true).open(target_path)?;
    io::copy(&mut source, &mut target)?;
    target.flush()?;
    target.sync_all()?;
    Ok(())
}

fn bridge_digest(path: &Path) -> Result<[u8; 32], BridgeInstallError> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 8192];

    loop {
        let read_count = file.read(&mut buffer)?;
        if read_count == 0 {
            break;
        }
        hasher.update(&buffer[..read_count]);
    }

    Ok(hasher.finalize().into())
}

fn temporary_path(path: &Path) -> Result<PathBuf, BridgeInstallError> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or(BridgeInstallError::Invalid("缺少目标目录"))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or(BridgeInstallError::Invalid("目标文件名无效"))?;
    let extension = path.extension().and_then(|extension| extension.to_str()).unwrap_or("tmp");
    let suffix = NEXT_TEMP_FILE_ID.fetch_add(1, Ordering::Relaxed);

    Ok(parent.join(format!(
        ".{file_name}.codepulse-{}-{suffix}.tmp.{extension}",
        std::process::id()
    )))
}

#[cfg(target_os = "windows")]
fn replace_file_atomically(from: &Path, to: &Path) -> Result<(), BridgeInstallError> {
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
    .map_err(|error| BridgeInstallError::Io(io::Error::other(error.to_string())))
}

#[cfg(not(target_os = "windows"))]
fn replace_file_atomically(from: &Path, to: &Path) -> Result<(), BridgeInstallError> {
    fs::rename(from, to)?;
    Ok(())
}

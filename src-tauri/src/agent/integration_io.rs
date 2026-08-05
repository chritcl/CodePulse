use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use sha2::{Digest, Sha256};

static NEXT_TEMP_FILE_ID: AtomicUsize = AtomicUsize::new(0);

#[derive(Debug)]
pub enum IntegrationIoError {
    Io(io::Error),
    Invalid(String),
}

impl fmt::Display for IntegrationIoError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "配置文件 IO 错误: {error}"),
            Self::Invalid(reason) => write!(formatter, "配置文件无效: {reason}"),
        }
    }
}

impl std::error::Error for IntegrationIoError {}

impl From<io::Error> for IntegrationIoError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

pub fn configuration_digest(path: &Path) -> Result<Option<[u8; 32]>, IntegrationIoError> {
    if !path.exists() {
        return Ok(None);
    }
    if !path.is_file() {
        return Err(IntegrationIoError::Invalid(format!(
            "配置目标不是普通文件: {}",
            path.display()
        )));
    }
    Ok(Some(Sha256::digest(fs::read(path)?).into()))
}

pub fn write_json_configuration_atomically(
    path: &Path,
    content: &str,
) -> Result<Option<String>, IntegrationIoError> {
    serde_json::from_str::<serde_json::Value>(content)
        .map_err(|error| IntegrationIoError::Invalid(format!("JSON 校验失败: {error}")))?;
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| IntegrationIoError::Invalid("配置缺少父目录".to_string()))?;
    fs::create_dir_all(parent)?;
    if path.exists() && !path.is_file() {
        return Err(IntegrationIoError::Invalid(
            "配置目标不是普通文件".to_string(),
        ));
    }

    let backup = if path.exists() {
        let backup_path = backup_path(path)?;
        copy_file_with_sync(path, &backup_path)?;
        backup_path.file_name().and_then(|name| name.to_str()).map(ToString::to_string)
    } else {
        None
    };
    let temporary_path = temporary_configuration_path(path)?;
    let result = write_configuration_file(&temporary_path, content)
        .and_then(|_| {
            let temporary_content = fs::read_to_string(&temporary_path)?;
            serde_json::from_str::<serde_json::Value>(&temporary_content)
                .map(|_| ())
                .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
        })
        .and_then(|_| replace_configuration_file_atomically(&temporary_path, path));
    if result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    result?;
    Ok(backup)
}

fn backup_path(path: &Path) -> Result<PathBuf, IntegrationIoError> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| IntegrationIoError::Invalid("配置缺少父目录".to_string()))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| IntegrationIoError::Invalid("配置文件名无效".to_string()))?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    for suffix in 0_u32.. {
        let suffix = if suffix == 0 {
            String::new()
        } else {
            format!("-{suffix}")
        };
        let backup = parent.join(format!("{file_name}.codepulse-{timestamp}{suffix}.bak"));
        if !backup.exists() {
            return Ok(backup);
        }
    }
    unreachable!("备份文件序号应始终可用")
}

fn temporary_configuration_path(path: &Path) -> Result<PathBuf, IntegrationIoError> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| IntegrationIoError::Invalid("配置缺少父目录".to_string()))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| IntegrationIoError::Invalid("配置文件名无效".to_string()))?;
    let suffix = NEXT_TEMP_FILE_ID.fetch_add(1, Ordering::Relaxed);
    Ok(parent.join(format!(
        ".{file_name}.codepulse-{}-{suffix}.tmp",
        std::process::id()
    )))
}

fn copy_file_with_sync(source_path: &Path, target_path: &Path) -> Result<(), IntegrationIoError> {
    let mut source = File::open(source_path)?;
    let mut target = OpenOptions::new().write(true).create_new(true).open(target_path)?;
    io::copy(&mut source, &mut target)?;
    target.flush()?;
    target.sync_all()?;
    Ok(())
}

fn write_configuration_file(path: &Path, content: &str) -> io::Result<()> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    file.write_all(content.as_bytes())?;
    file.sync_all()?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn replace_configuration_file_atomically(from: &Path, to: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let from = from.as_os_str().encode_wide().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let to = to.as_os_str().encode_wide().chain(std::iter::once(0)).collect::<Vec<u16>>();

    // 安全性：两个 UTF-16 缓冲区在调用期间保持存活且以 NUL 结尾，路径来自已验证的 Path 参数。
    unsafe {
        MoveFileExW(
            PCWSTR::from_raw(from.as_ptr()),
            PCWSTR::from_raw(to.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    }
    .map_err(|error| io::Error::other(error.to_string()))
}

#[cfg(not(target_os = "windows"))]
fn replace_configuration_file_atomically(from: &Path, to: &Path) -> io::Result<()> {
    fs::rename(from, to)
}

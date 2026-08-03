use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;
use sha2::{Digest, Sha256};
use toml_edit::{DocumentMut, Item, Value as TomlValue};

use super::super::config::{apply_codepulse_hook_mutation, HookConfigFormat, HookMutation};
use super::{IntegrationError, SelectedConfigRepresentation};

static NEXT_TEMP_FILE_ID: AtomicUsize = AtomicUsize::new(0);

pub(super) fn configuration_digest(path: &Path) -> Result<Option<[u8; 32]>, IntegrationError> {
    if !path.exists() {
        return Ok(None);
    }
    if !path.is_file() {
        return Err(IntegrationError::Invalid(format!(
            "配置目标不是普通文件: {}",
            path.display()
        )));
    }

    let bytes = fs::read(path)?;
    Ok(Some(Sha256::digest(bytes).into()))
}

pub(super) fn hook_config_format(
    representation: &SelectedConfigRepresentation,
) -> Result<HookConfigFormat, IntegrationError> {
    match representation {
        SelectedConfigRepresentation::HooksJson => Ok(HookConfigFormat::HooksJson),
        SelectedConfigRepresentation::ConfigToml => Ok(HookConfigFormat::ConfigToml),
        SelectedConfigRepresentation::Ambiguous | SelectedConfigRepresentation::Invalid => Err(
            IntegrationError::Invalid("无法安全选择 Hook 配置表示".to_string()),
        ),
    }
}

pub(super) fn update_configuration(
    path: &Path,
    format: HookConfigFormat,
    bridge_command: &str,
    mutation: HookMutation,
) -> Result<Option<String>, IntegrationError> {
    let original = if path.exists() {
        fs::read_to_string(path)?
    } else {
        default_configuration_content(format).to_string()
    };
    let updated = apply_codepulse_hook_mutation(format, &original, bridge_command, mutation)?;

    write_configuration_atomically(path, format, &updated)
}

fn default_configuration_content(format: HookConfigFormat) -> &'static str {
    match format {
        HookConfigFormat::HooksJson => "{\n  \"hooks\": {}\n}\n",
        HookConfigFormat::ConfigToml => "",
    }
}

fn write_configuration_atomically(
    path: &Path,
    format: HookConfigFormat,
    content: &str,
) -> Result<Option<String>, IntegrationError> {
    validate_configuration_content(format, content)?;
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| IntegrationError::Invalid("配置缺少父目录".to_string()))?;
    fs::create_dir_all(parent)?;
    if path.exists() && !path.is_file() {
        return Err(IntegrationError::Invalid(
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
            validate_configuration_content(format, &temporary_content)
        })
        .and_then(|_| replace_configuration_file_atomically(&temporary_path, path));

    if result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    result?;

    Ok(backup)
}

fn validate_configuration_content(
    format: HookConfigFormat,
    content: &str,
) -> Result<(), IntegrationError> {
    match format {
        HookConfigFormat::HooksJson => {
            serde_json::from_str::<Value>(content).map_err(|error| {
                IntegrationError::Invalid(format!("hooks.json 校验失败: {error}"))
            })?;
        }
        HookConfigFormat::ConfigToml => {
            content.parse::<DocumentMut>().map_err(|error| {
                IntegrationError::Invalid(format!("config.toml 校验失败: {error}"))
            })?;
        }
    }
    Ok(())
}

fn backup_path(path: &Path) -> Result<PathBuf, IntegrationError> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| IntegrationError::Invalid("配置缺少父目录".to_string()))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| IntegrationError::Invalid("配置文件名无效".to_string()))?;
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

fn temporary_configuration_path(path: &Path) -> Result<PathBuf, IntegrationError> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| IntegrationError::Invalid("配置缺少父目录".to_string()))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| IntegrationError::Invalid("配置文件名无效".to_string()))?;
    let suffix = NEXT_TEMP_FILE_ID.fetch_add(1, Ordering::Relaxed);

    Ok(parent.join(format!(
        ".{file_name}.codepulse-{}-{suffix}.tmp",
        std::process::id()
    )))
}

fn copy_file_with_sync(source_path: &Path, target_path: &Path) -> Result<(), IntegrationError> {
    let mut source = File::open(source_path)?;
    let mut target = OpenOptions::new().write(true).create_new(true).open(target_path)?;
    io::copy(&mut source, &mut target)?;
    target.flush()?;
    target.sync_all()?;
    Ok(())
}

fn write_configuration_file(path: &Path, content: &str) -> Result<(), IntegrationError> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    file.write_all(content.as_bytes())?;
    file.sync_all()?;
    Ok(())
}

pub(super) fn remove_unreferenced_bridge(codex_home: &Path, bridge_path: &Path) -> bool {
    let bridge_reference = bridge_path.display().to_string();
    for (name, format) in [
        ("hooks.json", HookConfigFormat::HooksJson),
        ("config.toml", HookConfigFormat::ConfigToml),
    ] {
        let path = codex_home.join(name);
        if !path.exists() {
            continue;
        }
        if !path.is_file() {
            return true;
        }
        let Ok(content) = fs::read_to_string(path) else {
            return true;
        };
        if configuration_references_bridge(format, &content, &bridge_reference) {
            return false;
        }
    }

    match fs::remove_file(bridge_path) {
        Ok(()) => false,
        Err(error) if error.kind() == io::ErrorKind::NotFound => false,
        Err(_) => true,
    }
}

fn configuration_references_bridge(
    format: HookConfigFormat,
    content: &str,
    bridge_reference: &str,
) -> bool {
    match format {
        HookConfigFormat::HooksJson => serde_json::from_str::<Value>(content)
            .map(|value| json_value_references_bridge(&value, bridge_reference))
            .unwrap_or(true),
        HookConfigFormat::ConfigToml => content
            .parse::<DocumentMut>()
            .map(|document| toml_document_references_bridge(&document, bridge_reference))
            .unwrap_or(true),
    }
}

fn json_value_references_bridge(value: &Value, bridge_reference: &str) -> bool {
    match value {
        Value::String(text) => text.contains(bridge_reference),
        Value::Array(items) => {
            items.iter().any(|item| json_value_references_bridge(item, bridge_reference))
        }
        Value::Object(entries) => entries
            .values()
            .any(|item| json_value_references_bridge(item, bridge_reference)),
        Value::Null | Value::Bool(_) | Value::Number(_) => false,
    }
}

fn toml_document_references_bridge(document: &DocumentMut, bridge_reference: &str) -> bool {
    document
        .iter()
        .any(|(_, item)| toml_item_references_bridge(item, bridge_reference))
}

fn toml_item_references_bridge(item: &Item, bridge_reference: &str) -> bool {
    match item {
        Item::None => false,
        Item::Value(value) => toml_value_references_bridge(value, bridge_reference),
        Item::Table(table) => table
            .iter()
            .any(|(_, value)| toml_item_references_bridge(value, bridge_reference)),
        Item::ArrayOfTables(tables) => tables.iter().any(|table| {
            table
                .iter()
                .any(|(_, value)| toml_item_references_bridge(value, bridge_reference))
        }),
    }
}

fn toml_value_references_bridge(value: &TomlValue, bridge_reference: &str) -> bool {
    value.as_str().is_some_and(|text| text.contains(bridge_reference))
        || value.as_array().is_some_and(|values| {
            values.iter().any(|value| toml_value_references_bridge(value, bridge_reference))
        })
        || value.as_inline_table().is_some_and(|table| {
            table
                .iter()
                .any(|(_, value)| toml_value_references_bridge(value, bridge_reference))
        })
}

#[cfg(target_os = "windows")]
fn replace_configuration_file_atomically(from: &Path, to: &Path) -> Result<(), IntegrationError> {
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
    .map_err(|error| IntegrationError::Io(io::Error::other(error.to_string())))
}

#[cfg(not(target_os = "windows"))]
fn replace_configuration_file_atomically(from: &Path, to: &Path) -> Result<(), IntegrationError> {
    fs::rename(from, to)?;
    Ok(())
}

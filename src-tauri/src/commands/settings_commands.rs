use serde::{Deserialize, Serialize};
/**
 * 设置相关命令
 *
 * 包含统一的设置更新和快照获取命令。
 * 用于替代分散的控制事件，实现统一状态管理。
 */
use tauri::{Emitter, Manager};

/// 灵动岛设置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IslandSettings {
    /// 是否启用
    pub enabled: bool,
    /// 主题 (black/white)
    pub theme: String,
    /// 透明度 (0-100)
    pub opacity: u8,
    /// 是否置于任务栏
    pub pin_to_taskbar: bool,
    /// 是否锁定位置
    pub position_locked: bool,
    /// 是否启用流光边框
    pub glow_border: bool,
    /// 是否启用静默模式
    pub silent_mode: bool,
    /// 是否启用轮换模式
    pub rotation_enabled: bool,
}

/// 模块开关
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleToggles {
    /// 音乐控制器
    pub music_enabled: bool,
    /// 硬件监控
    pub hardware_enabled: bool,
    /// 消息通知
    pub notification_enabled: bool,
    /// 消息模式
    pub msg_mode_enabled: bool,
}

/// 应用设置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    /// 灵动岛设置
    pub island: IslandSettings,
    /// 模块开关
    pub modules: ModuleToggles,
    /// 目标音乐平台
    pub target_player: String,
}

/// 应用快照
///
/// 包含应用程序的完整状态，用于同步主窗口和灵动岛。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSnapshot {
    /// 应用设置
    pub settings: AppSettings,
    /// 更新时间戳
    pub updated_at: u64,
}

/// 获取应用快照
///
/// 返回当前应用的完整状态快照。
#[tauri::command]
pub fn get_app_snapshot() -> AppSnapshot {
    // 从本地存储读取设置
    // 注意：这里使用简化的实现，实际应该从 Rust 存储读取
    AppSnapshot {
        settings: AppSettings {
            island: IslandSettings {
                enabled: true,
                theme: "black".to_string(),
                opacity: 100,
                pin_to_taskbar: false,
                position_locked: false,
                glow_border: false,
                silent_mode: false,
                rotation_enabled: false,
            },
            modules: ModuleToggles {
                music_enabled: false,
                hardware_enabled: false,
                notification_enabled: false,
                msg_mode_enabled: false,
            },
            target_player: "netease".to_string(),
        },
        updated_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
    }
}

/// 更新应用设置
///
/// 接收前端的设置补丁，更新对应设置并广播变更事件。
#[tauri::command]
pub fn update_settings(
    app: tauri::AppHandle,
    patch: serde_json::Value,
) -> Result<AppSettings, String> {
    // 解析补丁
    // 注意：这里使用简化的实现，实际应该合并到现有设置中

    // 广播设置更新事件
    let _ = app.emit("app.settings.updated", &patch);

    // 返回更新后的设置（简化实现）
    Ok(get_app_snapshot().settings)
}

/// 设置灵动岛可见性
///
/// 统一的灵动岛显隐控制命令。
#[tauri::command]
pub fn set_island_visible(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    // 广播显隐事件
    let _ = app.emit(
        "app.island.visibility",
        serde_json::json!({ "visible": visible }),
    );

    // 控制窗口显隐
    if let Some(widget_window) = app.get_webview_window("widget") {
        if visible {
            let _ = widget_window.show();
            let _ = widget_window.set_always_on_top(true);
        } else {
            let _ = widget_window.hide();
        }
    }

    Ok(())
}

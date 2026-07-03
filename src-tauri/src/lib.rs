/**
 * NetSpeed Dynamic Pro - 主入口模块
 *
 * 本模块负责：
 * 1. 应用程序初始化
 * 2. Tauri 插件注册
 * 3. 命令处理器注册
 * 4. 系统托盘设置
 * 5. 窗口事件处理
 */

mod app;
mod commands;
mod error;

use tauri::{Manager, Menu, MenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton};
use tauri_plugin_autostart::MacosLauncher;

use app::AppState;
use commands::*;

/// 应用程序入口点
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 注册插件
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--autostart"])))
        // 注册全局状态
        .manage(AppState::new())
        // 注册命令处理器
        .invoke_handler(tauri::generate_handler![
            // 媒体控制命令
            set_target_player,
            fetch_netease_music_info,
            control_system_media,
            get_random_cover_url,
            // 系统监控命令
            get_network_stats,
            get_hardware_stats,
            get_network_latency,
            // 窗口管理命令
            is_widget_visible,
            force_window_topmost,
            set_window_bounds,
            start_island_animation,
            // 通知命令
            fetch_latest_notification,
            open_app_by_aumid,
            // 设置命令 (R4 新增)
            get_app_snapshot,
            update_settings,
            set_island_visible,
        ])
        .setup(|app| {
            // 检查是否为自启动
            let args: Vec<String> = std::env::args().collect();
            let is_autostart = args.iter().any(|arg| arg == "--autostart");

            // 显示主窗口（非自启动时）
            if let Some(main_window) = app.get_webview_window("main") {
                if !is_autostart {
                    let _ = main_window.show();
                    let _ = main_window.set_focus();
                }
            }

            // 创建系统托盘菜单
            let quit_item = MenuItem::with_id(app, "quit", "强制退出", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&quit_item])?;

            // 构建系统托盘
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("NetSpeed Dynamic Pro")
                .menu(&tray_menu)
                .on_menu_event(move |_app_handle, event| {
                    if event.id == "quit" {
                        std::process::exit(0);
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, .. } = event {
                        if let Some(main_window) = tray.app_handle().get_webview_window("main") {
                            let _ = main_window.show();
                            let _ = main_window.unminimize();
                            let _ = main_window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // 主窗口关闭时隐藏而不是退出
            if let Some(main_window) = app.get_webview_window("main") {
                let w_clone = main_window.clone();
                main_window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = w_clone.hide();
                    }
                });
            }

            // 灵动岛窗口事件处理
            if let Some(widget_window) = app.get_webview_window("widget") {
                #[cfg(target_os = "windows")]
                {
                    // 设置窗口样式
                    use winapi::um::winuser::{SetWindowLongW, GetWindowLongW, GWL_EXSTYLE, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT};
                    if let Ok(hwnd) = widget_window.hwnd() {
                        unsafe {
                            let ex_style = GetWindowLongW(hwnd.0 as _, GWL_EXSTYLE);
                            SetWindowLongW(hwnd.0 as _, GWL_EXSTYLE, ex_style | WS_EX_TOOLWINDOW as i32 | WS_EX_TRANSPARENT as i32);
                        }
                    }
                }

                let w_clone = widget_window.clone();
                widget_window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = w_clone.hide();
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("运行 Tauri 应用程序时发生错误");
}

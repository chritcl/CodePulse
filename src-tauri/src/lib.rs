/**
 * 网速灵动岛应用主入口模块
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
pub mod lyrics;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;
use tauri_plugin_autostart::MacosLauncher;

use app::AppState;
use commands::*;
use lyrics::LyricsService;

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
            get_music_playback_state,
            control_system_media,
            get_random_cover_url,
            get_lyrics_for_track,
            get_audio_spectrum,
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
            // 设置命令
            get_app_snapshot,
            update_settings,
            set_island_visible,
        ])
        .setup(initialize_app)
        .run(tauri::generate_context!())
        .expect("运行 Tauri 应用程序时发生错误");
}

/// 初始化歌词服务、后台监控、窗口和系统托盘。
fn initialize_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let lyrics_dir = app.path().app_data_dir()?.join("lyrics");
    app.manage(LyricsService::new(lyrics_dir)?);

    start_audio_spectrum_monitor();
    start_system_event_monitor(app.handle().clone());
    show_main_window_for_launch_mode(app);
    let _tray = create_system_tray(app)?;
    register_main_window_close_handler(app);
    register_widget_window_close_handler(app);
    Ok(())
}

/// 非自启动时展示并聚焦主窗口。
fn show_main_window_for_launch_mode(app: &tauri::App) {
    let args: Vec<String> = std::env::args().collect();
    let is_autostart = args.iter().any(|arg| arg == "--autostart");
    if let Some(main_window) = app.get_webview_window("main") {
        if !is_autostart {
            let _ = main_window.show();
            let _ = main_window.set_focus();
        }
    }
}

/// 创建系统托盘及其菜单和点击事件。
fn create_system_tray(app: &tauri::App) -> tauri::Result<tauri::tray::TrayIcon> {
    let quit_item = MenuItem::with_id(app, "quit", "强制退出", true, None::<&str>)?;
    let tray_menu = Menu::with_items(app, &[&quit_item])?;
    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("NetSpeed Dynamic Pro")
        .menu(&tray_menu)
        .on_menu_event(move |_app_handle, event| {
            if event.id == "quit" {
                std::process::exit(0);
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                ..
            } = event
            {
                if let Some(main_window) = tray.app_handle().get_webview_window("main") {
                    let _ = main_window.show();
                    let _ = main_window.unminimize();
                    let _ = main_window.set_focus();
                }
            }
        })
        .build(app)
}

/// 主窗口收到关闭请求时改为隐藏。
fn register_main_window_close_handler(app: &tauri::App) {
    if let Some(main_window) = app.get_webview_window("main") {
        let w_clone = main_window.clone();
        main_window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = w_clone.hide();
            }
        });
    }
}

/// 灵动岛窗口收到关闭请求时改为隐藏。
fn register_widget_window_close_handler(app: &tauri::App) {
    if let Some(widget_window) = app.get_webview_window("widget") {
        #[cfg(target_os = "windows")]
        configure_widget_window_styles(&widget_window);

        let w_clone = widget_window.clone();
        widget_window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = w_clone.hide();
            }
        });
    }
}

/// 设置灵动岛窗口扩展样式，避免出现在任务切换器中并允许鼠标穿透。
#[cfg(target_os = "windows")]
fn configure_widget_window_styles(widget_window: &tauri::WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongW, SetWindowLongW, GWL_EXSTYLE, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
    };

    if let Ok(hwnd) = widget_window.hwnd() {
        // 安全性：句柄来自 Tauri 当前窗口，只修改该窗口扩展样式，不保存裸指针。
        unsafe {
            let hwnd = HWND(hwnd.0 as _);
            let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
            let _ = SetWindowLongW(
                hwnd,
                GWL_EXSTYLE,
                ex_style | WS_EX_TOOLWINDOW.0 as i32 | WS_EX_TRANSPARENT.0 as i32,
            );
        }
    }
}

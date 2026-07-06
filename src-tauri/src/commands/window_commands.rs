/**
 * 窗口管理命令
 *
 * 包含窗口置顶、位置调整、动画等相关命令。
 */
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// 动画 ID 计数器
static ANIMATION_ID: AtomicU32 = AtomicU32::new(0);

/// 动画锚点状态
struct AnchorState {
    center_x: i32,
    origin_y: i32,
    left_x: i32,
    bottom_y: i32,
    active_id: u32,
}

/// 动画期间固定锚点，避免连续动画互相覆盖
static ANIMATION_ANCHOR: Mutex<Option<AnchorState>> = Mutex::new(None);

/// 检查灵动岛是否可见
#[tauri::command]
pub fn is_widget_visible(app: tauri::AppHandle) -> bool {
    match app.get_webview_window("widget") {
        Some(win) => win.is_visible().unwrap_or(false),
        None => false,
    }
}

/// 强制窗口置顶
#[tauri::command]
pub fn force_window_topmost(app: tauri::AppHandle) {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::{HWND, RECT};
        use windows::Win32::Graphics::Gdi::{
            GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
        };
        use windows::Win32::UI::WindowsAndMessaging::{
            GetClassNameW, GetForegroundWindow, GetWindowRect, SetWindowPos, HWND_TOPMOST,
            SET_WINDOW_POS_FLAGS, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        };

        // 安全性：前台窗口句柄由系统返回，灵动岛句柄由 Tauri 返回；本块只进行同步查询和置顶调用。
        unsafe {
            let fg_hwnd = GetForegroundWindow();
            if !fg_hwnd.is_invalid() {
                let mut class_name = [0u16; 256];
                let len = GetClassNameW(fg_hwnd, &mut class_name);
                let class_str = String::from_utf16_lossy(&class_name[..len as usize]);

                // 如果是系统菜单，不处理
                if class_str == "#32768" {
                    return;
                }

                let mut rect: RECT = std::mem::zeroed();
                let _ = GetWindowRect(fg_hwnd, &mut rect);

                let monitor = MonitorFromWindow(fg_hwnd, MONITOR_DEFAULTTONEAREST);
                let mut mi: MONITORINFO = std::mem::zeroed();
                mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
                let _ = GetMonitorInfoW(monitor, &mut mi);

                // 如果是全屏应用，不处理（除非是桌面）
                if rect.left == mi.rcMonitor.left
                    && rect.top == mi.rcMonitor.top
                    && rect.right == mi.rcMonitor.right
                    && rect.bottom == mi.rcMonitor.bottom
                    && class_str != "Progman"
                    && class_str != "WorkerW"
                {
                    return;
                }
            }

            // 设置灵动岛窗口置顶
            if let Some(win) = app.get_webview_window("widget") {
                if let Ok(hwnd) = win.hwnd() {
                    let flags =
                        SET_WINDOW_POS_FLAGS(SWP_NOMOVE.0 | SWP_NOSIZE.0 | SWP_NOACTIVATE.0);
                    let _ = SetWindowPos(HWND(hwnd.0 as _), HWND_TOPMOST, 0, 0, 0, 0, flags);
                }
            }
        }
    }
}

/// 设置窗口边界
///
/// 原子化调整窗口位置和大小，避免闪烁。
#[tauri::command]
pub fn set_window_bounds(app: tauri::AppHandle, x: i32, y: i32, width: i32, height: i32) {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, SET_WINDOW_POS_FLAGS, SWP_NOACTIVATE, SWP_NOZORDER,
        };

        if let Some(win) = app.get_webview_window("widget") {
            if let Ok(hwnd) = win.hwnd() {
                // 安全性：句柄来自当前灵动岛窗口，SetWindowPos 只调整位置和尺寸，不持有指针。
                unsafe {
                    let flags = SET_WINDOW_POS_FLAGS(SWP_NOACTIVATE.0 | SWP_NOZORDER.0);
                    let _ = SetWindowPos(
                        HWND(hwnd.0 as _),
                        HWND(std::ptr::null_mut()),
                        x,
                        y,
                        width,
                        height,
                        flags,
                    );
                }
            }
        }
    }
}

/// 启动灵动岛动画
///
/// 使用弹簧物理模型驱动窗口大小和位置变化。
#[tauri::command]
pub async fn start_island_animation(
    window: tauri::WebviewWindow,
    start_width: f64,
    start_height: f64,
    target_width: f64,
    target_height: f64,
    is_pinned: bool,
) -> Result<(), String> {
    let id = ANIMATION_ID.fetch_add(1, Ordering::SeqCst) + 1;
    let scale_factor = window.scale_factor().unwrap_or(1.0);

    #[cfg(target_os = "windows")]
    {
        if let Ok(hwnd) = window.hwnd() {
            use windows::Win32::Foundation::{HWND, RECT};
            use windows::Win32::UI::WindowsAndMessaging::{
                GetWindowRect, SetWindowPos, SET_WINDOW_POS_FLAGS, SWP_NOACTIVATE, SWP_NOZORDER,
            };

            // 安全性：RECT 是 Win32 POD 结构，零初始化后立即传给 GetWindowRect 填充。
            let mut rect: RECT = unsafe { std::mem::zeroed() };
            // 安全性：句柄来自 Tauri 窗口，只读取当前窗口矩形。
            unsafe {
                let _ = GetWindowRect(HWND(hwnd.0 as _), &mut rect);
            }

            let (anchor_center_x, anchor_origin_y, anchor_left_x, anchor_bottom_y) = {
                let mut anchor_guard =
                    ANIMATION_ANCHOR.lock().unwrap_or_else(|err| err.into_inner());

                if let Some(anchor) = anchor_guard.as_mut() {
                    anchor.active_id = id;
                    (
                        anchor.center_x,
                        anchor.origin_y,
                        anchor.left_x,
                        anchor.bottom_y,
                    )
                } else {
                    let anchor = AnchorState {
                        center_x: rect.left + (rect.right - rect.left) / 2,
                        origin_y: rect.top,
                        left_x: rect.left,
                        bottom_y: rect.bottom,
                        active_id: id,
                    };
                    let values = (
                        anchor.center_x,
                        anchor.origin_y,
                        anchor.left_x,
                        anchor.bottom_y,
                    );
                    *anchor_guard = Some(anchor);
                    values
                }
            };

            let window_clone = window.clone();
            let hwnd_raw = hwnd.0 as isize;

            std::thread::spawn(move || {
                let start_time = std::time::Instant::now();
                let duration = std::time::Duration::from_millis(400);
                let freq = 2.4;
                let decay = 12.0;

                while start_time.elapsed() < duration {
                    std::thread::sleep(std::time::Duration::from_millis(8));

                    // 检查是否被新动画打断
                    if ANIMATION_ID.load(Ordering::SeqCst) != id {
                        return;
                    }

                    let elapsed = start_time.elapsed().as_secs_f64();
                    let progress = elapsed / 0.4;
                    if progress >= 1.0 {
                        break;
                    }

                    // 弹簧衰减方程
                    let spring = 1.0
                        - (freq * elapsed * 2.0 * std::f64::consts::PI).cos()
                            * (-decay * elapsed).exp();
                    let current_w = start_width + (target_width - start_width) * spring;
                    let current_h = start_height + (target_height - start_height) * spring;

                    let phys_window_w = (current_w * scale_factor).round() as i32;
                    let phys_window_h = (current_h * scale_factor).round() as i32;

                    let (final_x, final_y) = if is_pinned {
                        (anchor_left_x, anchor_bottom_y - phys_window_h)
                    } else {
                        (anchor_center_x - phys_window_w / 2, anchor_origin_y)
                    };

                    // 安全性：线程内仅复用已取得的窗口句柄数值执行 SetWindowPos，动画中断由原子 ID 控制。
                    unsafe {
                        let flags = SET_WINDOW_POS_FLAGS(SWP_NOACTIVATE.0 | SWP_NOZORDER.0);
                        let _ = SetWindowPos(
                            HWND(hwnd_raw as _),
                            HWND(std::ptr::null_mut()),
                            final_x,
                            final_y,
                            phys_window_w,
                            phys_window_h,
                            flags,
                        );
                    }
                }

                // 终点收尾
                if ANIMATION_ID.load(Ordering::SeqCst) == id {
                    let phys_target_w = (target_width * scale_factor).round() as i32;
                    let phys_target_h = (target_height * scale_factor).round() as i32;

                    let (final_x, final_y) = if is_pinned {
                        (anchor_left_x, anchor_bottom_y - phys_target_h)
                    } else {
                        (anchor_center_x - phys_target_w / 2, anchor_origin_y)
                    };

                    // 安全性：终点收尾只对同一个窗口句柄设置最终位置和尺寸。
                    unsafe {
                        let flags = SET_WINDOW_POS_FLAGS(SWP_NOACTIVATE.0 | SWP_NOZORDER.0);
                        let _ = SetWindowPos(
                            HWND(hwnd_raw as _),
                            HWND(std::ptr::null_mut()),
                            final_x,
                            final_y,
                            phys_target_w,
                            phys_target_h,
                            flags,
                        );
                    }
                    let _ = window_clone.emit("island-resize", vec![target_width, target_height]);

                    if let Ok(mut guard) = ANIMATION_ANCHOR.lock() {
                        if guard.as_ref().is_some_and(|anchor| anchor.active_id == id) {
                            *guard = None;
                        }
                    }
                }
            });
        }
    }
    Ok(())
}

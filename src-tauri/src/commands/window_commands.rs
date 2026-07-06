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
static ANIMATION_CENTER_X: Mutex<Option<i32>> = Mutex::new(None);
static ANIMATION_ORIGIN_Y: Mutex<Option<i32>> = Mutex::new(None);
static ANIMATION_LEFT_X: Mutex<Option<i32>> = Mutex::new(None);
static ANIMATION_BOTTOM_Y: Mutex<Option<i32>> = Mutex::new(None);

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
        use winapi::shared::windef::RECT;
        use winapi::um::winuser::{
            GetClassNameW, GetForegroundWindow, GetMonitorInfoW, GetWindowRect, MonitorFromWindow,
            SetWindowPos,
        };

        // 安全性：前台窗口句柄由系统返回，灵动岛句柄由 Tauri 返回；本块只进行同步查询和置顶调用。
        unsafe {
            let fg_hwnd = GetForegroundWindow();
            if !fg_hwnd.is_null() {
                let mut class_name = [0u16; 256];
                let len = GetClassNameW(fg_hwnd, class_name.as_mut_ptr(), class_name.len() as i32);
                let class_str = String::from_utf16_lossy(&class_name[..len as usize]);

                // 如果是系统菜单，不处理
                if class_str == "#32768" {
                    return;
                }

                let mut rect: RECT = std::mem::zeroed();
                GetWindowRect(fg_hwnd, &mut rect);

                let monitor =
                    MonitorFromWindow(fg_hwnd, winapi::um::winuser::MONITOR_DEFAULTTONEAREST);
                let mut mi: winapi::um::winuser::MONITORINFO = std::mem::zeroed();
                mi.cbSize = std::mem::size_of::<winapi::um::winuser::MONITORINFO>() as u32;
                GetMonitorInfoW(monitor, &mut mi);

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
                    SetWindowPos(hwnd.0 as _, -1isize as _, 0, 0, 0, 0, 19);
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
        if let Some(win) = app.get_webview_window("widget") {
            if let Ok(hwnd) = win.hwnd() {
                // 安全性：句柄来自当前灵动岛窗口，SetWindowPos 只调整位置和尺寸，不持有指针。
                unsafe {
                    // SWP_NOACTIVATE | SWP_NOZORDER
                    winapi::um::winuser::SetWindowPos(
                        hwnd.0 as _,
                        std::ptr::null_mut(),
                        x,
                        y,
                        width,
                        height,
                        0x0014,
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
            use winapi::shared::windef::RECT;
            use winapi::um::winuser::{GetWindowRect, SetWindowPos};

            // 安全性：RECT 是 Win32 POD 结构，零初始化后立即传给 GetWindowRect 填充。
            let mut rect: RECT = unsafe { std::mem::zeroed() };
            // 安全性：句柄来自 Tauri 窗口，只读取当前窗口矩形。
            unsafe {
                GetWindowRect(hwnd.0 as _, &mut rect);
            }

            // 首次启动时锁死锚点
            if let Ok(guard) = ANIMATION_CENTER_X.lock() {
                if guard.is_none() {
                    drop(guard);
                    if let Ok(mut guard) = ANIMATION_CENTER_X.lock() {
                        *guard = Some(rect.left + (rect.right - rect.left) / 2);
                    }
                    if let Ok(mut guard) = ANIMATION_ORIGIN_Y.lock() {
                        *guard = Some(rect.top);
                    }
                    if let Ok(mut guard) = ANIMATION_LEFT_X.lock() {
                        *guard = Some(rect.left);
                    }
                    if let Ok(mut guard) = ANIMATION_BOTTOM_Y.lock() {
                        *guard = Some(rect.bottom);
                    }
                }
            }

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
                        let left_x = ANIMATION_LEFT_X.lock().ok().and_then(|g| *g).unwrap_or(0);
                        let bottom_y = ANIMATION_BOTTOM_Y.lock().ok().and_then(|g| *g).unwrap_or(0);
                        (left_x, bottom_y - phys_window_h)
                    } else {
                        let center_x = ANIMATION_CENTER_X.lock().ok().and_then(|g| *g).unwrap_or(0);
                        let origin_y = ANIMATION_ORIGIN_Y.lock().ok().and_then(|g| *g).unwrap_or(0);
                        (center_x - phys_window_w / 2, origin_y)
                    };

                    // 安全性：线程内仅复用已取得的窗口句柄数值执行 SetWindowPos，动画中断由原子 ID 控制。
                    unsafe {
                        SetWindowPos(
                            hwnd_raw as _,
                            std::ptr::null_mut(),
                            final_x,
                            final_y,
                            phys_window_w,
                            phys_window_h,
                            0x0014,
                        );
                    }
                }

                // 终点收尾
                if ANIMATION_ID.load(Ordering::SeqCst) == id {
                    let phys_target_w = (target_width * scale_factor).round() as i32;
                    let phys_target_h = (target_height * scale_factor).round() as i32;

                    let (final_x, final_y) = if is_pinned {
                        let left_x = ANIMATION_LEFT_X.lock().ok().and_then(|g| *g).unwrap_or(0);
                        let bottom_y = ANIMATION_BOTTOM_Y.lock().ok().and_then(|g| *g).unwrap_or(0);
                        (left_x, bottom_y - phys_target_h)
                    } else {
                        let center_x = ANIMATION_CENTER_X.lock().ok().and_then(|g| *g).unwrap_or(0);
                        let origin_y = ANIMATION_ORIGIN_Y.lock().ok().and_then(|g| *g).unwrap_or(0);
                        (center_x - phys_target_w / 2, origin_y)
                    };

                    // 安全性：终点收尾只对同一个窗口句柄设置最终位置和尺寸。
                    unsafe {
                        SetWindowPos(
                            hwnd_raw as _,
                            std::ptr::null_mut(),
                            final_x,
                            final_y,
                            phys_target_w,
                            phys_target_h,
                            0x0014,
                        );
                    }
                    let _ = window_clone.emit("island-resize", vec![target_width, target_height]);

                    // 清理锚点
                    if let Ok(mut guard) = ANIMATION_CENTER_X.lock() {
                        *guard = None;
                    }
                    if let Ok(mut guard) = ANIMATION_ORIGIN_Y.lock() {
                        *guard = None;
                    }
                    if let Ok(mut guard) = ANIMATION_LEFT_X.lock() {
                        *guard = None;
                    }
                    if let Ok(mut guard) = ANIMATION_BOTTOM_Y.lock() {
                        *guard = None;
                    }
                }
            });
        }
    }
    Ok(())
}

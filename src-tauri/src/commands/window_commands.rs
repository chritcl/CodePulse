/**
 * 窗口管理命令
 *
 * 包含窗口置顶、位置调整、动画等相关命令。
 */
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// 动画 ID 计数器
static ANIMATION_ID: AtomicU32 = AtomicU32::new(0);

/// 原生拖拽是否正在占用窗口位置
static ISLAND_DRAGGING: AtomicBool = AtomicBool::new(false);

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

/// 串行化窗口边界写入，确保旧动画不能覆盖拖拽前的最终稳定尺寸
static WINDOW_BOUNDS_UPDATE: Mutex<()> = Mutex::new(());

/// 终止当前尺寸动画并清除连续动画锚点
fn cancel_active_animation() {
    ANIMATION_ID.fetch_add(1, Ordering::SeqCst);
    let mut anchor = ANIMATION_ANCHOR.lock().unwrap_or_else(|error| error.into_inner());
    *anchor = None;
}

/// 根据当前矩形和停靠规则计算拖拽开始前的一次性稳定边界
fn resolve_drag_target_bounds(
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
    target_width: i32,
    target_height: i32,
    is_pinned: bool,
) -> (i32, i32, i32, i32) {
    if is_pinned {
        (left, bottom - target_height, target_width, target_height)
    } else {
        let center_x = left + (right - left) / 2;
        (
            center_x - target_width / 2,
            top,
            target_width,
            target_height,
        )
    }
}

/// 提供端点速度和加速度均为零的五次平滑曲线
fn smootherstep(progress: f64) -> f64 {
    let value = progress.clamp(0.0, 1.0);
    value * value * value * (value * (value * 6.0 - 15.0) + 10.0)
}

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
    if ISLAND_DRAGGING.load(Ordering::SeqCst) {
        return;
    }

    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, SET_WINDOW_POS_FLAGS, SWP_NOACTIVATE, SWP_NOZORDER,
        };

        if let Some(win) = app.get_webview_window("widget") {
            if let Ok(hwnd) = win.hwnd() {
                let _update_guard =
                    WINDOW_BOUNDS_UPDATE.lock().unwrap_or_else(|error| error.into_inner());
                if ISLAND_DRAGGING.load(Ordering::SeqCst) {
                    return;
                }

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

/// 稳定灵动岛尺寸并启动 Windows 原生拖拽
///
/// 命令直到系统拖拽循环真正结束后才返回，前端可据此保护展开态和窗口尺寸。
#[tauri::command]
pub async fn start_island_drag(
    window: tauri::WebviewWindow,
    target_width: f64,
    target_height: f64,
    is_pinned: bool,
) -> Result<(), String> {
    if !target_width.is_finite()
        || !target_height.is_finite()
        || target_width <= 0.0
        || target_height <= 0.0
    {
        return Err("拖拽目标尺寸无效".to_string());
    }

    if ISLAND_DRAGGING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("灵动岛已在拖拽中".to_string());
    }

    cancel_active_animation();

    let scale_factor = window.scale_factor().unwrap_or(1.0);
    let physical_width = (target_width * scale_factor).round().max(1.0) as i32;
    let physical_height = (target_height * scale_factor).round().max(1.0) as i32;
    let drag_window = window.clone();
    let (result_sender, result_receiver) = tokio::sync::oneshot::channel();

    let schedule_result = window.run_on_main_thread(move || {
        let result = settle_and_start_native_drag(
            &drag_window,
            physical_width,
            physical_height,
            target_width,
            target_height,
            is_pinned,
        );
        ISLAND_DRAGGING.store(false, Ordering::SeqCst);
        let _ = result_sender.send(result);
    });

    if let Err(error) = schedule_result {
        ISLAND_DRAGGING.store(false, Ordering::SeqCst);
        return Err(format!("无法在主线程启动拖拽: {error}"));
    }

    result_receiver.await.map_err(|_| "原生拖拽任务意外结束".to_string())?
}

#[cfg(target_os = "windows")]
fn settle_and_start_native_drag(
    window: &tauri::WebviewWindow,
    physical_width: i32,
    physical_height: i32,
    logical_width: f64,
    logical_height: f64,
    is_pinned: bool,
) -> Result<(), String> {
    use windows::Win32::Foundation::{HWND, LPARAM, RECT, WPARAM};
    use windows::Win32::UI::Input::KeyboardAndMouse::ReleaseCapture;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowRect, SendMessageW, SetWindowPos, HTCAPTION, SET_WINDOW_POS_FLAGS, SWP_NOACTIVATE,
        SWP_NOZORDER, WM_NCLBUTTONDOWN,
    };

    let hwnd = window.hwnd().map_err(|error| format!("无法获取灵动岛窗口句柄: {error}"))?;
    let native_hwnd = HWND(hwnd.0 as _);
    let mut rect = RECT::default();

    // 安全性：窗口句柄来自当前 Tauri 窗口，RECT 在调用期间保持有效。
    unsafe {
        GetWindowRect(native_hwnd, &mut rect)
            .map_err(|error| format!("无法读取拖拽前窗口边界: {error}"))?;
    }

    let (x, y, width, height) = resolve_drag_target_bounds(
        rect.left,
        rect.top,
        rect.right,
        rect.bottom,
        physical_width,
        physical_height,
        is_pinned,
    );

    let _update_guard = WINDOW_BOUNDS_UPDATE.lock().unwrap_or_else(|error| error.into_inner());

    // 安全性：只在 UI 主线程使用有效窗口句柄设置一次稳定边界，不保存任何外部指针。
    unsafe {
        let flags = SET_WINDOW_POS_FLAGS(SWP_NOACTIVATE.0 | SWP_NOZORDER.0);
        SetWindowPos(
            native_hwnd,
            HWND(std::ptr::null_mut()),
            x,
            y,
            width,
            height,
            flags,
        )
        .map_err(|error| format!("无法稳定拖拽前窗口尺寸: {error}"))?;
    }

    window
        .emit("island-resize", vec![logical_width, logical_height])
        .map_err(|error| format!("无法同步拖拽目标尺寸: {error}"))?;

    // 安全性：调用位于窗口 UI 主线程，先释放 WebView 捕获，再同步发送标题栏拖拽消息；
    // SendMessageW 会在 Windows 的移动循环结束后返回，因此命令生命周期覆盖完整原生拖拽。
    unsafe {
        let _ = ReleaseCapture();
        let _ = SendMessageW(
            native_hwnd,
            WM_NCLBUTTONDOWN,
            WPARAM(HTCAPTION as usize),
            LPARAM(0),
        );
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn settle_and_start_native_drag(
    window: &tauri::WebviewWindow,
    physical_width: i32,
    physical_height: i32,
    logical_width: f64,
    logical_height: f64,
    _is_pinned: bool,
) -> Result<(), String> {
    window
        .set_size(tauri::PhysicalSize::new(physical_width, physical_height))
        .map_err(|error| format!("无法稳定拖拽前窗口尺寸: {error}"))?;
    window
        .emit("island-resize", vec![logical_width, logical_height])
        .map_err(|error| format!("无法同步拖拽目标尺寸: {error}"))?;
    window.start_dragging().map_err(|error| format!("无法启动原生拖拽: {error}"))
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
    duration_ms: u64,
) -> Result<(), String> {
    if ISLAND_DRAGGING.load(Ordering::SeqCst) {
        return Ok(());
    }

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
                let duration = std::time::Duration::from_millis(duration_ms.clamp(80, 600));

                while start_time.elapsed() < duration {
                    std::thread::sleep(std::time::Duration::from_millis(8));

                    // 检查是否被新动画打断
                    if ANIMATION_ID.load(Ordering::SeqCst) != id
                        || ISLAND_DRAGGING.load(Ordering::SeqCst)
                    {
                        return;
                    }

                    let elapsed = start_time.elapsed().as_secs_f64();
                    let progress = elapsed / duration.as_secs_f64();
                    if progress >= 1.0 {
                        break;
                    }

                    // 窗口边界只做无过冲平滑过渡，明显回弹由 WebView 合成层负责。
                    let eased = smootherstep(progress);
                    let current_w = start_width + (target_width - start_width) * eased;
                    let current_h = start_height + (target_height - start_height) * eased;

                    let phys_window_w = (current_w * scale_factor).round() as i32;
                    let phys_window_h = (current_h * scale_factor).round() as i32;

                    let (final_x, final_y) = if is_pinned {
                        (anchor_left_x, anchor_bottom_y - phys_window_h)
                    } else {
                        (anchor_center_x - phys_window_w / 2, anchor_origin_y)
                    };

                    let _update_guard =
                        WINDOW_BOUNDS_UPDATE.lock().unwrap_or_else(|error| error.into_inner());
                    if ANIMATION_ID.load(Ordering::SeqCst) != id
                        || ISLAND_DRAGGING.load(Ordering::SeqCst)
                    {
                        return;
                    }

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
                if ANIMATION_ID.load(Ordering::SeqCst) == id
                    && !ISLAND_DRAGGING.load(Ordering::SeqCst)
                {
                    let phys_target_w = (target_width * scale_factor).round() as i32;
                    let phys_target_h = (target_height * scale_factor).round() as i32;

                    let (final_x, final_y) = if is_pinned {
                        (anchor_left_x, anchor_bottom_y - phys_target_h)
                    } else {
                        (anchor_center_x - phys_target_w / 2, anchor_origin_y)
                    };

                    let _update_guard =
                        WINDOW_BOUNDS_UPDATE.lock().unwrap_or_else(|error| error.into_inner());
                    if ANIMATION_ID.load(Ordering::SeqCst) != id
                        || ISLAND_DRAGGING.load(Ordering::SeqCst)
                    {
                        return;
                    }

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

#[cfg(test)]
mod tests {
    use super::{
        cancel_active_animation, resolve_drag_target_bounds, smootherstep, AnchorState,
        ANIMATION_ANCHOR, ANIMATION_ID,
    };
    use std::sync::atomic::Ordering;

    #[test]
    fn 窗口缓动单调且精确落在起终点() {
        let samples =
            (0..=100).map(|step| smootherstep(f64::from(step) / 100.0)).collect::<Vec<_>>();

        assert_eq!(samples.first().copied(), Some(0.0));
        assert_eq!(samples.last().copied(), Some(1.0));
        assert!(samples.windows(2).all(|pair| pair[1] >= pair[0]));
        assert!(samples.iter().all(|value| (0.0..=1.0).contains(value)));
    }

    #[test]
    fn 未停靠拖拽稳定尺寸时保持顶部和水平中心() {
        let bounds = resolve_drag_target_bounds(100, 20, 400, 120, 420, 206, false);

        assert_eq!(bounds, (40, 20, 420, 206));
    }

    #[test]
    fn 停靠拖拽稳定尺寸时保持左边界和底边() {
        let bounds = resolve_drag_target_bounds(100, 20, 400, 120, 420, 206, true);

        assert_eq!(bounds, (100, -86, 420, 206));
    }

    #[test]
    fn 开始拖拽会终止旧动画并清除锚点() {
        let previous_id = ANIMATION_ID.load(Ordering::SeqCst);
        {
            let mut anchor = ANIMATION_ANCHOR.lock().unwrap_or_else(|error| error.into_inner());
            *anchor = Some(AnchorState {
                center_x: 250,
                origin_y: 20,
                left_x: 100,
                bottom_y: 120,
                active_id: previous_id,
            });
        }

        cancel_active_animation();

        assert_ne!(ANIMATION_ID.load(Ordering::SeqCst), previous_id);
        assert!(ANIMATION_ANCHOR.lock().unwrap_or_else(|error| error.into_inner()).is_none());
    }
}

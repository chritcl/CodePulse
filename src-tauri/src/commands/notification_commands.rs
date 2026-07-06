/**
 * 通知相关命令
 *
 * 包含 Windows 通知读取、应用打开等相关命令。
 */
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

/// 最后处理的通知 ID
static LAST_NOTIFICATION_ID: AtomicU32 = AtomicU32::new(0);

/// 通知系统是否已初始化
static IS_NOTIF_INIT: AtomicBool = AtomicBool::new(false);

/// 通知数据结构
#[derive(serde::Serialize, Clone)]
pub struct ToastData {
    pub app_name: String,
    pub title: String,
    pub body: String,
    pub aumid: String,
}

/// 获取最新通知
///
/// 轮询 Windows 通知系统，返回最新的通知数据。
#[tauri::command]
pub async fn fetch_latest_notification() -> Result<Option<ToastData>, String> {
    use windows::UI::Notifications::Management::UserNotificationListener;
    use windows::UI::Notifications::NotificationKinds;

    let listener = match UserNotificationListener::Current() {
        Ok(l) => l,
        Err(_) => return Ok(None),
    };

    let _ = listener.RequestAccessAsync();

    let notifications = match listener.GetNotificationsAsync(NotificationKinds::Toast) {
        Ok(op) => match op.get() {
            Ok(ns) => ns,
            Err(_) => return Ok(None),
        },
        Err(_) => return Ok(None),
    };

    let mut latest_notif = None;
    let mut max_id = 0u32;

    for notif in notifications {
        if let Ok(id) = notif.Id() {
            if id > max_id {
                max_id = id;
                latest_notif = Some(notif);
            }
        }
    }

    if max_id == 0 {
        return Ok(None);
    }

    let last_processed_id = LAST_NOTIFICATION_ID.load(Ordering::SeqCst);

    // 首次初始化：记录当前最大 ID，不返回通知
    if !IS_NOTIF_INIT.load(Ordering::SeqCst) {
        LAST_NOTIFICATION_ID.store(max_id, Ordering::SeqCst);
        IS_NOTIF_INIT.store(true, Ordering::SeqCst);
        return Ok(None);
    }

    // 有新通知
    if max_id > last_processed_id {
        LAST_NOTIFICATION_ID.store(max_id, Ordering::SeqCst);

        if let Some(notif) = latest_notif {
            let app_name = notif
                .AppInfo()
                .and_then(|info| info.DisplayInfo())
                .and_then(|dinfo| dinfo.DisplayName())
                .map(|name| name.to_string())
                .unwrap_or_else(|_| "系统通知".to_string());

            let aumid = notif
                .AppInfo()
                .and_then(|info| info.AppUserModelId())
                .map(|id| id.to_string())
                .unwrap_or_default();

            if let Ok(toast_binding) = notif
                .Notification()
                .and_then(|n| n.Visual())
                .and_then(|v| v.GetBinding(&windows::core::HSTRING::from("ToastGeneric")))
            {
                if let Ok(text_elements) = toast_binding.GetTextElements() {
                    let mut text_list = Vec::new();
                    for elem in text_elements {
                        if let Ok(text) = elem.Text() {
                            text_list.push(text.to_string());
                        }
                    }

                    if !text_list.is_empty() {
                        let title = text_list.first().cloned().unwrap_or_default();
                        let body = if text_list.len() > 1 {
                            text_list[1..].join(" ")
                        } else {
                            String::new()
                        };

                        // 过滤微信通知
                        if title.contains("微信")
                            || title.contains("WeChat")
                            || body.contains("微信")
                            || body.contains("WeChat")
                        {
                            return Ok(None);
                        }

                        return Ok(Some(ToastData {
                            app_name,
                            title,
                            body,
                            aumid,
                        }));
                    }
                }
            }
        }
    }

    Ok(None)
}

/// 通过 AUMID 打开应用
#[tauri::command]
pub fn open_app_by_aumid(aumid: String, app_name: String) {
    use std::os::windows::ffi::OsStrExt;
    use winapi::um::shellapi::ShellExecuteW;
    use winapi::um::winuser::{keybd_event, KEYEVENTF_KEYUP, SW_SHOWNORMAL, VK_MENU};

    let app_lower = app_name.to_lowercase();

    // 安全性：keybd_event 只发送一次 Alt 按下/抬起，用于让 ShellExecute 唤起窗口。
    unsafe {
        keybd_event(VK_MENU as u8, 0, 0, 0);
        keybd_event(VK_MENU as u8, 0, KEYEVENTF_KEYUP, 0);
    }

    let execute_protocol = |protocol: &str| {
        // 安全性：宽字符串在调用期间保持存活，ShellExecuteW 不保存传入指针。
        unsafe {
            let op =
                std::ffi::OsStr::new("open").encode_wide().chain(Some(0)).collect::<Vec<u16>>();
            let file = std::ffi::OsStr::new(protocol)
                .encode_wide()
                .chain(Some(0))
                .collect::<Vec<u16>>();
            ShellExecuteW(
                std::ptr::null_mut(),
                op.as_ptr(),
                file.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWNORMAL,
            );
        }
    };

    // 特定应用使用协议打开
    if app_lower.contains("qq") {
        execute_protocol("tencent://message/");
    } else if app_lower.contains("微信") || app_lower.contains("wechat") {
        execute_protocol("weixin://");
    } else if app_lower.contains("钉钉") || app_lower.contains("dingtalk") {
        execute_protocol("dingtalk://");
    } else if !aumid.is_empty() {
        // 其他应用使用 AUMID 打开
        // 安全性：所有宽字符串缓冲区在 ShellExecuteW 调用结束前有效。
        unsafe {
            let op =
                std::ffi::OsStr::new("open").encode_wide().chain(Some(0)).collect::<Vec<u16>>();
            let file = std::ffi::OsStr::new("explorer.exe")
                .encode_wide()
                .chain(Some(0))
                .collect::<Vec<u16>>();
            let params = std::ffi::OsStr::new(&format!("shell:AppsFolder\\{}", aumid))
                .encode_wide()
                .chain(Some(0))
                .collect::<Vec<u16>>();
            ShellExecuteW(
                std::ptr::null_mut(),
                op.as_ptr(),
                file.as_ptr(),
                params.as_ptr(),
                std::ptr::null(),
                SW_SHOWNORMAL,
            );
        }
    }
}

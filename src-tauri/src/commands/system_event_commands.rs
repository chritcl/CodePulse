/**
 * 系统事件监控
 *
 * 后台监听音量、电源和电量变化，并发送给前端灵动岛。
 */
use serde::Serialize;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
};
use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};

/// 电池事件载荷
#[derive(Clone, Serialize)]
struct BatteryPayload {
    state: String,
    percent: u8,
}

/// 启动系统事件监听
pub fn start_system_event_monitor(app: AppHandle) {
    std::thread::spawn(move || {
        // 安全性：该线程只初始化自身 COM 环境，用于读取系统默认音频端点。
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }

        let mut last_volume = get_system_volume().unwrap_or(-1.0);
        let mut last_power_state = 255;
        let mut last_battery_percent = 255;

        if let Some((power_state, battery_percent)) = get_power_status() {
            last_power_state = power_state;
            last_battery_percent = battery_percent;
        }

        loop {
            std::thread::sleep(Duration::from_millis(800));
            emit_volume_event(&app, &mut last_volume);
            emit_power_event(&app, &mut last_power_state, &mut last_battery_percent);
        }
    });
}

/// 发送音量变化事件
fn emit_volume_event(app: &AppHandle, last_volume: &mut f32) {
    if let Some(current_volume) = get_system_volume() {
        if (*last_volume - current_volume).abs() > 0.01 && *last_volume >= 0.0 {
            let volume_percent = (current_volume * 100.0).round() as i32;
            let _ = app.emit("system-event", format!("当前系统音量 {}%", volume_percent));
        }
        *last_volume = current_volume;
    }
}

/// 发送电源和电量变化事件
fn emit_power_event(app: &AppHandle, last_power_state: &mut u8, last_battery_percent: &mut u8) {
    let Some((current_power, current_percent)) = get_power_status() else {
        return;
    };

    if current_power != *last_power_state && *last_power_state != 255 {
        if current_power == 1 {
            let _ = app.emit(
                "battery-event",
                BatteryPayload {
                    state: "charging".to_string(),
                    percent: current_percent,
                },
            );
        } else if current_power == 0 {
            let _ = app.emit("system-event", "正在使用电池供电");
        }
    }

    if current_power == 0 {
        for threshold in [20, 15, 10, 5] {
            if current_percent <= threshold && *last_battery_percent > threshold {
                let _ = app.emit(
                    "battery-event",
                    BatteryPayload {
                        state: "discharging".to_string(),
                        percent: current_percent,
                    },
                );
                break;
            }
        }
    }

    *last_power_state = current_power;
    *last_battery_percent = current_percent;
}

/// 获取系统音量
fn get_system_volume() -> Option<f32> {
    // 安全性：COM 对象由 windows crate 管理生命周期，只读取默认输出端点音量。
    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole).ok()?;
        let endpoint_volume: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None).ok()?;
        endpoint_volume.GetMasterVolumeLevelScalar().ok()
    }
}

/// 获取电源状态和电量
fn get_power_status() -> Option<(u8, u8)> {
    // 安全性：SYSTEM_POWER_STATUS 是 Win32 POD 结构，零初始化后由系统 API 填充。
    unsafe {
        let mut status: SYSTEM_POWER_STATUS = std::mem::zeroed();
        if GetSystemPowerStatus(&mut status).is_ok() && status.BatteryLifePercent <= 100 {
            Some((status.ACLineStatus, status.BatteryLifePercent))
        } else {
            None
        }
    }
}

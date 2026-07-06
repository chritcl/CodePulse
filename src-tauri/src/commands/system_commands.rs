use crate::app::AppState;
/**
 * 系统监控命令
 *
 * 包含网速监控、硬件监控、网络延迟等相关命令。
 */
use std::net::{SocketAddr, TcpStream};
use std::time::{Duration, Instant};
use tauri::State;

/// 获取网络流量统计
///
/// 返回 (接收字节数, 发送字节数)
/// 如果获取失败，返回 (0, 0)
#[tauri::command]
pub fn get_network_stats(state: State<'_, AppState>) -> (u64, u64) {
    match state.networks.lock() {
        Ok(mut networks) => {
            networks.refresh_list();

            let mut total_rx = 0;
            let mut total_tx = 0;

            for (_interface_name, data) in networks.iter() {
                total_rx += data.total_received();
                total_tx += data.total_transmitted();
            }

            (total_rx, total_tx)
        }
        Err(e) => {
            eprintln!("[NSD] 获取网络数据失败: {}", e);
            (0, 0)
        }
    }
}

/// 获取硬件状态
///
/// 返回 (CPU 使用率, 已用内存, 总内存)
/// 如果获取失败，返回 (0.0, 0, 0)
#[tauri::command]
pub fn get_hardware_stats(state: State<'_, AppState>) -> (f32, u64, u64) {
    match state.system.lock() {
        Ok(mut sys) => {
            sys.refresh_cpu_usage();
            sys.refresh_memory();
            (
                sys.global_cpu_info().cpu_usage(),
                sys.used_memory(),
                sys.total_memory(),
            )
        }
        Err(e) => {
            eprintln!("[NSD] 获取硬件数据失败: {}", e);
            (0.0, 0, 0)
        }
    }
}

/// 获取网络延迟
///
/// 通过 TCP 连接测试网络延迟，返回毫秒数。
#[tauri::command]
pub fn get_network_latency() -> Result<u128, String> {
    let addr: SocketAddr =
        "223.5.5.5:53".parse().map_err(|err| format!("解析延迟测试地址失败: {}", err))?;
    let timeout = Duration::from_millis(1500);

    let start = Instant::now();
    match TcpStream::connect_timeout(&addr, timeout) {
        Ok(_) => Ok(start.elapsed().as_millis()),
        Err(_) => Err("Timeout".to_string()),
    }
}

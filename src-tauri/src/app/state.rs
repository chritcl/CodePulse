/**
 * 全局应用状态
 *
 * 定义应用程序的全局状态结构，由 Tauri 管理。
 */
use std::sync::Mutex;
use sysinfo::{Networks, System};

/// 应用程序全局状态
///
/// 包含系统监控所需的所有状态数据。
/// 由 Tauri 的状态管理系统管理，通过 `State<AppState>` 注入到命令中。
pub struct AppState {
    /// 网络接口数据
    pub networks: Mutex<Networks>,
    /// 系统信息
    pub system: Mutex<System>,
}

impl AppState {
    /// 创建新的应用状态
    pub fn new() -> Self {
        let networks = Networks::new_with_refreshed_list();
        let mut system = System::new_all();
        system.refresh_cpu_usage();

        Self {
            networks: Mutex::new(networks),
            system: Mutex::new(system),
        }
    }
}

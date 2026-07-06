// 发布版本在 Windows 上隐藏额外控制台窗口，请勿删除。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    netspeed_dynamic_lib::run();
}

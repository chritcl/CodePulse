pub mod audio_spectrum_commands;
/**
 * Tauri 命令模块
 *
 * 包含所有 Tauri 命令处理函数，按功能领域分组。
 */
pub mod lyrics_commands;
pub mod media_commands;
pub mod notification_commands;
pub mod settings_commands;
pub mod system_commands;
pub mod system_event_commands;
pub mod window_commands;

// 重新导出所有命令，方便在 lib.rs 中注册
pub use audio_spectrum_commands::*;
pub use lyrics_commands::*;
pub use media_commands::*;
pub use notification_commands::*;
pub use settings_commands::*;
pub use system_commands::*;
pub use system_event_commands::*;
pub use window_commands::*;

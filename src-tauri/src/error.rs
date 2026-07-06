/**
 * 统一错误类型
 *
 * 定义应用程序中所有模块共用的错误类型。
 */
use std::fmt;

/// 应用程序错误类型
#[derive(Debug)]
pub enum AppError {
    /// IO 错误
    Io(std::io::Error),
    /// 网络请求错误
    Network(reqwest::Error),
    /// 序列化/反序列化错误
    Serialization(serde_json::Error),
    /// Windows API 错误
    Windows(String),
    /// 通用错误
    General(String),
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AppError::Io(err) => write!(f, "IO 错误: {}", err),
            AppError::Network(err) => write!(f, "网络错误: {}", err),
            AppError::Serialization(err) => write!(f, "序列化错误: {}", err),
            AppError::Windows(msg) => write!(f, "Windows API 错误: {}", msg),
            AppError::General(msg) => write!(f, "错误: {}", msg),
        }
    }
}

impl std::error::Error for AppError {}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::Io(err)
    }
}

impl From<reqwest::Error> for AppError {
    fn from(err: reqwest::Error) -> Self {
        AppError::Network(err)
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        AppError::Serialization(err)
    }
}

impl From<String> for AppError {
    fn from(msg: String) -> Self {
        AppError::General(msg)
    }
}

impl From<&str> for AppError {
    fn from(msg: &str) -> Self {
        AppError::General(msg.to_string())
    }
}

/// 将 AppError 转换为 Tauri 命令返回的字符串错误
impl From<AppError> for String {
    fn from(err: AppError) -> Self {
        err.to_string()
    }
}

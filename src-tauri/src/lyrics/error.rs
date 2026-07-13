use std::fmt::{Display, Formatter};

/// 歌词源请求错误
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LyricsProviderError {
    provider: String,
    stage: String,
    message: String,
}

impl LyricsProviderError {
    /// 构造带歌词源和阶段的上游错误
    pub fn upstream(provider: impl Into<String>, stage: impl Into<String>) -> Self {
        Self::with_message(provider, stage, "上游歌词服务请求失败")
    }

    /// 构造包含原始错误摘要的上游错误
    pub fn with_message(
        provider: impl Into<String>,
        stage: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            provider: provider.into(),
            stage: stage.into(),
            message: message.into(),
        }
    }

    pub fn provider(&self) -> &str {
        &self.provider
    }

    pub fn stage(&self) -> &str {
        &self.stage
    }
}

impl Display for LyricsProviderError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "歌词源 {} 在 {} 阶段失败：{}",
            self.provider, self.stage, self.message
        )
    }
}

impl std::error::Error for LyricsProviderError {}

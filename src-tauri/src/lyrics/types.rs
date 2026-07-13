use serde::{Deserialize, Serialize};

/// 歌词查询请求
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LyricsTrackRequest {
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub duration_ms: Option<u64>,
    pub player: Option<String>,
}

/// 用于匹配和缓存的规范化歌曲身份
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrackIdentity {
    pub normalized_title: String,
    pub normalized_artist: String,
    pub normalized_album: String,
    pub duration_bucket_ms: u64,
}

/// 歌词行
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LyricLine {
    pub index: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_ms: Option<u64>,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub translation: Option<String>,
}

/// 歌词响应状态
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LyricsStatus {
    Ready,
    NotFound,
    Error,
}

/// 歌词查询错误类型
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LyricsErrorCode {
    InvalidRequest,
    Timeout,
    Upstream,
    Cache,
}

/// 歌词来源类型
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LyricsSource {
    Cache,
    Online,
}

/// 歌词查询响应
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LyricsResponse {
    pub status: LyricsStatus,
    pub track_key: String,
    pub provider: String,
    pub source: LyricsSource,
    pub confidence: f32,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<LyricsErrorCode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_lrc: Option<String>,
    pub lines: Vec<LyricLine>,
}

/// 缓存文件内容
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CachedLyrics {
    pub schema_version: u8,
    pub parser_version: u8,
    pub identity: TrackIdentity,
    pub fetched_at_ms: u64,
    pub provider: String,
    pub confidence: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_lrc: Option<String>,
    pub lines: Vec<LyricLine>,
}

/// 在线源返回结果
#[derive(Debug, Clone, PartialEq)]
pub struct ProviderLyrics {
    pub provider: String,
    pub confidence: f32,
    pub raw_lrc: Option<String>,
    pub lines: Vec<LyricLine>,
}

/// 搜索候选
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LyricsCandidate {
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub duration_ms: Option<u64>,
    pub id: String,
}

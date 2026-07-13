use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use windows::core::PCWSTR;
use windows::Win32::Storage::FileSystem::{
    MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
};

use super::parser::has_timed_lines;
use super::types::{
    CachedLyrics, LyricsResponse, LyricsSource, LyricsStatus, ProviderLyrics, TrackIdentity,
};

const CACHE_SCHEMA_VERSION: u8 = 3;
const PARSER_VERSION: u8 = 1;
const DEFAULT_CACHE_TTL: Duration = Duration::from_secs(30 * 24 * 60 * 60);

/// 歌词文件缓存仓库
pub struct LyricsCacheRepository {
    cache_dir: PathBuf,
    ttl: Duration,
}

impl LyricsCacheRepository {
    pub fn new(cache_dir: PathBuf, ttl: Duration) -> Self {
        Self { cache_dir, ttl }
    }

    pub fn read(&self, identity: &TrackIdentity, track_key: &str) -> Option<LyricsResponse> {
        self.read_at(identity, track_key, current_time_ms().ok()?)
    }

    pub fn write(
        &self,
        identity: &TrackIdentity,
        track_key: &str,
        lyrics: &ProviderLyrics,
    ) -> io::Result<()> {
        self.write_at(identity, track_key, lyrics, current_time_ms()?)
    }

    fn read_at(
        &self,
        identity: &TrackIdentity,
        track_key: &str,
        now_ms: u64,
    ) -> Option<LyricsResponse> {
        let content = fs::read_to_string(cache_path(&self.cache_dir, track_key)).ok()?;
        let cached = serde_json::from_str::<CachedLyrics>(&content).ok()?;
        if !self.is_valid(&cached, identity, now_ms) {
            return None;
        }
        Some(cached.into_response(track_key))
    }

    fn write_at(
        &self,
        identity: &TrackIdentity,
        track_key: &str,
        lyrics: &ProviderLyrics,
        fetched_at_ms: u64,
    ) -> io::Result<()> {
        validate_lyrics(lyrics)?;
        fs::create_dir_all(&self.cache_dir)?;
        let cached = CachedLyrics::from_provider(identity, lyrics, fetched_at_ms);
        let content = serde_json::to_vec_pretty(&cached).map_err(io::Error::other)?;
        write_atomic(&cache_path(&self.cache_dir, track_key), &content)
    }

    fn is_valid(&self, cached: &CachedLyrics, identity: &TrackIdentity, now_ms: u64) -> bool {
        let ttl_ms = self.ttl.as_millis().min(u128::from(u64::MAX)) as u64;
        cached.schema_version == CACHE_SCHEMA_VERSION
            && cached.parser_version == PARSER_VERSION
            && &cached.identity == identity
            && has_timed_lines(&cached.lines)
            && now_ms.checked_sub(cached.fetched_at_ms).is_some_and(|age| age <= ttl_ms)
    }
}

impl CachedLyrics {
    fn from_provider(
        identity: &TrackIdentity,
        lyrics: &ProviderLyrics,
        fetched_at_ms: u64,
    ) -> Self {
        Self {
            schema_version: CACHE_SCHEMA_VERSION,
            parser_version: PARSER_VERSION,
            identity: identity.clone(),
            fetched_at_ms,
            provider: lyrics.provider.clone(),
            confidence: lyrics.confidence,
            raw_lrc: lyrics.raw_lrc.clone(),
            lines: lyrics.lines.clone(),
        }
    }

    fn into_response(self, track_key: &str) -> LyricsResponse {
        LyricsResponse {
            status: LyricsStatus::Ready,
            track_key: track_key.to_string(),
            provider: self.provider,
            source: LyricsSource::Cache,
            confidence: self.confidence,
            raw_lrc: self.raw_lrc,
            lines: self.lines,
        }
    }
}

/// 读取缓存歌词
pub fn read_cached_lyrics(cache_dir: &Path, track_key: &str) -> Option<LyricsResponse> {
    let repository = LyricsCacheRepository::new(cache_dir.to_path_buf(), DEFAULT_CACHE_TTL);
    repository.read(&compatibility_identity(track_key), track_key)
}

/// 保存在线歌词到缓存
pub fn save_cached_lyrics(
    cache_dir: &Path,
    track_key: &str,
    lyrics: &ProviderLyrics,
) -> std::io::Result<()> {
    let repository = LyricsCacheRepository::new(cache_dir.to_path_buf(), DEFAULT_CACHE_TTL);
    repository.write(&compatibility_identity(track_key), track_key, lyrics)
}

fn validate_lyrics(lyrics: &ProviderLyrics) -> io::Result<()> {
    if has_timed_lines(&lyrics.lines) {
        return Ok(());
    }
    Err(io::Error::new(
        io::ErrorKind::InvalidData,
        "歌词缺少时间戳，不能写入同步歌词缓存",
    ))
}

fn compatibility_identity(track_key: &str) -> TrackIdentity {
    TrackIdentity {
        normalized_title: track_key.to_string(),
        normalized_artist: String::new(),
        normalized_album: String::new(),
        duration_bucket_ms: 0,
    }
}

fn current_time_ms() -> io::Result<u64> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(io::Error::other)?
        .as_millis();
    u64::try_from(millis).map_err(io::Error::other)
}

fn write_atomic(target: &Path, content: &[u8]) -> io::Result<()> {
    let temporary = temporary_path(target);
    let result = (|| {
        let mut file = OpenOptions::new().write(true).create_new(true).open(&temporary)?;
        file.write_all(content)?;
        file.sync_all()?;
        replace_file(&temporary, target)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn temporary_path(target: &Path) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let name = target.file_name().and_then(|name| name.to_str()).unwrap_or("lyrics.json");
    target.with_file_name(format!(".{name}-{}-{nonce}.tmp", std::process::id()))
}

fn replace_file(temporary: &Path, target: &Path) -> io::Result<()> {
    if !target.exists() {
        return fs::rename(temporary, target);
    }
    let temporary = temporary.as_os_str().encode_wide().chain(Some(0)).collect::<Vec<_>>();
    let target = target.as_os_str().encode_wide().chain(Some(0)).collect::<Vec<_>>();
    unsafe {
        // 安全性：两个路径均为带结尾空字符的 UTF-16 缓冲区，并在调用期间保持有效。
        MoveFileExW(
            PCWSTR(temporary.as_ptr()),
            PCWSTR(target.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    }
    .map_err(io::Error::other)
}

fn cache_path(cache_dir: &Path, track_key: &str) -> PathBuf {
    cache_dir.join(format!("{}.json", sanitize_track_key(track_key)))
}

fn sanitize_track_key(track_key: &str) -> String {
    track_key.chars().filter(|ch| ch.is_ascii_hexdigit()).collect::<String>()
}

#[cfg(test)]
#[path = "cache_tests.rs"]
mod tests;

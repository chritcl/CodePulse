use std::fs;
use std::path::{Path, PathBuf};

use super::parser::has_timed_lines;
use super::types::{CachedLyrics, LyricsResponse, LyricsSource, LyricsStatus, ProviderLyrics};

const CACHE_SCHEMA_VERSION: u8 = 2;

/// 读取缓存歌词
pub fn read_cached_lyrics(cache_dir: &Path, track_key: &str) -> Option<LyricsResponse> {
    let path = cache_path(cache_dir, track_key);
    let content = fs::read_to_string(path).ok()?;
    let cached = serde_json::from_str::<CachedLyrics>(&content).ok()?;
    if cached.schema_version != CACHE_SCHEMA_VERSION || !has_timed_lines(&cached.lines) {
        return None;
    }

    Some(LyricsResponse {
        status: LyricsStatus::Ready,
        track_key: track_key.to_string(),
        provider: cached.provider,
        source: LyricsSource::Cache,
        confidence: cached.confidence,
        raw_lrc: cached.raw_lrc,
        lines: cached.lines,
    })
}

/// 保存在线歌词到缓存
pub fn save_cached_lyrics(
    cache_dir: &Path,
    track_key: &str,
    lyrics: &ProviderLyrics,
) -> std::io::Result<()> {
    if !has_timed_lines(&lyrics.lines) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "歌词缺少时间戳，不能写入同步歌词缓存",
        ));
    }

    fs::create_dir_all(cache_dir)?;
    let entry = CachedLyrics {
        schema_version: CACHE_SCHEMA_VERSION,
        provider: lyrics.provider.clone(),
        confidence: lyrics.confidence,
        raw_lrc: lyrics.raw_lrc.clone(),
        lines: lyrics.lines.clone(),
    };
    let content = serde_json::to_string_pretty(&entry)
        .map_err(|err| std::io::Error::new(std::io::ErrorKind::InvalidData, err))?;

    fs::write(cache_path(cache_dir, track_key), content)
}

fn cache_path(cache_dir: &Path, track_key: &str) -> PathBuf {
    cache_dir.join(format!("{}.json", sanitize_track_key(track_key)))
}

fn sanitize_track_key(track_key: &str) -> String {
    track_key.chars().filter(|ch| ch.is_ascii_hexdigit()).collect::<String>()
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;
    use crate::lyrics::types::LyricLine;

    #[test]
    fn cache_round_trips_lyrics() {
        let cache_dir = std::env::temp_dir().join(format!(
            "nsd-lyrics-test-{}",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        let lyrics = ProviderLyrics {
            provider: "qqmusic".to_string(),
            confidence: 0.95,
            raw_lrc: Some("[00:01.00]第一句".to_string()),
            lines: vec![LyricLine {
                index: 0,
                start_ms: Some(1_000),
                end_ms: None,
                text: "第一句".to_string(),
                translation: None,
            }],
        };

        save_cached_lyrics(&cache_dir, "abc123", &lyrics).unwrap();
        let cached = read_cached_lyrics(&cache_dir, "abc123").unwrap();

        assert_eq!(cached.source, LyricsSource::Cache);
        assert_eq!(cached.provider, "qqmusic");
        assert_eq!(cached.lines[0].text, "第一句");

        let _ = fs::remove_dir_all(cache_dir);
    }

    #[test]
    fn rejects_legacy_cache_without_schema_version() {
        let cache_dir = std::env::temp_dir().join(format!(
            "nsd-lyrics-test-{}",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&cache_dir).unwrap();
        fs::write(
            cache_path(&cache_dir, "legacy"),
            r#"{"provider":"qqmusic","confidence":1.0,"lines":[{"index":0,"startMs":1000,"text":"第一句"}]}"#,
        )
        .unwrap();

        assert!(read_cached_lyrics(&cache_dir, "legacy").is_none());

        let _ = fs::remove_dir_all(cache_dir);
    }

    #[test]
    fn refuses_to_cache_lyrics_without_timestamps() {
        let cache_dir = std::env::temp_dir().join(format!(
            "nsd-lyrics-test-{}",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        let lyrics = ProviderLyrics {
            provider: "qqmusic".to_string(),
            confidence: 0.8,
            raw_lrc: Some("第一句".to_string()),
            lines: vec![LyricLine {
                index: 0,
                start_ms: None,
                end_ms: None,
                text: "第一句".to_string(),
                translation: None,
            }],
        };

        assert!(save_cached_lyrics(&cache_dir, "plain", &lyrics).is_err());

        let _ = fs::remove_dir_all(cache_dir);
    }
}

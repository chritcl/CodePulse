use std::fs;
use std::path::{Path, PathBuf};

use super::types::{CachedLyrics, LyricsResponse, LyricsSource, LyricsStatus, ProviderLyrics};

/// 读取缓存歌词
pub fn read_cached_lyrics(cache_dir: &Path, track_key: &str) -> Option<LyricsResponse> {
    let path = cache_path(cache_dir, track_key);
    let content = fs::read_to_string(path).ok()?;
    let cached = serde_json::from_str::<CachedLyrics>(&content).ok()?;

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
    fs::create_dir_all(cache_dir)?;
    let entry = CachedLyrics {
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
            provider: "lrclib".to_string(),
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
        assert_eq!(cached.provider, "lrclib");
        assert_eq!(cached.lines[0].text, "第一句");

        let _ = fs::remove_dir_all(cache_dir);
    }
}

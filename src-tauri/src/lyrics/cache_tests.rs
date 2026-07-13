use std::fs;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use super::*;
use crate::lyrics::matcher::{build_track_identity, build_track_key};
use crate::lyrics::types::{LyricLine, LyricsTrackRequest};

fn unique_temp_dir(label: &str) -> PathBuf {
    let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    std::env::temp_dir().join(format!("nsd-lyrics-{label}-{nonce}"))
}

fn request(duration_ms: Option<u64>) -> LyricsTrackRequest {
    LyricsTrackRequest {
        title: "晴天".to_string(),
        artist: "周杰伦".to_string(),
        album: Some("叶惠美".to_string()),
        duration_ms,
        player: Some("qqmusic".to_string()),
    }
}

fn lyrics(text: &str, start_ms: Option<u64>) -> ProviderLyrics {
    ProviderLyrics {
        provider: "fake".to_string(),
        confidence: 0.96,
        raw_lrc: Some(format!("[00:00.00]{text}")),
        lines: vec![LyricLine {
            index: 0,
            start_ms,
            end_ms: None,
            text: text.to_string(),
            translation: None,
        }],
    }
}

#[test]
fn schema_three_cache_round_trips_identity_and_metadata() {
    let cache_dir = unique_temp_dir("schema-three");
    let repository = LyricsCacheRepository::new(cache_dir.clone(), Duration::from_secs(60));
    let identity = build_track_identity(&request(Some(269_000)));
    let track_key = build_track_key(&identity);

    repository
        .write_at(&identity, &track_key, &lyrics("第一句", Some(0)), 1_000)
        .unwrap();
    let cached = repository.read_at(&identity, &track_key, 2_000).unwrap();
    let raw = fs::read_to_string(cache_path(&cache_dir, &track_key)).unwrap();
    let document = serde_json::from_str::<serde_json::Value>(&raw).unwrap();

    assert_eq!(cached.source, LyricsSource::Cache);
    assert_eq!(cached.lines[0].text, "第一句");
    assert_eq!(document["schemaVersion"], 3);
    assert_eq!(document["fetchedAtMs"], 1_000);
    assert_eq!(document["parserVersion"], 1);
    assert_eq!(document["provider"], "fake");
    assert_eq!(document["identity"]["normalizedTitle"], "晴天");
    let _ = fs::remove_dir_all(cache_dir);
}

#[test]
fn cache_rejects_expired_or_mismatched_identity() {
    let cache_dir = unique_temp_dir("expired-cache");
    let repository =
        LyricsCacheRepository::new(cache_dir.clone(), Duration::from_secs(30 * 24 * 60 * 60));
    let original = build_track_identity(&request(Some(269_000)));
    let changed = build_track_identity(&LyricsTrackRequest {
        title: "夜曲".to_string(),
        ..request(Some(269_000))
    });
    let track_key = build_track_key(&original);
    repository
        .write_at(&original, &track_key, &lyrics("第一句", Some(0)), 1_000)
        .unwrap();

    assert!(repository.read_at(&original, &track_key, 31 * 24 * 60 * 60 * 1_000).is_none());
    assert!(repository.read_at(&changed, &track_key, 2_000).is_none());
    let _ = fs::remove_dir_all(cache_dir);
}

#[test]
fn overwrites_existing_cache_without_leaving_temporary_file() {
    let cache_dir = unique_temp_dir("atomic-replace");
    let repository = LyricsCacheRepository::new(cache_dir.clone(), Duration::from_secs(60));
    let identity = build_track_identity(&request(Some(269_000)));
    let track_key = build_track_key(&identity);

    repository
        .write_at(&identity, &track_key, &lyrics("旧歌词", Some(0)), 1_000)
        .unwrap();
    repository
        .write_at(&identity, &track_key, &lyrics("新歌词", Some(0)), 2_000)
        .unwrap();
    let cached = repository.read_at(&identity, &track_key, 3_000).unwrap();
    let files = fs::read_dir(&cache_dir).unwrap().collect::<Result<Vec<_>, _>>().unwrap();

    assert_eq!(cached.lines[0].text, "新歌词");
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].path(), cache_path(&cache_dir, &track_key));
    let _ = fs::remove_dir_all(cache_dir);
}

#[test]
fn compatibility_wrappers_round_trip_lyrics() {
    let cache_dir = unique_temp_dir("compatibility");
    save_cached_lyrics(&cache_dir, "abc123", &lyrics("第一句", Some(0))).unwrap();

    let cached = read_cached_lyrics(&cache_dir, "abc123").unwrap();

    assert_eq!(cached.provider, "fake");
    assert_eq!(cached.lines[0].text, "第一句");
    let _ = fs::remove_dir_all(cache_dir);
}

#[test]
fn rejects_legacy_cache_without_schema_version() {
    let cache_dir = unique_temp_dir("legacy");
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
    let cache_dir = unique_temp_dir("plain");
    let repository = LyricsCacheRepository::new(cache_dir.clone(), Duration::from_secs(60));
    let identity = build_track_identity(&request(Some(269_000)));
    let track_key = build_track_key(&identity);

    assert!(repository
        .write_at(&identity, &track_key, &lyrics("第一句", None), 1_000)
        .is_err());
    let _ = fs::remove_dir_all(cache_dir);
}

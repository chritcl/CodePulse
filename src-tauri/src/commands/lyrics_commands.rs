use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::lyrics::{
    build_track_key, fetch_online_lyrics, read_cached_lyrics, save_cached_lyrics, LyricsResponse,
    LyricsSource, LyricsStatus, LyricsTrackRequest,
};

/// 获取当前歌曲歌词
#[tauri::command]
pub async fn get_lyrics_for_track(
    app: AppHandle,
    title: String,
    artist: String,
    album: Option<String>,
    duration_ms: Option<u64>,
    player: Option<String>,
) -> Result<LyricsResponse, String> {
    let request = LyricsTrackRequest {
        title,
        artist,
        album,
        duration_ms,
        player,
    };
    let track_key = build_track_key(&request);
    let cache_dir = app.path().app_data_dir().map_err(|err| err.to_string())?.join("lyrics");

    if let Some(cached) = read_cached_lyrics(&cache_dir, &track_key) {
        return Ok(cached);
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|err| err.to_string())?;

    match fetch_online_lyrics(&request, &client).await {
        Ok(Some(lyrics)) => {
            if let Err(err) = save_cached_lyrics(&cache_dir, &track_key, &lyrics) {
                eprintln!("[NSD] 保存歌词缓存失败: {}", err);
            }

            Ok(LyricsResponse {
                status: LyricsStatus::Ready,
                track_key,
                provider: lyrics.provider,
                source: LyricsSource::Online,
                confidence: lyrics.confidence,
                raw_lrc: lyrics.raw_lrc,
                lines: lyrics.lines,
            })
        }
        Ok(None) => Ok(empty_response(track_key, LyricsStatus::NotFound)),
        Err(err) => {
            eprintln!("[NSD] 查询歌词失败: {}", err);
            Ok(empty_response(track_key, LyricsStatus::Error))
        }
    }
}

fn empty_response(track_key: String, status: LyricsStatus) -> LyricsResponse {
    LyricsResponse {
        status,
        track_key,
        provider: "none".to_string(),
        source: LyricsSource::Online,
        confidence: 0.0,
        raw_lrc: None,
        lines: Vec::new(),
    }
}

use tauri::State;

use crate::lyrics::{LyricsResponse, LyricsService, LyricsTrackRequest};

/// 获取当前歌曲歌词
#[tauri::command]
pub async fn get_lyrics_for_track(
    service: State<'_, LyricsService>,
    title: String,
    artist: String,
    album: Option<String>,
    duration_ms: Option<u64>,
    player: Option<String>,
) -> Result<LyricsResponse, String> {
    Ok(service
        .get_lyrics(LyricsTrackRequest {
            title,
            artist,
            album,
            duration_ms,
            player,
        })
        .await)
}

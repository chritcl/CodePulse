/**
 * 媒体控制命令
 *
 * 包含音乐播放控制、封面获取等相关命令。
 */
use serde::Serialize;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use windows::Foundation::TimeSpan;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession, GlobalSystemMediaTransportControlsSessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus,
};

/// 全局记录当前选中的音乐平台
static TARGET_PLAYER: Mutex<String> = Mutex::new(String::new());

/// 完整音乐播放状态
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicPlaybackState {
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub source_app_id: String,
    pub player: String,
    pub is_playing: bool,
    pub duration_ms: Option<u64>,
    pub position_ms: Option<u64>,
    pub timeline_sampled_at_ms: u64,
}

/// 设置目标音乐平台
#[tauri::command]
pub fn set_target_player(player: String) {
    if let Ok(mut target) = TARGET_PLAYER.lock() {
        *target = player;
    }
}

/// 获取当前目标音乐平台
pub fn get_active_target_player() -> String {
    match TARGET_PLAYER.lock() {
        Ok(guard) => {
            if guard.is_empty() {
                "netease".to_string()
            } else {
                guard.clone()
            }
        }
        Err(e) => {
            eprintln!("[NSD] 获取目标平台失败: {}", e);
            "netease".to_string()
        }
    }
}

/// 获取目标媒体会话
///
/// 根据前端设置的目标平台，查找对应的媒体控制会话。
pub fn get_target_media_session() -> Option<GlobalSystemMediaTransportControlsSession> {
    get_target_media_session_with_source().map(|(session, _)| session)
}

/// 获取目标媒体会话和来源应用标识
pub fn get_target_media_session_with_source(
) -> Option<(GlobalSystemMediaTransportControlsSession, String)> {
    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .ok()?
        .get()
        .ok()?;

    let sessions = manager.GetSessions().ok()?;

    // 获取当前的目标平台
    let target = get_active_target_player();

    for session in sessions {
        if let Ok(app_id) = session.SourceAppUserModelId() {
            let app_id_str = app_id.to_string().to_lowercase();

            let matches_target = if target == "netease" {
                app_id_str.contains("cloudmusic") || app_id_str.contains("netease")
            } else {
                app_id_str.contains(&target)
            };

            if matches_target {
                return Some((session, app_id.to_string()));
            }
        }
    }
    None
}

/// 获取音乐信息
///
/// 返回 (歌名, 歌手, 是否正在播放)。
#[tauri::command]
pub async fn fetch_netease_music_info() -> Result<Option<(String, String, bool)>, String> {
    let session = match get_target_media_session() {
        Some(s) => s,
        None => return Ok(None),
    };

    // 获取播放状态
    let is_playing = if let Ok(playback_info) = session.GetPlaybackInfo() {
        if let Ok(status) = playback_info.PlaybackStatus() {
            status == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing
        } else {
            false
        }
    } else {
        false
    };

    // 获取歌曲属性
    let properties = session
        .TryGetMediaPropertiesAsync()
        .map_err(|e| e.to_string())?
        .get()
        .map_err(|e| e.to_string())?;

    let title = properties.Title().unwrap_or_default().to_string();
    let artist = properties.Artist().unwrap_or_default().to_string();

    if title.is_empty() {
        return Ok(None);
    }

    Ok(Some((title, artist, is_playing)))
}

/// 获取完整音乐播放状态
#[tauri::command]
pub async fn get_music_playback_state() -> Result<Option<MusicPlaybackState>, String> {
    let (session, source_app_id) = match get_target_media_session_with_source() {
        Some(value) => value,
        None => return Ok(None),
    };

    // 获取播放状态
    let is_playing = if let Ok(playback_info) = session.GetPlaybackInfo() {
        if let Ok(status) = playback_info.PlaybackStatus() {
            status == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing
        } else {
            false
        }
    } else {
        false
    };

    // 获取歌曲属性
    let properties = session
        .TryGetMediaPropertiesAsync()
        .map_err(|e| e.to_string())?
        .get()
        .map_err(|e| e.to_string())?;

    let title = properties.Title().unwrap_or_default().to_string();
    if title.is_empty() {
        return Ok(None);
    }

    let artist = properties.Artist().unwrap_or_default().to_string();
    let album = non_empty_string(properties.AlbumTitle().unwrap_or_default().to_string());
    let timeline = read_timeline_state(&session).unwrap_or_default();
    let timeline_sampled_at_ms = now_ms();

    Ok(Some(MusicPlaybackState {
        title,
        artist,
        album,
        source_app_id,
        player: get_active_target_player(),
        is_playing,
        duration_ms: timeline.duration_ms,
        position_ms: timeline.position_ms,
        timeline_sampled_at_ms,
    }))
}

/// 控制系统媒体播放
#[tauri::command]
pub async fn control_system_media(action: String) -> Result<(), String> {
    if let Some(session) = get_target_media_session() {
        match action.as_str() {
            "play_pause" => {
                let _ = session.TryTogglePlayPauseAsync();
            }
            "next" => {
                let _ = session.TrySkipNextAsync();
            }
            "prev" => {
                let _ = session.TrySkipPreviousAsync();
            }
            _ => {}
        }
    }
    Ok(())
}

fn read_timeline_state(
    session: &GlobalSystemMediaTransportControlsSession,
) -> Option<TimelineSnapshot> {
    let timeline = session.GetTimelineProperties().ok()?;
    let start_ms = timeline.StartTime().ok().and_then(timespan_to_ms);
    let end_ms = timeline.EndTime().ok().and_then(timespan_to_ms);
    let position_ms = timeline.Position().ok().and_then(timespan_to_ms);

    Some(build_timeline_snapshot(start_ms, end_ms, position_ms))
}

#[derive(Default)]
struct TimelineSnapshot {
    duration_ms: Option<u64>,
    position_ms: Option<u64>,
}

fn build_timeline_snapshot(
    start_ms: Option<u64>,
    end_ms: Option<u64>,
    position_ms: Option<u64>,
) -> TimelineSnapshot {
    let duration_ms = match (start_ms, end_ms) {
        (Some(start), Some(end)) if end > start => Some(end - start),
        _ => None,
    };
    let position_ms = position_ms.map(|position| position.saturating_sub(start_ms.unwrap_or_default()));

    TimelineSnapshot {
        duration_ms,
        position_ms,
    }
}

fn timespan_to_ms(value: TimeSpan) -> Option<u64> {
    if value.Duration < 0 {
        return None;
    }

    Some((value.Duration / 10_000) as u64)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn non_empty_string(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[cfg(test)]
mod timeline_tests {
    use super::*;

    #[test]
    fn keeps_playback_position_when_duration_is_unavailable() {
        let snapshot = build_timeline_snapshot(Some(500), None, Some(1_500));

        assert_eq!(snapshot.position_ms, Some(1_000));
        assert_eq!(snapshot.duration_ms, None);
    }
}

/// Base64 编码器
fn inline_base64_encode(input: &[u8]) -> String {
    const CHARSET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        match chunk.len() {
            3 => {
                result.push(CHARSET[(chunk[0] >> 2) as usize] as char);
                result.push(CHARSET[(((chunk[0] & 0x03) << 4) | (chunk[1] >> 4)) as usize] as char);
                result.push(CHARSET[(((chunk[1] & 0x0F) << 2) | (chunk[2] >> 6)) as usize] as char);
                result.push(CHARSET[(chunk[2] & 0x3F) as usize] as char);
            }
            2 => {
                result.push(CHARSET[(chunk[0] >> 2) as usize] as char);
                result.push(CHARSET[(((chunk[0] & 0x03) << 4) | (chunk[1] >> 4)) as usize] as char);
                result.push(CHARSET[((chunk[1] & 0x0F) << 2) as usize] as char);
                result.push('=');
            }
            1 => {
                result.push(CHARSET[(chunk[0] >> 2) as usize] as char);
                result.push(CHARSET[((chunk[0] & 0x03) << 4) as usize] as char);
                result.push('=');
                result.push('=');
            }
            _ => {}
        }
    }
    result
}

/// 从 SMTC 获取本地封面
fn get_smtc_thumbnail() -> Option<String> {
    use windows::Storage::Streams::{Buffer, DataReader, InputStreamOptions};

    let session = get_target_media_session()?;
    let properties = session.TryGetMediaPropertiesAsync().ok()?.get().ok()?;
    let thumbnail_ref = properties.Thumbnail().ok()?;
    let stream = thumbnail_ref.OpenReadAsync().ok()?.get().ok()?;
    let size = stream.Size().ok()? as u32;
    if size == 0 {
        return None;
    }

    let buffer = Buffer::Create(size).ok()?;
    stream.ReadAsync(&buffer, size, InputStreamOptions::None).ok()?.get().ok()?;
    let reader = DataReader::FromBuffer(&buffer).ok()?;
    let mut bytes = vec![0u8; size as usize];
    reader.ReadBytes(&mut bytes).ok()?;

    Some(format!(
        "data:image/jpeg;base64,{}",
        inline_base64_encode(&bytes)
    ))
}

/// 获取歌曲封面
///
/// 优先从本地 SMTC 获取，失败则从网络获取。
#[tauri::command]
pub async fn get_random_cover_url(
    song_name: String,
    artist_name: String,
) -> Result<String, String> {
    // 优先从本地获取
    if let Some(base64_cover) = get_smtc_thumbnail() {
        return Ok(base64_cover);
    }

    // 网络获取：多源竞速
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;

    let (tx, mut rx) = tokio::sync::mpsc::channel(3);

    // Apple Music
    let tx_itunes = tx.clone();
    let client_itunes = client.clone();
    let query_itunes = format!("{} {}", song_name, artist_name);
    tokio::spawn(async move {
        let encoded_query = urlencoding::encode(&query_itunes).into_owned();
        let itunes_url = format!(
            "https://itunes.apple.com/search?term={}&media=music&limit=1",
            encoded_query
        );
        if let Ok(resp) = client_itunes.get(&itunes_url).send().await {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                if let Some(artwork) =
                    json.pointer("/results/0/artworkUrl100").and_then(|v| v.as_str())
                {
                    let _ = tx_itunes.send(artwork.replace("100x100bb", "300x300bb")).await;
                }
            }
        }
    });

    // 网易云 API
    let tx_netease = tx.clone();
    let client_netease = client.clone();
    let song_netease = song_name.clone();
    let artist_netease = artist_name.clone();
    tokio::spawn(async move {
        let ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
        let query = format!("{} {}", song_netease, artist_netease);
        if let Ok(resp) = client_netease
            .post("https://music.163.com/api/search/get/web")
            .header("Referer", "https://music.163.com")
            .header("User-Agent", ua)
            .form(&[
                ("s", query.as_str()),
                ("type", "1"),
                ("limit", "1"),
                ("offset", "0"),
            ])
            .send()
            .await
        {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                if let Some(pic) =
                    json.pointer("/result/songs/0/al/picUrl").and_then(|v| v.as_str())
                {
                    if !pic.is_empty() && pic != "http://p4.music.126.net/UeTuwE7pvjBpypWLudqukQ==/3135032972947607.jpg" {
                        let _ = tx_netease.send(pic.replace("http://", "https://") + "?param=300y300").await;
                    }
                }
            }
        }
    });

    // Deezer API
    let tx_deezer = tx.clone();
    let client_deezer = client.clone();
    let song_deezer = song_name.clone();
    let artist_deezer = artist_name.clone();
    tokio::spawn(async move {
        let ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
        let deezer_url = format!(
            "https://api.deezer.com/search?q=track:\"{}\" artist:\"{}\"&limit=1",
            urlencoding::encode(&song_deezer).into_owned(),
            urlencoding::encode(&artist_deezer).into_owned()
        );
        if let Ok(resp) = client_deezer.get(&deezer_url).header("User-Agent", ua).send().await {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                if let Some(cover) =
                    json.pointer("/data/0/album/cover_medium").and_then(|v| v.as_str())
                {
                    if !cover.is_empty() {
                        let _ = tx_deezer.send(cover.to_string()).await;
                    }
                } else if let Some(cover) =
                    json.pointer("/data/0/album/cover_big").and_then(|v| v.as_str())
                {
                    if !cover.is_empty() {
                        let _ = tx_deezer.send(cover.to_string()).await;
                    }
                }
            }
        }
    });

    // 竞速：谁最快返回就用谁的
    match tokio::time::timeout(std::time::Duration::from_secs(3), rx.recv()).await {
        Ok(Some(url)) => Ok(url),
        _ => Ok("data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTUwIiBoZWlnaHQ9IjE1MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjEwMCUiPjxzdG9wIG9mZnNldD0iMCUiIHN0b3AtY29sb3I9IiNhOGVkZWEiLz48c3RvcCBvZmZzZXQ9IjEwMCUiIHN0b3AtY29sb3I9IiNmZWQ2ZTMiLz48L2xpbmVhckdyYWRpZW50PjwvZGVmcz48cmVjdCB3aWR0aD0iMTUwIiBoZWlnaHQ9IjE1MCIgcng9Ijc1IiBmaWxsPSJ1cmwoI2cpIi8+PC9zdmc+".to_string()),
    }
}

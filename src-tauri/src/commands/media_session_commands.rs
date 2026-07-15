/**
 * 媒体会话命令
 *
 * 包含目标播放器、SMTC 会话、播放状态和媒体控制。
 */
use super::media_timeline::{
    now_ms, read_timeline_state, resolve_seek_availability, resolve_seek_position_ticks,
};
use serde::Serialize;
use std::sync::Mutex;
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
    pub can_seek: bool,
    pub duration_ms: Option<u64>,
    pub position_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeline_updated_at_ms: Option<u64>,
    pub snapshot_taken_at_ms: u64,
}

/// 设置目标音乐平台
#[tauri::command]
pub fn set_target_player(player: String) {
    if let Ok(mut target) = TARGET_PLAYER.lock() {
        *target = player;
    }
}

/// 获取当前目标音乐平台
fn get_active_target_player() -> String {
    match TARGET_PLAYER.lock() {
        Ok(guard) if !guard.is_empty() => guard.clone(),
        Ok(_) => "netease".to_string(),
        Err(error) => {
            eprintln!("[NSD] 获取目标平台失败: {}", error);
            "netease".to_string()
        }
    }
}

/// 获取目标媒体会话
///
/// 根据前端设置的目标平台，查找对应的媒体控制会话。
pub(super) fn get_target_media_session() -> Option<GlobalSystemMediaTransportControlsSession> {
    get_target_media_session_with_source().map(|(session, _)| session)
}

fn get_target_media_session_with_source(
) -> Option<(GlobalSystemMediaTransportControlsSession, String)> {
    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .ok()?
        .get()
        .ok()?;
    let sessions = manager.GetSessions().ok()?;
    let target = get_active_target_player();

    for session in sessions {
        if let Ok(app_id) = session.SourceAppUserModelId() {
            let app_id_lower = app_id.to_string().to_lowercase();
            let matches_target = if target == "netease" {
                app_id_lower.contains("cloudmusic") || app_id_lower.contains("netease")
            } else {
                app_id_lower.contains(&target)
            };
            if matches_target {
                return Some((session, app_id.to_string()));
            }
        }
    }
    None
}

fn is_session_playing(session: &GlobalSystemMediaTransportControlsSession) -> bool {
    session
        .GetPlaybackInfo()
        .ok()
        .and_then(|info| info.PlaybackStatus().ok())
        .is_some_and(|status| {
            status == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing
        })
}

fn is_session_seekable(session: &GlobalSystemMediaTransportControlsSession) -> bool {
    session
        .GetPlaybackInfo()
        .ok()
        .and_then(|info| info.Controls().ok())
        .and_then(|controls| controls.IsPlaybackPositionEnabled().ok())
        .unwrap_or(false)
}

/// 获取音乐信息
///
/// 返回 (歌名, 歌手, 是否正在播放)。
#[tauri::command]
pub async fn fetch_netease_music_info() -> Result<Option<(String, String, bool)>, String> {
    let session = match get_target_media_session() {
        Some(session) => session,
        None => return Ok(None),
    };
    let is_playing = is_session_playing(&session);
    let properties = session
        .TryGetMediaPropertiesAsync()
        .map_err(|error| error.to_string())?
        .get()
        .map_err(|error| error.to_string())?;
    let title = properties.Title().unwrap_or_default().to_string();
    if title.is_empty() {
        return Ok(None);
    }
    let artist = properties.Artist().unwrap_or_default().to_string();

    Ok(Some((title, artist, is_playing)))
}

/// 获取完整音乐播放状态
#[tauri::command]
pub async fn get_music_playback_state() -> Result<Option<MusicPlaybackState>, String> {
    let (session, source_app_id) = match get_target_media_session_with_source() {
        Some(value) => value,
        None => return Ok(None),
    };
    let is_playing = is_session_playing(&session);
    let seek_capability = is_session_seekable(&session);
    let properties = session
        .TryGetMediaPropertiesAsync()
        .map_err(|error| error.to_string())?
        .get()
        .map_err(|error| error.to_string())?;
    let title = properties.Title().unwrap_or_default().to_string();
    if title.is_empty() {
        return Ok(None);
    }
    let timeline = read_timeline_state(&session).unwrap_or_default();
    let can_seek = resolve_seek_availability(seek_capability, &timeline);
    let snapshot_taken_at_ms = now_ms();

    Ok(Some(MusicPlaybackState {
        title,
        artist: properties.Artist().unwrap_or_default().to_string(),
        album: non_empty_string(properties.AlbumTitle().unwrap_or_default().to_string()),
        source_app_id,
        player: get_active_target_player(),
        is_playing,
        can_seek,
        duration_ms: timeline.duration_ms,
        position_ms: timeline.position_ms,
        timeline_updated_at_ms: timeline.timeline_updated_at_ms,
        snapshot_taken_at_ms,
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

/// 跳转系统媒体播放位置
#[tauri::command]
pub async fn seek_system_media(position_ms: u64) -> Result<bool, String> {
    let Some(session) = get_target_media_session() else {
        return Ok(false);
    };
    let Some(position_ticks) = resolve_seek_position_ticks(&session, position_ms) else {
        return Ok(false);
    };

    session
        .TryChangePlaybackPositionAsync(position_ticks)
        .map_err(|error| error.to_string())?
        .get()
        .map_err(|error| error.to_string())
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
mod timeline_serialization_tests {
    use super::*;

    fn playback_state(timeline_updated_at_ms: Option<u64>) -> MusicPlaybackState {
        MusicPlaybackState {
            title: "晴天".to_string(),
            artist: "周杰伦".to_string(),
            album: None,
            source_app_id: "cloudmusic".to_string(),
            player: "netease".to_string(),
            is_playing: timeline_updated_at_ms.is_some(),
            can_seek: true,
            duration_ms: timeline_updated_at_ms.map(|_| 10_000),
            position_ms: timeline_updated_at_ms.map(|_| 2_000),
            timeline_updated_at_ms,
            snapshot_taken_at_ms: 43_000,
        }
    }

    #[test]
    fn playback_state_serializes_time_anchor_fields() {
        let json = serde_json::to_value(playback_state(Some(42_000))).expect("播放状态应可序列化");

        assert_eq!(json["timelineUpdatedAtMs"], 42_000);
        assert_eq!(json["snapshotTakenAtMs"], 43_000);
        assert_eq!(json["canSeek"], true);
        assert!(json.get("timelineSampledAtMs").is_none());
    }

    #[test]
    fn playback_state_omits_missing_timeline_update_time() {
        let json = serde_json::to_value(playback_state(None)).expect("播放状态应可序列化");

        assert!(json.get("timelineUpdatedAtMs").is_none());
    }
}

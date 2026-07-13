/**
 * 媒体封面命令
 *
 * 包含本地 SMTC 封面读取和在线封面获取。
 */
use super::media_session_commands::get_target_media_session;
use tokio::sync::mpsc::Sender;

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

fn spawn_itunes_cover_request(
    client: reqwest::Client,
    tx: Sender<String>,
    song_name: &str,
    artist_name: &str,
) {
    let query = format!("{} {}", song_name, artist_name);
    tokio::spawn(async move {
        let encoded_query = urlencoding::encode(&query).into_owned();
        let url = format!(
            "https://itunes.apple.com/search?term={}&media=music&limit=1",
            encoded_query
        );
        if let Ok(resp) = client.get(&url).send().await {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                if let Some(artwork) =
                    json.pointer("/results/0/artworkUrl100").and_then(|value| value.as_str())
                {
                    let _ = tx.send(artwork.replace("100x100bb", "300x300bb")).await;
                }
            }
        }
    });
}

fn spawn_netease_cover_request(
    client: reqwest::Client,
    tx: Sender<String>,
    song_name: &str,
    artist_name: &str,
) {
    let query = format!("{} {}", song_name, artist_name);
    tokio::spawn(async move {
        let ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
        if let Ok(resp) = client
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
                    json.pointer("/result/songs/0/al/picUrl").and_then(|value| value.as_str())
                {
                    let placeholder =
                        "http://p4.music.126.net/UeTuwE7pvjBpypWLudqukQ==/3135032972947607.jpg";
                    if !pic.is_empty() && pic != placeholder {
                        let url = pic.replace("http://", "https://") + "?param=300y300";
                        let _ = tx.send(url).await;
                    }
                }
            }
        }
    });
}

fn spawn_deezer_cover_request(
    client: reqwest::Client,
    tx: Sender<String>,
    song_name: &str,
    artist_name: &str,
) {
    let url = format!(
        "https://api.deezer.com/search?q=track:\"{}\" artist:\"{}\"&limit=1",
        urlencoding::encode(song_name),
        urlencoding::encode(artist_name)
    );
    tokio::spawn(async move {
        let ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
        if let Ok(resp) = client.get(&url).header("User-Agent", ua).send().await {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                let cover = json
                    .pointer("/data/0/album/cover_medium")
                    .or_else(|| json.pointer("/data/0/album/cover_big"))
                    .and_then(|value| value.as_str());
                if let Some(cover) = cover.filter(|value| !value.is_empty()) {
                    let _ = tx.send(cover.to_string()).await;
                }
            }
        }
    });
}

/// 获取歌曲封面
///
/// 优先从本地 SMTC 获取，失败则从网络获取。
#[tauri::command]
pub async fn get_random_cover_url(
    song_name: String,
    artist_name: String,
) -> Result<String, String> {
    if let Some(base64_cover) = get_smtc_thumbnail() {
        return Ok(base64_cover);
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|error| error.to_string())?;
    let (tx, mut rx) = tokio::sync::mpsc::channel(3);
    spawn_itunes_cover_request(client.clone(), tx.clone(), &song_name, &artist_name);
    spawn_netease_cover_request(client.clone(), tx.clone(), &song_name, &artist_name);
    spawn_deezer_cover_request(client, tx, &song_name, &artist_name);

    match tokio::time::timeout(std::time::Duration::from_secs(3), rx.recv()).await {
        Ok(Some(url)) => Ok(url),
        _ => Ok("data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTUwIiBoZWlnaHQ9IjE1MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjEwMCUiPjxzdG9wIG9mZnNldD0iMCUiIHN0b3AtY29sb3I9IiNhOGVkZWEiLz48c3RvcCBvZmZzZXQ9IjEwMCUiIHN0b3AtY29sb3I9IiNmZWQ2ZTMiLz48L2xpbmVhckdyYWRpZW50PjwvZGVmcz48cmVjdCB3aWR0aD0iMTUwIiBoZWlnaHQ9IjE1MCIgcng9Ijc1IiBmaWxsPSJ1cmwoI2cpIi8+PC9zdmc+".to_string()),
    }
}

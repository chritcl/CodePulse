use serde_json::{json, Value};

use super::matcher::{is_confident_match, score_candidate};
use super::parser::{parse_lrc, parse_plain_lyrics};
use super::types::{LyricsCandidate, LyricsTrackRequest, ProviderLyrics};

const USER_AGENT: &str = "NetSpeedDynamic/2.3.8 (https://github.com/GEORGEWWWU/NetSpeed-Dynamic)";

type ProviderResult = Result<Option<ProviderLyrics>, String>;

/// 根据当前音乐平台获取在线歌词
pub async fn fetch_online_lyrics(
    request: &LyricsTrackRequest,
    client: &reqwest::Client,
) -> ProviderResult {
    let player = request.player.as_deref().unwrap_or_default();
    let providers = match player {
        "qqmusic" => vec![ProviderKind::QqMusic, ProviderKind::Lrclib],
        "netease" => vec![ProviderKind::Netease, ProviderKind::Lrclib],
        _ => vec![ProviderKind::Lrclib],
    };

    let mut last_error = None;

    for provider in providers {
        let result = match provider {
            ProviderKind::QqMusic => fetch_qq_music_lyrics(request, client).await,
            ProviderKind::Netease => fetch_netease_lyrics(request, client).await,
            ProviderKind::Lrclib => fetch_lrclib_lyrics(request, client).await,
        };

        match result {
            Ok(Some(lyrics)) => return Ok(Some(lyrics)),
            Ok(None) => {}
            Err(err) => {
                eprintln!("[NSD] 歌词源 {} 查询失败: {}", provider.name(), err);
                last_error = Some(err);
            }
        }
    }

    if let Some(err) = last_error {
        eprintln!("[NSD] 在线歌词查询未命中，最后错误: {}", err);
    }

    Ok(None)
}

#[derive(Clone, Copy)]
enum ProviderKind {
    QqMusic,
    Netease,
    Lrclib,
}

impl ProviderKind {
    fn name(self) -> &'static str {
        match self {
            ProviderKind::QqMusic => "qqmusic",
            ProviderKind::Netease => "netease",
            ProviderKind::Lrclib => "lrclib",
        }
    }
}

async fn fetch_qq_music_lyrics(
    request: &LyricsTrackRequest,
    client: &reqwest::Client,
) -> ProviderResult {
    let search_payload = json!({
        "comm": {
            "ct": "19",
            "cv": "1859",
            "uin": "0"
        },
        "req": {
            "method": "DoSearchForQQMusicDesktop",
            "module": "music.search.SearchCgiService",
            "param": {
                "grp": 1,
                "num_per_page": 8,
                "page_num": 1,
                "query": build_query(request),
                "search_type": 0
            }
        }
    });

    let search_json = client
        .post("https://u.y.qq.com/cgi-bin/musicu.fcg")
        .header("User-Agent", USER_AGENT)
        .header("Referer", "https://y.qq.com/")
        .json(&search_payload)
        .send()
        .await
        .map_err(|err| err.to_string())?
        .json::<Value>()
        .await
        .map_err(|err| err.to_string())?;

    let candidates = search_json
        .pointer("/req/data/body/song/list")
        .and_then(Value::as_array)
        .map(|songs| {
            songs
                .iter()
                .filter_map(|song| {
                    let id = song.get("mid")?.as_str()?.to_string();
                    let title = song.get("name")?.as_str()?.to_string();
                    let artist = join_artist_names(song.get("singer"));
                    let duration_ms =
                        song.get("interval").and_then(Value::as_u64).map(|sec| sec * 1000);

                    Some(LyricsCandidate {
                        title,
                        artist,
                        duration_ms,
                        id,
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let Some((candidate, confidence)) = pick_best_candidate(request, candidates) else {
        return Ok(None);
    };

    let lyric_url = format!(
        "https://i.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid={}&g_tk=5381&format=json&inCharset=utf8&outCharset=utf-8&nobase64=1",
        urlencoding::encode(&candidate.id)
    );
    let lyric_json = client
        .get(lyric_url)
        .header("User-Agent", USER_AGENT)
        .header("Referer", "https://y.qq.com/")
        .send()
        .await
        .map_err(|err| err.to_string())?
        .json::<Value>()
        .await
        .map_err(|err| err.to_string())?;

    let raw_lrc = lyric_json
        .get("lyric")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    if raw_lrc.is_empty() {
        return Ok(None);
    }

    let translation = lyric_json
        .get("trans")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let lines = parse_lrc(&raw_lrc, translation);
    if lines.is_empty() {
        return Ok(None);
    }

    Ok(Some(ProviderLyrics {
        provider: ProviderKind::QqMusic.name().to_string(),
        confidence,
        raw_lrc: Some(raw_lrc),
        lines,
    }))
}

async fn fetch_netease_lyrics(
    request: &LyricsTrackRequest,
    client: &reqwest::Client,
) -> ProviderResult {
    let search_json = client
        .post("https://music.163.com/api/search/get/web")
        .header("User-Agent", USER_AGENT)
        .header("Referer", "https://music.163.com")
        .form(&[
            ("s", build_query(request)),
            ("type", "1".to_string()),
            ("limit", "10".to_string()),
            ("offset", "0".to_string()),
        ])
        .send()
        .await
        .map_err(|err| err.to_string())?
        .json::<Value>()
        .await
        .map_err(|err| err.to_string())?;

    let candidates = search_json
        .pointer("/result/songs")
        .and_then(Value::as_array)
        .map(|songs| {
            songs
                .iter()
                .filter_map(|song| {
                    let id = song.get("id")?.as_i64()?.to_string();
                    let title = song.get("name")?.as_str()?.to_string();
                    let artist = join_artist_names(song.get("artists").or_else(|| song.get("ar")));
                    let duration_ms =
                        song.get("duration").or_else(|| song.get("dt")).and_then(Value::as_u64);

                    Some(LyricsCandidate {
                        title,
                        artist,
                        duration_ms,
                        id,
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let Some((candidate, confidence)) = pick_best_candidate(request, candidates) else {
        return Ok(None);
    };

    let lyric_url = format!(
        "https://music.163.com/api/song/lyric?os=pc&id={}&lv=-1&kv=-1&tv=-1",
        urlencoding::encode(&candidate.id)
    );
    let lyric_json = client
        .get(lyric_url)
        .header("User-Agent", USER_AGENT)
        .header("Referer", "https://music.163.com")
        .send()
        .await
        .map_err(|err| err.to_string())?
        .json::<Value>()
        .await
        .map_err(|err| err.to_string())?;

    let raw_lrc = lyric_json
        .pointer("/lrc/lyric")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    if raw_lrc.is_empty() {
        return Ok(None);
    }

    let translation = lyric_json
        .pointer("/tlyric/lyric")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let lines = parse_lrc(&raw_lrc, translation);
    if lines.is_empty() {
        return Ok(None);
    }

    Ok(Some(ProviderLyrics {
        provider: ProviderKind::Netease.name().to_string(),
        confidence,
        raw_lrc: Some(raw_lrc),
        lines,
    }))
}

async fn fetch_lrclib_lyrics(
    request: &LyricsTrackRequest,
    client: &reqwest::Client,
) -> ProviderResult {
    let mut url = format!(
        "https://lrclib.net/api/search?track_name={}&artist_name={}",
        urlencoding::encode(&request.title),
        urlencoding::encode(&request.artist)
    );

    if let Some(album) = request.album.as_deref().filter(|value| !value.trim().is_empty()) {
        url.push_str("&album_name=");
        url.push_str(&urlencoding::encode(album));
    }

    if let Some(duration_ms) = request.duration_ms {
        url.push_str("&duration=");
        url.push_str(&(duration_ms / 1000).to_string());
    }

    let search_json = client
        .get(url)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(|err| err.to_string())?
        .json::<Value>()
        .await
        .map_err(|err| err.to_string())?;

    let candidates = search_json
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let id = item.get("id")?.to_string();
                    let title = item.get("trackName")?.as_str()?.to_string();
                    let artist = item.get("artistName")?.as_str()?.to_string();
                    let duration_ms = item
                        .get("duration")
                        .and_then(Value::as_f64)
                        .map(|seconds| (seconds * 1000.0).round() as u64);

                    Some(LyricsCandidate {
                        title,
                        artist,
                        duration_ms,
                        id,
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let Some((candidate, confidence)) = pick_best_candidate(request, candidates) else {
        return Ok(None);
    };

    let item = search_json.as_array().and_then(|items| {
        items
            .iter()
            .find(|item| item.get("id").map(Value::to_string) == Some(candidate.id.clone()))
    });

    let Some(item) = item else {
        return Ok(None);
    };

    let synced = item
        .get("syncedLyrics")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let plain = item
        .get("plainLyrics")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let Some(raw) = synced.or(plain) else {
        return Ok(None);
    };

    let lines = if synced.is_some() {
        parse_lrc(raw, None)
    } else {
        parse_plain_lyrics(raw)
    };
    if lines.is_empty() {
        return Ok(None);
    }

    Ok(Some(ProviderLyrics {
        provider: ProviderKind::Lrclib.name().to_string(),
        confidence,
        raw_lrc: Some(raw.to_string()),
        lines,
    }))
}

fn build_query(request: &LyricsTrackRequest) -> String {
    if request.artist.trim().is_empty() {
        request.title.trim().to_string()
    } else {
        format!("{} {}", request.title.trim(), request.artist.trim())
    }
}

fn join_artist_names(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("name").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("/")
        })
        .unwrap_or_default()
}

fn pick_best_candidate(
    request: &LyricsTrackRequest,
    candidates: Vec<LyricsCandidate>,
) -> Option<(LyricsCandidate, f32)> {
    candidates
        .into_iter()
        .filter(|candidate| is_confident_match(request, candidate))
        .map(|candidate| {
            let score = score_candidate(request, &candidate);
            (candidate, score)
        })
        .max_by(|left, right| left.1.total_cmp(&right.1))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(player: &str) -> LyricsTrackRequest {
        LyricsTrackRequest {
            title: "晴天".to_string(),
            artist: "周杰伦".to_string(),
            album: None,
            duration_ms: Some(269_000),
            player: Some(player.to_string()),
        }
    }

    #[tokio::test]
    #[ignore]
    async fn fetches_qq_music_lyrics() {
        let client = reqwest::Client::new();
        let lyrics = fetch_qq_music_lyrics(&request("qqmusic"), &client).await.unwrap().unwrap();

        assert_eq!(lyrics.provider, "qqmusic");
        assert!(!lyrics.lines.is_empty());
    }

    #[tokio::test]
    #[ignore]
    async fn fetches_netease_or_returns_no_match() {
        let client = reqwest::Client::new();
        let result = fetch_netease_lyrics(&request("netease"), &client).await.unwrap();

        if let Some(lyrics) = result {
            assert_eq!(lyrics.provider, "netease");
            assert!(!lyrics.lines.is_empty());
        }
    }

    #[tokio::test]
    #[ignore]
    async fn fetches_lrclib_lyrics() {
        let client = reqwest::Client::new();
        let lyrics = fetch_lrclib_lyrics(&request("spotify"), &client).await.unwrap().unwrap();

        assert_eq!(lyrics.provider, "lrclib");
        assert!(!lyrics.lines.is_empty());
    }
}

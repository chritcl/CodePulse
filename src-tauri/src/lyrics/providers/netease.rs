use serde_json::Value;

use super::{build_query, pick_best_candidate, ProviderResult, USER_AGENT};
use crate::lyrics::parser::{has_timed_lines, parse_lrc};
use crate::lyrics::types::{LyricsCandidate, LyricsTrackRequest, ProviderLyrics};

pub(super) async fn fetch(
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
        .map(|songs| songs.iter().filter_map(parse_candidate).collect::<Vec<_>>())
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
    let lines = parse_lrc(&raw_lrc, translation).map_err(|err| err.to_string())?;
    if !has_timed_lines(&lines) {
        return Ok(None);
    }
    Ok(Some(ProviderLyrics {
        provider: "netease".to_string(),
        confidence,
        raw_lrc: Some(raw_lrc),
        lines,
    }))
}

fn parse_candidate(song: &Value) -> Option<LyricsCandidate> {
    let id = song.get("id")?.as_i64()?.to_string();
    let title = song.get("name")?.as_str()?.to_string();
    let artist = join_artist_names(song.get("artists").or_else(|| song.get("ar")));
    let duration_ms = song.get("duration").or_else(|| song.get("dt")).and_then(Value::as_u64);

    Some(LyricsCandidate {
        title,
        artist,
        album: None,
        duration_ms,
        id,
    })
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_netease_search_candidate() {
        let song = serde_json::json!({
            "id": 186016,
            "name": "晴天",
            "duration": 269_000,
            "artists": [{ "name": "周杰伦" }]
        });

        let candidate = parse_candidate(&song).unwrap();
        assert_eq!(candidate.id, "186016");
        assert_eq!(candidate.artist, "周杰伦");
    }
}

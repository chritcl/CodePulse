use serde_json::{json, Value};

use super::{build_query, pick_best_candidate, ProviderResult, USER_AGENT};
use crate::lyrics::parser::{has_timed_lines, parse_lrc};
use crate::lyrics::types::{LyricsCandidate, LyricsTrackRequest, ProviderLyrics};

pub(super) async fn fetch(
    request: &LyricsTrackRequest,
    client: &reqwest::Client,
) -> ProviderResult {
    let search_payload = json!({
        "comm": { "ct": "19", "cv": "1859", "uin": "0" },
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
        .map(|songs| songs.iter().filter_map(parse_candidate).collect::<Vec<_>>())
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
    let lines = parse_lrc(&raw_lrc, translation).map_err(|err| err.to_string())?;
    if !has_timed_lines(&lines) {
        return Ok(None);
    }
    Ok(Some(ProviderLyrics {
        provider: "qqmusic".to_string(),
        confidence,
        raw_lrc: Some(raw_lrc),
        lines,
    }))
}

fn parse_candidate(song: &Value) -> Option<LyricsCandidate> {
    let id = song.get("mid")?.as_str()?.to_string();
    let title = song.get("name")?.as_str()?.to_string();
    let artist = join_artist_names(song.get("singer"));
    let duration_ms = song.get("interval").and_then(Value::as_u64).map(|sec| sec * 1000);

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
    fn parses_qq_search_candidate() {
        let song = json!({
            "mid": "0039MnYb0qxYhV",
            "name": "晴天",
            "interval": 269,
            "singer": [{ "name": "周杰伦" }]
        });

        let candidate = parse_candidate(&song).unwrap();
        assert_eq!(candidate.id, "0039MnYb0qxYhV");
        assert_eq!(candidate.duration_ms, Some(269_000));
    }
}

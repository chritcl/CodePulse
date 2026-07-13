use std::sync::Arc;

use async_trait::async_trait;
use serde_json::{json, Value};

use super::{build_query, pick_best_candidate, LyricsProvider, USER_AGENT};
use crate::lyrics::error::LyricsProviderError;
use crate::lyrics::parser::{has_timed_lines, parse_lrc};
use crate::lyrics::provider_http::fetch_json;
use crate::lyrics::types::{LyricsCandidate, LyricsTrackRequest, ProviderLyrics};

pub(super) struct QqMusicProvider {
    client: Arc<reqwest::Client>,
}

impl QqMusicProvider {
    pub(super) fn new(client: Arc<reqwest::Client>) -> Self {
        Self { client }
    }
}

#[async_trait]
impl LyricsProvider for QqMusicProvider {
    fn name(&self) -> &'static str {
        "qqmusic"
    }

    #[cfg(test)]
    fn client_identity(&self) -> Option<usize> {
        Some(Arc::as_ptr(&self.client) as usize)
    }

    async fn fetch(
        &self,
        request: &LyricsTrackRequest,
    ) -> Result<Option<ProviderLyrics>, LyricsProviderError> {
        let Some((candidate, confidence)) = search(request, self.client.as_ref()).await? else {
            return Ok(None);
        };
        load_lyrics(&candidate, confidence, self.client.as_ref()).await
    }
}

async fn search(
    track_request: &LyricsTrackRequest,
    client: &reqwest::Client,
) -> Result<Option<(LyricsCandidate, f32)>, LyricsProviderError> {
    let payload = search_payload(track_request);
    let http_request = client
        .post("https://u.y.qq.com/cgi-bin/musicu.fcg")
        .header("User-Agent", USER_AGENT)
        .header("Referer", "https://y.qq.com/")
        .json(&payload);
    let value: Value = fetch_json("qqmusic", "search", http_request).await?;
    validate_business_response(&value, "search", true)?;
    let candidates = value
        .pointer("/req/data/body/song/list")
        .and_then(Value::as_array)
        .map(|songs| songs.iter().filter_map(parse_candidate).collect())
        .unwrap_or_default();
    Ok(pick_best_candidate(track_request, candidates))
}

fn search_payload(request: &LyricsTrackRequest) -> Value {
    json!({
        "comm": { "ct": "19", "cv": "1859", "uin": "0" },
        "req": {
            "method": "DoSearchForQQMusicDesktop",
            "module": "music.search.SearchCgiService",
            "param": {
                "grp": 1, "num_per_page": 8, "page_num": 1,
                "query": build_query(request), "search_type": 0
            }
        }
    })
}

async fn load_lyrics(
    candidate: &LyricsCandidate,
    confidence: f32,
    client: &reqwest::Client,
) -> Result<Option<ProviderLyrics>, LyricsProviderError> {
    let url = format!(
        "https://i.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid={}&g_tk=5381&format=json&inCharset=utf8&outCharset=utf-8&nobase64=1",
        urlencoding::encode(&candidate.id)
    );
    let request = client
        .get(url)
        .header("User-Agent", USER_AGENT)
        .header("Referer", "https://y.qq.com/");
    let value: Value = fetch_json("qqmusic", "lyrics", request).await?;
    validate_business_response(&value, "lyrics", false)?;
    build_lyrics(value, confidence)
}

fn validate_business_response(
    value: &Value,
    stage: &str,
    require_request_code: bool,
) -> Result<(), LyricsProviderError> {
    validate_code(value.get("code"), stage, "code")?;
    if require_request_code {
        validate_code(value.pointer("/req/code"), stage, "req.code")?;
    }
    Ok(())
}

fn validate_code(
    value: Option<&Value>,
    stage: &str,
    field: &str,
) -> Result<(), LyricsProviderError> {
    match value.and_then(Value::as_i64) {
        Some(0) => Ok(()),
        Some(code) => Err(business_error(
            stage,
            format!("{field} 返回失败状态 {code}"),
        )),
        None => Err(business_error(stage, format!("缺少有效的 {field} 状态码"))),
    }
}

fn business_error(stage: &str, message: String) -> LyricsProviderError {
    LyricsProviderError::with_message("qqmusic", format!("{stage}.business"), message)
}

fn build_lyrics(
    value: Value,
    confidence: f32,
) -> Result<Option<ProviderLyrics>, LyricsProviderError> {
    let raw_lrc = value.get("lyric").and_then(Value::as_str).unwrap_or_default().trim();
    if raw_lrc.is_empty() {
        return Ok(None);
    }
    let translation = value
        .get("trans")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty());
    let lines = parse_lrc(raw_lrc, translation).map_err(|error| {
        LyricsProviderError::with_message("qqmusic", "lyrics.lrc_parse", error.to_string())
    })?;
    if !has_timed_lines(&lines) {
        return Ok(None);
    }
    Ok(Some(ProviderLyrics {
        provider: "qqmusic".to_string(),
        confidence,
        raw_lrc: Some(raw_lrc.to_string()),
        lines,
    }))
}

fn parse_candidate(song: &Value) -> Option<LyricsCandidate> {
    Some(LyricsCandidate {
        id: song.get("mid")?.as_str()?.to_string(),
        title: song.get("name")?.as_str()?.to_string(),
        artist: join_artist_names(song.get("singer")),
        album: None,
        duration_ms: song.get("interval").and_then(Value::as_u64).map(|sec| sec * 1000),
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
            "mid": "0039MnYb0qxYhV", "name": "晴天", "interval": 269,
            "singer": [{ "name": "周杰伦" }]
        });
        let candidate = parse_candidate(&song).unwrap();
        assert_eq!(candidate.id, "0039MnYb0qxYhV");
        assert_eq!(candidate.duration_ms, Some(269_000));
    }

    #[test]
    fn rejects_qq_search_business_failure_codes() {
        let top_level = json!({ "code": 1000, "req": { "code": 0 } });
        let request_level = json!({ "code": 0, "req": { "code": 1001 } });
        let missing_top_level = json!({ "req": { "code": 0 } });
        let missing_request_level = json!({ "code": 0, "req": {} });

        assert_eq!(
            validate_business_response(&top_level, "search", true).unwrap_err().stage(),
            "search.business"
        );
        assert!(validate_business_response(&request_level, "search", true).is_err());
        assert!(validate_business_response(&missing_top_level, "search", true).is_err());
        assert!(validate_business_response(&missing_request_level, "search", true).is_err());
    }

    #[test]
    fn qq_lyrics_success_does_not_require_search_request_code() {
        let lyrics = json!({ "code": 0, "lyric": "" });

        validate_business_response(&lyrics, "lyrics", false).unwrap();
    }
}

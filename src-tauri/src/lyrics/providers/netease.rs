use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use super::{build_query, pick_best_candidate, LyricsProvider, USER_AGENT};
use crate::lyrics::error::LyricsProviderError;
use crate::lyrics::parser::{has_timed_lines, parse_lrc};
use crate::lyrics::provider_http::fetch_json;
use crate::lyrics::types::{LyricsCandidate, LyricsTrackRequest, ProviderLyrics};

pub(super) struct NeteaseProvider {
    client: Arc<reqwest::Client>,
}

impl NeteaseProvider {
    pub(super) fn new(client: Arc<reqwest::Client>) -> Self {
        Self { client }
    }
}

#[async_trait]
impl LyricsProvider for NeteaseProvider {
    fn name(&self) -> &'static str {
        "netease"
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
    let form = [
        ("s", build_query(track_request)),
        ("type", "1".to_string()),
        ("limit", "10".to_string()),
        ("offset", "0".to_string()),
    ];
    let request = client
        .post("https://music.163.com/api/search/get/web")
        .header("User-Agent", USER_AGENT)
        .header("Referer", "https://music.163.com")
        .form(&form);
    let value: Value = fetch_json("netease", "search", request).await?;
    validate_business_response(&value, "search")?;
    let candidates = value
        .pointer("/result/songs")
        .and_then(Value::as_array)
        .map(|songs| songs.iter().filter_map(parse_candidate).collect())
        .unwrap_or_default();
    Ok(pick_best_candidate(track_request, candidates))
}

async fn load_lyrics(
    candidate: &LyricsCandidate,
    confidence: f32,
    client: &reqwest::Client,
) -> Result<Option<ProviderLyrics>, LyricsProviderError> {
    let url = format!(
        "https://music.163.com/api/song/lyric?os=pc&id={}&lv=-1&kv=-1&tv=-1",
        urlencoding::encode(&candidate.id)
    );
    let request = client
        .get(url)
        .header("User-Agent", USER_AGENT)
        .header("Referer", "https://music.163.com");
    let value: Value = fetch_json("netease", "lyrics", request).await?;
    validate_business_response(&value, "lyrics")?;
    build_lyrics(value, confidence)
}

fn validate_business_response(value: &Value, stage: &str) -> Result<(), LyricsProviderError> {
    match value.get("code").and_then(Value::as_i64) {
        Some(200) => Ok(()),
        Some(code) => Err(business_error(stage, format!("code 返回失败状态 {code}"))),
        None => Err(business_error(stage, "缺少有效的 code 状态码".to_string())),
    }
}

fn business_error(stage: &str, message: String) -> LyricsProviderError {
    LyricsProviderError::with_message("netease", format!("{stage}.business"), message)
}

fn build_lyrics(
    value: Value,
    confidence: f32,
) -> Result<Option<ProviderLyrics>, LyricsProviderError> {
    let raw_lrc = value.pointer("/lrc/lyric").and_then(Value::as_str).unwrap_or_default().trim();
    if raw_lrc.is_empty() {
        return Ok(None);
    }
    let translation = value
        .pointer("/tlyric/lyric")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty());
    let lines = parse_lrc(raw_lrc, translation).map_err(|error| {
        LyricsProviderError::with_message("netease", "lyrics.lrc_parse", error.to_string())
    })?;
    if !has_timed_lines(&lines) {
        return Ok(None);
    }
    Ok(Some(ProviderLyrics {
        provider: "netease".to_string(),
        confidence,
        raw_lrc: Some(raw_lrc.to_string()),
        lines,
    }))
}

fn parse_candidate(song: &Value) -> Option<LyricsCandidate> {
    Some(LyricsCandidate {
        id: song.get("id")?.as_i64()?.to_string(),
        title: song.get("name")?.as_str()?.to_string(),
        artist: join_artist_names(song.get("artists").or_else(|| song.get("ar"))),
        album: None,
        duration_ms: song.get("duration").or_else(|| song.get("dt")).and_then(Value::as_u64),
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
            "id": 186016, "name": "晴天", "duration": 269_000,
            "artists": [{ "name": "周杰伦" }]
        });
        let candidate = parse_candidate(&song).unwrap();
        assert_eq!(candidate.id, "186016");
        assert_eq!(candidate.artist, "周杰伦");
    }

    #[test]
    fn rejects_netease_business_failure_code() {
        let value = serde_json::json!({ "code": 500 });
        let missing = serde_json::json!({ "result": {} });

        let error = validate_business_response(&value, "search").unwrap_err();

        assert_eq!(error.provider(), "netease");
        assert_eq!(error.stage(), "search.business");
        assert!(validate_business_response(&missing, "search").is_err());
    }

    #[test]
    fn accepts_netease_success_code() {
        validate_business_response(&serde_json::json!({ "code": 200 }), "lyrics").unwrap();
    }
}

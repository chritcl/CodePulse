use serde::de::DeserializeOwned;

use super::error::LyricsProviderError;

pub(super) const MAX_RESPONSE_BYTES: usize = 512 * 1024;

pub(super) async fn fetch_json<T: DeserializeOwned>(
    provider: &str,
    stage: &str,
    request: reqwest::RequestBuilder,
) -> Result<T, LyricsProviderError> {
    let response = request
        .send()
        .await
        .map_err(|error| provider_error(provider, &format!("{stage}.send"), error.to_string()))?;
    let response = response
        .error_for_status()
        .map_err(|error| provider_error(provider, &format!("{stage}.status"), error.to_string()))?;
    let body = read_limited_body(provider, stage, response).await?;
    serde_json::from_slice(&body)
        .map_err(|error| provider_error(provider, &format!("{stage}.parse"), error.to_string()))
}

async fn read_limited_body(
    provider: &str,
    stage: &str,
    mut response: reqwest::Response,
) -> Result<Vec<u8>, LyricsProviderError> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err(size_error(provider, stage));
    }
    let mut body = Vec::new();
    loop {
        let chunk = response.chunk().await.map_err(|error| {
            provider_error(provider, &format!("{stage}.body"), error.to_string())
        })?;
        let Some(chunk) = chunk else {
            return Ok(body);
        };
        append_limited_chunk(provider, stage, &mut body, &chunk)?;
    }
}

fn append_limited_chunk(
    provider: &str,
    stage: &str,
    body: &mut Vec<u8>,
    chunk: &[u8],
) -> Result<(), LyricsProviderError> {
    let next_size = body.len().saturating_add(chunk.len());
    if next_size > MAX_RESPONSE_BYTES {
        return Err(size_error(provider, stage));
    }
    body.extend_from_slice(chunk);
    Ok(())
}

fn size_error(provider: &str, stage: &str) -> LyricsProviderError {
    provider_error(
        provider,
        &format!("{stage}.response_size"),
        "响应体超过 512 KiB 上限".to_string(),
    )
}

fn provider_error(provider: &str, stage: &str, message: String) -> LyricsProviderError {
    LyricsProviderError::with_message(provider, stage, message)
}

#[cfg(test)]
#[path = "provider_http_tests.rs"]
mod tests;

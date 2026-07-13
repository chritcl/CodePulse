use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use super::cache::LyricsCacheRepository;
use super::matcher::{build_track_identity, build_track_key};
use super::providers::{production_providers, LyricsProvider};
use super::types::{
    LyricsErrorCode, LyricsResponse, LyricsSource, LyricsStatus, LyricsTrackRequest,
    ProviderLyrics, TrackIdentity,
};

const HTTP_TIMEOUT: Duration = Duration::from_secs(3);
const QUERY_DEADLINE: Duration = Duration::from_secs(8);
const CACHE_TTL: Duration = Duration::from_secs(30 * 24 * 60 * 60);

/// 统一歌词查询服务
pub struct LyricsService {
    _client: reqwest::Client,
    providers: Vec<Arc<dyn LyricsProvider>>,
    cache: LyricsCacheRepository,
    deadline: Duration,
}

impl LyricsService {
    pub fn new(cache_dir: PathBuf) -> Result<Self, reqwest::Error> {
        let client = build_http_client()?;
        Ok(Self {
            providers: production_providers(&client),
            _client: client,
            cache: LyricsCacheRepository::new(cache_dir, CACHE_TTL),
            deadline: QUERY_DEADLINE,
        })
    }

    pub fn with_providers(
        providers: Vec<Arc<dyn LyricsProvider>>,
        cache: LyricsCacheRepository,
        deadline: Duration,
    ) -> Result<Self, reqwest::Error> {
        Ok(Self {
            _client: build_http_client()?,
            providers,
            cache,
            deadline,
        })
    }

    pub async fn get_lyrics(&self, request: LyricsTrackRequest) -> LyricsResponse {
        if request.title.trim().is_empty() {
            return error_response(String::new(), LyricsErrorCode::InvalidRequest, false);
        }
        let identity = build_track_identity(&request);
        let track_key = build_track_key(&identity);
        match tokio::time::timeout(
            self.deadline,
            self.resolve(request, identity, track_key.clone()),
        )
        .await
        {
            Ok(response) => response,
            Err(_) => error_response(track_key, LyricsErrorCode::Timeout, true),
        }
    }

    async fn resolve(
        &self,
        request: LyricsTrackRequest,
        identity: TrackIdentity,
        track_key: String,
    ) -> LyricsResponse {
        match self.read_cache(identity.clone(), track_key.clone()).await {
            Ok(Some(response)) => return response,
            Ok(None) => {}
            Err(error) => {
                eprintln!("[NSD] 读取歌词缓存失败: {error}");
                return error_response(track_key, LyricsErrorCode::Cache, false);
            }
        }
        let (best, had_error) = self.collect_providers(&request).await;
        let Some(lyrics) = best else {
            return missing_response(track_key, had_error);
        };
        self.write_cache(identity, track_key.clone(), lyrics.clone()).await;
        ready_response(track_key, lyrics)
    }

    async fn read_cache(
        &self,
        identity: TrackIdentity,
        track_key: String,
    ) -> Result<Option<LyricsResponse>, String> {
        let cache = self.cache.clone();
        tokio::task::spawn_blocking(move || cache.try_read(&identity, &track_key))
            .await
            .map_err(|error| error.to_string())?
            .map_err(|error| error.to_string())
    }

    async fn write_cache(
        &self,
        identity: TrackIdentity,
        track_key: String,
        lyrics: ProviderLyrics,
    ) {
        let cache = self.cache.clone();
        let result =
            tokio::task::spawn_blocking(move || cache.write(&identity, &track_key, &lyrics)).await;
        match result {
            Ok(Ok(())) => {}
            Ok(Err(error)) => eprintln!("[NSD] 保存歌词缓存失败: {error}"),
            Err(error) => eprintln!("[NSD] 歌词缓存任务失败: {error}"),
        }
    }

    async fn collect_providers(
        &self,
        request: &LyricsTrackRequest,
    ) -> (Option<ProviderLyrics>, bool) {
        let mut best: Option<ProviderLyrics> = None;
        let mut had_error = false;
        for provider in self.ordered_providers(request) {
            match provider.fetch(request).await {
                Ok(Some(candidate)) => keep_best(&mut best, candidate),
                Ok(None) => {}
                Err(error) => {
                    eprintln!("[NSD] {error}");
                    had_error = true;
                }
            }
        }
        (best, had_error)
    }

    fn ordered_providers(&self, request: &LyricsTrackRequest) -> Vec<Arc<dyn LyricsProvider>> {
        let preferred = request.player.as_deref().and_then(normalize_provider_name);
        let mut providers = self.providers.clone();
        providers.sort_by_key(|provider| usize::from(Some(provider.name()) != preferred));
        providers
    }

    #[cfg(test)]
    fn client_handle(&self) -> &reqwest::Client {
        &self._client
    }
}

fn build_http_client() -> Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder().timeout(HTTP_TIMEOUT).build()
}

fn normalize_provider_name(player: &str) -> Option<&'static str> {
    let normalized = player.to_ascii_lowercase();
    if normalized.contains("qq") {
        Some("qqmusic")
    } else if normalized.contains("netease") || normalized.contains("cloudmusic") {
        Some("netease")
    } else {
        None
    }
}

fn keep_best(best: &mut Option<ProviderLyrics>, candidate: ProviderLyrics) {
    if best.as_ref().is_none_or(|current| candidate.confidence > current.confidence) {
        *best = Some(candidate);
    }
}

fn ready_response(track_key: String, lyrics: ProviderLyrics) -> LyricsResponse {
    LyricsResponse {
        status: LyricsStatus::Ready,
        track_key,
        provider: lyrics.provider,
        source: LyricsSource::Online,
        confidence: lyrics.confidence,
        retryable: false,
        error_code: None,
        raw_lrc: lyrics.raw_lrc,
        lines: lyrics.lines,
    }
}

fn missing_response(track_key: String, had_error: bool) -> LyricsResponse {
    if had_error {
        error_response(track_key, LyricsErrorCode::Upstream, true)
    } else {
        LyricsResponse {
            status: LyricsStatus::NotFound,
            track_key,
            provider: "none".to_string(),
            source: LyricsSource::Online,
            confidence: 0.0,
            retryable: false,
            error_code: None,
            raw_lrc: None,
            lines: Vec::new(),
        }
    }
}

fn error_response(
    track_key: String,
    error_code: LyricsErrorCode,
    retryable: bool,
) -> LyricsResponse {
    LyricsResponse {
        status: LyricsStatus::Error,
        track_key,
        provider: "none".to_string(),
        source: LyricsSource::Online,
        confidence: 0.0,
        retryable,
        error_code: Some(error_code),
        raw_lrc: None,
        lines: Vec::new(),
    }
}

#[cfg(test)]
#[path = "service_tests.rs"]
mod tests;

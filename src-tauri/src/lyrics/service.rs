use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use super::cache::LyricsCacheRepository;
use super::matcher::{build_track_identity, build_track_key};
use super::providers::{production_providers_from_arc, LyricsProvider};
use super::service_cache::{read_cache, write_cache_in_background, LyricsCache};
use super::types::{
    LyricsErrorCode, LyricsResponse, LyricsSource, LyricsStatus, LyricsTrackRequest,
    ProviderLyrics, TrackIdentity,
};

const HTTP_TIMEOUT: Duration = Duration::from_secs(3);
const QUERY_DEADLINE: Duration = Duration::from_secs(8);
const CACHE_TTL: Duration = Duration::from_secs(30 * 24 * 60 * 60);

/// 统一歌词查询服务
pub struct LyricsService {
    _client: Arc<reqwest::Client>,
    providers: Vec<Arc<dyn LyricsProvider>>,
    cache: Arc<dyn LyricsCache>,
    deadline: Duration,
}

impl LyricsService {
    pub fn new(cache_dir: PathBuf) -> Result<Self, reqwest::Error> {
        let client = Arc::new(build_http_client()?);
        Ok(Self {
            providers: production_providers_from_arc(client.clone()),
            _client: client,
            cache: Arc::new(LyricsCacheRepository::new(cache_dir, CACHE_TTL)),
            deadline: QUERY_DEADLINE,
        })
    }

    pub fn with_providers(
        providers: Vec<Arc<dyn LyricsProvider>>,
        cache: LyricsCacheRepository,
        deadline: Duration,
    ) -> Result<Self, reqwest::Error> {
        Self::with_cache(providers, Arc::new(cache), deadline)
    }

    fn with_cache(
        providers: Vec<Arc<dyn LyricsProvider>>,
        cache: Arc<dyn LyricsCache>,
        deadline: Duration,
    ) -> Result<Self, reqwest::Error> {
        Ok(Self {
            _client: Arc::new(build_http_client()?),
            providers,
            cache,
            deadline,
        })
    }

    #[cfg(test)]
    fn with_cache_for_test(
        providers: Vec<Arc<dyn LyricsProvider>>,
        cache: Arc<dyn LyricsCache>,
        deadline: Duration,
    ) -> Result<Self, reqwest::Error> {
        Self::with_cache(providers, cache, deadline)
    }

    pub async fn get_lyrics(&self, request: LyricsTrackRequest) -> LyricsResponse {
        if request.title.trim().is_empty() {
            return error_response(String::new(), LyricsErrorCode::InvalidRequest, false);
        }
        let identity = build_track_identity(&request);
        let track_key = build_track_key(&identity);
        let deadline = tokio::time::Instant::now() + self.deadline;
        let cached = tokio::time::timeout_at(
            deadline,
            read_cache(self.cache.clone(), identity.clone(), track_key.clone()),
        )
        .await;
        match cached {
            Ok(Ok(Some(response))) => response,
            Ok(Ok(None)) => self.resolve(request, identity, track_key, deadline).await,
            Ok(Err(error)) => {
                eprintln!("[NSD] 读取歌词缓存失败: {error}");
                error_response(track_key, LyricsErrorCode::Cache, false)
            }
            Err(_) => error_response(track_key, LyricsErrorCode::Timeout, true),
        }
    }

    async fn resolve(
        &self,
        request: LyricsTrackRequest,
        identity: TrackIdentity,
        track_key: String,
        deadline: tokio::time::Instant,
    ) -> LyricsResponse {
        let collected = self.collect_providers(&request, deadline).await;
        if let Some(lyrics) = collected.best {
            write_cache_in_background(
                self.cache.clone(),
                identity,
                track_key.clone(),
                lyrics.clone(),
            );
            return ready_response(track_key, lyrics);
        }
        if collected.timed_out {
            error_response(track_key, LyricsErrorCode::Timeout, true)
        } else {
            missing_response(track_key, collected.had_error)
        }
    }

    async fn collect_providers(
        &self,
        request: &LyricsTrackRequest,
        deadline: tokio::time::Instant,
    ) -> ProviderCollection {
        let mut best: Option<ProviderLyrics> = None;
        let mut had_error = false;
        for provider in self.ordered_providers(request) {
            match tokio::time::timeout_at(deadline, provider.fetch(request)).await {
                Ok(Ok(Some(candidate))) => keep_best(&mut best, candidate),
                Ok(Ok(None)) => {}
                Ok(Err(error)) => {
                    eprintln!("[NSD] {error}");
                    had_error = true;
                }
                Err(_) => return ProviderCollection::timed_out(best, had_error),
            }
        }
        ProviderCollection {
            best,
            had_error,
            timed_out: false,
        }
    }

    fn ordered_providers(&self, request: &LyricsTrackRequest) -> Vec<Arc<dyn LyricsProvider>> {
        let preferred = request.player.as_deref().and_then(normalize_provider_name);
        let mut providers = self.providers.clone();
        providers.sort_by_key(|provider| usize::from(Some(provider.name()) != preferred));
        providers
    }
}

struct ProviderCollection {
    best: Option<ProviderLyrics>,
    had_error: bool,
    timed_out: bool,
}

impl ProviderCollection {
    fn timed_out(best: Option<ProviderLyrics>, had_error: bool) -> Self {
        Self {
            best,
            had_error,
            timed_out: true,
        }
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

#[cfg(test)]
#[path = "service_regression_tests.rs"]
mod regression_tests;

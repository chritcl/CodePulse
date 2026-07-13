use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use async_trait::async_trait;

use super::*;
use crate::lyrics::cache::LyricsCacheRepository;
use crate::lyrics::error::LyricsProviderError;
use crate::lyrics::providers::LyricsProvider;
use crate::lyrics::types::{
    LyricLine, LyricsErrorCode, LyricsStatus, LyricsTrackRequest, ProviderLyrics,
};

struct FakeProvider {
    name: &'static str,
    result: Mutex<Option<Result<Option<ProviderLyrics>, LyricsProviderError>>>,
    delay: Duration,
    calls: Arc<Mutex<Vec<&'static str>>>,
}

#[async_trait]
impl LyricsProvider for FakeProvider {
    fn name(&self) -> &'static str {
        self.name
    }

    async fn fetch(
        &self,
        _request: &LyricsTrackRequest,
    ) -> Result<Option<ProviderLyrics>, LyricsProviderError> {
        self.calls.lock().unwrap().push(self.name);
        if !self.delay.is_zero() {
            tokio::time::sleep(self.delay).await;
        }
        self.result.lock().unwrap().take().unwrap()
    }
}

fn fake_provider(
    name: &'static str,
    result: Result<Option<ProviderLyrics>, LyricsProviderError>,
) -> Arc<dyn LyricsProvider> {
    recording_provider(
        name,
        result,
        Duration::ZERO,
        Arc::new(Mutex::new(Vec::new())),
    )
}

fn recording_provider(
    name: &'static str,
    result: Result<Option<ProviderLyrics>, LyricsProviderError>,
    delay: Duration,
    calls: Arc<Mutex<Vec<&'static str>>>,
) -> Arc<dyn LyricsProvider> {
    Arc::new(FakeProvider {
        name,
        result: Mutex::new(Some(result)),
        delay,
        calls,
    })
}

fn request() -> LyricsTrackRequest {
    LyricsTrackRequest {
        title: "晴天".to_string(),
        artist: "周杰伦".to_string(),
        album: Some("叶惠美".to_string()),
        duration_ms: Some(269_000),
        player: Some("qqmusic".to_string()),
    }
}

fn lyrics(provider: &str, confidence: f32) -> ProviderLyrics {
    ProviderLyrics {
        provider: provider.to_string(),
        confidence,
        raw_lrc: Some("[00:00.00]第一句".to_string()),
        lines: vec![LyricLine {
            index: 0,
            start_ms: Some(0),
            end_ms: None,
            text: "第一句".to_string(),
            translation: None,
        }],
    }
}

fn service_with(providers: Vec<Arc<dyn LyricsProvider>>) -> LyricsService {
    service_with_deadline(providers, Duration::from_secs(8))
}

fn service_with_deadline(
    providers: Vec<Arc<dyn LyricsProvider>>,
    deadline: Duration,
) -> LyricsService {
    LyricsService::with_providers(
        providers,
        LyricsCacheRepository::new(unique_temp_dir("service"), Duration::from_secs(60)),
        deadline,
    )
    .unwrap()
}

fn unique_temp_dir(label: &str) -> PathBuf {
    let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    std::env::temp_dir().join(format!("nsd-lyrics-{label}-{nonce}"))
}

#[tokio::test]
async fn returns_not_found_only_when_all_providers_miss() {
    let service = service_with(vec![
        fake_provider("qqmusic", Ok(None)),
        fake_provider("netease", Ok(None)),
    ]);
    let response = service.get_lyrics(request()).await;

    assert_eq!(response.status, LyricsStatus::NotFound);
    assert!(!response.retryable);
    assert_eq!(response.error_code, None);
}

#[tokio::test]
async fn keeps_ready_result_when_another_provider_fails() {
    let service = service_with(vec![
        fake_provider(
            "qqmusic",
            Err(LyricsProviderError::upstream("qqmusic", "search")),
        ),
        fake_provider("netease", Ok(Some(lyrics("netease", 0.96)))),
    ]);

    assert_eq!(
        service.get_lyrics(request()).await.status,
        LyricsStatus::Ready
    );
}

#[tokio::test]
async fn returns_retryable_error_when_no_provider_hits_and_one_fails() {
    let service = service_with(vec![
        fake_provider(
            "qqmusic",
            Err(LyricsProviderError::upstream("qqmusic", "search")),
        ),
        fake_provider("netease", Ok(None)),
    ]);
    let response = service.get_lyrics(request()).await;

    assert_eq!(response.status, LyricsStatus::Error);
    assert!(response.retryable);
    assert_eq!(response.error_code, Some(LyricsErrorCode::Upstream));
}

#[tokio::test]
async fn picks_global_highest_confidence_after_collecting_all_hits() {
    let service = service_with(vec![
        fake_provider("qqmusic", Ok(Some(lyrics("qqmusic", 0.82)))),
        fake_provider("netease", Ok(Some(lyrics("netease", 0.97)))),
    ]);
    let response = service.get_lyrics(request()).await;

    assert_eq!(response.provider, "netease");
    assert_eq!(response.confidence, 0.97);
}

#[tokio::test]
async fn preferred_player_provider_runs_first_without_skipping_others() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let service = service_with(vec![
        recording_provider("netease", Ok(None), Duration::ZERO, calls.clone()),
        recording_provider("qqmusic", Ok(None), Duration::ZERO, calls.clone()),
    ]);

    service.get_lyrics(request()).await;

    assert_eq!(*calls.lock().unwrap(), vec!["qqmusic", "netease"]);
}

#[tokio::test]
async fn returns_timeout_when_collection_exceeds_total_deadline() {
    let service = service_with_deadline(
        vec![recording_provider(
            "qqmusic",
            Ok(None),
            Duration::from_millis(80),
            Arc::new(Mutex::new(Vec::new())),
        )],
        Duration::from_millis(10),
    );
    let response = service.get_lyrics(request()).await;

    assert_eq!(response.status, LyricsStatus::Error);
    assert_eq!(response.error_code, Some(LyricsErrorCode::Timeout));
    assert!(response.retryable);
}

#[tokio::test]
async fn rejects_blank_title_without_calling_provider() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let provider = recording_provider("qqmusic", Ok(None), Duration::ZERO, calls.clone());
    let service = service_with(vec![provider]);
    let response = service
        .get_lyrics(LyricsTrackRequest {
            title: " \t".to_string(),
            ..request()
        })
        .await;

    assert_eq!(response.error_code, Some(LyricsErrorCode::InvalidRequest));
    assert!(!response.retryable);
    assert!(calls.lock().unwrap().is_empty());
}

#[test]
fn one_service_reuses_the_same_http_client_handle() {
    let service = service_with(Vec::new());

    assert!(std::ptr::eq(
        service.client_handle(),
        service.client_handle()
    ));
}

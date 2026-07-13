use std::io;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;

use super::*;
use crate::lyrics::error::LyricsProviderError;
use crate::lyrics::providers::LyricsProvider;
use crate::lyrics::types::{
    LyricLine, LyricsResponse, LyricsStatus, LyricsTrackRequest, ProviderLyrics, TrackIdentity,
};

struct ReadyProvider;

#[async_trait]
impl LyricsProvider for ReadyProvider {
    fn name(&self) -> &'static str {
        "qqmusic"
    }

    async fn fetch(
        &self,
        _request: &LyricsTrackRequest,
    ) -> Result<Option<ProviderLyrics>, LyricsProviderError> {
        Ok(Some(ProviderLyrics {
            provider: "qqmusic".to_string(),
            confidence: 0.95,
            raw_lrc: Some("[00:00.00]第一句".to_string()),
            lines: vec![LyricLine {
                index: 0,
                start_ms: Some(0),
                end_ms: None,
                text: "第一句".to_string(),
                translation: None,
            }],
        }))
    }
}

struct SlowCache {
    write_started: Arc<AtomicBool>,
}

impl LyricsCache for SlowCache {
    fn read(
        &self,
        _identity: &TrackIdentity,
        _track_key: &str,
    ) -> io::Result<Option<LyricsResponse>> {
        Ok(None)
    }

    fn write(
        &self,
        _identity: &TrackIdentity,
        _track_key: &str,
        _lyrics: &ProviderLyrics,
    ) -> io::Result<()> {
        self.write_started.store(true, Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(200));
        Ok(())
    }
}

fn request() -> LyricsTrackRequest {
    LyricsTrackRequest {
        title: "晴天".to_string(),
        artist: "周杰伦".to_string(),
        album: None,
        duration_ms: Some(269_000),
        player: Some("qqmusic".to_string()),
    }
}

#[tokio::test]
async fn slow_cache_write_does_not_delay_ready_response() {
    let write_started = Arc::new(AtomicBool::new(false));
    let service = LyricsService::with_cache_for_test(
        vec![Arc::new(ReadyProvider)],
        Arc::new(SlowCache {
            write_started: write_started.clone(),
        }),
        Duration::from_millis(10),
    )
    .unwrap();

    let response = tokio::time::timeout(Duration::from_millis(50), service.get_lyrics(request()))
        .await
        .expect("歌词命中不应等待慢缓存写入");

    assert_eq!(response.status, LyricsStatus::Ready);
    tokio::time::timeout(Duration::from_millis(50), async {
        while !write_started.load(Ordering::SeqCst) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("后台缓存写入应被调度");
}

mod netease;
mod qq_music;

use std::sync::Arc;

use async_trait::async_trait;

use super::error::LyricsProviderError;
use super::matcher::{is_confident_match, score_candidate};
use super::types::{LyricsCandidate, LyricsTrackRequest, ProviderLyrics};
use netease::NeteaseProvider;
use qq_music::QqMusicProvider;

const USER_AGENT: &str = "NetSpeedDynamic/2.3.8 (https://github.com/GEORGEWWWU/NetSpeed-Dynamic)";

/// 可注入的歌词源契约
#[async_trait]
pub trait LyricsProvider: Send + Sync {
    fn name(&self) -> &'static str;

    async fn fetch(
        &self,
        request: &LyricsTrackRequest,
    ) -> Result<Option<ProviderLyrics>, LyricsProviderError>;
}

/// 创建共享同一 HTTP 客户端的生产歌词源
pub fn production_providers(client: &reqwest::Client) -> Vec<Arc<dyn LyricsProvider>> {
    vec![
        Arc::new(QqMusicProvider::new(client.clone())),
        Arc::new(NeteaseProvider::new(client.clone())),
    ]
}

pub(super) fn build_query(request: &LyricsTrackRequest) -> String {
    if request.artist.trim().is_empty() {
        request.title.trim().to_string()
    } else {
        format!("{} {}", request.title.trim(), request.artist.trim())
    }
}

pub(super) fn pick_best_candidate(
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

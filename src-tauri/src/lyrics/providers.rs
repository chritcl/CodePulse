mod netease;
mod qq_music;

use super::matcher::{is_confident_match, score_candidate};
use super::types::{LyricsCandidate, LyricsTrackRequest, ProviderLyrics};

const USER_AGENT: &str = "NetSpeedDynamic/2.3.8 (https://github.com/GEORGEWWWU/NetSpeed-Dynamic)";

type ProviderResult = Result<Option<ProviderLyrics>, String>;

/// 按固定优先级获取可同步歌词
pub async fn fetch_online_lyrics(
    request: &LyricsTrackRequest,
    client: &reqwest::Client,
) -> ProviderResult {
    let mut last_error = None;

    for provider in provider_order() {
        let result = match provider {
            ProviderKind::QqMusic => qq_music::fetch(request, client).await,
            ProviderKind::Netease => netease::fetch(request, client).await,
        };

        match result {
            Ok(Some(lyrics)) => return Ok(Some(lyrics)),
            Ok(None) => {}
            Err(err) => {
                eprintln!("[NSD] 歌词源 {} 查询失败: {}", provider.name(), err);
                last_error = Some(err);
            }
        }
    }

    if let Some(err) = last_error {
        eprintln!("[NSD] 在线歌词查询未命中，最后错误: {}", err);
    }

    Ok(None)
}

#[derive(Clone, Copy)]
enum ProviderKind {
    QqMusic,
    Netease,
}

impl ProviderKind {
    fn name(self) -> &'static str {
        match self {
            Self::QqMusic => "qqmusic",
            Self::Netease => "netease",
        }
    }
}

fn provider_order() -> [ProviderKind; 2] {
    [ProviderKind::QqMusic, ProviderKind::Netease]
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn always_queries_qq_music_before_netease() {
        let names = provider_order()
            .iter()
            .map(|provider| provider.name())
            .collect::<Vec<_>>();

        assert_eq!(names, vec!["qqmusic", "netease"]);
    }
}

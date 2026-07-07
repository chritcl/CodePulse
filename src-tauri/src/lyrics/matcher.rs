use std::collections::HashSet;

use super::types::{LyricsCandidate, LyricsTrackRequest};

const FNV_OFFSET: u64 = 0xcbf29ce484222325;
const FNV_PRIME: u64 = 0x100000001b3;

/// 构建稳定的歌曲缓存键
pub fn build_track_key(request: &LyricsTrackRequest) -> String {
    let duration_bucket = request.duration_ms.map(|value| value / 1000).unwrap_or(0);
    let album = request.album.as_deref().unwrap_or_default();
    let payload = format!(
        "{}|{}|{}|{}",
        normalize_text(&request.title),
        normalize_text(&request.artist),
        normalize_text(album),
        duration_bucket
    );

    format!("{:016x}", fnv1a(payload.as_bytes()))
}

/// 计算候选匹配分
pub fn score_candidate(request: &LyricsTrackRequest, candidate: &LyricsCandidate) -> f32 {
    let has_duration = request.duration_ms.is_some() && candidate.duration_ms.is_some();
    let title_score = text_similarity(&request.title, &candidate.title);
    let artist_score = artist_similarity(&request.artist, &candidate.artist);
    let duration_score = duration_similarity(request.duration_ms, candidate.duration_ms);

    if has_duration {
        title_score * 0.50 + artist_score * 0.30 + duration_score * 0.20
    } else {
        title_score * 0.60 + artist_score * 0.40
    }
}

/// 判断候选是否可信
pub fn is_confident_match(request: &LyricsTrackRequest, candidate: &LyricsCandidate) -> bool {
    let score = score_candidate(request, candidate);
    if request.duration_ms.is_some() && candidate.duration_ms.is_some() {
        score >= 0.82
    } else {
        score >= 0.90
    }
}

fn fnv1a(bytes: &[u8]) -> u64 {
    bytes.iter().fold(FNV_OFFSET, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(FNV_PRIME)
    })
}

fn normalize_text(value: &str) -> String {
    value
        .chars()
        .flat_map(char::to_lowercase)
        .filter(|ch| {
            let ch = *ch;
            !ch.is_whitespace()
                && !matches!(
                    ch,
                    '-' | '_'
                        | '.'
                        | '·'
                        | ','
                        | '，'
                        | '。'
                        | '、'
                        | '('
                        | ')'
                        | '（'
                        | '）'
                        | '['
                        | ']'
                        | '【'
                        | '】'
                        | '"'
                        | '\''
                        | '“'
                        | '”'
                        | ':'
                        | '：'
                )
        })
        .collect()
}

fn text_similarity(left: &str, right: &str) -> f32 {
    let left = normalize_text(left);
    let right = normalize_text(right);

    if left.is_empty() || right.is_empty() {
        return 0.0;
    }

    if left == right {
        return 1.0;
    }

    if left.contains(&right) || right.contains(&left) {
        return 0.88;
    }

    char_jaccard(&left, &right)
}

fn artist_similarity(left: &str, right: &str) -> f32 {
    let left = normalize_text(left);
    let right = normalize_text(right);

    if left.is_empty() || right.is_empty() {
        return 0.0;
    }

    if left == right {
        return 1.0;
    }

    let artists = right
        .split(|ch| matches!(ch, '/' | '&' | '、' | ';' | '；'))
        .map(normalize_text)
        .collect::<Vec<_>>();

    if artists.iter().any(|artist| artist == &left) {
        return 0.94;
    }

    if right.contains(&left) || left.contains(&right) {
        return 0.72;
    }

    char_jaccard(&left, &right)
}

fn duration_similarity(left: Option<u64>, right: Option<u64>) -> f32 {
    let (Some(left), Some(right)) = (left, right) else {
        return 0.0;
    };

    let diff = left.abs_diff(right);
    if diff <= 5_000 {
        1.0
    } else if diff <= 15_000 {
        0.65
    } else if diff <= 30_000 {
        0.35
    } else {
        0.0
    }
}

fn char_jaccard(left: &str, right: &str) -> f32 {
    let left_chars = left.chars().collect::<HashSet<_>>();
    let right_chars = right.chars().collect::<HashSet<_>>();

    if left_chars.is_empty() || right_chars.is_empty() {
        return 0.0;
    }

    let intersection = left_chars.intersection(&right_chars).count() as f32;
    let union = left_chars.union(&right_chars).count() as f32;
    intersection / union
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(duration_ms: Option<u64>) -> LyricsTrackRequest {
        LyricsTrackRequest {
            title: "晴天".to_string(),
            artist: "周杰伦".to_string(),
            album: Some("叶惠美".to_string()),
            duration_ms,
            player: Some("netease".to_string()),
        }
    }

    #[test]
    fn track_key_is_stable_for_same_track() {
        let first = build_track_key(&request(Some(269_000)));
        let second = build_track_key(&request(Some(269_000)));

        assert_eq!(first, second);
    }

    #[test]
    fn track_key_changes_for_different_track() {
        let mut changed = request(Some(269_000));
        changed.title = "夜曲".to_string();

        assert_ne!(
            build_track_key(&request(Some(269_000))),
            build_track_key(&changed)
        );
    }

    #[test]
    fn accepts_candidate_with_matching_duration() {
        let candidate = LyricsCandidate {
            title: "晴天".to_string(),
            artist: "周杰伦".to_string(),
            duration_ms: Some(269_000),
            id: "1".to_string(),
        };

        assert!(is_confident_match(&request(Some(269_000)), &candidate));
    }

    #[test]
    fn rejects_same_title_with_bad_duration_and_mixed_artist() {
        let candidate = LyricsCandidate {
            title: "晴天".to_string(),
            artist: "周杰伦-/A-LNK".to_string(),
            duration_ms: Some(182_890),
            id: "2".to_string(),
        };

        assert!(!is_confident_match(&request(Some(269_000)), &candidate));
    }
}

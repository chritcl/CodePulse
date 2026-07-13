use sha2::{Digest, Sha256};

use super::types::{LyricsCandidate, LyricsTrackRequest, TrackIdentity};

const DURATION_BUCKET_MS: u64 = 5_000;

/// 为缓存键提供规范化歌曲身份
pub trait TrackKeySource {
    fn track_identity(&self) -> TrackIdentity;
}

impl TrackKeySource for LyricsTrackRequest {
    fn track_identity(&self) -> TrackIdentity {
        build_track_identity(self)
    }
}

impl TrackKeySource for TrackIdentity {
    fn track_identity(&self) -> TrackIdentity {
        self.clone()
    }
}

/// 构建规范化歌曲身份
pub fn build_track_identity(request: &LyricsTrackRequest) -> TrackIdentity {
    TrackIdentity {
        normalized_title: normalize_text(&request.title),
        normalized_artist: normalize_text(&request.artist),
        normalized_album: normalize_text(request.album.as_deref().unwrap_or_default()),
        duration_bucket_ms: request
            .duration_ms
            .map(|value| value / DURATION_BUCKET_MS * DURATION_BUCKET_MS)
            .unwrap_or_default(),
    }
}

/// 构建稳定的歌曲缓存键
pub fn build_track_key(source: &(impl TrackKeySource + ?Sized)) -> String {
    let identity = source.track_identity();
    let payload = format!(
        "{}|{}|{}|{}",
        identity.normalized_title,
        identity.normalized_artist,
        identity.normalized_album,
        identity.duration_bucket_ms
    );

    format!("{:x}", Sha256::digest(payload.as_bytes()))
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
    let title_score = text_similarity(&request.title, &candidate.title);
    let artist_score = artist_similarity(&request.artist, &candidate.artist);
    let duration_score = duration_similarity(request.duration_ms, candidate.duration_ms);
    let has_duration = request.duration_ms.is_some() && candidate.duration_ms.is_some();
    let has_artists = !normalize_text(&request.artist).is_empty()
        && !normalize_text(&candidate.artist).is_empty();

    if has_artists && artist_score < 0.55 {
        return false;
    }

    if has_duration && duration_score == 0.0 {
        return false;
    }

    let is_strict_match = if has_duration {
        score >= 0.82
    } else {
        score >= 0.90
    };
    if is_strict_match {
        return true;
    }

    title_score >= 0.88 && (artist_score >= 0.72 || (has_duration && duration_score >= 0.65))
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

    ordered_similarity(&left, &right)
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

    let artists = right.split(['/', '&', '、', ';', '；']).map(normalize_text).collect::<Vec<_>>();

    if artists.iter().any(|artist| artist == &left) {
        return 0.94;
    }

    if right.contains(&left) || left.contains(&right) {
        return 0.72;
    }

    ordered_similarity(&left, &right)
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

fn ordered_similarity(left: &str, right: &str) -> f32 {
    let left_chars = left.chars().collect::<Vec<_>>();
    let right_chars = right.chars().collect::<Vec<_>>();
    let mut previous = (0..=right_chars.len()).collect::<Vec<_>>();
    let mut current = vec![0; right_chars.len() + 1];

    for (left_index, left_char) in left_chars.iter().enumerate() {
        current[0] = left_index + 1;
        for (right_index, right_char) in right_chars.iter().enumerate() {
            let substitution = previous[right_index] + usize::from(left_char != right_char);
            let insertion = current[right_index] + 1;
            let deletion = previous[right_index + 1] + 1;
            current[right_index + 1] = substitution.min(insertion).min(deletion);
        }
        std::mem::swap(&mut previous, &mut current);
    }

    let length = left_chars.len().max(right_chars.len());
    1.0 - previous[right_chars.len()] as f32 / length as f32
}

#[cfg(test)]
#[path = "matcher_tests.rs"]
mod tests;

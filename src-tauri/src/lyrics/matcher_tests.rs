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
    let identity = build_track_identity(&request(Some(269_000)));
    let first = build_track_key(&identity);
    let second = build_track_key(&identity);

    assert_eq!(first, second);
    assert_eq!(first.len(), 64);
    assert!(first.chars().all(|ch| ch.is_ascii_hexdigit()));
}

#[test]
fn track_key_changes_for_different_track() {
    let mut changed = request(Some(269_000));
    changed.title = "夜曲".to_string();

    assert_ne!(
        build_track_key(&build_track_identity(&request(Some(269_000)))),
        build_track_key(&build_track_identity(&changed))
    );
}

#[test]
fn track_key_preserves_identity_field_boundaries() {
    let left = TrackIdentity {
        normalized_title: "a|b".to_string(),
        normalized_artist: "c".to_string(),
        normalized_album: String::new(),
        duration_bucket_ms: 0,
    };
    let right = TrackIdentity {
        normalized_title: "a".to_string(),
        normalized_artist: "b|c".to_string(),
        normalized_album: String::new(),
        duration_bucket_ms: 0,
    };

    assert_ne!(build_track_key(&left), build_track_key(&right));
}

#[test]
fn builds_normalized_identity_with_five_second_duration_bucket() {
    let identity = build_track_identity(&request(Some(269_999)));

    assert_eq!(identity.normalized_title, "晴天");
    assert_eq!(identity.normalized_artist, "周杰伦");
    assert_eq!(identity.normalized_album, "叶惠美");
    assert_eq!(identity.duration_bucket_ms, 265_000);
}

#[test]
fn accepts_candidate_with_matching_duration() {
    let candidate = LyricsCandidate {
        title: "晴天".to_string(),
        artist: "周杰伦".to_string(),
        album: None,
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
        album: None,
        duration_ms: Some(182_890),
        id: "2".to_string(),
    };

    assert!(!is_confident_match(&request(Some(269_000)), &candidate));
}

#[test]
fn rejects_exact_title_and_duration_with_wrong_artist() {
    let candidate = LyricsCandidate {
        title: "晴天".to_string(),
        artist: "五月天".to_string(),
        album: None,
        duration_ms: Some(269_000),
        id: "wrong".to_string(),
    };

    assert!(!is_confident_match(&request(Some(269_000)), &candidate));
}

#[test]
fn preserves_character_order_in_title_similarity() {
    assert!(text_similarity("晴天", "天晴") < 0.8);
}

use super::*;

#[test]
fn accepts_response_chunk_at_exact_size_limit() {
    let mut body = vec![0; MAX_RESPONSE_BYTES - 1];

    append_limited_chunk("fake", "search", &mut body, &[1]).unwrap();

    assert_eq!(body.len(), MAX_RESPONSE_BYTES);
}

#[test]
fn rejects_response_chunk_over_size_limit_with_context() {
    let mut body = vec![0; MAX_RESPONSE_BYTES];

    let error = append_limited_chunk("fake", "lyrics", &mut body, &[1]).unwrap_err();

    assert_eq!(error.provider(), "fake");
    assert_eq!(error.stage(), "lyrics.response_size");
}

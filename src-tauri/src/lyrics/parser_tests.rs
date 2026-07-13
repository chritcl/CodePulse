use super::*;

#[test]
fn parses_timed_lrc_and_sets_end_time() {
    let lines = parse_lrc("[ti:标题]\n[00:12.30]第一句\n[00:16.800]第二句", None).unwrap();

    assert_eq!(lines.len(), 2);
    assert_eq!(lines[0].start_ms, Some(12_300));
    assert_eq!(lines[0].end_ms, Some(16_800));
    assert_eq!(lines[0].text, "第一句");
    assert_eq!(lines[1].start_ms, Some(16_800));
    assert_eq!(lines[1].end_ms, None);
}

#[test]
fn merges_translation_by_timestamp() {
    let lines = parse_lrc(
        "[00:01.00]Hello\n[00:02.00]World",
        Some("[00:01.00]你好\n[00:02.00]世界"),
    )
    .unwrap();

    assert_eq!(lines[0].translation.as_deref(), Some("你好"));
    assert_eq!(lines[1].translation.as_deref(), Some("世界"));
}

#[test]
fn parses_plain_lyrics_without_metadata() {
    let lines = parse_lrc("[ti:歌名]\n第一句\n第二句", None).unwrap();

    assert_eq!(lines.len(), 2);
    assert_eq!(lines[0].start_ms, None);
    assert_eq!(lines[0].text, "第一句");
    assert_eq!(lines[1].text, "第二句");
}

#[test]
fn supports_repeated_timestamp_tags() {
    let lines = parse_lrc("[00:01.00][00:03.50]重复歌词", None).unwrap();

    assert_eq!(lines.len(), 2);
    assert_eq!(lines[0].start_ms, Some(1_000));
    assert_eq!(lines[1].start_ms, Some(3_500));
}

#[test]
fn identifies_lyrics_without_timeline_as_unsynchronizable() {
    let lines = parse_lrc("[ti:标题]\n第一句\n第二句", None).unwrap();

    assert!(!has_timed_lines(&lines));
}

#[test]
fn applies_positive_and_negative_lrc_offset() {
    let positive = parse_lrc("  [offset:+250]\n[00:01.00]第一句", None).unwrap();
    let negative = parse_lrc("[offset:-250]\n[00:01.00]第一句", None).unwrap();

    assert_eq!(positive[0].start_ms, Some(1_250));
    assert_eq!(negative[0].start_ms, Some(750));
}

#[test]
fn rejects_malformed_timestamp_without_panicking() {
    assert!(parse_lrc("[999999999999999999999:99.1x2]异常", None).is_err());
}

#[test]
fn merges_translation_within_one_hundred_milliseconds() {
    let lines = parse_lrc("[00:01.00]Hello", Some("[00:01.08]你好")).unwrap();

    assert_eq!(lines[0].translation.as_deref(), Some("你好"));
}

#[test]
fn rejects_offset_underflow() {
    assert!(parse_lrc("[offset:-2000]\n[00:01.00]异常", None).is_err());
}

#[test]
fn rejects_more_than_two_thousand_lines() {
    let raw = std::iter::repeat_n("第一句", 2_001).collect::<Vec<_>>().join("\n");

    assert!(parse_lrc(&raw, None).is_err());
}

#[test]
fn rejects_line_longer_than_one_thousand_characters() {
    let raw = "歌".repeat(1_001);

    assert!(parse_lrc(&raw, None).is_err());
}

#[test]
fn rejects_oversized_translation_for_plain_lyrics() {
    let translation = std::iter::repeat_n("翻译", 2_001).collect::<Vec<_>>().join("\n");

    assert!(parse_lrc("纯文本歌词", Some(&translation)).is_err());
}

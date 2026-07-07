use std::collections::HashMap;

use super::types::LyricLine;

/// 解析 LRC 歌词和可选翻译歌词
pub fn parse_lrc(raw_lrc: &str, translation_lrc: Option<&str>) -> Vec<LyricLine> {
    let mut timed_lines = parse_timed_lrc(raw_lrc);

    if timed_lines.is_empty() {
        return parse_plain_lyrics(raw_lrc);
    }

    let translations = translation_lrc
        .map(parse_timed_lrc)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|line| line.start_ms.map(|start| (start, line.text)))
        .collect::<HashMap<_, _>>();

    let next_starts =
        timed_lines.iter().skip(1).filter_map(|line| line.start_ms).collect::<Vec<_>>();

    for (index, line) in timed_lines.iter_mut().enumerate() {
        line.index = index;
        line.end_ms = next_starts.get(index).copied();
        if let Some(start_ms) = line.start_ms {
            line.translation = translations.get(&start_ms).cloned().filter(|text| !text.is_empty());
        }
    }

    timed_lines
}

/// 解析无时间戳纯文本歌词
pub fn parse_plain_lyrics(raw: &str) -> Vec<LyricLine> {
    raw.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter(|line| !is_metadata_line(line))
        .enumerate()
        .map(|(index, text)| LyricLine {
            index,
            start_ms: None,
            end_ms: None,
            text: text.to_string(),
            translation: None,
        })
        .collect()
}

fn parse_timed_lrc(raw: &str) -> Vec<LyricLine> {
    let mut lines = Vec::new();

    for raw_line in raw.lines() {
        let raw_line = raw_line.trim();
        if raw_line.is_empty() || is_metadata_line(raw_line) {
            continue;
        }

        let (timestamps, text) = extract_timestamps(raw_line);
        if timestamps.is_empty() {
            continue;
        }

        let text = text.trim();
        if text.is_empty() {
            continue;
        }

        for start_ms in timestamps {
            lines.push(LyricLine {
                index: 0,
                start_ms: Some(start_ms),
                end_ms: None,
                text: text.to_string(),
                translation: None,
            });
        }
    }

    lines.sort_by_key(|line| line.start_ms.unwrap_or_default());
    lines
}

fn extract_timestamps(line: &str) -> (Vec<u64>, &str) {
    let mut timestamps = Vec::new();
    let mut cursor = 0;

    while let Some(rest) = line.get(cursor..) {
        if !rest.starts_with('[') {
            break;
        }

        let Some(end_offset) = rest.find(']') else {
            break;
        };

        let tag = &rest[1..end_offset];
        let Some(start_ms) = parse_timestamp(tag) else {
            break;
        };

        timestamps.push(start_ms);
        cursor += end_offset + 1;
    }

    (timestamps, line.get(cursor..).unwrap_or_default())
}

fn parse_timestamp(tag: &str) -> Option<u64> {
    let parts = tag.split(':').collect::<Vec<_>>();
    if !(2..=3).contains(&parts.len()) {
        return None;
    }

    let (hours, minutes, seconds_part) = if parts.len() == 3 {
        (
            parts[0].parse::<u64>().ok()?,
            parts[1].parse::<u64>().ok()?,
            parts[2],
        )
    } else {
        (0, parts[0].parse::<u64>().ok()?, parts[1])
    };

    let mut second_parts = seconds_part.splitn(2, '.');
    let seconds = second_parts.next()?.parse::<u64>().ok()?;
    let millis = second_parts.next().map(parse_fraction_ms).unwrap_or(0);

    Some(((hours * 3600 + minutes * 60 + seconds) * 1000) + millis)
}

fn parse_fraction_ms(fraction: &str) -> u64 {
    let mut value = fraction.chars().take(3).filter(|ch| ch.is_ascii_digit()).collect::<String>();

    while value.len() < 3 {
        value.push('0');
    }

    value.parse::<u64>().unwrap_or(0)
}

fn is_metadata_line(line: &str) -> bool {
    let Some(end) = line.find(']') else {
        return false;
    };

    if !line.starts_with('[') {
        return false;
    }

    parse_timestamp(&line[1..end]).is_none()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_timed_lrc_and_sets_end_time() {
        let lines = parse_lrc("[ti:标题]\n[00:12.30]第一句\n[00:16.800]第二句", None);

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
        );

        assert_eq!(lines[0].translation.as_deref(), Some("你好"));
        assert_eq!(lines[1].translation.as_deref(), Some("世界"));
    }

    #[test]
    fn parses_plain_lyrics_without_metadata() {
        let lines = parse_lrc("[ti:歌名]\n第一句\n第二句", None);

        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].start_ms, None);
        assert_eq!(lines[0].text, "第一句");
        assert_eq!(lines[1].text, "第二句");
    }

    #[test]
    fn supports_repeated_timestamp_tags() {
        let lines = parse_lrc("[00:01.00][00:03.50]重复歌词", None);

        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].start_ms, Some(1_000));
        assert_eq!(lines[1].start_ms, Some(3_500));
    }
}

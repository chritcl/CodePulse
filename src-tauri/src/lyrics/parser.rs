use std::fmt;

use super::types::LyricLine;

const MAX_LRC_LINES: usize = 2_000;
const MAX_LINE_CHARS: usize = 1_000;
const TRANSLATION_TOLERANCE_MS: u64 = 100;

/// 歌词解析错误
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LyricsParseError {
    TooManyLines,
    LineTooLong { line: usize },
    InvalidOffset { line: usize },
    InvalidTimestamp { line: usize },
    TimestampOverflow { line: usize },
    OffsetOverflow { line: usize },
}

impl fmt::Display for LyricsParseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TooManyLines => write!(formatter, "歌词超过 2000 行限制"),
            Self::LineTooLong { line } => write!(formatter, "歌词第 {line} 行超过 1000 字符限制"),
            Self::InvalidOffset { line } => write!(formatter, "歌词第 {line} 行偏移量无效"),
            Self::InvalidTimestamp { line } => write!(formatter, "歌词第 {line} 行时间戳无效"),
            Self::TimestampOverflow { line } => write!(formatter, "歌词第 {line} 行时间戳溢出"),
            Self::OffsetOverflow { line } => write!(formatter, "歌词第 {line} 行应用偏移量后溢出"),
        }
    }
}

impl std::error::Error for LyricsParseError {}

/// 解析带时间标签的歌词和可选翻译歌词
pub fn parse_lrc(
    raw_lrc: &str,
    translation_lrc: Option<&str>,
) -> Result<Vec<LyricLine>, LyricsParseError> {
    validate_input(raw_lrc)?;
    if let Some(raw) = translation_lrc {
        validate_input(raw)?;
    }
    let mut timed_lines = parse_timed_lrc(raw_lrc)?;

    if timed_lines.is_empty() {
        return Ok(parse_plain_lyrics(raw_lrc));
    }

    let translations = translation_lrc.map(parse_timed_lrc).transpose()?.unwrap_or_default();

    merge_translations(&mut timed_lines, &translations);
    set_line_metadata(&mut timed_lines);
    Ok(timed_lines)
}

fn set_line_metadata(lines: &mut [LyricLine]) {
    let next_starts = lines.iter().skip(1).filter_map(|line| line.start_ms).collect::<Vec<_>>();
    for (index, line) in lines.iter_mut().enumerate() {
        line.index = index;
        line.end_ms = next_starts.get(index).copied();
    }
}

fn merge_translations(lines: &mut [LyricLine], translations: &[LyricLine]) {
    for line in lines {
        let Some(start_ms) = line.start_ms else {
            continue;
        };
        line.translation = translations
            .iter()
            .filter_map(|translation| {
                let translation_start = translation.start_ms?;
                Some((
                    start_ms.abs_diff(translation_start),
                    translation.text.as_str(),
                ))
            })
            .filter(|(difference, text)| {
                *difference <= TRANSLATION_TOLERANCE_MS && !text.is_empty()
            })
            .min_by_key(|(difference, _)| *difference)
            .map(|(_, text)| text.to_string());
    }
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

/// 判断歌词行是否包含可用于播放时间线的时间戳
pub fn has_timed_lines(lines: &[LyricLine]) -> bool {
    lines.iter().any(|line| line.start_ms.is_some())
}

fn validate_input(raw: &str) -> Result<(), LyricsParseError> {
    for (index, line) in raw.lines().enumerate() {
        if index >= MAX_LRC_LINES {
            return Err(LyricsParseError::TooManyLines);
        }
        if line.chars().count() > MAX_LINE_CHARS {
            return Err(LyricsParseError::LineTooLong { line: index + 1 });
        }
    }
    Ok(())
}

fn parse_timed_lrc(raw: &str) -> Result<Vec<LyricLine>, LyricsParseError> {
    let mut lines = Vec::new();
    let offset = parse_offset(raw)?;

    for (index, raw_line) in raw.lines().enumerate() {
        let line_number = index + 1;
        let raw_line = raw_line.trim();
        if raw_line.is_empty() || is_metadata_line(raw_line) {
            continue;
        }

        let (timestamps, text) = extract_timestamps(raw_line, line_number)?;
        if timestamps.is_empty() {
            continue;
        }

        let text = text.trim();
        if text.is_empty() {
            continue;
        }

        for start_ms in timestamps {
            if lines.len() >= MAX_LRC_LINES {
                return Err(LyricsParseError::TooManyLines);
            }
            lines.push(LyricLine {
                index: 0,
                start_ms: Some(apply_offset(start_ms, offset, line_number)?),
                end_ms: None,
                text: text.to_string(),
                translation: None,
            });
        }
    }

    lines.sort_by_key(|line| line.start_ms.unwrap_or_default());
    Ok(lines)
}

fn parse_offset(raw: &str) -> Result<i64, LyricsParseError> {
    let mut offset = 0;
    for (index, line) in raw.lines().enumerate() {
        let line = line.trim();
        let Some(tag) =
            line.strip_prefix('[').and_then(|line| line.split_once(']').map(|(tag, _)| tag))
        else {
            continue;
        };
        let Some((name, value)) = tag.split_once(':') else {
            continue;
        };
        if name.eq_ignore_ascii_case("offset") {
            offset = value
                .parse::<i64>()
                .map_err(|_| LyricsParseError::InvalidOffset { line: index + 1 })?;
        }
    }
    Ok(offset)
}

fn extract_timestamps(
    line: &str,
    line_number: usize,
) -> Result<(Vec<u64>, &str), LyricsParseError> {
    let mut timestamps = Vec::new();
    let mut cursor = 0;

    while let Some(rest) = line.get(cursor..) {
        if !rest.starts_with('[') {
            break;
        }

        let Some(end_offset) = rest.find(']') else {
            return Err(LyricsParseError::InvalidTimestamp { line: line_number });
        };

        let tag = &rest[1..end_offset];
        if !looks_like_timestamp(tag) {
            break;
        }

        timestamps.push(parse_timestamp(tag, line_number)?);
        cursor += end_offset + 1;
    }

    Ok((timestamps, line.get(cursor..).unwrap_or_default()))
}

fn parse_timestamp(tag: &str, line: usize) -> Result<u64, LyricsParseError> {
    let parts = tag.split(':').collect::<Vec<_>>();
    if !(2..=3).contains(&parts.len()) {
        return Err(LyricsParseError::InvalidTimestamp { line });
    }

    let (hours, minutes, seconds_part) = if parts.len() == 3 {
        (
            parse_number(parts[0], line)?,
            parse_number(parts[1], line)?,
            parts[2],
        )
    } else {
        (0, parse_number(parts[0], line)?, parts[1])
    };

    let mut second_parts = seconds_part.splitn(2, '.');
    let seconds = parse_number(second_parts.next().unwrap_or_default(), line)?;
    if seconds >= 60 || (parts.len() == 3 && minutes >= 60) {
        return Err(LyricsParseError::InvalidTimestamp { line });
    }
    let millis = second_parts
        .next()
        .map(|value| parse_fraction_ms(value, line))
        .transpose()?
        .unwrap_or(0);
    hours
        .checked_mul(3_600)
        .and_then(|value| minutes.checked_mul(60).and_then(|minutes| value.checked_add(minutes)))
        .and_then(|value| value.checked_add(seconds))
        .and_then(|value| value.checked_mul(1_000))
        .and_then(|value| value.checked_add(millis))
        .ok_or(LyricsParseError::TimestampOverflow { line })
}

fn parse_number(value: &str, line: usize) -> Result<u64, LyricsParseError> {
    if value.is_empty() || !value.chars().all(|ch| ch.is_ascii_digit()) {
        return Err(LyricsParseError::InvalidTimestamp { line });
    }
    value.parse().map_err(|_| LyricsParseError::TimestampOverflow { line })
}

fn parse_fraction_ms(value: &str, line: usize) -> Result<u64, LyricsParseError> {
    if value.is_empty() || value.len() > 3 || !value.chars().all(|ch| ch.is_ascii_digit()) {
        return Err(LyricsParseError::InvalidTimestamp { line });
    }
    let fraction = parse_number(value, line)?;
    Ok(match value.len() {
        1 => fraction * 100,
        2 => fraction * 10,
        _ => fraction,
    })
}

fn apply_offset(start_ms: u64, offset: i64, line: usize) -> Result<u64, LyricsParseError> {
    if offset >= 0 {
        start_ms.checked_add(offset as u64)
    } else {
        start_ms.checked_sub(offset.unsigned_abs())
    }
    .ok_or(LyricsParseError::OffsetOverflow { line })
}

fn looks_like_timestamp(tag: &str) -> bool {
    tag.chars().next().is_some_and(|ch| ch.is_ascii_digit())
}

fn is_metadata_line(line: &str) -> bool {
    let Some(end) = line.find(']') else {
        return false;
    };

    if !line.starts_with('[') {
        return false;
    }

    !looks_like_timestamp(&line[1..end])
}

#[cfg(test)]
#[path = "parser_tests.rs"]
mod tests;

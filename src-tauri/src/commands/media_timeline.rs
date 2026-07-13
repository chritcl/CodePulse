/**
 * 媒体时间线
 *
 * 负责读取 SMTC 时间线并换算统一的毫秒时间锚点。
 */
use std::time::{SystemTime, UNIX_EPOCH};
use windows::Foundation::TimeSpan;
use windows::Media::Control::GlobalSystemMediaTransportControlsSession;

#[derive(Default)]
pub(super) struct TimelineSnapshot {
    pub(super) duration_ms: Option<u64>,
    pub(super) position_ms: Option<u64>,
    pub(super) timeline_updated_at_ms: Option<u64>,
}

pub(super) fn read_timeline_state(
    session: &GlobalSystemMediaTransportControlsSession,
) -> Option<TimelineSnapshot> {
    let timeline = session.GetTimelineProperties().ok()?;
    let start_ms = timeline.StartTime().ok().and_then(timespan_to_ms);
    let end_ms = timeline.EndTime().ok().and_then(timespan_to_ms);
    let position_ms = timeline.Position().ok().and_then(timespan_to_ms);
    let timeline_updated_at_ms = timeline
        .LastUpdatedTime()
        .ok()
        .and_then(|value| datetime_ticks_to_unix_ms(value.UniversalTime));

    Some(build_timeline_snapshot(
        start_ms,
        end_ms,
        position_ms,
        timeline_updated_at_ms,
    ))
}

fn build_timeline_snapshot(
    start_ms: Option<u64>,
    end_ms: Option<u64>,
    position_ms: Option<u64>,
    timeline_updated_at_ms: Option<u64>,
) -> TimelineSnapshot {
    let duration_ms = match (start_ms, end_ms) {
        (Some(start), Some(end)) if end > start => Some(end - start),
        _ => None,
    };
    let position_ms =
        position_ms.map(|position| position.saturating_sub(start_ms.unwrap_or_default()));

    TimelineSnapshot {
        duration_ms,
        position_ms,
        timeline_updated_at_ms,
    }
}

fn timespan_to_ms(value: TimeSpan) -> Option<u64> {
    if value.Duration < 0 {
        return None;
    }

    Some((value.Duration / 10_000) as u64)
}

fn datetime_ticks_to_unix_ms(value: i64) -> Option<u64> {
    const WINDOWS_UNIX_EPOCH_OFFSET_TICKS: i64 = 116_444_736_000_000_000;

    let ticks_since_unix_epoch = value.checked_sub(WINDOWS_UNIX_EPOCH_OFFSET_TICKS)?;
    if ticks_since_unix_epoch < 0 {
        return None;
    }

    Some((ticks_since_unix_epoch / 10_000) as u64)
}

pub(super) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

#[cfg(test)]
mod timeline_tests {
    use super::*;

    #[test]
    fn converts_windows_datetime_to_unix_milliseconds() {
        let unix_epoch_windows_ticks = 116_444_736_000_000_000_i64;
        assert_eq!(
            datetime_ticks_to_unix_ms(unix_epoch_windows_ticks + 12_345_000),
            Some(1_234)
        );
    }

    #[test]
    fn timeline_snapshot_keeps_source_update_time() {
        let snapshot = build_timeline_snapshot(Some(500), Some(10_500), Some(2_500), Some(42_000));

        assert_eq!(snapshot.duration_ms, Some(10_000));
        assert_eq!(snapshot.position_ms, Some(2_000));
        assert_eq!(snapshot.timeline_updated_at_ms, Some(42_000));
    }

    #[test]
    fn keeps_playback_position_when_duration_is_unavailable() {
        let snapshot = build_timeline_snapshot(Some(500), None, Some(1_500), None);

        assert_eq!(snapshot.position_ms, Some(1_000));
        assert_eq!(snapshot.duration_ms, None);
    }
}

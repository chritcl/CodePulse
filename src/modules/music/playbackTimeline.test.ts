import { describe, expect, it } from 'vitest';
import type { MusicPlaybackState } from '@/shared/ipc/contracts';
import { createPlaybackTimelineClock, isPlaybackProgressAvailable } from './playbackTimeline';

const playback = (patch: Partial<MusicPlaybackState> = {}): MusicPlaybackState => ({
  title: '晴天',
  artist: '周杰伦',
  album: '叶惠美',
  sourceAppId: 'qqmusic',
  player: 'qqmusic',
  isPlaying: true,
  canSeek: true,
  durationMs: 269_000,
  positionMs: 10_000,
  timelineUpdatedAtMs: 1_000,
  snapshotTakenAtMs: 1_000,
  ...patch,
});

describe('createPlaybackTimelineClock', () => {
  it('补偿 SMTC 锚点到前端接收时刻的延迟', () => {
    const clock = createPlaybackTimelineClock();
    clock.sync(
      playback({ positionMs: 10_000, timelineUpdatedAtMs: 1_000, snapshotTakenAtMs: 1_250 }),
      { epochMs: 1_300, monotonicMs: 500 }
    );

    expect(clock.getPosition(1_500)).toBe(11_300);
  });

  it('暂停五秒后从相同位置恢复不会前跳', () => {
    const clock = createPlaybackTimelineClock();
    clock.sync(playback({ positionMs: 10_000, timelineUpdatedAtMs: 1_000 }), {
      epochMs: 1_000,
      monotonicMs: 100,
    });
    clock.sync(playback({ isPlaying: false, positionMs: 12_000, timelineUpdatedAtMs: 3_000 }), {
      epochMs: 3_000,
      monotonicMs: 2_100,
    });
    clock.sync(playback({ isPlaying: true, positionMs: 12_000, timelineUpdatedAtMs: 8_000 }), {
      epochMs: 8_000,
      monotonicMs: 7_100,
    });

    expect(clock.getPosition(7_100)).toBe(12_000);
  });

  it('重复的源时间锚点仍按源时间推进', () => {
    const clock = createPlaybackTimelineClock();
    clock.sync(playback(), { epochMs: 1_000, monotonicMs: 100 });
    clock.sync(playback({ snapshotTakenAtMs: 3_000 }), {
      epochMs: 3_000,
      monotonicMs: 2_100,
    });

    expect(clock.getPosition(3_100)).toBe(13_000);
  });

  it('向前跳播超过阈值时立即重新锚定', () => {
    const clock = createPlaybackTimelineClock();
    clock.sync(playback(), { epochMs: 1_000, monotonicMs: 100 });
    clock.sync(playback({ positionMs: 20_000, timelineUpdatedAtMs: 2_000 }), {
      epochMs: 2_000,
      monotonicMs: 1_100,
    });

    expect(clock.getPosition(2_100)).toBe(21_000);
  });

  it('向后跳播超过阈值时立即重新锚定', () => {
    const clock = createPlaybackTimelineClock();
    clock.sync(playback(), { epochMs: 1_000, monotonicMs: 100 });
    clock.sync(playback({ positionMs: 4_000, timelineUpdatedAtMs: 2_000 }), {
      epochMs: 2_000,
      monotonicMs: 1_100,
    });

    expect(clock.getPosition(2_100)).toBe(5_000);
  });

  it('缺失源时间戳的重复静止位置不会拖慢本地时间线', () => {
    const clock = createPlaybackTimelineClock();
    clock.sync(playback({ timelineUpdatedAtMs: undefined }), {
      epochMs: 1_000,
      monotonicMs: 100,
    });
    clock.sync(playback({ timelineUpdatedAtMs: undefined, snapshotTakenAtMs: 3_000 }), {
      epochMs: 3_000,
      monotonicMs: 2_100,
    });

    expect(clock.getPosition(3_100)).toBe(13_000);
  });

  it('后续补全时长后会限制播放位置', () => {
    const clock = createPlaybackTimelineClock();
    clock.sync(playback({ durationMs: undefined }), { epochMs: 1_000, monotonicMs: 100 });
    clock.sync(playback({ durationMs: 12_000, positionMs: undefined }), {
      epochMs: 2_000,
      monotonicMs: 1_100,
    });

    expect(clock.getPosition(5_100)).toBe(12_000);
  });

  it('标记陈旧后冻结在当时的位置', () => {
    const clock = createPlaybackTimelineClock();
    clock.sync(playback(), { epochMs: 1_000, monotonicMs: 100 });

    clock.markStale(2_100);

    expect(clock.getPosition(7_100)).toBe(12_000);
  });

  it('系统墙钟跳变不会改变本地推进速度', () => {
    const clock = createPlaybackTimelineClock();
    clock.sync(playback(), { epochMs: 1_000, monotonicMs: 100 });
    clock.sync(playback({ snapshotTakenAtMs: 3_601_000 }), {
      epochMs: 3_601_000,
      monotonicMs: 1_100,
    });

    expect(clock.getPosition(2_100)).toBe(12_000);
  });

  it('重置后清除播放位置', () => {
    const clock = createPlaybackTimelineClock();
    clock.sync(playback(), { epochMs: 1_000, monotonicMs: 100 });

    clock.reset();

    expect(clock.getPosition(2_100)).toBeNull();
  });
});

describe('isPlaybackProgressAvailable', () => {
  it('会话就绪且播放器提供完整跳转信息时可显示进度条', () => {
    expect(isPlaybackProgressAvailable(playback(), 10_000, true)).toBe(true);
  });

  it.each([
    [playback({ canSeek: false }), 10_000, true],
    [playback({ durationMs: undefined }), 10_000, true],
    [playback({ durationMs: 0 }), 10_000, true],
    [playback(), null, true],
    [playback(), 10_000, false],
    [null, 10_000, true],
  ] as const)('跳转条件不完整时隐藏进度条', (snapshot, positionMs, sessionReady) => {
    expect(isPlaybackProgressAvailable(snapshot, positionMs, sessionReady)).toBe(false);
  });
});

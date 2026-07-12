import { describe, expect, it } from 'vitest';
import type { LyricLine, MusicPlaybackState } from '@/shared/ipc/contracts';
import {
  buildTrackIdentity,
  createLyricTimelineClock,
  estimatePlaybackPosition,
  resolveCurrentLyricLine,
} from './lyrics';

const playbackState = (patch: Partial<MusicPlaybackState> = {}): MusicPlaybackState => ({
  title: '晴天',
  artist: '周杰伦',
  album: '叶惠美',
  sourceAppId: 'qqmusic',
  player: 'qqmusic',
  isPlaying: true,
  durationMs: 269_000,
  positionMs: 12_000,
  timelineSampledAtMs: 1_000,
  ...patch,
});

const line = (index: number, startMs?: number): LyricLine => ({
  index,
  startMs,
  text: `第 ${index + 1} 句`,
});

describe('lyrics', () => {
  it('播放中位置随当前时间推进', () => {
    const position = estimatePlaybackPosition(playbackState(), 2_250);

    expect(position).toBe(13_250);
  });

  it('暂停时位置不继续推进', () => {
    const position = estimatePlaybackPosition(playbackState({ isPlaying: false }), 2_250);

    expect(position).toBe(12_000);
  });

  it('播放位置不会超过歌曲总时长', () => {
    const position = estimatePlaybackPosition(
      playbackState({ durationMs: 20_000, positionMs: 19_000 }),
      3_500
    );

    expect(position).toBe(20_000);
  });

  it('能解析当前歌词和下一句歌词', () => {
    const result = resolveCurrentLyricLine([line(0, 1_000), line(1, 5_000), line(2, 9_000)], 6_200);

    expect(result.currentLine?.text).toBe('第 2 句');
    expect(result.nextLine?.text).toBe('第 3 句');
  });

  it('无时间戳歌词不参与同步', () => {
    const result = resolveCurrentLyricLine([line(0), line(1)], 6_200);

    expect(result.currentLine).toBeNull();
    expect(result.nextLine).toBeNull();
  });

  it('曲目身份对同一首歌保持稳定', () => {
    expect(buildTrackIdentity(playbackState())).toBe(buildTrackIdentity(playbackState()));
    expect(buildTrackIdentity(playbackState())).not.toBe(
      buildTrackIdentity(playbackState({ title: '夜曲' }))
    );
  });

  it('播放中收到静止快照时持续推进本地时间线', () => {
    const clock = createLyricTimelineClock();
    const snapshot = playbackState({
      positionMs: 10_000,
      timelineSampledAtMs: 1_000,
    });

    clock.sync(snapshot, 1_000);
    clock.sync(snapshot, 3_000);

    expect(clock.getPosition(4_000)).toBe(13_000);
  });

  it('缺失位置的暂停快照会冻结在最近的本地位置', () => {
    const clock = createLyricTimelineClock();
    clock.sync(playbackState({ positionMs: 10_000 }), 1_000);
    clock.sync(playbackState({ isPlaying: false, positionMs: undefined }), 3_000);

    expect(clock.getPosition(4_000)).toBe(12_000);
  });

  it('播放位置发生明显变化时按跳播位置重新锚定', () => {
    const clock = createLyricTimelineClock();
    clock.sync(playbackState({ positionMs: 10_000 }), 1_000);
    clock.sync(playbackState({ positionMs: 4_000 }), 3_000);

    expect(clock.getPosition(4_000)).toBe(5_000);
  });
});

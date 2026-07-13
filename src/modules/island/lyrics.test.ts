import { describe, expect, it } from 'vitest';
import type { LyricLine, MusicPlaybackState } from '@/shared/ipc/contracts';
import {
  buildPlaybackSessionIdentity,
  buildTrackIdentity,
  normalizeLyricLines,
  resolveCurrentLyricLine,
} from './lyrics';

const playback = (patch: Partial<MusicPlaybackState> = {}): MusicPlaybackState => ({
  title: '晴天',
  artist: '周杰伦',
  album: '叶惠美',
  sourceAppId: 'qqmusic',
  player: 'qqmusic',
  isPlaying: true,
  durationMs: 269_000,
  positionMs: 12_000,
  timelineUpdatedAtMs: 1_000,
  snapshotTakenAtMs: 1_000,
  ...patch,
});

const lyric = (
  index: number,
  startMs?: number,
  endMs?: number,
  text = `第 ${index + 1} 句`
): LyricLine => ({
  index,
  startMs,
  endMs,
  text,
});

describe('lyrics', () => {
  it('专辑和时长补全不改变播放会话身份', () => {
    const initial = playback({ album: undefined, durationMs: undefined });
    const enriched = playback({ album: '叶惠美', durationMs: 269_000 });

    expect(buildPlaybackSessionIdentity(initial)).toBe(buildPlaybackSessionIdentity(enriched));
  });

  it('不同歌曲使用不同播放会话身份', () => {
    expect(buildPlaybackSessionIdentity(playback())).not.toBe(
      buildPlaybackSessionIdentity(playback({ title: '夜曲' }))
    );
  });

  it('空歌曲标题不生成播放会话身份', () => {
    expect(buildPlaybackSessionIdentity(playback({ title: '   ' }))).toBe('');
    expect(buildPlaybackSessionIdentity(null)).toBe('');
  });

  it('保留歌词请求使用的完整曲目身份', () => {
    expect(buildTrackIdentity(playback())).not.toBe(
      buildTrackIdentity(playback({ album: '十一月的萧邦' }))
    );
  });

  it('按开始时间和原始索引排序且不修改输入', () => {
    const input = [lyric(2, 5_000), lyric(1, 1_000), lyric(0, 1_000)];
    const original = input.map((line) => ({ ...line }));

    const lines = normalizeLyricLines(input);

    expect(lines.map((line) => line.index)).toEqual([0, 2]);
    expect(input).toEqual(original);
  });

  it('同一时间戳的不同文本只保留排序后的第一句', () => {
    const lines = normalizeLyricLines([
      lyric(2, 1_000, undefined, '后出现的文本'),
      lyric(1, 1_000, undefined, '应保留的文本'),
    ]);

    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe('应保留的文本');
  });

  it('过滤无效开始时间和空白文本', () => {
    const lines = normalizeLyricLines([
      lyric(0, undefined),
      lyric(1, Number.NaN),
      lyric(2, -1),
      lyric(3, 1_000, undefined, '   '),
      lyric(4, 2_000),
    ]);

    expect(lines.map((line) => line.index)).toEqual([4]);
  });

  it.each([Number.NaN, 1_000, 500])('无效结束时间 %s 会由下一句开始时间补全', (endMs) => {
    const lines = normalizeLyricLines([lyric(0, 1_000, endMs), lyric(1, 5_000)]);

    expect(lines[0]?.endMs).toBe(5_000);
  });

  it('最后一句缺失结束时间时保持开放区间', () => {
    const lines = normalizeLyricLines([lyric(0, 1_000)]);

    expect(lines[0]?.endMs).toBeUndefined();
    expect(resolveCurrentLyricLine(lines, 60_000).currentLine?.index).toBe(0);
  });

  it('能用播放位置解析当前歌词和下一句歌词', () => {
    const lines = normalizeLyricLines([lyric(0, 1_000), lyric(1, 5_000), lyric(2, 9_000)]);

    const result = resolveCurrentLyricLine(lines, 6_200);

    expect(result.currentLine?.text).toBe('第 2 句');
    expect(result.nextLine?.text).toBe('第 3 句');
  });

  it('会排序歌词并在结束时间后清空当前句', () => {
    const lines = normalizeLyricLines([lyric(1, 5_000, 7_000), lyric(0, 1_000, 2_000)]);

    const result = resolveCurrentLyricLine(lines, 3_000);

    expect(result.currentLine).toBeNull();
    expect(result.nextLine?.index).toBe(1);
  });

  it('歌词结束边界属于后续间隙', () => {
    const lines = normalizeLyricLines([lyric(0, 1_000, 2_000), lyric(1, 5_000, 7_000)]);

    expect(resolveCurrentLyricLine(lines, 2_000).currentLine).toBeNull();
  });

  it('首句开始前仅返回下一句', () => {
    const lines = normalizeLyricLines([lyric(0, 1_000), lyric(1, 5_000)]);

    const result = resolveCurrentLyricLine(lines, 500);

    expect(result.currentLine).toBeNull();
    expect(result.nextLine?.index).toBe(0);
  });

  it('无有效歌词或播放位置时不匹配歌词', () => {
    expect(resolveCurrentLyricLine([], 6_200)).toEqual({
      currentLine: null,
      nextLine: null,
    });
    expect(resolveCurrentLyricLine(normalizeLyricLines([lyric(0, 1_000)]), null)).toEqual({
      currentLine: null,
      nextLine: null,
    });
  });

  it('未规范化的无时间戳歌词不会被识别为下一句', () => {
    expect(resolveCurrentLyricLine([lyric(0), lyric(1)], 6_200)).toEqual({
      currentLine: null,
      nextLine: null,
    });
  });
});

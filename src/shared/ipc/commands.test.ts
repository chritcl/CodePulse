import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mediaCommands } from './index';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('媒体 IPC 命令封装', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('通过统一命令封装读取播放快照', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null);

    await mediaCommands.getMusicPlaybackState();

    expect(invoke).toHaveBeenCalledWith('get_music_playback_state');
  });

  it('歌词请求保持 Rust 命令需要的扁平参数', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ status: 'not_found', lines: [] });

    await mediaCommands.getLyricsForTrack({ title: '晴天', artist: '周杰伦' });

    expect(invoke).toHaveBeenCalledWith('get_lyrics_for_track', {
      title: '晴天',
      artist: '周杰伦',
    });
  });

  it('通过统一命令封装读取歌曲封面', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('data:image/png;base64,cover');

    await mediaCommands.getRandomCoverUrl('晴天', '周杰伦');

    expect(invoke).toHaveBeenCalledWith('get_random_cover_url', {
      songName: '晴天',
      artistName: '周杰伦',
    });
  });
});

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '@/stores';
import { useSettingsActions } from './useSettingsActions';

describe('useSettingsActions', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it('音乐控制立即更新并广播现有事件', async () => {
    const emitEvent = vi.fn(async () => {});
    const showFeedback = vi.fn();
    const settings = useSettingsStore();
    const actions = useSettingsActions(showFeedback, { emitEvent });

    await actions.setMusicEnabled(true);

    expect(settings.enableMusicCtrl).toBe(true);
    expect(emitEvent).toHaveBeenCalledWith('control-music-ctl', { enabled: true });
    expect(showFeedback).toHaveBeenCalledWith({
      kind: 'success',
      message: '音乐控制已开启',
    });
  });

  it('广播失败时回滚音乐控制状态', async () => {
    const emitEvent = vi.fn(async () => {
      throw new Error('发送失败');
    });
    const showFeedback = vi.fn();
    const settings = useSettingsStore();
    const actions = useSettingsActions(showFeedback, { emitEvent });

    await actions.setMusicEnabled(true);

    expect(settings.enableMusicCtrl).toBe(false);
    expect(showFeedback).toHaveBeenCalledWith({
      kind: 'error',
      message: '无法开启音乐控制',
    });
  });

  it('消息优先策略同时开启通知、关闭轮换并广播策略状态', async () => {
    const emitEvent = vi.fn(async () => {});
    const settings = useSettingsStore();
    settings.enableRotation = true;
    const actions = useSettingsActions(vi.fn(), { emitEvent });

    await actions.setDisplayStrategy('message');

    expect(settings.msgModeEnabled).toBe(true);
    expect(settings.enableRotation).toBe(false);
    expect(settings.enableMsgNotify).toBe(true);
    expect(emitEvent).toHaveBeenNthCalledWith(1, 'control-rotation-mode', { enabled: false });
    expect(emitEvent).toHaveBeenNthCalledWith(2, 'control-msg-mode', { enabled: true });
  });

  it('同一动画帧内只广播最后一次不透明度输入', async () => {
    let frameCallback: FrameRequestCallback | undefined;
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      frameCallback = callback;
      return 1;
    });
    const emitEvent = vi.fn(async () => {});
    const settings = useSettingsStore();
    const actions = useSettingsActions(vi.fn(), { emitEvent, requestFrame });

    actions.previewOpacity(72);
    actions.previewOpacity(68);
    expect(settings.opacity).toBe(68);
    expect(requestFrame).toHaveBeenCalledOnce();

    frameCallback?.(0);
    await Promise.resolve();

    expect(emitEvent).toHaveBeenCalledOnce();
    expect(emitEvent).toHaveBeenCalledWith('control-island-opacity', { opacity: 68 });
  });

  it('旧的不透明度同步失败不会回滚更新的连续输入', async () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    let rejectFirst!: () => void;
    const firstSync = new Promise<void>((_, reject) => {
      rejectFirst = () => reject(new Error('旧请求失败'));
    });
    const emitEvent = vi
      .fn()
      .mockImplementationOnce(() => firstSync)
      .mockResolvedValue(undefined);
    const showFeedback = vi.fn();
    const settings = useSettingsStore();
    const actions = useSettingsActions(showFeedback, { emitEvent, requestFrame });

    actions.previewOpacity(40);
    frameCallbacks.shift()?.(0);
    actions.previewOpacity(70);
    rejectFirst();
    await firstSync.catch(() => {});
    await Promise.resolve();

    expect(settings.opacity).toBe(70);
    expect(showFeedback).not.toHaveBeenCalled();

    frameCallbacks.shift()?.(0);
    await Promise.resolve();
    expect(emitEvent).toHaveBeenLastCalledWith('control-island-opacity', { opacity: 70 });
  });
});

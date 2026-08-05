import { describe, expect, it } from 'vitest';
import { ALL_EVENTS } from './events';

describe('桌面事件名称契约', () => {
  it('Agent 事件名称都符合 Tauri 2 的监听器字符约束', () => {
    const invalidEvents = Object.entries(ALL_EVENTS)
      .filter(([eventKey]) => eventKey.startsWith('CODEX_') || eventKey.startsWith('CLAUDE_'))
      .filter(([, eventName]) => !/^[A-Za-z0-9_:/-]+$/.test(eventName));

    expect(invalidEvents).toEqual([]);
  });
});

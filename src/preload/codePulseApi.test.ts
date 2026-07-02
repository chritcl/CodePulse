import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentStateSnapshot } from "../shared/types/agent";
import { codePulseChannels } from "../shared/ipc/channels";

const electronMock = vi.hoisted(() => ({
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn()
}));

vi.mock("electron", () => ({
  ipcRenderer: {
    invoke: electronMock.invoke,
    on: electronMock.on,
    removeListener: electronMock.removeListener
  }
}));

describe("Preload API 安全边界", () => {
  beforeEach(() => {
    electronMock.invoke.mockReset();
    electronMock.on.mockReset();
    electronMock.removeListener.mockReset();
  });

  it("暴露给渲染进程的 API 只能包含业务白名单分组", async () => {
    const { codePulseApi } = await import("./codePulseApi");

    expect(Object.keys(codePulseApi).sort()).toEqual([
      "diagnostics",
      "providers",
      "settings",
      "state",
      "system",
      "tasks",
      "windows"
    ]);
    expect(Object.keys(codePulseApi.state).sort()).toEqual(["getSnapshot", "refresh", "subscribe"]);
    expect(Object.keys(codePulseApi.tasks).sort()).toEqual([
      "copySummary",
      "getHistoryActivities",
      "listHistory",
      "markViewed",
      "open",
      "openAgent",
      "snooze"
    ]);
    expect(Object.keys(codePulseApi.providers).sort()).toEqual(["detect", "list", "setEnabled"]);
    expect(Object.keys(codePulseApi.settings).sort()).toEqual(["get", "update"]);
    expect(Object.keys(codePulseApi.windows).sort()).toEqual(["closePopup", "openSettings", "openTaskCenter", "setIslandMode"]);
    expect(Object.keys(codePulseApi.system).sort()).toEqual(["getConnectionStatus", "getDisplays"]);
    expect(Object.keys(codePulseApi.diagnostics).sort()).toEqual(["exportRedacted"]);
    expect("ipcRenderer" in codePulseApi).toBe(false);
    expect("fs" in codePulseApi).toBe(false);
    expect("shell" in codePulseApi).toBe(false);
  });

  it("暴露给渲染进程的 API 对象不可被篡改", async () => {
    const { codePulseApi } = await import("./codePulseApi");
    const originalGetSnapshot = codePulseApi.state.getSnapshot;

    expect(Object.isFrozen(codePulseApi)).toBe(true);
    for (const value of Object.values(codePulseApi)) {
      expect(Object.isFrozen(value)).toBe(true);
    }

    try {
      (codePulseApi.state as { getSnapshot: unknown }).getSnapshot = vi.fn();
    } catch {
      // 严格模式下冻结对象会直接拒绝写入。
    }

    expect(codePulseApi.state.getSnapshot).toBe(originalGetSnapshot);
  });

  it("状态订阅只监听状态变更频道并清理同一个处理器", async () => {
    const { codePulseApi } = await import("./codePulseApi");
    const listener = vi.fn();
    const snapshot = {
      providers: [],
      tasks: [],
      activities: [],
      quotas: []
    } as unknown as AgentStateSnapshot;

    const unsubscribe = codePulseApi.state.subscribe(listener);

    expect(electronMock.on).toHaveBeenCalledTimes(1);
    expect(electronMock.on.mock.calls[0]?.[0]).toBe(codePulseChannels.stateChanged);

    const handler = electronMock.on.mock.calls[0]?.[1] as (event: unknown, nextSnapshot: AgentStateSnapshot) => void;
    handler({}, snapshot);
    expect(listener).toHaveBeenCalledWith(snapshot);

    unsubscribe();

    expect(electronMock.removeListener).toHaveBeenCalledTimes(1);
    expect(electronMock.removeListener).toHaveBeenCalledWith(codePulseChannels.stateChanged, handler);
  });

  it("历史查询通过任务白名单 IPC 通道调用", async () => {
    const { codePulseApi } = await import("./codePulseApi");

    electronMock.invoke.mockResolvedValue({
      ok: true,
      data: [],
      error: null
    });

    await codePulseApi.tasks.listHistory(20);
    await codePulseApi.tasks.getHistoryActivities("task-1", 10);
    await codePulseApi.tasks.openAgent("task-1");

    expect(electronMock.invoke).toHaveBeenCalledWith(codePulseChannels.tasksListHistory, 20);
    expect(electronMock.invoke).toHaveBeenCalledWith(codePulseChannels.tasksGetHistoryActivities, "task-1", 10);
    expect(electronMock.invoke).toHaveBeenCalledWith(codePulseChannels.tasksOpenAgent, "task-1");
  });
});

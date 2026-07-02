import { beforeEach, describe, expect, it, vi } from "vitest";
import { codePulseChannels } from "../../shared/ipc/channels";
import type { AgentActivity, AgentProvider, AgentStateSnapshot, AgentTask } from "../../shared/types/agent";
import { defaultAppSettings, type AppSettings } from "../../shared/types/settings";

type IpcHandler = (_event: unknown, ...args: unknown[]) => unknown;

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  clipboardWriteText: vi.fn(),
  shellOpenPath: vi.fn(),
  spawn: vi.fn(() => ({
    unref: vi.fn()
  })),
  handle: vi.fn((channel: string, handler: IpcHandler) => {
    electronMock.handlers.set(channel, handler);
  }),
  removeHandler: vi.fn((channel: string) => {
    electronMock.handlers.delete(channel);
  })
}));

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: () => []
  },
  clipboard: {
    writeText: electronMock.clipboardWriteText
  },
  shell: {
    openPath: electronMock.shellOpenPath
  },
  ipcMain: {
    handle: electronMock.handle,
    removeHandler: electronMock.removeHandler
  }
}));

vi.mock("node:child_process", () => ({
  spawn: electronMock.spawn
}));

const provider: AgentProvider = {
  id: "codex",
  name: "Codex",
  icon: "C",
  adapterType: "codex",
  enabled: true,
  connectionStatus: "connected",
  lastConnectedAt: "2026-07-01T08:00:00.000Z",
  lastErrorAt: null,
  capabilities: []
};

const task: AgentTask = {
  id: "task-1",
  providerId: "codex",
  sessionId: "session-1",
  title: "实现任务中心筛选",
  projectName: "CodePulse",
  projectPath: "C:\\Users\\fengq\\Desktop\\Work\\杂\\CodePulse",
  status: "executing",
  stage: "编写测试",
  priority: "executing",
  startedAt: "2026-07-01T08:00:00.000Z",
  updatedAt: "2026-07-01T09:00:00.000Z",
  completedAt: null,
  lastActivityAt: "2026-07-01T09:00:00.000Z",
  lastActivityText: "正在补充复制摘要",
  progressType: "unavailable",
  progressValue: null,
  completedSteps: null,
  totalSteps: null,
  waitingAction: null,
  errorCode: null,
  errorMessage: null,
  sourceId: "test"
};

const snapshot: AgentStateSnapshot = {
  version: 1,
  generatedAt: "2026-07-01T09:00:00.000Z",
  providers: [provider],
  tasks: [task],
  activities: [],
  quotas: [],
  summary: {
    status: "executing",
    label: "运行中",
    runningTaskCount: 1,
    waitingTaskCount: 0,
    failedTaskCount: 0,
    completedTaskCount: 0,
    disconnectedProviderCount: 0,
    quotaCriticalProviderCount: 0,
    primaryTaskId: "task-1",
    aggregateText: "1 个任务运行中",
    hasStaleData: false,
    updatedAt: "2026-07-01T09:00:00.000Z"
  }
};

const activity: AgentActivity = {
  id: "activity-1",
  taskId: "task-1",
  providerId: "codex",
  type: "message",
  title: "历史活动",
  description: "从 SQLite 读取活动",
  createdAt: "2026-07-01T09:05:00.000Z",
  metadata: {}
};

describe("registerIpc", () => {
  beforeEach(() => {
    electronMock.handlers.clear();
    electronMock.clipboardWriteText.mockClear();
    electronMock.shellOpenPath.mockClear();
    electronMock.spawn.mockClear();
    electronMock.handle.mockClear();
    electronMock.removeHandler.mockClear();
  });

  it("复制任务摘要时会写入剪贴板并返回摘要文本", async () => {
    const { registerIpc } = await import("./registerIpc");
    const hub = {
      subscribe: vi.fn(() => vi.fn()),
      getSnapshot: vi.fn(() => snapshot)
    };
    const settingsStore = {
      get: vi.fn(() => ({} as AppSettings)),
      update: vi.fn()
    };
    const windows = {
      openTaskCenter: vi.fn(),
      openSettings: vi.fn(),
      setIslandMode: vi.fn(),
      closePopup: vi.fn(),
      updateSettings: vi.fn()
    };

    registerIpc(hub as never, settingsStore as never, windows as never);
    const handler = electronMock.handlers.get(codePulseChannels.tasksCopySummary);
    const result = await handler?.({}, " task-1 ");

    expect(result).toMatchObject({
      ok: true
    });
    expect(electronMock.clipboardWriteText).toHaveBeenCalledTimes(1);
    expect(electronMock.clipboardWriteText.mock.calls[0]?.[0]).toContain("实现任务中心筛选");
    expect(electronMock.clipboardWriteText.mock.calls[0]?.[0]).toContain("CodePulse");
    expect(result).toMatchObject({
      data: electronMock.clipboardWriteText.mock.calls[0]?.[0]
    });
  });

  it("打开任务时会通过主进程打开项目目录", async () => {
    electronMock.shellOpenPath.mockResolvedValue("");
    const { registerIpc } = await import("./registerIpc");
    const hub = {
      subscribe: vi.fn(() => vi.fn()),
      getSnapshot: vi.fn(() => snapshot)
    };
    const settingsStore = {
      get: vi.fn(() => ({} as AppSettings)),
      update: vi.fn()
    };
    const windows = {
      openTaskCenter: vi.fn(),
      openSettings: vi.fn(),
      setIslandMode: vi.fn(),
      closePopup: vi.fn(),
      updateSettings: vi.fn()
    };

    registerIpc(hub as never, settingsStore as never, windows as never);
    const handler = electronMock.handlers.get(codePulseChannels.tasksOpen);
    const result = await handler?.({}, " task-1 ");

    expect(result).toMatchObject({
      ok: true,
      data: true
    });
    expect(electronMock.shellOpenPath).toHaveBeenCalledWith(task.projectPath);
    expect(windows.openTaskCenter).not.toHaveBeenCalled();
  });

  it("任务缺少项目路径时返回明确错误", async () => {
    const { registerIpc } = await import("./registerIpc");
    const snapshotWithoutPath: AgentStateSnapshot = {
      ...snapshot,
      tasks: [
        {
          ...task,
          projectPath: null
        }
      ]
    };
    const hub = {
      subscribe: vi.fn(() => vi.fn()),
      getSnapshot: vi.fn(() => snapshotWithoutPath)
    };
    const settingsStore = {
      get: vi.fn(() => ({} as AppSettings)),
      update: vi.fn()
    };
    const windows = {
      openTaskCenter: vi.fn(),
      openSettings: vi.fn(),
      setIslandMode: vi.fn(),
      closePopup: vi.fn(),
      updateSettings: vi.fn()
    };

    registerIpc(hub as never, settingsStore as never, windows as never);
    const handler = electronMock.handlers.get(codePulseChannels.tasksOpen);
    const result = await handler?.({}, "task-1");

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "IPC_ERROR",
        message: "任务项目目录暂不可用"
      }
    });
    expect(electronMock.shellOpenPath).not.toHaveBeenCalled();
  });

  it("打开 Agent 时会通过受控命令在任务项目目录启动 Codex", async () => {
    const { registerIpc } = await import("./registerIpc");
    const hub = {
      subscribe: vi.fn(() => vi.fn()),
      getSnapshot: vi.fn(() => snapshot)
    };
    const settingsStore = {
      get: vi.fn(() => ({} as AppSettings)),
      update: vi.fn()
    };
    const windows = {
      openTaskCenter: vi.fn(),
      openSettings: vi.fn(),
      setIslandMode: vi.fn(),
      closePopup: vi.fn(),
      updateSettings: vi.fn()
    };

    registerIpc(hub as never, settingsStore as never, windows as never);
    const handler = electronMock.handlers.get(codePulseChannels.tasksOpenAgent);
    const result = await handler?.({}, " task-1 ");

    expect(result).toMatchObject({
      ok: true,
      data: true
    });
    expect(electronMock.spawn).toHaveBeenCalledWith(
      "powershell.exe",
      ["-NoProfile", "-NoExit", "-Command", "Set-Location -LiteralPath $args[0]; codex", task.projectPath],
      {
        detached: true,
        stdio: "ignore",
        windowsHide: false
      }
    );
  });

  it("打开 Agent 时拒绝缺少项目目录的任务", async () => {
    const { registerIpc } = await import("./registerIpc");
    const snapshotWithoutPath: AgentStateSnapshot = {
      ...snapshot,
      tasks: [
        {
          ...task,
          projectPath: null
        }
      ]
    };
    const hub = {
      subscribe: vi.fn(() => vi.fn()),
      getSnapshot: vi.fn(() => snapshotWithoutPath)
    };
    const settingsStore = {
      get: vi.fn(() => ({} as AppSettings)),
      update: vi.fn()
    };
    const windows = {
      openTaskCenter: vi.fn(),
      openSettings: vi.fn(),
      setIslandMode: vi.fn(),
      closePopup: vi.fn(),
      updateSettings: vi.fn()
    };

    registerIpc(hub as never, settingsStore as never, windows as never);
    const handler = electronMock.handlers.get(codePulseChannels.tasksOpenAgent);
    const result = await handler?.({}, "task-1");

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "IPC_ERROR",
        message: "Agent 启动目录暂不可用"
      }
    });
    expect(electronMock.spawn).not.toHaveBeenCalled();
  });

  it("打开 Agent 时拒绝暂不支持的数据源", async () => {
    const { registerIpc } = await import("./registerIpc");
    const unsupportedSnapshot: AgentStateSnapshot = {
      ...snapshot,
      providers: [
        {
          ...provider,
          id: "custom",
          adapterType: "customCommand"
        }
      ],
      tasks: [
        {
          ...task,
          providerId: "custom"
        }
      ]
    };
    const hub = {
      subscribe: vi.fn(() => vi.fn()),
      getSnapshot: vi.fn(() => unsupportedSnapshot)
    };
    const settingsStore = {
      get: vi.fn(() => ({} as AppSettings)),
      update: vi.fn()
    };
    const windows = {
      openTaskCenter: vi.fn(),
      openSettings: vi.fn(),
      setIslandMode: vi.fn(),
      closePopup: vi.fn(),
      updateSettings: vi.fn()
    };

    registerIpc(hub as never, settingsStore as never, windows as never);
    const handler = electronMock.handlers.get(codePulseChannels.tasksOpenAgent);
    const result = await handler?.({}, "task-1");

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "IPC_ERROR",
        message: "该任务暂不支持打开 Agent"
      }
    });
    expect(electronMock.spawn).not.toHaveBeenCalled();
  });

  it("打开任务时允许读取历史库中的已知任务", async () => {
    electronMock.shellOpenPath.mockResolvedValue("");
    const { registerIpc } = await import("./registerIpc");
    const snapshotWithoutTasks: AgentStateSnapshot = {
      ...snapshot,
      tasks: []
    };
    const hub = {
      subscribe: vi.fn(() => vi.fn()),
      getSnapshot: vi.fn(() => snapshotWithoutTasks)
    };
    const settingsStore = {
      get: vi.fn(() => ({} as AppSettings)),
      update: vi.fn()
    };
    const windows = {
      openTaskCenter: vi.fn(),
      openSettings: vi.fn(),
      setIslandMode: vi.fn(),
      closePopup: vi.fn(),
      updateSettings: vi.fn()
    };
    const historyStore = {
      getRecentTasks: vi.fn(() => [task]),
      getTaskActivities: vi.fn(() => [])
    };

    registerIpc(hub as never, settingsStore as never, windows as never, undefined, historyStore as never);
    const handler = electronMock.handlers.get(codePulseChannels.tasksOpen);
    const result = await handler?.({}, "task-1");

    expect(result).toMatchObject({
      ok: true,
      data: true
    });
    expect(historyStore.getRecentTasks).toHaveBeenCalledWith(500);
    expect(electronMock.shellOpenPath).toHaveBeenCalledWith(task.projectPath);
  });

  it("复制摘要时允许读取历史库中的已知任务", async () => {
    const { registerIpc } = await import("./registerIpc");
    const snapshotWithoutTasks: AgentStateSnapshot = {
      ...snapshot,
      tasks: []
    };
    const hub = {
      subscribe: vi.fn(() => vi.fn()),
      getSnapshot: vi.fn(() => snapshotWithoutTasks)
    };
    const settingsStore = {
      get: vi.fn(() => ({} as AppSettings)),
      update: vi.fn()
    };
    const windows = {
      openTaskCenter: vi.fn(),
      openSettings: vi.fn(),
      setIslandMode: vi.fn(),
      closePopup: vi.fn(),
      updateSettings: vi.fn()
    };
    const historyStore = {
      getRecentTasks: vi.fn(() => [task]),
      getTaskActivities: vi.fn(() => [])
    };

    registerIpc(hub as never, settingsStore as never, windows as never, undefined, historyStore as never);
    const handler = electronMock.handlers.get(codePulseChannels.tasksCopySummary);
    const result = await handler?.({}, "task-1");

    expect(result).toMatchObject({
      ok: true
    });
    expect(historyStore.getRecentTasks).toHaveBeenCalledWith(500);
    expect(electronMock.clipboardWriteText.mock.calls[0]?.[0]).toContain("实现任务中心筛选");
  });

  it("稍后提醒只允许已知任务", async () => {
    const { registerIpc } = await import("./registerIpc");
    const hub = {
      subscribe: vi.fn(() => vi.fn()),
      getSnapshot: vi.fn(() => snapshot)
    };
    const settingsStore = {
      get: vi.fn(() => ({} as AppSettings)),
      update: vi.fn()
    };
    const windows = {
      openTaskCenter: vi.fn(),
      openSettings: vi.fn(),
      setIslandMode: vi.fn(),
      closePopup: vi.fn(),
      updateSettings: vi.fn()
    };
    const notifications = {
      snooze: vi.fn()
    };

    registerIpc(hub as never, settingsStore as never, windows as never, notifications as never);
    const handler = electronMock.handlers.get(codePulseChannels.tasksSnooze);
    const until = "2026-07-01T10:00:00.000Z";
    const success = await handler?.({}, "task-1", until);
    const failure = await handler?.({}, "missing-task", until);

    expect(success).toMatchObject({
      ok: true,
      data: true
    });
    expect(notifications.snooze).toHaveBeenCalledWith("task-1", until);
    expect(failure).toMatchObject({
      ok: false,
      error: {
        code: "IPC_ERROR",
        message: "任务不存在"
      }
    });
    expect(notifications.snooze).toHaveBeenCalledTimes(1);
  });

  it("标记已读只允许已知任务", async () => {
    const { registerIpc } = await import("./registerIpc");
    const hub = {
      subscribe: vi.fn(() => vi.fn()),
      getSnapshot: vi.fn(() => snapshot)
    };
    const settingsStore = {
      get: vi.fn(() => ({} as AppSettings)),
      update: vi.fn()
    };
    const windows = {
      openTaskCenter: vi.fn(),
      openSettings: vi.fn(),
      setIslandMode: vi.fn(),
      closePopup: vi.fn(),
      updateSettings: vi.fn()
    };

    registerIpc(hub as never, settingsStore as never, windows as never);
    const handler = electronMock.handlers.get(codePulseChannels.tasksMarkViewed);
    const success = await handler?.({}, " task-1 ");
    const failure = await handler?.({}, "missing-task");

    expect(success).toMatchObject({
      ok: true,
      data: true
    });
    expect(failure).toMatchObject({
      ok: false,
      error: {
        code: "IPC_ERROR",
        message: "任务不存在"
      }
    });
  });

  it("通过受控 IPC 查询持久化历史任务和活动", async () => {
    const { registerIpc } = await import("./registerIpc");
    const hub = {
      subscribe: vi.fn(() => vi.fn()),
      getSnapshot: vi.fn(() => snapshot)
    };
    const settingsStore = {
      get: vi.fn(() => ({} as AppSettings)),
      update: vi.fn()
    };
    const windows = {
      openTaskCenter: vi.fn(),
      openSettings: vi.fn(),
      setIslandMode: vi.fn(),
      closePopup: vi.fn(),
      updateSettings: vi.fn()
    };
    const historyStore = {
      getRecentTasks: vi.fn(() => [
        {
          ...task,
          status: "completed",
          priority: "completed",
          completedAt: "2026-07-01T10:00:00.000Z"
        }
      ]),
      getTaskActivities: vi.fn(() => [activity])
    };

    registerIpc(hub as never, settingsStore as never, windows as never, undefined, historyStore as never);
    const tasksHandler = electronMock.handlers.get(codePulseChannels.tasksListHistory);
    const activitiesHandler = electronMock.handlers.get(codePulseChannels.tasksGetHistoryActivities);

    const tasksResult = await tasksHandler?.({}, 20);
    const activitiesResult = await activitiesHandler?.({}, " task-1 ", 10);

    expect(tasksResult).toMatchObject({
      ok: true,
      data: [
        {
          id: "task-1",
          status: "completed"
        }
      ]
    });
    expect(activitiesResult).toMatchObject({
      ok: true,
      data: [
        {
          id: "activity-1",
          title: "历史活动"
        }
      ]
    });
    expect(historyStore.getRecentTasks).toHaveBeenCalledWith(20);
    expect(historyStore.getTaskActivities).toHaveBeenCalledWith("task-1", 10);
  });

  it("切换数据源启用状态时同步 Hub 并写入对应设置分支", async () => {
    const { registerIpc } = await import("./registerIpc");
    const hub = {
      subscribe: vi.fn(() => vi.fn()),
      getSnapshot: vi.fn(() => snapshot),
      setProviderEnabled: vi.fn(async () => snapshot),
      updateProviderRuntimeConfig: vi.fn(async () => snapshot)
    };
    const settingsStore = {
      get: vi.fn(() => defaultAppSettings),
      update: vi.fn(async () => defaultAppSettings)
    };
    const windows = {
      openTaskCenter: vi.fn(),
      openSettings: vi.fn(),
      setIslandMode: vi.fn(),
      closePopup: vi.fn(),
      updateSettings: vi.fn()
    };
    const notifications = {
      snooze: vi.fn(),
      updateSettings: vi.fn()
    };
    const cases = [
      [" codex ", "codex", "codex"],
      ["process", "process", "process"],
      ["log", "log", "log"],
      ["custom-command", "custom-command", "customCommand"],
      ["mock-codex", "mock-codex", "mock"]
    ] as const;

    registerIpc(hub as never, settingsStore as never, windows as never, notifications as never);
    const handler = electronMock.handlers.get(codePulseChannels.providersSetEnabled);

    for (const [inputProviderId] of cases) {
      const result = await handler?.({}, inputProviderId, false);

      expect(result).toMatchObject({
        ok: true,
        data: true
      });
    }

    cases.forEach(([, normalizedProviderId, settingsKey], index) => {
      expect(hub.setProviderEnabled).toHaveBeenNthCalledWith(index + 1, normalizedProviderId, false);
      expect(settingsStore.update).toHaveBeenNthCalledWith(index + 1, {
        providers: {
          [settingsKey]: {
            enabled: false
          }
        }
      });
    });
    expect(windows.updateSettings).toHaveBeenCalledTimes(cases.length);
    expect(notifications.updateSettings).toHaveBeenCalledTimes(cases.length);
  });

  it("切换未知数据源启用状态时返回校验错误且不写入设置", async () => {
    const { registerIpc } = await import("./registerIpc");
    const hub = {
      subscribe: vi.fn(() => vi.fn()),
      getSnapshot: vi.fn(() => snapshot),
      setProviderEnabled: vi.fn()
    };
    const settingsStore = {
      get: vi.fn(() => defaultAppSettings),
      update: vi.fn()
    };
    const windows = {
      openTaskCenter: vi.fn(),
      openSettings: vi.fn(),
      setIslandMode: vi.fn(),
      closePopup: vi.fn(),
      updateSettings: vi.fn()
    };

    registerIpc(hub as never, settingsStore as never, windows as never);
    const handler = electronMock.handlers.get(codePulseChannels.providersSetEnabled);
    const result = await handler?.({}, "unknown-provider", true);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "IPC_VALIDATION_ERROR",
        message: "数据源 ID 无效"
      }
    });
    expect(hub.setProviderEnabled).not.toHaveBeenCalled();
    expect(settingsStore.update).not.toHaveBeenCalled();
  });

  it("设置更新包含数据源启用状态时同步 Hub 运行态", async () => {
    const { registerIpc } = await import("./registerIpc");
    const hub = {
      subscribe: vi.fn(() => vi.fn()),
      getSnapshot: vi.fn(() => snapshot),
      setProviderEnabled: vi.fn(async () => snapshot),
      updateProviderRuntimeConfig: vi.fn(async () => snapshot)
    };
    const updatedSettings = {
      ...defaultAppSettings,
      providers: {
        ...defaultAppSettings.providers,
        process: {
          enabled: false
        },
        customCommand: {
          ...defaultAppSettings.providers.customCommand,
          enabled: true
        },
        mock: {
          enabled: false
        }
      }
    };
    const settingsStore = {
      get: vi.fn(() => defaultAppSettings),
      update: vi.fn(async () => updatedSettings)
    };
    const windows = {
      openTaskCenter: vi.fn(),
      openSettings: vi.fn(),
      setIslandMode: vi.fn(),
      closePopup: vi.fn(),
      updateSettings: vi.fn()
    };

    registerIpc(hub as never, settingsStore as never, windows as never);
    const handler = electronMock.handlers.get(codePulseChannels.settingsUpdate);
    const result = await handler?.(
      {},
      {
        providers: {
          process: {
            enabled: false
          },
          customCommand: {
            enabled: true
          },
          mock: {
            enabled: false
          }
        }
      }
    );

    expect(result).toMatchObject({
      ok: true,
      data: updatedSettings
    });
    expect(hub.setProviderEnabled).toHaveBeenCalledWith("process", false);
    expect(hub.setProviderEnabled).toHaveBeenCalledWith("custom-command", true);
    expect(hub.setProviderEnabled).toHaveBeenCalledWith("mock-codex", false);
    expect(hub.updateProviderRuntimeConfig).toHaveBeenCalledWith("custom-command", {
      enabled: true
    });
  });

  it("设置更新包含自定义命令授权和路径时同步运行期配置", async () => {
    const { registerIpc } = await import("./registerIpc");
    const hub = {
      subscribe: vi.fn(() => vi.fn()),
      getSnapshot: vi.fn(() => snapshot),
      setProviderEnabled: vi.fn(async () => snapshot),
      updateProviderRuntimeConfig: vi.fn(async () => snapshot)
    };
    const updatedSettings = {
      ...defaultAppSettings,
      providers: {
        ...defaultAppSettings.providers,
        customCommand: {
          ...defaultAppSettings.providers.customCommand,
          enabled: true,
          authorized: true,
          commandPath: "C:\\Tools\\agent-status.exe",
          args: ["--json"],
          workingDirectory: "C:\\Users\\fengq\\agent",
          timeoutMs: 3000,
          outputLimitBytes: 8192
        }
      }
    };
    const settingsStore = {
      get: vi.fn(() => defaultAppSettings),
      update: vi.fn(async () => updatedSettings)
    };
    const windows = {
      openTaskCenter: vi.fn(),
      openSettings: vi.fn(),
      setIslandMode: vi.fn(),
      closePopup: vi.fn(),
      updateSettings: vi.fn()
    };

    registerIpc(hub as never, settingsStore as never, windows as never);
    const handler = electronMock.handlers.get(codePulseChannels.settingsUpdate);
    const result = await handler?.(
      {},
      {
        providers: {
          customCommand: {
            enabled: true,
            authorized: true,
            commandPath: " C:\\Tools\\agent-status.exe ",
            args: [" --json "],
            workingDirectory: " C:\\Users\\fengq\\agent ",
            timeoutMs: 3000,
            outputLimitBytes: 8192
          }
        }
      }
    );

    expect(result).toMatchObject({
      ok: true,
      data: updatedSettings
    });
    expect(hub.setProviderEnabled).toHaveBeenCalledWith("custom-command", true);
    expect(hub.updateProviderRuntimeConfig).toHaveBeenCalledWith("custom-command", {
      enabled: true,
      authorized: true,
      commandPath: "C:\\Tools\\agent-status.exe",
      args: ["--json"],
      workingDirectory: "C:\\Users\\fengq\\agent",
      timeoutMs: 3000,
      outputLimitBytes: 8192
    });
  });

  it("设置更新包含 Codex 和通用日志路径时同步运行期配置", async () => {
    const { registerIpc } = await import("./registerIpc");
    const hub = {
      subscribe: vi.fn(() => vi.fn()),
      getSnapshot: vi.fn(() => snapshot),
      setProviderEnabled: vi.fn(async () => snapshot),
      updateProviderRuntimeConfig: vi.fn(async () => snapshot)
    };
    const updatedSettings = {
      ...defaultAppSettings,
      providers: {
        ...defaultAppSettings.providers,
        codex: {
          ...defaultAppSettings.providers.codex,
          statusFilePath: "C:\\Users\\fengq\\codex-status.json",
          logFilePath: "C:\\Users\\fengq\\codex.log"
        },
        log: {
          ...defaultAppSettings.providers.log,
          logFilePath: "C:\\Users\\fengq\\agent.log"
        }
      }
    };
    const settingsStore = {
      get: vi.fn(() => defaultAppSettings),
      update: vi.fn(async () => updatedSettings)
    };
    const windows = {
      openTaskCenter: vi.fn(),
      openSettings: vi.fn(),
      setIslandMode: vi.fn(),
      closePopup: vi.fn(),
      updateSettings: vi.fn()
    };

    registerIpc(hub as never, settingsStore as never, windows as never);
    const handler = electronMock.handlers.get(codePulseChannels.settingsUpdate);
    const result = await handler?.(
      {},
      {
        providers: {
          codex: {
            statusFilePath: " C:\\Users\\fengq\\codex-status.json ",
            logFilePath: " C:\\Users\\fengq\\codex.log "
          },
          log: {
            logFilePath: " C:\\Users\\fengq\\agent.log "
          }
        }
      }
    );

    expect(result).toMatchObject({
      ok: true,
      data: updatedSettings
    });
    expect(hub.updateProviderRuntimeConfig).toHaveBeenCalledWith("codex", {
      statusFilePath: "C:\\Users\\fengq\\codex-status.json",
      logFilePath: "C:\\Users\\fengq\\codex.log"
    });
    expect(hub.updateProviderRuntimeConfig).toHaveBeenCalledWith("log", {
      logFilePath: "C:\\Users\\fengq\\agent.log"
    });
  });

  it("历史库不可用时返回明确错误", async () => {
    const { registerIpc } = await import("./registerIpc");
    const hub = {
      subscribe: vi.fn(() => vi.fn()),
      getSnapshot: vi.fn(() => snapshot)
    };
    const settingsStore = {
      get: vi.fn(() => ({} as AppSettings)),
      update: vi.fn()
    };
    const windows = {
      openTaskCenter: vi.fn(),
      openSettings: vi.fn(),
      setIslandMode: vi.fn(),
      closePopup: vi.fn(),
      updateSettings: vi.fn()
    };

    registerIpc(hub as never, settingsStore as never, windows as never);
    const handler = electronMock.handlers.get(codePulseChannels.tasksListHistory);
    const result = await handler?.({}, 20);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "IPC_ERROR",
        message: "历史记录暂不可用"
      }
    });
  });

  it("诊断导出会包含通知运行时统计并脱敏路径", async () => {
    const { registerIpc } = await import("./registerIpc");
    const hub = {
      subscribe: vi.fn(() => vi.fn()),
      getSnapshot: vi.fn(() => snapshot)
    };
    const settingsStore = {
      get: vi.fn(() => ({} as AppSettings)),
      update: vi.fn()
    };
    const windows = {
      openTaskCenter: vi.fn(),
      openSettings: vi.fn(),
      setIslandMode: vi.fn(),
      closePopup: vi.fn(),
      updateSettings: vi.fn()
    };
    const notifications = {
      snooze: vi.fn(),
      getRuntimeStatus: vi.fn(() => ({
        sentEventCount: 2,
        snoozedTaskCount: 1,
        lastCleanupAt: "2026-07-01T09:05:00.000Z"
      }))
    };
    const historyStore = {
      getRecentTasks: vi.fn(() => []),
      getTaskActivities: vi.fn(() => []),
      getRuntimeStatus: vi.fn(() => ({
        loaded: true,
        recoveredFromCorruption: true,
        filePath: "C:\\Users\\fengq\\AppData\\Roaming\\CodePulse\\history.sqlite",
        lastCorruptBackupPath: "C:\\Users\\fengq\\AppData\\Roaming\\CodePulse\\history.sqlite.corrupt-20260701090500"
      }))
    };

    registerIpc(hub as never, settingsStore as never, windows as never, notifications as never, historyStore as never);
    const handler = electronMock.handlers.get(codePulseChannels.diagnosticsExportRedacted);
    const result = await handler?.({});

    expect(result).toMatchObject({
      ok: true
    });
    expect(result && typeof result === "object" && "data" in result ? result.data : "").toContain("\"notifications\"");
    expect(result && typeof result === "object" && "data" in result ? result.data : "").toContain("\"sentEventCount\": 2");
    expect(result && typeof result === "object" && "data" in result ? result.data : "").toContain("\"history\"");
    expect(result && typeof result === "object" && "data" in result ? result.data : "").toContain(
      "\"recoveredFromCorruption\": true"
    );
    expect(result && typeof result === "object" && "data" in result ? result.data : "").not.toContain(
      "C:\\Users\\fengq"
    );
  });
});

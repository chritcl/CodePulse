import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentStateSnapshot } from "../../shared/types/agent";
import { defaultAppSettings } from "../../shared/types/settings";
import type { RectLike } from "../../shared/types/window";

type Handler = (...args: unknown[]) => void;
type TestMenuItem = {
  label?: string;
  type?: string;
  click?: () => void;
};

class TestWebContents {
  readonly handlers = new Map<string, Handler[]>();
  readonly send = vi.fn();
  readonly setWindowOpenHandler = vi.fn();

  on(event: string, handler: Handler): this {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(...args);
    }
  }
}

const menuMock = vi.hoisted(() => ({
  buildFromTemplate: vi.fn((template: TestMenuItem[]) => ({
    template,
    popup: vi.fn()
  }))
}));

const displayMock = vi.hoisted(() => ({
  displays: [
    {
      id: "primary",
      scaleFactor: 1,
      primary: true,
      bounds: {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080
      },
      workArea: {
        x: 0,
        y: 0,
        width: 1920,
        height: 1040
      }
    }
  ]
}));

const screenMock = vi.hoisted(() => ({
  handlers: new Map<string, Handler[]>(),
  getCursorScreenPoint: vi.fn(() => ({
    x: 100,
    y: 100
  })),
  on: vi.fn((event: string, handler: Handler) => {
    screenMock.handlers.set(event, [...(screenMock.handlers.get(event) ?? []), handler]);
  }),
  off: vi.fn((event: string, handler: Handler) => {
    screenMock.handlers.set(
      event,
      (screenMock.handlers.get(event) ?? []).filter((item) => item !== handler)
    );
  }),
  emit: (event: string, ...args: unknown[]) => {
    for (const handler of screenMock.handlers.get(event) ?? []) {
      handler(...args);
    }
  }
}));

const makeSnapshot = (primaryTaskId: string | null): AgentStateSnapshot => ({
  version: 1,
  generatedAt: "2026-07-02T12:00:00.000Z",
  providers: [],
  tasks: [],
  activities: [],
  quotas: [],
  summary: {
    status: primaryTaskId ? "executing" : "idle",
    label: primaryTaskId ? "运行中" : "空闲",
    runningTaskCount: primaryTaskId ? 1 : 0,
    waitingTaskCount: 0,
    failedTaskCount: 0,
    completedTaskCount: 0,
    disconnectedProviderCount: 0,
    quotaCriticalProviderCount: 0,
    primaryTaskId,
    aggregateText: primaryTaskId ? "1 个任务运行中" : "空闲",
    hasStaleData: false,
    updatedAt: "2026-07-02T12:00:00.000Z"
  }
});

class TestBrowserWindow {
  static instances: TestBrowserWindow[] = [];

  readonly handlers = new Map<string, Handler[]>();
  readonly onceHandlers = new Map<string, Handler[]>();
  readonly webContents = new TestWebContents();
  bounds: RectLike;
  visible = false;
  destroyed = false;
  setBounds = vi.fn((bounds: RectLike) => {
    this.bounds = bounds;
  });
  getBounds = vi.fn(() => this.bounds);
  setAlwaysOnTop = vi.fn();
  setIgnoreMouseEvents = vi.fn();
  showInactive = vi.fn(() => {
    this.visible = true;
  });
  hide = vi.fn(() => {
    this.visible = false;
  });
  isVisible = vi.fn(() => this.visible);
  isDestroyed = vi.fn(() => this.destroyed);
  focus = vi.fn();
  show = vi.fn(() => {
    this.visible = true;
  });
  loadFile = vi.fn();
  loadURL = vi.fn();

  constructor(options: { width: number; height: number }) {
    this.bounds = {
      x: 0,
      y: 0,
      width: options.width,
      height: options.height
    };
    TestBrowserWindow.instances.push(this);
  }

  on(event: string, handler: Handler): this {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }

  once(event: string, handler: Handler): this {
    this.onceHandlers.set(event, [...(this.onceHandlers.get(event) ?? []), handler]);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(...args);
    }

    const onceHandlers = this.onceHandlers.get(event) ?? [];
    this.onceHandlers.delete(event);
    for (const handler of onceHandlers) {
      handler(...args);
    }
  }
}

vi.mock("electron", () => ({
  BrowserWindow: TestBrowserWindow,
  Menu: {
    buildFromTemplate: menuMock.buildFromTemplate
  },
  screen: screenMock
}));

vi.mock("../system/displays", () => ({
  getDisplays: () => displayMock.displays
}));

describe("WindowManager 动态岛拖拽持久化", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    TestBrowserWindow.instances = [];
    menuMock.buildFromTemplate.mockClear();
    screenMock.handlers.clear();
    screenMock.on.mockClear();
    screenMock.off.mockClear();
    screenMock.getCursorScreenPoint.mockClear();
    displayMock.displays = [
      {
        id: "primary",
        scaleFactor: 1,
        primary: true,
        bounds: {
          x: 0,
          y: 0,
          width: 1920,
          height: 1080
        },
        workArea: {
          x: 0,
          y: 0,
          width: 1920,
          height: 1040
        }
      }
    ];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("用户移动动态岛后保存自由位置并限制在工作区内", async () => {
    const saveSettings = vi.fn();
    const { WindowManager } = await import("./windowManager");
    const manager = new WindowManager(
      {
        ...defaultAppSettings,
        display: {
          ...defaultAppSettings.display,
          islandMode: "expanded"
        }
      },
      saveSettings
    );

    await manager.createIslandWindow();
    const window = TestBrowserWindow.instances[0];
    expect(window).toBeDefined();
    window?.emit("ready-to-show");
    window!.bounds = {
      x: -80,
      y: 990,
      width: 420,
      height: 260
    };

    window?.emit("move");
    await vi.runAllTimersAsync();

    expect(saveSettings).toHaveBeenCalledWith({
      display: {
        islandPosition: "free",
        islandCustomPosition: {
          displayId: "primary",
          x: 0,
          y: 780
        }
      }
    });
    expect(window?.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: 780,
      width: 420,
      height: 260
    });
  });

  it("右键动态岛时打开主进程菜单并执行菜单动作", async () => {
    const { WindowManager } = await import("./windowManager");
    const manager = new WindowManager({
      ...defaultAppSettings,
      display: {
        ...defaultAppSettings.display,
        islandMode: "normal"
      }
    });

    await manager.createIslandWindow();
    const window = TestBrowserWindow.instances[0];

    window?.webContents.emit("context-menu");

    expect(menuMock.buildFromTemplate).toHaveBeenCalledTimes(1);
    const menu = menuMock.buildFromTemplate.mock.results[0]?.value as { template: TestMenuItem[]; popup: ReturnType<typeof vi.fn> };
    expect(menu.template.map((item) => item.label ?? item.type)).toEqual([
      "展开动态岛",
      "收起动态岛",
      "隐藏动态岛",
      "separator",
      "打开任务中心",
      "设置"
    ]);
    expect(menu.popup).toHaveBeenCalledWith({
      window
    });

    menu.template.find((item) => item.label === "展开动态岛")?.click?.();
    expect(window?.webContents.send).toHaveBeenLastCalledWith("codepulse:island:mode", "expanded");

    menu.template.find((item) => item.label === "打开任务中心")?.click?.();
    const centerWindow = TestBrowserWindow.instances[1];
    expect(centerWindow).toBeDefined();

    menu.template.find((item) => item.label === "设置")?.click?.();
    const settingsWindow = TestBrowserWindow.instances[2];
    expect(settingsWindow).toBeDefined();
  });

  it("右键动态岛时可直接打开当前任务", async () => {
    const { WindowManager } = await import("./windowManager");
    const manager = new WindowManager(
      {
        ...defaultAppSettings,
        display: {
          ...defaultAppSettings.display,
          islandMode: "normal"
        }
      },
      undefined,
      {
        snapshotProvider: () => makeSnapshot("task-1")
      }
    );

    await manager.createIslandWindow();
    const window = TestBrowserWindow.instances[0];

    window?.webContents.emit("context-menu");

    const menu = menuMock.buildFromTemplate.mock.results[0]?.value as { template: TestMenuItem[] };
    expect(menu.template.map((item) => item.label ?? item.type)).toEqual([
      "打开当前任务",
      "separator",
      "展开动态岛",
      "收起动态岛",
      "隐藏动态岛",
      "separator",
      "打开任务中心",
      "设置"
    ]);

    menu.template.find((item) => item.label === "打开当前任务")?.click?.();
    await Promise.resolve();
    await Promise.resolve();

    const centerWindow = TestBrowserWindow.instances[1];
    expect(centerWindow?.webContents.send).toHaveBeenCalledWith("codepulse:task:focus", "task-1");
  });

  it("右键动态岛时可稍后提醒当前任务", async () => {
    vi.setSystemTime(new Date("2026-07-02T12:00:00.000Z"));
    const snoozeTask = vi.fn();
    const { WindowManager } = await import("./windowManager");
    const manager = new WindowManager(
      {
        ...defaultAppSettings,
        display: {
          ...defaultAppSettings.display,
          islandMode: "persistent"
        }
      },
      undefined,
      {
        snapshotProvider: () => makeSnapshot("task-1"),
        taskMenuActions: {
          snoozeTask
        }
      }
    );

    await manager.createIslandWindow();
    const window = TestBrowserWindow.instances[0];

    window?.webContents.emit("context-menu");

    const menu = menuMock.buildFromTemplate.mock.results[0]?.value as { template: TestMenuItem[] };
    expect(menu.template.map((item) => item.label ?? item.type)).toEqual([
      "打开当前任务",
      "稍后提醒 15 分钟",
      "separator",
      "展开动态岛",
      "收起动态岛",
      "隐藏动态岛",
      "separator",
      "打开任务中心",
      "设置"
    ]);

    menu.template.find((item) => item.label === "稍后提醒 15 分钟")?.click?.();

    expect(snoozeTask).toHaveBeenCalledWith("task-1", "2026-07-02T12:15:00.000Z");
    expect(window?.webContents.send).toHaveBeenLastCalledWith("codepulse:island:mode", "collapsed");
  });

  it("检测到全屏应用时隐藏动态岛和贴边弹窗，退出全屏后恢复动态岛", async () => {
    const fullscreenProbe = {
      isFullscreenActive: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    };
    const { WindowManager } = await import("./windowManager");
    const manager = new WindowManager(
      {
        ...defaultAppSettings,
        display: {
          ...defaultAppSettings.display,
          islandMode: "normal",
          hideInFullscreen: true
        }
      },
      undefined,
      {
        fullscreenProbe,
        fullscreenPollIntervalMs: 1000
      }
    );

    await manager.createIslandWindow();
    await manager.openPopup(null);
    const islandWindow = TestBrowserWindow.instances[0];
    const popupWindow = TestBrowserWindow.instances[1];
    islandWindow?.emit("ready-to-show");

    manager.startFullscreenAutoHide();
    await vi.advanceTimersByTimeAsync(1000);

    expect(islandWindow?.hide).toHaveBeenCalled();
    expect(popupWindow?.hide).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);

    expect(islandWindow?.showInactive).toHaveBeenCalledTimes(2);
    expect(islandWindow?.webContents.send).toHaveBeenLastCalledWith("codepulse:island:mode", "normal");

    manager.stopFullscreenAutoHide();
  });

  it("关闭全屏自动隐藏设置后不隐藏动态岛", async () => {
    const fullscreenProbe = {
      isFullscreenActive: vi.fn().mockResolvedValue(true)
    };
    const { WindowManager } = await import("./windowManager");
    const manager = new WindowManager(
      {
        ...defaultAppSettings,
        display: {
          ...defaultAppSettings.display,
          islandMode: "normal",
          hideInFullscreen: false
        }
      },
      undefined,
      {
        fullscreenProbe,
        fullscreenPollIntervalMs: 1000
      }
    );

    await manager.createIslandWindow();
    const islandWindow = TestBrowserWindow.instances[0];
    islandWindow?.emit("ready-to-show");
    islandWindow?.hide.mockClear();

    manager.startFullscreenAutoHide();
    await vi.advanceTimersByTimeAsync(1000);

    expect(islandWindow?.hide).not.toHaveBeenCalled();
    manager.stopFullscreenAutoHide();
  });

  it("全屏探测失败时恢复已隐藏的动态岛", async () => {
    const fullscreenProbe = {
      isFullscreenActive: vi.fn().mockResolvedValueOnce(true).mockRejectedValueOnce(new Error("检测失败"))
    };
    const { WindowManager } = await import("./windowManager");
    const manager = new WindowManager(
      {
        ...defaultAppSettings,
        display: {
          ...defaultAppSettings.display,
          islandMode: "normal",
          hideInFullscreen: true
        }
      },
      undefined,
      {
        fullscreenProbe,
        fullscreenPollIntervalMs: 1000
      }
    );

    await manager.createIslandWindow();
    const islandWindow = TestBrowserWindow.instances[0];
    islandWindow?.emit("ready-to-show");

    manager.startFullscreenAutoHide();
    await vi.advanceTimersByTimeAsync(1000);
    expect(islandWindow?.hide).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);

    expect(islandWindow?.showInactive).toHaveBeenCalledTimes(2);
    manager.stopFullscreenAutoHide();
  });

  it("显示器断开后将动态岛限制回主显示器工作区", async () => {
    displayMock.displays = [
      displayMock.displays[0]!,
      {
        id: "secondary",
        scaleFactor: 1.5,
        primary: false,
        bounds: {
          x: 1920,
          y: 0,
          width: 2560,
          height: 1440
        },
        workArea: {
          x: 1920,
          y: 0,
          width: 2560,
          height: 1400
        }
      }
    ];
    const { WindowManager } = await import("./windowManager");
    const manager = new WindowManager({
      ...defaultAppSettings,
      display: {
        ...defaultAppSettings.display,
        islandMode: "expanded",
        islandPosition: "free",
        islandCustomPosition: {
          displayId: "secondary",
          x: 4200,
          y: 1360
        }
      }
    });

    await manager.createIslandWindow();
    const islandWindow = TestBrowserWindow.instances[0];
    islandWindow?.emit("ready-to-show");
    islandWindow?.setBounds.mockClear();
    displayMock.displays = [displayMock.displays[0]!];

    manager.startDisplayChangeHandling();
    screenMock.emit("display-removed");

    expect(islandWindow?.setBounds).toHaveBeenLastCalledWith({
      x: 1500,
      y: 780,
      width: 420,
      height: 260
    });
    manager.stopDisplayChangeHandling();
  });

  it("显示器指标变化时重新应用动态岛位置并关闭贴边弹窗", async () => {
    const { WindowManager } = await import("./windowManager");
    const manager = new WindowManager({
      ...defaultAppSettings,
      display: {
        ...defaultAppSettings.display,
        islandMode: "normal"
      }
    });

    await manager.createIslandWindow();
    await manager.openPopup(null);
    const islandWindow = TestBrowserWindow.instances[0];
    const popupWindow = TestBrowserWindow.instances[1];
    islandWindow?.emit("ready-to-show");
    islandWindow?.setBounds.mockClear();

    manager.startDisplayChangeHandling();
    screenMock.emit("display-metrics-changed");

    expect(islandWindow?.setBounds).toHaveBeenLastCalledWith({
      x: 780,
      y: 12,
      width: 360,
      height: 88
    });
    expect(popupWindow?.hide).toHaveBeenCalled();
    manager.stopDisplayChangeHandling();
  });

  it("系统休眠前关闭贴边弹窗，恢复后重新应用动态岛位置", async () => {
    const { WindowManager } = await import("./windowManager");
    const manager = new WindowManager({
      ...defaultAppSettings,
      display: {
        ...defaultAppSettings.display,
        islandMode: "expanded"
      }
    });

    await manager.createIslandWindow();
    await manager.openPopup(null);
    const islandWindow = TestBrowserWindow.instances[0];
    const popupWindow = TestBrowserWindow.instances[1];
    islandWindow?.emit("ready-to-show");
    islandWindow?.setBounds.mockClear();

    manager.prepareForSystemSuspend();
    manager.recoverAfterSystemResume();

    expect(popupWindow?.hide).toHaveBeenCalled();
    expect(islandWindow?.setBounds).toHaveBeenLastCalledWith({
      x: 750,
      y: 12,
      width: 420,
      height: 260
    });
  });
});

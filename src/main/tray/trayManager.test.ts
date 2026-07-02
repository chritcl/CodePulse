import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProvider, AgentStateSnapshot } from "../../shared/types/agent";
import type { RectLike } from "../../shared/types/window";

type Handler = (...args: unknown[]) => void;
type TestMenuItem = {
  label?: string;
  type?: string;
  checked?: boolean;
  click?: () => void;
};

const electronMock = vi.hoisted(() => ({
  quit: vi.fn(),
  createFromDataURL: vi.fn((value: string) => ({
    value
  })),
  buildFromTemplate: vi.fn((template: TestMenuItem[]) => ({
    template
  }))
}));

class TestTray {
  static instances: TestTray[] = [];
  static failNextCreate = false;

  readonly handlers = new Map<string, Handler[]>();
  readonly setToolTip = vi.fn((tooltip: string) => {
    this.tooltip = tooltip;
  });
  readonly setImage = vi.fn((image: unknown) => {
    this.image = image;
  });
  readonly setContextMenu = vi.fn((menu: unknown) => {
    this.contextMenu = menu;
  });
  readonly getBounds = vi.fn(() => ({
    x: 10,
    y: 20,
    width: 24,
    height: 24
  }));
  readonly destroy = vi.fn(() => {
    this.destroyed = true;
  });
  tooltip = "";
  image: unknown = null;
  contextMenu: unknown = null;
  destroyed = false;

  constructor(image: unknown) {
    if (TestTray.failNextCreate) {
      TestTray.failNextCreate = false;
      throw new Error("创建失败");
    }

    this.image = image;
    TestTray.instances.push(this);
  }

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

vi.mock("electron", () => ({
  app: {
    quit: electronMock.quit
  },
  Menu: {
    buildFromTemplate: electronMock.buildFromTemplate
  },
  nativeImage: {
    createFromDataURL: electronMock.createFromDataURL
  },
  Tray: TestTray
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

const snapshot: AgentStateSnapshot = {
  version: 1,
  generatedAt: "2026-07-01T09:00:00.000Z",
  providers: [provider],
  tasks: [],
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
    primaryTaskId: null,
    aggregateText: "1 个任务运行中",
    hasStaleData: false,
    updatedAt: "2026-07-01T09:00:00.000Z"
  }
};

const createRuntime = async () => {
  const { TrayManager } = await import("./trayManager");
  const hub = {
    subscribe: vi.fn((listener: (nextSnapshot: AgentStateSnapshot) => void) => {
      listener(snapshot);
      return vi.fn();
    }),
    refresh: vi.fn()
  };
  const trayBounds: RectLike = {
    x: 10,
    y: 20,
    width: 24,
    height: 24
  };
  const windows = {
    openPopup: vi.fn(),
    openTaskCenter: vi.fn(),
    openSettings: vi.fn(),
    setIslandMode: vi.fn(),
    getTrayBoundsRect: vi.fn(() => trayBounds)
  };

  return {
    manager: new TrayManager(hub as never, windows as never),
    hub,
    windows
  };
};

describe("TrayManager Explorer 恢复", () => {
  beforeEach(() => {
    TestTray.instances = [];
    TestTray.failNextCreate = false;
    electronMock.quit.mockClear();
    electronMock.createFromDataURL.mockClear();
    electronMock.buildFromTemplate.mockClear();
  });

  it("Explorer 重启后重建托盘并保留最新快照菜单", async () => {
    const { manager } = await createRuntime();

    manager.create();
    const firstTray = TestTray.instances[0];
    const recovered = manager.recoverAfterExplorerRestart();

    expect(recovered).toBe(true);
    expect(firstTray?.destroy).toHaveBeenCalledTimes(1);
    expect(TestTray.instances).toHaveLength(2);
    expect(TestTray.instances[1]?.tooltip).toBe("CodePulse · 1 个任务运行中");
    expect(manager.getRecoveryStatus()).toMatchObject({
      lastError: null
    });
  });

  it("Explorer 恢复重建失败时保留明确错误状态", async () => {
    const { manager } = await createRuntime();

    manager.create();
    TestTray.failNextCreate = true;
    const recovered = manager.recoverAfterExplorerRestart();

    expect(recovered).toBe(false);
    expect(manager.getRecoveryStatus().lastError).toBe("托盘图标重建失败：创建失败");
  });
});

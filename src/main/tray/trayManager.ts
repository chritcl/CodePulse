import { app, Menu, nativeImage, Tray } from "electron";
import type { AgentDisplayPriority, AgentStateSnapshot } from "../../shared/types/agent";
import type { RectLike } from "../../shared/types/window";
import type { AgentStateHub } from "../state/AgentStateHub";
import type { WindowManager } from "../windows/windowManager";

type TrayVisualStatus = "idle" | "executing" | "waiting" | "completed" | "failed" | "quota" | "disconnected";

const statusFromPriority = (priority: AgentDisplayPriority): TrayVisualStatus => {
  if (priority === "waiting") {
    return "waiting";
  }

  if (priority === "failed") {
    return "failed";
  }

  if (priority === "quotaCritical") {
    return "quota";
  }

  if (priority === "disconnected") {
    return "disconnected";
  }

  if (priority === "completed") {
    return "completed";
  }

  if (priority === "executing" || priority === "analyzing") {
    return "executing";
  }

  return "idle";
};

const iconSpec: Record<TrayVisualStatus, { color: string; symbol: string; shape: string }> = {
  idle: {
    color: "#8a96a3",
    symbol: "·",
    shape: "circle"
  },
  executing: {
    color: "#2f8cff",
    symbol: "▶",
    shape: "hexagon"
  },
  waiting: {
    color: "#f5a524",
    symbol: "!",
    shape: "diamond"
  },
  completed: {
    color: "#4cc36f",
    symbol: "✓",
    shape: "circle"
  },
  failed: {
    color: "#ff5c52",
    symbol: "×",
    shape: "square"
  },
  quota: {
    color: "#a06bff",
    symbol: "%",
    shape: "battery"
  },
  disconnected: {
    color: "#9aa6b2",
    symbol: "/",
    shape: "circle"
  }
};

const shapeSvg = (shape: string, color: string): string => {
  if (shape === "hexagon") {
    return `<polygon points="16,2 29,9 29,23 16,30 3,23 3,9" fill="${color}" stroke="white" stroke-opacity="0.7" stroke-width="1.5"/>`;
  }

  if (shape === "diamond") {
    return `<path d="M16 2 L30 16 L16 30 L2 16 Z" fill="${color}" stroke="white" stroke-opacity="0.7" stroke-width="1.5"/>`;
  }

  if (shape === "square") {
    return `<rect x="4" y="4" width="24" height="24" rx="6" fill="${color}" stroke="white" stroke-opacity="0.7" stroke-width="1.5"/>`;
  }

  if (shape === "battery") {
    return `<rect x="5" y="8" width="20" height="16" rx="4" fill="${color}" stroke="white" stroke-opacity="0.7" stroke-width="1.5"/><rect x="25" y="13" width="3" height="6" rx="1" fill="${color}"/>`;
  }

  return `<circle cx="16" cy="16" r="13" fill="${color}" stroke="white" stroke-opacity="0.7" stroke-width="1.5"/>`;
};

const createIcon = (status: TrayVisualStatus): Electron.NativeImage => {
  const spec = iconSpec[status];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${shapeSvg(
    spec.shape,
    spec.color
  )}<text x="16" y="21" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="15" font-weight="700" fill="white">${spec.symbol}</text></svg>`;

  return nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
};

export class TrayManager {
  private tray: Tray | null = null;
  private latestSnapshot: AgentStateSnapshot | null = null;
  private unsubscribe: (() => void) | null = null;
  private lastRecoveredAt: string | null = null;
  private lastRecoveryError: string | null = null;

  constructor(private readonly hub: AgentStateHub, private readonly windows: WindowManager) {}

  create(): void {
    this.createTray();
    this.unsubscribe = this.hub.subscribe((snapshot) => {
      this.latestSnapshot = snapshot;
      this.update(snapshot);
    });
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.tray?.destroy();
    this.tray = null;
  }

  recoverAfterExplorerRestart(): boolean {
    try {
      this.tray?.destroy();
      this.tray = null;
      this.createTray();

      if (this.latestSnapshot) {
        this.update(this.latestSnapshot);
      }

      this.lastRecoveredAt = new Date().toISOString();
      this.lastRecoveryError = null;
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      this.lastRecoveryError = `托盘图标重建失败：${message}`;
      console.error(this.lastRecoveryError);
      return false;
    }
  }

  getRecoveryStatus(): { lastRecoveredAt: string | null; lastError: string | null } {
    return {
      lastRecoveredAt: this.lastRecoveredAt,
      lastError: this.lastRecoveryError
    };
  }

  private createTray(): void {
    this.tray = new Tray(createIcon("idle"));
    this.tray.setToolTip("CodePulse · 空闲");
    this.tray.on("click", () => {
      void this.windows.openPopup(this.getTrayBounds());
    });
  }

  private update(snapshot: AgentStateSnapshot): void {
    if (!this.tray) {
      return;
    }

    const visualStatus = statusFromPriority(snapshot.summary.status);
    this.tray.setImage(createIcon(visualStatus));
    this.tray.setToolTip(`CodePulse · ${snapshot.summary.aggregateText}`);
    this.tray.setContextMenu(this.createMenu(snapshot));
  }

  private createMenu(snapshot: AgentStateSnapshot): Electron.Menu {
    return Menu.buildFromTemplate([
      {
        label: "打开状态面板",
        click: () => {
          void this.windows.openPopup(this.getTrayBounds());
        }
      },
      {
        label: "打开任务中心",
        click: () => {
          void this.windows.openTaskCenter(snapshot.summary.primaryTaskId ?? undefined);
        }
      },
      {
        label: "显示或隐藏动态岛",
        click: () => {
          this.windows.setIslandMode(snapshot.summary.status === "idle" ? "hidden" : "collapsed");
        }
      },
      {
        type: "separator"
      },
      {
        label: "勿扰模式",
        type: "checkbox",
        checked: false
      },
      {
        label: "暂停监控",
        type: "checkbox",
        checked: false
      },
      {
        label: "刷新状态",
        click: () => {
          void this.hub.refresh();
        }
      },
      {
        label: "设置",
        click: () => {
          void this.windows.openSettings();
        }
      },
      {
        type: "separator"
      },
      {
        label: "退出",
        click: () => {
          app.quit();
        }
      }
    ]);
  }

  private getTrayBounds(): RectLike | null {
    if (!this.tray) {
      return null;
    }

    return this.windows.getTrayBoundsRect(this.tray.getBounds());
  }

  getLatestSnapshot(): AgentStateSnapshot | null {
    return this.latestSnapshot;
  }
}

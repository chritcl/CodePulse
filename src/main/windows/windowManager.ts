import { BrowserWindow, Menu, screen } from "electron";
import path from "node:path";
import type { AppSettings, AppSettingsPatch } from "../../shared/types/settings";
import type { CodePulseWindowKind, IslandMode, RectLike } from "../../shared/types/window";
import { getDisplays } from "../system/displays";
import { NativeFullscreenProbe, type FullscreenProbe } from "../system/fullscreen";
import { normalizeIslandCustomPosition, resolveIslandPlacement } from "./islandPosition";
import { calculatePopupPosition } from "./popupPosition";

interface WindowSize {
  width: number;
  height: number;
}

interface WindowManagerOptions {
  fullscreenProbe?: FullscreenProbe;
  fullscreenPollIntervalMs?: number;
}

const islandSizes: Record<IslandMode, WindowSize> = {
  hidden: {
    width: 160,
    height: 36
  },
  collapsed: {
    width: 160,
    height: 36
  },
  normal: {
    width: 360,
    height: 88
  },
  expanded: {
    width: 420,
    height: 260
  },
  persistent: {
    width: 420,
    height: 260
  },
  dragging: {
    width: 420,
    height: 260
  }
};

const rendererDevUrl = process.env.VITE_DEV_SERVER_URL;

const preloadPath = (): string => path.join(__dirname, "../../preload/index.js");

const rendererPath = (): string => path.join(__dirname, "../../renderer/index.html");

const loadRenderer = async (window: BrowserWindow, kind: CodePulseWindowKind): Promise<void> => {
  if (rendererDevUrl) {
    await window.loadURL(`${rendererDevUrl}?window=${kind}`);
    return;
  }

  await window.loadFile(rendererPath(), {
    query: {
      window: kind
    }
  });
};

const toRect = (rect: Electron.Rectangle): RectLike => ({
  x: rect.x,
  y: rect.y,
  width: rect.width,
  height: rect.height
});

export class WindowManager {
  private islandWindow: BrowserWindow | null = null;
  private popupWindow: BrowserWindow | null = null;
  private centerWindow: BrowserWindow | null = null;
  private settingsWindow: BrowserWindow | null = null;
  private settings: AppSettings;
  private islandMoveSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private fullscreenTimer: ReturnType<typeof setInterval> | null = null;
  private lastProgrammaticIslandBoundsKey: string | null = null;
  private fullscreenCheckRunning = false;
  private hiddenForFullscreen = false;
  private displayChangeHandlingStarted = false;
  private readonly fullscreenProbe: FullscreenProbe;
  private readonly fullscreenPollIntervalMs: number;
  private readonly handleDisplayConfigurationChanged = (): void => {
    this.applyIslandMode(this.settings.display.islandMode);
    this.closePopup();
  };

  constructor(
    settings: AppSettings,
    private readonly persistSettings?: (partial: AppSettingsPatch) => Promise<AppSettings> | AppSettings | void,
    options: WindowManagerOptions = {}
  ) {
    this.settings = settings;
    this.fullscreenProbe = options.fullscreenProbe ?? new NativeFullscreenProbe(getDisplays);
    this.fullscreenPollIntervalMs = options.fullscreenPollIntervalMs ?? 3000;
  }

  updateSettings(settings: AppSettings): void {
    this.settings = settings;
    this.applyIslandMode(settings.display.islandMode);
  }

  async createIslandWindow(): Promise<BrowserWindow> {
    if (this.islandWindow && !this.islandWindow.isDestroyed()) {
      return this.islandWindow;
    }

    const size = islandSizes[this.settings.display.islandMode];
    this.islandWindow = new BrowserWindow({
      width: size.width,
      height: size.height,
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      show: false,
      skipTaskbar: true,
      alwaysOnTop: this.settings.display.alwaysOnTop,
      hasShadow: false,
      webPreferences: {
        preload: preloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });

    this.islandWindow.setAlwaysOnTop(this.settings.display.alwaysOnTop, "screen-saver");
    this.islandWindow.webContents.setWindowOpenHandler(() => ({
      action: "deny"
    }));
    this.islandWindow.webContents.on("context-menu", () => {
      this.openIslandContextMenu();
    });
    this.islandWindow.once("ready-to-show", () => {
      this.applyIslandMode(this.settings.display.islandMode);
    });
    this.islandWindow.on("move", () => {
      this.scheduleIslandPositionSave();
    });
    this.islandWindow.on("closed", () => {
      this.clearIslandMoveSaveTimer();
      this.islandWindow = null;
    });

    await loadRenderer(this.islandWindow, "island");
    return this.islandWindow;
  }

  async openPopup(trayBounds: RectLike | null): Promise<void> {
    if (this.popupWindow && !this.popupWindow.isDestroyed() && this.popupWindow.isVisible()) {
      this.closePopup();
      return;
    }

    if (!this.popupWindow || this.popupWindow.isDestroyed()) {
      this.popupWindow = new BrowserWindow({
        width: 360,
        height: 480,
        frame: false,
        resizable: false,
        movable: false,
        show: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        transparent: true,
        webPreferences: {
          preload: preloadPath(),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false
        }
      });
      this.popupWindow.webContents.setWindowOpenHandler(() => ({
        action: "deny"
      }));
      this.popupWindow.on("blur", () => {
        this.closePopup();
      });
      this.popupWindow.on("closed", () => {
        this.popupWindow = null;
      });
      await loadRenderer(this.popupWindow, "popup");
    }

    const cursorPoint = screen.getCursorScreenPoint();
    const position = calculatePopupPosition({
      trayBounds,
      cursorPoint,
      displays: getDisplays(),
      popupSize: {
        width: 360,
        height: 480
      },
      margin: 8,
      gap: 10
    });
    this.popupWindow.setBounds({
      x: position.x,
      y: position.y,
      width: 360,
      height: 480
    });
    this.popupWindow.showInactive();
    this.popupWindow.focus();
  }

  closePopup(): void {
    if (this.popupWindow && !this.popupWindow.isDestroyed()) {
      this.popupWindow.hide();
    }
  }

  prepareForSystemSuspend(): void {
    this.closePopup();
  }

  recoverAfterSystemResume(): void {
    this.applyIslandMode(this.settings.display.islandMode);
    this.closePopup();
    void this.refreshFullscreenVisibility();
  }

  startFullscreenAutoHide(): void {
    if (this.fullscreenTimer) {
      return;
    }

    this.fullscreenTimer = setInterval(() => {
      void this.refreshFullscreenVisibility();
    }, this.fullscreenPollIntervalMs);
    this.fullscreenTimer.unref?.();
  }

  stopFullscreenAutoHide(): void {
    if (this.fullscreenTimer) {
      clearInterval(this.fullscreenTimer);
      this.fullscreenTimer = null;
    }
  }

  startDisplayChangeHandling(): void {
    if (this.displayChangeHandlingStarted) {
      return;
    }

    this.displayChangeHandlingStarted = true;
    screen.on("display-added", this.handleDisplayConfigurationChanged);
    screen.on("display-removed", this.handleDisplayConfigurationChanged);
    screen.on("display-metrics-changed", this.handleDisplayConfigurationChanged);
  }

  stopDisplayChangeHandling(): void {
    if (!this.displayChangeHandlingStarted) {
      return;
    }

    this.displayChangeHandlingStarted = false;
    screen.off("display-added", this.handleDisplayConfigurationChanged);
    screen.off("display-removed", this.handleDisplayConfigurationChanged);
    screen.off("display-metrics-changed", this.handleDisplayConfigurationChanged);
  }

  async openTaskCenter(taskId?: string): Promise<void> {
    if (!this.centerWindow || this.centerWindow.isDestroyed()) {
      this.centerWindow = new BrowserWindow({
        width: 1040,
        height: 700,
        minWidth: 920,
        minHeight: 620,
        show: false,
        title: "CodePulse 任务中心",
        webPreferences: {
          preload: preloadPath(),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false
        }
      });
      this.centerWindow.webContents.setWindowOpenHandler(() => ({
        action: "deny"
      }));
      this.centerWindow.on("close", (event) => {
        if (!this.centerWindow?.isVisible()) {
          return;
        }

        event.preventDefault();
        this.centerWindow?.hide();
      });
      this.centerWindow.on("closed", () => {
        this.centerWindow = null;
      });
      await loadRenderer(this.centerWindow, "center");
    }

    this.centerWindow.show();
    this.centerWindow.focus();

    if (taskId) {
      this.centerWindow.webContents.send("codepulse:task:focus", taskId);
    }
  }

  async openSettings(): Promise<void> {
    if (!this.settingsWindow || this.settingsWindow.isDestroyed()) {
      this.settingsWindow = new BrowserWindow({
        width: 660,
        height: 560,
        minWidth: 600,
        minHeight: 520,
        show: false,
        title: "CodePulse 设置",
        webPreferences: {
          preload: preloadPath(),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false
        }
      });
      this.settingsWindow.webContents.setWindowOpenHandler(() => ({
        action: "deny"
      }));
      this.settingsWindow.on("closed", () => {
        this.settingsWindow = null;
      });
      await loadRenderer(this.settingsWindow, "settings");
    }

    this.settingsWindow.show();
    this.settingsWindow.focus();
  }

  setIslandMode(mode: IslandMode): void {
    this.settings = {
      ...this.settings,
      display: {
        ...this.settings.display,
        islandMode: mode
      }
    };
    this.applyIslandMode(mode);
  }

  private applyIslandMode(mode: IslandMode): void {
    if (!this.islandWindow || this.islandWindow.isDestroyed()) {
      return;
    }

    const size = islandSizes[mode];
    const position = resolveIslandPlacement({
      displaySettings: this.settings.display,
      displays: getDisplays(),
      size
    });

    this.setIslandBounds({
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height
    });

    if (this.hiddenForFullscreen && this.settings.display.hideInFullscreen) {
      this.islandWindow.hide();
    } else if (mode === "hidden" || !this.settings.display.islandEnabled) {
      this.islandWindow.hide();
    } else if (!this.islandWindow.isVisible()) {
      this.islandWindow.showInactive();
    }

    const canIgnoreMouse = mode === "collapsed" && this.settings.display.mouseThrough;
    this.islandWindow.setIgnoreMouseEvents(canIgnoreMouse, {
      forward: true
    });
    this.islandWindow.webContents.send("codepulse:island:mode", mode);
  }

  private async refreshFullscreenVisibility(): Promise<void> {
    if (this.fullscreenCheckRunning) {
      return;
    }

    this.fullscreenCheckRunning = true;

    try {
      const fullscreenActive = this.settings.display.hideInFullscreen && (await this.fullscreenProbe.isFullscreenActive());
      this.applyFullscreenVisibility(fullscreenActive);
    } catch {
      this.applyFullscreenVisibility(false);
    } finally {
      this.fullscreenCheckRunning = false;
    }
  }

  private applyFullscreenVisibility(fullscreenActive: boolean): void {
    if (fullscreenActive) {
      this.hiddenForFullscreen = true;
      this.islandWindow?.hide();
      this.popupWindow?.hide();
      return;
    }

    if (!this.hiddenForFullscreen) {
      return;
    }

    this.hiddenForFullscreen = false;
    this.applyIslandMode(this.settings.display.islandMode);
  }

  private openIslandContextMenu(): void {
    if (!this.islandWindow || this.islandWindow.isDestroyed()) {
      return;
    }

    Menu.buildFromTemplate([
      {
        label: "展开动态岛",
        click: () => {
          this.setIslandMode("expanded");
        }
      },
      {
        label: "收起动态岛",
        click: () => {
          this.setIslandMode("collapsed");
        }
      },
      {
        label: "隐藏动态岛",
        click: () => {
          this.setIslandMode("hidden");
        }
      },
      {
        type: "separator"
      },
      {
        label: "打开任务中心",
        click: () => {
          void this.openTaskCenter();
        }
      },
      {
        label: "设置",
        click: () => {
          void this.openSettings();
        }
      }
    ]).popup({
      window: this.islandWindow
    });
  }

  private setIslandBounds(bounds: RectLike): void {
    if (!this.islandWindow || this.islandWindow.isDestroyed()) {
      return;
    }

    this.lastProgrammaticIslandBoundsKey = this.boundsKey(bounds);
    this.islandWindow.setBounds(bounds);
  }

  private scheduleIslandPositionSave(): void {
    if (!this.islandWindow || this.islandWindow.isDestroyed()) {
      return;
    }

    const currentBounds = toRect(this.islandWindow.getBounds());
    const currentBoundsKey = this.boundsKey(currentBounds);

    if (this.lastProgrammaticIslandBoundsKey === currentBoundsKey) {
      this.lastProgrammaticIslandBoundsKey = null;
      return;
    }

    this.clearIslandMoveSaveTimer();
    this.islandMoveSaveTimer = setTimeout(() => {
      this.islandMoveSaveTimer = null;
      void this.persistIslandPosition();
    }, 350);
  }

  private async persistIslandPosition(): Promise<void> {
    if (!this.islandWindow || this.islandWindow.isDestroyed()) {
      return;
    }

    const bounds = toRect(this.islandWindow.getBounds());
    const islandCustomPosition = normalizeIslandCustomPosition({
      bounds,
      displays: getDisplays()
    });
    const nextDisplaySettings = {
      ...this.settings.display,
      islandPosition: "free" as const,
      islandCustomPosition
    };
    const nextPosition = resolveIslandPlacement({
      displaySettings: nextDisplaySettings,
      displays: getDisplays(),
      size: {
        width: bounds.width,
        height: bounds.height
      }
    });

    this.settings = {
      ...this.settings,
      display: nextDisplaySettings
    };
    this.setIslandBounds({
      x: nextPosition.x,
      y: nextPosition.y,
      width: bounds.width,
      height: bounds.height
    });
    await this.persistSettings?.({
      display: {
        islandPosition: "free",
        islandCustomPosition
      }
    });
  }

  private clearIslandMoveSaveTimer(): void {
    if (this.islandMoveSaveTimer) {
      clearTimeout(this.islandMoveSaveTimer);
      this.islandMoveSaveTimer = null;
    }
  }

  private boundsKey(bounds: RectLike): string {
    return `${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}`;
  }

  getTrayBoundsRect(bounds: Electron.Rectangle | null): RectLike | null {
    return bounds ? toRect(bounds) : null;
  }
}

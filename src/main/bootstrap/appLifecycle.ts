import { app } from "electron";
import type { NotificationManager } from "../notifications/NotificationManager";
import type { AgentStateHub } from "../state/AgentStateHub";
import type { TrayManager } from "../tray/trayManager";
import type { WindowManager } from "../windows/windowManager";

export interface AppLifecycleRuntime {
  hub: AgentStateHub;
  notifications?: NotificationManager;
  tray: TrayManager;
  windows: WindowManager;
  explorerMonitor?: { stop(): void };
  systemPowerMonitor?: { stop(): void };
  cleanupIpc: () => void;
  cleanupHistory?: () => Promise<void> | void;
}

export const registerAppLifecycle = (runtime: AppLifecycleRuntime): void => {
  app.on("second-instance", () => {
    void runtime.windows.openTaskCenter();
  });

  app.on("activate", () => {
    void runtime.windows.openTaskCenter();
  });

  app.on("before-quit", () => {
    runtime.cleanupIpc();
    void runtime.cleanupHistory?.();
    runtime.notifications?.dispose();
    runtime.systemPowerMonitor?.stop();
    runtime.explorerMonitor?.stop();
    runtime.tray.destroy();
    runtime.windows.stopDisplayChangeHandling();
    runtime.windows.stopFullscreenAutoHide();
    void runtime.hub.stop();
  });

  app.on("window-all-closed", () => {});
};

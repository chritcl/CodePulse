import { app } from "electron";
import { CodexAdapter } from "./adapters/CodexAdapter";
import { CustomCommandAdapter } from "./adapters/CustomCommandAdapter";
import { LogAdapter } from "./adapters/LogAdapter";
import { MockAdapter } from "./adapters/MockAdapter";
import { ProcessAdapter } from "./adapters/ProcessAdapter";
import { registerAppLifecycle } from "./bootstrap/appLifecycle";
import { registerIpc } from "./ipc/registerIpc";
import { ElectronNotificationPresenter } from "./notifications/ElectronNotificationPresenter";
import { NotificationManager } from "./notifications/NotificationManager";
import { HistoryStore } from "./persistence/historyStore";
import { SettingsStore } from "./persistence/settingsStore";
import { AgentStateHub } from "./state/AgentStateHub";
import { ExplorerRestartMonitor } from "./system/explorerMonitor";
import { SystemPowerMonitor } from "./system/powerMonitor";
import { TrayManager } from "./tray/trayManager";
import { WindowManager } from "./windows/windowManager";

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  void app.whenReady().then(async () => {
    app.setAppUserModelId("com.codepulse.desktop");

    const settingsStore = new SettingsStore();
    const settings = await settingsStore.load();
    const historyStore = new HistoryStore();
    await historyStore.load();
    const codexStatusFilePath = settings.providers.codex.statusFilePath;
    const codexLogFilePath = settings.providers.codex.logFilePath;
    const genericLogFilePath = settings.providers.log.logFilePath ?? process.env.CODEPULSE_AGENT_LOG_FILE ?? null;
    const hub = new AgentStateHub([
      new CodexAdapter({
        enabled: settings.providers.codex.enabled,
        ...(codexStatusFilePath ? { statusFilePath: codexStatusFilePath } : {}),
        ...(codexLogFilePath ? { logFilePath: codexLogFilePath } : {})
      }),
      new ProcessAdapter({
        enabled: settings.providers.process.enabled
      }),
      new LogAdapter({
        enabled: settings.providers.log.enabled,
        ...(genericLogFilePath ? { logFilePath: genericLogFilePath } : {})
      }),
      new CustomCommandAdapter({
        config: settings.providers.customCommand
      }),
      new MockAdapter({
        enabled: settings.providers.mock.enabled
      })
    ]);
    const windows = new WindowManager(settings, (partialSettings) => settingsStore.update(partialSettings), {
      snapshotProvider: () => hub.getSnapshot()
    });
    const tray = new TrayManager(hub, windows);
    const explorerMonitor = new ExplorerRestartMonitor({
      onExplorerRestart: () => {
        const recovered = tray.recoverAfterExplorerRestart();

        if (!recovered) {
          console.error(tray.getRecoveryStatus().lastError ?? "托盘图标重建失败");
        }
      },
      onMonitorError: (message) => {
        console.error("Explorer 监控失败", message);
      }
    });
    const systemPowerMonitor = new SystemPowerMonitor({
      onSuspend: () => {
        windows.prepareForSystemSuspend();
      },
      onResume: async () => {
        windows.recoverAfterSystemResume();
        await hub.refresh();
      },
      onMonitorError: (message) => {
        console.error(message);
      }
    });
    const notifications = new NotificationManager({
      settings,
      presenter: new ElectronNotificationPresenter(),
      openTaskCenter: (taskId) => windows.openTaskCenter(taskId)
    });
    const unsubscribeHistory = hub.subscribe((snapshot) => {
      void historyStore.saveSnapshot(snapshot).catch((error: unknown) => {
        console.error("历史记录保存失败", error);
      });
    });

    notifications.start(hub);
    const cleanupIpc = registerIpc(hub, settingsStore, windows, notifications, historyStore);
    registerAppLifecycle({
      hub,
      notifications,
      tray,
      windows,
      explorerMonitor,
      systemPowerMonitor,
      cleanupIpc,
      cleanupHistory: async () => {
        unsubscribeHistory();
        await historyStore.close();
      }
    });

    await hub.start();
    await windows.createIslandWindow();
    windows.startFullscreenAutoHide();
    windows.startDisplayChangeHandling();
    tray.create();
    explorerMonitor.start();
    systemPowerMonitor.start();
  });
}

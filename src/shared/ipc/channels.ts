export const codePulseChannels = {
  stateGetSnapshot: "codepulse:state:getSnapshot",
  stateSubscribe: "codepulse:state:subscribe",
  stateChanged: "codepulse:state:changed",
  stateRefresh: "codepulse:state:refresh",
  tasksOpen: "codepulse:tasks:open",
  tasksOpenAgent: "codepulse:tasks:openAgent",
  tasksCopySummary: "codepulse:tasks:copySummary",
  tasksListHistory: "codepulse:tasks:listHistory",
  tasksGetHistoryActivities: "codepulse:tasks:getHistoryActivities",
  tasksSnooze: "codepulse:tasks:snooze",
  tasksMarkViewed: "codepulse:tasks:markViewed",
  providersList: "codepulse:providers:list",
  providersDetect: "codepulse:providers:detect",
  providersSetEnabled: "codepulse:providers:setEnabled",
  settingsGet: "codepulse:settings:get",
  settingsUpdate: "codepulse:settings:update",
  windowsOpenTaskCenter: "codepulse:windows:openTaskCenter",
  windowsOpenSettings: "codepulse:windows:openSettings",
  windowsSetIslandMode: "codepulse:windows:setIslandMode",
  windowsClosePopup: "codepulse:windows:closePopup",
  systemGetDisplays: "codepulse:system:getDisplays",
  systemGetConnectionStatus: "codepulse:system:getConnectionStatus",
  diagnosticsExportRedacted: "codepulse:diagnostics:exportRedacted"
} as const;

export type CodePulseChannel = (typeof codePulseChannels)[keyof typeof codePulseChannels];

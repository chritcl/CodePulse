import type { AgentProvider } from "../../../shared/types/agent";

type FailureStatusConfig = Pick<CenterProviderFailureItem, "statusLabel" | "severity" | "recoveryText">;

export interface CenterProviderFailureItem {
  providerId: string;
  providerName: string;
  statusLabel: string;
  severity: "info" | "warning" | "error";
  recoveryText: string;
  lastErrorAt: string | null;
}

const statusConfig: Record<AgentProvider["connectionStatus"], FailureStatusConfig | null> = {
  connected: null,
  unknown: {
    statusLabel: "状态未知",
    severity: "info",
    recoveryText: "刷新状态或检查数据源配置"
  },
  detecting: {
    statusLabel: "正在检测",
    severity: "info",
    recoveryText: "请稍候，或手动刷新状态"
  },
  disconnected: {
    statusLabel: "数据源断开",
    severity: "warning",
    recoveryText: "检查进程、日志路径或状态源后刷新状态"
  },
  error: {
    statusLabel: "数据源异常",
    severity: "error",
    recoveryText: "查看诊断信息或重新配置数据源"
  },
  permissionDenied: {
    statusLabel: "文件无权限",
    severity: "error",
    recoveryText: "检查日志或状态源文件权限后刷新状态"
  },
  notFound: {
    statusLabel: "未发现 Agent",
    severity: "warning",
    recoveryText: "确认工具已安装并加入 PATH"
  },
  notRunning: {
    statusLabel: "Agent 未运行",
    severity: "warning",
    recoveryText: "启动对应 Agent 后刷新状态"
  },
  stale: {
    statusLabel: "状态数据过期",
    severity: "warning",
    recoveryText: "检查数据源是否仍在更新"
  }
};

const severityOrder: Record<CenterProviderFailureItem["severity"], number> = {
  error: 0,
  warning: 1,
  info: 2
};

export const buildCenterProviderFailures = (providers: AgentProvider[]): CenterProviderFailureItem[] =>
  providers
    .filter((provider) => provider.enabled)
    .map((provider) => {
      const config = statusConfig[provider.connectionStatus];

      if (!config) {
        return null;
      }

      return {
        providerId: provider.id,
        providerName: provider.name,
        statusLabel: config.statusLabel,
        severity: config.severity,
        recoveryText: config.recoveryText,
        lastErrorAt: provider.lastErrorAt
      };
    })
    .filter((item): item is CenterProviderFailureItem => item !== null)
    .sort((left, right) => {
      const severityDiff = severityOrder[left.severity] - severityOrder[right.severity];
      return severityDiff === 0 ? left.providerName.localeCompare(right.providerName, "zh-CN") : severityDiff;
    });

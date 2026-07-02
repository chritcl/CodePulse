import { describe, expect, it } from "vitest";
import type { AgentProvider } from "../../../shared/types/agent";
import { buildCenterProviderFailures } from "./centerProviderFailures";

const makeProvider = (partial: Partial<AgentProvider> & Pick<AgentProvider, "id" | "connectionStatus">): AgentProvider => ({
  id: partial.id,
  name: partial.name ?? partial.id,
  icon: partial.icon ?? "terminal",
  adapterType: partial.adapterType ?? "codex",
  enabled: partial.enabled ?? true,
  connectionStatus: partial.connectionStatus,
  lastConnectedAt: partial.lastConnectedAt ?? null,
  lastErrorAt: partial.lastErrorAt ?? null,
  capabilities: partial.capabilities ?? []
});

describe("任务中心数据源失败展示", () => {
  it("只展示启用数据源的异常状态并给出恢复建议", () => {
    const providers = [
      makeProvider({
        id: "codex",
        name: "Codex",
        connectionStatus: "notRunning"
      }),
      makeProvider({
        id: "log",
        name: "通用日志",
        connectionStatus: "permissionDenied",
        lastErrorAt: "2026-07-01T10:00:00.000Z"
      }),
      makeProvider({
        id: "mock",
        name: "模拟数据",
        connectionStatus: "connected"
      }),
      makeProvider({
        id: "disabled",
        name: "停用数据源",
        connectionStatus: "error",
        enabled: false
      })
    ];

    expect(buildCenterProviderFailures(providers)).toEqual([
      {
        providerId: "log",
        providerName: "通用日志",
        statusLabel: "文件无权限",
        severity: "error",
        recoveryText: "检查日志或状态源文件权限后刷新状态",
        lastErrorAt: "2026-07-01T10:00:00.000Z"
      },
      {
        providerId: "codex",
        providerName: "Codex",
        statusLabel: "Agent 未运行",
        severity: "warning",
        recoveryText: "启动对应 Agent 后刷新状态",
        lastErrorAt: null
      }
    ]);
  });

  it("没有异常数据源时返回空列表", () => {
    expect(
      buildCenterProviderFailures([
        makeProvider({
          id: "codex",
          connectionStatus: "connected"
        }),
        makeProvider({
          id: "mock",
          connectionStatus: "unknown",
          enabled: false
        })
      ])
    ).toEqual([]);
  });
});

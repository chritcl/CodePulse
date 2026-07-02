import { describe, expect, it } from "vitest";
import type { AgentProvider, AgentStateSnapshot, AgentTask, QuotaSnapshot } from "../../../shared/types/agent";
import { priorityFromTaskStatus } from "../../../shared/constants/priority";
import { createIslandStateMachine } from "./islandStateMachine";

const provider: AgentProvider = {
  id: "codex",
  name: "Codex",
  icon: "terminal",
  adapterType: "codex",
  enabled: true,
  connectionStatus: "connected",
  lastConnectedAt: "2026-07-01T03:00:00.000Z",
  lastErrorAt: null,
  capabilities: []
};

const makeTask = (id: string, status: AgentTask["status"], stage = "执行中", updatedAt = "2026-07-01T03:00:00.000Z"): AgentTask => ({
  id,
  providerId: provider.id,
  sessionId: `${id}-session`,
  title: `${id} 任务`,
  projectName: "CodePulse",
  projectPath: null,
  status,
  stage,
  priority: priorityFromTaskStatus(status),
  startedAt: "2026-07-01T02:50:00.000Z",
  updatedAt,
  completedAt: status === "completed" ? updatedAt : null,
  lastActivityAt: updatedAt,
  lastActivityText: "最近活动",
  progressType: "unavailable",
  progressValue: null,
  completedSteps: null,
  totalSteps: null,
  waitingAction: null,
  errorCode: status === "failed" ? "FAILED" : null,
  errorMessage: status === "failed" ? "任务失败" : null,
  sourceId: "test"
});

const makeQuota = (remainingPercent: number): QuotaSnapshot => ({
  id: "quota",
  providerId: provider.id,
  total: 100,
  used: 100 - remainingPercent,
  remaining: remainingPercent,
  remainingPercent,
  resetAt: null,
  capturedAt: "2026-07-01T03:00:00.000Z",
  expiresAt: "2026-07-01T03:10:00.000Z",
  isEstimated: false,
  source: "test",
  errorMessage: null
});

const makeSnapshot = (parts: Partial<AgentStateSnapshot>): AgentStateSnapshot => ({
  version: 1,
  generatedAt: "2026-07-01T03:00:00.000Z",
  providers: [provider],
  tasks: [],
  activities: [],
  quotas: [],
  summary: {
    status: "idle",
    label: "空闲",
    runningTaskCount: 0,
    waitingTaskCount: 0,
    failedTaskCount: 0,
    completedTaskCount: 0,
    disconnectedProviderCount: 0,
    quotaCriticalProviderCount: 0,
    primaryTaskId: null,
    aggregateText: "空闲",
    hasStaleData: false,
    updatedAt: "2026-07-01T03:00:00.000Z"
  },
  ...parts
});

describe("动态岛状态机", () => {
  it("等待、失败、额度耗尽和数据源断开会进入持续提醒", () => {
    const machine = createIslandStateMachine({
      autoCollapseDelay: 5000,
      now: () => 0
    });

    machine.applySnapshot(makeSnapshot({ tasks: [makeTask("waiting", "waiting")] }));
    expect(machine.getState().mode).toBe("persistent");

    machine.applySnapshot(makeSnapshot({ tasks: [makeTask("failed", "failed")] }));
    expect(machine.getState().mode).toBe("persistent");

    machine.applySnapshot(makeSnapshot({ quotas: [makeQuota(0)] }));
    expect(machine.getState().mode).toBe("persistent");

    machine.applySnapshot(
      makeSnapshot({
        providers: [
          {
            ...provider,
            connectionStatus: "disconnected"
          }
        ]
      })
    );
    expect(machine.getState().mode).toBe("persistent");
  });

  it("任务开始、阶段变化、任务完成和额度阈值跨越会短暂展开且阶段变化会节流", () => {
    let now = 0;
    const machine = createIslandStateMachine({
      autoCollapseDelay: 5000,
      eventThrottleMs: 10000,
      now: () => now
    });

    machine.applySnapshot(makeSnapshot({ tasks: [makeTask("running", "executing", "编码")] }));
    expect(machine.getState().mode).toBe("normal");

    now = 1000;
    machine.tick();
    machine.applySnapshot(makeSnapshot({ tasks: [makeTask("running", "executing", "测试", "2026-07-01T03:00:01.000Z")] }));
    expect(machine.getState().lastTrigger).toBe("taskStarted");

    now = 11000;
    machine.applySnapshot(makeSnapshot({ tasks: [makeTask("running", "executing", "打包", "2026-07-01T03:00:11.000Z")] }));
    expect(machine.getState().lastTrigger).toBe("stageChanged");

    now = 20000;
    machine.applySnapshot(makeSnapshot({ tasks: [makeTask("running", "completed", "完成", "2026-07-01T03:00:20.000Z")] }));
    expect(machine.getState().lastTrigger).toBe("taskCompleted");

    now = 30000;
    machine.applySnapshot(makeSnapshot({ quotas: [makeQuota(12)] }));
    expect(machine.getState().lastTrigger).toBe("quotaThreshold");
  });

  it("自动收起会尊重悬停暂停", () => {
    let now = 0;
    const machine = createIslandStateMachine({
      autoCollapseDelay: 5000,
      now: () => now
    });

    machine.applySnapshot(makeSnapshot({ tasks: [makeTask("running", "executing")] }));
    machine.setHovered(true);
    now = 6000;
    machine.tick();
    expect(machine.getState().mode).toBe("normal");

    machine.setHovered(false);
    now = 12000;
    machine.tick();
    expect(machine.getState().mode).toBe("collapsed");
  });

  it("持续提醒不会被自动收起，用户查看后保持展开", () => {
    let now = 0;
    const machine = createIslandStateMachine({
      autoCollapseDelay: 5000,
      now: () => now
    });

    machine.applySnapshot(makeSnapshot({ tasks: [makeTask("waiting", "waiting")] }));
    now = 10000;
    machine.tick();
    expect(machine.getState().mode).toBe("persistent");

    machine.expandFromPersistent();
    now = 20000;
    machine.tick();
    expect(machine.getState().mode).toBe("expanded");
  });

  it("滚轮会在任务之间切换当前任务", () => {
    const machine = createIslandStateMachine({
      autoCollapseDelay: 5000,
      now: () => 0
    });

    machine.applySnapshot(
      makeSnapshot({
        tasks: [makeTask("one", "executing"), makeTask("two", "waiting"), makeTask("three", "failed")]
      })
    );

    expect(machine.getActiveTaskId()).toBe("one");
    expect(machine.handleWheel(1)).toBe("two");
    expect(machine.handleWheel(1)).toBe("three");
    expect(machine.handleWheel(-1)).toBe("two");
  });

  it("状态恢复后持续提醒会回到收起态", () => {
    const machine = createIslandStateMachine({
      autoCollapseDelay: 5000,
      now: () => 0
    });

    machine.applySnapshot(makeSnapshot({ tasks: [makeTask("waiting", "waiting")] }));
    machine.applySnapshot(makeSnapshot({ tasks: [] }));

    expect(machine.getState().mode).toBe("collapsed");
  });
});

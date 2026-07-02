import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentAdapter, AgentAdapterEvent, AgentAdapterEventListener, AdapterDetectionResult } from "../../shared/types/adapter";
import type { AgentConnectionStatus, AgentProvider, AgentTask, QuotaSnapshot } from "../../shared/types/agent";
import { priorityFromTaskStatus } from "../../shared/constants/priority";

export interface ProcessInfo {
  pid: number | null;
  name: string;
  commandLine: string;
}

export interface ProcessProbe {
  listProcesses(): Promise<ProcessInfo[]>;
}

export interface ProcessAgentDefinition {
  id: string;
  name: string;
  patterns: RegExp[];
}

export interface ProcessAdapterOptions {
  enabled?: boolean;
  processProbe?: ProcessProbe;
  definitions?: ProcessAgentDefinition[];
  now?: () => Date;
  scanIntervalMs?: number;
}

interface MatchedProcess {
  processInfo: ProcessInfo;
  definition: ProcessAgentDefinition;
  index: number;
}

const execFileAsync = promisify(execFile);
const processOutputLimit = 1024 * 1024;
const processCommandTimeoutMs = 5000;
const defaultScanIntervalMs = 15_000;

const toIso = (date: Date): string => date.toISOString();

const toNumberOrNull = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toStringValue = (value: unknown): string => (typeof value === "string" ? value : "");

const parseWindowsProcessList = (stdout: string): ProcessInfo[] => {
  const trimmed = stdout.trim();

  if (!trimmed) {
    return [];
  }

  const parsed = JSON.parse(trimmed) as unknown;
  const records = Array.isArray(parsed) ? parsed : [parsed];

  return records
    .filter((record): record is Record<string, unknown> => typeof record === "object" && record !== null)
    .map((record) => ({
      pid: toNumberOrNull(record.ProcessId),
      name: toStringValue(record.Name),
      commandLine: toStringValue(record.CommandLine)
    }));
};

const parsePosixProcessList = (stdout: string): ProcessInfo[] =>
  stdout
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(\d+)\s+(\S+)\s*(.*)$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => ({
      pid: toNumberOrNull(match[1]),
      name: match[2] ?? "",
      commandLine: match[3] ?? ""
    }));

class NativeProcessProbe implements ProcessProbe {
  async listProcesses(): Promise<ProcessInfo[]> {
    if (process.platform === "win32") {
      const command =
        "Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress";
      const { stdout } = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
        {
          timeout: processCommandTimeoutMs,
          maxBuffer: processOutputLimit,
          windowsHide: true
        }
      );

      return parseWindowsProcessList(String(stdout));
    }

    const { stdout } = await execFileAsync("ps", ["-axo", "pid=,comm=,args="], {
      timeout: processCommandTimeoutMs,
      maxBuffer: processOutputLimit
    });

    return parsePosixProcessList(String(stdout));
  }
}

const defaultDefinitions: ProcessAgentDefinition[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    patterns: [/(^|[\\/\s"'])claude(\.exe)?($|[\s"'])/i, /claude-code/i]
  },
  {
    id: "cursor-agent",
    name: "Cursor Agent",
    patterns: [/cursor-agent/i, /cursor.*(?:agent|composer)/i]
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    patterns: [/(^|[\\/\s"'])gemini(\.exe)?($|[\s"'])/i, /google-gemini/i]
  }
];

const getErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : "进程检测失败");

export class ProcessAdapter implements AgentAdapter {
  readonly provider: AgentProvider = {
    id: "process",
    name: "本机 Agent 进程",
    icon: "activity",
    adapterType: "process",
    enabled: true,
    connectionStatus: "unknown",
    lastConnectedAt: null,
    lastErrorAt: null,
    capabilities: [
      {
        id: "processDetection",
        label: "进程检测",
        enabled: true
      },
      {
        id: "quota",
        label: "额度状态",
        enabled: false
      }
    ]
  };

  private readonly listeners = new Set<AgentAdapterEventListener>();
  private readonly processProbe: ProcessProbe;
  private readonly definitions: ProcessAgentDefinition[];
  private readonly now: () => Date;
  private readonly scanIntervalMs: number;
  private readonly firstSeenAtByProcessKey = new Map<string, string>();
  private connectionStatus: AgentConnectionStatus = "unknown";
  private currentTasks: AgentTask[] = [];
  private running = false;
  private scanTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: ProcessAdapterOptions = {}) {
    this.provider.enabled = options.enabled ?? true;
    this.processProbe = options.processProbe ?? new NativeProcessProbe();
    this.definitions = options.definitions ?? defaultDefinitions;
    this.now = options.now ?? (() => new Date());
    this.scanIntervalMs = options.scanIntervalMs ?? defaultScanIntervalMs;
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    await this.refresh();

    if (this.scanIntervalMs > 0) {
      this.scanTimer = setInterval(() => {
        void this.refresh();
      }, this.scanIntervalMs);
      this.scanTimer.unref?.();
    }
  }

  async stop(): Promise<void> {
    this.running = false;

    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
  }

  async detect(): Promise<AdapterDetectionResult> {
    const occurredAt = toIso(this.now());

    try {
      const matches = await this.readMatches();
      const detected = matches.length > 0;
      this.connectionStatus = detected ? "connected" : "notRunning";
      this.currentTasks = this.buildTasks(matches, occurredAt);

      return {
        provider: this.buildProviderSnapshot(occurredAt),
        detected,
        message: detected ? `已检测到 ${matches.length} 个本机 Agent 进程` : "未发现已知 Agent 进程"
      };
    } catch (error) {
      const message = getErrorMessage(error);
      this.connectionStatus = "error";
      this.currentTasks = [];

      return {
        provider: this.buildProviderSnapshot(occurredAt),
        detected: false,
        message
      };
    }
  }

  async refresh(): Promise<void> {
    const occurredAt = toIso(this.now());

    try {
      const matches = await this.readMatches();
      const nextStatus: AgentConnectionStatus = matches.length > 0 ? "connected" : "notRunning";
      this.currentTasks = this.buildTasks(matches, occurredAt);
      this.updateConnection(nextStatus, nextStatus === "connected" ? "本机 Agent 进程运行中" : "未发现已知 Agent 进程", occurredAt);
      this.emit({
        type: "tasks:updated",
        providerId: this.provider.id,
        tasks: this.currentTasks,
        occurredAt
      });
      this.emit({
        type: "quota:updated",
        providerId: this.provider.id,
        quota: await this.getQuota(),
        occurredAt
      });
    } catch (error) {
      const message = getErrorMessage(error);
      this.currentTasks = [];
      this.updateConnection("error", message, occurredAt);
      this.emit({
        type: "tasks:updated",
        providerId: this.provider.id,
        tasks: [],
        occurredAt
      });
      this.emit({
        type: "error:raised",
        providerId: this.provider.id,
        code: "PROCESS_DETECT_FAILED",
        message,
        occurredAt
      });
    }
  }

  subscribe(listener: AgentAdapterEventListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  async getCurrentTasks(): Promise<AgentTask[]> {
    return this.currentTasks;
  }

  async getQuota(): Promise<QuotaSnapshot> {
    const capturedAt = toIso(this.now());

    return {
      id: "process-quota-unavailable",
      providerId: this.provider.id,
      total: null,
      used: null,
      remaining: null,
      remainingPercent: null,
      resetAt: null,
      capturedAt,
      expiresAt: toIso(new Date(this.now().getTime() + 5 * 60 * 1000)),
      isEstimated: false,
      source: "process",
      errorMessage: "额度暂不可用"
    };
  }

  async getConnectionStatus(): Promise<AgentConnectionStatus> {
    return this.connectionStatus;
  }

  async dispose(): Promise<void> {
    await this.stop();
    this.listeners.clear();
    this.currentTasks = [];
    this.firstSeenAtByProcessKey.clear();
  }

  private async readMatches(): Promise<MatchedProcess[]> {
    const processes = await this.processProbe.listProcesses();
    const matches: MatchedProcess[] = [];

    processes.forEach((processInfo, index) => {
      const definition = this.findDefinition(processInfo);

      if (definition) {
        matches.push({
          processInfo,
          definition,
          index
        });
      }
    });

    return matches;
  }

  private findDefinition(processInfo: ProcessInfo): ProcessAgentDefinition | null {
    const searchableText = `${processInfo.name} ${processInfo.commandLine}`;
    return this.definitions.find((definition) => definition.patterns.some((pattern) => pattern.test(searchableText))) ?? null;
  }

  private buildTasks(matches: MatchedProcess[], occurredAt: string): AgentTask[] {
    const activeKeys = new Set<string>();
    const tasks = matches.map((match) => {
      const processKey = this.getProcessKey(match);
      activeKeys.add(processKey);
      const startedAt = this.firstSeenAtByProcessKey.get(processKey) ?? occurredAt;
      this.firstSeenAtByProcessKey.set(processKey, startedAt);
      const pidText = match.processInfo.pid === null ? "" : ` · PID ${match.processInfo.pid}`;

      return {
        id: `process-${processKey}`,
        providerId: this.provider.id,
        sessionId: `process-${processKey}`,
        title: `${match.definition.name} 进程运行中`,
        projectName: "本机 Agent",
        projectPath: null,
        status: "executing",
        stage: "进程运行",
        priority: priorityFromTaskStatus("executing"),
        startedAt,
        updatedAt: occurredAt,
        completedAt: null,
        lastActivityAt: occurredAt,
        lastActivityText: `检测到 ${match.definition.name} 进程${pidText}`,
        progressType: "indeterminate",
        progressValue: null,
        completedSteps: null,
        totalSteps: null,
        waitingAction: null,
        errorCode: null,
        errorMessage: null,
        sourceId: `process-${match.definition.id}`
      } satisfies AgentTask;
    });

    for (const processKey of this.firstSeenAtByProcessKey.keys()) {
      if (!activeKeys.has(processKey)) {
        this.firstSeenAtByProcessKey.delete(processKey);
      }
    }

    return tasks;
  }

  private getProcessKey(match: MatchedProcess): string {
    if (match.processInfo.pid !== null) {
      return `${match.definition.id}-pid-${match.processInfo.pid}`;
    }

    return `${match.definition.id}-unknown-${match.index}`;
  }

  private updateConnection(status: AgentConnectionStatus, message: string, occurredAt: string): void {
    this.connectionStatus = status;
    this.emit({
      type: "connection:changed",
      providerId: this.provider.id,
      status,
      message,
      occurredAt
    });
    this.emit({
      type: "provider:updated",
      provider: this.buildProviderSnapshot(occurredAt),
      occurredAt
    });
  }

  private buildProviderSnapshot(occurredAt: string): AgentProvider {
    return {
      ...this.provider,
      connectionStatus: this.connectionStatus,
      lastConnectedAt: this.connectionStatus === "connected" ? occurredAt : this.provider.lastConnectedAt,
      lastErrorAt: this.connectionStatus === "connected" ? this.provider.lastErrorAt : occurredAt
    };
  }

  private emit(event: AgentAdapterEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

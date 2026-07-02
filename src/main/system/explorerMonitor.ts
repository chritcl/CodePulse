import { execFile } from "node:child_process";
import { promisify } from "node:util";

export interface ExplorerProcessProbe {
  getExplorerProcessIds(): Promise<number[]>;
}

export interface ExplorerRestartMonitorOptions {
  probe?: ExplorerProcessProbe;
  pollIntervalMs?: number;
  onExplorerRestart: () => void | Promise<void>;
  onMonitorError?: (message: string) => void;
}

const execFileAsync = promisify(execFile);
const explorerProbeTimeoutMs = 1500;
const explorerProbeOutputLimit = 64 * 1024;

const normalizeProcessIds = (value: unknown): number[] => {
  const values = Array.isArray(value) ? value : [value];

  return Array.from(
    new Set(
      values
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0)
        .sort((left, right) => left - right)
    )
  );
};

const processKey = (ids: number[]): string => ids.join(",");

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : "Explorer 监控失败");

export class NativeExplorerProcessProbe implements ExplorerProcessProbe {
  async getExplorerProcessIds(): Promise<number[]> {
    if (process.platform !== "win32") {
      return [];
    }

    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "Get-Process -Name explorer -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id | ConvertTo-Json -Compress"
      ],
      {
        timeout: explorerProbeTimeoutMs,
        maxBuffer: explorerProbeOutputLimit,
        windowsHide: true
      }
    );
    const output = String(stdout).trim();

    if (!output) {
      return [];
    }

    return normalizeProcessIds(JSON.parse(output) as unknown);
  }
}

export class ExplorerRestartMonitor {
  private readonly probe: ExplorerProcessProbe;
  private readonly pollIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private checking = false;
  private lastExplorerProcessKey: string | null = null;

  constructor(private readonly options: ExplorerRestartMonitorOptions) {
    this.probe = options.probe ?? new NativeExplorerProcessProbe();
    this.pollIntervalMs = options.pollIntervalMs ?? 5000;
  }

  start(): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.checkExplorerProcess();
    }, this.pollIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }

  private async checkExplorerProcess(): Promise<void> {
    if (this.checking) {
      return;
    }

    this.checking = true;

    try {
      const ids = await this.probe.getExplorerProcessIds();

      if (ids.length === 0) {
        return;
      }

      const nextKey = processKey(ids);

      if (this.lastExplorerProcessKey === null) {
        this.lastExplorerProcessKey = nextKey;
        return;
      }

      if (this.lastExplorerProcessKey === nextKey) {
        return;
      }

      this.lastExplorerProcessKey = nextKey;
      await this.options.onExplorerRestart();
    } catch (error) {
      this.options.onMonitorError?.(errorMessage(error));
    } finally {
      this.checking = false;
    }
  }
}

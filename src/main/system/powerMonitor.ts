import { powerMonitor } from "electron";

export interface SystemPowerMonitorStatus {
  suspended: boolean;
  lastSuspendedAt: string | null;
  lastResumedAt: string | null;
  lastError: string | null;
}

export interface SystemPowerMonitorOptions {
  onSuspend: () => void | Promise<void>;
  onResume: () => void | Promise<void>;
  onMonitorError?: (message: string) => void;
  now?: () => Date;
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : "未知错误");

export class SystemPowerMonitor {
  private started = false;
  private readonly now: () => Date;
  private status: SystemPowerMonitorStatus = {
    suspended: false,
    lastSuspendedAt: null,
    lastResumedAt: null,
    lastError: null
  };
  private readonly handleSuspend = (): void => {
    void this.processSuspend();
  };
  private readonly handleResume = (): void => {
    void this.processResume();
  };

  constructor(private readonly options: SystemPowerMonitorOptions) {
    this.now = options.now ?? (() => new Date());
  }

  start(): void {
    if (this.started) {
      return;
    }

    this.started = true;
    powerMonitor.on("suspend", this.handleSuspend);
    powerMonitor.on("resume", this.handleResume);
  }

  stop(): void {
    if (!this.started) {
      return;
    }

    this.started = false;
    powerMonitor.off("suspend", this.handleSuspend);
    powerMonitor.off("resume", this.handleResume);
  }

  getStatus(): SystemPowerMonitorStatus {
    return {
      ...this.status
    };
  }

  private async processSuspend(): Promise<void> {
    this.status = {
      ...this.status,
      suspended: true,
      lastSuspendedAt: this.now().toISOString(),
      lastError: null
    };

    try {
      await this.options.onSuspend();
    } catch (error) {
      this.recordError(`系统休眠处理失败：${errorMessage(error)}`);
    }
  }

  private async processResume(): Promise<void> {
    this.status = {
      ...this.status,
      suspended: false,
      lastResumedAt: this.now().toISOString(),
      lastError: null
    };

    try {
      await this.options.onResume();
    } catch (error) {
      this.recordError(`系统恢复处理失败：${errorMessage(error)}`);
    }
  }

  private recordError(message: string): void {
    this.status = {
      ...this.status,
      lastError: message
    };
    this.options.onMonitorError?.(message);
  }
}

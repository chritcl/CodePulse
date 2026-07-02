import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DisplayLike, RectLike } from "../../shared/types/window";

export interface FullscreenProbe {
  isFullscreenActive(): Promise<boolean>;
}

interface ForegroundWindowInfo {
  processId: number | null;
  bounds: RectLike | null;
}

const execFileAsync = promisify(execFile);
const fullscreenProbeTimeoutMs = 1500;
const fullscreenProbeOutputLimit = 64 * 1024;
const fullscreenTolerance = 2;

const toNumberOrNull = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const readForegroundWindowInfo = (value: unknown): ForegroundWindowInfo => {
  if (typeof value !== "object" || value === null) {
    return {
      processId: null,
      bounds: null
    };
  }

  const record = value as Record<string, unknown>;
  const left = toNumberOrNull(record.Left);
  const top = toNumberOrNull(record.Top);
  const right = toNumberOrNull(record.Right);
  const bottom = toNumberOrNull(record.Bottom);

  if (left === null || top === null || right === null || bottom === null) {
    return {
      processId: toNumberOrNull(record.ProcessId),
      bounds: null
    };
  }

  return {
    processId: toNumberOrNull(record.ProcessId),
    bounds: {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top
    }
  };
};

const isNear = (left: number, right: number): boolean => Math.abs(left - right) <= fullscreenTolerance;

export const isFullscreenBounds = (bounds: RectLike | null, displays: DisplayLike[]): boolean => {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    return false;
  }

  return displays.some((display) => {
    const displayBounds = display.bounds;

    return (
      isNear(bounds.x, displayBounds.x) &&
      isNear(bounds.y, displayBounds.y) &&
      isNear(bounds.width, displayBounds.width) &&
      isNear(bounds.height, displayBounds.height)
    );
  });
};

export class NativeFullscreenProbe implements FullscreenProbe {
  constructor(private readonly getDisplays: () => DisplayLike[]) {}

  async isFullscreenActive(): Promise<boolean> {
    if (process.platform !== "win32") {
      return false;
    }

    const script = `
$signature = @'
using System;
using System.Runtime.InteropServices;
public class CodePulseForegroundWindow {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
public struct RECT {
  public int Left;
  public int Top;
  public int Right;
  public int Bottom;
}
'@
Add-Type -TypeDefinition $signature -ErrorAction SilentlyContinue
$handle = [CodePulseForegroundWindow]::GetForegroundWindow()
$rect = New-Object RECT
$processId = 0
[void][CodePulseForegroundWindow]::GetWindowThreadProcessId($handle, [ref]$processId)
[void][CodePulseForegroundWindow]::GetWindowRect($handle, [ref]$rect)
[PSCustomObject]@{
  ProcessId = $processId
  Left = $rect.Left
  Top = $rect.Top
  Right = $rect.Right
  Bottom = $rect.Bottom
} | ConvertTo-Json -Compress
`;
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      {
        timeout: fullscreenProbeTimeoutMs,
        maxBuffer: fullscreenProbeOutputLimit,
        windowsHide: true
      }
    );
    const foregroundWindow = readForegroundWindowInfo(JSON.parse(String(stdout).trim()) as unknown);

    if (foregroundWindow.processId === process.pid) {
      return false;
    }

    return isFullscreenBounds(foregroundWindow.bounds, this.getDisplays());
  }
}

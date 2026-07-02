import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SettingsStore } from "./settingsStore";

describe("SettingsStore", () => {
  it("合并并持久化 Codex、本机进程、通用日志、模拟和自定义命令设置", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codepulse-settings-"));
    const filePath = path.join(directory, "settings.json");

    try {
      const store = new SettingsStore(filePath);

      await store.load();
      const settings = await store.update({
        providers: {
          codex: {
            enabled: false,
            statusFilePath: "C:\\Users\\fengq\\codex-status.json",
            logFilePath: "C:\\Users\\fengq\\codex.log"
          },
          process: {
            enabled: false
          },
          log: {
            enabled: false,
            logFilePath: "C:\\Users\\fengq\\agent.log"
          },
          mock: {
            enabled: false
          },
          customCommand: {
            enabled: true,
            authorized: true,
            commandPath: "C:\\Tools\\agent-status.exe",
            args: ["--json"],
            workingDirectory: "C:\\Users\\fengq\\agent",
            timeoutMs: 3000,
            outputLimitBytes: 8192
          }
        }
      });
      const raw = await readFile(filePath, "utf8");

      expect(settings.providers.codex.enabled).toBe(false);
      expect(settings.providers.codex.statusFilePath).toBe("C:\\Users\\fengq\\codex-status.json");
      expect(settings.providers.codex.logFilePath).toBe("C:\\Users\\fengq\\codex.log");
      expect(settings.providers.process.enabled).toBe(false);
      expect(settings.providers.log.enabled).toBe(false);
      expect(settings.providers.log.logFilePath).toBe("C:\\Users\\fengq\\agent.log");
      expect(settings.providers.mock.enabled).toBe(false);
      expect(settings.providers.customCommand.enabled).toBe(true);
      expect(settings.providers.customCommand.authorized).toBe(true);
      expect(settings.providers.customCommand.commandPath).toBe("C:\\Tools\\agent-status.exe");
      expect(settings.providers.customCommand.args).toEqual(["--json"]);
      expect(settings.providers.customCommand.workingDirectory).toBe("C:\\Users\\fengq\\agent");
      expect(settings.providers.customCommand.timeoutMs).toBe(3000);
      expect(settings.providers.customCommand.outputLimitBytes).toBe(8192);
      expect(JSON.parse(raw).providers.codex.enabled).toBe(false);
      expect(JSON.parse(raw).providers.codex.statusFilePath).toBe("C:\\Users\\fengq\\codex-status.json");
      expect(JSON.parse(raw).providers.codex.logFilePath).toBe("C:\\Users\\fengq\\codex.log");
      expect(JSON.parse(raw).providers.process.enabled).toBe(false);
      expect(JSON.parse(raw).providers.log.enabled).toBe(false);
      expect(JSON.parse(raw).providers.log.logFilePath).toBe("C:\\Users\\fengq\\agent.log");
      expect(JSON.parse(raw).providers.mock.enabled).toBe(false);
      expect(JSON.parse(raw).providers.customCommand.enabled).toBe(true);
      expect(JSON.parse(raw).providers.customCommand.authorized).toBe(true);
      expect(JSON.parse(raw).providers.customCommand.commandPath).toBe("C:\\Tools\\agent-status.exe");
    } finally {
      await rm(directory, {
        recursive: true,
        force: true
      });
    }
  });

  it("加载旧设置时保留已配置通用日志源的启用状态", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codepulse-settings-"));
    const filePath = path.join(directory, "settings.json");

    try {
      await writeFile(
        filePath,
        `${JSON.stringify(
          {
            providers: {
              log: {
                logFilePath: "C:\\Users\\fengq\\agent.log"
              }
            }
          },
          null,
          2
        )}\n`,
        "utf8"
      );
      const store = new SettingsStore(filePath);
      const settings = await store.load();

      expect(settings.providers.log.enabled).toBe(true);
      expect(settings.providers.log.logFilePath).toBe("C:\\Users\\fengq\\agent.log");
    } finally {
      await rm(directory, {
        recursive: true,
        force: true
      });
    }
  });
});

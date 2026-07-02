import { app } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppSettings, AppSettingsPatch, LogProviderSettings } from "../../shared/types/settings";
import { defaultAppSettings } from "../../shared/types/settings";
import { isRecord } from "../../shared/ipc/schema";

const mergeLogProviderSettings = (base: LogProviderSettings, partial: AppSettingsPatch): LogProviderSettings => {
  const logPatch = isRecord(partial.providers?.log) ? partial.providers.log : {};
  const merged = {
    ...base,
    ...logPatch
  };

  if (!("enabled" in logPatch) && typeof logPatch.logFilePath === "string" && logPatch.logFilePath.trim().length > 0) {
    merged.enabled = true;
  }

  return merged;
};

const mergeSettings = (base: AppSettings, partial: AppSettingsPatch): AppSettings => {
  const codexPatch = isRecord(partial.providers?.codex) ? partial.providers.codex : {};
  const processPatch = isRecord(partial.providers?.process) ? partial.providers.process : {};
  const mockPatch = isRecord(partial.providers?.mock) ? partial.providers.mock : {};
  const customCommandPatch = isRecord(partial.providers?.customCommand) ? partial.providers.customCommand : {};

  return {
    display: {
      ...base.display,
      ...(isRecord(partial.display) ? partial.display : {})
    },
    notifications: {
      ...base.notifications,
      ...(isRecord(partial.notifications) ? partial.notifications : {})
    },
    providers: {
      codex: {
        ...base.providers.codex,
        ...codexPatch
      },
      process: {
        ...base.providers.process,
        ...processPatch
      },
      log: mergeLogProviderSettings(base.providers.log, partial),
      mock: {
        ...base.providers.mock,
        ...mockPatch
      },
      customCommand: {
        ...base.providers.customCommand,
        ...customCommandPatch
      }
    },
    paused: typeof partial.paused === "boolean" ? partial.paused : base.paused
  };
};

export class SettingsStore {
  private settings: AppSettings = defaultAppSettings;
  private readonly filePath: string;

  constructor(filePath = path.join(app.getPath("userData"), "settings.json")) {
    this.filePath = filePath;
  }

  async load(): Promise<AppSettings> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as AppSettingsPatch;
      this.settings = mergeSettings(defaultAppSettings, parsed);
    } catch {
      this.settings = defaultAppSettings;
      await this.save();
    }

    return this.settings;
  }

  get(): AppSettings {
    return this.settings;
  }

  async update(partial: AppSettingsPatch): Promise<AppSettings> {
    this.settings = mergeSettings(this.settings, partial);
    await this.save();
    return this.settings;
  }

  private async save(): Promise<void> {
    await mkdir(path.dirname(this.filePath), {
      recursive: true
    });
    await writeFile(this.filePath, `${JSON.stringify(this.settings, null, 2)}\n`, "utf8");
  }
}

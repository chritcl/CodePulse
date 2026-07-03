import { describe, expect, it } from "vitest";
import { formatSettingsFailureMessage, formatSettingsSuccessMessage } from "./settingsFailureMessages";

describe("设置页失败状态文案", () => {
  it("格式化加载和保存失败消息", () => {
    expect(formatSettingsFailureMessage("保存设置", new Error("磁盘拒绝访问"))).toBe(
      "保存设置失败：磁盘拒绝访问。请重试，或导出诊断信息查看原因。"
    );
    expect(formatSettingsFailureMessage("读取设置", "未知异常")).toBe(
      "读取设置失败：未知异常。请重试，或导出诊断信息查看原因。"
    );
    expect(formatSettingsFailureMessage("保存设置", null)).toBe("保存设置失败：未知错误。请重试，或导出诊断信息查看原因。");
  });

  it("格式化保存成功消息", () => {
    expect(formatSettingsSuccessMessage("2026-07-03T09:30:00.000Z")).toBe("设置已保存 · 09:30:00");
  });
});

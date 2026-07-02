import { describe, expect, it } from "vitest";
import {
  formatNotificationThresholdSummary,
  formatQuietHoursSummary,
  normalizeQuietHourInput
} from "./settingsNotificationControls";

describe("设置页通知策略控件", () => {
  it("归一化勿扰时间输入并保留合法时间", () => {
    expect(normalizeQuietHourInput(" 22:30 ")).toBe("22:30");
    expect(normalizeQuietHourInput("")).toBeNull();
    expect(normalizeQuietHourInput(null)).toBeNull();
  });

  it("生成勿扰时间段摘要", () => {
    expect(formatQuietHoursSummary("22:00", "07:30")).toBe("22:00 至次日 07:30");
    expect(formatQuietHoursSummary("09:00", "18:00")).toBe("09:00 至 18:00");
    expect(formatQuietHoursSummary("00:00", "00:00")).toBe("全天勿扰");
    expect(formatQuietHoursSummary(null, "07:30")).toBe("未启用时间段");
  });

  it("生成通知阈值摘要", () => {
    expect(formatNotificationThresholdSummary(20, 10)).toBe("额度低于 20% 提醒；10 分钟无活动提醒");
  });
});

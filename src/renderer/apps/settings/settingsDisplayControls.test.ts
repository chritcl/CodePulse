import { describe, expect, it } from "vitest";
import type { DisplaySettings } from "../../../shared/types/settings";
import type { DisplayLike } from "../../../shared/types/window";
import {
  formatDisplayLabel,
  formatIslandPlacementSummary,
  islandPositionOptions,
  normalizeTargetDisplayId
} from "./settingsDisplayControls";

const displays: DisplayLike[] = [
  {
    id: "1",
    scaleFactor: 1,
    bounds: {
      x: 0,
      y: 0,
      width: 1920,
      height: 1080
    },
    workArea: {
      x: 0,
      y: 0,
      width: 1920,
      height: 1040
    },
    primary: true
  },
  {
    id: "2",
    scaleFactor: 1.5,
    bounds: {
      x: 1920,
      y: 0,
      width: 2560,
      height: 1440
    },
    workArea: {
      x: 1920,
      y: 0,
      width: 2560,
      height: 1400
    },
    primary: false
  }
];

const displaySettings: DisplaySettings = {
  islandEnabled: true,
  islandMode: "collapsed",
  islandPosition: "topRight",
  islandCustomPosition: null,
  targetDisplayId: "2",
  followActiveDisplay: false,
  autoCollapseDelay: 5000,
  alwaysOnTop: true,
  mouseThrough: true,
  hideInFullscreen: true,
  trayEnabled: true,
  taskbarPopupEnabled: true,
  showQuota: true,
  showTaskName: true,
  showDuration: true,
  opacity: 0.94
};

describe("设置页显示和动态岛位置控件", () => {
  it("提供固定的动态岛位置选项", () => {
    expect(islandPositionOptions).toEqual([
      {
        value: "topCenter",
        label: "顶部居中"
      },
      {
        value: "topLeft",
        label: "顶部左侧"
      },
      {
        value: "topRight",
        label: "顶部右侧"
      },
      {
        value: "right",
        label: "屏幕右侧"
      },
      {
        value: "free",
        label: "自由拖拽"
      }
    ]);
  });

  it("生成显示器选项标签", () => {
    const [primaryDisplay, secondaryDisplay] = displays;

    if (!primaryDisplay || !secondaryDisplay) {
      throw new Error("测试显示器数据无效");
    }

    expect(formatDisplayLabel(primaryDisplay)).toBe("主显示器 1 · 1920×1080 · 100%");
    expect(formatDisplayLabel(secondaryDisplay)).toBe("显示器 2 · 2560×1440 · 150%");
  });

  it("生成当前动态岛定位摘要", () => {
    expect(formatIslandPlacementSummary(displaySettings, displays)).toBe("固定到显示器 2 · 顶部右侧");
    expect(formatIslandPlacementSummary({ ...displaySettings, followActiveDisplay: true }, displays)).toBe(
      "跟随当前活动显示器 · 顶部右侧"
    );
    expect(formatIslandPlacementSummary({ ...displaySettings, islandPosition: "free" }, displays)).toBe(
      "固定到显示器 2 · 使用拖拽保存的位置"
    );
  });

  it("显示器不存在或跟随活动显示器时清空固定显示器", () => {
    expect(normalizeTargetDisplayId("2", displays, false)).toBe("2");
    expect(normalizeTargetDisplayId("missing", displays, false)).toBeNull();
    expect(normalizeTargetDisplayId("2", displays, true)).toBeNull();
    expect(normalizeTargetDisplayId("2", [], false)).toBe("2");
  });
});

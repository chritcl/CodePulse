import { describe, expect, it } from "vitest";
import { defaultDisplaySettings } from "../../shared/types/settings";
import type { DisplayLike } from "../../shared/types/window";
import { normalizeIslandCustomPosition, resolveIslandPlacement } from "./islandPosition";

const displays: DisplayLike[] = [
  {
    id: "primary",
    scaleFactor: 1,
    primary: true,
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
    }
  },
  {
    id: "side",
    scaleFactor: 1.25,
    primary: false,
    bounds: {
      x: 1920,
      y: 0,
      width: 1600,
      height: 900
    },
    workArea: {
      x: 1920,
      y: 0,
      width: 1600,
      height: 860
    }
  }
];

describe("动态岛位置计算", () => {
  it("自由位置会使用持久化坐标并限制在对应显示器工作区内", () => {
    const placement = resolveIslandPlacement({
      displaySettings: {
        ...defaultDisplaySettings,
        islandPosition: "free",
        islandCustomPosition: {
          displayId: "side",
          x: 4000,
          y: -100
        }
      },
      displays,
      size: {
        width: 420,
        height: 260
      }
    });

    expect(placement).toEqual({
      displayId: "side",
      x: 3100,
      y: 0
    });
  });

  it("自由位置所在显示器断开后会回落到主显示器", () => {
    const placement = resolveIslandPlacement({
      displaySettings: {
        ...defaultDisplaySettings,
        islandPosition: "free",
        islandCustomPosition: {
          displayId: "missing",
          x: 2200,
          y: 120
        }
      },
      displays,
      size: {
        width: 360,
        height: 88
      }
    });

    expect(placement.displayId).toBe("primary");
    expect(placement.x).toBe(1560);
    expect(placement.y).toBe(120);
  });

  it("拖拽后的窗口位置会归一化为可持久化自由位置", () => {
    const position = normalizeIslandCustomPosition({
      bounds: {
        x: -80,
        y: 990,
        width: 420,
        height: 260
      },
      displays
    });

    expect(position).toEqual({
      displayId: "primary",
      x: 0,
      y: 780
    });
  });
});

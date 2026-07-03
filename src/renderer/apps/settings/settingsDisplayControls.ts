import type { DisplaySettings, IslandCustomPosition } from "../../../shared/types/settings";
import type { DisplayLike, IslandPosition } from "../../../shared/types/window";

export const islandPositionOptions: Array<{ value: IslandPosition; label: string }> = [
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
];

const islandPositionLabel = (position: IslandPosition): string =>
  islandPositionOptions.find((item) => item.value === position)?.label ?? position;

export const formatDisplayLabel = (display: DisplayLike): string => {
  const prefix = display.primary ? "主显示器" : "显示器";
  const scalePercent = Math.round(display.scaleFactor * 100);
  return `${prefix} ${display.id} · ${display.bounds.width}×${display.bounds.height} · ${scalePercent}%`;
};

export const formatIslandPlacementSummary = (settings: DisplaySettings, displays: DisplayLike[]): string => {
  const positionLabel = settings.islandPosition === "free" ? "使用拖拽保存的位置" : islandPositionLabel(settings.islandPosition);

  if (settings.followActiveDisplay) {
    return `跟随当前活动显示器 · ${positionLabel}`;
  }

  const targetDisplay = displays.find((display) => display.id === settings.targetDisplayId) ?? displays.find((display) => display.primary);
  const targetLabel = targetDisplay ? `显示器 ${targetDisplay.id}` : "主显示器";
  return `固定到${targetLabel} · ${positionLabel}`;
};

export const normalizeTargetDisplayId = (
  targetDisplayId: string | null,
  displays: DisplayLike[],
  followActiveDisplay: boolean
): string | null => {
  if (followActiveDisplay || !targetDisplayId) {
    return null;
  }

  if (displays.length === 0) {
    return targetDisplayId;
  }

  return displays.some((display) => display.id === targetDisplayId) ? targetDisplayId : null;
};

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(Math.round(value), min), max);

export const normalizeIslandCustomPositionInput = (
  position: IslandCustomPosition | null,
  displays: DisplayLike[]
): IslandCustomPosition => {
  const targetDisplay =
    displays.find((display) => display.id === position?.displayId) ?? displays.find((display) => display.primary) ?? displays[0] ?? null;

  if (!targetDisplay) {
    return {
      displayId: position?.displayId ?? null,
      x: Math.max(Math.round(position?.x ?? 0), 0),
      y: Math.max(Math.round(position?.y ?? 0), 0)
    };
  }

  return {
    displayId: targetDisplay.id,
    x: clamp(position?.x ?? targetDisplay.workArea.x, targetDisplay.workArea.x, targetDisplay.workArea.x + targetDisplay.workArea.width),
    y: clamp(position?.y ?? targetDisplay.workArea.y, targetDisplay.workArea.y, targetDisplay.workArea.y + targetDisplay.workArea.height)
  };
};

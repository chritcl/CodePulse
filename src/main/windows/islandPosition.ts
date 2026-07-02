import type { DisplaySettings, IslandCustomPosition } from "../../shared/types/settings";
import type { DisplayLike, PointLike, RectLike } from "../../shared/types/window";

interface IslandSize {
  width: number;
  height: number;
}

export interface IslandPlacementInput {
  displaySettings: DisplaySettings;
  displays: DisplayLike[];
  size: IslandSize;
}

export interface IslandPlacementResult {
  displayId: string;
  x: number;
  y: number;
}

export interface IslandCustomPositionInput {
  bounds: RectLike;
  displays: DisplayLike[];
}

const defaultTopGap = 12;
const defaultSideGap = 24;

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

const centerOfRect = (rect: RectLike): PointLike => ({
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2
});

const containsPoint = (rect: RectLike, point: PointLike): boolean =>
  point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;

const pickPrimaryDisplay = (displays: DisplayLike[]): DisplayLike => {
  const display = displays.find((item) => item.primary) ?? displays[0];

  if (!display) {
    throw new Error("缺少显示器信息");
  }

  return display;
};

const pickDisplay = (settings: DisplaySettings, displays: DisplayLike[]): DisplayLike => {
  const primaryDisplay = pickPrimaryDisplay(displays);

  if (settings.islandPosition === "free" && settings.islandCustomPosition?.displayId) {
    return displays.find((display) => display.id === settings.islandCustomPosition?.displayId) ?? primaryDisplay;
  }

  if (settings.targetDisplayId) {
    return displays.find((display) => display.id === settings.targetDisplayId) ?? primaryDisplay;
  }

  return primaryDisplay;
};

const clampX = (value: number, workArea: RectLike, width: number): number =>
  Math.round(clamp(value, workArea.x, workArea.x + Math.max(0, workArea.width - width)));

const clampY = (value: number, workArea: RectLike, height: number): number =>
  Math.round(clamp(value, workArea.y, workArea.y + Math.max(0, workArea.height - height)));

export const resolveIslandPlacement = (input: IslandPlacementInput): IslandPlacementResult => {
  const display = pickDisplay(input.displaySettings, input.displays);
  const { workArea } = display;
  const { size } = input;
  let x = workArea.x + workArea.width / 2 - size.width / 2;
  let y = workArea.y + defaultTopGap;

  if (input.displaySettings.islandPosition === "topLeft") {
    x = workArea.x + defaultSideGap;
  } else if (input.displaySettings.islandPosition === "topRight") {
    x = workArea.x + workArea.width - size.width - defaultSideGap;
  } else if (input.displaySettings.islandPosition === "right") {
    x = workArea.x + workArea.width - size.width - defaultSideGap;
    y = workArea.y + workArea.height / 2 - size.height / 2;
  } else if (input.displaySettings.islandPosition === "free" && input.displaySettings.islandCustomPosition) {
    x = input.displaySettings.islandCustomPosition.x;
    y = input.displaySettings.islandCustomPosition.y;
  }

  return {
    displayId: display.id,
    x: clampX(x, workArea, size.width),
    y: clampY(y, workArea, size.height)
  };
};

export const normalizeIslandCustomPosition = (input: IslandCustomPositionInput): IslandCustomPosition => {
  const primaryDisplay = pickPrimaryDisplay(input.displays);
  const center = centerOfRect(input.bounds);
  const display = input.displays.find((item) => containsPoint(item.bounds, center)) ?? primaryDisplay;

  return {
    displayId: display.id,
    x: clampX(input.bounds.x, display.workArea, input.bounds.width),
    y: clampY(input.bounds.y, display.workArea, input.bounds.height)
  };
};

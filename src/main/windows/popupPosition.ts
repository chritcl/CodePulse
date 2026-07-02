import type { DisplayLike, PointLike, PopupPositionInput, PopupPositionResult, RectLike, TaskbarEdge } from "../../shared/types/window";

const containsPoint = (rect: RectLike, point: PointLike): boolean =>
  point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;

const centerOfRect = (rect: RectLike): PointLike => ({
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2
});

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

const pickDisplay = (input: PopupPositionInput): DisplayLike => {
  const primaryDisplay = input.displays.find((display) => display.primary) ?? input.displays[0];

  if (!primaryDisplay) {
    throw new Error("缺少显示器信息");
  }

  if (input.trayBounds) {
    const trayCenter = centerOfRect(input.trayBounds);
    const trayDisplay = input.displays.find((display) => containsPoint(display.bounds, trayCenter));

    if (trayDisplay) {
      return trayDisplay;
    }
  }

  const cursorDisplay = input.displays.find((display) => containsPoint(display.bounds, input.cursorPoint));

  return cursorDisplay ?? primaryDisplay;
};

const inferEdgeByWorkArea = (display: DisplayLike): TaskbarEdge | null => {
  const leftGap = display.workArea.x - display.bounds.x;
  const topGap = display.workArea.y - display.bounds.y;
  const rightGap = display.bounds.x + display.bounds.width - (display.workArea.x + display.workArea.width);
  const bottomGap = display.bounds.y + display.bounds.height - (display.workArea.y + display.workArea.height);
  const gaps: Array<{ edge: TaskbarEdge; value: number }> = [
    {
      edge: "left",
      value: leftGap
    },
    {
      edge: "top",
      value: topGap
    },
    {
      edge: "right",
      value: rightGap
    },
    {
      edge: "bottom",
      value: bottomGap
    }
  ];
  const largestGap = gaps.sort((left, right) => right.value - left.value)[0];

  if (!largestGap || largestGap.value <= 0) {
    return null;
  }

  return largestGap.edge;
};

const inferEdgeByTray = (display: DisplayLike, trayBounds: RectLike | null): TaskbarEdge => {
  if (!trayBounds) {
    return "bottom";
  }

  const trayCenter = centerOfRect(trayBounds);
  const distances: Array<{ edge: TaskbarEdge; value: number }> = [
    {
      edge: "left",
      value: Math.abs(trayCenter.x - display.bounds.x)
    },
    {
      edge: "top",
      value: Math.abs(trayCenter.y - display.bounds.y)
    },
    {
      edge: "right",
      value: Math.abs(trayCenter.x - (display.bounds.x + display.bounds.width))
    },
    {
      edge: "bottom",
      value: Math.abs(trayCenter.y - (display.bounds.y + display.bounds.height))
    }
  ];

  return distances.sort((left, right) => left.value - right.value)[0]?.edge ?? "bottom";
};

export const calculatePopupPosition = (input: PopupPositionInput): PopupPositionResult => {
  const display = pickDisplay(input);
  const edge = inferEdgeByWorkArea(display) ?? inferEdgeByTray(display, input.trayBounds);
  const anchor = input.trayBounds ? centerOfRect(input.trayBounds) : input.cursorPoint;
  const { workArea } = display;
  let x = anchor.x - input.popupSize.width / 2;
  let y = anchor.y - input.popupSize.height - input.gap;

  if (edge === "top") {
    y = workArea.y + input.margin;
  }

  if (edge === "bottom") {
    y = workArea.y + workArea.height - input.popupSize.height - input.margin;
  }

  if (edge === "left") {
    x = workArea.x + input.margin;
    y = anchor.y - input.popupSize.height / 2;
  }

  if (edge === "right") {
    x = workArea.x + workArea.width - input.popupSize.width - input.margin;
    y = anchor.y - input.popupSize.height / 2;
  }

  return {
    displayId: display.id,
    edge,
    x: Math.round(clamp(x, workArea.x + input.margin, workArea.x + workArea.width - input.popupSize.width - input.margin)),
    y: Math.round(clamp(y, workArea.y + input.margin, workArea.y + workArea.height - input.popupSize.height - input.margin))
  };
};

export type IslandMode = "hidden" | "collapsed" | "normal" | "expanded" | "persistent" | "dragging";

export type IslandPosition = "topCenter" | "topLeft" | "topRight" | "right" | "free";

export type CodePulseWindowKind = "island" | "popup" | "center" | "settings";

export type TaskbarEdge = "bottom" | "top" | "left" | "right";

export interface RectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PointLike {
  x: number;
  y: number;
}

export interface DisplayLike {
  id: string;
  scaleFactor: number;
  bounds: RectLike;
  workArea: RectLike;
  primary: boolean;
}

export interface PopupPositionInput {
  trayBounds: RectLike | null;
  cursorPoint: PointLike;
  displays: DisplayLike[];
  popupSize: {
    width: number;
    height: number;
  };
  margin: number;
  gap: number;
}

export interface PopupPositionResult {
  displayId: string;
  edge: TaskbarEdge;
  x: number;
  y: number;
}

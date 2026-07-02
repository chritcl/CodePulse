import { screen } from "electron";
import type { DisplayLike } from "../../shared/types/window";

export const getDisplays = (): DisplayLike[] => {
  const primaryDisplayId = String(screen.getPrimaryDisplay().id);

  return screen.getAllDisplays().map((display) => ({
    id: String(display.id),
    scaleFactor: display.scaleFactor,
    bounds: {
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height
    },
    workArea: {
      x: display.workArea.x,
      y: display.workArea.y,
      width: display.workArea.width,
      height: display.workArea.height
    },
    primary: String(display.id) === primaryDisplayId
  }));
};

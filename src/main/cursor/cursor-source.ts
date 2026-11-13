import { screen } from 'electron';
import type { Point } from '../../shared/geometry';

/** Something that may know where the global cursor is. */
export interface CursorSource {
  /** Global screen position in DIP, or null if this source can't tell right now. */
  position(): Point | null;
}

/** Function returning the global cursor position, always answering. */
export type CursorLocator = () => Point;

/**
 * Asks the given sources in order and falls back to Electron's own view (which on Wayland only
 * sees the pointer over our own windows).
 */
export const cursorLocator = (...sources: CursorSource[]): CursorLocator => () => {
  for (const s of sources) {
    const p = s.position();
    if (p) return p;
  }
  return screen.getCursorScreenPoint();
};

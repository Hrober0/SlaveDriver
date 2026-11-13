import type { Point, Rect } from './geometry';
import type { RendererState, SharedMascot } from './types';

/** IPC channel names, shared by main, preload and renderer so they can't drift apart. */
export const IPC = {
  // main -> renderer
  state: 'state',
  cursor: 'cursor',
  mascot: 'mascot',
  drag: 'drag',
  // renderer -> main
  setTarget: 'set-target',
  cancelTarget: 'cancel-target',
  dragUpdate: 'drag-update',
  mascotHit: 'mascot-hit',
} as const;

/** The API the preload script exposes to the renderer as `window.whipApi`. */
export interface WhipApi {
  onState(cb: (s: RendererState) => void): void;
  /** Cursor position, local to the receiving window. */
  onCursor(cb: (p: Point) => void): void;
  onMascot(cb: (m: SharedMascot | null) => void): void;
  /** Drag box to draw, local to the receiving window, or null when the drag ended. */
  onDrag(cb: (r: Rect | null) => void): void;
  /** Window-local rect. */
  setTarget(rect: Rect): void;
  cancelTarget(): void;
  /** Window-local rect, or null when the drag ended. */
  dragUpdate(rect: Rect | null): void;
  mascotHit(): void;
}

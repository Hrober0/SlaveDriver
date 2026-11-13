import type { Point, Rect } from './geometry';

export type Mode = 'off' | 'whip' | 'target';

export interface WhipConfig {
  segments: number;
  segmentLength: number;
  handleSegments: number;
  gravity: number;
  damping: number;
  drag: number;
  stiffness: number;
  iterations: number;
}

export interface Shortcuts {
  toggle: string;
  setTarget: string;
}

export interface Config {
  version: number;
  shortcuts: Shortcuts;
  /** Absolute screen rect in DIP, or null for the default (right 30% of the primary display). */
  target: Rect | null;
  /** true: you must hit the mascot. false: anywhere in the agent area counts. */
  mascot: boolean;
  speak: boolean;
  sound: boolean;
  hitSpeed: number;
  crackSpeed: number;
  hitCooldownMs: number;
  whip: WhipConfig;
}

/** Messages are "<random first> <random second>". */
export interface Words {
  first: string[];
  second: string[];
}

/**
 * The one mascot shared by every overlay, in global screen coordinates. `hitAt` is Date.now() ms so
 * every renderer derives the same animation phase: hurt at `from`, then a hop to `to`.
 */
export interface SharedMascot {
  from: Point;
  to: Point;
  hitAt: number;
}

/** What main pushes to every renderer window. Coordinates are global; `origin` is the window's. */
export interface RendererState {
  mode: Mode;
  target: Rect;
  showTarget: boolean;
  words: Words;
  config: Config;
  mascot: SharedMascot | null;
  origin: Rect;
  /** This overlay has the cursor (only it simulates/draws the whip). */
  active: boolean;
}

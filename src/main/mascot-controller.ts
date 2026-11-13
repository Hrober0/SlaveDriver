import { screen } from 'electron';
import { distance, type Point, type Rect } from '../shared/geometry';
import { MASCOT_HURT_MS, MASCOT_JUMP_MS } from '../shared/mascot-timing';
import type { SharedMascot } from '../shared/types';

// Margins keeping the whole sprite (plus its hop) on screen.
const MARGIN_X = 50;
const MARGIN_TOP = 70;
const MARGIN_BOTTOM = 50;
const MIN_HOP_PX = 180;
const SPOT_TRIES = 60;

/**
 * One mascot shared by every overlay, in global screen coordinates. Each overlay used to keep its
 * own copy, so with an agent area spanning monitors the mascot could hop onto a display whose
 * overlay had a different (or no) mascot, and it vanished.
 */
export class MascotController {
  private mascot: SharedMascot | null = null;
  private areaKey: string | null = null;

  /** @param getArea the current agent area (global coordinates). */
  constructor(private readonly getArea: () => Rect) {}

  /** The current mascot; respawns it if the agent area moved since it was placed. */
  get state(): SharedMascot {
    if (!this.mascot || JSON.stringify(this.getArea()) !== this.areaKey) this.respawn();
    return this.mascot!;
  }

  respawn(): void {
    const p = this.randomSpot();
    this.mascot = { from: p, to: p, hitAt: 0 };
    this.areaKey = JSON.stringify(this.getArea());
  }

  /** Starts the hurt + hop. Returns false while the previous hit is still animating. */
  hit(now = Date.now()): boolean {
    const m = this.mascot;
    if (!m || now - m.hitAt < MASCOT_HURT_MS + MASCOT_JUMP_MS) return false;
    this.mascot = { from: m.to, to: this.randomSpot(m.to), hitAt: now };
    return true;
  }

  /**
   * Random spot in the agent area that is fully on some display (a box spanning monitors of
   * different sizes can cover gaps no screen shows). Prefers spots far enough from `avoid`.
   */
  private randomSpot(avoid?: Point): Point {
    const r = this.getArea();
    const displays = screen.getAllDisplays().map((d) => d.bounds);
    const visible = (p: Point) => displays.some((b) => p.x >= b.x + MARGIN_X && p.x <= b.x + b.width - MARGIN_X
      && p.y >= b.y + MARGIN_TOP && p.y <= b.y + b.height - MARGIN_BOTTOM);
    const minX = r.x + MARGIN_X;
    const maxX = Math.max(minX, r.x + r.width - MARGIN_X);
    const minY = r.y + MARGIN_TOP;
    const maxY = Math.max(minY, r.y + r.height - MARGIN_BOTTOM);

    let best: { p: Point; d: number } | null = null;
    for (let k = 0; k < SPOT_TRIES; k++) {
      const p = { x: minX + Math.random() * (maxX - minX), y: minY + Math.random() * (maxY - minY) };
      if (!visible(p)) continue;
      const d = avoid ? distance(p, avoid) : Infinity;
      if (d > MIN_HOP_PX) return p;
      if (!best || d > best.d) best = { p, d };
    }
    // Nothing visible found: fall back to the middle of the area.
    return best ? best.p : { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }
}

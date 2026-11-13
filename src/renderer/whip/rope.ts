import { distance, type Point } from '../../shared/geometry';
import type { WhipConfig } from '../../shared/types';

export const PHYSICS_HZ = 240;           // fixed physics rate
export const PHYSICS_DT = 1 / PHYSICS_HZ;

const MAX_BACKLOG_S = 0.05;              // never simulate more than this per frame (after a stall)
const TELEPORT_PX = 600;                 // cursor jumps further than this (display change) reset the rope
const REST_DIR: Point = { x: 0.35, y: -0.94 };

export interface RopePoint extends Point {
  /** Position at the previous physics step (Verlet). */
  px: number;
  py: number;
}

/** Called after every physics step with the tip and its speed in px/s. */
export type TipListener = (tip: RopePoint, speed: number) => void;

/**
 * Verlet-simulated whip: a rigid handle held at the cursor plus a tapered, stiff-to-floppy lash.
 * Pure simulation; drawing and hit handling live elsewhere.
 */
export class WhipRope {
  private pts: RopePoint[] = [];
  private hand: Point | null = null;     // hand position at end of last physics step
  private cursor: Point | null = null;   // latest cursor
  private handleDir: Point = { ...REST_DIR };
  private acc = 0;

  constructor(private readonly config: () => WhipConfig) {}

  get points(): readonly RopePoint[] {
    return this.pts;
  }

  reset(): void {
    this.pts = [];
    this.hand = null;
    this.cursor = null;
  }

  moveTo(p: Point): void {
    // Display jump: teleport the whip instead of slinging it across the screen.
    if (this.cursor && this.hand && distance(p, this.cursor) > TELEPORT_PX) this.pts = [];
    this.cursor = p;
    if (!this.pts.length) this.init(p);
  }

  /** Advances the simulation by `frameMs` in fixed steps, sweeping the hand toward the cursor. */
  simulate(frameMs: number, onTip: TipListener): void {
    const cursor = this.cursor;
    if (!cursor || !this.pts.length || !this.hand) return;
    this.acc = Math.min(this.acc + frameMs / 1000, MAX_BACKLOG_S);
    const steps = Math.floor(this.acc / PHYSICS_DT);
    if (!steps) return;
    this.acc -= steps * PHYSICS_DT;
    const from = { ...this.hand };
    const vel = { x: (cursor.x - from.x) / (steps * PHYSICS_DT), y: (cursor.y - from.y) / (steps * PHYSICS_DT) };
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      this.step({ x: from.x + (cursor.x - from.x) * t, y: from.y + (cursor.y - from.y) * t }, vel);
      const tip = this.pts[this.pts.length - 1];
      onTip(tip, Math.hypot(tip.x - tip.px, tip.y - tip.py) / PHYSICS_DT);
    }
    this.hand = { ...cursor };
  }

  private init(at: Point): void {
    const w = this.config();
    const L = w.segmentLength;
    this.hand = { ...at };
    this.pts = [];
    const hx = at.x + this.handleDir.x * L * w.handleSegments;
    const hy = at.y + this.handleDir.y * L * w.handleSegments;
    for (let i = 0; i <= w.segments; i++) {
      const onHandle = i <= w.handleSegments;
      const x = onHandle ? at.x + this.handleDir.x * L * i : hx;
      const y = onHandle ? at.y + this.handleDir.y * L * i : hy + (i - w.handleSegments) * L;
      this.pts.push({ x, y, px: x, py: y });
    }
  }

  private step(handPos: Point, handVel: Point): void {
    const w = this.config();
    this.tiltWrist(handVel);
    this.moveHandle(handPos, w);
    this.integrate(w);
    this.applyStiffness(w);
    this.applyLengthConstraints(w);
  }

  /** The handle tilts in the direction the hand moves, then springs back to upright-ish. */
  private tiltWrist(handVel: Point): void {
    const d = this.handleDir;
    let tx = REST_DIR.x + handVel.x * 0.0009;
    let ty = REST_DIR.y + handVel.y * 0.0009;
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    d.x += (tx - d.x) * 0.08;
    d.y += (ty - d.y) * 0.08;
    const hl = Math.hypot(d.x, d.y) || 1;
    d.x /= hl; d.y /= hl;
  }

  /** Handle points are kinematic (rigid stick held by the hand). */
  private moveHandle(handPos: Point, w: WhipConfig): void {
    for (let i = 0; i <= w.handleSegments; i++) {
      const p = this.pts[i];
      p.px = p.x; p.py = p.y;
      p.x = handPos.x + this.handleDir.x * w.segmentLength * i;
      p.y = handPos.y + this.handleDir.y * w.segmentLength * i;
    }
  }

  /** Verlet integrate the lash with linear damping + quadratic air drag. */
  private integrate(w: WhipConfig): void {
    const g = w.gravity * PHYSICS_DT * PHYSICS_DT;
    for (let i = w.handleSegments + 1; i < this.pts.length; i++) {
      const p = this.pts[i];
      let vx = (p.x - p.px) * w.damping;
      let vy = (p.y - p.py) * w.damping;
      const f = 1 / (1 + w.drag * Math.hypot(vx, vy));
      vx *= f; vy *= f;
      p.px = p.x; p.py = p.y;
      p.x += vx;
      p.y += vy + g;
    }
  }

  /**
   * Bending stiffness, tapered: stiff near the handle, floppy at the tip. This is what makes the
   * loop roll down the lash and accelerate into a crack instead of flopping like a noodle.
   */
  private applyStiffness(w: WhipConfig): void {
    const pts = this.pts;
    const H = w.handleSegments;
    const n = pts.length;
    {
      // The first lash segment wants to continue the handle's direction.
      const a = pts[H - 1], b = pts[H], c = pts[H + 1];
      const s = w.stiffness * 1.5;
      c.x += (2 * b.x - a.x - c.x) * s;
      c.y += (2 * b.y - a.y - c.y) * s;
    }
    for (let i = H + 1; i < n - 1; i++) {
      const t = (i - H) / (n - 1 - H);
      const s = w.stiffness * (1 - t) * (1 - t) + 0.02;
      const a = pts[i - 1], b = pts[i], c = pts[i + 1];
      const mx = (a.x + c.x) / 2 - b.x;
      const my = (a.y + c.y) / 2 - b.y;
      b.x += mx * s; b.y += my * s;
      if (i - 1 > H) { a.x -= mx * s * 0.5; a.y -= my * s * 0.5; }
      c.x -= mx * s * 0.5; c.y -= my * s * 0.5;
    }
  }

  /** Length constraints. Thick base is heavy, thin tip is light (taper => tip speed amplification). */
  private applyLengthConstraints(w: WhipConfig): void {
    const pts = this.pts;
    const H = w.handleSegments;
    const n = pts.length;
    const L = w.segmentLength;
    const invMass = (i: number) => (i <= H ? 0 : 0.5 + 1.5 * ((i - H) / (n - 1 - H)));
    for (let it = 0; it < w.iterations; it++) {
      for (let i = H; i < n - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const wa = invMass(i), wb = invMass(i + 1);
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.0001;
        const diff = (d - L) / d / (wa + wb);
        a.x += dx * diff * wa; a.y += dy * diff * wa;
        b.x -= dx * diff * wb; b.y -= dy * diff * wb;
      }
    }
  }
}

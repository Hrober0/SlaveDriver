import { inRect, segmentDistance, type Point, type Rect } from '../shared/geometry';
import type { Config } from '../shared/types';
import { MASCOT_HIT_RADIUS, type MascotPose } from './mascot';
import type { RopePoint } from './whip/rope';

const CRACK_COOLDOWN_MS = 150;

export interface HitJudgeEvents {
  /** The tip broke the "sound barrier". `power` in 1..2. */
  crack(at: Point, power: number, speed: number): void;
  /** A hit landed. `at` is where the reaction should appear. */
  hit(at: Point, speed: number, onMascot: boolean): void;
}

export interface Arena {
  config: Config;
  target: Rect | null;
  mascot: MascotPose | null;
}

/** Decides from the tip's motion whether it cracked and whether it hit the agent (or its mascot). */
export class HitJudge {
  private lastHit = 0;
  private lastCrack = 0;

  constructor(private readonly events: HitJudgeEvents) {}

  judge(tip: RopePoint, speed: number, arena: Arena, now: number): void {
    const { config: cfg, target, mascot } = arena;

    if (speed > cfg.crackSpeed && now - this.lastCrack > CRACK_COOLDOWN_MS) {
      this.lastCrack = now;
      this.events.crack(tip, Math.min(2, speed / cfg.crackSpeed), speed);
    }

    if (!target || speed < cfg.hitSpeed || now - this.lastHit < cfg.hitCooldownMs) return;
    if (cfg.mascot) {
      // Only the tip counts, swept over this step so fast lashes can't tunnel through.
      const prev = { x: tip.px, y: tip.py };
      if (mascot && mascot.state === 'idle' && segmentDistance(prev, tip, mascot) < MASCOT_HIT_RADIUS) {
        this.lastHit = now;
        this.events.hit({ x: mascot.x, y: mascot.y - 40 }, speed, true);
      }
    } else if (inRect(tip, target)) {
      this.lastHit = now;
      this.events.hit({ x: tip.x, y: tip.y }, speed, false);
    }
  }
}

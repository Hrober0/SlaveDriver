import type { Point } from '../shared/geometry';
import { MASCOT_HURT_MS, MASCOT_JUMP_MS } from '../shared/mascot-timing';
import type { SharedMascot } from '../shared/types';

export const MASCOT_HIT_RADIUS = 34;
const PX = 5;                 // size of one sprite pixel

/** Where the mascot is right now in this window, derived from the shared state each frame. */
export type MascotPose =
  | (Point & { state: 'hurt'; t0: number })
  | (Point & { state: 'jump'; t0: number })
  | (Point & { state: 'idle'; landedAt: number });

// Ease that overshoots a bit and settles: feels like a hop with a little skid.
const easeOutBack = (t: number) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * The mascot lives in main (one for all displays); derive its pose in this window.
 * `now` is Date.now(), so every overlay computes the same phase.
 */
export function mascotPose(m: SharedMascot | null, origin: Point, now: number): MascotPose | null {
  if (!m) return null;
  const from = { x: m.from.x - origin.x, y: m.from.y - origin.y };
  const to = { x: m.to.x - origin.x, y: m.to.y - origin.y };
  const since = now - m.hitAt;
  if (since < MASCOT_HURT_MS) return { ...from, state: 'hurt', t0: m.hitAt };
  if (since < MASCOT_HURT_MS + MASCOT_JUMP_MS) {
    const t0 = m.hitAt + MASCOT_HURT_MS;
    const t = (now - t0) / MASCOT_JUMP_MS;
    return {
      x: from.x + (to.x - from.x) * easeOutBack(t),
      y: from.y + (to.y - from.y) * easeInOutCubic(t),
      state: 'jump',
      t0,
    };
  }
  return { ...to, state: 'idle', landedAt: m.hitAt ? m.hitAt + MASCOT_HURT_MS + MASCOT_JUMP_MS : now - 1000 };
}

// Original pixel critter. '#' body, 'e' eye.
const SPRITE = [
  '..##########..',
  '..#e######e#..',
  '..#e######e#..',
  '##############',
  '##############',
  '..##########..',
  '..##########..',
];
const LEGS = [
  ['..#.#....#.#..', '..#.#....#.#..'],
  ['...#.#..#.#...', '...#.#..#.#...'],
];

/** `now` must be Date.now() (same clock as the pose). */
export function drawMascot(ctx: CanvasRenderingContext2D, m: MascotPose, now: number): void {
  const W = SPRITE[0].length * PX;
  const Hh = (SPRITE.length + 2) * PX;
  let sx = 1, sy = 1, lift = 0, shake = 0;

  if (m.state === 'jump') {
    const t = (now - m.t0) / MASCOT_JUMP_MS;
    lift = Math.sin(Math.PI * Math.min(1, t)) * 110;
    sy = 1.12; sx = 0.9;                       // stretch in the air
  } else {
    const since = m.state === 'idle' ? now - m.landedAt : Infinity;
    if (since < 220) {                         // squash on landing, springs back
      const k = 1 - since / 220;
      sy = 1 - 0.3 * k; sx = 1 + 0.25 * k;
    } else {
      lift = Math.abs(Math.sin(now / 260)) * 3; // idle bob
    }
  }
  const hurt = m.state === 'hurt';
  if (hurt) shake = Math.sin(now / 18) * 4;

  // Shadow stays on the ground.
  ctx.save();
  ctx.fillStyle = `rgba(0,0,0,${0.3 - Math.min(0.2, lift / 600)})`;
  ctx.beginPath();
  ctx.ellipse(m.x, m.y + Hh / 2 + 2, (W / 2) * (1 - lift / 300), 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(m.x + shake, m.y + Hh / 2 - lift);  // origin at the feet
  ctx.scale(sx, sy);
  ctx.translate(-W / 2, -Hh);
  const flashWhite = hurt && Math.floor((now - m.t0) / 60) % 2 === 0;
  const body = flashWhite ? '#ffffff' : '#d97757';
  const rows = [...SPRITE, ...LEGS[Math.floor(now / 180) % 2]];
  const eachPixel = (fn: (x: number, y: number, ch: string) => void) =>
    rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') fn(x, y, ch); }));
  // light outline for dark backgrounds
  ctx.fillStyle = 'rgba(255, 240, 220, 0.5)';
  eachPixel((x, y) => ctx.fillRect(x * PX - 1, y * PX - 1, PX + 2, PX + 2));
  eachPixel((x, y, ch) => {
    ctx.fillStyle = ch === 'e' ? (hurt ? body : '#2a1610') : body;
    ctx.fillRect(x * PX, y * PX, PX, PX);
  });
  if (hurt) {
    // squeezed-shut eyes: > <
    ctx.strokeStyle = '#2a1610';
    ctx.lineWidth = 2;
    for (const [cx, dir] of [[3.5, 1], [10.5, -1]]) {
      ctx.beginPath();
      ctx.moveTo(cx * PX - dir * 4, 1.2 * PX);
      ctx.lineTo(cx * PX + dir * 3, 2 * PX);
      ctx.lineTo(cx * PX - dir * 4, 2.8 * PX);
      ctx.stroke();
    }
  }
  ctx.restore();
}

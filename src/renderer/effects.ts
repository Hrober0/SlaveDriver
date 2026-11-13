import type { Point } from '../shared/geometry';

const CRACK_MS = 160;
const POPUP_MS = 1600;
const MAX_POPUPS = 12;

interface Crack extends Point {
  t0: number;
  power: number;
}

/** Short starbursts where the tip broke the sound barrier. */
export class Cracks {
  private items: Crack[] = [];

  add(at: Point, power: number, now: number): void {
    this.items.push({ x: at.x, y: at.y, t0: now, power });
  }

  draw(ctx: CanvasRenderingContext2D, now: number): void {
    this.items = this.items.filter((c) => now - c.t0 < CRACK_MS);
    for (const c of this.items) {
      const t = (now - c.t0) / CRACK_MS;
      ctx.save();
      ctx.strokeStyle = `rgba(255, 250, 200, ${1 - t})`;
      ctx.lineWidth = 2;
      const r0 = 4 + t * 10, r1 = 10 + t * 26 * c.power;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + c.t0;
        ctx.beginPath();
        ctx.moveTo(c.x + Math.cos(a) * r0, c.y + Math.sin(a) * r0);
        ctx.lineTo(c.x + Math.cos(a) * r1, c.y + Math.sin(a) * r1);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}

interface Popup extends Point {
  text: string;
  t0: number;
  rot: number;
  size: number;
  hue: number;
}

/** Comic-style floating messages. */
export class Popups {
  private items: Popup[] = [];

  /** `power` in 0..1 scales the text. */
  add(text: string, at: Point, power: number, now: number): void {
    // Keep the bubble on screen.
    const x = Math.max(80, Math.min(innerWidth - 80, at.x));
    const y = Math.max(60, Math.min(innerHeight - 20, at.y));
    this.items.push({
      text, x, y, t0: now,
      rot: (Math.random() - 0.5) * 0.35,
      size: 26 + power * 30,
      hue: Math.floor(Math.random() * 60), // reds -> yellows
    });
    if (this.items.length > MAX_POPUPS) this.items.shift();
  }

  draw(ctx: CanvasRenderingContext2D, now: number): void {
    this.items = this.items.filter((p) => now - p.t0 < POPUP_MS);
    for (const p of this.items) {
      const t = (now - p.t0) / POPUP_MS;
      const pop = t < 0.12 ? 0.6 + (t / 0.12) * 0.55 : 1.15 - Math.min(0.15, (t - 0.12) * 0.6);
      const text = p.text.toUpperCase();
      ctx.save();
      ctx.translate(p.x, p.y - t * 70);
      ctx.rotate(p.rot);
      ctx.scale(pop, pop);
      ctx.globalAlpha = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
      ctx.font = `900 ${p.size}px Impact, "Arial Black", "DejaVu Sans", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(text, 0, 0);
      ctx.fillStyle = `hsl(${p.hue}, 100%, 60%)`;
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }
  }
}

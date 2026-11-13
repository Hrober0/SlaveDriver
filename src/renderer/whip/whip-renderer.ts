import { midpoint, type Point } from '../../shared/geometry';
import type { WhipConfig } from '../../shared/types';

const OUTLINE = 'rgba(255, 240, 220, 0.55)'; // reads on both dark and light themes

function line(ctx: CanvasRenderingContext2D, a: Point, b: Point): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

export function drawWhip(ctx: CanvasRenderingContext2D, pts: readonly Point[], w: WhipConfig): void {
  if (pts.length < 2) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  drawLash(ctx, pts, w.handleSegments, 2.5, () => OUTLINE);
  drawLash(ctx, pts, w.handleSegments, 0,
    (t) => `rgb(${Math.round(92 - t * 30)}, ${Math.round(52 - t * 15)}, ${Math.round(28 - t * 8)})`);
  drawCracker(ctx, pts);
  drawHandle(ctx, pts, w);
  ctx.restore();
}

/** Smooth tapered lash through the segment midpoints. `color(t)` with t = 0 at handle, 1 at tip. */
function drawLash(
  ctx: CanvasRenderingContext2D, pts: readonly Point[], H: number, extra: number, color: (t: number) => string,
): void {
  const n = pts.length;
  for (let i = H; i < n - 1; i++) {
    const t = (i - H) / (n - 1 - H);
    const a = i === H ? pts[i] : midpoint(pts[i - 1], pts[i]);
    const b = midpoint(pts[i], pts[i + 1]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, b.x, b.y);
    ctx.lineWidth = 6.5 * (1 - t) + 1.2 * t + extra;
    ctx.strokeStyle = color(t);
    ctx.stroke();
  }
  // last half segment to the tip
  ctx.lineWidth = 1.2 + extra;
  ctx.strokeStyle = color(1);
  line(ctx, midpoint(pts[n - 2], pts[n - 1]), pts[n - 1]);
}

/** Frayed tip. */
function drawCracker(ctx: CanvasRenderingContext2D, pts: readonly Point[]): void {
  const n = pts.length;
  const tip = pts[n - 1], pre = pts[n - 2];
  const dx = tip.x - pre.x, dy = tip.y - pre.y;
  const d = Math.hypot(dx, dy) || 1;
  ctx.strokeStyle = 'rgba(235, 220, 190, 0.9)';
  ctx.lineWidth = 1;
  for (const s of [-0.35, 0, 0.35]) {
    const c = Math.cos(s), si = Math.sin(s);
    const ux = (dx * c - dy * si) / d, uy = (dx * si + dy * c) / d;
    line(ctx, tip, { x: tip.x + ux * 9, y: tip.y + uy * 9 });
  }
}

function drawHandle(ctx: CanvasRenderingContext2D, pts: readonly Point[], w: WhipConfig): void {
  const H = w.handleSegments;
  const h0 = pts[0], h1 = pts[H];
  ctx.lineWidth = 12;
  ctx.strokeStyle = OUTLINE;
  line(ctx, h0, h1);
  ctx.lineWidth = 9.5;
  ctx.strokeStyle = '#3a2212';
  line(ctx, h0, h1);
  // braided wrap
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#8a5a2b';
  const len = H * w.segmentLength;
  const nx = -(h1.y - h0.y) / len, ny = (h1.x - h0.x) / len;
  for (let k = 1; k < 8; k++) {
    const t = k / 8;
    const x = h0.x + (h1.x - h0.x) * t, y = h0.y + (h1.y - h0.y) * t;
    line(ctx,
      { x: x - nx * 4.5, y: y - ny * 4.5 },
      { x: x + nx * 4.5 + (h1.x - h0.x) * 0.04, y: y + ny * 4.5 + (h1.y - h0.y) * 0.04 });
  }
  // pommel at the cursor
  ctx.fillStyle = '#c9a14a';
  ctx.beginPath();
  ctx.arc(h0.x, h0.y, 5.5, 0, Math.PI * 2);
  ctx.fill();
}

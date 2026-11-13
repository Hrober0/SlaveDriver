import type { Rect } from '../shared/geometry';
import type { WhipApi } from '../shared/ipc';

const MIN_TARGET_PX = 20;
const FLASH_MS = 350;

/** Dashed "AGENT" outline shown while whipping (if enabled), flashing red on a hit. */
export function drawTargetOutline(
  ctx: CanvasRenderingContext2D, target: Rect, opts: { flash: number; fillOnFlash: boolean },
): void {
  const { flash } = opts;
  ctx.save();
  if (flash && opts.fillOnFlash) {
    ctx.fillStyle = `rgba(255, 40, 40, ${0.22 * flash})`;
    ctx.fillRect(target.x, target.y, target.width, target.height);
  }
  ctx.setLineDash([8, 6]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = `rgba(255, 90, 90, ${0.35 + flash * 0.6})`;
  ctx.strokeRect(target.x + 1, target.y + 1, target.width - 2, target.height - 2);
  ctx.setLineDash([]);
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255, 120, 120, 0.8)';
  ctx.fillText('AGENT', target.x + 8, target.y + 18);
  ctx.restore();
}

/** 1 right after a hit, fading to 0. */
export const hitFlash = (now: number, hitAt: number): number => Math.max(0, 1 - (now - hitAt) / FLASH_MS);

interface Drag {
  x0: number; y0: number; x1: number; y1: number;
}

const dragRect = (d: Drag): Rect => ({
  x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1),
  width: Math.abs(d.x1 - d.x0), height: Math.abs(d.y1 - d.y0),
});

/**
 * Drag-to-select the agent area. The drag lives in the window it started in; every window
 * (including this one) draws the box main mirrors back to it.
 */
export class TargetPicker {
  private drag: Drag | null = null;
  private shownDrag: Rect | null = null;
  private enabled = false;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly api: WhipApi) {
    api.onDrag((r) => { this.shownDrag = r; });
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', () => this.abort());
    addEventListener('keydown', (e) => {
      if (this.enabled && e.key === 'Escape') api.cancelTarget();
    });
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.drag = null;
      this.shownDrag = null;
    }
  }

  draw(ctx: CanvasRenderingContext2D, target: Rect | null): void {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(0, 0, innerWidth, innerHeight);
    if (target) {
      ctx.clearRect(target.x, target.y, target.width, target.height);
      ctx.fillStyle = 'rgba(255, 60, 60, 0.08)';
      ctx.fillRect(target.x, target.y, target.width, target.height);
    }
    const r = this.shownDrag;
    if (r) {
      ctx.clearRect(r.x, r.y, r.width, r.height);
      ctx.fillStyle = 'rgba(80, 200, 255, 0.15)';
      ctx.fillRect(r.x, r.y, r.width, r.height);
      ctx.strokeStyle = 'rgba(80, 200, 255, 1)';
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x, r.y, r.width, r.height);
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText(`${Math.round(r.width)} × ${Math.round(r.height)}`, r.x + 6, r.y - 8);
    }
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText('Drag a box around the agent (e.g. the Claude Code panel)', innerWidth / 2, 60);
    ctx.font = '400 15px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText('Release to save  ·  Esc to cancel', innerWidth / 2, 88);
    ctx.restore();
  }

  private onDown(e: PointerEvent): void {
    if (!this.enabled || e.button !== 0) return;
    // Keep receiving events even when the drag leaves this display.
    this.canvas.setPointerCapture(e.pointerId);
    this.drag = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
    this.api.dragUpdate(dragRect(this.drag));
  }

  private onMove(e: PointerEvent): void {
    if (!this.enabled || !this.drag) return;
    this.drag.x1 = e.clientX;
    this.drag.y1 = e.clientY;
    this.api.dragUpdate(dragRect(this.drag));
  }

  private onUp(e: PointerEvent): void {
    if (!this.enabled || !this.drag) return;
    this.drag.x1 = e.clientX;
    this.drag.y1 = e.clientY;
    const r = dragRect(this.drag);
    this.drag = null;
    this.api.dragUpdate(null);
    if (r.width > MIN_TARGET_PX && r.height > MIN_TARGET_PX) this.api.setTarget(r);
  }

  private abort(): void {
    this.drag = null;
    this.api.dragUpdate(null);
  }
}

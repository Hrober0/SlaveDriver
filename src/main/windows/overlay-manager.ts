import { screen, type BrowserWindow, type Display } from 'electron';
import { containsPoint, type Point } from '../../shared/geometry';
import { IPC } from '../../shared/ipc';
import type { CursorLocator } from '../cursor/cursor-source';
import type { BaseState } from '../state';
import { alive, createLayerWindow } from './layer-window';

interface Overlay {
  win: BrowserWindow;
  display: Display;
}

const POLL_MS = 4;

// (metrics-changed also fires for work-area-only changes like an auto-hiding panel; ignore those.)
const layoutKey = (ds: Display[]): string => JSON.stringify(ds.map((d) => [d.id, d.bounds]));

/**
 * One click-through overlay per display, created once and never moved. Moving a single overlay
 * between displays flickered: KWin re-places XWayland windows, so its reported bounds could
 * disagree with the requested ones and it got re-placed on every poll tick.
 *
 * The overlay under the cursor is "active": it gets cursor updates and draws the whip.
 */
export class OverlayManager {
  private overlays: Overlay[] = [];
  private active: Overlay | null = null;
  private pollTimer: NodeJS.Timeout | null = null;

  /** @param requestState asks the app to push fresh state (e.g. after a window loaded). */
  constructor(
    private readonly locateCursor: CursorLocator,
    private readonly requestState: () => void,
  ) {}

  /** (Re)creates one hidden overlay per display. */
  create(): void {
    this.destroy();
    this.overlays = screen.getAllDisplays().map((display) => {
      const win = createLayerWindow(display, { clickThrough: true, onPinned: this.requestState });
      win.webContents.on('did-finish-load', this.requestState);
      return { win, display };
    });
  }

  destroy(): void {
    this.stopTracking();
    for (const o of this.overlays) if (alive(o.win)) o.win.destroy();
    this.overlays = [];
    this.active = null;
  }

  /** True if displays were added, removed or moved since the overlays were created. */
  layoutChanged(): boolean {
    return this.overlays.length > 0
      && layoutKey(screen.getAllDisplays()) !== layoutKey(this.overlays.map((o) => o.display));
  }

  /** Shows every overlay without stealing focus and starts routing the cursor to them. */
  show(): void {
    this.active = this.overlayAt(this.locateCursor());
    for (const o of this.live()) {
      o.win.showInactive();         // never steal focus from VS Code
      o.win.setAlwaysOnTop(true, 'screen-saver');
    }
    this.startTracking();
  }

  hide(): void {
    this.stopTracking();
    for (const o of this.live()) o.win.hide();
  }

  sendState(base: BaseState): void {
    for (const o of this.live()) {
      o.win.webContents.send(IPC.state, { ...base, origin: o.display.bounds, active: o === this.active });
    }
  }

  broadcast(channel: string, payload: unknown): void {
    for (const o of this.live()) o.win.webContents.send(channel, payload);
  }

  private startTracking(): void {
    this.stopTracking();
    this.pollTimer = setInterval(() => this.track(), POLL_MS);
  }

  private stopTracking(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private track(): void {
    const p = this.locateCursor();
    const o = this.overlayAt(p);
    if (o !== this.active) {
      // Cursor moved to another monitor: hand the whip to that display's overlay.
      this.active = o;
      this.requestState();
    }
    if (!o || !alive(o.win)) return;
    const b = o.display.bounds;
    o.win.webContents.send(IPC.cursor, { x: p.x - b.x, y: p.y - b.y });
  }

  /** Overlay under the cursor. In a gap between displays, keep the current one instead of bouncing. */
  private overlayAt(p: Point): Overlay | null {
    const hit = this.overlays.find((o) => containsPoint(o.display.bounds, p));
    if (hit) return hit;
    if (this.active) return this.active;
    const d = screen.getDisplayNearestPoint(p);
    return this.overlays.find((o) => o.display.id === d.id) || this.overlays[0] || null;
  }

  private live(): Overlay[] {
    return this.overlays.filter((o) => alive(o.win));
  }
}

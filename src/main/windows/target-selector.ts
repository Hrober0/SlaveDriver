import { BrowserWindow, screen, type WebContents } from 'electron';
import type { Rect } from '../../shared/geometry';
import { IPC } from '../../shared/ipc';
import type { CursorLocator } from '../cursor/cursor-source';
import type { BaseState } from '../state';
import { alive, createLayerWindow } from './layer-window';

export interface TargetSelectorEvents {
  /** Push fresh state (a window finished loading or was re-pinned). */
  requestState: () => void;
  /** A selector window was closed by the user (e.g. Alt+F4). */
  cancelled: () => void;
}

/**
 * Drag-to-select the agent area.
 *
 * Linux can't flip a window between click-through/unfocusable and interactive (setFocusable is a
 * no-op there, and the input region doesn't reliably come back under XWayland/KWin). So target
 * selection gets its own normal windows, one per display, that take input from the start.
 */
export class TargetSelector {
  private windows: BrowserWindow[] = [];

  constructor(
    private readonly locateCursor: CursorLocator,
    private readonly events: TargetSelectorEvents,
  ) {}

  get isOpen(): boolean {
    return this.windows.length > 0;
  }

  open(): void {
    this.close();
    const focusId = screen.getDisplayNearestPoint(this.locateCursor()).id;
    for (const d of screen.getAllDisplays()) {
      const w = createLayerWindow(d, { clickThrough: false, onPinned: this.events.requestState });
      this.windows.push(w);
      w.webContents.on('did-finish-load', () => {
        if (!alive(w)) return;
        w.show();
        if (d.id === focusId) w.focus();
        this.events.requestState();
      });
      w.on('closed', () => {
        // Closed some other way than close() (e.g. Alt+F4): treat as cancel.
        if (this.windows.includes(w)) this.events.cancelled();
      });
    }
  }

  close(): void {
    const ws = this.windows;
    this.windows = [];
    for (const w of ws) if (alive(w)) w.close();
  }

  sendState(base: BaseState): void {
    for (const w of this.live()) {
      w.webContents.send(IPC.state, { ...base, origin: w.getBounds(), active: false });
    }
  }

  /** Converts a rect local to `sender`'s window into global screen coordinates. */
  toGlobal(sender: WebContents, r: Rect): Rect | null {
    const src = BrowserWindow.fromWebContents(sender);
    if (!src || !alive(src)) return null;
    const o = src.getBounds();
    return { x: r.x + o.x, y: r.y + o.y, width: r.width, height: r.height };
  }

  /**
   * A drag can start on one display and end on another: the window where it started keeps getting
   * pointer events (with coordinates outside itself), and we mirror the box onto every display.
   */
  mirrorDrag(sender: WebContents, r: Rect | null): void {
    const global = r && this.toGlobal(sender, r);
    if (r && !global) return;
    for (const w of this.live()) {
      const b = w.getBounds();
      w.webContents.send(IPC.drag, global && { ...global, x: global.x - b.x, y: global.y - b.y });
    }
  }

  private live(): BrowserWindow[] {
    return this.windows.filter(alive);
  }
}

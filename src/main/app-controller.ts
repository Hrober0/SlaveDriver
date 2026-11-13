import { app, ipcMain, screen, shell, type IpcMainEvent } from 'electron';
import type { Rect } from '../shared/geometry';
import { IPC } from '../shared/ipc';
import type { Mode } from '../shared/types';
import type { ConfigStore } from './config-store';
import type { CursorLocator } from './cursor/cursor-source';
import { MascotController } from './mascot-controller';
import { registerShortcuts } from './shortcuts';
import type { BaseState } from './state';
import { AppTray } from './tray';
import type { WordsStore } from './words-store';
import { OverlayManager } from './windows/overlay-manager';
import { TargetSelector } from './windows/target-selector';

// The picker ignores drags smaller than this (accidental clicks).
const MIN_TARGET_PX = 20;

/** Default agent area: right 30% of the primary display (where Claude Code usually sits in VS Code). */
function defaultTarget(): Rect {
  const wa = screen.getPrimaryDisplay().workArea;
  const w = Math.round(wa.width * 0.3);
  return { x: wa.x + wa.width - w, y: wa.y, width: w, height: wa.height };
}

export interface AppControllerOptions {
  config: ConfigStore;
  words: WordsStore;
  locateCursor: CursorLocator;
  showTarget: boolean;
}

/**
 * The mode state machine ('off' | 'whip' | 'target') and the glue between the windows, the tray,
 * shortcuts and IPC. Owns no rendering or persistence logic itself.
 */
export class AppController {
  private mode: Mode = 'off';
  private modeBeforeTarget: Mode = 'off';
  private showTarget: boolean;
  private tray: AppTray | null = null;

  private readonly config: ConfigStore;
  private readonly words: WordsStore;
  private readonly overlays: OverlayManager;
  private readonly selector: TargetSelector;
  private readonly mascot: MascotController;

  constructor(opts: AppControllerOptions) {
    this.config = opts.config;
    this.words = opts.words;
    this.showTarget = opts.showTarget;
    const requestState = () => this.sendState();
    this.overlays = new OverlayManager(opts.locateCursor, requestState);
    this.selector = new TargetSelector(opts.locateCursor, {
      requestState,
      cancelled: () => this.cancelTarget(),
    });
    this.mascot = new MascotController(() => this.target());
  }

  /** Creates windows, tray and shortcuts and starts listening. Call once the app is ready. */
  start(): void {
    this.overlays.create();
    const displaysChanged = () => this.onDisplaysChanged();
    screen.on('display-added', displaysChanged);
    screen.on('display-removed', displaysChanged);
    screen.on('display-metrics-changed', displaysChanged);
    this.bindIpc();
    this.registerShortcuts();
    this.tray = new AppTray({
      toggleWhip: () => this.toggleWhip(),
      selectTarget: () => this.selectTarget(),
      setShowTarget: (show) => { this.showTarget = show; this.sendState(); },
      resetTarget: () => { this.config.setTarget(null); this.sendState(); },
      editWords: () => void shell.openPath(this.words.filePath),
      editConfig: () => void shell.openPath(this.config.filePath),
      reload: () => this.reload(),
      quit: () => app.quit(),
    });
    this.updateTray();
  }

  toggleWhip(): void {
    this.setMode(this.mode === 'whip' ? 'off' : 'whip');
  }

  selectTarget(): void {
    if (this.mode === 'target') return;
    this.modeBeforeTarget = this.mode;
    this.setMode('target');
  }

  /** Words changed on disk. */
  wordsChanged(): void {
    this.sendState();
  }

  private target(): Rect {
    return this.config.config.target || defaultTarget();
  }

  private setMode(next: Mode): void {
    this.mode = next;
    if (next !== 'target') this.selector.close();
    if (next === 'whip') {
      this.overlays.show();
    } else {
      this.overlays.hide();
      if (next === 'target') this.selector.open();
    }
    // The selector windows request state themselves once they have loaded.
    if (next !== 'target') this.sendState();
    this.updateTray();
  }

  private leaveTarget(): void {
    this.setMode(this.modeBeforeTarget === 'whip' ? 'whip' : 'off');
  }

  private cancelTarget(): void {
    if (this.mode === 'target') this.leaveTarget();
  }

  private sendState(): void {
    const base: BaseState = {
      mode: this.mode,
      target: this.target(),
      showTarget: this.showTarget,
      words: this.words.words,
      config: this.config.config,
      mascot: this.mascot.state,
    };
    this.overlays.sendState(base);
    this.selector.sendState(base);
  }

  /** Displays were added/removed/rearranged: rebuild the overlays. */
  private onDisplaysChanged(): void {
    if (!this.overlays.layoutChanged()) return;
    this.overlays.create();
    this.mascot.respawn();
    if (this.mode === 'whip') this.setMode('whip');
  }

  private reload(): void {
    this.config.load();
    this.words.load();
    this.registerShortcuts();
    this.sendState();
    this.updateTray();
  }

  private registerShortcuts(): void {
    const s = this.config.config.shortcuts;
    registerShortcuts([
      [s.toggle, () => this.toggleWhip()],
      [s.setTarget, () => this.selectTarget()],
    ]);
  }

  private updateTray(): void {
    this.tray?.render({ mode: this.mode, showTarget: this.showTarget, shortcuts: this.config.config.shortcuts });
  }

  private bindIpc(): void {
    ipcMain.on(IPC.setTarget, (e: IpcMainEvent, r: Rect) => {
      if (this.mode !== 'target' || r.width <= MIN_TARGET_PX || r.height <= MIN_TARGET_PX) return;
      const g = this.selector.toGlobal(e.sender, r);
      if (!g) return;
      this.config.setTarget({
        x: Math.round(g.x), y: Math.round(g.y), width: Math.round(g.width), height: Math.round(g.height),
      });
      this.leaveTarget();
    });

    ipcMain.on(IPC.dragUpdate, (e: IpcMainEvent, r: Rect | null) => {
      if (this.mode === 'target') this.selector.mirrorDrag(e.sender, r);
    });

    ipcMain.on(IPC.cancelTarget, () => this.cancelTarget());

    // The active overlay saw the whip tip hit the mascot: start its hurt + hop, shown on every display.
    ipcMain.on(IPC.mascotHit, () => {
      if (this.mascot.hit()) this.overlays.broadcast(IPC.mascot, this.mascot.state);
    });
  }
}

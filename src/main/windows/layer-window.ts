import { BrowserWindow, type Display } from 'electron';
import path from 'path';

export interface LayerWindowOptions {
  /** Click-through, never focusable (the whip overlay). Otherwise a normal window taking input. */
  clickThrough: boolean;
  /** Called each time the window has been (re)pinned to its display. */
  onPinned: () => void;
}

// Built files live next to each other in dist/.
const PRELOAD = path.join(__dirname, 'preload.js');
const PAGE = path.join(__dirname, 'overlay.html');

/** A frameless, transparent, always-on-top window covering exactly one display. */
export function createLayerWindow(display: Display, opts: LayerWindowOptions): BrowserWindow {
  const win = new BrowserWindow({
    ...display.bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    ...(opts.clickThrough && { movable: false, fullscreenable: false, focusable: false }),
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      // The whip overlay must keep animating while unfocused.
      backgroundThrottling: !opts.clickThrough,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  if (opts.clickThrough) {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setIgnoreMouseEvents(true);
  }
  pinToDisplay(win, display, opts.onPinned);
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) console.error(`[overlay] ${message} (${source}:${line})`);
  });
  win.loadFile(PAGE);
  return win;
}

/**
 * KWin places XWayland windows itself when they are first mapped and ignores the requested
 * position, so move the window back onto its display a few times once it is visible.
 */
function pinToDisplay(win: BrowserWindow, display: Display, onPinned: () => void): void {
  const pin = () => {
    if (win.isDestroyed()) return;
    win.setBounds(display.bounds);
    onPinned();
  };
  win.on('show', () => {
    pin();
    setTimeout(pin, 50);
    setTimeout(pin, 250);
  });
}

export const alive = (w: BrowserWindow): boolean => !w.isDestroyed();

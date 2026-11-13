import { Menu, Tray, nativeImage, type NativeImage } from 'electron';
import type { Mode, Shortcuts } from '../shared/types';

export interface TrayActions {
  toggleWhip(): void;
  selectTarget(): void;
  setShowTarget(show: boolean): void;
  resetTarget(): void;
  editWords(): void;
  editConfig(): void;
  reload(): void;
  quit(): void;
}

export interface TrayView {
  mode: Mode;
  showTarget: boolean;
  shortcuts: Shortcuts;
}

/** The tray icon and its context menu. Knows nothing about app state beyond what it is shown. */
export class AppTray {
  private readonly tray: Tray;

  constructor(private readonly actions: TrayActions) {
    this.tray = new Tray(makeTrayIcon());
    this.tray.setToolTip('SlaveDriver');
    this.tray.on('click', actions.toggleWhip);
  }

  render(view: TrayView): void {
    const a = this.actions;
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: view.mode === 'whip' ? 'Holster whip' : 'Draw whip', accelerator: view.shortcuts.toggle, click: a.toggleWhip },
      { label: 'Set agent target area…', accelerator: view.shortcuts.setTarget, click: a.selectTarget },
      {
        label: 'Show agent area outline',
        type: 'checkbox',
        checked: view.showTarget,
        click: (item) => a.setShowTarget(item.checked),
      },
      { label: 'Reset target to default', click: a.resetTarget },
      { type: 'separator' },
      { label: 'Edit words.json', click: a.editWords },
      { label: 'Edit config.json', click: a.editConfig },
      { label: 'Reload config + words', click: a.reload },
      { type: 'separator' },
      { label: 'Quit', click: a.quit },
    ]));
  }
}

/** 16x16 whip drawn pixel by pixel, so the app ships without image assets. */
function makeTrayIcon(): NativeImage {
  const s = 16;
  const buf = Buffer.alloc(s * s * 4);
  const px = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= s || y >= s) return;
    const i = (y * s + x) * 4;
    buf[i] = 30; buf[i + 1] = 60; buf[i + 2] = 130; buf[i + 3] = 255; // BGRA brown
  };
  for (let t = 0; t < 1; t += 0.01) {
    if (t < 0.35) {
      // handle: thick diagonal
      const x = Math.round(2 + t * 14);
      const y = Math.round(14 - t * 14);
      px(x, y); px(x + 1, y); px(x, y + 1);
    } else {
      // lash: curve
      const x = Math.round(7 + 7 * Math.sin((t - 0.35) * 4.5));
      const y = Math.round(9 - 7 * Math.sin((t - 0.35) * 3) + (t - 0.35) * 8);
      px(x, y);
    }
  }
  return nativeImage.createFromBitmap(buf, { width: s, height: s });
}

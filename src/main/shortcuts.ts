import { globalShortcut } from 'electron';

/** Replaces all global shortcuts with the given ones. Empty accelerators are skipped. */
export function registerShortcuts(bindings: Array<[accelerator: string, handler: () => void]>): void {
  globalShortcut.unregisterAll();
  for (const [accel, fn] of bindings) {
    if (!accel) continue;
    try {
      if (!globalShortcut.register(accel, fn)) console.warn(`Shortcut ${accel} is taken by another app.`);
    } catch (e) {
      console.warn(`Invalid shortcut "${accel}": ${(e as Error).message}`);
    }
  }
}

export const unregisterShortcuts = (): void => globalShortcut.unregisterAll();

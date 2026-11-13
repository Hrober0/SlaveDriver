// Composition root: wires the stores, cursor sources and controller together and handles the
// Electron app lifecycle. Everything else lives in its own module.
import { app } from 'electron';
import path from 'path';
import { AppController } from './app-controller';
import { ConfigStore } from './config-store';
import { cursorLocator } from './cursor/cursor-source';
import { KWinCursor } from './cursor/kwin-cursor';
import { unregisterShortcuts } from './shortcuts';
import { WordsStore } from './words-store';

const isLinux = process.platform === 'linux';

// Linux needs this for real transparency (a compositor must also be running).
if (isLinux) app.commandLine.appendSwitch('enable-transparent-visuals');
// Let the crack sound play without a user gesture.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Bundled to dist/main.js; words.json sits in the project root.
const WORDS_PATH = path.join(__dirname, '..', 'words.json');

function run(): void {
  const config = new ConfigStore(path.join(app.getPath('userData'), 'config.json'));
  const words = new WordsStore(WORDS_PATH);
  // On KDE Wayland, KWin feeds us the real position; elsewhere Electron's view is used.
  const kwinCursor = new KWinCursor(path.join(app.getPath('userData'), 'kwin'));
  const controller = new AppController({
    config,
    words,
    locateCursor: cursorLocator(kwinCursor),
    // Agent area outline is hidden unless started with --show-target (or toggled from the tray).
    showTarget: process.argv.includes('--show-target'),
  });

  // `electron . --select-target` while running opens the area picker (handy for a KDE custom
  // shortcut when global shortcuts don't work); a plain second launch toggles the whip.
  app.on('second-instance', (_e, argv) => {
    if (argv.includes('--select-target')) controller.selectTarget();
    else controller.toggleWhip();
  });

  app.whenReady().then(() => {
    config.load();
    words.load();
    void kwinCursor.start();
    words.watch(() => controller.wordsChanged());
    // Linux transparency is more reliable when the window is created slightly after ready.
    setTimeout(() => {
      controller.start();
      const { shortcuts } = config.config;
      console.log(`SlaveDriver ready. ${shortcuts.toggle} = whip, ${shortcuts.setTarget} = set target.`);
      console.log(`Config: ${config.filePath}`);
    }, isLinux ? 300 : 0);
  });

  // Unload the KWin cursor script before exiting.
  let cleanedUp = false;
  app.on('will-quit', (e) => {
    unregisterShortcuts();
    if (cleanedUp) return;
    e.preventDefault();
    cleanedUp = true;
    kwinCursor.stop().finally(() => app.quit());
  });
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => app.quit());
  // The app lives in the tray. Having any listener here stops Electron from quitting when the last
  // window closes. (The event has no argument; the old `e.preventDefault()` would have thrown.)
  app.on('window-all-closed', () => {});
}

if (app.requestSingleInstanceLock()) run();
else app.quit();

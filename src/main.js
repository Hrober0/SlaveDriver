const {
  app, BrowserWindow, globalShortcut, screen, ipcMain, Tray, Menu, nativeImage, shell,
} = require('electron');
const path = require('path');
const fs = require('fs');
const kwinCursor = require('./kwin-cursor');

// Linux needs this for real transparency (a compositor must also be running).
if (process.platform === 'linux') app.commandLine.appendSwitch('enable-transparent-visuals');
// Let the crack sound play without a user gesture.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Bump when tuning defaults change; older configs get their tuning keys reset.
const CONFIG_VERSION = 2;
const TUNING_KEYS = ['hitSpeed', 'crackSpeed', 'hitCooldownMs', 'whip'];

// Agent area outline is hidden unless started with --show-target (or toggled from the tray).
let showTarget = process.argv.includes('--show-target');

const DEFAULT_CONFIG = {
  version: CONFIG_VERSION,
  shortcuts: {
    toggle: 'CommandOrControl+Alt+W',
    setTarget: 'CommandOrControl+Alt+T',
  },
  // Absolute screen rect {x, y, width, height} in DIP. null => right 30% of the primary display
  // (where the Claude Code panel usually sits in VS Code).
  target: null,
  mascot: true,       // true: you must hit the mascot. false: anywhere in the agent area counts.
  speak: true,
  sound: true,
  hitSpeed: 1800,     // px/s the tip must move to count as a hit
  crackSpeed: 2800,   // px/s for the crack effect + sound
  hitCooldownMs: 700,
  whip: {
    segments: 34,
    segmentLength: 10,
    handleSegments: 4,
    gravity: 1100,    // px/s^2
    damping: 0.994,   // linear velocity kept per physics step (240 Hz)
    drag: 0.0025,     // quadratic air drag: fast-moving parts slow down more
    stiffness: 0.35,  // bending stiffness at the handle, tapering to floppy at the tip
    iterations: 20,
  },
};

// Messages are "<random first> <random second>". Edit words.json; it reloads on save.
const WORDS_PATH = path.join(__dirname, '..', 'words.json');
let words = { first: ['ouch'], second: ['my head'] };

function loadWords() {
  try {
    const w = JSON.parse(fs.readFileSync(WORDS_PATH, 'utf8'));
    if (!Array.isArray(w.first) || !Array.isArray(w.second) || !w.first.length || !w.second.length) {
      throw new Error('needs non-empty "first" and "second" arrays');
    }
    words = { first: w.first.map(String), second: w.second.map(String) };
  } catch (e) {
    console.error(`words.json not loaded (${e.message}); keeping previous words.`);
  }
}

let win = null;
let tray = null;
let mode = 'off';           // 'off' | 'whip' | 'target'
let modeBeforeTarget = 'off';
let pollTimer = null;
let bounds = null;
let config = null;

const configPath = () => path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  let user = {};
  try {
    user = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('Bad config.json, using defaults:', e.message);
  }
  delete user.showTarget; // now a launch flag, not a config value
  delete user.wordsA;     // words now live in words.json
  delete user.wordsB;
  const outdated = (user.version || 1) < CONFIG_VERSION;
  if (outdated) for (const k of TUNING_KEYS) delete user[k];
  user.version = CONFIG_VERSION;
  config = {
    ...DEFAULT_CONFIG,
    ...user,
    shortcuts: { ...DEFAULT_CONFIG.shortcuts, ...(user.shortcuts || {}) },
    whip: { ...DEFAULT_CONFIG.whip, ...(user.whip || {}) },
  };
  if (outdated || !fs.existsSync(configPath())) saveConfig();
}

function saveConfig() {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
}

function defaultTarget() {
  const wa = screen.getPrimaryDisplay().workArea;
  const w = Math.round(wa.width * 0.3);
  return { x: wa.x + wa.width - w, y: wa.y, width: w, height: wa.height };
}

const effectiveTarget = () => config.target || defaultTarget();

function createOverlay() {
  win = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true);
  win.loadFile(path.join(__dirname, 'overlay.html'));
  win.webContents.on('did-finish-load', sendState);
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) console.error(`[overlay] ${message} (${source}:${line})`);
  });
}

function placeOnDisplay(pt) {
  const d = screen.getDisplayNearestPoint(pt);
  win.setBounds(d.bounds);
  bounds = win.getBounds();
}

function sendState() {
  if (!win) return;
  win.webContents.send('state', {
    mode,
    origin: bounds || win.getBounds(),
    target: effectiveTarget(),
    showTarget,
    words,
    config,
  });
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

// On KDE Wayland, KWin feeds us the real position; elsewhere ask Electron.
const cursorPoint = () => kwinCursor.position() || screen.getCursorScreenPoint();

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => {
    const p = cursorPoint();
    const inside = p.x >= bounds.x && p.y >= bounds.y
      && p.x < bounds.x + bounds.width && p.y < bounds.y + bounds.height;
    if (!inside) {
      // Cursor moved to another monitor: follow it.
      placeOnDisplay(p);
      sendState();
    }
    win.webContents.send('cursor', { x: p.x - bounds.x, y: p.y - bounds.y });
  }, 4);
}

function setMode(next) {
  mode = next;
  stopPolling();
  if (next === 'off') {
    win.hide();
    sendState();
    updateTray();
    return;
  }
  placeOnDisplay(cursorPoint());
  if (next === 'whip') {
    win.setIgnoreMouseEvents(true);
    win.setFocusable(false);
    win.showInactive();           // never steal focus from VS Code
    startPolling();
  } else {
    win.setIgnoreMouseEvents(false);
    win.setFocusable(true);
    win.show();
    win.focus();
  }
  win.setAlwaysOnTop(true, 'screen-saver');
  sendState();
  updateTray();
}

const toggleWhip = () => setMode(mode === 'whip' ? 'off' : 'whip');

function enterTargetMode() {
  if (mode === 'target') return;
  modeBeforeTarget = mode;
  setMode('target');
}

function registerShortcuts() {
  globalShortcut.unregisterAll();
  const reg = (accel, fn) => {
    if (!accel) return;
    try {
      if (!globalShortcut.register(accel, fn)) console.warn(`Shortcut ${accel} is taken by another app.`);
    } catch (e) {
      console.warn(`Invalid shortcut "${accel}": ${e.message}`);
    }
  };
  reg(config.shortcuts.toggle, toggleWhip);
  reg(config.shortcuts.setTarget, enterTargetMode);
}

function makeTrayIcon() {
  const s = 16;
  const buf = Buffer.alloc(s * s * 4);
  const px = (x, y) => {
    if (x < 0 || y < 0 || x >= s || y >= s) return;
    const i = (y * s + x) * 4;
    buf[i] = 30; buf[i + 1] = 60; buf[i + 2] = 130; buf[i + 3] = 255; // BGRA brown
  };
  for (let t = 0; t < 1; t += 0.01) {
    // handle: thick diagonal; lash: curve
    if (t < 0.35) {
      const x = Math.round(2 + t * 14), y = Math.round(14 - t * 14);
      px(x, y); px(x + 1, y); px(x, y + 1);
    } else {
      const x = Math.round(7 + 7 * Math.sin((t - 0.35) * 4.5));
      const y = Math.round(9 - 7 * Math.sin((t - 0.35) * 3) + (t - 0.35) * 8);
      px(x, y);
    }
  }
  return nativeImage.createFromBitmap(buf, { width: s, height: s });
}

function updateTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: mode === 'whip' ? 'Holster whip' : 'Draw whip', accelerator: config.shortcuts.toggle, click: toggleWhip },
    { label: 'Set agent target area…', accelerator: config.shortcuts.setTarget, click: enterTargetMode },
    {
      label: 'Show agent area outline',
      type: 'checkbox',
      checked: showTarget,
      click: (item) => { showTarget = item.checked; sendState(); },
    },
    {
      label: 'Reset target to default',
      click: () => { config.target = null; saveConfig(); sendState(); },
    },
    { type: 'separator' },
    { label: 'Edit words.json', click: () => shell.openPath(WORDS_PATH) },
    { label: 'Edit config.json', click: () => shell.openPath(configPath()) },
    {
      label: 'Reload config + words',
      click: () => { loadConfig(); loadWords(); registerShortcuts(); sendState(); updateTray(); },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
}

ipcMain.on('set-target', (_e, r) => {
  const o = bounds || win.getBounds();
  config.target = {
    x: Math.round(r.x + o.x), y: Math.round(r.y + o.y),
    width: Math.round(r.width), height: Math.round(r.height),
  };
  saveConfig();
  setMode(modeBeforeTarget === 'whip' ? 'whip' : 'off');
});

ipcMain.on('cancel-target', () => setMode(modeBeforeTarget === 'whip' ? 'whip' : 'off'));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', toggleWhip);
  app.whenReady().then(() => {
    loadConfig();
    loadWords();
    kwinCursor.start(path.join(app.getPath('userData'), 'kwin'));
    fs.watchFile(WORDS_PATH, { interval: 500 }, () => { loadWords(); sendState(); });
    // Linux transparency is more reliable when the window is created slightly after ready.
    setTimeout(() => {
      createOverlay();
      registerShortcuts();
      tray = new Tray(makeTrayIcon());
      tray.setToolTip('SlaveDriver');
      tray.on('click', toggleWhip);
      updateTray();
      console.log(`SlaveDriver ready. ${config.shortcuts.toggle} = whip, ${config.shortcuts.setTarget} = set target.`);
      console.log(`Config: ${configPath()}`);
    }, process.platform === 'linux' ? 300 : 0);
  });
  let cleanedUp = false;
  app.on('will-quit', (e) => {
    globalShortcut.unregisterAll();
    if (cleanedUp) return;
    // Unload the KWin cursor script before exiting.
    e.preventDefault();
    cleanedUp = true;
    kwinCursor.stop().finally(() => app.quit());
  });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => app.quit());
  app.on('window-all-closed', (e) => e.preventDefault());
}

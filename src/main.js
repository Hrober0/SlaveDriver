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

// One click-through overlay per display, created once and never moved. Moving a single overlay
// between displays flickered: KWin re-places XWayland windows, so its reported bounds could
// disagree with the requested ones and it got re-placed on every poll tick.
let overlays = [];          // [{ win, display }]
let active = null;          // overlay that currently has the cursor (and draws the whip)
let selWins = [];           // separate, focusable windows (one per display) for picking the target area
let tray = null;
let mode = 'off';           // 'off' | 'whip' | 'target'
let modeBeforeTarget = 'off';
let pollTimer = null;
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

// ---------- mascot ----------
// One mascot shared by every overlay, in global screen coordinates. Each overlay used to keep its
// own copy, so with an agent area spanning monitors the mascot could hop onto a display whose
// overlay had a different (or no) mascot, and it vanished. Times are Date.now() ms so every
// renderer can derive the same animation phase: hurt for HURT_MS at `from`, then a hop to `to`.
const MASCOT_HURT_MS = 320;
const MASCOT_JUMP_MS = 650;
let mascot = null;          // { from, to, hitAt }
let mascotTargetKey = null;

// Random spot in the agent area that is fully on some display (a box spanning monitors of
// different sizes can cover gaps no screen shows). Prefers spots > 180 px away from `avoid`.
function mascotSpot(avoid) {
  const r = effectiveTarget();
  const mx = 50, mTop = 70, mBottom = 50;
  const displays = screen.getAllDisplays().map((d) => d.bounds);
  const visible = (p) => displays.some((b) => p.x >= b.x + mx && p.x <= b.x + b.width - mx
    && p.y >= b.y + mTop && p.y <= b.y + b.height - mBottom);
  const minX = r.x + mx, maxX = Math.max(minX, r.x + r.width - mx);
  const minY = r.y + mTop, maxY = Math.max(minY, r.y + r.height - mBottom);
  let best = null;
  for (let k = 0; k < 60; k++) {
    const p = { x: minX + Math.random() * (maxX - minX), y: minY + Math.random() * (maxY - minY) };
    if (!visible(p)) continue;
    const d = avoid ? Math.hypot(p.x - avoid.x, p.y - avoid.y) : Infinity;
    if (d > 180) return p;
    if (!best || d > best.d) best = { x: p.x, y: p.y, d };
  }
  if (best) return { x: best.x, y: best.y };
  // Nothing visible found: fall back to the middle of the area.
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

function spawnMascot() {
  const p = mascotSpot();
  mascot = { from: p, to: p, hitAt: 0 };
  mascotTargetKey = JSON.stringify(effectiveTarget());
}

function sendMascot() {
  for (const o of overlays) if (!o.win.isDestroyed()) o.win.webContents.send('mascot', mascot);
}

function createOverlay(d) {
  const win = new BrowserWindow({
    ...d.bounds,
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
  // KWin places XWayland windows itself when first mapped; put it back on its display.
  const pin = () => { if (!win.isDestroyed()) { win.setBounds(d.bounds); sendState(); } };
  win.on('show', () => { pin(); setTimeout(pin, 50); setTimeout(pin, 250); });
  win.loadFile(path.join(__dirname, 'overlay.html'));
  win.webContents.on('did-finish-load', sendState);
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) console.error(`[overlay] ${message} (${source}:${line})`);
  });
  return { win, display: d };
}

function createOverlays() {
  for (const o of overlays) if (!o.win.isDestroyed()) o.win.destroy();
  overlays = screen.getAllDisplays().map(createOverlay);
  active = null;
}

// Displays were added/removed/rearranged: rebuild the overlays.
// (metrics-changed also fires for work-area-only changes like an auto-hiding panel; ignore those.)
const layoutKey = (ds) => JSON.stringify(ds.map((d) => [d.id, d.bounds]));
function rebuildOverlays() {
  if (!overlays.length) return;
  if (layoutKey(screen.getAllDisplays()) === layoutKey(overlays.map((o) => o.display))) return;
  createOverlays();
  spawnMascot();
  if (mode === 'whip') setMode('whip');
}

const contains = (b, p) => p.x >= b.x && p.y >= b.y && p.x < b.x + b.width && p.y < b.y + b.height;

// Overlay under the cursor. In a gap between displays, keep the current one instead of bouncing.
function overlayAt(p) {
  const hit = overlays.find((o) => contains(o.display.bounds, p));
  if (hit) return hit;
  if (active) return active;
  const d = screen.getDisplayNearestPoint(p);
  return overlays.find((o) => o.display.id === d.id) || overlays[0];
}

// Linux can't flip a window between click-through/unfocusable and interactive (setFocusable is a
// no-op there, and the input region doesn't reliably come back under XWayland/KWin). So target
// selection gets its own normal windows, one per display, that take input from the start.
function openSelector() {
  closeSelector();
  const focusId = screen.getDisplayNearestPoint(cursorPoint()).id;
  for (const d of screen.getAllDisplays()) {
    const w = new BrowserWindow({
      ...d.bounds,
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
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    selWins.push(w);
    // KWin places XWayland windows itself when they are first mapped and ignores the requested
    // position, so move the window onto its display again once it is visible.
    const pin = () => { if (!w.isDestroyed()) { w.setBounds(d.bounds); sendState(); } };
    w.on('show', () => { pin(); setTimeout(pin, 50); setTimeout(pin, 250); });
    w.setAlwaysOnTop(true, 'screen-saver');
    w.loadFile(path.join(__dirname, 'overlay.html'));
    w.webContents.on('did-finish-load', () => {
      if (w.isDestroyed()) return;
      w.show();
      if (d.id === focusId) w.focus();
      sendState();
    });
    w.on('closed', () => {
      if (!selWins.includes(w)) return;
      // Closed some other way (e.g. Alt+F4): treat as cancel.
      if (mode === 'target') setMode(modeBeforeTarget === 'whip' ? 'whip' : 'off');
    });
  }
}

function closeSelector() {
  const ws = selWins;
  selWins = [];
  for (const w of ws) if (!w.isDestroyed()) w.close();
}

function sendState() {
  if (!mascot || JSON.stringify(effectiveTarget()) !== mascotTargetKey) spawnMascot();
  const state = { mode, target: effectiveTarget(), showTarget, words, config, mascot };
  for (const o of overlays) {
    if (o.win.isDestroyed()) continue;
    o.win.webContents.send('state', { ...state, origin: o.display.bounds, active: o === active });
  }
  for (const w of selWins) {
    if (!w.isDestroyed()) w.webContents.send('state', { ...state, origin: w.getBounds() });
  }
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
    const o = overlayAt(p);
    if (o !== active) {
      // Cursor moved to another monitor: hand the whip to that display's overlay.
      active = o;
      sendState();
    }
    if (!o || o.win.isDestroyed()) return;
    const b = o.display.bounds;
    o.win.webContents.send('cursor', { x: p.x - b.x, y: p.y - b.y });
  }, 4);
}

function setMode(next) {
  mode = next;
  stopPolling();
  if (next !== 'target') closeSelector();
  const hideOverlays = () => { for (const o of overlays) if (!o.win.isDestroyed()) o.win.hide(); };
  if (next === 'off') {
    hideOverlays();
    sendState();
    updateTray();
    return;
  }
  if (next === 'target') {
    hideOverlays();
    openSelector();
    updateTray();
    return;
  }
  active = overlayAt(cursorPoint());
  for (const o of overlays) {
    if (o.win.isDestroyed()) continue;
    o.win.showInactive();         // never steal focus from VS Code
    o.win.setAlwaysOnTop(true, 'screen-saver');
  }
  startPolling();
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

ipcMain.on('set-target', (e, r) => {
  if (mode !== 'target') return;
  const src = BrowserWindow.fromWebContents(e.sender);
  if (!src || src.isDestroyed()) return;
  const o = src.getBounds();
  config.target = {
    x: Math.round(r.x + o.x), y: Math.round(r.y + o.y),
    width: Math.round(r.width), height: Math.round(r.height),
  };
  saveConfig();
  setMode(modeBeforeTarget === 'whip' ? 'whip' : 'off');
});

// A drag can start on one display and end on another: the window where it started keeps getting
// pointer events (with coordinates outside itself), and we mirror the box onto every display.
ipcMain.on('drag-update', (e, r) => {
  const src = BrowserWindow.fromWebContents(e.sender);
  if (!src || mode !== 'target') return;
  const o = src.getBounds();
  for (const w of selWins) {
    if (w.isDestroyed()) continue;
    const b = w.getBounds();
    w.webContents.send('drag', r && { ...r, x: r.x + o.x - b.x, y: r.y + o.y - b.y });
  }
});

// The active overlay saw the whip tip hit the mascot: start its hurt + hop, shown on every display.
ipcMain.on('mascot-hit', () => {
  const now = Date.now();
  if (!mascot || now - mascot.hitAt < MASCOT_HURT_MS + MASCOT_JUMP_MS) return;
  mascot = { from: mascot.to, to: mascotSpot(mascot.to), hitAt: now };
  sendMascot();
});

ipcMain.on('cancel-target', () => mode === 'target' && setMode(modeBeforeTarget === 'whip' ? 'whip' : 'off'));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // `electron . --select-target` while running opens the area picker (handy for a KDE custom
  // shortcut when global shortcuts don't work); a plain second launch toggles the whip.
  app.on('second-instance', (_e, argv) => (argv.includes('--select-target') ? enterTargetMode() : toggleWhip()));
  app.whenReady().then(() => {
    loadConfig();
    loadWords();
    kwinCursor.start(path.join(app.getPath('userData'), 'kwin'));
    fs.watchFile(WORDS_PATH, { interval: 500 }, () => { loadWords(); sendState(); });
    // Linux transparency is more reliable when the window is created slightly after ready.
    setTimeout(() => {
      createOverlays();
      for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) {
        screen.on(ev, rebuildOverlays);
      }
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

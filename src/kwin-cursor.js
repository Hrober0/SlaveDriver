// Global cursor tracking on KDE Plasma Wayland.
//
// On Wayland, Electron (native or via XWayland) only sees the pointer while it is over one of
// its own windows. The overlay is click-through, so getCursorScreenPoint() freezes. KWin does
// know the real position: we load a tiny KWin script that pushes workspace.cursorPos to us over
// the session D-Bus on every move.
const fs = require('fs');
const path = require('path');

const SERVICE = 'org.slavedriver.Cursor';
const OBJ_PATH = '/org/slavedriver/Cursor';
const IFACE = 'org.slavedriver.Cursor';
const PLUGIN = 'slavedriver-cursor';

const KWIN_SCRIPT = `
function send() {
  var p = workspace.cursorPos;
  callDBus("${SERVICE}", "${OBJ_PATH}", "${IFACE}", "Move", Math.round(p.x), Math.round(p.y));
}
workspace.cursorPosChanged.connect(send);
send();
`;

const isKdeWayland = () => process.platform === 'linux'
  && (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY)
  && /kde/i.test(process.env.XDG_CURRENT_DESKTOP || '');

let bus = null;
let latest = null;

async function kwinCall(b, objPath, iface, member, signature = '', body = []) {
  const { Message } = require('dbus-next');
  const reply = await b.call(new Message({
    destination: 'org.kde.KWin', path: objPath, interface: iface, member, signature, body,
  }));
  return reply.body;
}

// Starts tracking. Resolves true if KWin is feeding us positions.
async function start(scriptDir) {
  if (!isKdeWayland()) return false;
  try {
    const dbus = require('dbus-next');
    bus = dbus.sessionBus();
    bus.on('error', (e) => console.warn('D-Bus error:', e.message));

    // Low-level handler: accepts whatever numeric types KWin's callDBus marshals (int or double).
    bus.addMethodHandler((msg) => {
      if (msg.path !== OBJ_PATH || msg.interface !== IFACE || msg.member !== 'Move') return false;
      const [x, y] = msg.body.map(Number);
      if (Number.isFinite(x) && Number.isFinite(y)) latest = { x, y };
      if (!(msg.flags & dbus.MessageFlag.NO_REPLY_EXPECTED)) bus.send(dbus.Message.newMethodReturn(msg));
      return true;
    });
    await bus.requestName(SERVICE, dbus.NameFlag.DO_NOT_QUEUE | dbus.NameFlag.REPLACE_EXISTING);

    const file = path.join(scriptDir, 'kwin-cursor.js');
    fs.mkdirSync(scriptDir, { recursive: true });
    fs.writeFileSync(file, KWIN_SCRIPT);

    await kwinCall(bus, '/Scripting', 'org.kde.kwin.Scripting', 'unloadScript', 's', [PLUGIN]).catch(() => {});
    const [id] = await kwinCall(bus, '/Scripting', 'org.kde.kwin.Scripting', 'loadScript', 'ss', [file, PLUGIN]);
    if (id < 0) throw new Error('KWin refused to load the cursor script');
    // Plasma 6 exposes /Scripting/ScriptN; Plasma 5 used /ScriptN.
    await kwinCall(bus, `/Scripting/Script${id}`, 'org.kde.kwin.Script', 'run')
      .catch(() => kwinCall(bus, `/${id}`, 'org.kde.kwin.Script', 'run'));
    console.log('Wayland: tracking cursor through KWin.');
    return true;
  } catch (e) {
    console.warn(`KWin cursor tracking unavailable (${e.message}); the whip only follows over XWayland windows.`);
    stop();
    return false;
  }
}

// Unloads the KWin script. Resolves once done (or after a short timeout).
function stop() {
  if (!bus) return Promise.resolve();
  const b = bus;
  bus = null;
  latest = null;
  const unload = kwinCall(b, '/Scripting', 'org.kde.kwin.Scripting', 'unloadScript', 's', [PLUGIN]).catch(() => {});
  return Promise.race([unload, new Promise((r) => setTimeout(r, 500))]).finally(() => b.disconnect());
}

// Latest global cursor position in screen coordinates, or null if not tracking.
const position = () => latest;

module.exports = { start, stop, position };

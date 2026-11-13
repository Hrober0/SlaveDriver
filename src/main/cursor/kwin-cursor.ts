// Global cursor tracking on KDE Plasma Wayland.
//
// On Wayland, Electron (native or via XWayland) only sees the pointer while it is over one of
// its own windows. The overlay is click-through, so getCursorScreenPoint() freezes. KWin does
// know the real position: we load a tiny KWin script that pushes workspace.cursorPos to us over
// the session D-Bus on every move.
import fs from 'fs';
import path from 'path';
import type { MessageBus } from 'dbus-next';
import type { Point } from '../../shared/geometry';
import type { CursorSource } from './cursor-source';

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

const isKdeWayland = (): boolean => process.platform === 'linux'
  && (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY)
  && /kde/i.test(process.env.XDG_CURRENT_DESKTOP || '');

// Loaded lazily: dbus-next is only needed (and only works) on Linux.
const loadDbus = (): typeof import('dbus-next') => require('dbus-next');

export class KWinCursor implements CursorSource {
  private bus: MessageBus | null = null;
  private latest: Point | null = null;

  constructor(private readonly scriptDir: string) {}

  position(): Point | null {
    return this.latest;
  }

  /** Starts tracking. Resolves true if KWin is feeding us positions. */
  async start(): Promise<boolean> {
    if (!isKdeWayland()) return false;
    try {
      const dbus = loadDbus();
      const bus = dbus.sessionBus();
      this.bus = bus;
      bus.on('error', (e: Error) => console.warn('D-Bus error:', e.message));

      // Low-level handler: accepts whatever numeric types KWin's callDBus marshals (int or double).
      bus.addMethodHandler((msg: import('dbus-next').Message) => {
        if (msg.path !== OBJ_PATH || msg.interface !== IFACE || msg.member !== 'Move') return false;
        const [x, y] = msg.body.map(Number);
        if (Number.isFinite(x) && Number.isFinite(y)) this.latest = { x, y };
        if (!(msg.flags & dbus.MessageFlag.NO_REPLY_EXPECTED)) bus.send(dbus.Message.newMethodReturn(msg));
        return true;
      });
      await bus.requestName(SERVICE, dbus.NameFlag.DO_NOT_QUEUE | dbus.NameFlag.REPLACE_EXISTING);

      const file = path.join(this.scriptDir, 'kwin-cursor.js');
      fs.mkdirSync(this.scriptDir, { recursive: true });
      fs.writeFileSync(file, KWIN_SCRIPT);

      await this.scripting(bus, 'unloadScript', 's', [PLUGIN]).catch(() => {});
      const [id] = await this.scripting(bus, 'loadScript', 'ss', [file, PLUGIN]);
      if (id < 0) throw new Error('KWin refused to load the cursor script');
      // Plasma 6 exposes /Scripting/ScriptN; Plasma 5 used /ScriptN.
      await kwinCall(bus, `/Scripting/Script${id}`, 'org.kde.kwin.Script', 'run')
        .catch(() => kwinCall(bus, `/${id}`, 'org.kde.kwin.Script', 'run'));
      console.log('Wayland: tracking cursor through KWin.');
      return true;
    } catch (e) {
      console.warn(`KWin cursor tracking unavailable (${(e as Error).message}); the whip only follows over XWayland windows.`);
      await this.stop();
      return false;
    }
  }

  /** Unloads the KWin script. Resolves once done (or after a short timeout). */
  stop(): Promise<void> {
    const bus = this.bus;
    if (!bus) return Promise.resolve();
    this.bus = null;
    this.latest = null;
    const unload = this.scripting(bus, 'unloadScript', 's', [PLUGIN]).catch(() => {});
    return Promise.race([unload, new Promise((r) => setTimeout(r, 500))])
      .then(() => undefined)
      .finally(() => bus.disconnect());
  }

  private scripting(bus: MessageBus, member: string, signature: string, body: unknown[]) {
    return kwinCall(bus, '/Scripting', 'org.kde.kwin.Scripting', member, signature, body);
  }
}

async function kwinCall(
  bus: MessageBus, objPath: string, iface: string, member: string, signature = '', body: unknown[] = [],
): Promise<any[]> {
  const { Message } = loadDbus();
  const reply = await bus.call(new Message({
    destination: 'org.kde.KWin', path: objPath, interface: iface, member, signature, body,
  }));
  return reply ? reply.body : [];
}

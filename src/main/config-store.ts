import fs from 'fs';
import path from 'path';
import type { Rect } from '../shared/geometry';
import type { Config } from '../shared/types';

// Bump when tuning defaults change; older configs get their tuning keys reset.
const CONFIG_VERSION = 2;
const TUNING_KEYS = ['hitSpeed', 'crackSpeed', 'hitCooldownMs', 'whip'] as const;
// Keys older versions stored that now live elsewhere (launch flag, words.json).
const OBSOLETE_KEYS = ['showTarget', 'wordsA', 'wordsB'];

export const DEFAULT_CONFIG: Config = {
  version: CONFIG_VERSION,
  shortcuts: {
    toggle: 'CommandOrControl+Alt+W',
    setTarget: 'CommandOrControl+Alt+T',
  },
  target: null,
  mascot: true,
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

/** Loads, migrates and persists the user's config.json. */
export class ConfigStore {
  private current: Config = DEFAULT_CONFIG;

  constructor(readonly filePath: string) {}

  get config(): Config {
    return this.current;
  }

  load(): Config {
    let user: Record<string, unknown> = {};
    try {
      user = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('Bad config.json, using defaults:', (e as Error).message);
      }
    }
    for (const k of OBSOLETE_KEYS) delete user[k];
    const outdated = (Number(user.version) || 1) < CONFIG_VERSION;
    if (outdated) for (const k of TUNING_KEYS) delete user[k];
    user.version = CONFIG_VERSION;

    const u = user as Partial<Config>;
    this.current = {
      ...DEFAULT_CONFIG,
      ...u,
      shortcuts: { ...DEFAULT_CONFIG.shortcuts, ...(u.shortcuts || {}) },
      whip: { ...DEFAULT_CONFIG.whip, ...(u.whip || {}) },
    };
    if (outdated || !fs.existsSync(this.filePath)) this.save();
    return this.current;
  }

  save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.current, null, 2));
  }

  setTarget(target: Rect | null): void {
    this.current.target = target;
    this.save();
  }
}

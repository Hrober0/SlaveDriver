import fs from 'fs';
import type { Words } from '../shared/types';

/** words.json: the "<first> <second>" message parts. Keeps the previous words on a bad edit. */
export class WordsStore {
  private current: Words = { first: ['ouch'], second: ['my head'] };

  constructor(readonly filePath: string) {}

  get words(): Words {
    return this.current;
  }

  load(): Words {
    try {
      const w = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (!Array.isArray(w.first) || !Array.isArray(w.second) || !w.first.length || !w.second.length) {
        throw new Error('needs non-empty "first" and "second" arrays');
      }
      this.current = { first: w.first.map(String), second: w.second.map(String) };
    } catch (e) {
      console.error(`words.json not loaded (${(e as Error).message}); keeping previous words.`);
    }
    return this.current;
  }

  /** Reloads on save and notifies `onChange`. */
  watch(onChange: (w: Words) => void): void {
    fs.watchFile(this.filePath, { interval: 500 }, () => onChange(this.load()));
  }
}

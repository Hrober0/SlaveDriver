// Renderer entry: receives state from main, runs the frame loop and wires the modules together.
import { translate, type Point, type Rect } from '../shared/geometry';
import type { WhipApi } from '../shared/ipc';
import type { Mode, RendererState, SharedMascot } from '../shared/types';
import { playCrack, speak } from './audio';
import { canvas, ctx, resizeCanvas } from './canvas';
import { Cracks, Popups } from './effects';
import { HitJudge } from './hit-judge';
import { drawMascot, mascotPose, type MascotPose } from './mascot';
import { drawTargetOutline, hitFlash, TargetPicker } from './target';
import { WhipRope } from './whip/rope';
import { drawWhip } from './whip/whip-renderer';

declare global {
  interface Window {
    whipApi: WhipApi;
  }
}

const api = window.whipApi;

let state: RendererState | null = null;
let target: Rect | null = null;              // window-local agent area
let sharedMascot: SharedMascot | null = null;
let mascot: MascotPose | null = null;        // window-local, derived each frame
let hitAt = 0;                               // performance.now() of last hit, for the target flash

const rope = new WhipRope(() => state!.config.whip);
const cracks = new Cracks();
const popups = new Popups();
const picker = new TargetPicker(canvas, api);

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

const judge = new HitJudge({
  crack(at, power, speed) {
    const cfg = state!.config;
    cracks.add(at, power, performance.now());
    if (cfg.sound) playCrack(Math.min(1, speed / (cfg.crackSpeed * 1.6)));
  },
  hit(at, speed, onMascot) {
    const cfg = state!.config;
    hitAt = performance.now();
    if (onMascot) api.mascotHit();   // main starts the hurt + hop on every display
    const text = `${pick(state!.words.first)} ${pick(state!.words.second)}`.trim();
    popups.add(text, at, Math.min(1, speed / (cfg.crackSpeed * 1.5)), hitAt);
    if (cfg.speak) speak(text);
  },
});

addEventListener('resize', resizeCanvas);
resizeCanvas();

api.onState((s) => {
  const prevMode: Mode = state?.mode ?? 'off';
  const prevActive = state?.active ?? false;
  state = { ...s, active: !!s.active };
  target = s.target && translate(s.target, s.origin, -1);
  sharedMascot = s.mascot;
  document.body.classList.toggle('target', s.mode === 'target');
  // Fresh whip when it's drawn, or when it moves to/from this display.
  if ((s.mode === 'whip' && prevMode !== 'whip') || state.active !== prevActive) rope.reset();
  picker.setEnabled(s.mode === 'target');
  resizeCanvas();
});

api.onMascot((m) => { sharedMascot = m; });

api.onCursor((p: Point) => {
  if (state?.active) rope.moveTo(p);
});

function drawWhipMode(s: RendererState, frameMs: number, now: number): void {
  // Mascot animation runs on Date.now() so every display shows the same phase.
  const wallNow = Date.now();
  if (s.config.mascot) mascot = mascotPose(sharedMascot, s.origin, wallNow);
  if (s.active) {
    rope.simulate(frameMs, (tip, speed) => judge.judge(tip, speed, { config: s.config, target, mascot }, performance.now()));
  }
  if (target && s.showTarget) {
    drawTargetOutline(ctx, target, { flash: hitFlash(now, hitAt), fillOnFlash: !s.config.mascot });
  }
  if (s.config.mascot && mascot) drawMascot(ctx, mascot, wallNow);
  if (s.active) drawWhip(ctx, rope.points, s.config.whip);
  cracks.draw(ctx, now);
  popups.draw(ctx, now);
}

let lastFrame = performance.now();
function frame(now: number): void {
  const frameMs = now - lastFrame;
  lastFrame = now;
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  if (state?.mode === 'target') picker.draw(ctx, target);
  else if (state?.mode === 'whip') drawWhipMode(state, frameMs, now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* global whipApi */
'use strict';

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

const HZ = 240;               // fixed physics rate
const DT = 1 / HZ;

let mode = 'off';
let active = false;           // this display's overlay has the cursor (only it simulates/draws the whip)
let cfg = null;
let origin = { x: 0, y: 0 };
let target = null;            // window-local rect
let cursor = null;            // latest cursor (window-local)
let hand = null;              // hand position at end of last physics step
let pts = [];                 // rope points {x, y, px, py}
let handleDir = { x: 0.35, y: -0.94 };
let acc = 0;
let lastFrame = performance.now();
let lastHit = 0;
let lastCrack = 0;
let hitFlash = 0;             // timestamp of last hit for target flash
const popups = [];            // floating messages
const cracks = [];            // crack starbursts
let drag = null;              // target selection drag {x0, y0, x1, y1} (only in the window it started in)
let shownDrag = null;         // drag box to draw here, mirrored from whichever display it started on
let showTarget = false;
let words = { first: ['ouch'], second: ['my head'] };
let sharedMascot = null;      // from main, global coords: {from, to, hitAt} (Date.now() ms)
let mascot = null;            // derived each frame, window-local: {x, y, state: 'idle'|'hurt'|'jump', t0, landedAt}

const MASCOT_PX = 5;          // size of one sprite pixel
const MASCOT_HIT_R = 34;
const HURT_MS = 320;
const JUMP_MS = 650;

// ---------- setup ----------

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(innerWidth * dpr);
  const h = Math.round(innerHeight * dpr);
  // Assigning canvas.width clears the canvas even if unchanged, which shows as a blank frame.
  if (canvas.width === w && canvas.height === h) return;
  canvas.width = w;
  canvas.height = h;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener('resize', resize);
resize();

whipApi.onState((s) => {
  const prevMode = mode;
  const prevActive = active;
  mode = s.mode;
  active = !!s.active;
  cfg = s.config;
  origin = s.origin;
  showTarget = s.showTarget;
  words = s.words;
  target = s.target && {
    x: s.target.x - origin.x, y: s.target.y - origin.y,
    width: s.target.width, height: s.target.height,
  };
  sharedMascot = s.mascot;
  document.body.classList.toggle('target', mode === 'target');
  if ((mode === 'whip' && prevMode !== 'whip') || active !== prevActive) { pts = []; hand = null; cursor = null; }
  if (mode !== 'target') { drag = null; shownDrag = null; }
  resize();
});

whipApi.onMascot((m) => { sharedMascot = m; });

whipApi.onCursor((p) => {
  if (!active) return;
  if (cursor && Math.hypot(p.x - cursor.x, p.y - cursor.y) > 600 && hand) {
    // Display jump: teleport the whip instead of slinging it across the screen.
    pts = [];
  }
  cursor = p;
  if (!pts.length) initRope(p);
});

function initRope(at) {
  const w = cfg.whip;
  const L = w.segmentLength;
  hand = { ...at };
  pts = [];
  const hx = at.x + handleDir.x * L * w.handleSegments;
  const hy = at.y + handleDir.y * L * w.handleSegments;
  for (let i = 0; i <= w.segments; i++) {
    let x, y;
    if (i <= w.handleSegments) {
      x = at.x + handleDir.x * L * i;
      y = at.y + handleDir.y * L * i;
    } else {
      x = hx;
      y = hy + (i - w.handleSegments) * L;
    }
    pts.push({ x, y, px: x, py: y });
  }
}

// ---------- physics ----------

function step(handPos, handVel) {
  const w = cfg.whip;
  const L = w.segmentLength;
  const H = w.handleSegments;
  const n = pts.length;

  // The wrist: handle tilts in the direction the hand moves, then springs back to upright-ish.
  const rest = { x: 0.35, y: -0.94 };
  let tx = rest.x + handVel.x * 0.0009;
  let ty = rest.y + handVel.y * 0.0009;
  const tl = Math.hypot(tx, ty) || 1;
  tx /= tl; ty /= tl;
  handleDir.x += (tx - handleDir.x) * 0.08;
  handleDir.y += (ty - handleDir.y) * 0.08;
  const hl = Math.hypot(handleDir.x, handleDir.y) || 1;
  handleDir.x /= hl; handleDir.y /= hl;

  // Handle points are kinematic (rigid stick held by the hand).
  for (let i = 0; i <= H; i++) {
    const p = pts[i];
    p.px = p.x; p.py = p.y;
    p.x = handPos.x + handleDir.x * L * i;
    p.y = handPos.y + handleDir.y * L * i;
  }

  // Verlet integrate the lash with linear damping + quadratic air drag.
  const g = w.gravity * DT * DT;
  for (let i = H + 1; i < n; i++) {
    const p = pts[i];
    let vx = (p.x - p.px) * w.damping;
    let vy = (p.y - p.py) * w.damping;
    const f = 1 / (1 + w.drag * Math.hypot(vx, vy));
    vx *= f; vy *= f;
    p.px = p.x; p.py = p.y;
    p.x += vx;
    p.y += vy + g;
  }

  // Bending stiffness, tapered: stiff near the handle, floppy at the tip. This is what makes the
  // loop roll down the lash and accelerate into a crack instead of flopping like a noodle.
  {
    // The first lash segment wants to continue the handle's direction.
    const a = pts[H - 1], b = pts[H], c = pts[H + 1];
    const s = w.stiffness * 1.5;
    c.x += (2 * b.x - a.x - c.x) * s;
    c.y += (2 * b.y - a.y - c.y) * s;
  }
  for (let i = H + 1; i < n - 1; i++) {
    const t = (i - H) / (n - 1 - H);
    const s = w.stiffness * (1 - t) * (1 - t) + 0.02;
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const mx = (a.x + c.x) / 2 - b.x;
    const my = (a.y + c.y) / 2 - b.y;
    b.x += mx * s; b.y += my * s;
    if (i - 1 > H) { a.x -= mx * s * 0.5; a.y -= my * s * 0.5; }
    c.x -= mx * s * 0.5; c.y -= my * s * 0.5;
  }

  // Length constraints. Thick base is heavy, thin tip is light (taper => tip speed amplification).
  const invMass = (i) => (i <= H ? 0 : 0.5 + 1.5 * ((i - H) / (n - 1 - H)));
  for (let it = 0; it < w.iterations; it++) {
    for (let i = H; i < n - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const wa = invMass(i), wb = invMass(i + 1);
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 0.0001;
      const diff = (d - L) / d / (wa + wb);
      a.x += dx * diff * wa; a.y += dy * diff * wa;
      b.x -= dx * diff * wb; b.y -= dy * diff * wb;
    }
  }

  // Tip speed + hit detection.
  const tip = pts[n - 1];
  const speed = Math.hypot(tip.x - tip.px, tip.y - tip.py) / DT;
  const now = performance.now();

  if (speed > cfg.crackSpeed && now - lastCrack > 150) {
    lastCrack = now;
    cracks.push({ x: tip.x, y: tip.y, t0: now, power: Math.min(2, speed / cfg.crackSpeed) });
    if (cfg.sound) crackSound(Math.min(1, speed / (cfg.crackSpeed * 1.6)));
  }

  if (!target || speed < cfg.hitSpeed || now - lastHit < cfg.hitCooldownMs) return;
  if (cfg.mascot) {
    // Only the tip counts, swept over this step so fast lashes can't tunnel through.
    if (mascot && mascot.state === 'idle'
      && segDist(tip.px, tip.py, tip.x, tip.y, mascot.x, mascot.y) < MASCOT_HIT_R) {
      lastHit = now;
      hitFlash = now;
      whipApi.mascotHit();   // main starts the hurt + hop on every display
      onHit({ x: mascot.x, y: mascot.y - 40 }, speed);
    }
  } else if (inRect(tip, target)) {
    lastHit = now;
    hitFlash = now;
    onHit(tip, speed);
  }
}

const inRect = (p, r) => p.x >= r.x && p.y >= r.y && p.x <= r.x + r.width && p.y <= r.y + r.height;

function segDist(x1, y1, x2, y2, px, py) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)) : 0;
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}

// ---------- mascot ----------

// Ease that overshoots a bit and settles: feels like a hop with a little skid.
const easeOutBack = (t) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// The mascot lives in main (one for all displays); derive where it is right now in this window.
// `now` is Date.now(), so every overlay computes the same phase.
function updateMascot(now) {
  const m = sharedMascot;
  if (!m) { mascot = null; return; }
  const from = { x: m.from.x - origin.x, y: m.from.y - origin.y };
  const to = { x: m.to.x - origin.x, y: m.to.y - origin.y };
  const since = now - m.hitAt;
  if (since < HURT_MS) {
    mascot = { ...from, state: 'hurt', t0: m.hitAt };
  } else if (since < HURT_MS + JUMP_MS) {
    const t0 = m.hitAt + HURT_MS;
    const t = (now - t0) / JUMP_MS;
    mascot = {
      x: from.x + (to.x - from.x) * easeOutBack(t),
      y: from.y + (to.y - from.y) * easeInOutCubic(t),
      state: 'jump', t0,
    };
  } else {
    mascot = { ...to, state: 'idle', landedAt: m.hitAt ? m.hitAt + HURT_MS + JUMP_MS : now - 1000 };
  }
}

// Original pixel critter. '#' body, 'e' eye.
const SPRITE = [
  '..##########..',
  '..#e######e#..',
  '..#e######e#..',
  '##############',
  '##############',
  '..##########..',
  '..##########..',
];
const LEGS = [
  ['..#.#....#.#..', '..#.#....#.#..'],
  ['...#.#..#.#...', '...#.#..#.#...'],
];

function drawMascot(now) {
  if (!mascot) return;
  const P = MASCOT_PX;
  const W = SPRITE[0].length * P;
  const Hh = (SPRITE.length + 2) * P;
  let sx = 1, sy = 1, lift = 0, shake = 0;

  if (mascot.state === 'jump') {
    const t = (now - mascot.t0) / JUMP_MS;
    lift = Math.sin(Math.PI * Math.min(1, t)) * 110;
    sy = 1.12; sx = 0.9;                       // stretch in the air
  } else {
    const since = now - mascot.landedAt;
    if (since < 220) {                         // squash on landing, springs back
      const k = 1 - since / 220;
      sy = 1 - 0.3 * k; sx = 1 + 0.25 * k;
    } else {
      lift = Math.abs(Math.sin(now / 260)) * 3; // idle bob
    }
  }
  const hurt = mascot.state === 'hurt';
  if (hurt) shake = Math.sin(now / 18) * 4;

  // Shadow stays on the ground.
  ctx.save();
  ctx.fillStyle = `rgba(0,0,0,${0.3 - Math.min(0.2, lift / 600)})`;
  ctx.beginPath();
  ctx.ellipse(mascot.x, mascot.y + Hh / 2 + 2, (W / 2) * (1 - lift / 300), 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(mascot.x + shake, mascot.y + Hh / 2 - lift);  // origin at the feet
  ctx.scale(sx, sy);
  ctx.translate(-W / 2, -Hh);
  const flashWhite = hurt && Math.floor((now - mascot.t0) / 60) % 2 === 0;
  const body = flashWhite ? '#ffffff' : '#d97757';
  const legRows = LEGS[Math.floor(now / 180) % 2];
  const rows = [...SPRITE, ...legRows];
  // light outline for dark backgrounds
  ctx.fillStyle = 'rgba(255, 240, 220, 0.5)';
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch !== '.') ctx.fillRect(x * P - 1, y * P - 1, P + 2, P + 2);
  }));
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return;
    ctx.fillStyle = ch === 'e' ? (hurt ? body : '#2a1610') : body;
    ctx.fillRect(x * P, y * P, P, P);
  }));
  if (hurt) {
    // squeezed-shut eyes: > <
    ctx.strokeStyle = '#2a1610';
    ctx.lineWidth = 2;
    for (const [cx, dir] of [[3.5, 1], [10.5, -1]]) {
      ctx.beginPath();
      ctx.moveTo(cx * P - dir * 4, 1.2 * P);
      ctx.lineTo(cx * P + dir * 3, 2 * P);
      ctx.lineTo(cx * P - dir * 4, 2.8 * P);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function simulate(frameMs) {
  if (!cursor || !pts.length || !hand) return;
  acc = Math.min(acc + frameMs / 1000, 0.05);
  const steps = Math.floor(acc / DT);
  if (!steps) return;
  acc -= steps * DT;
  const from = { ...hand };
  const vel = { x: (cursor.x - from.x) / (steps * DT), y: (cursor.y - from.y) / (steps * DT) };
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    step({ x: from.x + (cursor.x - from.x) * t, y: from.y + (cursor.y - from.y) * t }, vel);
  }
  hand = { ...cursor };
}

// ---------- reactions ----------

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function onHit(tip, speed) {
  const text = `${pick(words.first)} ${pick(words.second)}`.trim();
  const power = Math.min(1, speed / (cfg.crackSpeed * 1.5));
  // Keep the bubble on screen.
  const x = Math.max(80, Math.min(innerWidth - 80, tip.x));
  const y = Math.max(60, Math.min(innerHeight - 20, tip.y));
  popups.push({
    text, x, y, t0: performance.now(),
    rot: (Math.random() - 0.5) * 0.35,
    size: 26 + power * 30,
    hue: Math.floor(Math.random() * 60), // reds -> yellows
  });
  if (popups.length > 12) popups.shift();
  if (cfg.speak && 'speechSynthesis' in window) {
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.15 + Math.random() * 0.3;
      u.pitch = 0.8 + Math.random() * 0.8;
      speechSynthesis.speak(u);
    } catch { /* no TTS available (common on Linux without speech-dispatcher) */ }
  }
}

let audio = null;
function crackSound(vol) {
  try {
    audio = audio || new AudioContext();
    const len = Math.floor(audio.sampleRate * 0.09);
    const buf = audio.createBuffer(1, len, audio.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const env = Math.exp(-i / (audio.sampleRate * 0.008));
      data[i] = (Math.random() * 2 - 1) * env;
    }
    const src = audio.createBufferSource();
    src.buffer = buf;
    const hp = audio.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1200;
    const gain = audio.createGain();
    gain.gain.value = 0.25 + vol * 0.75;
    src.connect(hp).connect(gain).connect(audio.destination);
    src.start();
  } catch { /* audio unavailable */ }
}

// ---------- rendering ----------

function drawTarget(now) {
  if (!target) return;
  const flash = Math.max(0, 1 - (now - hitFlash) / 350);
  if (!showTarget) return;
  ctx.save();
  if (flash && !cfg.mascot) {
    ctx.fillStyle = `rgba(255, 40, 40, ${0.22 * flash})`;
    ctx.fillRect(target.x, target.y, target.width, target.height);
  }
  ctx.setLineDash([8, 6]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = mode === 'target' ? 'rgba(255,255,255,0.8)' : `rgba(255, 90, 90, ${0.35 + flash * 0.6})`;
  ctx.strokeRect(target.x + 1, target.y + 1, target.width - 2, target.height - 2);
  ctx.setLineDash([]);
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255, 120, 120, 0.8)';
  ctx.fillText('AGENT', target.x + 8, target.y + 18);
  ctx.restore();
}

function drawWhip() {
  if (pts.length < 2) return;
  const w = cfg.whip;
  const H = w.handleSegments;
  const n = pts.length;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const lashPass = (extra, color) => {
    for (let i = H; i < n - 1; i++) {
      const t = (i - H) / (n - 1 - H);
      const a = i === H ? pts[i] : mid(pts[i - 1], pts[i]);
      const b = mid(pts[i], pts[i + 1]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, b.x, b.y);
      ctx.lineWidth = 6.5 * (1 - t) + 1.2 * t + extra;
      ctx.strokeStyle = typeof color === 'function' ? color(t) : color;
      ctx.stroke();
    }
    // last half segment to the tip
    const a = mid(pts[n - 2], pts[n - 1]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(pts[n - 1].x, pts[n - 1].y);
    ctx.lineWidth = 1.2 + extra;
    ctx.strokeStyle = typeof color === 'function' ? color(1) : color;
    ctx.stroke();
  };

  // Outline so it reads on both dark and light themes.
  lashPass(2.5, 'rgba(255, 240, 220, 0.55)');
  lashPass(0, (t) => `rgb(${Math.round(92 - t * 30)}, ${Math.round(52 - t * 15)}, ${Math.round(28 - t * 8)})`);

  // Cracker (frayed tip).
  const tip = pts[n - 1], pre = pts[n - 2];
  const dx = tip.x - pre.x, dy = tip.y - pre.y;
  const d = Math.hypot(dx, dy) || 1;
  ctx.strokeStyle = 'rgba(235, 220, 190, 0.9)';
  ctx.lineWidth = 1;
  for (const s of [-0.35, 0, 0.35]) {
    const c = Math.cos(s), si = Math.sin(s);
    const ux = (dx * c - dy * si) / d, uy = (dx * si + dy * c) / d;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x + ux * 9, tip.y + uy * 9);
    ctx.stroke();
  }

  // Handle.
  const h0 = pts[0], h1 = pts[H];
  ctx.lineWidth = 12;
  ctx.strokeStyle = 'rgba(255, 240, 220, 0.55)';
  line(h0, h1);
  ctx.lineWidth = 9.5;
  ctx.strokeStyle = '#3a2212';
  line(h0, h1);
  // braided wrap
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#8a5a2b';
  for (let k = 1; k < 8; k++) {
    const t = k / 8;
    const x = h0.x + (h1.x - h0.x) * t, y = h0.y + (h1.y - h0.y) * t;
    const nx = -(h1.y - h0.y) / (H * w.segmentLength), ny = (h1.x - h0.x) / (H * w.segmentLength);
    ctx.beginPath();
    ctx.moveTo(x - nx * 4.5, y - ny * 4.5);
    ctx.lineTo(x + nx * 4.5 + (h1.x - h0.x) * 0.04, y + ny * 4.5 + (h1.y - h0.y) * 0.04);
    ctx.stroke();
  }
  // pommel at the cursor
  ctx.fillStyle = '#c9a14a';
  ctx.beginPath();
  ctx.arc(h0.x, h0.y, 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
function line(a, b) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function drawCracks(now) {
  for (let i = cracks.length - 1; i >= 0; i--) {
    const c = cracks[i];
    const t = (now - c.t0) / 160;
    if (t >= 1) { cracks.splice(i, 1); continue; }
    ctx.save();
    ctx.strokeStyle = `rgba(255, 250, 200, ${1 - t})`;
    ctx.lineWidth = 2;
    const r0 = 4 + t * 10, r1 = 10 + t * 26 * c.power;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + c.t0;
      ctx.beginPath();
      ctx.moveTo(c.x + Math.cos(a) * r0, c.y + Math.sin(a) * r0);
      ctx.lineTo(c.x + Math.cos(a) * r1, c.y + Math.sin(a) * r1);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawPopups(now) {
  for (let i = popups.length - 1; i >= 0; i--) {
    const p = popups[i];
    const t = (now - p.t0) / 1600;
    if (t >= 1) { popups.splice(i, 1); continue; }
    const pop = t < 0.12 ? 0.6 + (t / 0.12) * 0.55 : 1.15 - Math.min(0.15, (t - 0.12) * 0.6);
    ctx.save();
    ctx.translate(p.x, p.y - t * 70);
    ctx.rotate(p.rot);
    ctx.scale(pop, pop);
    ctx.globalAlpha = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
    ctx.font = `900 ${p.size}px Impact, "Arial Black", "DejaVu Sans", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(p.text.toUpperCase(), 0, 0);
    ctx.fillStyle = `hsl(${p.hue}, 100%, 60%)`;
    ctx.fillText(p.text.toUpperCase(), 0, 0);
    ctx.restore();
  }
}

function drawTargetMode() {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(0, 0, innerWidth, innerHeight);
  if (target) {
    ctx.clearRect(target.x, target.y, target.width, target.height);
    ctx.fillStyle = 'rgba(255, 60, 60, 0.08)';
    ctx.fillRect(target.x, target.y, target.width, target.height);
  }
  if (shownDrag) {
    const r = shownDrag;
    ctx.clearRect(r.x, r.y, r.width, r.height);
    ctx.fillStyle = 'rgba(80, 200, 255, 0.15)';
    ctx.fillRect(r.x, r.y, r.width, r.height);
    ctx.strokeStyle = 'rgba(80, 200, 255, 1)';
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x, r.y, r.width, r.height);
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText(`${Math.round(r.width)} × ${Math.round(r.height)}`, r.x + 6, r.y - 8);
  }
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = '700 22px system-ui, sans-serif';
  ctx.fillStyle = '#fff';
  ctx.fillText('Drag a box around the agent (e.g. the Claude Code panel)', innerWidth / 2, 60);
  ctx.font = '400 15px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillText('Release to save  ·  Esc to cancel', innerWidth / 2, 88);
  ctx.restore();
}

function dragRect() {
  return {
    x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1),
    width: Math.abs(drag.x1 - drag.x0), height: Math.abs(drag.y1 - drag.y0),
  };
}

whipApi.onDrag((r) => { shownDrag = r; });

canvas.addEventListener('pointerdown', (e) => {
  if (mode !== 'target' || e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  drag = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
  whipApi.dragUpdate(dragRect());
});
canvas.addEventListener('pointermove', (e) => {
  if (mode !== 'target' || !drag) return;
  drag.x1 = e.clientX; drag.y1 = e.clientY;
  whipApi.dragUpdate(dragRect());
});
function endDrag(e) {
  if (mode !== 'target' || !drag) return;
  drag.x1 = e.clientX; drag.y1 = e.clientY;
  const r = dragRect();
  drag = null;
  whipApi.dragUpdate(null);
  if (r.width > 20 && r.height > 20) whipApi.setTarget(r);
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', () => { drag = null; whipApi.dragUpdate(null); });
addEventListener('keydown', (e) => {
  if (mode === 'target' && e.key === 'Escape') whipApi.cancelTarget();
});

// ---------- loop ----------

function frame(now) {
  const dt = now - lastFrame;
  lastFrame = now;
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  if (cfg) {
    if (mode === 'target') {
      drawTargetMode();
    } else if (mode === 'whip') {
      if (active) simulate(dt);
      if (cfg.mascot) updateMascot(Date.now());
      drawTarget(now);
      if (cfg.mascot) drawMascot(Date.now());
      if (active) drawWhip();
      drawCracks(now);
      drawPopups(now);
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

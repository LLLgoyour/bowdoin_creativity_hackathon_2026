/* ═══════════════════════════════════════════════════════════════════════════
   probe-shake-return.mjs — the app's own return measurement, without a browser.

   This is not a copy of the app's measurement: it loads src/w-app.js exactly as
   the browser loads it (classic source, same order, against a small DOM stub)
   and then drives the app's own functions — ctlVerified, forkControl, doShake,
   stepBoards, retVerdict — so the verdict printed under `verdict` is the string
   the shake panel shows. What it establishes:

     fork_rng   the indexed generator a control copies is mulberry32, value for
                value, so swapping it in cannot change any board;
     copy_check two copies of one board, stepped in lockstep with no shake
                between them, stay identical on every state array;
     return     per world: the app's verdict at a stated board size, settle
                generation and power, plus the same trace re-scored at other
                tolerances so the shipped tolerance can be read against them.

   Environment: PROBE_WORLDS (default synch,grav,rd,life), PROBE_SETTLE (400),
   PROBE_POWER (1), PROBE_W/PROBE_H (viewport that decides the board size; the
   default 900x640 gives 52x52, 1700x1400 gives 120x120).
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const src = f => readFileSync(new URL('src/' + f, root), 'utf8');
const MODULES = ['core.js', 'w-field.js', 'w-synch.js', 'w-grav.js', 'w-rd.js',
                 'w-life.js', 'data-gsfc.js', 'w-render.js', 'w-app.js'];

/* ── a DOM small enough to boot the app: the app must be the thing that runs.
      Timers are stubbed through the wrapper, because the app's boot loop uses
      the bare global setInterval and would otherwise keep node alive. ─────── */
const IMG = (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
const CTX = new Proxy({
  createImageData: IMG, getImageData: (x, y, w, h) => IMG(w, h),
  measureText: () => ({ width: 8 }),
  createLinearGradient: () => ({ addColorStop() {} })
}, { get: (t, k) => (k in t ? t[k] : () => {}) });

const makeEl = id => ({
  id, width: 272, height: 112, offsetWidth: 306, value: '', textContent: '', innerHTML: '',
  className: '', style: {}, children: [],
  appendChild(c) { this.children.push(c); return c; },
  addEventListener() {}, removeEventListener() {}, click() {}, setAttribute() {},
  closest() { return null; }, querySelector() { return null; }, getContext() { return CTX; }
});
const els = new Map();
const el = id => (els.get(id) || els.set(id, makeEl(id)).get(id));
const win = {
  innerWidth: Number(process.env.PROBE_W || 900),
  innerHeight: Number(process.env.PROBE_H || 640),
  addEventListener() {}, removeEventListener() {}
};
const doc = { getElementById: el, createElement: t => makeEl(t) };

const api = new Function('window', 'document', 'getComputedStyle', 'performance', 'atob',
  'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
  MODULES.map(src).join('\n') + `
return { APP, RET, M:() => M, gen:() => gen, forkRng, cloneBoard, sameState, ctlVerified,
         mulberry32, doShake, stepBoards, startWorld, retVerdict, retTol, retScan,
         retSpec, retTolText, retPeak,
         CTL_CHECK, FIELDS, WORLDS, worldById };`)
  (win, doc, () => ({ display: 'block' }), performance,
   typeof atob === 'function' ? atob : undefined,
   () => 0, () => {}, () => 0, () => {});

/* ── 1. the control's generator is mulberry32 ─────────────────────────────── */
{
  const seeds = [20260919 ^ 0x9e3779b9, 0, 913, -7, 20260919];
  let mismatches = 0, maxAbsDiff = 0;
  const draws = 200000;
  for (const s of seeds) {
    const a = api.mulberry32(s), b = api.forkRng(s, 0);
    for (let i = 0; i < draws; i++) {
      const x = a(), y = b();
      if (x !== y) mismatches++;
      const d = Math.abs(x - y);
      if (d > maxAbsDiff) maxAbsDiff = d;
    }
  }
  console.log(`fork_rng seeds=${seeds.length} drawsEach=${draws} mismatches=${mismatches} maxAbsDiff=${maxAbsDiff}`);
}

/* ── 2. measuring: candidate order parameters per world, and the scan the app
      will ship. Every measure is a property of ONE board (so both the live
      board and the control can be traced), read from world state the world
      itself publishes — its stats(), its HUD numbers, its own arrays. Rows are
      generations since the kick; row 0 is immediately after it. ──────────── */
function scan(a, b, need, tol) {
  let run = 0;
  for (let g = 0; g < a.length; g++) {
    run = Math.abs(a[g] - b[g]) <= tol(b[g]) ? run + 1 : 0;
    if (run >= need) return g - need + 1;
  }
  return -1;
}
function meanV(S, field) {
  let sum = 0, cells = 0;
  for (let i = 0; i < S.n; i++) if (field.mask[i]) { sum += S.v[i]; cells++; }
  return cells ? sum / cells : 0;
}
function countAbove(S, field, t) {
  let c = 0;
  for (let i = 0; i < S.n; i++) if (field.mask[i] && S.v[i] >= t) c++;
  return c;
}
function maxV(S, field) {
  let m = 0;
  for (let i = 0; i < S.n; i++) if (field.mask[i] && S.v[i] > m) m = S.v[i];
  return m;
}
function sumV(S, field) {
  let s = 0;
  for (let i = 0; i < S.n; i++) if (field.mask[i]) s += S.v[i];
  return s;
}
const MEASURES = {
  synch: {
    'global r': { get: S => S.order, tols: [0.01, 0.02, 0.03, 0.05] },
    'locally locked': { get: S => S.locked, tols: [0.005, 0.01, 0.02, 0.05] }
  },
  grav: {
    'occupied piles': { get: S => S.live, tols: [0.005, 0.01, 0.02] },
    'total grains': { get: S => S.mass, tols: [0.002, 0.005, 0.01] },
    'topples/gen (32-gen mean)': { get: S => S.avalanche, tols: [0.5, 5, 20], window: 32 }
  },
  rd: {
    'reef cards': { get: S => S.live, tols: [0.005, 0.01, 0.02] },
    'mean V over the mask': { get: (S, field) => meanV(S, field), tols: [0.0005, 0.001, 0.002, 0.005] },
    'sum V over the mask': { get: (S, field) => sumV(S, field), tols: [0.0005, 0.001, 0.002] },
    'edge cells (V>=0.16)': { get: (S, field) => countAbove(S, field, 0.16), tols: [0.005, 0.01, 0.02] },
    'hot cells (V>=0.25)': { get: (S, field) => countAbove(S, field, 0.25), tols: [0.005, 0.01, 0.02] },
    'peak V': { get: (S, field) => maxV(S, field), tols: [0.0005, 0.001, 0.002] },
    'births this generation': { get: S => S.births, tols: [1, 2, 5], window: 8 }
  },
  life: {
    'live cards': { get: S => S.live, tols: [0.02, 0.05, 0.1, 0.2] },
    'live cards (20-gen mean)': { get: S => S.live, tols: [0.02, 0.05, 0.1], window: 20 },
    'births (20-gen mean)': { get: S => S.births, tols: [0.5, 1, 2], window: 20 }
  }
};
const SETTLE = Number(process.env.PROBE_SETTLE || 400);
/* Pairwise measures: a property of the two boards at once (how far apart they
   are), which is what the reference numbers for the reaction world came from.
   They are scored, not plotted: the plotted scalar is always per-board. */
const PAIR = {
  rd: {
    'mean |V difference| over the mask': {
      f: (S, C, field) => { let s = 0, c = 0; for (let i = 0; i < S.n; i++) if (field.mask[i]) { s += Math.abs(S.v[i] - C.v[i]); c++; } return c ? s / c : 0; },
      tols: [0.0001, 0.0002, 0.0005, 0.001]
    },
    'largest |V difference| on the mask': {
      f: (S, C, field) => { let m = 0; for (let i = 0; i < S.n; i++) if (field.mask[i]) { const d = Math.abs(S.v[i] - C.v[i]); if (d > m) m = d; } return m; },
      tols: [0.0005, 0.001, 0.002, 0.005]
    },
    'cells differing by more than 0.01': {
      f: (S, C, field) => { let c = 0; for (let i = 0; i < S.n; i++) if (field.mask[i] && Math.abs(S.v[i] - C.v[i]) > 0.01) c++; return c; },
      tols: [0.005, 0.01, 0.02]
    }
  },
  life: {
    'cells in a different state': {
      f: (S, C) => { let c = 0; for (let i = 0; i < S.n; i++) if ((S.st[i] ? 1 : 0) !== (C.st[i] ? 1 : 0)) c++; return c; },
      tols: [0.005, 0.01, 0.02]
    }
  }
};
const POWER = Number(process.env.PROBE_POWER || 1);
const CHUNK = 25;

function run(wid) {
  api.APP.wrldId = wid;
  api.startWorld();
  const world = api.APP.world, S = api.APP.S, field = api.APP.field;
  if (!world || !S) throw new Error('world ' + wid + ' did not start');
  if (api.RET.ctl) throw new Error('a new board carried a stale control');

  const measures = MEASURES[wid];
  const names = Object.keys(measures);
  /* per-measure series for both boards; windows are filled from the pre-kick
     generations so a 32-generation mean at row 0 is a real 32-generation mean */
  const ring = {}; for (const nm of names) ring[nm] = { live: [], ctl: [] };
  const sample = (nm, Sx, into) => {
    const m = measures[nm];
    ring[nm][into].push(m.get(Sx, field));
    const arr = ring[nm][into], w = m.window || 1;
    if (arr.length > w) arr.shift();
    let sum = 0; for (const v of arr) sum += v;
    return sum / arr.length;
  };

  for (let done = 0; done < SETTLE; done += CHUNK) {
    api.stepBoards(Math.min(CHUNK, SETTLE - done));
    for (const nm of names) sample(nm, S, 'live');
  }
  const atGen = api.gen();
  const check = api.ctlVerified(world);          /* the app's own copy check */
  if (check.ok !== check.gens) throw new Error('copy check ' + JSON.stringify(check));
  /* the control's own warm ring: the same last generations of an unshaken board
     are not available before the fork, so the control's window is seeded with
     the live board's pre-kick values, which ARE the unshaken board's values */
  for (const nm of names) ring[nm].ctl = ring[nm].live.slice();

  const t0 = process.hrtime.bigint();
  const kick = api.doShake(POWER);               /* the app's own shake path */
  const kickMs = Number(process.hrtime.bigint() - t0) / 1e6;
  if (!api.RET.ctl) throw new Error('no control: ' + (api.RET.err ||
    ('the kick was queued (gen ' + atGen + ' < settle ' + api.RET.settle + ')')));
  if (api.RET.n !== 1) throw new Error('trace row 0 missing');
  const ctlBoard = api.RET.ctl;                  /* kept across the drop at the end */

  const series = {}; for (const nm of names) series[nm] = { live: [], ctl: [] };
  const pairNames = Object.keys(PAIR[wid] || {});
  const pairSeries = {}; for (const nm of pairNames) pairSeries[nm] = [];
  for (const nm of names) {                       /* row 0: after the kick */
    series[nm].live.push(sample(nm, S, 'live'));
    series[nm].ctl.push(sample(nm, ctlBoard, 'ctl'));
  }
  const pairSample = () => { for (const nm of pairNames) pairSeries[nm].push(PAIR[wid][nm].f(S, ctlBoard, field)); };
  pairSample();
  const t1 = process.hrtime.bigint();
  for (let i = 0; i < api.RET.win && !api.RET.done; i++) {
    api.stepBoards(1);
    for (const nm of names) {
      series[nm].live.push(sample(nm, S, 'live'));
      series[nm].ctl.push(sample(nm, ctlBoard, 'ctl'));
    }
    pairSample();
  }
  if (!api.RET.done) throw new Error('the window never closed: rows=' + api.RET.n);
  const runMs = Number(process.hrtime.bigint() - t1) / 1e6;
  const v = api.retVerdict();
  if (process.env.PROBE_DUMP === wid) {
    const dump = {};
    for (const nm of names) dump[nm] = {
      len: [series[nm].live.length, series[nm].ctl.length],
      live: series[nm].live.slice(0, 8), ctl: series[nm].ctl.slice(0, 8),
      gap: series[nm].live.slice(0, 8).map((x, i) => Math.abs(x - series[nm].ctl[i])),
      gap14: series[nm].live.slice(0, 14).map((x, i) => Math.abs(x - series[nm].ctl[i])),
      tols: measures[nm].tols
    };
    console.log('dump ' + wid + ' ' + JSON.stringify(dump));
  }

  const scored = {};
  for (const nm of names) {
    const m = measures[nm], per = {};
    for (const t of m.tols) {
      const rel = !m.window && (wid !== 'synch' || nm === 'locally locked') && t < 0.5;
      const tol = rel ? c => Math.max(3, Math.round(t * c)) : () => t;
      per[String(t)] = scan(series[nm].live, series[nm].ctl, api.RET.need, tol);
    }
    let maxGap = 0;
    for (let g = 0; g < series[nm].live.length; g++)
      maxGap = Math.max(maxGap, Math.abs(series[nm].live[g] - series[nm].ctl[g]));
    scored[nm] = {
      firstLive: +series[nm].live[0].toFixed(6), firstControl: +series[nm].ctl[0].toFixed(6),
      controlAtHorizon: +series[nm].ctl[series[nm].ctl.length - 1].toFixed(6),
      shakenAtHorizon: +series[nm].live[series[nm].live.length - 1].toFixed(6),
      maxGap: +maxGap.toFixed(6), returnGeneration: per
    };
  }
  const scoredPair = {};
  for (const nm of pairNames) {
    const per = {}, arr = pairSeries[nm];
    for (const t of PAIR[wid][nm].tols) per[String(t)] = scan(arr, arr.map(() => 0), api.RET.need, () => t);
    let peak = 0, peakAt = 0;
    for (let g = 0; g < arr.length; g++) if (arr[g] > peak) { peak = arr[g]; peakAt = g; }
    scoredPair[nm] = {
      first: +arr[0].toFixed(8), peak: +peak.toFixed(8), peakAt,
      atHorizon: +arr[arr.length - 1].toFixed(8), returnGeneration: per
    };
  }
  return {
    world: wid, label: world.label, board: api.M() + 'x' + api.M(), settle: SETTLE,
    power: POWER, shakenAtGen: atGen, kick, kickedAt: api.RET.at, copyCheck: check.ok + '/' + check.gens,
    shippedVerdict: v.t, shippedScalar: api.retSpec().label,
    shippedTolerance: api.retTolText(), shippedPeak: api.retPeak(), measures: scored,
    pairMeasures: scoredPair,
    kickMs: +kickMs.toFixed(3), followMs: +runMs.toFixed(1), msPerGeneration: +(runMs / api.RET.n).toFixed(4)
  };
}

const worlds = (process.env.PROBE_WORLDS || 'synch,grav,rd,life').split(',');
console.log(`protocol board=${api.M()}x${api.M()} field=${api.APP.fldId} seed=${api.APP.seed} ` +
  `settle=${SETTLE} power=${POWER} window=${api.RET.win} need=${api.RET.need} ` +
  `scalar=per world (see each row) control=structural copy of the board one instant ` +
  `before the kick, stepped in lockstep, never shaken`);
const rows = [];
for (const wid of worlds) {
  let r;
  try { r = run(wid); } catch (e) { r = { world: wid, error: String((e && e.message) || e) }; }
  rows.push(r);
  console.log('return ' + JSON.stringify(r));
}
console.log('summary ' + JSON.stringify({
  board: api.M() + 'x' + api.M(), settle: SETTLE, power: POWER,
  shipped: Object.fromEntries(rows.map(r => [r.world, r.error || r.shippedVerdict]))
}));

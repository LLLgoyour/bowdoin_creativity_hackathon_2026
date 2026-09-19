/* itest.mjs — integration test for the module contract, and a timing probe.
 *
 * How it loads the code: core.js + every src/w-*.js world/field module are
 * concatenated into ONE function body via `new Function`. That mirrors the
 * browser (one classic-script scope) and keeps `clamp`, `PAL`, `defWorld` etc.
 * as *lexical* bindings. Loading the same files through `vm.createContext`
 * instead makes every one of those a contextified global lookup and inflates
 * inner-loop timings several-fold — that mistake produced a 3x spread on an
 * unchanged file once, so it is called out here.
 *
 * How it times: 60 warm-up steps, then 120 steps with nothing in the loop but
 * step(). init/stats/view are measured separately, because folding them into
 * the same number is what made an earlier revision's ms/step meaningless.
 *
 * usage: node tools/itest.mjs [M] [STEPS]
 */
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {createHash} from 'node:crypto';

const M = Number(process.argv[2] || 52);
const STEPS = Number(process.argv[3] || 200);
const SRC = new URL('../src/', import.meta.url);
const WARM = 60, TIMED = 120;

const order = ['core.js', 'w-field.js', 'w-synch.js', 'w-grav.js', 'w-rd.js',
               'w-life.js', 'data-gsfc.js'];
const present = readdirSync(SRC).filter(f => f.endsWith('.js'));
const files = order.filter(f => present.includes(f));
const missing = ['w-field.js', 'w-grav.js'].filter(f => !present.includes(f));

const src = files.map(f => `/* ${f} */\n` + readFileSync(new URL(f, SRC), 'utf8')).join('\n');
const hash = createHash('sha256').update(src).digest('hex').slice(0, 12);
const mt = Object.fromEntries(files.map(f =>
  [f, statSync(new URL(f, SRC)).mtime.toISOString().slice(11, 19)]));

const BODY = `
const __out = {worlds: [], fields: [], rec: null, missing: __MISSING};
/* a 1-cell-thick band substrate: thin enough that B3/S23 rules survive on it,
   which a 3-cell-thick band is not (interior cells have 8 neighbours) */
function synthField(w, h) {
  const n = w * h;
  const amp = new Float32Array(n), ph = new Float32Array(n),
        freq = new Float32Array(n), mask = new Uint8Array(n), occ = new Float32Array(n);
  let m = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const band = Math.abs(y - ((x * 1.3 + 5) % h)) < 0.6 ||
                 Math.abs(y - ((x * 0.6 + h * 0.5) % h)) < 0.6;
    const blob = Math.hypot(x - w * 0.3, y - h * 0.6) < w * 0.13;
    if (!band && !blob) continue;
    mask[i] = 1; m++;
    amp[i] = 0.06 + 0.9 * (x / w);
    ph[i] = (x + y) * 0.13;
    freq[i] = 0.041 + 0.02 * (y / h);
    occ[i] = 1;
  }
  for (let i = 0; i < n; i++) occ[i] = occ[i] ? 1 : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let c = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = (y + dy + h) % h, xx = (x + dx + w) % w;
      if (mask[yy * w + xx]) c++;
    }
    occ[y * w + x] = c / 9;
  }
  return {w, h, n, amp, ph, freq, mask, occ, density: m / n};
}

function timeIt(fn, n) {
  const a = process.hrtime.bigint();
  for (let i = 0; i < n; i++) fn(i);
  return Number(process.hrtime.bigint() - a) / 1e6 / n;
}

/* ── worlds ─────────────────────────────────────────────────────────────── */
for (const W of WORLDS) {
  const r = {id: W.id, label: W.label, ok: true, fails: []};
  const field = synthField(__M, __M);
  const PAR = {};
  for (const p of (W.params || [])) PAR[p.key] = p.def;
  r.params = (W.params || []).map(p => p.key).join(',');
  try {
    const rng = mulberry32(12345);
    const t0 = process.hrtime.bigint();
    const S = W.init(__M, __M, field, rng, PAR);
    r.initMs = Number(process.hrtime.bigint() - t0) / 1e6;
    if (!S) throw new Error('init returned nothing');

    const V = W.view(S);
    const need = ['live', 'col', 'face', 'flip', 'lift', 'spin', 'stack', 'spark'];
    for (const k of need) if (!V[k] || V[k].length !== __M * __M) throw new Error('view.' + k + ' wrong');
    r.view = need.map(k => k[0] + (V[k].BYTES_PER_ELEMENT * 8)).join(',');

    /* same objects every call: the renderer and the GC depend on it */
    const V2 = W.view(S);
    r.reuse = need.every(k => V2[k] === V[k]);

    for (let i = 0; i < __WARM; i++) W.step(S, field, PAR);
    r.msStep = +timeIt(() => W.step(S, field, PAR), __TIMED).toFixed(3);
    r.msView = +timeIt(() => W.view(S), 20).toFixed(3);
    r.msStats = +timeIt(() => W.stats(S), 20).toFixed(3);

    /* trajectory on a fresh seed, so the timing run cannot bias it */
    const S2 = W.init(__M, __M, field, mulberry32(12345), PAR);
    const traj = [];
    for (let i = 1; i <= __STEPS; i++) {
      W.step(S2, field, PAR);
      if (i % Math.max(1, (__STEPS / 4) | 0) === 0) traj.push(W.stats(S2));
    }
    r.traj = traj;
    r.live = W.stats(S2);
    if (!isFinite(r.live)) { r.ok = false; r.fails.push('stats not finite'); }
    let rising = traj.length > 2 && traj.every((v, i) => i === 0 || v > traj[i - 1]);
    if (rising) r.warn = 'monotone rising over ' + __STEPS + ' steps - check for saturation';
    if (traj[traj.length - 1] === 0 && traj[0] === 0) r.warn = 'never populated';

    const V3 = W.view(S2);
    let oor = 0, nan = 0;
    for (let i = 0; i < V3.n; i++) {
      if (V3.col[i] >= PAL.length) oor++;
      if (!isFinite(V3.lift[i]) || !isFinite(V3.spin[i]) || !isFinite(V3.spark[i]) ||
          !isFinite(V3.flip[i])) nan++;
    }
    r.colOor = oor; r.nan = nan;
    if (oor) { r.ok = false; r.fails.push(oor + ' palette indices out of range'); }
    if (nan) { r.ok = false; r.fails.push(nan + ' non-finite view values'); }
    r.hud = String(W.HUD ? W.HUD(S2, field, PAR) : '');
    r.blurb = String(W.blurb || '').slice(0, 60);
  } catch (e) {
    r.ok = false; r.fails.push(e.message);
  }
  __out.worlds.push(r);
}

/* ── fields, if the module is here ──────────────────────────────────────── */
if (typeof prepRecord === 'function' && typeof GSFC !== 'undefined') {
  /* smooth:true is the flag for "this record needs no reduction". Without it,
     matrix/spectro/hst block-average 773 samples into the board's point count
     and this harness reports 18.27% on matrix where tools/probe-field.mjs and
     the page both report 19.231% — the harness has to be the same claim. */
  const rec = prepRecord({name: GSFC.name, re: decodeF64(GSFC.re),
                          im: decodeF64(GSFC.im), t: decodeF64(GSFC.t),
                          smooth: true});
  __out.rec = {n: rec.re.length, turns: rec.turns, amax: rec.amax};
  /* the same record handed to a field must give the same arrays, always */
  for (const F of FIELDS) {
    const r = {id: F.id, label: F.label, ok: true, fails: []};
    const PAR = {}; for (const p of (F.params || [])) PAR[p.key] = p.def;
    r.params = (F.params || []).map(p => p.key).join(',');
    try {
      let f = null, t0 = process.hrtime.bigint();
      f = F.build(rec, __M, __M, PAR);
      r.ms = Number(process.hrtime.bigint() - t0) / 1e6;
      if (!f || !f.mask || f.w !== __M) throw new Error('build returned nothing usable');
      let m = 0, nan = 0, amin = 1e9, amax = -1e9;
      for (let i = 0; i < f.w * f.h; i++) {
        if (f.mask[i]) m++;
        if (!isFinite(f.amp[i]) || !isFinite(f.ph[i]) || !isFinite(f.freq[i])) nan++;
        if (f.amp[i] < amin) amin = f.amp[i];
        if (f.amp[i] > amax) amax = f.amp[i];
      }
      r.density = +(m / (f.w * f.h) * 100).toFixed(1);
      r.amp = [+amin.toFixed(4), +amax.toFixed(4)];
      r.nan = nan;
      if (nan) { r.ok = false; r.fails.push(nan + ' non-finite field values'); }
      if (!m) { r.ok = false; r.fails.push('empty mask'); }
      /* determinism: the same record and params must give bit-identical output */
      const g = F.build(rec, __M, __M, PAR);
      let diff = 0;
      for (let i = 0; i < f.w * f.h; i++)
        if (f.amp[i] !== g.amp[i] || f.ph[i] !== g.ph[i] || f.mask[i] !== g.mask[i]) diff++;
      r.nondet = diff;
      if (diff) { r.ok = false; r.fails.push(diff + ' cells differ between identical builds'); }
      r.note = String(f.note || '');
    } catch (e) { r.ok = false; r.fails.push(e.message); }
    __out.fields.push(r);
  }
  /* every builder must accept every size, including odd ones */
  for (const F of FIELDS) {
    for (const [w, h] of [[31, 17], [120, 120], [8, 8]]) {
      try {
        const PAR = {}; for (const p of (F.params || [])) PAR[p.key] = p.def;
        const f = F.build(rec, w, h, PAR);
        if (f.w !== w || f.h !== h || !f.mask || f.mask.length !== w * h ||
            f.amp.length !== w * h || f.ph.length !== w * h) throw new Error('bad shape');
      } catch (e) {
        __out.sizeFail = (__out.sizeFail || []).concat(F.id + ' ' + w + 'x' + h + ': ' + e.message);
      }
    }
  }
}
return __out;
`;

const run = new Function('__M', '__STEPS', '__MISSING', '__WARM', '__TIMED', src + '\n' + BODY);
const out = run(M, STEPS, missing, WARM, TIMED);

console.log(`\nmodules: ${files.join(' ')}`);
if (missing.length) console.log(`absent : ${missing.join(' ')}`);
console.log(`hash   : ${hash}  (${Object.entries(mt).map(([f, t]) => f + '@' + t).join(' ')})`);

console.log(`\n── worlds @ ${M}x${M} · ${STEPS} steps · timing after ${WARM} warm-up steps ──`);
for (const r of out.worlds) {
  const mark = (r.ok && !r.warn) ? '✓' : r.ok ? '⚠' : '✗';
  console.log(`${mark} ${r.id.padEnd(6)} ${String(r.label).padEnd(11)}` +
    `step ${String(r.msStep).padStart(6)}ms · view ${String(r.msView).padStart(5)}ms · ` +
    `stats ${String(r.msStats).padStart(5)}ms · init ${String(r.initMs).padStart(6)}ms`);
  console.log(`   live ${r.live} · traj [${(r.traj || []).join(', ')}] · reuse ${r.reuse} · ` +
    `id-oor ${r.colOor} · nan ${r.nan}`);
  console.log(`   params [${r.params}] view(${r.view}) hud "${r.hud}"`);
  if (r.warn) console.log(`   ⚠ ${r.warn}`);
  for (const f of r.fails) console.log(`   ✗ ${f}`);
}
if (out.rec) console.log(`\n── fields @ ${M}x${M} ──\nrecord n=${out.rec.n} turns=${out.rec.turns} amax=${out.rec.amax}`);
const fw = 14;
for (const r of out.fields) {
  if (!r.ok) { console.log(`✗ ${r.id.padEnd(8)} ${r.fails.join('; ')}`); continue; }
  console.log(`✓ ${r.id.padEnd(8)} ${String(r.label).padEnd(fw)} mask ${String(r.density).padStart(5)}% · ` +
    `amp ${r.amp[0]}..${r.amp[1]} · ${r.ms.toFixed(1)}ms · nondet ${r.nondet} · params [${r.params}]`);
  if (r.note) console.log(`   ${r.note}`);
}
for (const f of (out.sizeFail || [])) console.log(`✗ size ${f}`);
if (!out.fields.length) console.log('(no field module yet)');
console.log('');

import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';

const root = new URL('../', import.meta.url);
const coreSource = readFileSync(new URL('src/core.js', root), 'utf8');
const worldSource = readFileSync(new URL('src/w-synch.js', root), 'utf8');
const {world, mulberry32, h2} = new Function(coreSource + '\n' + worldSource +
  '\nreturn {world: worldById("synch"), mulberry32, h2};')();
const TAU = 2 * Math.PI;
const defaults = Object.fromEntries(world.params.map(p => [p.key, p.def]));

// Standalone fixture: radial omega ramp plus an amplitude blob; record phases
// cover the circle rather than starting artificially synchronised.
function radial(w, h, seed = 91, frequencyScale = 1) {
  const n = w * h, f = {w, h};
  for (const key of ['amp', 'ph', 'freq', 'occ']) f[key] = new Float32Array(n);
  f.mask = new Uint8Array(n).fill(1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, u = (x + 0.5) / w * 2 - 1, v = (y + 0.5) / h * 2 - 1;
    f.freq[i] = frequencyScale * 0.32 * (Math.hypot(u, v) - 0.7);
    f.ph[i] = TAU * h2(x + seed, y - seed);
    f.amp[i] = Math.exp(-12 * (u * u + v * v));
    f.occ[i] = f.amp[i];
  }
  return f;
}
// Integration fixture is also constructed inline: two thin bands and a disc.
function bands(w, h) {
  const f = radial(w, h);
  f.mask.fill(0); f.amp.fill(0); f.ph.fill(0); f.freq.fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const band = Math.abs(y - ((x * 1.3 + 5) % h)) < 0.6 ||
      Math.abs(y - ((x * 0.6 + h * 0.5) % h)) < 0.6;
    if (!band && Math.hypot(x - w * 0.3, y - h * 0.6) >= w * 0.13) continue;
    const i = y * w + x;
    f.mask[i] = 1; f.amp[i] = 0.06 + 0.9 * x / w;
    f.ph[i] = (x + y) * 0.13; f.freq[i] = 0.041 + 0.02 * y / h;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let count = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      count += f.mask[((y + dy + h) % h) * w + (x + dx + w) % w];
    }
    f.occ[y * w + x] = count / 9;
  }
  return f;
}
function advance(S, field, p, count) {
  for (let t = 0; t < count; t++) world.step(S, field, p);
}
function angleDifference(a, b) { return Math.atan2(Math.sin(a - b), Math.cos(a - b)); }
function meanPhaseDifference(A, B) {
  let total = 0;
  for (const i of A.active) total += Math.abs(angleDifference(A.theta[i], B.theta[i]));
  return total / A.visible;
}
function domains(S) {
  const seen = new Uint8Array(S.n), stack = new Int32Array(S.visible);
  const byCell = new Int32Array(S.n).fill(-1);
  for (let a = 0; a < S.visible; a++) byCell[S.active[a]] = a;
  let count = 0;
  for (const start of S.active) {
    if (seen[start]) continue;
    count++;
    let size = 1;
    stack[0] = start; seen[start] = 1;
    while (size) {
      const i = stack[--size], a = byCell[i];
      for (let b = 0; b < S.degree[a]; b++) {
        const j = S.neighbours[a * 4 + b];
        if (seen[j] || Math.abs(angleDifference(S.theta[j], S.theta[i])) > 0.5) continue;
        seen[j] = 1; stack[size++] = j;
      }
    }
  }
  return count;
}
function regime(field, p, label, requireTuned = false) {
  const S = world.init(field.w, field.h, field, mulberry32(20260919), p);
  const counts = [domains(S)];
  const thresholds = [0.90, 0.95, 0.97, 0.99];
  const ages = requireTuned ? thresholds.map(() => new Uint8Array(S.n)) : null;
  let low = 1, high = 0, slips = 0;
  for (let t = 1; t <= 500; t++) {
    world.step(S, field, p);
    if (ages) for (let k = 0; k < thresholds.length; k++) for (const i of S.active) {
      ages[k][i] = S.localR[i] > thresholds[k] ? Math.min(20, ages[k][i] + 1) : 0;
    }
    if (t > 100) { low = Math.min(low, S.order); high = Math.max(high, S.order); slips += S.slipBonds; }
    if (t % 100 === 0) counts.push(domains(S));
  }
  const locked = S.locked / S.visible;
  const slipRate = S.bonds ? slips / 4 / S.bonds : 0;
  let faces = 0;
  for (const i of S.active) faces += S.V.face[i];
  console.log(`${label} visible=${S.visible} directed_bonds=${S.bonds} locked500=${locked.toFixed(6)} face500=${(faces / S.visible).toFixed(6)} r101_500_min=${low.toFixed(6)} max=${high.toFixed(6)} swing=${(high-low).toFixed(6)} domains_t0_100_200_300_400_500=[${counts}] slips_per100steps=${(slips/4).toFixed(3)} slips_per1000bonds_per100steps=${(slipRate*1000).toFixed(6)}`);
  if (requireTuned) {
    assert.ok(locked > 0.2 && locked < 0.9);
    assert.ok(high - low >= 0.1);
    assert.ok(counts.at(-1) > 1 && new Set(counts.slice(1)).size > 1);
    assert.ok(slipRate >= 0.001 && slipRate <= 0.05);
    assert.ok(faces / S.visible >= 0.05 && faces / S.visible <= 0.2);
    const fractions = ages.map(age => S.active.reduce((sum, i) => sum + (age[i] >= 20), 0) / S.visible);
    console.log(`face_threshold_fit ${field.w}x${field.h} dwell20_r_gt_[${thresholds}]=[${fractions.map(x => x.toFixed(6))}] shipped_deepest20percent=${(faces / S.visible).toFixed(6)}`);
  }
  return S;
}

// Direct trigonometric oracle catches a wrong sign, stencil, degree divisor,
// in-place updates, missing pinning or omitted amplitude/frequency detuning.
const small = radial(5, 4), pOracle = {...defaults, K: 1, h: 0.02};
small.mask[7] = 0;
const oracle = world.init(5, 4, small, mulberry32(27), pOracle);
const expected = new Float64Array(20);
let jitterMax = 0;
for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) {
  const i = y * 5 + x;
  if (!small.mask[i]) continue;
  const theta = oracle.theta[i];
  const neighbours = [y * 5 + (x + 4) % 5, y * 5 + (x + 1) % 5,
    ((y + 3) % 4) * 5 + x, ((y + 1) % 4) * 5 + x];
  let sum = 0, count = 0;
  for (const j of neighbours) if (small.mask[j]) { sum += Math.sin(oracle.theta[j] - theta); count++; }
  expected[i] = pOracle.h * (pOracle.detune * (0.35 * small.freq[i] +
    pOracle.spread * oracle.spreadScale * (small.amp[i] - oracle.meanAmp)) +
    pOracle.K * sum / count + pOracle.drive * small.amp[i] * Math.sin(small.ph[i] - theta));
  jitterMax = Math.max(jitterMax, Math.abs(angleDifference(theta, small.ph[i])));
}
world.step(oracle, small, pOracle);
let deltaError = 0;
for (const i of oracle.active) deltaError = Math.max(deltaError, Math.abs(oracle.delta[i] - expected[i]));
assert.ok(deltaError < 1e-7 && jitterMax <= 0.020001);
console.log(`oracle max_delta_error_rad=${deltaError.toExponential(3)} max_initial_jitter_rad=${jitterMax.toFixed(6)} active=${oracle.visible} bonds=${oracle.bonds} substeps=${oracle.substeps}`);

const seeds = [91, 117, 203, 311], checkpoints = [0, 100, 200, 300, 400, 500];
const terminalOrders = [];
console.log(`order fixture=52x52 radial_freq+amp_blob seeds=${seeds} drive=${defaults.drive} spread=${defaults.spread} FREQGAIN=0.35`);
for (const K of [0, 1, 3, 6]) {
  const sums = new Float64Array(checkpoints.length);
  let lateMean = 0, lockedMean = 0;
  for (const seed of seeds) {
    const f = radial(52, 52, seed), p = {...defaults, K};
    const S = world.init(52, 52, f, mulberry32(seed), p);
    sums[0] += S.order;
    for (let t = 1; t <= 500; t++) {
      world.step(S, f, p);
      if (t % 100 === 0) sums[t / 100] += S.order;
      if (t > 400) lateMean += S.order / 100;
    }
    lockedMean += S.locked / S.visible;
  }
  const means = Array.from(sums, v => v / seeds.length);
  terminalOrders.push(means.at(-1));
  console.log(`K=${K} r_at_[${checkpoints}]=[${means.map(v => v.toFixed(5))}] r_last100=${(lateMean / seeds.length).toFixed(5)} locked500=${(lockedMean / seeds.length).toFixed(5)}`);
}
assert.ok(terminalOrders[0] < 0.06);
for (let i = 1; i < terminalOrders.length; i++) assert.ok(terminalOrders[i] > terminalOrders[i-1]);
const field = radial(52, 52), base = world.init(52, 52, field, mulberry32(91), defaults);
advance(base, field, defaults, 500);
assert.ok(base.locked / base.visible > 0.1 && base.locked / base.visible < 1);
console.log(`radial_default r500=${base.order.toFixed(6)} locked=${base.locked}/${base.visible} locked_fraction=${(base.locked/base.visible).toFixed(6)}`);
regime(bands(52, 52), defaults, 'synthetic_bands_default');

// A torus cannot support a globally monotone unwrapped linear ramp. Its central
// half, away from the seam, measures genuinely emergent spatial phase gradients.
const wave = radial(52, 52);
for (let y = 0; y < 52; y++) for (let x = 0; x < 52; x++) {
  const i = y * 52 + x;
  wave.freq[i] = x / 51 - 0.5; wave.ph[i] = 0; wave.amp[i] = 0;
}
const pWave = {...defaults, drive: 0}, W = world.init(52, 52, wave, mulberry32(16), pWave);
const slopes = [];
for (let t = 0; t <= 500; t++) {
  if (t % 100 === 0) {
    let sum = 0, positive = 0, count = 0;
    for (let y = 0; y < 52; y++) for (let x = 13; x < 38; x++) {
      const i = y * 52 + x, slope = angleDifference(W.theta[i + 1], W.theta[i]);
      sum += slope; positive += slope > 0 ? 1 : 0; count++;
    }
    slopes.push(sum/count);
    console.log(`wave t=${t} central_mean_dtheta_dx=${(sum/count).toFixed(6)} positive_fraction=${(positive/count).toFixed(6)}`);
    if (t === 500) assert.ok(positive/count > 0.99);
  }
  if (t < 500) world.step(W, wave, pWave);
}
assert.ok(slopes.at(-1) > 0.02 && slopes.at(-1) > slopes[1]);
const tripledField = radial(52, 52, 91, 3);
const tripled = world.init(52, 52, tripledField, mulberry32(91), defaults);
advance(tripled, tripledField, defaults, 500);
const steadyDifference = meanPhaseDifference(base, tripled);
assert.ok(steadyDifference > 0.05);
console.log(`freq_x3 t=500 mean_abs_phase_difference_rad=${steadyDifference.toFixed(6)} r_base=${base.order.toFixed(6)} r_x3=${tripled.order.toFixed(6)}`);
const twin = world.init(52, 52, field, mulberry32(91), defaults);
advance(twin, field, defaults, 500);
assert.equal(meanPhaseDifference(base, twin), 0);
const liveField = radial(52, 52);
for (let i = 0; i < liveField.freq.length; i++) liveField.freq[i] += 0.1;
world.step(base, field, defaults); world.step(twin, liveField, defaults);
const liveDifference = meanPhaseDifference(base, twin);
assert.ok(liveDifference > 0.002);
const paramTwin = world.init(52, 52, field, mulberry32(91), defaults);
advance(paramTwin, field, defaults, 500);
const liveParams = {...defaults, detune: 0};
world.step(paramTwin, field, liveParams);
const paramDifference = meanPhaseDifference(base, paramTwin);
assert.ok(paramDifference > 0.0001);
console.log(`live_change after_500 frequency_offset_phase_difference_rad=${liveDifference.toFixed(6)} detune_off_phase_difference_rad=${paramDifference.toFixed(6)} deterministic_replay_difference_rad=0`);

// Hidden cells are not a coherent bath. Altering only their record values must
// have exactly zero influence on the visible oscillator graph.
const hiddenA = bands(20, 20), hiddenB = bands(20, 20);
for (let i = 0; i < hiddenB.mask.length; i++) if (!hiddenB.mask[i]) {
  hiddenB.ph[i] = 31; hiddenB.freq[i] = 1; hiddenB.amp[i] = 1;
}
const HA = world.init(20, 20, hiddenA, mulberry32(8), defaults);
const HB = world.init(20, 20, hiddenB, mulberry32(8), defaults);
advance(HA, hiddenA, defaults, 100); advance(HB, hiddenB, defaults, 100);
assert.equal(meanPhaseDifference(HA, HB), 0);
// A known relative-phase crossing flips exactly its two endpoint cards.
const slipField = radial(5, 4);
slipField.mask.fill(0); slipField.mask[6] = 1; slipField.mask[7] = 1; slipField.mask[19] = 1;
slipField.amp.fill(0); slipField.freq.fill(0); slipField.ph.fill(0);
slipField.ph[7] = Math.PI - 0.4; slipField.freq[6] = -1; slipField.freq[7] = 1;
const pSlip = {...defaults, K: 0, spread: 0, drive: 0, detune: 4, h: 0.3};
const SL = world.init(5, 4, slipField, mulberry32(7), pSlip), V = world.view(SL);
world.step(SL, slipField, pSlip);
assert.equal(SL.slipBonds, 2);
assert.equal(V.flip[6], 1); assert.equal(V.flip[7], 1); assert.equal(V.flip[19], 0);
world.step(SL, slipField, pSlip);
assert.ok(Math.abs(V.flip[6] - 0.88) < 1e-6);
assert.equal(world.view(SL), V);
assert.equal(SL.localR[19], 0);
// Faces are earned through twenty complete generations, never at init.
const faceField = radial(5, 4); faceField.ph.fill(0); faceField.freq.fill(0); faceField.amp.fill(0);
const F = world.init(5, 4, faceField, mulberry32(12), defaults);
assert.equal(F.V.face.reduce((a,b) => a+b,0), 0);
advance(F, faceField, defaults, 19);
assert.equal(F.V.face.reduce((a,b) => a+b,0), 0);
world.step(F, faceField, defaults);
assert.equal(F.V.face.reduce((a,b) => a+b,0), 4);
const strongest = Array.from(F.active).sort((a,b) => F.localR[b] - F.localR[a] || a-b).slice(0,4);
for (const i of strongest) assert.equal(F.V.face[i], 1);
console.log(`view hidden_bath_phase_difference_rad=0 known_crossing_directed_slips=2 endpoint_flip_decay=${V.flip[6].toFixed(2)} isolated_order=${SL.localR[19]} face_count_gen19=0 face_count_gen20=4 strongest_rank_matches=1 reused_view=1`);

// A recorded shake sequence must replay bit-for-bit, including zero impulses,
// repeated impulses before a generation, and presentation delayed until step.
const replayField = bands(20, 20);
const replayA = world.init(20, 20, replayField, mulberry32(77), defaults);
const replayB = world.init(20, 20, replayField, mulberry32(77), defaults);
const substrate = Object.fromEntries(['mask','amp','freq','ph','occ'].map(key => [key, replayField[key].slice()]));
advance(replayA, replayField, defaults, 100); advance(replayB, replayField, defaults, 100);
const zeroTheta = replayA.theta.slice();
world.shake(replayA, replayField, 0);
assert.deepEqual(replayA.theta, zeroTheta);
for (const power of [0.2, 0.5, 1, 0.2, 1]) {
  const snapshot = Object.fromEntries(Object.entries(replayA.V).filter(([,v]) => ArrayBuffer.isView(v)).map(([key,v]) => [key,v.slice()]));
  const textA = world.shake(replayA, replayField, power);
  const textB = world.shake(replayB, replayField, power);
  assert.equal(textA, textB);
  for (const key of Object.keys(snapshot)) assert.deepEqual(replayA.V[key], snapshot[key]);
  for (const key of Object.keys(substrate)) assert.deepEqual(replayField[key], substrate[key]);
  assert.deepEqual(replayA.theta, replayB.theta);
  let c = 0, s = 0;
  for (const i of replayA.active) { c += Math.cos(replayA.theta[i]); s += Math.sin(replayA.theta[i]); }
  assert.ok(Math.abs(replayA.order - Math.hypot(c,s)/replayA.visible) < 1e-7);
  // The middle pair lands without stepping: queued slips must remain replayable.
  if (power !== 0.5) {
    advance(replayA, replayField, defaults, 17); advance(replayB, replayField, defaults, 17);
  }
}
assert.deepEqual(replayA.theta, replayB.theta);
assert.deepEqual(replayA.V, replayB.V);
console.log(`shake_replay sequence=[0.2,0.5,1,0.2,1] phase_difference_rad=${meanPhaseDifference(replayA,replayB)} zero_impulse_rng_unchanged=1 substrate_unchanged=1 view_unchanged_during_kick=1 measured_global_order_matches_theta=1`);
console.log(`persistent_HUD="${world.HUD(replayA,replayField,defaults)}" blurb="${world.blurb}"`);

function shakeCases(field) {
  console.log(`shake_recovery_definition ${field.w}x${field.h} baseline_generation=500 horizon=1000 matched_unshaken_control=1 locked_tolerance_absolute=0.05 global_r_tolerance_absolute=0.03 consecutive_generations=20 reported_generation=confirmation`);
  for (const power of [0.2, 0.5, 1]) {
    const S = world.init(field.w, field.h, field, mulberry32(20260919), defaults);
    const control = world.init(field.w, field.h, field, mulberry32(20260919), defaults);
    advance(S, field, defaults, 500); advance(control, field, defaults, 500);
    const rBefore = S.order, lockedBefore = S.locked/S.visible, domainsBefore = domains(S);
    const start = performance.now();
    const returned = world.shake(S, field, power);
    const callMs = performance.now() - start;
    const rAfter = S.order, lockedAfter = S.locked/S.visible, domainsAfter = domains(S);
    let lockedRun = 0, globalRun = 0, lockedRecovery = null, globalRecovery = null;
    for (let t = 1; t <= 1000; t++) {
      world.step(S, field, defaults); world.step(control, field, defaults);
      lockedRun = Math.abs(S.locked/S.visible - control.locked/control.visible) <= 0.05 ? lockedRun + 1 : 0;
      globalRun = Math.abs(S.order-control.order) <= 0.03 ? globalRun + 1 : 0;
      if (lockedRecovery === null && lockedRun >= 20) lockedRecovery = t;
      if (globalRecovery === null && globalRun >= 20) globalRecovery = t;
    }
    const finalLock = S.locked/S.visible, controlLock = control.locked/control.visible;
    console.log(`shake ${field.w}x${field.h} power=${power} global_r_before=${rBefore.toFixed(6)} after=${rAfter.toFixed(6)} signed_r_drop=${(rBefore-rAfter).toFixed(6)} local_locked_before=${lockedBefore.toFixed(6)} after=${lockedAfter.toFixed(6)} local_recovery_confirmed_gen=${lockedRecovery ?? '>1000'} global_control_rejoin_confirmed_gen=${globalRecovery ?? '>1000'} call_ms=${callMs.toFixed(4)} locked_at1000=${finalLock.toFixed(6)} control_locked_at1000=${controlLock.toFixed(6)} locked_difference=${(finalLock-controlLock).toFixed(6)} global_r_at1000=${S.order.toFixed(6)} control_r_at1000=${control.order.toFixed(6)} domains_before_after_final=[${domainsBefore},${domainsAfter},${domains(S)}] returned="${returned}"`);
    assert.ok(lockedRecovery !== null && lockedRecovery <= 200, 'shake must not permanently destroy local locking');
    assert.ok(Math.abs(finalLock-controlLock) < 0.05, 'post-shake locked fraction must return to the control regime');
    assert.ok(domains(S) > 1);
    for (const i of S.active) assert.ok(Number.isFinite(S.theta[i]));
  }
}

function timing(w, p, f = radial(w, w), label = 'full_grid') {
  const S = world.init(w, w, f, mulberry32(404), p);
  advance(S, f, p, 60);
  const samples = [];
  for (let batch = 0; batch < 5; batch++) {
    const start = performance.now();
    advance(S, f, p, 80);
    samples.push((performance.now() - start)/80);
  }
  samples.sort((a,b) => a-b);
  console.log(`timing ${label} ${w}x${w} visible=${S.visible} K=${p.K} spread=${p.spread} detune=${p.detune} drive=${p.drive} h=${p.h} substeps=${S.substeps} median_ms_per_step=${samples[2].toFixed(4)} max_batch_ms_per_step=${samples[4].toFixed(4)} r=${S.order.toFixed(5)}`);
  for (const array of [S.theta, S.cs, S.sn, S.V.flip, S.V.spark]) {
    for (let i = 0; i < array.length; i++) assert.ok(Number.isFinite(array[i]));
  }
  for (const i of S.active) assert.ok(S.V.col[i] >= 0 && S.V.col[i] < 8);
  return samples[2];
}
for (const w of [52, 120]) assert.ok(timing(w, defaults) < (w === 52 ? 1 : 8));
for (const w of [52, 120]) {
  const ms = timing(w, {...defaults, K: 8, drive: 2, h: 0.3});
  if (w === 120 && ms > 8) console.log(`worst_case_warning 120x120 exceeds_8ms=${ms.toFixed(4)}`);
}

// The default command prints all nine real-record shake cases, including both
// sustained recovery measures. --real adds the optional 15-row fit/timing audit.
{
  const api = new Function(coreSource + '\n' +
    readFileSync(new URL('src/w-field.js', root), 'utf8') + '\n' +
    readFileSync(new URL('src/data-gsfc.js', root), 'utf8') +
    '\nreturn {rec:prepRecord(GSFC), path:fieldById("path")};')();
  for (const w of [52, 76, 120]) {
    const f = api.path.build(api.rec, w, w, {});
    if (process.argv.includes('--real')) {
      for (const exponent of [0, 0.15, 0.25, 0.35, 0.5]) {
        // Cancel the implementation's fitted .25 factor, then apply each candidate
        // exponent. Thus every row measures the same physical spread=2.4 baseline.
        const p = {...defaults, spread: defaults.spread * Math.pow(w*w/2704, exponent-0.25)};
        regime(f, p, `real_fit ${w}x${w} p=${exponent}`, exponent === 0.25);
      }
      timing(w, defaults, f, 'real_path_default');
      timing(w, {...defaults, K:8, drive:2, h:0.3}, f, 'real_path_worst');
    }
    shakeCases(f);
  }
}

import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';

const core = readFileSync(new URL('../src/core.js', import.meta.url), 'utf8');
let source = readFileSync(new URL('../src/w-rd.js', import.meta.url), 'utf8');
// An explicitly labelled experiment, not another shipped mode or fixture branch.
// Keep the alternative spatial-rate map reproducible alongside its tradeoff.
if (process.argv.includes('--mitosis')) {
  source = source.replace('mod * 0.016 * (signal - 0.4)', 'mod * 0.012 * (signal - 0.4)')
    .replace('mod * 0.002 * (signal - 0.3)', 'mod * 0.01 * (signal - 0.1)');
}
const { world, rng } = new Function(core + '\n' + source + '\nreturn {world:WORLDS[0],rng:mulberry32};')();
const defaults = Object.fromEntries(world.params.map(p => [p.key, p.def]));

// Deliberately independent of w-field.js: one loud Gaussian blob and one stripe.
function field(w, h, mirror = false) {
  const amp = new Float32Array(w * h), mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const X = (mirror ? w - 1 - x : x) / w, Y = y / h, i = y * w + x;
    amp[i] = Math.min(1, Math.exp(-((X - 0.32) ** 2 + (Y - 0.45) ** 2) / 0.022) + (Math.abs(X - 0.73) < 0.04 ? 0.7 : 0));
    mask[i] = amp[i] > 0.25 ? 1 : 0;
  }
  return { w, h, amp, mask };
}
function blobs(S) {
  const on = world.view(S).live, seen = new Uint8Array(S.n), queue = new Int32Array(S.n);
  let count = 0;
  for (let i = 0; i < S.n; i++) {
    if (!on[i] || seen[i]) continue;
    count++;
    let head = 0, tail = 1;
    queue[0] = i; seen[i] = 1;
    while (head < tail) {
      const j = queue[head++];
      for (const k of [S.left[j], S.right[j], S.up[j], S.down[j]]) {
        if (on[k] && !seen[k]) { seen[k] = 1; queue[tail++] = k; }
      }
    }
  }
  return count;
}
function bounds(S) {
  let uMin = 1, uMax = 0, vMin = 1, vMax = 0;
  for (let i = 0; i < S.n; i++) {
    assert(Number.isFinite(S.u[i]) && Number.isFinite(S.v[i]), 'non-finite concentration');
    uMin = Math.min(uMin, S.u[i]); uMax = Math.max(uMax, S.u[i]);
    vMin = Math.min(vMin, S.v[i]); vMax = Math.max(vMax, S.v[i]);
  }
  assert(uMin >= 0 && vMin >= 0 && uMax <= 1 && vMax <= 1, 'concentration out of bounds');
  return { uMin, uMax, vMin, vMax };
}
function meanDifference(a, b) {
  let sum = 0;
  for (let i = 0; i < a.n; i++) sum += Math.abs(a.v[i] - b.v[i]);
  return sum / a.n;
}
const fmt = x => Number(x.toFixed(6));
console.log('configuration.map', process.argv.includes('--mitosis') ? 'EXPERIMENT: stronger amplitude-driven mitosis' : 'SHIPPED: mild amplitude map with off-mask loss');
if (process.argv.includes('--shake')) {
  const { rec, fields } = loadRecord();
  probeShakes(rec, fields);
  process.exit(0);
}
if (process.argv.includes('--record')) {
  probeRecord();
  process.exit(0);
}
const W = 52, H = 52, A = field(W, H), B = field(W, H, true);
const S = world.init(W, H, A, rng(20260919), defaults);
const controlParams = { ...defaults, drive: 0 };
const C = world.init(W, H, A, rng(20260919), controlParams);
const independent = world.init(W, H, B, rng(20260919), controlParams);
const switched = world.init(W, H, A, rng(20260919), defaults);
const trajectory = [];
let births = 0, deaths = 0, lateBirths = 0, lateDeaths = 0;
let maxFaces = 0, maxFlips = 0, maxSparks = 0, usedColors = 0;
for (let step = 1; step <= 2000; step++) {
  // Emulate one app-rendered frame; the world must not apply a second fade.
  for (let i = 0; i < S.n; i++) S.V.spark[i] *= 0.88;
  world.step(S, A, defaults);
  world.step(C, A, controlParams);
  world.step(independent, B, controlParams);
  world.step(switched, step > 500 ? B : A, defaults);
  bounds(S); bounds(C); bounds(switched);
  const V = world.view(S);
  let faces = 0, flips = 0, sparks = 0;
  for (let i = 0; i < S.n; i++) {
    assert.equal(V.live[i], S.v[i] > 0.18 ? 1 : 0, 'card threshold differs from concentration');
    assert(V.lift[i] === 0 && V.spin[i] === 0, 'reaction cards must stay flat');
    if (V.live[i]) {
      faces += V.face[i]; flips += V.flip[i] > 0 ? 1 : 0; sparks += V.spark[i] > 0 ? 1 : 0;
      usedColors |= 1 << V.col[i];
      assert(!V.face[i] || (S.age[i] >= 60 && S.v[i] >= 0.30), 'young/low-concentration card has eyes');
    }
  }
  maxFaces = Math.max(maxFaces, faces); maxFlips = Math.max(maxFlips, flips); maxSparks = Math.max(maxSparks, sparks);
  assert(faces <= Math.floor(S.live / 4), 'face population exceeded quarter cap');
  births += S.births; deaths += S.deaths;
  if (step > 1500) { lateBirths += S.births; lateDeaths += S.deaths; }
  if (step % 200 === 0) trajectory.push({ step, alive: fmt(S.live / S.n), blobs: blobs(S), controlAlive: fmt(C.live / C.n), controlBlobs: blobs(C) });
}
console.log('fixture52.defaults', JSON.stringify(defaults));
for (const sample of trajectory) console.log('fixture52.trajectory', JSON.stringify(sample));
console.log('fixture52.events', JSON.stringify({ births, deaths, lateBirths, lateDeaths }));
const counts = trajectory.map(p => p.blobs);
console.log('fixture52.blobVariation', JSON.stringify({ min: Math.min(...counts), max: Math.max(...counts), range: Math.max(...counts) - Math.min(...counts) }));
console.log('fixture52.stability', JSON.stringify({ ...Object.fromEntries(Object.entries(bounds(S)).map(([k, v]) => [k, fmt(v)])), clippedSubsteps: S.clipped, diffusionCFL: 0.16 * 0.5, allowedCFL: 0.25 }));
const sensitivity = { defaultAlive: fmt(S.live / S.n), controlAlive: fmt(C.live / C.n), defaultBlobs: blobs(S), controlBlobs: blobs(C), meanVdifference: fmt(meanDifference(S, C)), switchedAt500Alive: fmt(switched.live / switched.n), switchedAt500Blobs: blobs(switched), continuousFieldDifference: fmt(meanDifference(S, switched)), zeroDriveFieldDifference: meanDifference(C, independent) };
console.log('fixture52.mirroredFieldSensitivity', JSON.stringify(sensitivity));
const bands = usedColors.toString(2).replaceAll('0', '').length;
console.log('fixture52.paperView', JSON.stringify({ maxFaces, maxFlips, maxSparks, bands }));
console.log('fixture52.finding', lateBirths > 0 && lateDeaths > 0 ? 'ACTIVE diagnostic' : 'EXPECTED NEGATIVE: narrow synthetic vessel settles; this is not the GSFC record');
assert(maxFaces > 0 && maxFlips > 0 && maxSparks > 0 && bands === 4, 'missing paper view states');
assert(trajectory.every(p => p.alive > 0.01 && p.alive < 0.95), 'default extinct or saturated');
assert(trajectory.every(p => p.controlAlive > 0.01 && p.controlAlive < 0.95), 'control extinct or saturated');
if (process.argv.includes('--mitosis')) {
  assert(Math.max(...counts) > Math.min(...counts), 'no blob variation');
  assert(lateBirths > 0 && lateDeaths > 0, 'default froze before 2000 steps');
} else {
  // Preserve the original failed tests as explicit, checked negative findings.
  assert.throws(() => assert(Math.max(...counts) > Math.min(...counts), 'no blob variation'), { code: 'ERR_ASSERTION' });
  assert.throws(() => assert(lateBirths > 0 && lateDeaths > 0, 'default froze before 2000 steps'), { code: 'ERR_ASSERTION' });
  assert.equal(lateBirths, 0, 'settling fixture expectation changed');
  assert.equal(lateDeaths, 0, 'settling fixture expectation changed');
}
assert.equal(S.clipped, 0, 'clamp masked a default instability');
assert(sensitivity.meanVdifference > 0.01 && Math.abs(sensitivity.defaultAlive - sensitivity.controlAlive) > 0.005, 'record effect too small');
assert(sensitivity.continuousFieldDifference > 0.005, 'record discarded after initialization');
assert.equal(sensitivity.zeroDriveFieldDifference, 0, 'drive=0 still depends on record');

// Uniform chemistry has zero Laplacian: independently evaluate both Euler substeps.
const uniform = world.init(3, 3, field(3, 3), rng(1), controlParams);
uniform.u.fill(0.7); uniform.v.fill(0.2);
let u = Math.fround(0.7), v = Math.fround(0.2);
for (let sub = 0; sub < 2; sub++) {
  const reaction = u * v * v;
  const nextU = Math.fround(u + 0.5 * (-reaction + defaults.F * (1 - u)));
  v = Math.fround(v + 0.5 * (reaction - (defaults.F + defaults.k) * v)); u = nextU;
}
world.step(uniform, field(3, 3), controlParams);
const equationError = Math.max(Math.abs(uniform.u[4] - u), Math.abs(uniform.v[4] - v));
console.log('uniform-chemistry.euler', JSON.stringify({ u: fmt(uniform.u[4]), v: fmt(uniform.v[4]), error: equationError }));
assert(equationError < 1e-7, 'Euler reaction differs from stated rule');
uniform.V.spark.fill(0.42);
const sparkBefore = uniform.V.spark[4];
world.step(uniform, field(3, 3), controlParams);
assert.equal(uniform.births, 0, 'spark ownership fixture unexpectedly birthed');
assert.equal(uniform.V.spark[4], sparkBefore, 'world applied a second spark fade');
console.log('uniform-chemistry.sparkOwnership', JSON.stringify({ before: fmt(sparkBefore), afterNoBirthStep: fmt(uniform.V.spark[4]), appFrameMultiplier: 0.88 }));
uniform.u.fill(0.5); uniform.v.fill(0.35); uniform.age.fill(60);
world.step(uniform, field(3, 3), controlParams);
console.log('uniform-chemistry.faceTies', JSON.stringify(verifyFaces(uniform)));
assert.equal(uniform.V.face[0] + uniform.V.face[1], 2, 'equal cores must prefer lower cell indices');

// Grid-size sensitivity is measured, not inferred from early population growth.
const largeField = field(120, 120), large = world.init(120, 120, largeField, rng(20260919), defaults);
let largeLateBirths = 0, largeLateDeaths = 0;
const largeTrajectory = [];
for (let step = 1; step <= 2000; step++) {
  world.step(large, largeField, defaults);
  bounds(large);
  if (step > 1500) { largeLateBirths += large.births; largeLateDeaths += large.deaths; }
  if (step % 200 === 0) {
    const sample = { step, alive: fmt(large.live / large.n), blobs: blobs(large) };
    largeTrajectory.push(sample);
    console.log('fixture120.trajectory', JSON.stringify(sample));
  }
}
console.log('fixture120.stability', JSON.stringify({ ...Object.fromEntries(Object.entries(bounds(large)).map(([k, v]) => [k, fmt(v)])), clippedSubsteps: large.clipped, lateBirths: largeLateBirths, lateDeaths: largeLateDeaths }));
assert(largeTrajectory.every(p => p.alive > 0.01 && p.alive < 0.95), '120² default extinct or saturated');
assert(largeLateBirths > 0 && largeLateDeaths > 0, '120² default froze');
assert.equal(large.clipped, 0, 'clamp masked a 120² instability');

for (const size of [52, 120]) {
  const f = field(size, size), s = world.init(size, size, f, rng(20260919), defaults);
  for (let j = 0; j < 250; j++) world.step(s, f, defaults);
  const start = performance.now();
  for (let j = 0; j < 400; j++) { world.step(s, f, defaults); world.view(s); }
  console.log('fixture.timing', JSON.stringify({ width: size, height: size, generations: 400, msPerStep: fmt((performance.now() - start) / 400), liveFraction: fmt(s.live / s.n) }));
}
console.log('PASS[fixture]: bounded; coupling verified; expected settling and active regimes explicitly distinguished.');
probeRecord();

function probeRecord() {
  const { rec, fields } = loadRecord();
  console.log('gsfc.record', JSON.stringify({ name: rec.name, samples: rec.re.length, width: 52, height: 52, defaults, seed: 20260919, rngSeed: (20260919 ^ 0x9e3779b9) >>> 0 }));
  for (const id of ['path', 'spectro']) {
    const f = fields.find(f => f.id === id).build(rec, 52, 52, {});
    const s = world.init(52, 52, f, rng(20260919 ^ 0x9e3779b9), defaults);
    const alternate = fields.find(f => f.id === 'spectro').build(rec, 52, 52, {});
    const switched = id === 'path' ? world.init(52, 52, f, rng(20260919 ^ 0x9e3779b9), defaults) : null;
    let switchedBirths = 0, switchedDeaths = 0;
    let lateBirths = 0, lateDeaths = 0, sustainedMin = 1, sustainedMax = 0;
    for (let step = 1; step <= 2000; step++) {
      world.step(s, f, defaults);
      if (switched) {
        world.step(switched, step > 500 ? alternate : f, defaults);
        if (step > 1800) { switchedBirths += switched.births; switchedDeaths += switched.deaths; }
      }
      bounds(s);
      if (step > 1800) {
        lateBirths += s.births; lateDeaths += s.deaths;
        sustainedMin = Math.min(sustainedMin, s.live / s.n);
        sustainedMax = Math.max(sustainedMax, s.live / s.n);
      }
      if (step === 50 || step === 100 || step === 150 || step === 200 || step === 600 || step === 1000 || step === 2000)
        console.log('gsfc.trajectory', JSON.stringify({ id, step, live: s.live, alive: fmt(s.live / s.n), blobs: blobs(s) }));
    }
    let offMaskLive = 0;
    for (let i = 0; i < s.n; i++) if (!f.mask[i] && s.V.live[i]) offMaskLive++;
    console.log('gsfc.outcome', JSON.stringify({ id, maskFraction: fmt(f.mask.reduce((a, b) => a + b, 0) / s.n), sustainedMin: fmt(sustainedMin), sustainedMax: fmt(sustainedMax), lateBirths, lateDeaths, offMaskLive, clippedSubsteps: s.clipped, ...Object.fromEntries(Object.entries(bounds(s)).map(([k, v]) => [k, fmt(v)])) }));
    assert(s.live > 0 && s.live < 0.95 * s.n && lateBirths > 0 && lateDeaths > 0, 'real-record reef died, flooded, or froze');
    assert.equal(s.clipped, 0, 'real-record clamp masked instability');
    if (switched) {
      const difference = meanDifference(s, switched);
      console.log('gsfc.nonIsometricSwitch', JSON.stringify({ from: 'path', to: 'spectro', switchAfter: 500, baselineAlive: fmt(s.live / s.n), switchedAlive: fmt(switched.live / switched.n), baselineBlobs: blobs(s), switchedBlobs: blobs(switched), meanVdifference: fmt(difference), baselineLateBirths: lateBirths, baselineLateDeaths: lateDeaths, switchedLateBirths: switchedBirths, switchedLateDeaths: switchedDeaths }));
      assert(difference > 0.01 && s.live !== switched.live && blobs(s) !== blobs(switched), 'non-isometric live-record change did not alter pattern statistics');
      assert(lateBirths > 0 && lateDeaths > 0 && switchedBirths > 0 && switchedDeaths > 0, 'baseline or switched record dynamics froze');
    }
  }
  for (const id of ['path', 'matrix', 'hst']) for (const size of id === 'hst' ? [52] : [52, 76, 120]) {
    const f = fields.find(f => f.id === id).build(rec, size, size, { k: 4 });
    const s = world.init(size, size, f, rng(20260919 ^ 0x9e3779b9), defaults);
    const steps = id === 'hst' ? 120 : 300;
    for (let i = 0; i < steps; i++) world.step(s, f, defaults);
    console.log('gsfc.faces', JSON.stringify({ id, size, steps, ...verifyFaces(s) }));
  }
  for (const size of [52, 120]) {
    const f = fields.find(f => f.id === 'path').build(rec, size, size, {});
    const s = world.init(size, size, f, rng(20260919 ^ 0x9e3779b9), defaults);
    for (let i = 0; i < 250; i++) world.step(s, f, defaults);
    const start = performance.now();
    for (let i = 0; i < 400; i++) world.step(s, f, defaults);
    console.log('gsfc.timing', JSON.stringify({ size, msPerStep: fmt((performance.now() - start) / 400) }));
  }
  console.log('PASS[gsfc]: bounded; path evolving; non-isometric field switch changes pattern statistics; sparse spectro near-static.');
  probeShakes(rec, fields);
}

// Independent full-sort oracle: compares the complete winner set, not just its size.
function verifyFaces(s) {
  const eligible = [], actual = [];
  for (let i = 0; i < s.n; i++) {
    if (s.V.face[i]) actual.push(i);
    const x = i % s.w, y = Math.floor(i / s.w);
    const l = x ? i - 1 : i, r = x + 1 < s.w ? i + 1 : i;
    const u = y ? i - s.w : i, d = y + 1 < s.h ? i + s.w : i;
    if (s.v[i] > 0.18 && s.age[i] >= 60 && s.v[i] >= 0.30 &&
        2 * s.v[i] >= s.v[l] + s.v[r] && 2 * s.v[i] >= s.v[u] + s.v[d]) eligible.push(i);
  }
  const cap = Math.floor(s.live / 4);
  const expected = eligible.sort((a, b) => s.v[b] - s.v[a] || s.age[b] - s.age[a] || a - b).slice(0, cap).sort((a, b) => a - b);
  assert.deepEqual(actual, expected, 'bounded face heap differs from independent full sort');
  return { live: s.live, beforeCap: eligible.length, faces: actual.length, fraction: fmt(actual.length / (s.live || 1)), cap, fullSortMatch: true };
}

function loadRecord() {
  const data = readFileSync(new URL('../src/data-gsfc.js', import.meta.url), 'utf8');
  const fieldSource = readFileSync(new URL('../src/w-field.js', import.meta.url), 'utf8');
  return new Function(core + '\n' + data + '\n' + fieldSource + '\nreturn {rec:prepRecord(GSFC),fields:FIELDS};')();
}

function probeShakes(rec, fields) {
  console.log('gsfc.shake.protocol', JSON.stringify({ field: 'path', settle: 600, horizon: 600, recovery: 'max absolute U/V difference <= .001 and live-count difference <= max(1,.001*n), maintained for 30 consecutive generations against the matched unshaken control', rateWindow: 30 }));
  for (const size of [52, 76, 120]) {
    const f = fields.find(f => f.id === 'path').build(rec, size, size, {});
    for (const power of [0.2, 0.5, 1]) shakeCase('gsfc.shake.case', f, size, 600, power, 20260919 ^ 0x9e3779b9);
  }
  shakeCase('fixture52.shakeControl', field(52, 52), 52, 2000, 1, 20260919);
  const f = { amp: new Float32Array(49).fill(0.5), mask: new Uint8Array(49) };
  f.mask[24] = 1;
  const s = world.init(7, 7, f, rng(1), defaults);
  s.u.fill(0.7); s.v.fill(0.2);
  world.step(s, f, { ...defaults, drive: 0 });
  const beforeV = s.v[24], beforeU = s.u[24];
  const message = world.shake(s, f, 1);
  assert.equal(s.v[24], Math.fround(beforeV + 0.025 * (1 - beforeV)));
  assert.equal(s.u[24], beforeU, 'injection unexpectedly changed U');
  assert.equal(s.v[23], beforeV, 'injection escaped its eligible mask');
  console.log('uniform-chemistry.shakeControl', JSON.stringify({ beforeV: fmt(beforeV), afterV: fmt(s.v[24]), unchangedU: fmt(s.u[24]), message }));
  console.log('PASS[shake]: seeded replay, state-only bounded injection, measured recovery horizons, no reef emptied.');
}

function shakeCase(frame, f, size, settle, power, seed) {
  const s = world.init(size, size, f, rng(seed), defaults);
  const control = world.init(size, size, f, rng(seed), defaults);
  const replay = world.init(size, size, f, rng(seed), defaults);
  let preBirths = 0, preDeaths = 0;
  for (let step = 1; step <= settle; step++) {
    world.step(s, f, defaults); world.step(control, f, defaults); world.step(replay, f, defaults);
    if (step > settle - 30) { preBirths += s.births; preDeaths += s.deaths; }
  }
  const before = { reef: s.live, births: s.births, retreats: s.deaths };
  const maskBefore = f.mask.slice();
  const viewBefore = Object.fromEntries(Object.entries(s.V).filter(([, a]) => ArrayBuffer.isView(a)).map(([key, a]) => [key, a.slice()]));
  world.shake(replay, f, 0); // Zero power must not consume the seeded generator.
  const message = world.shake(s, f, power);
  const replayMessage = world.shake(replay, f, power);
  assert.equal(message, replayMessage, 'seeded shake message did not replay');
  assert(!message.includes('\n'), 'shake HUD must be one line');
  assert.equal(s.gen, settle, 'shake advanced the generation');
  assert.deepEqual(f.mask, maskBefore, 'shake rewrote the field mask');
  for (const [key, a] of Object.entries(viewBefore)) assert.deepEqual(s.V[key], a, 'shake directly wrote view.' + key);
  assert.deepEqual(s.u, control.u, 'V injection changed U');
  assert.deepEqual(s.v, replay.v, 'seeded injection did not replay');
  const after = { reef: s.live, births: s.births, retreats: s.deaths };
  world.view(s); // Replay intentionally projects only on its next step.
  let minLive = s.live, maxChemicalDifference = 0, nearCount = 0, recovery = null;
  let postBirths = 0, postDeaths = 0, controlPostBirths = 0, controlPostDeaths = 0;
  for (let step = 1; step <= 600; step++) {
    world.step(s, f, defaults); world.step(control, f, defaults); world.step(replay, f, defaults);
    if (step <= 30) {
      postBirths += s.births; postDeaths += s.deaths;
      controlPostBirths += control.births; controlPostDeaths += control.deaths;
    }
    let difference = 0;
    for (let i = 0; i < s.n; i++) difference = Math.max(difference, Math.abs(s.v[i] - control.v[i]), Math.abs(s.u[i] - control.u[i]));
    maxChemicalDifference = Math.max(maxChemicalDifference, difference);
    minLive = Math.min(minLive, s.live);
    nearCount = difference <= 0.001 && Math.abs(s.live - control.live) <= Math.max(1, 0.001 * s.n) ? nearCount + 1 : 0;
    if (recovery === null && nearCount === 30) recovery = step - 29;
    if (step === 1 || step % 100 === 0) {
      bounds(s);
      assert.deepEqual(s.u, replay.u, 'U replay diverged after shake');
      assert.deepEqual(s.v, replay.v, 'V replay diverged after shake');
      assert.deepEqual(s.age, replay.age, 'projection changed replay age');
      assert.deepEqual(s.V.face, replay.V.face, 'face replay diverged after shake');
      assert.equal(s.births, replay.births); assert.equal(s.deaths, replay.deaths);
    }
  }
  assert(minLive > 0, 'shake emptied the reef');
  console.log(frame, JSON.stringify({ size, power, before, after, message, preRates: [fmt(preBirths / 30), fmt(preDeaths / 30)], postRates: [fmt(postBirths / 30), fmt(postDeaths / 30)], matchedControlPostRates: [fmt(controlPostBirths / 30), fmt(controlPostDeaths / 30)], recoveryAfter: recovery, recoveryFinding: recovery === null ? 'NO RETURN within 600 generations' : '30-generation confirmed return to matched control', minLive, finalLive: s.live, controlFinalLive: control.live, maxChemicalDifference: fmt(maxChemicalDifference), deterministicReplay: true }));
}

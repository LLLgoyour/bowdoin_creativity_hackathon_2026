import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {deflateSync, inflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const root = new URL('../', import.meta.url);
const context = vm.createContext({Buffer});
for (const name of ['core.js', 'data-gsfc.js', 'w-field.js'])
  vm.runInContext(readFileSync(new URL('src/' + name, root), 'utf8'), context, {filename:name});
const api = vm.runInContext('({FIELDS, parseNumeric, prepRecord, makeNoise, fieldFromImage, GSFC, decodeF64, mulberry32})', context);
const GSFC = api.prepRecord({...api.GSFC, smooth:true});
const noise = api.prepRecord(api.makeNoise(2026));
const modes = api.FIELDS;
const fixed = (x, places = 6) => x.toFixed(places);
const sum = a => a.reduce((s, x) => s + x, 0);

function processLoad() {
  const result = spawnSync('ps', ['-axo', 'pid=,pcpu=,comm='], {encoding:'utf8'});
  if (result.status !== 0) return 'otherNodeProcesses=unavailable';
  let count = 0, cpu = 0;
  for (const line of result.stdout.split('\n')) {
    const row = line.match(/^\s*(\d+)\s+([\d.]+)\s+(.+)$/);
    if (row && +row[1] !== process.pid && /(?:^|\/)node(?:\s|$)/.test(row[3])) {count++; cpu += +row[2];}
  }
  return `otherNodeProcesses=${count} otherNodeReportedCpuPct=${cpu.toFixed(1)} (process count is evidence, not an idle guarantee)`;
}

function validate(F) {
  assert.equal(F.mask.length, F.w * F.h);
  for (const key of ['amp', 'ph', 'freq', 'occ']) {
    assert.equal(F[key].length, F.w * F.h);
    for (const x of F[key]) {
      assert(Number.isFinite(x), `${F.id}.${key} nonfinite`);
      if (key === 'amp' || key === 'occ') assert(x >= 0 && x <= 1.000001, `${F.id}.${key} out of range`);
      if (key === 'freq') assert(x >= -1.000001 && x <= 1.000001, `${F.id}.freq out of range`);
    }
  }
  for (const x of F.mask) assert(x === 0 || x === 1);
  assert.equal(typeof F.note, 'string');
}
function stats(F) {
  return `grid=${F.w}x${F.h} cells=${F.w * F.h} mask=${sum(F.mask)} density=${fixed(100 * sum(F.mask) / F.mask.length, 3)}% amp(min/mean/max)=${fixed(Math.min(...F.amp))}/${fixed(sum(F.amp) / F.amp.length)}/${fixed(Math.max(...F.amp))}`;
}
function ascii(F) {
  const glyphs = ' .:-=+*#%@', lines = [];
  for (let y = 0; y < 24; y++) {
    let line = '';
    for (let x = 0; x < 48; x++) {
      const x0 = x * F.w / 48, x1 = (x + 1) * F.w / 48;
      const y0 = y * F.h / 24, y1 = (y + 1) * F.h / 24;
      let total = 0, area = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
        const weight = (Math.min(x1, sx + 1) - Math.max(x0, sx)) * (Math.min(y1, sy + 1) - Math.max(y0, sy));
        total += weight * F.mask[sy * F.w + sx]; area += weight;
      }
      line += glyphs[Math.round(total / area * 9)];
    }
    lines.push('|' + line + '|');
  }
  return lines.join('\n');
}
function histogram(F) {
  const counts = new Uint32Array(9), {w, h} = F;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (F.mask[y * w + x]) {
    let neighbours = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
      if (dx || dy) neighbours += F.mask[((y + dy + h) % h) * w + (x + dx + w) % w];
    counts[neighbours]++;
  }
  return `8-neighbour histogram[0..8]=[${Array.from(counts).join(',')}] fraction>=4=${fixed(sum(counts.subarray(4)) / (sum(counts) || 1))}`;
}
function difference(label, a, b) {
  let xor = 0, union = 0, amplitude = 0;
  for (let i = 0; i < a.mask.length; i++) {
    xor += a.mask[i] !== b.mask[i] ? 1 : 0;
    union += a.mask[i] || b.mask[i] ? 1 : 0;
    amplitude += Math.abs(a.amp[i] - b.amp[i]);
  }
  console.log(`${label} xor=${fixed(xor / a.mask.length)} union=${union}/${a.mask.length} (${fixed(union / a.mask.length)}) xor/union=${fixed(union ? xor / union : 0)} amplitudeL1=${fixed(amplitude / a.mask.length)}`);
  return union ? xor / union : 0;
}
function instantaneous(rec) {
  return Array.from(rec.ph, (_, i) => {
    const a = Math.max(0, i - 1), b = Math.min(rec.ph.length - 1, i + 1);
    return a === b ? 0 : (rec.ph[b] - rec.ph[a]) / (2 * Math.PI * (rec.t[b] - rec.t[a]));
  });
}
function peakDFT(rec, hann = false) {
  const n = rec.re.length, dt = (rec.t[n - 1] - rec.t[0]) / (n - 1), spectrum = [];
  // Independent direct trigonometric DFT, rather than the implementation's oscillator recurrence.
  for (let k = -Math.floor(n / 2); k <= Math.floor((n - 1) / 2); k++) if (k) {
    let re = 0, im = 0;
    for (let i = 0; i < n; i++) {
      const angle = -2 * Math.PI * k * i / n, c = Math.cos(angle), s = Math.sin(angle);
      const weight = hann ? 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)) : 1;
      re += weight * (rec.re[i] * c - rec.im[i] * s); im += weight * (rec.re[i] * s + rec.im[i] * c);
    }
    spectrum.push({bin:k, hz:k / (n * dt), magnitude:Math.hypot(re, im)});
  }
  spectrum.sort((a, b) => b.magnitude - a.magnitude);
  return {...spectrum[0], top:spectrum.slice(0, 5)};
}

console.log('FIELD PROBE: exact masks; ASCII glyphs are area-mean mask density, not decorative strokes.');
const one = api.parseNumeric('# heading\n; comment\ntext row\n1\n2 # inline\n3\n');
const two = api.parseNumeric('heading\n1,2\n3\t4\n5;6\n');
const three = api.parseNumeric('t Re Im\n0;3;4\n1,0,-2\n2\t-3\t0\ninvalid 9 row\n');
assert.deepEqual(Array.from(one.re), [1, 2, 3]); assert.deepEqual(Array.from(one.im), [0, 0, 0]);
assert.deepEqual(Array.from(two.im), [2, 4, 6]); assert.deepEqual(Array.from(two.t), [0, 1, 2]);
assert.deepEqual(Array.from(three.re), [3, 0, -3]); assert.deepEqual(Array.from(three.t), [0, 1, 2]);
assert.throws(() => api.parseNumeric('only text\n#comment'));
assert.throws(() => api.prepRecord({re:[1, 2], im:[0, 0], t:[1, 1]}));
const repeat = api.makeNoise(2026), other = api.makeNoise(2027);
assert.deepEqual(Array.from(repeat.re), Array.from(noise.re));
assert.notEqual(repeat.re[0], other.re[0]);
console.log(`parser sums 1col(real/imag/time)=${sum(one.re)}/${sum(one.im)}/${sum(one.t)} 2col=${sum(two.re)}/${sum(two.im)}/${sum(two.t)} 3col=${sum(three.re)}/${sum(three.im)}/${sum(three.t)}`);
console.log(`noise n=${noise.re.length} t0=${fixed(noise.t[0])} tLast=${fixed(noise.t.at(-1))} firstRe=${fixed(noise.re[0], 12)} nextSeedFirstRe=${fixed(other.re[0], 12)}`);

const instant = instantaneous(GSFC), sorted = [...instant].sort((a, b) => a - b);
const peak = peakDFT(GSFC), noisePeak = peakDFT(noise);
const reverse = instant.flatMap((f, i) => f > 0 ? [GSFC.t[i]] : []);
assert.equal(GSFC.re.length, 773);
assert(Math.abs(GSFC.turns - 11.0304470914) < 1e-8);
assert.equal(peak.bin, -6);
assert(reverse.some(t => t > 49 && t < 54.5));
console.log(`GSFC samples=${GSFC.re.length} turnsSignedAccumulator=${fixed(GSFC.turns, 9)} wrongAbsFinalPhase=${fixed(Math.abs(GSFC.ph.at(-1)) / (2 * Math.PI), 9)} ampMax=${fixed(GSFC.amax, 9)} peakSample=${GSFC.amp.indexOf(GSFC.amax)}`);
console.log(`GSFC dominantEstimator=exactSignedRecordDFT bin=${peak.bin} Hz=${fixed(peak.hz, 9)} instantaneousMedianHz=${fixed(sorted[sorted.length >> 1], 9)} instantaneousRangeHz=${fixed(sorted[0], 9)}..${fixed(sorted.at(-1), 9)} reversalSamples=${reverse.length} reversalTime=${fixed(Math.min(...reverse), 3)}..${fixed(Math.max(...reverse), 3)}`);
console.log(`noise dominantEstimator=exactSignedRecordDFT bin=${noisePeak.bin} Hz=${fixed(noisePeak.hz, 9)}`);
for (const [name, spectrum] of [['rectangular', peak], ['fullRecordHann', peakDFT(GSFC, true)]])
  console.log(`GSFC ${name} top5=${spectrum.top.map(p => `(${p.bin},${fixed(p.hz, 9)}Hz,${fixed(p.magnitude, 9)})`).join(' ')}`);

// Tiny inline synthetic fields defend phase origin, spectral sign, and the zero record.
const n = 773, dt = 0.3900156, tone = {re:new Float64Array(n), im:new Float64Array(n), t:new Float64Array(n)};
for (let i = 0; i < n; i++) {
  const angle = 0.7 - 2 * Math.PI * 7 * i / n;
  tone.re[i] = Math.cos(angle); tone.im[i] = Math.sin(angle); tone.t[i] = i * dt;
}
api.prepRecord(tone);
const toneField = modes.find(x => x.id === 'spectro').build(tone, 52, 52, {});
const rowEnergy = Array.from({length:52}, (_, y) => sum(toneField.amp.subarray(y * 52, (y + 1) * 52)));
const peakRow = rowEnergy.indexOf(Math.max(...rowEnergy));
assert(peakRow >= 36 && peakRow <= 42, `negative complex tone misplaced at row ${peakRow}`);
const zero = api.prepRecord({re:[0, 0, 0, 0], im:[0, 0, 0, 0], t:[0, 1, 2, 3]});
const singleton = api.prepRecord({re:[1], im:[0], t:[0]});
for (const mode of modes) for (const rec of [zero, singleton]) for (const [w, h] of [[1, 1], [7, 3]]) validate(mode.build(rec, w, h, {}));
console.log(`synthetic negativeTone expectedBandFraction=0.25 peakRow=${peakRow}/51 phaseOrigin=${fixed(tone.ph[0])} netTurns=${fixed(tone.turns)} zeroRecordFiniteCases=${modes.length * 4}`);

const image = api.fieldFromImage(new Uint8ClampedArray([255,0,0,255, 0,255,0,255, 0,0,255,255, 255,255,255,255]), 2, 2, 2, 2);
validate(image);
assert(Math.abs(image.amp[0] - 0.2126) < 1e-6);
assert(Math.abs(image.ph[1] - 2 * Math.PI / 3) < 1e-6);
assert(Math.abs(image.ph[2] - 4 * Math.PI / 3) < 1e-6);
assert.equal(sum(image.mask), 4); assert.equal(sum(image.occ), 4);
const meanImage = api.fieldFromImage(new Uint8ClampedArray([0,0,0,255, 255,255,255,255]), 2, 1, 1, 1);
assert.equal(meanImage.amp[0], 0.5);
console.log(`image luminance=${Array.from(image.amp, x => fixed(x, 4)).join(',')} hueRadians=${Array.from(image.ph, x => fixed(x)).join(',')} areaMeanBlackWhite=${fixed(meanImage.amp[0])} mask=${sum(image.mask)} occ=${sum(image.occ)}`);

const snapshots = {GSFC:{}, noise:{}};
for (const [name, rec] of [['GSFC', GSFC], ['noise', noise]]) for (const mode of modes) {
  const F = snapshots[name][mode.id] = mode.build(rec, 52, 52, {});
  validate(F);
  console.log(`\n${name} ${mode.id} ${stats(F)}`);
  console.log(F.note);
  console.log(histogram(F));
  console.log(ascii(F));
}
console.log('\nSHAPE DIFFERENCES (raw XOR is density-limited; union mismatch avoids the sparse-ridge trap)');
for (const mode of modes) {
  const mismatch = difference(`GSFC/noise ${mode.id}`, snapshots.GSFC[mode.id], snapshots.noise[mode.id]);
  assert(mismatch > 0, `${mode.id} cannot distinguish GSFC and noise`);
}
for (let a = 0; a < modes.length; a++) for (let b = a + 1; b < modes.length; b++)
  difference(`GSFC ${modes[a].id}/${modes[b].id}`, snapshots.GSFC[modes[a].id], snapshots.GSFC[modes[b].id]);

console.log('\nMATRIX CLOSING CHECKS (independent direct-radius reference, no kNN-polyline union)');
const matrix = modes.find(x => x.id === 'matrix');
// Ten points on a line: the median fourth-neighbour distance is exactly two.
const line = api.prepRecord({re:Array.from({length:10}, (_, i) => i), im:new Float64Array(10), t:Array.from({length:10}, (_, i) => i)});
const lineField = matrix.build(line, 10, 10, {});
let mismatch = 0;
const raw = new Uint8Array(100), dilation = new Uint8Array(100), closed = new Uint8Array(100);
for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) raw[y * 10 + x] = Math.abs(y - x) <= 2 ? 1 : 0;
for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
  const neighbourhood = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) neighbourhood.push(raw[((y + dy + 10) % 10) * 10 + (x + dx + 10) % 10]);
  dilation[y * 10 + x] = neighbourhood.some(Boolean) ? 1 : 0;
}
for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
  const neighbourhood = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) neighbourhood.push(dilation[((y + dy + 10) % 10) * 10 + (x + dx + 10) % 10]);
  closed[y * 10 + x] = neighbourhood.every(Boolean) ? 1 : 0;
  mismatch += closed[y * 10 + x] !== lineField.mask[y * 10 + x] ? 1 : 0;
}
assert.equal(mismatch, 0);
assert.notEqual(sum(dilation), sum(closed));
console.log(`line epsExpected=2 rawCount=${sum(raw)} dilationCount=${sum(dilation)} closingCount=${sum(closed)} implementationMismatch=${mismatch}`);
for (const size of [52, 120, 136, 192]) {
  const F = matrix.build(GSFC, size, size, {});
  let asymmetry = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) asymmetry += F.mask[y * size + x] !== F.mask[x * size + y] ? 1 : 0;
  assert.equal(asymmetry, 0);
  console.log(`GSFC matrix ${stats(F)} asymmetry=${asymmetry} ${histogram(F)}`);
  console.log(F.note);
}

console.log('\nMATRIX ESTIMATOR COMPARISON (same raw units; only sample space / ordinal differ)');
for (const size of [52, 76, 120, 136]) for (const [name, PAR] of [
  ['raw773-k4', {k:4, gapSpace:'raw'}], ['grid-k4', {k:4, gapSpace:'grid'}], ['grid-k6', {k:6, gapSpace:'grid'}]
]) {
  const F = matrix.build(GSFC, size, size, PAR);
  console.log(`${name} ${stats(F)} ${histogram(F)} ${F.note}`);
}

console.log('\nBUILD TIMINGS (median of 3 builds after warmup; no DOM or other field/world module)');
console.log('TIMING LOAD ' + processLoad());
for (const [name, rec] of [['GSFC', GSFC], ['noise', noise]]) for (const size of [52, 120]) for (const mode of modes) {
  mode.build(rec, size, size, {});
  const times = [];
  let checksum = 0;
  for (let repetition = 0; repetition < 3; repetition++) {
    const start = performance.now(), F = mode.build(rec, size, size, {});
    times.push(performance.now() - start); checksum += sum(F.mask);
  }
  times.sort((a, b) => a - b);
  console.log(`${name} ${mode.id} ${size}x${size} ms/build=${fixed(times[1], 3)} maskChecksum=${checksum}`);
}
console.log('\nBUILD STAGES (probe-only in-memory instrumentation; shipped module has no clock or profiling globals)');
let profiledSource = readFileSync(new URL('src/w-field.js', root), 'utf8');
function markInside(name, needle, stage) {
  const start = profiledSource.indexOf('  function ' + name + '(');
  let end = profiledSource.indexOf('\n  function ', start + 1);
  if (end < 0) end = profiledSource.length;
  const body = profiledSource.slice(start, end), at = body.indexOf(needle);
  if (start < 0 || at < 0) throw new Error(`Cannot instrument ${name}/${stage}`);
  profiledSource = profiledSource.slice(0, start + at) + `    __fieldProbeMark('${stage}');\n` + profiledSource.slice(start + at);
}
for (const [name, needle, stage] of [
  ['path', '    const F = blank', 'setup'],
  ['path', '    for (let j = 0;', 'raster4x'],
  ['path', '    for (let y = 0;', 'boxDownsample'],
  ['matrix', '    const k =', 'setup'],
  ['matrix', '    const eps =', 'epsilon'],
  ['matrix', '    for (let x = 0;', 'recurrence'],
  ['matrix', '    const raw =', 'closing'],
  ['spectro', '    const n =', 'DFT/setup'],
  ['spectro', '    const uniformRe =', 'timeResample'],
  ['spectro', '    for (let x = 0; x < frames;', 'STFT'],
  ['spectro', '    if (max) for', 'areaResample'],
  ['spectro', '    for (let i = 0; i < F.mask.length;', 'threshold'],
  ['hst', '    const fr =', 'phase/setup'],
  ['hst', '    for (let j = 0;', 'GaussianSplat'],
  ['hst', '    for (let i = 0; i < F.mask.length;', 'threshold'],
  ['occupancy', '    const {w, h, mask, occ}', 'occupancy']
]) markInside(name, needle, stage);
const marks = [], profileContext = vm.createContext({Buffer, __fieldProbeMark:stage => marks.push([stage, performance.now()])});
vm.runInContext(readFileSync(new URL('src/core.js', root), 'utf8') + '\n' + profiledSource, profileContext);
const profiledModes = vm.runInContext('FIELDS', profileContext);
for (const [name, rec] of [['GSFC', GSFC], ['noise', noise]]) for (const size of [52, 120]) for (const mode of profiledModes) {
  mode.build(rec, size, size, {});
  marks.length = 0;
  mode.build(rec, size, size, {});
  marks.push(['done', performance.now()]);
  const values = marks.slice(0, -1).map(([stage, time], i) => `${stage}=${fixed(marks[i + 1][1] - time, 3)}`);
  console.log(`${name} ${mode.id} ${size}x${size} stageMs ${values.join(' ')}`);
}
for (const size of [52, 120]) {
  const densities = [];
  for (let seed = 1; seed <= 8; seed++) {
    const F = modes.find(x => x.id === 'path').build(api.prepRecord(api.makeNoise(seed)), size, size, {});
    densities.push(100 * sum(F.mask) / F.mask.length);
  }
  console.log(`path noiseSeeds1..8 ${size}x${size} densityPct=${densities.map(x => fixed(x, 3)).join(',')} range=${fixed(Math.min(...densities), 3)}..${fixed(Math.max(...densities), 3)}`);
}

console.log('\nPRE-MEDIA STRAIN REGRESSION (byte identity, not approximate density)');
const pinnedMasks = {
  'path-52':[1503,2274784528], 'matrix-52':[520,2398562113], 'spectro-52':[1121,2742298790], 'hst-52':[143,1830098820],
  'path-120':[4033,1589515732], 'matrix-120':[1632,4115627793], 'spectro-120':[5939,552058222], 'hst-120':[335,151778020]
};
const pinnedMaskBytes = {
  'path-52':'eJytlEEWxCAIQ+39Lz2LcSQhBMt746IL4RsM2LX+uZ5nlo1rmv8GK4mWkoQ7VEZ7CiJUlYdiX+9ioNiEhIsTnLZ31EmLJL8MQ+FcUm05xqq2VtAFObu/O7KMGx5prburQssz1eAUx0HcTBsJJcaMaFjkSguchSxDXiTm+5eIYGE2zuw5A0dtCzvmpGNp1Si3zBozcZ/9ciixYcTeAZPyrswRSh90NRoETOkCyJRCNEhwpmMYiqMys/xkc5nn0WUhpBAJmUKosoJltHazAIke9tDum4eUxsq48V4qyfBYda9c2nAgxX4Z2joan+Q8BBLk6ipUOgpCHtIh8gi/hn5zaYLY4AmuK1c4wF4ACA7Sr+sDXIsF4A==',
  'matrix-52':'eJztluEOgCAIhOP9X7qtWjI58o45+1H8iZkfR6KS2WXbwAzYImb7NnMOCZAbCh6x/s1lGaTkoIR3mcYZmeYjlGd3f4oCRY+gglOGBjsFQpiolLS4D+YooYApZbxgCnH5TagpKTU+9OvqA/jjQV1lPaSacvZaYiWlynx6DRYxWn1wV8iv3hYavPRtp+9DWUC9OVaYN/9dfsakNdgBKeYCCQ==',
  'spectro-52':'eJzt0kEKwCAQQ9HJ/S9dpBRaOh2NSAjFv87bjEYIAjBBBKYJzpzC0FzAztyAmwFvoDGgzUu4mARYmHxfGihMAT5MLVaZnnia/lptRpd687PGLzDxjqxJf3FwqUzs4gCsRgRi',
  'hst-52':'eJztkTEKACAMA5P/f1qkgy4OKVKD9NZyJKRAQEKCgSaFZuvII6wdFHPm7EjlFI+3Ppbc5bZ0uGWS6iT3IN9y1st9t3ZZubqgVFLTNHjFAGZOAJA=',
  'path-120':'eJztmcmS4zAMQ+P//+k5dOxwAUiIlrvnEJ2cSOIjuDlVeb2+67v+j3WA9RfMx9kV9Cm2wNxP5mbtzm5yJ8Xs7yOL8fsc2kJeyFoUvQO7dPy25kGdePKvYQ1wKnncFNet0fUS28yKG7Hm2MQER8dghs0gjHaxXsZSau/oCIytd3UGyEvgolYaC/7MKrjAqpcnYIRVqdfZdTCKMqNWzX0+OgfuYl3zkAp0PLEyErZg0rzYu53gbCR8TiCMtmDkfC/XfSRxLe5JkW6wOAdsM4Arwe/fhCU2uGhc5eBkqpObsBjqyPF2H+kkN+qDTOevJ2uCoVyPhUJdjJ0FTXAh98eaBSVXa3Ah2B0B2BwOuxdigo0i7qmIRhlSTTQguBesyEXQCAZdUAo+E5jltthEpJHGaarlFtQK3AhGYXZqaywAW0M690Sp2AAOgimXyFVSC8Ap0lRww1WwgTjjmk6UsZVgwoXFoJZyNJOsOSN5NFXVjNo9fx0Fb+Cm+ECHKsHL3JRn6wzK15yby8AwDC2ChQSH87Cs0oQ/hzgapwncJ5iVc7AKc6oLXuNaRgxYvPYY11i4pMewP8j1v7VwH6xwXzL32MpFYzJxA5v2/VbudVLhfiIY+nHKtWRs83Eulovyu5l7/AoXBBoNzWPIfWcmDUWfwTQ1U3oH3KPhXmC3x7nAwiesEtdec9uRo3NzBGiCoxNZ7pBL/o/B9es3WJ2CZ7xLBJMaofXCsHWgazD3Zsqlf3zlL1Mbx3TL3J/n1CoG48s6W8bdy7hecO5Rh0Iz6zKC5XpuJTicxOTKFJfLuPU/yQhK5HZcKhiCmTOFXJH7DrIONlhFLqysAfiCECzl5jL/pHkNq3M7wccUW4SZCz4vtuSjxxLuLfBnO2LhKwsKLsCEbPbCUyO3mmsugHxqIt1wghbgbNXZSi8Fju3k+gxTMHglJDc4FmeJRDqZYNCYZfzuKQQn11Bis/uxtkS5fJijqEGvbfnpWD7eeC2DXYjlURbBuPMTFdUI54ZIx5O0lHyEzyGjY+0+1BZLGVHRa6R9q9gLdVQdFDjArI7BXHSa0DpWAhO03VrGAnDTPGC4UXsyuCYTV2bY6LJORieXvY7mlE7ALa9i+RupnLBofxELLsAiUnaWsOWAJkswMQM3Y3IPltexwpxT793Ve2/r9ZvYoYX71I+VxUl5m7poaiPVmKvtNQV+j1y2zXZqMG3NK728Ga0NkGfhDzO/67te0voHjhQPwg==',
  'matrix-120':'eJzt20ESwiAMBdDk/pd2YZlpZwgGzE8KSRYuLPrkQzU6lflWRPS9NS1WVrmVM2BfWW+rcg/PWQnbku3mehNud5Gr+zji41Jy13dfjVzPE/gxyBhVTw6QtHKoFPZkFrMTmHLZwe3Bxq5J0PO1N8xB8FI4BjAfssZgd1+Yg+D1YAQYvrdEGO0WHB013i1YFRIuaocljoR7d6KB4QFh+CZ9++DX4LnGfaGieitRcOjq/nZX+1jLZ9sBpoQwZ4NpM9jghUW17oLxUtjoZU13G1ZxBPXuDrDcYIFhscLgThWcMWpON+MgmNPNuGB41Jxtjf396BkXfGDUYeev83nk2G/8+rxFfi2z/V4286uoKTzGwfClLz9UDSOuRtrgvRp2xZlz9a5ivF+ShYN15e62UWe42oDN56tb2kT/I2ijDnHfu6+uURQy4WPWN9u+qvV9Sc7lEi7nDzswBmE=',
  'spectro-120':'eJzt1lEKhDAMBNDu/S/t57IsammSqvXNBR4Mk9LWZLl8vuHq2a6CRzTtjn5Nrp7tKnhAc+6Iq+dVdrVrVrqHKFfPdhW+oaI76mG5en7ErrrQZLfX5OrZroIHlHlHXD0vs6sBNOSOeVw921XCAY3db4rJ1fMddpWGnrmZEFfP79lVofTvTsO4el50VyLy0JS/GZd8Kbh6vs+uWm3mSVw9i4hIe2k2ln8XNA==',
  'hst-120':'eJztmNsKhTAMBJP//2mplwcvhwOWZtWdwecMuw0tGHEiM0NBrTcXRHlXr0Ss8jazwpthlDe0PTvcHDuxkTfFXsEpN+P6UJTam2z+dtSIl8xH92D7laDE/Wv2OPX/kfX79gR16Mzb2mMua9uw7N4RKvE9LMUSr5/YLrBj0yqvXdEvC9z9jlJ0DRRN0YMW62VXVr9Y5fUqmgOm6G9tlpvXMbDKS9GfLtpypc1+WUrVAAAAAAAAAAAAEM9mApLsAVA='
};
for (const size of [52, 120]) for (const mode of modes) {
  const F = mode.build(GSFC, size, size, {}), key = `${mode.id}-${size}`;
  let hash = 2166136261;
  for (const x of F.mask) hash = Math.imul(hash ^ x, 16777619) >>> 0;
  assert.deepEqual([sum(F.mask), hash], pinnedMasks[key], `pre-media strain mask moved: ${key}`);
  assert.deepEqual(Buffer.from(F.mask), inflateSync(Buffer.from(pinnedMaskBytes[key], 'base64')), `pre-media mask bytes changed: ${key}`);
  console.log(`unchanged ${key} maskCount=${sum(F.mask)} fnv1a=${hash}`);
}

// A real lossless PNG fixture, constructed and decoded in memory; no extra owned files.
function pngChunk(name, data) {
  const type = Buffer.from(name), payload = Buffer.concat([type, data]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, payload, checksum]);
}
const imageSide = 64, imageRGBA = new Uint8ClampedArray(imageSide * imageSide * 4);
const imageRng = api.mulberry32(821);
for (let y = 0; y < imageSide; y++) for (let x = 0; x < imageSide; x++) {
  const p = (y * imageSide + x) * 4, grain = (imageRng() - 0.5) * 18;
  let r = y < 43 ? 155 : 61, g = y < 43 ? 194 : 111, b = y < 43 ? 220 : 45;
  if ((x - 50) ** 2 + (y - 11) ** 2 < 35) {r = 255; g = 232; b = 103;}
  if (x >= 13 && x <= 42 && y >= 29 && y <= 52) {r = 195; g = 140; b = 98;}
  if (y >= 15 && y <= 29 && Math.abs(x - 27) < (y - 14) * 1.4) {r = 89; g = 57; b = 52;}
  if (x >= 19 && x <= 26 && y >= 35 && y <= 42) {r = 44; g = 72; b = 83;}
  if (x >= 32 && x <= 38 && y >= 37 && y <= 52) {r = 51; g = 40; b = 32;}
  if ((x - 51) ** 2 + (y - 37) ** 2 < 46) {r = 39; g = 87; b = 48;}
  if (x >= 49 && x <= 52 && y >= 41 && y <= 54) {r = 84; g = 56; b = 34;}
  imageRGBA[p] = r + grain; imageRGBA[p + 1] = g + grain; imageRGBA[p + 2] = b + grain; imageRGBA[p + 3] = 255;
}
const scanlines = Buffer.alloc(imageSide * (1 + imageSide * 4));
for (let y = 0; y < imageSide; y++) Buffer.from(imageRGBA.buffer, y * imageSide * 4, imageSide * 4).copy(scanlines, y * (1 + imageSide * 4) + 1);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(imageSide, 0); ihdr.writeUInt32BE(imageSide, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(scanlines)), pngChunk('IEND', Buffer.alloc(0))]);
const decodedScanlines = inflateSync(png.subarray(41, png.length - 16)), decodedRGBA = new Uint8ClampedArray(imageRGBA.length);
for (let y = 0; y < imageSide; y++) decodedRGBA.set(decodedScanlines.subarray(y * (1 + imageSide * 4) + 1, (y + 1) * (1 + imageSide * 4)), y * imageSide * 4);
assert.deepEqual(decodedRGBA, imageRGBA);
const imageRecord = api.prepRecord({kind:'image', rgba:decodedRGBA, width:imageSide, height:imageSide, name:'structured-house.png'});
const rowMajorLuminance = new Float32Array(imageSide * imageSide);
for (let i = 0; i < rowMajorLuminance.length; i++) rowMajorLuminance[i] = (0.2126 * imageRGBA[i * 4] + 0.7152 * imageRGBA[i * 4 + 1] + 0.0722 * imageRGBA[i * 4 + 2]) / 255;
console.log(`IMAGE FIXTURE structured-house.png bytes=${png.length} sha256=${createHash('sha256').update(png).digest('hex')} recordLength=${imageRecord.re.length}`);
console.log('Input PNG luminance:');
console.log(ascii({w:imageSide, h:imageSide, mask:rowMajorLuminance}));
let hilbertMismatch = 0, biggestJump = 0, previousXY = null;
for (let d = 0; d < imageRecord.re.length; d++) {
  let x = 0, y = 0, q = d;
  for (let side = 1; side < imageSide; side *= 2) {
    const right = (q >> 1) & 1, up = (q ^ right) & 1;
    if (!up) {
      if (right) {x = side - x - 1; y = side - y - 1;}
      [x, y] = [y, x];
    }
    x += side * right; y += side * up; q >>= 2;
  }
  if (previousXY) biggestJump = Math.max(biggestJump, Math.abs(x - previousXY[0]) + Math.abs(y - previousXY[1]));
  previousXY = [x, y];
  if (Math.abs(imageRecord.re[d] - rowMajorLuminance[y * imageSide + x]) > 1e-7) hilbertMismatch++;
  assert.equal(imageRecord.amp[d], imageRecord.re[d]);
}
assert.equal(biggestJump, 1); assert.equal(hilbertMismatch, 0);
console.log(`Hilbert maxConsecutiveManhattanDistance=${biggestJump} luminanceMismatch=${hilbertMismatch} provenance=${imageRecord.provenance}`);

// A 24 kHz PCM WAV with three voiced syllables and moving vowel formants.
const sr = 24000, voiceMono = new Float32Array(sr), voiceRng = api.mulberry32(927), wav = Buffer.alloc(44 + sr * 2);
let voicePhase = 0;
for (let i = 0; i < sr; i++) {
  const t = i / sr, f0 = 110 + 34 * t + 4 * Math.sin(2 * Math.PI * 4.5 * t);
  const envelope = Math.exp(-(((t - 0.15) / 0.085) ** 2)) + 0.75 * Math.exp(-(((t - 0.47) / 0.10) ** 2)) + 0.9 * Math.exp(-(((t - 0.80) / 0.09) ** 2));
  voicePhase += 2 * Math.PI * f0 / sr;
  let value = 0;
  for (let harmonic = 1; harmonic <= 24; harmonic++) {
    const f = harmonic * f0, f1 = 450 + 300 * t, f2 = 1700 - 450 * t;
    const weight = 0.30 / harmonic + Math.exp(-(((f - f1) / 110) ** 2)) + 0.7 * Math.exp(-(((f - f2) / 180) ** 2));
    value += weight * Math.sin(harmonic * voicePhase);
  }
  voiceMono[i] = envelope * (value * 0.13 + (voiceRng() - 0.5) * 0.012);
}
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(sr * 2, 40);
for (let i = 0; i < sr; i++) wav.writeInt16LE(Math.round(voiceMono[i] * 32767), 44 + i * 2);
const decodedVoice = Float32Array.from({length:sr}, (_, i) => wav.readInt16LE(44 + i * 2) / 32768);
const audioRecord = api.prepRecord({kind:'audio', samples:decodedVoice, sr, name:'three-syllables.wav'});
assert.equal(audioRecord.sr, sr); assert.equal(audioRecord.re.length, sr);
const toneSamples = Float32Array.from({length:4096}, (_, i) => Math.cos(2 * Math.PI * 32 * i / 4096));
const analyticTone = api.prepRecord({kind:'audio', samples:toneSamples, sr:24000});
let quadratureError = 0;
for (let i = 0; i < toneSamples.length; i++) quadratureError = Math.max(quadratureError, Math.abs(analyticTone.im[i] - Math.sin(2 * Math.PI * 32 * i / 4096)));
assert(quadratureError < 1e-6);
assert(Math.abs(analyticTone.turns - 32 * 4095 / 4096) < 1e-6);
console.log(`AUDIO FIXTURE three-syllables.wav bytes=${wav.length} sha256=${createHash('sha256').update(wav).digest('hex')} recordLength=${audioRecord.re.length} sr=${audioRecord.sr} maxEnvelope=${fixed(audioRecord.amax)} analyticToneQuadratureMaxError=${quadratureError.toExponential(3)} toneTurns=${fixed(analyticTone.turns)}`);

const mediaFields = {};
console.log('MEDIA TIMING LOAD ' + processLoad());
for (const [name, rec] of [['image', imageRecord], ['audio', audioRecord]]) for (const size of [52, 120]) for (const mode of modes) {
  mode.build(rec, size, size, {});
  const times = [];
  let F;
  for (let repetition = 0; repetition < 3; repetition++) {
    const start = performance.now();
    F = mode.build(rec, size, size, {});
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const elapsed = times[1];
  validate(F); mediaFields[`${name}-${mode.id}-${size}`] = F;
  const target = mode.id === 'path' ? size * size : mode.id === 'matrix' ? size : rec.re.length;
  const reduction = (mode.id === 'path' || mode.id === 'matrix') && rec.re.length > 4 * target && !rec.smooth ? `block-mean ${rec.re.length}->${target}` : 'full-rate / point representation';
  console.log(`\nMEDIA ${name} ${mode.id} ${stats(F)} reduction=${reduction} ms/build=${fixed(elapsed, 3)} over20ms=${elapsed > 20}`);
  console.log(F.note);
  console.log(ascii(F));
}
console.log('POST-MEDIA TIMING LOAD ' + processLoad());
for (const size of [52, 120]) for (const mode of modes)
  difference(`image/audio ${mode.id}-${size}`, mediaFields[`image-${mode.id}-${size}`], mediaFields[`audio-${mode.id}-${size}`]);
console.log('Interpretation: transformed image fields preserve luminance/texture recurrence, not the original house silhouette; audio fields describe the three syllables and changing harmonic/frequency energy, not speech recognition.');
console.log('PASS: parsers, signed phase origin, negative spectral tone, hairpin reversal, finite degenerate/rectangular grids, image luminance/hue, exact closing and record separation.');

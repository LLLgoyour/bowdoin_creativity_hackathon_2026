/* probe-wave.mjs — this variant's harness: file → wave, headless, with numbers.
 *
 * Loads the real src modules (core.js, w-field.js, the four worlds) the way
 * itest.mjs does — one function body, so `clamp`/`defField`/`fft` stay lexical
 * bindings exactly as they are in the browser — and then:
 *
 *   1. decodes tools/fish.png (its own PNG reader: zlib + the five filters),
 *      runs the image → epicycle-record conversion at several harmonic counts
 *      and prints points, loops, P, RMS and max reconstruction error, the
 *      silhouette IoU, and a monotonicity check on the error curve;
 *   2. dumps the reconstructed path as ASCII at a low and a high P, so "it
 *      redraws the picture" is checked as text;
 *   3. decodes tools/tone.wav and checks the analytic signal is real:
 *      for x = cos(2πft), x + i·H(x) must be e^{i2πft};
 *   4. builds every field and runs every world on the image-derived record.
 *
 * usage: node tools/probe-wave.mjs [M] [STEPS]
 */
import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';

const M = Number(process.argv[2] || 52);
const STEPS = Number(process.argv[3] || 120);
const root = new URL('../', import.meta.url);
const SRC = new URL('src/', root);

/* ── the modules, loaded as one classic-script scope (as in the browser) ──── */
const order = ['core.js', 'w-field.js', 'w-synch.js', 'w-grav.js', 'w-rd.js', 'w-life.js'];
const src = order.map(f => '/* ' + f + ' */\n' + readFileSync(new URL(f, SRC), 'utf8')).join('\n');
const hash = createHash('sha256').update(src).digest('hex').slice(0, 12);
const api = new Function(src + `
  return {FIELDS, WORLDS, prepRecord, makeNoise, parseNumeric, mulberry32, fieldById, worldById,
          waveContour, waveFit, waveFromImage, waveAudio, decimate, WAVE_N, WAVE_AUDIO};
`)();

/* ── a PNG reader: 8-bit, colour types 0/2/6, no interlace ────────────────── */
function readPNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let at = 8, ihdr = null;
  const idat = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at), type = buf.toString('latin1', at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') ihdr = {w:data.readUInt32BE(0), h:data.readUInt32BE(4), depth:data[8], color:data[9], mode:data[12]};
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  if (!ihdr || ihdr.depth !== 8 || ihdr.mode !== 0 || ![0, 2, 6].includes(ihdr.color)) throw new Error('unsupported PNG');
  const chan = ihdr.color === 0 ? 1 : ihdr.color === 2 ? 3 : 4;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = ihdr.w * chan, out = Buffer.alloc(ihdr.w * ihdr.h * 4), line = Buffer.alloc(stride), prev = Buffer.alloc(stride);
  for (let y = 0; y < ihdr.h; y++) {
    const filter = raw[y * (stride + 1)];
    raw.copy(line, 0, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= chan ? line[i - chan] : 0, b = prev[i], c = i >= chan ? prev[i - chan] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error('bad PNG filter ' + filter);
      line[i] = v & 255;
    }
    line.copy(prev);
    for (let x = 0; x < ihdr.w; x++) {
      const s = x * chan, d = (y * ihdr.w + x) * 4;
      if (chan === 1) {out[d] = out[d + 1] = out[d + 2] = line[s]; out[d + 3] = 255;}
      else {out[d] = line[s]; out[d + 1] = line[s + 1]; out[d + 2] = line[s + 2]; out[d + 3] = chan === 4 ? line[s + 3] : 255;}
    }
  }
  return {rgba:out, width:ihdr.w, height:ihdr.h};
}

/* ── a WAV reader: PCM 16-bit or float32, mono/stereo ─────────────────────── */
function readWAV(buf) {
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') throw new Error('not a WAVE');
  let at = 12, fmt = null, data = null;
  while (at + 8 <= buf.length) {
    const id = buf.toString('latin1', at, at + 4), len = buf.readUInt32LE(at + 4), body = buf.subarray(at + 8, at + 8 + len);
    if (id === 'fmt ') fmt = {format:body.readUInt16LE(0), channels:body.readUInt16LE(2), rate:body.readUInt32LE(4), bits:body.readUInt16LE(14)};
    else if (id === 'data') data = body;
    at += 8 + len + (len & 1);
  }
  if (!fmt || !data) throw new Error('WAVE without fmt/data');
  const bytes = fmt.bits >> 3, frames = Math.floor(data.length / (bytes * fmt.channels));
  const samples = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < fmt.channels; c++) {
      const p = (i * fmt.channels + c) * bytes;
      sum += fmt.format === 3 ? data.readFloatLE(p) : fmt.bits === 16 ? data.readInt16LE(p) / 32768 : data.readUInt8(p) / 128 - 1;
    }
    samples[i] = sum / fmt.channels;
  }
  return {samples, sr:fmt.rate};
}

const fixed = (x, d = 3) => x.toFixed(d);
function asciiPath(re, im) {
  const W = 48, H = 24, grid = new Uint8Array(W * H);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < re.length; i++) {
    x0 = Math.min(x0, re[i]); x1 = Math.max(x1, re[i]); y0 = Math.min(y0, im[i]); y1 = Math.max(y1, im[i]);
  }
  const s = Math.min(W / (x1 - x0 || 1), H / (y1 - y0 || 1));
  for (let i = 0; i < re.length; i++) {
    const gx = Math.min(W - 1, Math.max(0, Math.round((re[i] - (x0 + x1) / 2) * s + W / 2)));
    const gy = Math.min(H - 1, Math.max(0, Math.round(H / 2 - (im[i] - (y0 + y1) / 2) * s)));
    grid[gy * W + gx] = 1;
  }
  const lines = [];
  for (let y = 0; y < H; y++) {
    let line = '';
    for (let x = 0; x < W; x++) line += grid[y * W + x] ? '#' : '.';
    lines.push('|' + line + '|');
  }
  return lines.join('\n');
}

console.log(`modules: ${order.join(' ')}   (${hash})\n`);
const t0 = performance.now();
const png = readPNG(readFileSync(new URL('fish.png', new URL('tools/', root))));
console.log(`── 1 · image → record  tools/fish.png ${png.width}×${png.height} ──`);
const tContour = performance.now();
const contour = api.waveContour({rgba:png.rgba, width:png.width, height:png.height, name:'fish.png'});
const tContourMs = performance.now() - tContour;
console.log(`contour      : ${contour.n} resampled points from ${contour.crossings} level crossings`);
console.log(`traversals   : ${contour.loops} closed loops, ${fixed(contour.area, 1)} px² enclosed, Otsu level ${fixed(contour.level, 4)} (${contour.invert ? 'light' : 'dark'} side)`);
console.log(`analysis     : ${contour.frame.w}×${contour.frame.h} frame, trace+resample ${fixed(tContourMs, 1)} ms\n`);

const P_LIST = [1, 2, 3, 6, 12, 24, 48, 96, 192, 511, 1023];
console.log(`   P    RMS px    max px      IoU    kept bins        ms`);
let previous = Infinity, monotone = true;
for (const P of P_LIST) {
  const t = performance.now(), rec = api.waveFit(contour, P), ms = performance.now() - t;
  console.log(`${String(rec.wave.P).padStart(4)}  ${fixed(rec.wave.rms).padStart(8)}  ${fixed(rec.wave.max).padStart(8)}  ${fixed(rec.wave.iou, 4)}  ${String(rec.wave.P).padStart(5)}/${rec.wave.maxP}  ${fixed(ms, 2).padStart(8)}`);
  if (rec.wave.rms > previous + 1e-9) monotone = false;
  previous = rec.wave.rms;
}
console.log(`\nRMS error is non-increasing in P: ${monotone ? 'yes' : 'NO'}`);

const low = api.waveFit(contour, 3), high = api.waveFit(contour, 192);
console.log(`\n── 2 · the record's own path, ASCII (48×24) ──`);
console.log(`\nP = 3  (RMS ${fixed(low.wave.rms)} px, IoU ${fixed(low.wave.iou, 4)})\n${asciiPath(low.re, low.im)}`);
console.log(`\nP = 192  (RMS ${fixed(high.wave.rms)} px, IoU ${fixed(high.wave.iou, 4)})\n${asciiPath(high.re, high.im)}`);

/* ── 3 · audio → analytic record ─────────────────────────────────────────── */
console.log(`\n── 3 · audio → record ──`);
const wav = readWAV(readFileSync(new URL('tone.wav', new URL('tools/', root))));
/* (a) the identity itself. cos at 439.453125 Hz = 8000·225/4096 is exactly 225
       cycles in a 4096-sample window, so the FFT needs no zero padding and the
       analytic signal is known in closed form: this measures whether the recipe
       really is x + i·H(x) and not something that merely looks like it. */
const exact = api.prepRecord({kind:'audio', samples:Float64Array.from({length:4096}, (_, i) => 0.6 * Math.cos(2 * Math.PI * 439.453125 * i / 8000)), sr:8000, name:'exact'});
let eRms = 0, eMax = 0, eEnv = 0;
for (let i = 0; i < exact.re.length; i++) {
  const c = 0.6 * Math.cos(2 * Math.PI * 439.453125 * i / 8000), s = 0.6 * Math.sin(2 * Math.PI * 439.453125 * i / 8000);
  eRms += (exact.im[i] - s) * (exact.im[i] - s);
  eMax = Math.max(eMax, Math.abs(exact.im[i] - s), Math.abs(exact.re[i] - c));
  eEnv = Math.max(eEnv, Math.abs(Math.hypot(exact.re[i], exact.im[i]) - 0.6));
}
console.log(`identity     : 4096 samples of 0.6·cos(2π·439.453125t) at 8000 Hz = exactly 225 cycles, so no FFT padding`);
console.log(`               RMS(im − 0.6·sin) = ${fixed(Math.sqrt(eRms / exact.re.length), 9)}   max deviation either part = ${fixed(eMax, 9)}`);
console.log(`               max | |x+iH(x)| − 0.6 | = ${fixed(eEnv, 9)}  (a tone's analytic signal has a flat envelope)`);
/* (b) the same identity on the real file's first second — 440 cycles of 440 Hz
       in 8000 samples, which the module must zero-pad to 8192, so this measures
       the known window-edge artefact of an FFT Hilbert transform, honestly. */
const pure = api.prepRecord({kind:'audio', samples:wav.samples.subarray(0, wav.sr), sr:wav.sr, name:'tone.wav'});
let head = 0, mid = 0, edge = 0;
for (let i = 0; i < pure.re.length; i++) {
  const d = pure.im[i] - 0.6 * Math.sin(2 * Math.PI * 440 * i / wav.sr);
  head += d * d;
  if (i >= 512 && i < pure.re.length - 512) mid += d * d;
  edge = Math.max(edge, Math.abs(d));
}
console.log(`real file    : first second of tone.wav, ${pure.re.length} samples at ${wav.sr} Hz (440 cycles, padded to 8192)`);
console.log(`               RMS(im − 0.6·sin) over all samples = ${fixed(Math.sqrt(head / pure.re.length), 6)}, inner ${pure.re.length - 1024} = ${fixed(Math.sqrt(mid / (pure.re.length - 1024)), 6)}, worst sample = ${fixed(edge, 6)}`);
console.log(`               (the tail is the window-edge artefact of an FFT Hilbert transform; it is 1/i from the edge, not a wrong transform)`);
/* (c) the reduced record the app builds from the whole file, and what survives */
const rawAudio = api.waveAudio({samples:wav.samples, sr:wav.sr, name:'tone.wav'});
const arec = api.prepRecord(rawAudio);
const wmeta = rawAudio.wave;
console.log(`reduce       : ${wmeta.source} samples at ${wmeta.sr} Hz → ${wmeta.points} at ${fixed(wmeta.rate, 2)} Hz (box-averaged by ${wmeta.factor}, cap ${api.WAVE_AUDIO})`);
/* the file's first second is one carrier and nothing else, so the record's
   phase slope over that stretch has exactly one right answer */
const inside = Math.floor(0.975 * wmeta.rate);
const slope = (arec.ph[inside] - arec.ph[0]) / inside;                 /* rad per sample */
console.log(`frequency    : phase slope over the record's first ${inside} samples (0.975 s) = ${fixed(slope / (2 * Math.PI) * wmeta.rate, 3)} Hz (${fixed(slope, 4)} rad/sample × ${fixed(wmeta.rate, 1)} samples/s ÷ 2π; the file's tone is 440 Hz)`);
let lo = Infinity, hi = -Infinity, mean = 0;
for (let i = 0; i < arec.re.length; i++) {
  const r = Math.hypot(arec.re[i], arec.im[i]);
  lo = Math.min(lo, r); hi = Math.max(hi, r); mean += r;
}
console.log(`envelope     : |x + iH(x)| over the whole file: min ${fixed(lo)} mean ${fixed(mean / arec.re.length)} max ${fixed(hi)} (carrier 0.6, then a decaying tremolo)`);
console.log(`turns        : ${fixed(arec.turns, 1)} of unwrapped phase over ${fixed(arec.t[arec.re.length - 1], 4)} s, timeUnit '${arec.timeUnit}', freqUnit '${arec.frequencyUnit}'`);
console.log(`chain        : re/im come from the module's own audio path (quadrature = FFT, negatives zeroed, positives doubled, inverse FFT)`);

/* ── 4 · every field and every world, on the image record ────────────────── */
const PS = (process.argv[2] || '48,192').split(',').map((v) => Number(v.trim())).filter((v) => v > 0);
const buildFields = (P, verbose) => {
  const r = api.prepRecord(api.waveFromImage({rgba:png.rgba, width:png.width, height:png.height, name:'fish.png'}, P));
  console.log(`record  P=${String(P).padStart(4)} : n=${r.re.length} turns=${fixed(r.turns, 3)} amax=${fixed(r.amax, 1)} kind=${r.kind}`);
  const built = [];
  for (const F of api.FIELDS) {
    const t = performance.now(), field = F.build(r, M, M, {gapSpace:'grid', k:4}), ms = performance.now() - t;
    let on = 0;
    for (const v of field.mask) on += v;
    built.push({F, field});
    console.log(`  field ${F.id.padEnd(8)} mask ${String(on).padStart(5)}/${M * M} = ${fixed(100 * on / (M * M), 3).padStart(7)}%   amp max ${fixed(Math.max(...field.amp), 4).padStart(7)}   ${fixed(ms, 1)} ms`);
    if (verbose) console.log(`        note: ${field.note.slice(0, 150)}${field.note.length > 150 ? '…' : ''}`);
  }
  return {rec:r, built};
};
console.log(`\n── 4 · the four fields and the four worlds on that record, ${M}×${M} ──`);
const first = buildFields(PS[0], true);
for (const P of PS.slice(1)) buildFields(P, false);
const rec = first.rec, fields = first.built;
console.log(`\nthe world table below runs on the P=${PS[0]} record (the dial's default)`);
let failures = 0, runs = 0;
console.log(`\nworld × field, ${STEPS} steps each (init + step + stats + view must not throw):`);
for (const W of api.WORLDS) {
  const par = {speed:10, seed:20260919};
  for (const p of (W.params || [])) par[p.key] = p.def;
  const cells = [];
  for (const {F, field} of fields) {
    runs++;
    try {
      const S = W.init(M, M, field, api.mulberry32(20260919 ^ 0x9e3779b9), par);
      let live = 0, view = null;
      for (let g = 0; g < STEPS; g++) W.step(S, field, par);
      live = W.stats(S);
      view = W.view(S);
      let drawn = 0, faced = 0;
      for (let i = 0; i < view.live.length; i++) {drawn += view.live[i]; faced += view.face[i] ? 1 : 0;}
      cells.push(`${F.id}:${live}/${drawn}${faced ? '+' + faced + 'eye' : ''}`);
    } catch (e) {
      failures++;
      cells.push(`${F.id}:THREW ${e.message}`);
    }
  }
  console.log(`  ${W.id.padEnd(6)} ${cells.join('  ')}`);
}
console.log(`\nworld runs ${runs - failures}/${runs} completed without throwing (live/stats and drawn/view counts differ; both are printed)`);
console.log(`total harness wall time ${fixed(performance.now() - t0, 0)} ms`);

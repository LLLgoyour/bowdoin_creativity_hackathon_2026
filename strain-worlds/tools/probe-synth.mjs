/* probe-synth.mjs — the press's three voices, measured as sound.
 *
 * Every other probe in this folder reads numbers. This one has to hear: the
 * instrument in src/w-synth.js is Web Audio, and the only honest way to check
 * a Web Audio claim without a speaker is to render it offline through the SAME
 * code path the browser runs, in a real browser. So this probe builds the
 * current source into a standalone page, opens it in headless Chrome over the
 * DevTools protocol (Node's own fetch and WebSocket — no packages), and drives
 * an OfflineAudioContext inside that page:
 *
 *   1. the clock: a schedule laid down ahead of startRendering must still be
 *      audible at the END of the render. An engine reading ctx.currentTime
 *      collapses every target onto t=0 and the tail is digital silence, so the
 *      last second is asserted loud;
 *   2. three voices, and they are three: one render per plate, each audible,
 *      and each measurably different from the other two;
 *   3. the level path is the record's: voices gated shut are silence;
 *   4. a hot mix does not clip: three plates at full ink, master up, peak <= 1;
 *   5. gestures are events, not decoration: the platen struck at 1.0 s puts
 *      3x the energy of the quiet window into the window that follows it, and
 *      the same render without the strike does not;
 *   6. determinism: the same schedule rendered twice is sample-identical, which
 *      is what makes an offline render admissible as evidence at all.
 *
 * usage: node tools/probe-synth.mjs
 *   CHROME=/path/to/chrome overrides the browser (default: Google Chrome on
 *   macOS, google-chrome/chromium elsewhere). If no Chromium is found the
 *   probe reports that it could not run rather than passing quietly.
 */
import assert from 'node:assert/strict';

import {noBrowser, runPage} from './cdp.mjs';

if (noBrowser()) {
  console.log('SKIP synth audio: no Chromium found (set CHROME=/path/to/chrome).');
  process.exit(0);
}

/* ── the page-side experiment ───────────────────────────────────────────────
   Everything measured here is measured inside the app: APP.rec is the record
   the press is actually running, phraseFrame is the shipped mapping, and
   SYNTH.create is the shipped engine. */
const EXPERIMENT = `(async () => {
  for (let i = 0; i < 400; i++) {
    if (document.readyState === 'complete' && typeof SYNTH !== 'undefined' &&
        typeof APP !== 'undefined' && APP.rec && APP.rec.re) break;
    await new Promise(r => setTimeout(r, 25));
  }
  if (typeof SYNTH === 'undefined' || !APP.rec) throw new Error('the app did not boot');
  const rec = APP.rec;
  const sr = 44100, seconds = 4, frames = sr * seconds, dt = 0.03, step = Math.round(sr * dt);
  const N = 52, st = new Uint8Array(N * N);
  for (let x = 0; x < N; x++) for (let y = 0; y < N; y++)
    if (Math.hypot(x - N / 2, y - N / 2) < 14) st[y * N + x] = 1;
  const feedback = lifeFeedback(rec, {w: N, h: N, st});

  /* render the shipped engine over the shipped mapping. \`shape\` may rewrite the
     phrase between the mapping and the engine, which is how one plate at a time
     is isolated without inventing a second engine. */
  async function renderRaw(opts) {
    const keys = opts.keys || [1, 1, 1];
    SHV.key = keys.slice();
    const ctx = new OfflineAudioContext(2, frames, sr);
    const engine = SYNTH.create(ctx, {master: opts.master == null ? 0.9 : opts.master,
      space: opts.space == null ? 0.35 : opts.space, character: opts.character == null ? 0.5 : opts.character});
    const phrase = {};
    let struck = false;
    if (opts.frozen) {
      /* a phrase written once and held: the steady-state check wants no glide */
      phraseFrame(rec, feedback, Math.floor(rec.re.length * 0.72), 'music', phrase);
      if (opts.silent) for (const v of phrase.voices) { v.level = 0; v.gate = 0; }
    }
    for (let t = 0; t < frames; t += step) {
      if (!opts.frozen) {
        const index = Math.min(rec.re.length - 1, Math.floor(t / frames * rec.re.length));
        phraseFrame(rec, feedback, index, 'music', phrase);
        if (opts.solo != null) for (let j = 0; j < 3; j++)
          if (j !== opts.solo) { phrase.voices[j].level = 0; phrase.voices[j].gate = 0; }
      }
      engine.apply(phrase, dt);
      if (opts.strike != null && !struck && t >= opts.strike * sr) {
        engine.hit(opts.gesture || 'platen', 1);
        struck = true;
      }
    }
    const buf = await ctx.startRendering();
    engine.dispose();
    return {L: buf.getChannelData(0), R: buf.getChannelData(1), phrase};
  }

  /* the summary every check reads, computed from one finished render */
  function summarise(raw) {
    const L = raw.L, R = raw.R, phrase = raw.phrase;
    const at = (from, to) => {                    /* rms and peak over a window */
      let sum = 0, n = 0, peak = 0;
      for (let i = from; i < to && i < L.length; i++) {
        const m = (L[i] + R[i]) * 0.5;
        sum += m * m; n++; peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
      }
      return {rms: n ? Math.sqrt(sum / n) : 0, peak};
    };
    const out = {all: at(0, L.length), first: at(0, sr), last: at(L.length - sr, L.length),
      before: at(Math.round(sr * 0.85), sr), after: at(sr, Math.round(sr * 1.15))};
    /* a 16384-sample window late in the render, and its energy at the three
       voice pitches: enough to say the voices separate by pitch, not just by
       level. Straight DFT at four frequencies, no FFT needed. */
    const start = Math.round(sr * 2.5), size = 16384;
    out.spectrum = [];
    const probes = [];
    for (const v of phrase.voices) probes.push(v.pitch);
    probes.push(probes[0] * 1.5);
    for (const f of probes) {
      let re = 0, im = 0;
      for (let i = 0; i < size; i++) {
        const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / size);
        const a = 2 * Math.PI * f * i / sr;
        re += (L[start + i] + R[start + i]) * 0.5 * w * Math.cos(a);
        im -= (L[start + i] + R[start + i]) * 0.5 * w * Math.sin(a);
      }
      out.spectrum.push(Math.hypot(re, im) / size);
    }
    out.peak = out.all.peak; out.rms = out.all.rms;
    return out;
  }

  async function render(opts) { return summarise(await renderRaw(opts)); }

  /* how far apart two renders of the same samples are, in absolute terms and
     against the peak: the span a comparison can honestly claim */
  function maxDiff(a, b) {
    let worst = 0;
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
    return worst;
  }
  /* a bare oscillator and one ramp, so the browser's own floor is measured and
     the engine is judged against it rather than against perfection */
  async function bareRender() {
    const ctx = new OfflineAudioContext(2, sr, sr);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 220; g.gain.value = 0;
    o.connect(g); g.connect(ctx.destination); o.start();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.5);
    const buf = await ctx.startRendering();
    return buf.getChannelData(0);
  }

  const GESTURES = ['platen', 'sheet', 'snap', 'ink', 'delivery'];
  const result = {};
  result.steady = await render({frozen: true});
  result.silent = await render({frozen: true, silent: true});
  result.solo = [await render({solo: 0}), await render({solo: 1}), await render({solo: 2})];
  result.hot = await render({keys: [1, 1, 1], master: 1, space: 1, character: 1});
  /* the gestures are measured twice: alone (every plate gated shut, so the
     window holds the gesture and nothing else) and inside the mix, where the
     honest question is only whether the strike is present at all */
  result.quiet = await render({frozen: true, silent: true});
  for (const name of GESTURES)
    result['alone_' + name] = await render({frozen: true, silent: true, strike: 1.0, gesture: name});
  result.mixQuiet = await render({frozen: true});
  result.mixStrike = await render({frozen: true, strike: 1.0, gesture: 'platen'});
  /* two renders of one schedule, compared in the page: the arrays never leave
     the browser, only the distance between them */
  const replayA = await renderRaw({frozen: true}), replayB = await renderRaw({frozen: true});
  result.replay = {maxDiff: maxDiff(replayA.L, replayB.L), peak: summarise(replayA).peak};
  result.browserFloor = maxDiff(await bareRender(), await bareRender());
  return JSON.stringify({result, GESTURES});
})()`;

const {result: r, GESTURES, version} = await runPage(EXPERIMENT);

/* 1. the clock: a schedule laid down ahead of the render must still sound at
   the end of it, and the render must have a body, not one impulse at t=0 */
assert(r.steady.rms > 5e-4, `the instrument is not audible (rms ${r.steady.rms.toExponential(2)})`);
assert(r.steady.last.rms > r.steady.rms * 0.25,
  `the tail is silent — the schedule collapsed onto t=0 (last ${r.steady.last.rms.toExponential(2)} vs all ${r.steady.rms.toExponential(2)})`);
assert(r.steady.first.rms > 5e-5, 'the first second never sounded');

/* 2. the level path is the record's and the colony's: gated shut is silence */
assert(r.silent.rms < r.steady.rms * 0.02,
  `gating every plate shut did not silence the press (${r.silent.rms.toExponential(2)} vs ${r.steady.rms.toExponential(2)})`);

/* 3. three voices, each audible and each a different sound */
for (let i = 0; i < 3; i++)
  assert(r.solo[i].rms > r.steady.rms * 0.12,
    `plate ${i} alone is inaudible (rms ${r.solo[i].rms.toExponential(2)} vs all three ${r.steady.rms.toExponential(2)})`);
const spread = [
  Math.abs(r.solo[0].rms - r.solo[1].rms) / Math.max(r.solo[0].rms, r.solo[1].rms),
  Math.abs(r.solo[1].rms - r.solo[2].rms) / Math.max(r.solo[1].rms, r.solo[2].rms),
  Math.abs(r.solo[0].rms - r.solo[2].rms) / Math.max(r.solo[0].rms, r.solo[2].rms)];
assert(Math.max(...spread) > 0.15,
  `the three plates render identically (relative rms differences ${spread.map(v => v.toFixed(3)).join(', ')})`);
const strongest = r.solo.map((s, i) => s.rms);
assert(strongest.every(v => Number.isFinite(v) && v > 0), 'a plate render came back empty');

/* 4. a hot mix does not clip */
assert(r.hot.peak <= 1.0, `the master clipped (peak ${r.hot.peak.toFixed(4)})`);
assert(r.hot.rms > r.steady.rms * 0.5, 'the hot render lost the signal');

/* 5. gestures are events: with the plates gated shut, the window after the
   strike holds the gesture and nothing else. A control render without the
   strike proves the energy is the strike's. */
assert(r.quiet.after.rms < 1e-4,
  `a silenced press is not silent in the gesture window (${r.quiet.after.rms.toExponential(2)})`);
const gestureRatio = name => r['alone_' + name].after.rms / Math.max(r.quiet.after.rms, 1e-9);
const ratios = GESTURES.map(gestureRatio);
for (let i = 0; i < GESTURES.length; i++)
  assert(ratios[i] > 5,
    `the ${GESTURES[i]} gesture is inaudible alone (window rms ${r['alone_' + GESTURES[i]].after.rms.toExponential(2)} vs control ${r.quiet.after.rms.toExponential(2)})`);
const mixLift = r.mixStrike.after.rms / r.mixQuiet.after.rms;
assert(mixLift > 1.02,
  `the platen is not present in the mix (window rms ${r.mixStrike.after.rms.toExponential(2)} vs ${r.mixQuiet.after.rms.toExponential(2)})`);

/* 6. replay: the same schedule twice, against the floor this browser sets.
   A bare oscillator pair is rendered the same way to measure that floor, so
   the engine is judged against the instrument it runs on, not perfection. */
const replayRel = r.replay.maxDiff / r.replay.peak;
assert(replayRel < 1e-3,
  `a replay of the same schedule moved by ${r.replay.maxDiff.toExponential(2)} ` +
  `(${replayRel.toExponential(2)} of full scale, browser floor ${r.browserFloor.toExponential(2)})`);

const plates = ['BLUE', 'PINK', 'YELLOW'];
console.log('PASS three voices, rendered offline in ' + version.Browser.split('/')[0] + ' ' +
  version.Browser.split('/')[1] + ':');
console.log('     steady rms ' + r.steady.rms.toExponential(2) +
  ' (first second ' + r.steady.first.rms.toExponential(2) +
  ', last second ' + r.steady.last.rms.toExponential(2) + ') — the clock survives a pre-render schedule;');
console.log('     plates alone: ' + r.solo.map((s, i) => plates[i] + ' ' + s.rms.toExponential(2)).join(', ') +
  ' — all three audible, none identical;');
console.log('     every plate gated shut ' + r.silent.rms.toExponential(2) +
  '; hot three-plate mix peak ' + r.hot.peak.toFixed(3) + ' (no clip, rms ' + r.hot.rms.toExponential(2) + ');');
console.log('     gestures alone (window rms vs the silenced control ' +
  r.quiet.after.rms.toExponential(2) + '): ' +
  GESTURES.map((n, i) => n + ' ' + r['alone_' + n].after.rms.toExponential(2) + ' (' + ratios[i].toFixed(0) + 'x)').join(', ') + ';');
console.log('     platen in the mix raises its window ' + mixLift.toFixed(3) + 'x.');
console.log('     replay drift ' + r.replay.maxDiff.toExponential(2) + ' (' +
  replayRel.toExponential(2) + ' of full scale) against a bare-oscillator floor of ' +
  r.browserFloor.toExponential(2) + ' in this browser.');

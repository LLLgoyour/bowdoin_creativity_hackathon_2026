/* probe-theme.mjs — the room's own tune, rendered offline and measured.
 *
 * The other probes read numbers; this one has to hear a piece. The tune in
 * src/w-theme.js is Web Audio and its transport is the press's own drive, so
 * the only honest check without a speaker is to render it offline through the
 * SAME code path the browser runs, in a real browser — this probe builds the
 * current source into a standalone page, opens it in headless Chrome over the
 * DevTools protocol, and drives an OfflineAudioContext inside that page with
 * the exact state updateAudio() writes every frame:
 *
 *   1. the form is the form: the four sections come up in the order the score
 *      lays them out, and the whole thing is rendered, not the first half;
 *   2. the lead has the shape the arrangement says — bars 0-3 silent, then on;
 *   3. the tune's key is the record's: at every bar line the tonic is
 *      THEME.fold(phrase root, 55, 110), and it sits in the bass register;
 *   4. the tempo is the record's own turn, clamped to the range a press can be
 *      operated at, and bpm agrees with beat;
 *   5. the vocabulary is one tuning: the five slot names are the just-intonation
 *      ratios the plates print, and slotOf(slotHz(slot)) is the slot again;
 *   6. every gesture the press owns is actually struck somewhere in the piece,
 *      which is what makes the gesture-per-action map a sound and not a list;
 *   7. the mix leaves the machine intact: no sample at or over full scale, a
 *      body above the noise floor, and a stereo image with width in it.
 *
 * usage: node tools/probe-theme.mjs
 *   CHROME=/path/to/chrome overrides the browser (default: Google Chrome on
 *   macOS, google-chrome/chromium elsewhere). If no Chromium is found the
 *   probe reports that it could not run rather than passing quietly.
 */
import assert from 'node:assert/strict';

import {noBrowser, runPage} from './cdp.mjs';

if (noBrowser()) {
  console.log('SKIP theme: no Chromium found (set CHROME=/path/to/chrome).');
  process.exit(0);
}

/* ── the page-side experiment ───────────────────────────────────────────────
   Everything measured here is measured inside the app: APP.rec is the record
   the press is running, phraseFrame is the shipped mapping, THEME.create is the
   shipped tune, and the state object is the app's own AUDIO.state. */
const EXPERIMENT = `(async () => {
  for (let i = 0; i < 400; i++) {
    if (document.readyState === 'complete' && typeof THEME !== 'undefined' &&
        typeof APP !== 'undefined' && APP.rec && APP.rec.re) break;
    await new Promise(r => setTimeout(r, 25));
  }
  if (typeof THEME === 'undefined' || !APP.rec) throw new Error('the app did not boot');
  const rec = APP.rec, sr = 22050, DT = 1/60, len = rec.re.length;
  const stride = scopeStride(rec);
  /* the ledger is keyed by the instrument's own gesture list, because the score
     bits and the gestures are not one-to-one: the register pins and the spare
     plates are two bits that sound as the same struck snap, at two pitches. */
  const GESTURES = (typeof SYNTH !== 'undefined' && SYNTH.HITS) ? SYNTH.HITS.slice()
    : ['platen','sheet','snap','ink','delivery','tape'];
  const bits = {};
  for (const k in THEME.HIT) {
    let n = 0;
    for (let i = 0; i < THEME.SCORE.length; i++) if (THEME.SCORE[i] & THEME.HIT[k]) n++;
    bits[k] = n;
  }
  const st = AUDIO.state;

  /* one frame of the app's own state, written the way updateAudio writes it */
  function frame(f) {
    const i = (f * stride) % len;
    st.rec = rec; st.ph = AUDIO.reading; st.stride = stride; st.speed = speed;
    st.live = clamp(liveN / Math.max(1, M * M), 0, 1);
    const amax = rec.amax || 1, re = rec.re[i] / amax, im = rec.im ? rec.im[i] / amax : 0;
    st.mag = Math.min(1, Math.hypot(re, im));
    st.phase = Math.atan2(im, re);
    phraseFrame(rec, APP.feedback || null, i, AUDIO.mode, AUDIO.reading);
  }

  /* one instance of the shipped tune, with its own gesture ledger */
  function inst(ctx) {
    const theme = THEME.create(ctx, {master: 0.65, space: 0.38, character: 0.5});
    const hits = {};
    for (const g of GESTURES) hits[g] = 0;
    if (theme.synth) {
      const raw = theme.synth.hit;
      theme.synth.hit = function (name, energy, hz) {
        if (name in hits) hits[name]++;
        return raw.call(this, name, energy, hz);
      };
    }
    return {theme: theme, hits: hits};
  }

  /* the transport, stepped as many frames as asked. Returns what the piece did:
     the sections in the order they sounded, and the tonic put on the key at
     every bar line. Cheap enough to run twice — this probe measures the form's
     own length with the shipped code rather than assuming one. */
  function run(it, frames) {
    const sections = [], keys = [];
    let last = '', prevBar = -1;
    for (let f = 0; f < frames; f++) {
      frame(f);
      it.theme.step(DT, st);
      const r = it.theme.report();
      if (r.sectionName !== last) { last = r.sectionName; sections.push({name: last, bar: r.bar}); }
      if (r.bar !== prevBar) {
        prevBar = r.bar;
        keys.push({bar: r.bar, root: st.ph.root || 0, tonic: r.tonic,
          expected: THEME.fold(st.ph.root || 0, THEME.TUNE.bass.lo, THEME.TUNE.bass.hi)});
      }
    }
    return {sections: sections, keys: keys};
  }

  /* the form's own length: drive the shipped transport on a context that
     renders one frame until the last bar of the last section has gone by */
  const probe = inst(new OfflineAudioContext(2, 1024, sr));
  const FORM = THEME.FORM, LAST = FORM.length - 1, START = FORM.reduce((n, f) => n + f.bars, 0);
  let preFrames = 0, seenEnd = false;
  for (let f = 0; f < 60 * 240; f++) {
    frame(f);
    probe.theme.step(DT, st);
    const r = probe.theme.report();
    preFrames = f + 1;
    if (r.section === LAST && r.bar === THEME.BARS - 1) seenEnd = true;
    if (seenEnd && r.section === 0 && r.bar === 0) break;
  }
  probe.theme.dispose();

  /* the real render: the whole form, plus half a second of tail */
  const frames = preFrames + Math.round(0.5 / DT);
  const ctx = new OfflineAudioContext(2, Math.round((frames * DT + 0.5) * sr), sr);
  const it = inst(ctx);
  const pass = run(it, frames);
  const buf = await ctx.startRendering();
  it.theme.dispose();

  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  let peak = 0, clip = 0, power = 0, mid = 0, side = 0;
  for (let i = 0; i < L.length; i++) {
    const l = L[i], r = R[i], m = (l + r) * 0.5, s = (l - r) * 0.5;
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
    if (Math.abs(l) >= 1 || Math.abs(r) >= 1) clip++;
    power += l * l + r * r; mid += m * m; side += s * s;
  }
  const n = L.length, midR = Math.sqrt(mid / n), sideR = Math.sqrt(side / n);
  const slots = [];
  for (let k = 0; k < 15; k++) slots.push(THEME.slotOf(THEME.slotHz(130.81278265, k), 130.81278265));

  return JSON.stringify({
    sr: sr, bars: THEME.BARS, units: THEME.UNITS, stride: stride,
    seconds: n / sr, frames: frames, preFrames: preFrames,
    form: THEME.FORM_NAME, sections: pass.sections, keys: pass.keys,
    hits: it.hits, gestures: GESTURES, bits: bits,
    lead: Array.prototype.join.call(THEME.LEAD, ''),
    scaleName: THEME.TUNE.scaleName, slots: slots,
    tempo: it.theme.tempoNow(), range: [THEME.TUNE.tempo.min, THEME.TUNE.tempo.max],
    bass: [THEME.TUNE.bass.lo, THEME.TUNE.bass.hi],
    audio: {peak: peak, clip: clip, rms: Math.sqrt(power / (2 * n)), width: sideR / Math.max(1e-12, midR)}
  });
})()`;

const r = await runPage(EXPERIMENT);

/* 1. the form is the form, in order and complete: the piece renders to the end
   of its own arrangement rather than stopping when the buffer does */
const sounded = r.sections.map(s => s.name);
assert.deepEqual(sounded.slice(0, r.form.length), r.form,
  `the sections did not sound in order (heard ${sounded.join(' → ')}, scored ${r.form.join(' → ')})`);
assert(sounded.slice(r.form.length).every(n => n === r.form[0]),
  `after the form the piece did not return to the top (heard ${sounded.join(' → ')})`);
assert(r.preFrames > 0 && r.preFrames < 60 * 240,
  `the form never completed (${r.preFrames} frames driven)`);
assert(r.bars > 0 && r.units === r.bars * 8,
  `the arrangement disagrees with itself (${r.bars} bars, ${r.units} half-beats)`);

/* 2. the lead has the shape the arrangement says it does */
assert(/^0+1+$/.test(r.lead),
  `the lead's bars are not "silent, then singing" (${r.lead})`);
assert(r.lead.indexOf('1') > 0, 'the lead sings from the first bar, which leaves it no air');

/* 3. the key is the record's, at every bar line it is set */
assert(r.keys.length >= r.bars, `only ${r.keys.length} bar lines for ${r.bars} bars`);
const rooted = r.keys.filter(k => k.root > 0);
assert(rooted.length >= r.bars,
  `only ${rooted.length} bar lines had a phrase root to take a key from`);
for (const k of rooted) {
  assert.equal(k.tonic, k.expected,
    `bar ${k.bar}: tonic ${k.tonic} is not the record's own pitch folded into the bass ` +
    `(${k.root} Hz would fold to ${k.expected} Hz)`);
  assert(k.tonic >= 55 && k.tonic < 110,
    `bar ${k.bar}: the tonic ${k.tonic} Hz is outside the bass register 55..110 Hz`);
}

/* 4. the tempo is the record's own turn, clamped to something operable */
assert.deepEqual(r.range, [0.30, 1.20], `the tempo clamp is ${r.range.join('..')}, not 0.30..1.20`);
assert(r.tempo.beat >= r.range[0] && r.tempo.beat <= r.range[1],
  `the beat is ${r.tempo.beat.toFixed(3)} s, outside ${r.range[0]}..${r.range[1]}`);
assert(Math.abs(r.tempo.bpm - 60 / r.tempo.beat) < 1e-6,
  `bpm ${r.tempo.bpm} does not agree with the beat it prints (${r.tempo.beat} s)`);

/* 5. one tuning: the five slots are the just-intonation ratios the plates print,
   and a pitch printed on a slot reads back as that slot */
assert.deepEqual(r.scaleName, ['1/1', '9/8', '5/4', '3/2', '5/3'],
  `the slot names are ${r.scaleName.join(' ')}, not the five just ratios`);
assert.deepEqual(r.slots.slice(0, 5), [0, 1, 2, 3, 4],
  `slotHz/slotOf do not round-trip (${r.slots.join(',')})`);
assert.deepEqual(r.slots.slice(10, 15), [0, 1, 2, 3, 4],
  `slotHz/slotOf do not round-trip two octaves up (${r.slots.join(',')})`);

/* 6. every gesture the floor owns is struck somewhere in the piece, and every
   instrument the score names is actually used by the arrangement */
for (const g of r.gestures)
  assert(r.hits[g] > 0, `the ${g} gesture is never struck in the whole form`);
for (const b of Object.keys(r.bits))
  assert(r.bits[b] > 0, `the arrangement never uses the ${b} instrument (score bit unset)`);

/* 7. the mix leaves the machine intact */
assert(r.audio.peak < 1.0, `the tune clipped the master (peak ${r.audio.peak.toFixed(4)})`);
assert.equal(r.audio.clip, 0, `${r.audio.clip} samples reached or passed full scale`);
assert(r.audio.rms > 0.02, `the tune is not audible (rms ${r.audio.rms.toExponential(2)})`);
assert(r.audio.width > 0.05,
  `the tune is mono (side/mid ${r.audio.width.toExponential(2)}) — the pans are the floor plan`);

console.log('PASS the room\'s own tune, ' + r.seconds.toFixed(1) + ' s rendered offline at ' +
  r.sr + ' Hz (' + r.frames + ' frames of drive, stride ' + r.stride + '):');
console.log('     the form: ' + r.form.join(' → ') + ' — ' + r.bars + ' bars, ' + r.units +
  ' half-beats, all four sections sounded in order;');
console.log('     the lead: ' + r.lead + ' — silent for the makeready, singing from the proof;');
console.log('     the key: every one of the ' + rooted.length + ' keyed bar lines folds the ' +
  'phrase root into ' + r.bass[0] + '..' + r.bass[1] + ' Hz, e.g. ' +
  rooted[0].root.toFixed(1) + ' Hz → ' + rooted[0].tonic.toFixed(2) + ' Hz;');
console.log('     the tempo: ' + r.tempo.beat.toFixed(3) + ' s/beat (' + r.tempo.bpm.toFixed(1) +
  ' BPM), clamped to ' + r.range[0] + '..' + r.range[1] + ';');
console.log('     the tuning: ' + r.scaleName.join(' ') + ' (just intonation) — ' +
  r.slots.length + ' slots round-trip through slotHz/slotOf;');
console.log('     gestures struck: ' + r.gestures.map(g => g + ' ' + r.hits[g]).join(', ') +
  ' — every gesture the instrument has, struck by the score;');
console.log('     score bits used: ' + Object.keys(r.bits).map(b => b + ' ' + r.bits[b]).join(', ') +
  ' (the pins and the spare plates are two bits sounding as one pitched snap);');
console.log('     the mix: peak ' + r.audio.peak.toFixed(3) + ', rms ' + r.audio.rms.toExponential(2) +
  ', clip ' + r.audio.clip + ', stereo width ' + r.audio.width.toFixed(3) + '.');

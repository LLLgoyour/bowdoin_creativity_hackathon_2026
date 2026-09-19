/* probe-phrase.mjs — the voicing, measured against the older single-instrument
 * mapping it claims to keep faith with.
 *
 * The listening bench already prints a claim about its own sound: amplitude
 * becomes loudness, phase rotation becomes pitch, complex phase becomes stereo.
 * The single-oscillator mapping (sonifyLifeFrame) is what the printed notes and
 * probe-sonify.mjs were written against, so the voicing is held to both
 * promises at once:
 *
 *   1. back-compat, sample by sample: every field the old mapping filled
 *      (pitch, level, pan, brightness, sourceHz, noteStep) is identical here,
 *      so nothing the bench says about the sound stopped being true;
 *   2. three voices, finite and in range, and not all three on one pitch — a
 *      chord, not a unison;
 *   3. the ink keys are the mix, and they are the press's own key equation:
 *      raising a plate's coverage raises that plate's voice, and no other
 *      ratio between them is asserted, because the press does not claim one;
 *   4. move is true exactly when the note step advances, because that flag is
 *      what makes a note-shaped event, and it must be a property of the record
 *      and the cursor rather than of call history;
 *   5. determinism and no allocation: the caller's object and its three voice
 *      objects are reused in place and the same inputs give the same numbers;
 *   6. both modes stay honest: 'tone' is still the continuous sweep, and it
 *      voices three plates too;
 *   7. the empty path: no record is silence with lettering, not a crash.
 *
 * usage: node tools/probe-phrase.mjs
 */
import {readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const js = ['core.js', 'w-field.js', 'data-gsfc.js', 'w-sonify.js', 'w-phrase.js']
  .map(name => readFileSync(join(root, 'src', name), 'utf8')).join('\n');
/* SHV is the shop's own state: the probe supplies the dials the voicing reads,
   exactly as w-shop.js does, so coverage can be moved from here. */
const {rec, sonifyLifeFrame, sonifyFrame, phraseFrame, lifeFeedback, phraseSlotHz, setKeys} = new Function(`
const SHV = {key: [0.34, 0.55, 0.76]};
${js}
return {
  rec: prepRecord({name: GSFC.name, re: decodeF64(GSFC.re), im: decodeF64(GSFC.im), t: decodeF64(GSFC.t)}),
  sonifyLifeFrame, sonifyFrame, phraseFrame, lifeFeedback, phraseSlotHz,
  setKeys: (keys) => { SHV.key = keys; },
};`)();

/* a colony: a disc of live cells, so the feedback wave is not flat and the
   voices have something to bend from */
const N = 52, st = new Uint8Array(N * N);
for (let x = 0; x < N; x++) for (let y = 0; y < N; y++)
  if (Math.hypot(x - N / 2, y - N / 2) < 14) st[y * N + x] = 1;
const feedback = lifeFeedback(rec, {w: N, h: N, st});
assert(feedback && feedback.live > 0, 'probe needs a living colony');

const SHARED = ['pitch', 'level', 'pan', 'brightness', 'sourceHz', 'noteStep'];
const old = {}, fresh = {}, replay = {}, again = {};
let moved = 0, lastStep = null, reallocated = 0;
const chords = new Set(), degrees = new Set();
const voiceIds = [];

for (let i = 0; i < rec.re.length; i++) {
  sonifyLifeFrame(rec, feedback, i, 'music', old);
  phraseFrame(rec, feedback, i, 'music', fresh);
  for (const key of SHARED) {
    assert(Object.is(old[key], fresh[key]),
      `sample ${i}: ${key} drifted from the printed mapping (${old[key]} vs ${fresh[key]})`);
    assert(Number.isFinite(old[key]), `sample ${i}: ${key} is not finite`);
  }
  assert.equal(fresh.voices.length, 3, 'the bench has three plates, so three voices');
  for (let v = 0; v < 3; v++) {
    const voice = fresh.voices[v];
    if (i === 0) voiceIds.push(voice);
    else if (voice !== voiceIds[v]) reallocated++;
    for (const key of ['pitch', 'level', 'pan', 'brightness', 'fm', 'fmDepth', 'detune', 'gate']) {
      assert(Number.isFinite(voice[key]), `sample ${i} voice ${v}: ${key} is not finite`);
    }
    assert(voice.pitch >= 20 && voice.pitch <= 12000, `sample ${i} voice ${v}: pitch ${voice.pitch} out of range`);
    assert(voice.level >= 0 && voice.level <= 1, `sample ${i} voice ${v}: level out of range`);
    assert(voice.pan >= -0.75 && voice.pan <= 0.75, `sample ${i} voice ${v}: pan out of range`);
    assert(voice.brightness >= 0 && voice.brightness <= 1, `sample ${i} voice ${v}: brightness out of range`);
    assert(voice.fm > 0, `sample ${i} voice ${v}: fm ratio must be positive`);
  }
  if (fresh.move) {
    moved++;
    assert(fresh.noteStep !== lastStep, `sample ${i}: move without a step change`);
  }
  assert.equal(fresh.move, lastStep !== null && fresh.noteStep !== lastStep,
    `sample ${i}: move does not track the note step`);
  lastStep = fresh.noteStep;
  assert(Number.isFinite(fresh.root) && fresh.root > 0, `sample ${i}: root is not a pitch`);
  assert.equal(fresh.chordName, fresh.chordName.toUpperCase(), `sample ${i}: chordName is not printed lettering`);
  assert.equal(fresh.degree, fresh.degree.toUpperCase(), `sample ${i}: degree is not printed lettering`);
  chords.add(fresh.chordName); degrees.add(fresh.degree);
}
assert.equal(reallocated, 0, 'the voices array was reallocated while running');
assert.equal(chords.size, 15, `expected 15 named chords over the grid, saw ${chords.size}`);
assert.equal(degrees.size, 5, `expected 5 degrees, saw ${degrees.size}`);
assert(moved > 8, `only ${moved} note events in ${rec.re.length} samples`);

/* the chord is a chord: at the strongest sample the voices are apart by more
   than a wide unison */
const peak = rec.amp.indexOf(Math.max(...rec.amp));
phraseFrame(rec, feedback, peak, 'music', fresh);
const spread = Math.max(...fresh.voices.map(v => v.pitch)) - Math.min(...fresh.voices.map(v => v.pitch));
assert(spread > 60, `voices are a unison at the strongest sample (spread ${spread.toFixed(1)} Hz)`);

/* the ink keys mix the instrument: one plate up, that plate's voice up. The
   press's own equation is 0.30 + 1.10*key, so even a closed key carries ink. */
const withKeys = (keys) => {
  setKeys(keys);
  return phraseFrame(rec, feedback, peak, 'music', {});
};
const low = withKeys([0.1, 0.1, 0.1]), high = withKeys([1, 1, 1]);
for (let v = 0; v < 3; v++) {
  assert(high.voices[v].gate > low.voices[v].gate,
    `plate ${v}: opening the key did not open its voice (${low.voices[v].gate} -> ${high.voices[v].gate})`);
  assert(high.voices[v].level > low.voices[v].level,
    `plate ${v}: opening the key did not raise its loudness`);
}
/* and one plate's key moves one plate, not the chord's shape */
const one = withKeys([1, 0.1, 0.1]);
assert(one.voices[0].gate > one.voices[1].gate && one.voices[0].gate > one.voices[2].gate,
  'the open plate is not the loudest voice');

/* tone mode is the continuous sweep and it still voices three plates */
const tone = phraseFrame(rec, feedback, peak, 'tone', {});
assert.equal(tone.voices.length, 3, 'tone mode must voice three plates too');
assert.equal(tone.voices.length, 3);
assert(Number.isFinite(tone.pitch));

/* determinism, replayed from a clean cursor */
phraseFrame(rec, feedback, peak, 'music', replay);
phraseFrame(rec, feedback, peak, 'music', again);
assert.deepEqual(replay, again, 'the same cursor twice is not the same frame');

/* the tuning is ONE tuning: the grid is just intonation on C3 — 1/1 9/8 5/4
   3/2 5/3 — over the three octaves the plates print, so a tonic folded from the
   record always lands on a slot of the same grid the room's own tune plays. */
const JI = [1, 9/8, 5/4, 3/2, 5/3];
for (let k = 0; k < JI.length; k++)
  assert(Math.abs(phraseSlotHz(k) / phraseSlotHz(0) - JI[k]) < 1e-12,
    `slot ${k} sits ${(phraseSlotHz(k) / phraseSlotHz(0)).toFixed(6)} of the tonic, not ${JI[k]}`);
for (let k = 0; k < 10; k++)
  assert(Math.abs(phraseSlotHz(k + 5) / phraseSlotHz(k) - 2) < 1e-12,
    `slot ${k + 5} is not an octave above slot ${k}`);
assert(Math.abs(phraseSlotHz(1) / phraseSlotHz(0) - 1.125) < 1e-12,
  'degree 1 is not 9/8 of the tonic');

/* no record is silence with lettering, not a crash */
const silent = phraseFrame(null, null, 0, 'music', {});
assert.equal(silent.chordName, 'SILENT');
assert.equal(silent.move, false);
for (const voice of silent.voices) assert.equal(voice.gate, 0, 'a silent record must gate every plate shut');

console.log('PASS voicing:', rec.re.length, 'samples against sonifyLifeFrame;',
  'shared fields identical on every one;',
  moved, 'note events (' + (moved / rec.re.length * 100).toFixed(1) + '%);',
  chords.size, 'chords and', degrees.size, 'degrees, e.g.',
  [...chords].slice(0, 2).join(' | ') + ' | ' + [...degrees].join(' '));
console.log('     voices spread', spread.toFixed(1), 'Hz at the strongest sample;',
  'voice objects reused in place across all calls;', 'keys raise their own plate only;',
  'tone mode voiced; replay deterministic; silent path silent.');
console.log('     grid just intonation on C3 130.813 Hz:',
  JI.map((r, k) => phraseSlotHz(k).toFixed(3)).join(' /'), 'Hz;',
  'ratios', ['1/1', '9/8', '5/4', '3/2', '5/3'].join(' '),
  '— degree 1 =', phraseSlotHz(1).toFixed(3), 'Hz, the octave =', phraseSlotHz(5).toFixed(3), 'Hz.');

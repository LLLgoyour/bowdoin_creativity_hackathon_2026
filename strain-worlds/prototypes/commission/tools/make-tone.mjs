/* make-tone.mjs — this variant's audio test file: a 440 Hz carrier that starts
 * and stops, so the analytic record has both a phase to check and an envelope
 * to see. 16-bit mono PCM WAV, written by hand (no audio library).
 *
 * The first second is a plain 0.6·cos(2π·440t) — that is the stretch
 * probe-wave.mjs checks x + i·H(x) against, since its Hilbert transform is
 * known in closed form. After that come a tremolo and two upper harmonics so
 * the record is not a single tone.
 *
 * usage: node tools/make-tone.mjs [out.wav]
 */
import {writeFileSync} from 'node:fs';

const RATE = 8000, SECONDS = 3, N = RATE * SECONDS;
const samples = new Float64Array(N);
for (let i = 0; i < N; i++) {
  const t = i / RATE;
  const pure = t < 1;
  const gate = pure ? 1 : Math.exp(-1.2 * (t - 1)) * (0.6 + 0.4 * Math.cos(2 * Math.PI * 3.5 * (t - 1)));
  samples[i] = gate * (0.6 * Math.cos(2 * Math.PI * 440 * t) +
    (pure ? 0 : 0.22 * Math.cos(2 * Math.PI * 880 * t) + 0.11 * Math.cos(2 * Math.PI * 1320 * t)));
}
const data = Buffer.alloc(N * 2);
for (let i = 0; i < N; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), i * 2);
const head = Buffer.alloc(44);
head.write('RIFF', 0, 'latin1'); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8, 'latin1');
head.write('fmt ', 12, 'latin1'); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
head.writeUInt32LE(RATE, 24); head.writeUInt32LE(RATE * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
head.write('data', 36, 'latin1'); head.writeUInt32LE(data.length, 40);
const out = process.argv[2] || new URL('tone.wav', import.meta.url).pathname;
writeFileSync(out, Buffer.concat([head, data]));
let peak = 0;
for (const s of samples) peak = Math.max(peak, Math.abs(s));
console.log(`${out}  ${N} samples, ${RATE} Hz, ${SECONDS} s mono 16-bit PCM, peak ${peak.toFixed(4)}`);

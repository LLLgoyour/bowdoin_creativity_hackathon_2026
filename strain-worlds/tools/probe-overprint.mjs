/* Exact pixel parity against the uncached screen equation. Exercises size,
   registration, seed, ink-key and coverage changes without a browser dependency.
   Run: node tools/probe-overprint.mjs */
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';

class Plate {
  getContext() {
    if (!this.data || this.data.length !== this.width * this.height * 4)
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
    return {getImageData: () => ({data: this.data})};
  }
}
const document = {createElement: () => new Plate()};
const src = ['core.js', 'w-render.js'].map(f =>
  readFileSync(new URL('../src/' + f, import.meta.url), 'utf8')).join('\n');
const api = new Function('document', src + '\nreturn {R,INKS,PAPER,DOT,plates,slips,pullSheet,mulberry32};')(document);
const ctx = {
  createImageData: (w, h) => ({data: new Uint8ClampedArray(w * h * 4)}),
  putImageData(image) { this.pixels = image.data.slice(); }
};

function reference(S, seed) {
  const {PAPER, INKS, DOT, R} = api, slip = api.slips(seed);
  const out = new Uint8ClampedArray(S * S * 4);
  for (let o = 0; o < out.length; o += 4) {
    out[o] = PAPER[0]; out[o + 1] = PAPER[1]; out[o + 2] = PAPER[2]; out[o + 3] = 255;
  }
  for (let p = 0; p < 3; p++) {
    const data = api.plates(S)[p].data;
    const ca = Math.cos(INKS[p].ang), sa = Math.sin(INKS[p].ang);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const fx = x - slip[p].dx - S / 2, fy = y - slip[p].dy - S / 2;
      const u = fx * ca + fy * sa, v = -fx * sa + fy * ca;
      const su = Math.round(u / DOT) * DOT, sv = Math.round(v / DOT) * DOT;
      const sx = su * ca - sv * sa + S / 2 + slip[p].dx;
      const sy = su * sa + sv * ca + S / 2 + slip[p].dy;
      const gx = sx | 0, gy = sy | 0;
      if (gx < 0 || gy < 0 || gx >= S || gy >= S) continue;
      const c = data[(gy * S + gx) * 4] / 255 * R.inkKey[p];
      if (c <= 0.03) continue;
      const dx = x - sx, dy = y - sy;
      if (dx * dx + dy * dy > c * DOT * DOT * 0.66) continue;
      const o = (y * S + x) * 4;
      for (let ch = 0; ch < 3; ch++) out[o + ch] *= INKS[p].hex[ch] / 255;
    }
  }
  const rng = api.mulberry32(seed ^ 0x51ed27);
  for (let o = 0; o < out.length; o += 4) {
    const n = (rng() * 2 - 1) * 9;
    for (let ch = 0; ch < 3; ch++) out[o + ch] = Math.max(0, Math.min(255, out[o + ch] + n));
  }
  return out;
}

let cases = 0, bytes = 0;
for (const S of [97, 128, 97]) {
  for (const slip of [0, 1, [0.4, 2, 0]]) for (const seed of [7, 8, 7]) {
    for (const key of [[1, 1, 1], [0.3, 0.8, 1.4], [0, 1.1, 0.5]]) {
      api.R.slipScale = slip; api.R.inkKey = key;
      for (let p = 0; p < 3; p++) {
        const data = api.plates(S)[p].getContext().getImageData().data;
        for (let i = 0; i < data.length; i += 4) {
          data[i] = ((i * 17 + i / 4 + p * 37 + cases) % 256) | 0;
          data[i + 3] = 255;
        }
      }
      const expected = reference(S, seed);
      api.pullSheet(ctx, S, 0, 0, seed);
      assert.deepEqual(ctx.pixels, expected, `screen parity: side=${S}, seed=${seed}, slip=${slip}, keys=${key}`);
      cases++; bytes += expected.length;
    }
  }
}
console.log(`overprint parity: ${cases} cases, ${bytes} bytes compared, 0 differences`);
console.log('coverage, ink keys, registration, seed and resize round trips: PASS');

/* make-fish.mjs — draw this variant's own test image and write it as a PNG.
 *
 * No image library: the silhouette is an implicit function sampled on a 4×4
 * supersampled grid (so edges are antialiased but the shape is high contrast:
 * black on white), and the PNG is written with node's zlib and a CRC32 table.
 * The point of drawing it here is that the contour the variant reconstructs is
 * a shape with real features — a tapered body, two fins, a forked tail and a
 * hole (the eye) that is a *second* closed traversal — not a circle.
 *
 * usage: node tools/make-fish.mjs [out.png]
 */
import {writeFileSync} from 'node:fs';
import {deflateSync} from 'node:zlib';

const SIDE = 512, SS = 4;                 /* 512×512 out, 4×4 coverage samples */
const CX = 208, CY = 262, A = 136, B = 86; /* body centre and half-extents */

function inTri(x, y, ax, ay, bx, by, cx, cy) {
  const s1 = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
  const s2 = (cx - bx) * (y - by) - (cy - by) * (x - bx);
  const s3 = (ax - cx) * (y - cy) - (ay - cy) * (x - cx);
  return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
}
/* the body tapers as (1-dx²)^0.55, which is a leaf, not an ellipse */
function body(x, y) {
  const dx = (x - CX) / A;
  if (dx < -1 || dx > 1) return false;
  return Math.abs((y - CY) / B) <= Math.pow(1 - dx * dx, 0.55);
}
function tail(x, y) {
  const dx = x - (CX + 0.70 * A), span = 1.06 * A;
  if (dx < 0 || dx > span) return false;
  const half = 1.30 * B * (dx / span);
  const ay = Math.abs(y - CY);
  if (ay > half) return false;
  const notch = dx > 0.68 * span ? 0.80 * half * (dx - 0.68 * span) / (0.32 * span) : 0;
  return ay >= notch;
}
const dorsal = (x, y) => inTri(x, y, CX - 0.34 * A, CY - 0.62 * B, CX - 0.10 * A, CY - 1.75 * B, CX + 0.30 * A, CY - 0.86 * B);
const pect = (x, y) => inTri(x, y, CX + 0.10 * A, CY + 0.55 * B, CX + 0.55 * A, CY + 1.35 * B, CX + 0.62 * A, CY + 0.62 * B);
const eye = (x, y) => {
  const dx = x - (CX + 0.58 * A), dy = y - (CY - 0.30 * B), r = 0.115 * A;
  return dx * dx + dy * dy <= r * r;
};
const inside = (x, y) => !eye(x, y) && (body(x, y) || tail(x, y) || dorsal(x, y) || pect(x, y));

/* ── rasterize ───────────────────────────────────────────────────────────── */
const rgba = Buffer.alloc(SIDE * SIDE * 4);
const step = 1 / SS, weight = 1 / (SS * SS);
let covered = 0;
for (let py = 0; py < SIDE; py++) for (let px = 0; px < SIDE; px++) {
  let hit = 0;
  for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++)
    if (inside(px + (sx + 0.5) * step, py + (sy + 0.5) * step)) hit++;
  const c = hit * weight, i = (py * SIDE + px) * 4;
  const v = Math.round(255 * (1 - c));
  rgba[i] = rgba[i + 1] = rgba[i + 2] = v; rgba[i + 3] = 255;
  covered += c;
}

/* ── PNG (colour type 6, 8-bit, filter 0 on every row) ───────────────────── */
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0;}
  return b => {let c = 0xffffffff; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0;};
})();
function chunk(type, data) {
  const len = Buffer.alloc(4), crc = Buffer.alloc(4), out = Buffer.alloc(8 + data.length + 4);
  len.writeUInt32BE(data.length, 0); out.write(type, 4, 'latin1');
  data.copy(out, 8); crc.writeUInt32BE(CRC(out.subarray(4, 8 + data.length)), 0);
  len.copy(out, 0); crc.copy(out, 8 + data.length); return out;
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIDE, 0); ihdr.writeUInt32BE(SIDE, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const raw = Buffer.alloc((SIDE * 4 + 1) * SIDE);
for (let y = 0; y < SIDE; y++) {
  raw[y * (SIDE * 4 + 1)] = 0;
  rgba.copy(raw, y * (SIDE * 4 + 1) + 1, y * SIDE * 4, (y + 1) * SIDE * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, {level: 9})), chunk('IEND', Buffer.alloc(0)),
]);
const out = process.argv[2] || new URL('fish.png', import.meta.url).pathname;
writeFileSync(out, png);

/* ── a 48×24 text preview, so the shape is checked before it is used ─────── */
const glyphs = ' .:-=+*#%@';
const lines = [];
for (let ty = 0; ty < 24; ty++) {
  let line = '';
  for (let tx = 0; tx < 48; tx++) {
    let sum = 0, n = 0;
    for (let py = Math.floor(ty * SIDE / 24); py < Math.floor((ty + 1) * SIDE / 24); py++)
      for (let px = Math.floor(tx * SIDE / 48); px < Math.floor((tx + 1) * SIDE / 48); px++) {
        sum += rgba[(py * SIDE + px) * 4] / 255; n++;
      }
    line += glyphs[Math.round((1 - sum / n) * 9)];
  }
  lines.push('|' + line + '|');
}
console.log(lines.join('\n'));
const dark = [...rgba].filter((_, i) => i % 4 === 0 && rgba[i] < 128).length;
console.log(`\n${out}  ${SIDE}×${SIDE} RGBA  ${(png.length / 1024).toFixed(1)} KB`);
console.log(`shape area ${covered.toFixed(1)} px = ${(100 * covered / (SIDE * SIDE)).toFixed(3)}% of the frame`);
console.log(`pixels at or below the 128 threshold: ${dark} (${(100 * dark / (SIDE * SIDE)).toFixed(3)}%)`);

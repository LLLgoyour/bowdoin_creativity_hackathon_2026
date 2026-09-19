/* probe-press.mjs — the press, measured against its own claim.
 *
 * The app claims: no card is painted in the colour it appears to be; every
 * colour is separated into three inks and the colour happens on the paper.
 * That claim is only worth making if the separation actually lands on the
 * colours the app names, so this loads the REAL renderer (src/w-render.js, the
 * same separate()/recipeFor()/AREA the browser runs — not a copy of the model)
 * and prints:
 *
 *   1. every palette colour, the ink recipe the press chose, and the CIE76 dE
 *      between what the app named and what the sheet will actually print;
 *   2. the same for the colours the worlds invent at runtime (LIFE pushes four
 *      per rule), because those are separated by the same code path;
 *   3. the flats three inks cannot reach, named, with their error;
 *   4. a format check on the palette: the separation parses #rrggbb, so a
 *      colour in any other format silently separates to bare paper. That was a
 *      real bug (mixHex used to return 'rgb(r,g,b)' and 24 of 44 colours
 *      printed as blank sheet), so it is asserted here;
 *   5. determinism: one seed gives one set of plate slips, another seed gives
 *      another, and the same seed always gives the same.
 *
 * usage: node tools/probe-press.mjs
 */
import {readFileSync, readdirSync} from 'node:fs';
import {performance} from 'node:perf_hooks';

const SRC = new URL('../src/', import.meta.url);
const order = ['core.js', 'w-field.js', 'w-synch.js', 'w-grav.js', 'w-rd.js',
               'w-life.js', 'data-gsfc.js', 'w-render.js'];
const present = readdirSync(SRC).filter(f => f.endsWith('.js'));
const files = order.filter(f => present.includes(f));
const src = files.map(f => `/* ${f} */\n` + readFileSync(new URL(f, SRC), 'utf8')).join('\n');

/* w-render.js only touches the DOM inside functions, so loading it needs no
   canvas. Anything that would reach for one is simply never called here. */
const BODY = `
${src}
return {PAL, INKS, PAPER, DOT, COV, AREA, separate, recipeFor, slips, snapPalette,
        toLab, hex2rgb, buildGamut, inkedHex, gamut: () => GAMUT};
`;
const api = new Function(BODY)();

const rgb2hex = c => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
const dE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/* replay the overprint the sheet does, from the recipe the press chose */
function printedFrom(cov) {
  const o = api.PAPER.slice();
  for (let p = 0; p < 3; p++) {
    const a = api.AREA[Math.round(cov[p] * 32)];
    if (!a) continue;
    for (let ch = 0; ch < 3; ch++)
      o[ch] = o[ch] * (1 - a) + (o[ch] * api.INKS[p].hex[ch] / 255) * a;
  }
  return o;
}

console.log('inks   ' + api.INKS.map((k, i) =>
  ['blue', 'pink', 'yellow'][i] + ' ' + rgb2hex(k.hex) + ' @' +
  Math.round(k.ang * 180 / Math.PI) + 'deg').join('   '));
console.log('paper  ' + rgb2hex(api.PAPER) + '   screen ruling DOT=' + api.DOT +
            ' device px   plate values ' + api.COV.length);

const t0 = performance.now();
api.buildGamut();
const t1 = performance.now();
console.log('gamut  ' + api.gamut().n.toLocaleString() +
            ' printable colours built in ' + (t1 - t0).toFixed(1) + ' ms\n');

const BASE = 12;
const rows = [];
for (let i = 0; i < api.PAL.length; i++) {
  const want = api.PAL[i];
  const cov = api.recipeFor(i);
  const got = printedFrom(cov);
  const e = dE(api.toLab(api.hex2rgb(want)), api.toLab(got));
  const mix = cov.map((v, k) => v > 0 ? ['B', 'P', 'Y'][k] + ' ' + Math.round(v * 32) + '/32' : '')
    .filter(Boolean).join(' + ') || 'bare paper';
  rows.push({i, want, got: rgb2hex(got), e, mix, base: i < BASE});
}
const show = r => String(r.i).padStart(3) + '  ' + r.want + ' -> ' + r.got + '  ' +
  r.mix.padEnd(30) + 'dE ' + r.e.toFixed(2);
console.log('the twelve flats the app names');
console.log('idx  named     printed    ink recipe                    error');
for (const r of rows.filter(r => r.base)) console.log(show(r));

const extra = rows.filter(r => !r.base);
console.log('\ncolours the worlds invent at runtime (' + extra.length + '), first 8');
for (const r of extra.slice(0, 8)) console.log(show(r));

const mean = a => a.reduce((s, r) => s + r.e, 0) / a.length;
const worst = a => a.reduce((m, r) => r.e > m.e ? r : m, a[0]);
console.log('\nmean dE  flats ' + mean(rows.filter(r => r.base)).toFixed(2) +
            '   runtime ' + (extra.length ? mean(extra).toFixed(2) : 'n/a') +
            '   all ' + mean(rows).toFixed(2));
console.log('worst dE ' + worst(rows).e.toFixed(2) + '  on ' + worst(rows).want);

const far = rows.filter(r => r.e > 15);
console.log('\nflats these three inks cannot reach (dE > 15): ' + far.length + ' of ' + rows.length);
for (const r of far) console.log('   ' + r.want + ' -> ' + r.got + '  dE ' + r.e.toFixed(2) +
  '   ' + r.mix);

/* the format check: a colour the separation cannot parse prints as bare paper */
const bad = api.PAL.filter(c => !/^#[0-9a-fA-F]{6}$/.test(c));
const blank = rows.filter(r => r.mix === 'bare paper' && r.want.toLowerCase() !== '#f2efe4');
console.log('\npalette format  ' + api.PAL.length + ' colours, ' + bad.length +
            ' unparseable ' + (bad.length ? 'FAIL ' + bad.slice(0, 4).join(' ') : 'ok'));
console.log('blank prints    ' + blank.length + ' colour(s) separate to bare paper ' +
            (blank.length ? 'FAIL' : 'ok'));

/* the alignment the app boots with: after snapPalette() the colour the rail
   shows, the colour the proof panels draw and the colour the sheet prints are
   one colour. Anything above zero here is a rail that lies about the sheet. */
api.snapPalette();
let maxAfter = 0, movedMax = 0, moved = 0;
for (let i = 0; i < api.PAL.length; i++) {
  const after = dE(api.toLab(api.hex2rgb(api.PAL[i])),
                   api.toLab(printedFrom(api.recipeFor(i))));
  if (after > maxAfter) maxAfter = after;
  const d = rows[i].e;
  if (d > 0.5) { moved++; if (d > movedMax) movedMax = d; }
}
console.log('\nafter snapPalette()');
console.log('named vs printed  max dE ' + maxAfter.toFixed(4) +
            ' across all ' + api.PAL.length + ' colours ' + (maxAfter < 0.75 ? 'ok' : 'FAIL'));
console.log('palette moved     ' + moved + ' colours shifted to a printable one, ' +
            'largest shift dE ' + movedMax.toFixed(2));
console.log('e.g.              ' + rows.slice(0, 4).map(r => r.want + '->' + api.PAL[r.i]).join('  '));

/* determinism of the registration slip */
const a1 = JSON.stringify(api.slips(7)), a2 = JSON.stringify(api.slips(7)),
      b1 = JSON.stringify(api.slips(8));
console.log('\nregistration    seed 7 == seed 7 : ' + (a1 === a2) +
            '   seed 7 != seed 8 : ' + (a1 !== b1));
console.log('slip seed 7     ' + JSON.parse(a1).map(s =>
  '(' + s.dx.toFixed(2) + ',' + s.dy.toFixed(2) + ')').join(' '));

const fails = (bad.length ? 1 : 0) + (blank.length ? 1 : 0) +
              (maxAfter < 0.75 ? 0 : 1) +
              (a1 === a2 && a1 !== b1 ? 0 : 1);
console.log('\n' + (fails ? 'FAIL ' + fails + ' check(s)' : 'all checks pass'));
process.exit(fails ? 1 : 0);

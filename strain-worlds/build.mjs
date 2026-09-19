/* build.mjs — inline every <script src="src/…"> of shell.html into one file.
   The load order in shell.html is the single source of truth. */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
let html = readFileSync(resolve(root, 'shell.html'), 'utf8');
const tags = [...html.matchAll(/[ \t]*<script src="([^"]+)"><\/script>\n?/g)];
if (!tags.length) throw new Error('no <script src> tags found in shell.html');

const inlined = [];

for (const [tag, src] of tags) {
  let js;
  try { js = readFileSync(resolve(root, src), 'utf8'); }
  catch { console.warn(`  ! ${src} missing — skipped (module will be reported absent at runtime)`); continue; }
  if (/<\/script/i.test(js)) throw new Error(`${src} contains </script>`);
  html = html.replace(tag, `<script>\n${js}</script>\n`);
  inlined.push(src);
}
const out = process.argv[2] || resolve(root, '..', 'strain-worlds.html');
writeFileSync(out, html);
const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(1) + ' KB';
console.log(`inlined ${inlined.length}/${tags.length} modules -> ${out}  (${kb(html)}, ${inlined.map(s => s.replace('src/','')).join(' ')})`);

/* ═══════════════════════════════════════════════════════════════════════════
   core.js — shared vocabulary. DOM-free, dependency-free, loaded first.
   Everything in src/ may use these; nothing in src/ may redefine them.
   ═══════════════════════════════════════════════════════════════════════════ */

/* the flats a paper card may be printed in — one palette for the whole app */
const PAL = ['#f6c344','#e8563f','#3f8fe0','#57ac4a','#8a63d2','#e08a3c',
             '#3fb8a0','#d4527e','#a9c93f','#5a7fd8','#f2efe4','#8a6a4a'];
const INK = '#2a1a10';                      /* the cut-paper outline */

function clamp(v,a,b){return v<a?a:(v>b?b:v);}
function lerp(a,b,t){return a+(b-a)*t;}
function h2(x,y){let h=Math.imul(x|0,73856093)^Math.imul(y|0,19349663);h^=h>>>13;
  h=Math.imul(h,1274126177);return((h^h>>>16)>>>0)/4294967296;}
function mulberry32(a){return function(){a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);
  t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function hex2rgb(h){return[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];}
function mixHex(a,b,t){const A=hex2rgb(a),B=hex2rgb(b);
  return'rgb('+Math.round(lerp(A[0],B[0],t))+','+Math.round(lerp(A[1],B[1],t))+','+Math.round(lerp(A[2],B[2],t))+')';}
function decodeF64(b64){
  const bin=(typeof atob!=='undefined')?atob(b64):Buffer.from(b64,'base64').toString('binary');
  const n=bin.length,u=new Uint8Array(n);
  for(let i=0;i<n;i++)u[i]=bin.charCodeAt(i);
  return new Float64Array(u.buffer);
}
function rr(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}

/* ── registries ──────────────────────────────────────────────────────────────
   A field builder turns a record into w*h of geometry.
   A world is a local rule that turns that geometry into something alive. */
const FIELDS=[], WORLDS=[];
function defField(o){FIELDS.push(o);}          /* o = {id,label,blurb,build} */
function defWorld(o){WORLDS.push(o);}          /* see CONTRACT.md for o's shape */
function fieldById(id){return FIELDS.find(f=>f.id===id)||FIELDS[0];}
function worldById(id){return WORLDS.find(w=>w.id===id)||WORLDS[0];}

/* ── the view: what a world hands the renderer every frame ───────────────────
   Fixed-shape typed arrays, allocated once, reused forever. No per-frame
   allocation anywhere in the hot path. */
function newView(n){return{
  n, live:new Uint8Array(n),      /* 1 = a card stands here                       */
  col:new Uint8Array(n),          /* palette index (0..PAL.length-1)              */
  face:new Uint8Array(n),         /* 1 = the card has grown eyes                  */
  flip:new Float32Array(n),       /* 0..1 paper-flip progress (1 = edge-on, gone) */
  lift:new Float32Array(n),       /* vertical offset in cells (negative = up)     */
  spin:new Float32Array(n),       /* -1..1 lean, in radians/3                     */
  stack:new Uint8Array(n),        /* extra cards under the top one (0 = single)   */
  spark:new Float32Array(n)};}    /* 0..1 starburst                                */
function clearView(V){V.live.fill(0);V.col.fill(0);V.face.fill(0);
  V.flip.fill(0);V.lift.fill(0);V.spin.fill(0);V.stack.fill(0);V.spark.fill(0);}
function viewLive(V){let c=0;for(let i=0;i<V.n;i++)if(V.live[i])c++;return c;}

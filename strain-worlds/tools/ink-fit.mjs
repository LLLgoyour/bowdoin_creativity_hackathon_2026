/* ink-fit — how close can three inks on this paper get to the twelve flats?
   The press cannot choose a colour: it can only decide how much of each of the
   three inks lands on the sheet. This measures, for every palette slot, the
   error of the current on/off recipe and the error of the best recipe the press
   can actually hold (coverage in eighths of a plate), in CIE76 dE against the
   flat the app names. It prints numbers; it changes nothing. */
const PAL = ['#f6c344','#e8563f','#3f8fe0','#57ac4a','#8a63d2','#e08a3c',
             '#3fb8a0','#d4527e','#a9c93f','#5a7fd8','#f2efe4','#8a6a4a'];
const INKS=[[31,111,198],[255,79,176],[255,210,30]];
const PAPER=[243,236,221];
const RECIPE=[[0,1,0],[1,1,0],[0,1,1],[1,0,1],[1,0,0],[0,0,1],
              [1,1,1],[0,1,1],[1,1,0],[1,0,1],[0,1,0],[1,0,0]];
const NAMES=['B','P','Y'];

const hex2rgb=h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
const rgb2hex=c=>'#'+c.map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');

/* The plate does not hold "ink fraction", it holds a value the screen turns
   into dots: radius^2 = c * DOT^2 * 0.66 on a DOT lattice. Dots overlap, so
   inked area is not linear in c. Measure the real curve off the same law the
   renderer uses, by sampling one screen cell. */
const DOT=2.6;
function areaOf(c){
  if(c<=0)return 0;
  const r2=c*DOT*DOT*0.66, N=48;   /* same sampling the renderer uses */
  let hit=0;
  for(let i=0;i<N;i++)for(let j=0;j<N;j++){
    const x=(i+0.5)/N*DOT, y=(j+0.5)/N*DOT;
    /* nearest lattice centre is one of the four cell corners */
    let best=Infinity;
    for(const cx of [0,DOT])for(const cy of [0,DOT]){
      const d=(x-cx)*(x-cx)+(y-cy)*(y-cy);
      if(d<best)best=d;
    }
    if(best<=r2)hit++;
  }
  return hit/(N*N);
}
/* the press's own model: a plate inks `area` of the sheet, and the three
   plates multiply. This is exactly what pullSheet() does. */
function printed(cv){
  const o=PAPER.slice();
  for(let p=0;p<3;p++){
    const a=areaOf(cv[p]);
    if(a<=0)continue;
    for(let ch=0;ch<3;ch++){
      const inked=o[ch]*INKS[p][ch]/255;
      o[ch]=o[ch]*(1-a)+inked*a;
    }
  }
  return o;
}
/* CIE76 in Lab, D65 */
function lab(c){
  const f=v=>{v/=255;v=v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4);return v;};
  const r=f(c[0]),g=f(c[1]),b=f(c[2]);
  let X=(r*0.4124+g*0.3576+b*0.1805)/0.95047;
  let Y=(r*0.2126+g*0.7152+b*0.0722);
  let Z=(r*0.0193+g*0.1192+b*0.9505)/1.08883;
  const k=t=>t>0.008856?Math.cbrt(t):(7.787*t+16/116);
  X=k(X);Y=k(Y);Z=k(Z);
  return [116*Y-16,500*(X-Y),200*(Y-Z)];
}
const dE=(c1,c2)=>{const a=lab(c1),b=lab(c2);
  return Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);};

/* the plate value is searched in 32nds: the screen saturates near c=0.48, so
   every usable tint lives in the bottom half of the range */
const STEPS=[];for(let i=0;i<=32;i++)STEPS.push(i/32);
const AREA=new Map(STEPS.map(c=>[c,areaOf(c)]));
function printedFast(cv){
  const o=PAPER.slice();
  for(let p=0;p<3;p++){
    const a=AREA.get(cv[p]);
    if(!a)continue;
    for(let ch=0;ch<3;ch++)o[ch]=o[ch]*(1-a)+(o[ch]*INKS[p][ch]/255)*a;
  }
  return o;
}
let rowsBin=0,rowsFit=0;
const out=[];
for(let i=0;i<PAL.length;i++){
  const want=hex2rgb(PAL[i]);
  const bin=printed(RECIPE[i].map(v=>v*0.92));   /* on/off cards ink at alpha .92 */
  const eBin=dE(want,bin);
  let best=null;
  for(const ab of STEPS)for(const ap of STEPS)for(const ay of STEPS){
    const got=printedFast([ab,ap,ay]), e=dE(want,got);
    if(!best||e<best.e)best={a:[ab,ap,ay],got,e};
  }
  rowsBin+=eBin;rowsFit+=best.e;
  out.push({slot:i,want:PAL[i],
    bin:rgb2hex(bin),eBin:+eBin.toFixed(2),
    binMix:RECIPE[i].map((v,k)=>v?NAMES[k]:'').filter(Boolean).join('+')||'paper',
    fit:rgb2hex(best.got),eFit:+best.e.toFixed(2),
    fitMix:best.a.map((v,k)=>v?NAMES[k]+' '+Math.round(v*32)+'/32':'').filter(Boolean).join(' + ')||'paper',
    cov:best.a});
}
console.log('slot  want     on/off            dE     fitted coverage                   dE');
for(const r of out)
  console.log(String(r.slot).padStart(3)+'  '+r.want+'  '+
    (r.bin+' '+r.binMix).padEnd(18)+String(r.eBin).padStart(6)+'   '+
    (r.fit+' '+r.fitMix).padEnd(33)+String(r.eFit).padStart(6));
console.log('\nmean dE   on/off '+(rowsBin/PAL.length).toFixed(2)+
            '   fitted '+(rowsFit/PAL.length).toFixed(2));
console.log('worst dE  on/off '+Math.max(...out.map(r=>r.eBin)).toFixed(2)+
            '   fitted '+Math.max(...out.map(r=>r.eFit)).toFixed(2));
const far=out.filter(r=>r.eFit>15).map(r=>r.slot+' '+r.want+' dE '+r.eFit);
console.log('flats these three inks cannot reach (dE>15): '+(far.join(' · ')||'none'));
console.log('\nconst RECIPE=[  /* plate coverage: blue, pink, yellow */');
console.log(out.map(r=>'  ['+r.cov.map(v=>v.toFixed(4)).join(',')+'], /* '+r.want+
  '  '+r.fitMix+'  dE '+r.eFit+' */').join('\n'));
console.log('];');

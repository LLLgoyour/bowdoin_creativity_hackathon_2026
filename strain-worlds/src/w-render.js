/* ═══════════════════════════════════════════════════════════════════════════
   w-render.js — the paper-craft renderer. DOM side (with w-app.js).
   Draws the sheet and its cards. It knows nothing
   about any particular world: a world hands over a view, the renderer draws
   exactly one card per live cell and nothing else.
   ═══════════════════════════════════════════════════════════════════════════ */
const R = { W:0, H:0, side:0, bx:0, by:0, M:52, cs:11, clock:0, bob:1,
            sparkBudget:8, slipScale:1, inkKey:[1,1,1], gain:1.75 };

function stageCtx(){
  const cv=document.getElementById('stage');
  const dpr=Math.min(2,window.devicePixelRatio||1);
  const W=window.innerWidth,H=window.innerHeight;
  R.W=W;R.H=H;
  const w=Math.max(1,Math.round(W*dpr)),h=Math.max(1,Math.round(H*dpr));
  if(cv.width!==w||cv.height!==h){cv.width=w;cv.height=h;}
  cv.style.width=W+'px';cv.style.height=H+'px';
  const ctx=cv.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
  return ctx;
}
function setM(M){R.M=M;R.cs=R.side/M;}

/* ── THE PRESS ───────────────────────────────────────────────────────────────
   Nothing below paints a card's colour. Three inks are laid as separate
   plates — BLUE, FLUORESCENT PINK, YELLOW — each halftoned on its own screen
   angle, each shifted by its own seeded registration error, and the sheet is
   the product of the three. A card is never filled with the colour it looks
   like: it is separated into how much of each ink that colour takes (see the
   separation, below), and the colour happens on the paper. The cut line and
   the eyes print on blue AND pink, so even the near-black is two inks meeting.
   Change the seed and the same board re-prints with different registration
   slip and different grain — the press pulls another copy. */
const INKS=[{hex:[31,111,198],ang:15*Math.PI/180},      /* blue */
            {hex:[255,79,176],ang:75*Math.PI/180},      /* fluorescent pink */
            {hex:[255,210,30],ang:45*Math.PI/180}];     /* yellow */
/* ── the separation ──────────────────────────────────────────────────────────
   No card is painted in the colour it appears to be. Every colour the app
   names is SEPARATED here: the press searches how much of each of its three
   inks, screened and overprinted on this paper, lands closest to that colour,
   and prints that. Worlds are free to invent colours at runtime (LIFE pushes
   four per rule); they get separated the same way, because the separation is a
   function of the colour, not a table someone kept in sync by hand.
   Measured by tools/ink-fit.mjs against the twelve flats: a hand-kept on/off
   table was mean dE 79.65 (worst 139.39); this search is mean dE 12.02
   (worst 27.71, all five misses are greens and violets that blue+pink+yellow
   genuinely cannot reach). */
const PAPER=[243,236,221], DOT=2.6;
const COV=[];for(let i=0;i<=32;i++)COV.push(i/32);
/* inked area is not linear in a plate's value: the dots overlap. Measure the
   real curve off the same law pullSheet() screens with. */
const AREA=COV.map(c=>{
  if(c<=0)return 0;
  const r2=c*DOT*DOT*0.66, N=48;
  let hit=0;
  for(let i=0;i<N;i++)for(let j=0;j<N;j++){
    const x=(i+0.5)/N*DOT, y=(j+0.5)/N*DOT;
    let best=Infinity;
    for(const cx of [0,DOT])for(const cy of [0,DOT]){
      const d=(x-cx)*(x-cx)+(y-cy)*(y-cy);if(d<best)best=d;
    }
    if(best<=r2)hit++;
  }
  return hit/(N*N);
});
function srgbLin(v){v/=255;return v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4);}
function toLab(c){
  const r=srgbLin(c[0]),g=srgbLin(c[1]),b=srgbLin(c[2]);
  let X=(r*0.4124+g*0.3576+b*0.1805)/0.95047;
  let Y=(r*0.2126+g*0.7152+b*0.0722);
  let Z=(r*0.0193+g*0.1192+b*0.9505)/1.08883;
  const k=t=>t>0.008856?Math.cbrt(t):(7.787*t+16/116);
  X=k(X);Y=k(Y);Z=k(Z);
  return [116*Y-16,500*(X-Y),200*(Y-Z)];
}
/* Every colour this press can physically make, built once: 33^3 coverage
   triples, each carried through the same overprint the sheet uses and stored
   in Lab. Separating a colour is then one nearest-neighbour scan of this
   gamut — which is the honest statement of what the press is. */
let GAMUT=null;
function buildGamut(){
  const n=COV.length, N=n*n*n;
  const L=new Float32Array(N),A=new Float32Array(N),B=new Float32Array(N);
  const ci=new Uint8Array(N*3);
  let k=0;
  for(let bi=0;bi<n;bi++){
    const ab=AREA[bi], i0=INKS[0].hex;
    const b0=PAPER[0]*(1-ab)+PAPER[0]*(i0[0]/255)*ab;
    const b1=PAPER[1]*(1-ab)+PAPER[1]*(i0[1]/255)*ab;
    const b2=PAPER[2]*(1-ab)+PAPER[2]*(i0[2]/255)*ab;
    for(let pi=0;pi<n;pi++){
      const ap=AREA[pi], i1=INKS[1].hex;
      const p0=b0*(1-ap)+b0*(i1[0]/255)*ap;
      const p1=b1*(1-ap)+b1*(i1[1]/255)*ap;
      const p2=b2*(1-ap)+b2*(i1[2]/255)*ap;
      for(let yi=0;yi<n;yi++,k++){
        const ay=AREA[yi], i2=INKS[2].hex;
        const lab=toLab([p0*(1-ay)+p0*(i2[0]/255)*ay,
                         p1*(1-ay)+p1*(i2[1]/255)*ay,
                         p2*(1-ay)+p2*(i2[2]/255)*ay]);
        L[k]=lab[0];A[k]=lab[1];B[k]=lab[2];
        ci[k*3]=bi;ci[k*3+1]=pi;ci[k*3+2]=yi;
      }
    }
  }
  GAMUT={L:L,A:A,B:B,ci:ci,n:N};
}
const SEP=new Map();
function separate(hex){
  let s=SEP.get(hex);
  if(s)return s;
  if(!GAMUT)buildGamut();
  const w=toLab(hex2rgb(hex)), wl=w[0],wa=w[1],wb=w[2];
  const G=GAMUT;
  let bi=0,be=Infinity;
  for(let i=0;i<G.n;i++){
    const dl=G.L[i]-wl, da=G.A[i]-wa, db=G.B[i]-wb;
    const e=dl*dl+da*da+db*db;
    if(e<be){be=e;bi=i;}
  }
  s=[COV[G.ci[bi*3]],COV[G.ci[bi*3+1]],COV[G.ci[bi*3+2]]];
  s.dE=Math.sqrt(be);
  SEP.set(hex,s);
  return s;
}
/* what a recipe actually puts on the paper */
function inkedHex(cov){
  const o=PAPER.slice();
  for(let p=0;p<3;p++){
    const a=AREA[Math.round(cov[p]*32)];
    if(!a)continue;
    for(let ch=0;ch<3;ch++)o[ch]=o[ch]*(1-a)+(o[ch]*INKS[p].hex[ch]/255)*a;
  }
  return '#'+o.map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');
}
/* the separation for a palette index, cached: PAL grows at runtime */
const SEPI=[];
function recipeFor(ci){
  const idx=ci%PAL.length;
  return SEPI[idx]||(SEPI[idx]=separate(PAL[idx]));
}
/* Align the palette with the press. A shop cannot name a colour it cannot
   print: every flat is replaced by what these three inks actually lay down
   for it, so the chip in the rail, the proof panel and the pulled sheet are
   the same colour rather than three opinions about one. Called once at boot,
   after the worlds have pushed the colours they invent. The press loses the
   saturated greens and teals that blue+yellow cannot reach — that loss is the
   press's character, and it is now visible everywhere instead of only on the
   sheet. */
function snapPalette(){
  for(let i=0;i<PAL.length;i++){
    const cov=separate(PAL[i]);
    PAL[i]=inkedHex(cov);
    SEPI[i]=cov;
  }
}
function printSeed(){
  return (typeof APP!=='undefined'&&APP&&APP.seed!=null)?(APP.seed|0):1;
}
/* Registration is something the operator brings in at makeready, not a fixed
   property of the press: R.slipScale multiplies every plate's slip, so 0 is a
   press that is somehow in register (or a shop that has not started yet) and 3
   is a sheet to throw away. The seeded draw is unchanged, so scaling the slip
   never changes which way each plate went out. */
function slips(seed){
  const r=mulberry32(seed^0x9e37c1), s=R.slipScale==null?1:R.slipScale;
  /* s is one number for the whole press, or one PER PLATE: the operator's three
     register pins each walk their own plate, so the shop asks for three. The
     seeded draw is unchanged either way — scaling the slip never changes which
     way each plate went out. */
  return INKS.map((ink,p)=>{
    const sp=(s&&s.length)?(s[p]==null?1:s[p]):s;
    return {dx:(r()*2-1)*2.1*sp,dy:(r()*2-1)*2.1*sp};
  });
}
/* The registration error actually in force, in device pixels: the largest
   distance between any two of the three plates. This is the number the proof
   prints and the operator reads off the registration targets — one number for
   "how far out is this sheet", not six offsets. */
function measuredSlip(seed){
  const sl=slips(seed==null?printSeed():seed|0);
  let worst=0;
  for(let i=0;i<sl.length;i++)
    for(let j=i+1;j<sl.length;j++)
      worst=Math.max(worst,Math.hypot(sl[i].dx-sl[j].dx,sl[i].dy-sl[j].dy));
  return worst;
}
function plates(side){
  if(!R._pl||R._pl.side!==side){
    R._pl={side:side,c:[0,1,2].map(()=>{
      const c=document.createElement('canvas');c.width=side;c.height=side;return c;})};
  }
  return R._pl.c;
}
/* one card, drawn as coverage (white on black) onto whichever plates print it */
function pcard(c,X,Y,w,h,alpha){
  if(w<0.7||alpha<=0.02)return;
  const r=Math.max(1.2,w*0.22);
  c.globalAlpha=alpha;rr(c,X,Y,w,h,r);c.fill();
}
function pline(c,X,Y,w,h,lw,alpha){
  if(w<0.7)return;
  const r=Math.max(1.2,w*0.22);
  c.globalAlpha=alpha;c.lineWidth=lw;rr(c,X,Y,w,h,r);c.stroke();
}
function peyes(c,X,Y,w,h,alpha){
  /* nothing finer than the screen ruling survives the halftone, so a pupil is
     never drawn smaller than one dot — the same rule a printer works to */
  const r=Math.max(DOT*0.78,w*0.115);
  c.globalAlpha=alpha;
  c.beginPath();c.arc(X+w*0.35,Y+h*0.44,r,0,6.2832);
  c.arc(X+w*0.66,Y+h*0.44,r,0,6.2832);c.fill();
}
function pstar(c,cx,cy,r,al){
  if(al<=0.03)return;
  c.globalAlpha=Math.min(1,al);c.lineWidth=Math.max(0.8,r*0.16);
  c.beginPath();
  c.moveTo(cx-r,cy);c.lineTo(cx+r,cy);c.moveTo(cx,cy-r);c.lineTo(cx,cy+r);
  c.moveTo(cx-r*0.55,cy-r*0.55);c.lineTo(cx+r*0.55,cy+r*0.55);
  c.moveTo(cx+r*0.55,cy-r*0.55);c.lineTo(cx-r*0.55,cy+r*0.55);
  c.stroke();
}
/* lay every card down on its plates */
function inkCards(pc,V,M,cs){
  const bobOn=R.bob?cs*0.055:0;
  let burst=Math.max(0,R.sparkBudget|0), sparkOn=cs>=7;
  const lw=Math.max(DOT,cs*0.085);   /* a cut line thinner than the screen prints as nothing */
  for(let y=0,i=0;y<M;y++){
    for(let x=0;x<M;x++,i++){
      const live=V.live[i],fl=V.flip[i];
      if(!live&&fl<=0)continue;
      const bob=bobOn*Math.sin(R.clock*2.1+x*0.8+y*0.55);
      const X=x*cs, Y=y*cs+V.lift[i]*cs+bob;
      const rec=recipeFor(V.col[i]);   /* how much of each ink this colour is */
      if(sparkOn&&burst>0&&V.spark[i]>0){       /* births pop on yellow alone */
        pstar(pc[2],X+cs/2,Y+cs/2,cs*0.34,V.spark[i]);burst--;
      }
      if(live){
        const up=V.stack?V.stack[i]:0;
        if(up)for(let s=up;s>=1;s--){
          const o=s*cs*0.20, inset=s*cs*0.05;
          for(let p=0;p<3;p++)if(rec[p]>0)
            pcard(pc[p],X+inset,Y-o+inset,cs-inset*2,cs-inset*2,rec[p]*0.72);
        }
        for(let p=0;p<3;p++)if(rec[p]>0)pcard(pc[p],X,Y,cs,cs,rec[p]);
        /* the cut line and the eyes print on blue AND pink, so the dark comes
           from two inks meeting, never from a dark fill */
        pline(pc[0],X,Y,cs,cs,lw,0.55);pline(pc[1],X,Y,cs,cs,lw,0.55);
        if(V.face[i]&&cs>=8){peyes(pc[0],X,Y,cs,cs,0.95);peyes(pc[1],X,Y,cs,cs,0.95);}
      }
      if(fl>0){
        const t=Math.min(1,fl), sx=cs*Math.abs(Math.cos(t*Math.PI*0.5));
        for(let p=0;p<3;p++)if(rec[p]>0)
          pcard(pc[p],X+(cs-sx)/2,Y-t*cs*0.5,sx,cs,rec[p]*(1-t*0.9));
      }
    }
  }
}
/* halftone the three plates and overprint them onto the sheet.
   Per-pixel rather than per-dot: for each pixel find its screen cell at that
   plate's angle, read the plate's coverage at the cell centre, and ink the
   pixel if it falls inside a dot of radius sqrt(coverage). */
/* Screen centres only move when a register pin or sheet size changes. Keep
   one map per plate, not per seed or frame; old maps are replaced in place.
   Float64 preserves the original dot-boundary decisions exactly. */
function screenMap(S,p,sl){
  const maps=R._screens||(R._screens=[]);
  let m=maps[p];
  if(m&&m.S===S&&m.dx===sl.dx&&m.dy===sl.dy)return m;
  if(!m||m.S!==S)m=maps[p]={S:S,index:new Int32Array(S*S),distance:new Float64Array(S*S)};
  m.dx=sl.dx;m.dy=sl.dy;
  const ca=Math.cos(INKS[p].ang),sa=Math.sin(INKS[p].ang),cx=S/2,cy=S/2;
  for(let y=0,i=0;y<S;y++)for(let x=0;x<S;x++,i++){
    const fx=x-sl.dx-cx,fy=y-sl.dy-cy;
    const u=fx*ca+fy*sa,v=-fx*sa+fy*ca;
    const su=Math.round(u/DOT)*DOT,sv=Math.round(v/DOT)*DOT;
    const sx=su*ca-sv*sa+cx+sl.dx,sy=su*sa+sv*ca+cy+sl.dy;
    const gx=sx|0,gy=sy|0,dx=x-sx,dy=y-sy;
    m.index[i]=gx<0||gy<0||gx>=S||gy>=S?-1:(gy*S+gx)*4;
    m.distance[i]=dx*dx+dy*dy;
  }
  return m;
}
function pullSheet(ctx,side,ox,oy,seed){
  const S=Math.max(1,Math.round(side));
  const pc=plates(S), sl=slips(seed);
  const cov=[];
  for(let p=0;p<3;p++)cov.push(pc[p].getContext('2d').getImageData(0,0,S,S).data);
  let buf=R._sheet;
  if(!buf||buf.S!==S)buf=R._sheet={S:S,out:ctx.createImageData(S,S),grain:new Float64Array(S*S)};
  if(buf.seed!==seed){
    const gr=mulberry32(seed^0x51ed27);
    for(let i=0;i<buf.grain.length;i++)buf.grain[i]=(gr()*2-1)*9;
    buf.seed=seed;
  }
  const out=buf.out,od=out.data;
  for(let i=0,px=0;px<S*S;px++){
    od[i++]=PAPER[0];od[i++]=PAPER[1];od[i++]=PAPER[2];od[i++]=255;
  }
  for(let p=0;p<3;p++){
    const d=cov[p],map=screenMap(S,p,sl[p]),key=R.inkKey?R.inkKey[p]:1;
    const ir=INKS[p].hex[0]/255,ig=INKS[p].hex[1]/255,ib=INKS[p].hex[2]/255;
    for(let i=0,o=0;i<map.index.length;i++,o+=4){
      const at=map.index[i];
      if(at<0)continue;
      const c=(d[at]/255)*key;
      if(c<=0.03||map.distance[i]>c*DOT*DOT*0.66)continue;
      od[o]=od[o]*ir;od[o+1]=od[o+1]*ig;od[o+2]=od[o+2]*ib;
    }
  }
  /* paper grain, seeded: the sheet's own fibre, over the ink */
  for(let o=0;o<od.length;o+=4){
    const n=buf.grain[o/4];
    od[o]=od[o]+n<0?0:(od[o]+n>255?255:od[o]+n);
    od[o+1]=od[o+1]+n<0?0:(od[o+1]+n>255?255:od[o+1]+n);
    od[o+2]=od[o+2]+n<0?0:(od[o+2]+n>255?255:od[o+2]+n);
  }
  ctx.putImageData(out,ox,oy);
}
/* ── the sheet's furniture ───────────────────────────────────────────────────
   A real sheet is not just the image. It carries crop marks that say where the
   trim is, and a colour bar the printer reads to check ink density and
   registration. Both are printed HERE, on the same three plates as the cards,
   for the same reason a press prints them: they are the only way to SEE a
   registration slip. If the marks line up, the plates line up. */
function cropMarks(pc,x0,y0,inner,k){
  const L=10*k, o=5*k, lw=Math.max(1.2,1.4*k);
  for(let p=0;p<3;p++){
    const g=pc[p];g.globalAlpha=0.95;g.lineWidth=lw;g.beginPath();
    for(const [cx,cy,sx,sy] of [[x0,y0,-1,-1],[x0+inner,y0,1,-1],
                                [x0,y0+inner,-1,1],[x0+inner,y0+inner,1,1]]){
      g.moveTo(cx+sx*o,cy);g.lineTo(cx+sx*(o+L),cy);
      g.moveTo(cx,cy+sy*o);g.lineTo(cx,cy+sy*(o+L));
    }
    g.stroke();g.globalAlpha=1;
  }
}
/* Registration targets, at the four midpoints of the trim edge. Every plate
   prints the same circle-and-cross; each plate is slipped by its own seeded
   error, so a misregistered sheet shows them as coloured fringes and a
   registered one shows a single black mark. They are the operator's instrument
   during makeready, so they are sized off the screen ruling rather than off
   taste: a mark thinner than one dot halftones away to nothing. */
function regTargets(pc,x0,y0,inner,k){
  const r=Math.max(DOT*2,5.5*k), lw=Math.max(DOT,1.4*k), arm=r*1.6;
  const at=[[x0+inner*0.5,y0],[x0+inner,y0+inner*0.5],
            [x0+inner*0.5,y0+inner],[x0,y0+inner*0.5]];
  for(let p=0;p<3;p++){
    const g=pc[p];g.globalAlpha=0.95;g.lineWidth=lw;g.beginPath();
    for(const [cx,cy] of at){
      g.moveTo(cx+r,cy);g.arc(cx,cy,r,0,6.2832);
      g.moveTo(cx-arm,cy);g.lineTo(cx+arm,cy);
      g.moveTo(cx,cy-arm);g.lineTo(cx,cy+arm);
    }
    g.stroke();g.globalAlpha=1;
  }
}
/* the press-check strip: each ink alone, each ink at half tint, then the three
   overprints. Reading left to right you can see every colour this press can
   make and exactly how far the plates have slipped. */
const BAR=[[1,0,0],[0,1,0],[0,0,1],[1,1,0],[0,1,1],[1,0,1],[1,1,1]];
function checkStrip(pc,x0,y,w,hgt,k){
  const n=BAR.length*2, cw=w/n;
  for(let i=0;i<n;i++){
    const rec=BAR[i>>1], half=(i&1)===1;
    for(let p=0;p<3;p++){
      if(!rec[p])continue;
      const g=pc[p];g.globalAlpha=half?0.45:0.95;
      g.fillRect(x0+i*cw+0.6*k,y,cw-1.2*k,hgt);g.globalAlpha=1;
    }
  }
}
/* the stamp is set to the width it has been given: a sheet whose edition line
   runs off the trim is a misprint, not a style. `align` is optional ('start'
   is the default a footer wants); a centred line is used where the sheet has
   nothing else on that edge to line up with. `bold` is for the slug that
   shares the band with the stamp. */
function stampText(pc,x,y,txt,px,maxW,align,bold){
  const m=pc[0];
  let size=px;
  for(;;){
    m.font=(bold?'bold ':'')+size+'px ui-monospace,Menlo,monospace';
    if(size<=6||m.measureText(txt).width<=maxW)break;
    size-=0.5;
  }
  for(let p=0;p<3;p++){
    const g=pc[p];g.globalAlpha=0.9;
    g.font=(bold?'bold ':'')+size+'px ui-monospace,Menlo,monospace';
    if(align)g.textAlign=align;
    g.fillText(txt,x,y);g.globalAlpha=1;g.textAlign='left';
  }
  return size;
}
/* One line, one size. A proof's band has more to say than a makeready sheet's
   (the slug and the registration error), and setting the slug off a fixed
   multiple of the margin while the stamp shrinks to fit would leave a footer
   whose label is three times its own text. So the size is solved once, for the
   two of them together, and the slug is only set apart by being bold. */
function bandSize(pc,slug,line,px,maxW){
  const m=pc[0];
  let size=px;
  for(;;){
    m.font='bold '+size+'px ui-monospace,Menlo,monospace';
    const sw=m.measureText(slug).width+size*0.5;
    m.font=size+'px ui-monospace,Menlo,monospace';
    if(size<=6||sw+m.measureText(line).width<=maxW)break;
    size-=0.5;
  }
  return size;
}
/* A makeready sheet is scrap, and it says so across its own face. The slug is
   printed through all three plates like every other mark on the sheet, for the
   same reason the check strip is: even the notice that this is not an edition
   has to show the registration slip. Low alpha, or the scrap would read as the
   picture. */
function makereadySlug(pc,cx,cy,inner){
  const txt='MAKEREADY - NOT FOR EDITION';
  const m=pc[0], diag=inner*Math.SQRT2;
  let size=Math.max(10,Math.round(inner*0.09));
  for(;;){
    m.font='bold '+size+'px ui-monospace,Menlo,monospace';
    if(size<=10||m.measureText(txt).width<=diag*0.86)break;
    size--;
  }
  for(let p=0;p<3;p++){
    const g=pc[p];
    g.save();
    g.globalAlpha=0.24;
    g.translate(cx,cy);g.rotate(-Math.PI/4);
    g.font='bold '+size+'px ui-monospace,Menlo,monospace';
    g.textAlign='center';g.textBaseline='middle';
    g.fillText(txt,0,0);
    g.restore();
  }
}
/* ── the board ───────────────────────────────────────────────────────────── */
/* The furniture on the sheet is a function of the workflow state, because that
   is the only way to teach what the furniture is for: a makeready sheet is
   visibly misregistered scrap, a proof carries every instrument the operator
   has, and an approved edition pull is trimmed clean and carries nothing but
   the line that says which pull it is. `opts.mode`:
     'makeready'  crop marks + check strip + stamp + the diagonal scrap slug
     'proof'      the same, PLUS registration targets, a PROOF slug and the
                  registration error in the stamp
     'edition'    trimmed: smaller margin, no marks at all, one line at the foot
   Default 'proof', so a caller that has not been rewired yet still gets a
   sheet that shows its own registration. */
function drawStage(V,field,opts){
  opts=opts||{};
  const mode=opts.mode==='makeready'?'makeready':(opts.mode==='edition'?'edition':'proof');
  const ctx=stageCtx(),W=R.W,H=R.H,side=R.side,bx=R.bx,by=R.by,M=R.M;
  const seed=printSeed();
  /* the sheet is composited with putImageData, which ignores the context's
     transform, so the whole press works in DEVICE pixels. */
  const k=Math.min(2,window.devicePixelRatio||1);
  ctx.fillStyle='#2b2f36';ctx.fillRect(0,0,W,H);      /* the desk under the sheet */
  const S=Math.max(1,Math.round(side*k));
  /* the image sits inside a trim margin, because the furniture needs a margin
     to live in — the same reason a printed sheet is bigger than its image. An
     edition pull is already trimmed, so it gives the margin back to the image. */
  const mg=Math.round(S*(mode==='edition'?0.022:0.072)), inner=S-mg*2, cs=inner/M;
  const pc=plates(S).map(c=>{
    const g=c.getContext('2d');
    g.setTransform(1,0,0,1,0,0);
    g.fillStyle='#000';g.fillRect(0,0,S,S);
    g.fillStyle='#fff';g.strokeStyle='#fff';g.globalAlpha=1;
    return g;
  });
  pc.forEach(g=>g.setTransform(1,0,0,1,mg,mg));
  /* the substrate the record handed over, printed faint on yellow only */
  if(field&&opts.ghost!==false&&field.w===M&&field.h===M){
    const g=pc[2];g.globalAlpha=0.30;
    for(let i=0;i<M*M;i++)if(field.mask[i])
      g.fillRect((i%M)*cs+cs*0.33,((i/M)|0)*cs+cs*0.33,Math.max(1,cs*0.34),Math.max(1,cs*0.34));
    g.globalAlpha=1;
  }
  if(V&&V.n===M*M)inkCards(pc,V,M,cs);
  if(V&&opts.dead){                 /* an empty board must not look like a freeze */
    const line1='this plate pulled blank';
    const why=(opts.what||'this run')+(opts.size?' '+opts.size+'x'+opts.size:'')+
      ' · new pull, another run, or a bigger sheet';
    const maxW=inner-20*k;
    const m=pc[0];
    const fit=(txt,start,min,bold)=>{
      let px=start;
      for(;;){
        m.font=(bold?'bold ':'')+px+'px ui-rounded,"Chalkboard SE",sans-serif';
        if(px<=min||m.measureText(txt).width<=maxW)return px;
        px--;
      }
    };
    const f1=fit(line1,20*k,11*k,true),f2=fit(why,13*k,9*k,false);
    /* the note prints on all three plates, so it reads near-black by overprint */
    for(let p=0;p<3;p++){
      const g=pc[p];g.textAlign='center';g.globalAlpha=0.95;
      g.font='bold '+f1+'px ui-rounded,"Chalkboard SE",sans-serif';
      g.fillText(line1,inner/2,inner/2-2*k);
      g.font=f2+'px ui-rounded,"Chalkboard SE",sans-serif';
      g.fillText(why,inner/2,inner/2-2*k+f1*1.15);
      g.globalAlpha=1;g.textAlign='left';
    }
  }
  pc.forEach(g=>g.setTransform(1,0,0,1,0,0));
  const A=(typeof APP!=='undefined'&&APP)?APP:null;
  const plate=(A&&A.field&&A.field.label)||'—';
  const bandH=mg*0.34, bandY=Math.round(S-mg*0.80), bandBase=bandY+bandH*0.82;
  if(mode==='edition'){
    /* a delivered pull is trimmed: no crop marks, no check strip, no targets.
       All that is left is one line at the foot saying which pull this is. */
    const e=opts.edition||{}, n=e.n==null?1:e.n, N=e.N==null?1:e.N;
    stampText(pc,mg+inner*0.5,Math.round(S-mg*0.34),
              n+'/'+N+' · PLATE '+plate+' · PULL '+seed,
              Math.max(7,mg*0.62),inner-8*k,'center');
  }else{
    cropMarks(pc,mg,mg,inner,k);
    /* the bottom margin carries one line of furniture: the stamp on the left,
       the press-check strip hard against the right trim mark */
    const stripW=Math.round(inner*0.38), stripX=mg+inner-stripW;
    checkStrip(pc,stripX,bandY,stripW,bandH,k);
    let stampX=mg, stampW=stripX-mg-8*k;
    const stamp=[
      'PLATE '+plate,
      'RUN '+((A&&A.world&&A.world.label)||'—'),
      'PULL '+seed,
      M+'x'+M,
      'GEN '+((A&&A.gen!=null)?A.gen:0)
    ].join(' · ');
    const line=mode==='proof'?stamp+' · REG '+measuredSlip(seed).toFixed(2)+'px':stamp;
    if(mode==='proof'){
      /* the proof is the sheet that carries every instrument: the targets the
         operator reads, the slug that says this is not yet an edition, and the
         registration error the sheet is actually out by */
      const size=bandSize(pc,'PROOF',line,Math.max(7,mg*0.30),stampW);
      const m=pc[0];
      m.font='bold '+size+'px ui-monospace,Menlo,monospace';
      const slugW=m.measureText('PROOF').width+size*0.5;
      stampText(pc,mg,bandBase,'PROOF',size,slugW,undefined,true);
      stampX+=slugW;stampW-=slugW;
      regTargets(pc,mg,mg,inner,k);
    }
    stampText(pc,stampX,bandBase,line,Math.max(7,mg*0.30),stampW);
  }
  if(mode==='makeready')makereadySlug(pc,S/2,S/2,inner);
  pullSheet(ctx,S,Math.round(bx*k),Math.round(by*k),seed);
  ctx.save();ctx.translate(bx,by);                    /* the sheet's cut edge */
  ctx.strokeStyle='rgba(40,30,20,.45)';ctx.lineWidth=1;
  ctx.strokeRect(0.5,0.5,Math.round(side)-1,Math.round(side)-1);
  ctx.restore();
}
/* The pulled sheet, handed to the tray: the stage's sheet region, downscaled
   so a delivered pull costs a thumbnail instead of a full sheet. The stage is
   composited in device pixels, so the source rect is R.bx/R.by/R.side scaled by
   the same k the board uses. Draws on its own canvas and touches neither the
   stage nor its transform; '' means there is nothing to snapshot yet. */
function snapshotSheet(maxPx){
  const cv=document.getElementById('stage');
  if(!cv||!(R.side>0))return '';
  const k=Math.min(2,window.devicePixelRatio||1);
  const sx=Math.max(0,Math.min(cv.width-1,Math.round(R.bx*k)));
  const sy=Math.max(0,Math.min(cv.height-1,Math.round(R.by*k)));
  const side=Math.round(R.side*k);
  const sw=Math.max(1,Math.min(side,cv.width-sx)), sh=Math.max(1,Math.min(side,cv.height-sy));
  const px=Math.max(1,Math.round(maxPx||side));
  const out=document.createElement('canvas');
  out.width=px;out.height=px;
  const g=out.getContext('2d');
  g.drawImage(cv,sx,sy,sw,sh,0,0,px,px);
  return out.toDataURL('image/png');
}

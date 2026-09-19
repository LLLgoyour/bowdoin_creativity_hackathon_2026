/* ═══════════════════════════════════════════════════════════════════════════
   w-render.js — the paper-craft renderer. DOM side (with w-app.js).
   Draws the board, the cards, and the three rail panels. It knows nothing
   about any particular world: a world hands over a view, the renderer draws
   exactly one card per live cell and nothing else.
   ═══════════════════════════════════════════════════════════════════════════ */
const R = { W:0, H:0, railW:306, side:0, bx:0, by:0, M:52, cs:11, clock:0, bob:1,
            sparkBudget:8, scope:true, gain:1.75, sx:0, sy:0, sw:0, sh:0 };
const BASE = 12;   /* worlds may push extra colours onto PAL; panels use only these */

function stageCtx(){
  const cv=document.getElementById('stage');
  const dpr=Math.min(2,window.devicePixelRatio||1);
  const W=window.innerWidth,H=window.innerHeight;
  const w=Math.max(1,Math.round(W*dpr)),h=Math.max(1,Math.round(H*dpr));
  if(cv.width!==w||cv.height!==h){cv.width=w;cv.height=h;}
  cv.style.width=W+'px';cv.style.height=H+'px';
  const ctx=cv.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
  return ctx;
}
/* "the rail is on screen" is a display question, not a width question: the
   panel chip can open the rail at any width, and the board must give up the
   space when it does. The boot code decides the initial display separately. */
function railVisible(){
  const r=document.getElementById('rail');
  return getComputedStyle(r).display!=='none';
}
/* geometry only; the app owns M and calls setM */
function layout(){
  R.W=window.innerWidth;R.H=window.innerHeight;
  R.railW=railVisible()?document.getElementById('rail').offsetWidth:0;
  const availW=Math.max(140,R.W-R.railW-18), availH=Math.max(140,R.H-34);
  if(R.scope&&availW>=760&&availH>=450){
    R.side=Math.min(availH,availW*0.55);
    R.bx=R.railW+12;
    R.by=Math.max(6,(R.H-R.side)/2-8);
    R.sx=R.bx+R.side+18;R.sy=R.by;
    R.sw=Math.max(150,R.W-R.sx-12);R.sh=R.side;
  }else if(R.scope){
    R.side=Math.min(availW,Math.max(140,availH*0.52));
    R.bx=R.railW+Math.max(0,(availW-R.side)/2);
    R.by=8;
    R.sx=R.railW+12;R.sy=R.by+R.side+12;
    R.sw=Math.max(140,R.W-R.sx-12);R.sh=Math.max(120,R.H-R.sy-26);
  }else{
    R.side=Math.min(availW,availH);
    R.bx=R.railW+Math.max(0,(availW-R.side)/2);
    R.by=Math.max(6,(R.H-R.side)/2-8);
  }
  document.getElementById('ticker').style.left=R.railW+'px';
  return clamp(Math.round(R.side/11/4)*4,24,120);      /* the M that makes a ~11px card */
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
function slips(seed){
  const r=mulberry32(seed^0x9e37c1);
  return INKS.map(()=>({dx:(r()*2-1)*2.1,dy:(r()*2-1)*2.1}));
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
function pullSheet(ctx,side,ox,oy,seed){
  const S=Math.max(1,Math.round(side));
  const pc=plates(S), sl=slips(seed);
  const cov=[];
  for(let p=0;p<3;p++)cov.push(pc[p].getContext('2d').getImageData(0,0,S,S).data);
  const out=ctx.createImageData(S,S), od=out.data;
  const cx=S/2, cy=S/2;
  for(let i=0,px=0;px<S*S;px++){
    od[i++]=PAPER[0];od[i++]=PAPER[1];od[i++]=PAPER[2];od[i++]=255;
  }
  for(let p=0;p<3;p++){
    const ca=Math.cos(INKS[p].ang), sa=Math.sin(INKS[p].ang), d=cov[p];
    const ir=INKS[p].hex[0]/255, ig=INKS[p].hex[1]/255, ib=INKS[p].hex[2]/255;
    for(let y=0;y<S;y++){
      for(let x=0;x<S;x++){
        const fx=x-sl[p].dx-cx, fy=y-sl[p].dy-cy;
        const u=fx*ca+fy*sa, v=-fx*sa+fy*ca;
        const iu=Math.round(u/DOT), iv=Math.round(v/DOT);
        const su=iu*DOT, sv=iv*DOT;
        const sx=su*ca-sv*sa+cx+sl[p].dx, sy=su*sa+sv*ca+cy+sl[p].dy;
        const gx=sx|0, gy=sy|0;
        if(gx<0||gy<0||gx>=S||gy>=S)continue;
        const c=d[(gy*S+gx)*4]/255;
        if(c<=0.03)continue;
        const rr2=c*DOT*DOT*0.66, dx=x-sx, dy=y-sy;
        if(dx*dx+dy*dy>rr2)continue;
        const o=(y*S+x)*4;
        od[o]=od[o]*ir; od[o+1]=od[o+1]*ig; od[o+2]=od[o+2]*ib;
      }
    }
  }
  /* paper grain, seeded: the sheet's own fibre, over the ink */
  const gr=mulberry32(seed^0x51ed27);
  for(let o=0;o<od.length;o+=4){
    const n=(gr()*2-1)*9;
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
   runs off the trim is a misprint, not a style */
function stampText(pc,x,y,txt,px,maxW){
  const m=pc[0];
  let size=px;
  for(;;){
    m.font=size+'px ui-monospace,Menlo,monospace';
    if(size<=6||m.measureText(txt).width<=maxW)break;
    size-=0.5;
  }
  for(let p=0;p<3;p++){
    const g=pc[p];g.globalAlpha=0.9;
    g.font=size+'px ui-monospace,Menlo,monospace';
    g.fillText(txt,x,y);g.globalAlpha=1;
  }
}
/* ── the board ───────────────────────────────────────────────────────────── */
function drawStage(V,field,opts){
  opts=opts||{};
  const ctx=stageCtx(),W=R.W,H=R.H,side=R.side,bx=R.bx,by=R.by,M=R.M;
  const seed=printSeed();
  /* the sheet is composited with putImageData, which ignores the context's
     transform, so the whole press works in DEVICE pixels. */
  const k=Math.min(2,window.devicePixelRatio||1);
  ctx.fillStyle='#2b2f36';ctx.fillRect(0,0,W,H);      /* the desk under the sheet */
  const S=Math.max(1,Math.round(side*k));
  /* the image sits inside a trim margin, because the furniture needs a margin
     to live in — the same reason a printed sheet is bigger than its image */
  const mg=Math.round(S*0.072), inner=S-mg*2, cs=inner/M;
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
  cropMarks(pc,mg,mg,inner,k);
  /* the bottom margin carries one line of furniture: the edition stamp on the
     left, the press-check strip hard against the right trim mark */
  const bandH=mg*0.34, bandY=Math.round(S-mg*0.80);
  const stripW=Math.round(inner*0.38), stripX=mg+inner-stripW;
  checkStrip(pc,stripX,bandY,stripW,bandH,k);
  const A=(typeof APP!=='undefined'&&APP)?APP:null;
  const stamp=[
    'PLATE '+((A&&A.field&&A.field.label)||'—'),
    'RUN '+((A&&A.world&&A.world.label)||'—'),
    'PULL '+seed,
    M+'x'+M,
    'GEN '+((A&&A.gen!=null)?A.gen:0)
  ].join(' · ');
  stampText(pc,mg,bandY+bandH*0.82,stamp,Math.max(7,mg*0.30),stripX-mg-8*k);
  pullSheet(ctx,S,Math.round(bx*k),Math.round(by*k),seed);
  ctx.save();ctx.translate(bx,by);                    /* the sheet's cut edge */
  ctx.strokeStyle='rgba(40,30,20,.45)';ctx.lineWidth=1;
  ctx.strokeRect(0.5,0.5,Math.round(side)-1,Math.round(side)-1);
  ctx.restore();
  if(R.scope)drawScope(ctx,opts);
}
/* A CRT reading of the SOURCE, beside a separate trace of the WORLD. The
   scanner never changes a sample: gain and phosphor glow are display only. */
function scopeTrace(ctx,rec,key,start,end,scan,x,y,w,h,peak,color,reference){
  const values=rec[key], mid=y+h/2, amp=h*0.38*R.gain/peak;
  const plot=(last)=>{
    ctx.beginPath();
    for(let i=start;i<=last;i++){
      const px=x+(i-start)*w/(end-start),py=mid-values[i]*amp;
      if(i===start)ctx.moveTo(px,py);else ctx.lineTo(px,py);
    }
  };
  ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();
  if(reference){
    plot(end);ctx.strokeStyle='#afc4b8';ctx.globalAlpha=0.34;ctx.lineWidth=1;
    ctx.stroke();ctx.restore();return;
  }
  plot(end);ctx.strokeStyle=color;ctx.globalAlpha=0.16;ctx.lineWidth=1.1;ctx.stroke();
  if(scan>=start){
    plot(Math.min(scan,end));
    const glow=ctx.createLinearGradient(x,0,x+w,0);
    glow.addColorStop(0,color+'44');glow.addColorStop(1,color);
    ctx.globalAlpha=0.85;ctx.strokeStyle=glow;ctx.lineWidth=1.8;
    ctx.shadowColor=color;ctx.shadowBlur=13;ctx.stroke();
    ctx.shadowBlur=0;ctx.stroke();
  }
  ctx.restore();
}
function scopeResponse(ctx,opts,x,y,w,h){
  const hist=opts.response,n=Math.min(opts.responseN||0,hist?hist.length:0);
  if(!n)return;
  let lo=1,hi=0;
  for(let j=0;j<n;j++){
    const v=hist[(opts.responseN-n+j)%hist.length];
    if(v<lo)lo=v;if(v>hi)hi=v;
  }
  const pad=Math.max(0.025,(hi-lo)*0.18);
  lo=Math.max(0,lo-pad);hi=Math.min(1,hi+pad);
  if(hi-lo<0.06){lo=Math.max(0,lo-0.03);hi=Math.min(1,hi+0.03);}
  ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();
  ctx.beginPath();
  for(let j=0;j<n;j++){
    const v=hist[(opts.responseN-n+j)%hist.length];
    const px=x+j*w/Math.max(1,n-1),py=y+h-(v-lo)*h/Math.max(0.001,hi-lo);
    if(j)ctx.lineTo(px,py);else ctx.moveTo(px,py);
  }
  ctx.strokeStyle='#9cf5ae';ctx.lineWidth=1.7;
  ctx.shadowColor='#69ff9a';ctx.shadowBlur=12;ctx.stroke();ctx.restore();
  ctx.fillStyle='#9cf5ae';ctx.font='10px ui-monospace,monospace';
  ctx.fillText((hist[(opts.responseN-1)%hist.length]*100).toFixed(1)+'%',x+w-55,y+12);
}
function drawScope(ctx,opts){
  const {sx:x,sy:y,sw:w,sh:h}=R;
  if(w<100||h<100)return;
  ctx.save();
  ctx.fillStyle='rgba(0,0,0,.55)';rr(ctx,x+7,y+10,w,h,18);ctx.fill();
  const glass=ctx.createLinearGradient(x,y,x+w,y+h);
  glass.addColorStop(0,'#102524');glass.addColorStop(1,'#03100f');
  ctx.fillStyle=glass;rr(ctx,x,y,w,h,18);ctx.fill();
  ctx.strokeStyle='#416d5e';ctx.lineWidth=3;rr(ctx,x+1.5,y+1.5,w-3,h-3,17);ctx.stroke();
  ctx.save();rr(ctx,x+4,y+4,w-8,h-8,15);ctx.clip();
  ctx.fillStyle='rgba(138,255,191,.035)';
  for(let yy=y+2;yy<y+h;yy+=4)ctx.fillRect(x+4,yy,w-8,1);
  ctx.fillStyle='#b6ffd7';ctx.font='bold 12px ui-monospace,monospace';
  ctx.fillText('◉  WAVE / OSCILLOSCOPE',x+16,y+24);
  const rec=opts.rec, left=x+22,right=x+w-16,top=y+42;
  const chartW=Math.max(20,right-left),chartH=Math.max(90,h-104),lane=chartH/3;
  ctx.strokeStyle='rgba(111,216,161,.16)';ctx.lineWidth=1;
  for(let j=0;j<=8;j++){
    const gx=left+chartW*j/8;
    ctx.beginPath();ctx.moveTo(gx,top);ctx.lineTo(gx,top+chartH);ctx.stroke();
  }
  for(let j=0;j<3;j++){
    const mid=top+lane*(j+0.5);
    ctx.beginPath();ctx.moveTo(left,mid);ctx.lineTo(right,mid);ctx.stroke();
    ctx.beginPath();ctx.moveTo(left,top+j*lane);ctx.lineTo(right,top+j*lane);ctx.stroke();
  }
  ctx.font='10px ui-monospace,monospace';
  ctx.fillStyle='#83e9ff';ctx.fillText(opts.feedback?'CH1  Re: source + LIFE':'CH1  Re(h)',left+5,top+12);
  ctx.fillStyle='#ffc47f';ctx.fillText(opts.feedback?'CH2  Im: source + LIFE':'CH2  Im(h)',left+5,top+lane+12);
  ctx.fillStyle='#9cf5ae';ctx.fillText('WORLD  '+(opts.responseLabel||'activity'),left+5,top+lane*2+12);
  if(rec&&rec.re&&rec.re.length>1){
    const n=rec.re.length,scan=Math.min(n-1,Math.max(0,opts.scan||0));
    const span=Math.min(n-1,Math.max(72,Math.round(n*0.32)));
    const start=Math.min(n-1-span,Math.max(0,scan-Math.round(span*0.58)));
    const end=start+span, peak=rec.amax||1;
    if(opts.feedback){
      scopeTrace(ctx,rec,'re',start,end,scan,left,top+17,chartW,lane-21,peak,'#83e9ff',true);
      scopeTrace(ctx,rec,'im',start,end,scan,left,top+lane+17,chartW,lane-21,peak,'#ffc47f',true);
    }
    const signal=opts.feedback||rec;
    scopeTrace(ctx,signal,'re',start,end,scan,left,top+17,chartW,lane-21,peak,'#83e9ff');
    scopeTrace(ctx,signal,'im',start,end,scan,left,top+lane+17,chartW,lane-21,peak,'#ffc47f');
    const cursor=left+(scan-start)*chartW/span;
    ctx.save();ctx.strokeStyle='rgba(255,245,181,.9)';ctx.lineWidth=1;
    ctx.shadowColor='#f8edaa';ctx.shadowBlur=10;
    ctx.beginPath();ctx.moveTo(cursor,top);ctx.lineTo(cursor,top+lane*2);ctx.stroke();ctx.restore();
    const time=rec.t?rec.t[scan]:scan;
    const unit=opts.timeUnit||'t';
    ctx.fillStyle='#e8efd9';ctx.font='10px ui-monospace,monospace';
    ctx.fillText(unit+' '+Number(time).toFixed(2)+'  ·  sample '+(scan+1)+'/'+n,left,y+h-47);
    ctx.fillText('DISPLAY GAIN ×'+R.gain.toFixed(2),left,y+h-31);
  }else{
    ctx.fillStyle='#b6ffd7';ctx.font='11px ui-monospace,monospace';
    ctx.fillText('LOAD A FILE TO SEE ITS WAVE',left,top+lane-8);
  }
  scopeResponse(ctx,opts,left,top+lane*2+17,chartW,lane-21);
  ctx.fillStyle='rgba(200,239,216,.75)';ctx.font='9px ui-monospace,monospace';
  ctx.fillText(opts.feedback?'pale: source · bright: LIFE feedback · '+opts.feedback.live+' live cells':
    'scan '+(opts.stride||1)+'/gen · full field drives world',left,y+h-13);
  ctx.restore();ctx.restore();
}
/* ── the rail panels ─────────────────────────────────────────────────────────
   The panels are proofs pinned next to the press, so they are on the same
   paper and in the same three inks as the sheet. Nothing in this app is
   allowed to be a dark UI panel sitting next to a print. */
const PAPER_CSS='#f3ecdd', INK_BLUE='#1f6fc6', INK_PINK='#ff4fb0',
      INK_YELL='#ffd21e', INK_LINE='rgba(36,26,18,.75)';
function proofFrame(g,w,h){
  g.clearRect(0,0,w,h);g.fillStyle=PAPER_CSS;g.fillRect(0,0,w,h);
  g.strokeStyle=INK_LINE;g.lineWidth=1;g.strokeRect(1.5,1.5,w-3,h-3);
}
function drawRecordPanel(rec,mark){
  const cv=document.getElementById('c_rec'),g=cv.getContext('2d'),w=cv.width,h=cv.height;
  proofFrame(g,w,h);
  if(!rec)return;
  const n=rec.re.length;
  let rmax=0;for(let i=0;i<n;i++){const r=Math.hypot(rec.re[i],rec.im[i]);if(r>rmax)rmax=r;}
  rmax=rmax||1;
  const cx=w/2,cy=h/2,sc=(Math.min(w,h)/2-9)/rmax;
  g.lineWidth=1.3;
  /* the trajectory runs from blue at its start to pink at its end: two of the
     three inks, so the proof cannot show a colour the press cannot print */
  for(let i=1;i<n;i++){
    const t=i/n;
    g.strokeStyle='rgb('+Math.round(31+224*t)+','+Math.round(111-32*t)+','+Math.round(198-22*t)+')';
    g.beginPath();
    g.moveTo(cx+rec.re[i-1]*sc,cy-rec.im[i-1]*sc);
    g.lineTo(cx+rec.re[i]*sc,cy-rec.im[i]*sc);
    g.stroke();
  }
  if(mark!=null&&mark>=0&&mark<n){
    g.fillStyle=INK_YELL;g.strokeStyle=INK_LINE;g.lineWidth=1.4;
    g.beginPath();g.arc(cx+rec.re[mark]*sc,cy-rec.im[mark]*sc,3.4,0,6.2832);g.fill();g.stroke();
  }
  g.fillStyle=INK_LINE;g.font='9px ui-monospace,Menlo,monospace';
  g.fillText('Re h →',w-52,h-7);g.fillText('Im h ↑',6,12);
}
function drawFieldPanel(field){
  const cv=document.getElementById('c_fld'),g=cv.getContext('2d'),w=cv.width,h=cv.height;
  proofFrame(g,w,h);
  if(!field)return;
  const fw=field.w,fh=field.h;
  const off=document.createElement('canvas');off.width=fw;off.height=fh;
  const og=off.getContext('2d'),img=og.createImageData(fw,fh);
  const P=[243,236,221];
  for(let i=0;i<fw*fh;i++){
    /* frequency picks the ink, amplitude picks how much of it: a plate proof
       is ink coverage on paper, so it is mixed toward the paper, not toward
       black */
    const t=clamp((field.freq[i]+1)*0.5,0,1);
    const r=31+224*t, gg=111-32*t, b=198-168*t;
    const a=clamp(0.08+field.amp[i]*0.92,0,1)*(field.mask[i]?1:0.28), o=i*4;
    img.data[o]=Math.round(P[0]+(r-P[0])*a);
    img.data[o+1]=Math.round(P[1]+(gg-P[1])*a);
    img.data[o+2]=Math.round(P[2]+(b-P[2])*a);
    img.data[o+3]=255;
  }
  og.putImageData(img,0,0);
  const side=Math.min(w,h)-10,x0=(w-side)/2,y0=(h-side)/2;
  g.imageSmoothingEnabled=true;
  g.drawImage(off,x0,y0,side,side);
  g.strokeStyle=INK_LINE;g.lineWidth=1.2;g.strokeRect(x0-1,y0-1,side+2,side+2);
  g.fillStyle=INK_LINE;g.font='9px ui-monospace,Menlo,monospace';
  g.fillText('→ time',x0+3,y0+side+11);
}
function drawPopPanel(hist,histN,live){
  const cv=document.getElementById('c_pop'),g=cv.getContext('2d'),w=cv.width,h=cv.height;
  proofFrame(g,w,h);
  const n=Math.min(histN,hist.length);
  if(n<2)return;
  let mx=1;for(let i=0;i<n;i++){const v=hist[(histN-n+i+hist.length*2)%hist.length];if(v>mx)mx=v;}
  g.strokeStyle=INK_PINK;g.lineWidth=1.5;g.beginPath();
  for(let i=0;i<n;i++){
    const v=hist[(histN-n+i+hist.length*2)%hist.length];
    const x=2+(w-4)*i/(n-1), y=h-3-(h-8)*(v/mx);
    i?g.lineTo(x,y):g.moveTo(x,y);
  }
  g.stroke();
  g.fillStyle=INK_LINE;g.font='9px ui-monospace,Menlo,monospace';
  g.fillText(mx.toLocaleString()+' cards',5,12);
  g.fillText(live.toLocaleString(),w-42,h-5);
}

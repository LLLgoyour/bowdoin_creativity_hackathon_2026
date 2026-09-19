/* ═══════════════════════════════════════════════════════════════════════════
   w-render.js — the paper-craft renderer. DOM side (with w-app.js).
   Draws the board, the cards, and the three rail panels. It knows nothing
   about any particular world: a world hands over a view, the renderer draws
   exactly one card per live cell and nothing else.
   ═══════════════════════════════════════════════════════════════════════════ */
const R = { W:0, H:0, railW:306, side:0, bx:0, by:0, M:52, cs:11, clock:0, bob:1,
            sparkBudget:8 };
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
  R.side=Math.min(availW,availH);
  R.bx=R.railW+Math.max(0,(availW-R.side)/2);
  R.by=Math.max(6,(R.H-R.side)/2-8);
  document.getElementById('ticker').style.left=R.railW+'px';
  return clamp(Math.round(R.side/11/4)*4,24,120);      /* the M that makes a ~11px card */
}
function setM(M){R.M=M;R.cs=R.side/M;}

/* ── THE PRESS ───────────────────────────────────────────────────────────────
   Nothing below paints a card's colour. Three inks are laid as separate
   plates — BLUE, FLUORESCENT PINK, YELLOW — each halftoned on its own screen
   angle, each shifted by its own seeded registration error, and the sheet is
   the product of the three. Every colour on screen is an overprint:
       pink + yellow          -> the warm reds and oranges
       blue + yellow          -> the greens
       pink + blue            -> the violets
       all three              -> the near-black cut line and the eyes
   A "red" card is pink on one plate and yellow on another; the red happens on
   the paper. Change the seed and the same board re-prints with different
   registration slip and different grain — the press pulls another copy. */
const INKS=[{hex:[31,111,198],ang:15*Math.PI/180},      /* blue */
            {hex:[255,79,176],ang:75*Math.PI/180},      /* fluorescent pink */
            {hex:[255,210,30],ang:45*Math.PI/180}];     /* yellow */
/* which plates a palette index prints on — this table IS the colour */
const RECIPE=[[0,1,0],[1,1,0],[0,1,1],[1,0,1],[1,0,0],[0,0,1],
              [1,1,1],[0,1,1],[1,1,0],[1,0,1],[0,1,0],[1,0,0],[0,0,1],[1,1,0]];
const PAPER=[243,236,221], DOT=2.6;
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
  const r=Math.max(0.8,w*0.115);
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
  const lw=Math.max(0.5,cs*0.085);
  for(let y=0,i=0;y<M;y++){
    for(let x=0;x<M;x++,i++){
      const live=V.live[i],fl=V.flip[i];
      if(!live&&fl<=0)continue;
      const bob=bobOn*Math.sin(R.clock*2.1+x*0.8+y*0.55);
      const X=x*cs, Y=y*cs+V.lift[i]*cs+bob;
      const rec=RECIPE[V.col[i]%RECIPE.length];
      if(sparkOn&&burst>0&&V.spark[i]>0){       /* births pop on yellow alone */
        pstar(pc[2],X+cs/2,Y+cs/2,cs*0.34,V.spark[i]);burst--;
      }
      if(live){
        const up=V.stack?V.stack[i]:0;
        if(up)for(let s=up;s>=1;s--){
          const o=s*cs*0.20, inset=s*cs*0.05;
          for(let p=0;p<3;p++)if(rec[p])
            pcard(pc[p],X+inset,Y-o+inset,cs-inset*2,cs-inset*2,0.62);
        }
        for(let p=0;p<3;p++)if(rec[p])pcard(pc[p],X,Y,cs,cs,0.92);
        /* the cut line and the eyes print on blue AND pink, so the dark comes
           from two inks meeting, never from a dark fill */
        pline(pc[0],X,Y,cs,cs,lw,0.55);pline(pc[1],X,Y,cs,cs,lw,0.55);
        if(V.face[i]&&cs>=8){peyes(pc[0],X,Y,cs,cs,0.95);peyes(pc[1],X,Y,cs,cs,0.95);}
      }
      if(fl>0){
        const t=Math.min(1,fl), sx=cs*Math.abs(Math.cos(t*Math.PI*0.5));
        for(let p=0;p<3;p++)if(rec[p])
          pcard(pc[p],X+(cs-sx)/2,Y-t*cs*0.5,sx,cs,(1-t*0.9)*0.9);
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
/* ── the board ───────────────────────────────────────────────────────────── */
function drawStage(V,field,opts){
  opts=opts||{};
  const ctx=stageCtx(),W=R.W,H=R.H,side=R.side,bx=R.bx,by=R.by,M=R.M;
  const seed=printSeed();
  /* the sheet is composited with putImageData, which ignores the context's
     transform, so the whole press works in DEVICE pixels and the card size is
     scaled to match. */
  const k=Math.min(2,window.devicePixelRatio||1), cs=R.cs*k;
  ctx.fillStyle='#2b2f36';ctx.fillRect(0,0,W,H);      /* the desk under the sheet */
  const S=Math.max(1,Math.round(side*k));
  const pc=plates(S).map(c=>{
    const g=c.getContext('2d');
    g.setTransform(1,0,0,1,0,0);
    g.fillStyle='#000';g.fillRect(0,0,S,S);
    g.fillStyle='#fff';g.strokeStyle='#fff';g.globalAlpha=1;
    return g;
  });
  /* the substrate the record handed over, printed faint on yellow only */
  if(field&&opts.ghost!==false&&field.w===M&&field.h===M){
    const g=pc[2];g.globalAlpha=0.30;
    for(let i=0;i<M*M;i++)if(field.mask[i])
      g.fillRect((i%M)*cs+cs*0.33,((i/M)|0)*cs+cs*0.33,Math.max(1,cs*0.34),Math.max(1,cs*0.34));
    g.globalAlpha=1;
  }
  if(V&&V.n===M*M)inkCards(pc,V,M,cs);
  if(V&&opts.dead){                 /* an empty board must not look like a freeze */
    const line1='nothing is alive on this board';
    const why=(opts.what||'this world')+(opts.size?' '+opts.size+'x'+opts.size:'')+
      ' · reseed, another world, or a bigger board';
    const maxW=S-30*k;
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
      g.fillText(line1,S/2,S/2-2*k);
      g.font=f2+'px ui-rounded,"Chalkboard SE",sans-serif';
      g.fillText(why,S/2,S/2-2*k+f1*1.15);
      g.globalAlpha=1;g.textAlign='left';
    }
  }
  pullSheet(ctx,S,Math.round(bx*k),Math.round(by*k),seed);
  ctx.save();ctx.translate(bx,by);                    /* the sheet's cut edge */
  ctx.strokeStyle='rgba(40,30,20,.55)';ctx.lineWidth=1.5;
  ctx.strokeRect(0.5,0.5,Math.round(side)-1,Math.round(side)-1);
  ctx.restore();
}
/* ── the rail panels ─────────────────────────────────────────────────────── */
function drawRecordPanel(rec,mark){
  const cv=document.getElementById('c_rec'),g=cv.getContext('2d'),w=cv.width,h=cv.height;
  g.clearRect(0,0,w,h);g.fillStyle='#0e1424';g.fillRect(0,0,w,h);
  g.strokeStyle='rgba(246,195,68,.55)';g.lineWidth=1.5;
  g.strokeRect(1.5,1.5,w-3,h-3);
  if(!rec)return;
  const n=rec.re.length;
  let rmax=0;for(let i=0;i<n;i++){const r=Math.hypot(rec.re[i],rec.im[i]);if(r>rmax)rmax=r;}
  rmax=rmax||1;
  const cx=w/2,cy=h/2,sc=(Math.min(w,h)/2-8)/rmax;
  g.lineWidth=1.4;
  for(let i=1;i<n;i++){
    const t=i/n;
    g.strokeStyle='hsla('+(52-34*t).toFixed(0)+',88%,'+(54+22*t).toFixed(0)+'%,'+(0.30+0.6*t).toFixed(2)+')';
    g.beginPath();
    g.moveTo(cx+rec.re[i-1]*sc,cy-rec.im[i-1]*sc);
    g.lineTo(cx+rec.re[i]*sc,cy-rec.im[i]*sc);
    g.stroke();
  }
  if(mark!=null&&mark>=0&&mark<n){
    g.fillStyle='#fff6d8';g.strokeStyle=INK;g.lineWidth=1.6;
    g.beginPath();g.arc(cx+rec.re[mark]*sc,cy-rec.im[mark]*sc,3.4,0,6.2832);g.fill();g.stroke();
  }
  g.fillStyle='rgba(246,231,200,.9)';g.font='9px ui-rounded,sans-serif';
  g.fillText('Re h →',w-52,h-7);g.fillText('Im h ↑',6,12);
}
function drawFieldPanel(field){
  const cv=document.getElementById('c_fld'),g=cv.getContext('2d'),w=cv.width,h=cv.height;
  g.clearRect(0,0,w,h);g.fillStyle='#0e1424';g.fillRect(0,0,w,h);
  g.strokeStyle='rgba(246,195,68,.55)';g.lineWidth=1.5;g.strokeRect(1.5,1.5,w-3,h-3);
  if(!field)return;
  const fw=field.w,fh=field.h;
  const off=document.createElement('canvas');off.width=fw;off.height=fh;
  const og=off.getContext('2d'),img=og.createImageData(fw,fh);
  for(let i=0;i<fw*fh;i++){
    const pi=clamp(Math.round((field.freq[i]+1)*0.5*(BASE-1)),0,BASE-1);
    const c=hex2rgb(PAL[pi]),o=i*4;
    img.data[o]=c[0];img.data[o+1]=c[1];img.data[o+2]=c[2];
    img.data[o+3]=Math.round(255*clamp(0.10+field.amp[i]*0.95,0,1)*(field.mask[i]?1:0.34));
  }
  og.putImageData(img,0,0);
  const side=Math.min(w,h)-10,x0=(w-side)/2,y0=(h-side)/2;
  g.imageSmoothingEnabled=true;
  g.drawImage(off,x0,y0,side,side);
  g.strokeStyle=INK;g.lineWidth=3;rr(g,x0-2,y0-2,side+4,side+4,8);g.stroke();
  g.fillStyle='rgba(246,231,200,.85)';g.font='9px ui-rounded,sans-serif';
  g.fillText('→ time',x0+4,y0+side+11);
}
function drawPopPanel(hist,histN,live){
  const cv=document.getElementById('c_pop'),g=cv.getContext('2d'),w=cv.width,h=cv.height;
  g.clearRect(0,0,w,h);g.fillStyle='#0e1424';g.fillRect(0,0,w,h);
  g.strokeStyle='rgba(246,195,68,.45)';g.lineWidth=1.5;g.strokeRect(1.5,1.5,w-3,h-3);
  const n=Math.min(histN,hist.length);
  if(n<2)return;
  let mx=1;for(let i=0;i<n;i++){const v=hist[(histN-n+i+hist.length*2)%hist.length];if(v>mx)mx=v;}
  g.strokeStyle='#f6c344';g.lineWidth=1.6;g.beginPath();
  for(let i=0;i<n;i++){
    const v=hist[(histN-n+i+hist.length*2)%hist.length];
    const x=2+(w-4)*i/(n-1), y=h-3-(h-8)*(v/mx);
    i?g.lineTo(x,y):g.moveTo(x,y);
  }
  g.stroke();
  g.fillStyle='rgba(246,231,200,.85)';g.font='9px ui-rounded,sans-serif';
  g.fillText(mx.toLocaleString()+' cells',5,12);
  g.fillText(live.toLocaleString(),w-42,h-5);
}

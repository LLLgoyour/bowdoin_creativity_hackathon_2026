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

/* ── one card: a printed face, a cut edge, a cast shadow ─────────────────── */
function card(ctx,X,Y,w,h,fill,face,spin,alpha){
  if(w<0.7||alpha<=0.02)return;
  const r=Math.max(1.4,w*0.22), d=Math.max(1.5,w*0.19);
  ctx.save();
  ctx.globalAlpha=alpha;
  if(spin){const cx=X+w/2,cy=Y+h/2;ctx.translate(cx,cy);ctx.rotate(spin);ctx.translate(-cx,-cy);}
  ctx.fillStyle='rgba(8,6,3,.32)';
  rr(ctx,X+w*0.07+d*0.6,Y+h*0.07+d*0.9,w,h,r);ctx.fill();
  ctx.fillStyle=INK;rr(ctx,X,Y+d,w,h,r);ctx.fill();
  ctx.fillStyle=fill;rr(ctx,X,Y,w,h,r);ctx.fill();
  ctx.strokeStyle=INK;ctx.lineWidth=Math.max(1,w*0.14);rr(ctx,X,Y,w,h,r);ctx.stroke();
  if(w>=9){
    ctx.fillStyle='rgba(255,255,255,.30)';
    rr(ctx,X+w*0.16,Y+h*0.13,w*0.64,h*0.16,r*0.5);ctx.fill();
    if(face)eyes(ctx,X,Y,w,h);
  }
  ctx.restore();
}
function eyes(ctx,X,Y,w,h){
  const r=w*0.13;
  ctx.fillStyle='#fffdf4';
  ctx.beginPath();ctx.arc(X+w*0.33,Y+h*0.43,r*1.7,0,6.2832);ctx.fill();
  ctx.beginPath();ctx.arc(X+w*0.67,Y+h*0.43,r*1.7,0,6.2832);ctx.fill();
  ctx.fillStyle='#241408';
  ctx.beginPath();ctx.arc(X+w*0.36,Y+h*0.45,r*0.85,0,6.2832);ctx.fill();
  ctx.beginPath();ctx.arc(X+w*0.70,Y+h*0.45,r*0.85,0,6.2832);ctx.fill();
}
function sparkle(ctx,cx,cy,r,al){
  if(al<=0.03)return;
  ctx.save();ctx.globalAlpha=Math.min(1,al);
  ctx.strokeStyle='#fff6d8';ctx.lineWidth=Math.max(1,r*0.15);
  ctx.beginPath();
  ctx.moveTo(cx-r,cy);ctx.lineTo(cx+r,cy);
  ctx.moveTo(cx,cy-r);ctx.lineTo(cx,cy+r);
  ctx.moveTo(cx-r*0.5,cy-r*0.5);ctx.lineTo(cx+r*0.5,cy+r*0.5);
  ctx.moveTo(cx+r*0.5,cy-r*0.5);ctx.lineTo(cx-r*0.5,cy+r*0.5);
  ctx.stroke();ctx.restore();
}
function drawCards(ctx,V,M,cs){
  const bobOn=R.bob?cs*0.055:0;
  /* starbursts: the renderer owns rarity and size, because the world is
     geometry-free and cannot know how big a card is. A star smaller than a
     few pixels is mush, so gate on the card size, and spend at most
     R.sparkBudget of them per frame, chosen in cell order. */
  let burst=Math.max(0,R.sparkBudget|0), sparkOn=cs>=9;
  for(let y=0,i=0;y<M;y++){
    for(let x=0;x<M;x++,i++){
      const live=V.live[i],fl=V.flip[i];
      if(!live&&fl<=0)continue;
      const bob=bobOn*Math.sin(R.clock*2.1+x*0.8+y*0.55);
      const X=x*cs, Y=y*cs+V.lift[i]*cs+bob;
      const fill=PAL[V.col[i]%PAL.length], spin=V.spin[i]*0.35;
      if(sparkOn&&burst>0&&V.spark[i]>0){
        sparkle(ctx,X+cs/2,Y+cs/2,cs*0.34,V.spark[i]);burst--;
      }
      if(live){
        const up=V.stack?V.stack[i]:0;                 /* cards under the top one */
        if(up){
          const under=mixHex(fill,INK,0.28);
          for(let s=up;s>=1;s--){
            const o=s*cs*0.20, inset=s*cs*0.05;
            card(ctx,X+inset,Y-o+inset,cs-inset*2,cs-inset*2,under,0,spin,0.92);
          }
        }
        card(ctx,X,Y,cs,cs,fill,V.face[i],spin,1);
      }
      if(fl>0){                      /* the paper flip: edge-on, lifted, gone */
        const t=Math.min(1,fl), sx=cs*Math.abs(Math.cos(t*Math.PI*0.5));
        card(ctx,X+(cs-sx)/2,Y-t*cs*0.5,sx,cs,fill,0,spin,1-t*0.9);
      }
    }
  }
}
/* ── the board ───────────────────────────────────────────────────────────── */
function drawStage(V,field,opts){
  opts=opts||{};
  const ctx=stageCtx(),W=R.W,H=R.H,side=R.side,bx=R.bx,by=R.by,cs=R.cs,M=R.M;
  ctx.fillStyle='#070c16';ctx.fillRect(0,0,W,H);
  for(let i=0;i<190;i++){
    const x=h2(i*3+1,i*7+5)*W,y=h2(i*11+2,i*5+9)*H,a=h2(i,i*2);
    ctx.fillStyle='rgba(214,228,255,'+(0.05+a*0.15).toFixed(3)+')';
    ctx.fillRect(x,y,1.5,1.5);
  }
  ctx.save();ctx.translate(bx,by);
  ctx.fillStyle='rgba(0,0,0,.55)';rr(ctx,8,11,side,side,18);ctx.fill();
  const g=ctx.createLinearGradient(0,0,0,side);
  g.addColorStop(0,'#16203a');g.addColorStop(1,'#0b1020');
  ctx.fillStyle=g;rr(ctx,0,0,side,side,18);ctx.fill();
  ctx.save();rr(ctx,0,0,side,side,18);ctx.clip();
  /* the substrate: what the record handed over, faintly, under the cards */
  if(field&&opts.ghost!==false&&field.w===M&&field.h===M){
    ctx.fillStyle='rgba(146,188,255,.22)';
    for(let i=0;i<M*M;i++)if(field.mask[i])
      ctx.fillRect((i%M)*cs+cs*0.33,((i/M)|0)*cs+cs*0.33,Math.max(1,cs*0.34),Math.max(1,cs*0.34));
  }
  if(V&&V.n===M*M)drawCards(ctx,V,M,cs);
  if(V&&opts.dead){                 /* an empty board must not look like a freeze */
    ctx.textAlign='center';
    const line1='nothing is alive on this board';
    const why=(opts.what||'this world')+(opts.size?' '+opts.size+'x'+opts.size:'')+
      ' · reseed, another world, or a bigger board';
    const maxW=side-30;             /* a 24-cell board is a narrow canvas; the words must fit it */
    const fit=(txt,start,min,bold)=>{
      let px=start;
      for(;;){
        ctx.font=(bold?'bold ':'')+px+'px ui-rounded,"Chalkboard SE",sans-serif';
        if(px<=min||ctx.measureText(txt).width<=maxW)return px;
        px--;
      }
    };
    const f1=fit(line1,20,11,true),f2=fit(why,13,9,false);
    ctx.font='bold '+f1+'px ui-rounded,"Chalkboard SE",sans-serif';
    ctx.lineWidth=Math.max(3,f1*0.25);ctx.strokeStyle=INK;
    ctx.strokeText(line1,side/2,side/2-2);
    ctx.fillStyle='#f6c344';ctx.fillText(line1,side/2,side/2-2);
    ctx.font=f2+'px ui-rounded,"Chalkboard SE",sans-serif';
    ctx.lineWidth=Math.max(3,f2*0.3);ctx.strokeStyle=INK;
    ctx.strokeText(why,side/2,side/2-2+f1*1.15);
    ctx.fillStyle='#f6e7c8';ctx.fillText(why,side/2,side/2-2+f1*1.15);
  }
  ctx.restore();
  ctx.strokeStyle=INK;ctx.lineWidth=5;rr(ctx,0,0,side,side,18);ctx.stroke();
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

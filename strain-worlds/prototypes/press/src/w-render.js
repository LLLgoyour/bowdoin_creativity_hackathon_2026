/* ═══════════════════════════════════════════════════════════════════════════
   w-render.js — the press: a three-ink risograph. DOM side (with w-app.js).

   THE IMAGE IS PRINTED, NOT STYLED. No card is drawn in the colour it appears
   to be. A card is a STENCIL burned into three ink separations, each separation
   is screened into dots at its own screen angle, the plates are laid down a
   little out of register, and the picture is only what the overprint multiplies
   out to. Colour is a consequence of the process, not a choice made here.

   The three plates — the canonical riso trio — and their screens:

     plate  ink        screen angle  lattice  dots per tile
     Y      #ffe23c     75.96°       (1,4)    17 dots in 28 device px
     B      #2f5fa8     45.00°       (1,1)     2 dots in 10 device px
     P      #ff5aa8     14.04°       (4,1)    17 dots in 28 device px

   On #f2ece0 stock, full-coverage overprints multiply out to exactly:

     (no ink)  #f2ece0  the sheet itself
     B         #2d5894  blue           <- one plate, solid
     P         #f25394  pink
     Y         #f2d135  yellow
     B + P     #2d1f61  violet
     B + Y     #2d4e23  green
     P + Y     #f24a23  red-orange
     B + P + Y #2d1c17  near-black     <- EVERY outline, pupil and starburst

   Partial coverage prints as a tint (dots of ink on bare stock), which the eye
   averages to paper*(1-l*(1-ink/255)) per plate. So the twelve fixed palette
   slots are twelve INK RECIPES measured in eighths of a plate, never colours:

     slot  recipe B/P/Y  prints   name          slot  recipe B/P/Y  prints   name
      0    [0,1,7]      #f2c347  gold           6    [6,0,3]      #5e7877  slate
      1    [0,7,6]      #f25e43  vermilion      7    [1,8,1]      #d94c80  pink
      2    [4,0,0]      #8fa2ba  sky            8    [3,0,7]      #a8a341  brass
      3    [5,0,6]      #77834b  olive          9    [8,0,0]      #2d5894  indigo
      4    [4,4,0]      #8f6e9a  mauve         10    [1,1,2]      #d9c2a6  buff
      5    [0,4,7]      #f2903d  orange        11    [3,4,6]      #a87045  tan

   Closest pair of printed slots is 50.4 RGB apart (vermilion/orange), every
   slot is at least 75.6 from the bare sheet. A card at slot 10 is a *buff
   tint*, not cream: the press cannot print lighter than the stock.

   An eye's white is a KNOCKOUT — that plate's ink is removed there, so bare
   paper shows through — and the pupil is the three-ink overprint. There is no
   cast shadow anywhere: a flat print has no shadow and nothing to cast one on.
   What separates a card from the sheet is the outline it is printed with (all
   three inks, so it is the near-black) and the substrate the record leaves, its
   own stencil of the blue plate — and the sheet keeps that substrate only where
   the record has a cell and no card covers it, the way an impression survives
   where nothing was laid on top of it. The registration crosshairs, one
   ink swatch per plate, and the plate signature in the margin are stencils too:
   every plate carries its own copy of them, so they print with the fringe of
   the registration slip like everything else.

   Everything is a function of the seed: the dot phase of each screen, the
   registration slip, the sheet grain and the tremor the plates drift on while
   the press runs. Same seed, same print, frame for frame; a new seed re-prints
   the same board with a different slip, grain and dot phase.
   ═══════════════════════════════════════════════════════════════════════════ */
const R = { W:0, H:0, railW:306, side:0, bx:0, by:0, M:52, cs:11, clock:0, bob:1,
            sparkBudget:8 };
const BASE = 12;   /* worlds may push extra colours onto PAL; panels use only these */

/* ── the press ───────────────────────────────────────────────────────────────
   Plate k screens the sheet on the lattice (p,q): dots at (i*p+j*q, i*q-j*p)*t
   for i,j in [0,D), D = p*p+q*q, wrapped into a D*t square tile. A square dot
   lattice is the same lattice rotated by 90°, so these three directions —
   75.96°, 45.00°, 14.04° — are three genuinely different screens. Screen angle
   goes with the ink the way it does on a real press: the yellow at the finest
   separation, the blue at 45°. */
const STOCK = '#f2ece0';
const PLATE = [
  {id:'B', ink:'#2f5fa8', p:1, q:1},          /* 45.00° screen */
  {id:'P', ink:'#ff5aa8', p:4, q:1},          /* 14.04° screen */
  {id:'Y', ink:'#ffe23c', p:1, q:4}           /* 75.96° screen */
];
/* eighths of a plate per palette slot; the values are the recipes in the header */
const INKMIX = [[0,1,7],[0,7,6],[4,0,0],[5,0,6],[4,4,0],[0,4,7],
                [6,0,3],[1,8,1],[3,0,7],[8,0,0],[1,1,2],[3,4,6]];
const GHOST  = 2;    /* eighths of the blue plate: the substrate the record left */
const DARK   = 8;    /* solid on every plate: outlines, pupils, bursts, margin */

const PRINT = {key:'', dpr:1, pdpr:1, side:0, cs:0, pad:0, S:0, paper:null,
               tiles:null, pats:null, plate:null, slip:null, trem:null};

/* a rounded rectangle into a path; spin rotates it about its own centre */
const CORN = new Float64Array(8);
const HAS_RRECT = typeof Path2D === 'function' && typeof Path2D.prototype.roundRect === 'function';
function rect(p,x,y,w,h,r,spin){
  if(!spin){
    if(HAS_RRECT){p.roundRect(x,y,w,h,r);return;}
    p.moveTo(x+r,y);p.arcTo(x+w,y,x+w,y+h,r);p.arcTo(x+w,y+h,x,y+h,r);
    p.arcTo(x,y+h,x,y,r);p.arcTo(x,y,x+w,y,r);p.closePath();return;
  }
  const cx=x+w/2, cy=y+h/2, hw=w/2, hh=h/2, co=Math.cos(spin), si=Math.sin(spin);
  for(let i=0;i<4;i++){
    const lx=(i===1||i===2)?hw:-hw, ly=(i>=2)?hh:-hh;
    CORN[i*2]=cx+lx*co-ly*si; CORN[i*2+1]=cy+lx*si+ly*co;
  }
  p.moveTo((CORN[6]+CORN[0])/2,(CORN[7]+CORN[1])/2);
  for(let i=0;i<4;i++){
    const a=i*2, b=((i+1)%4)*2;
    p.arcTo(CORN[a],CORN[a+1],CORN[b],CORN[b+1],r);
  }
  p.closePath();
}
function disc(p,cx,cy,r){p.moveTo(cx+r,cy);p.arc(cx,cy,r,0,6.2832);}
/* the starburst the original drew in white, as a sealed path (fill it solid, or
   stroke it fat and thin to make the stencils the card is printed over) */
function star(p,cx,cy,r){
  p.moveTo(cx-r,cy);p.lineTo(cx+r,cy);
  p.moveTo(cx,cy-r);p.lineTo(cx,cy+r);
  p.moveTo(cx-r*0.5,cy-r*0.5);p.lineTo(cx+r*0.5,cy+r*0.5);
  p.moveTo(cx+r*0.5,cy-r*0.5);p.lineTo(cx-r*0.5,cy+r*0.5);
}

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
/* the sheet carries a printer's margin: the image area is inset by this much on
   every side, and the margin is where the crosshairs, the ink swatches and the
   plate signature are printed. */
function margin(side){return clamp(Math.round(side*0.026),7,26);}
/* geometry only; the app owns M and calls setM */
function layout(){
  R.W=window.innerWidth;R.H=window.innerHeight;
  R.railW=railVisible()?document.getElementById('rail').offsetWidth:0;
  const availW=Math.max(140,R.W-R.railW-18), availH=Math.max(140,R.H-34);
  R.side=Math.min(availW,availH);
  R.bx=R.railW+Math.max(0,(availW-R.side)/2);
  R.by=Math.max(6,(R.H-R.side)/2-8);
  document.getElementById('ticker').style.left=R.railW+'px';
  /* the M that makes a ~11px card INSIDE the margin */
  const board=Math.max(60,R.side-margin(R.side)*2);
  return clamp(Math.round(board/11/4)*4,24,120);
}
function setM(M){R.M=M;R.cs=R.side/M;}

/* ── the sheet ───────────────────────────────────────────────────────────────
   A stock tone with real grain: a seeded noise tile at one fleck per CSS pixel
   multiplied in, plus a seeded scatter of fibres, plus the shade the sheet takes
   along its lower edge. Rebuilt only when the seed or the sheet size changes. */
function buildPaper(cv,S,dpr,seed){
  if(cv.width!==S){cv.width=cv.height=S;}
  const g=cv.getContext('2d');
  g.setTransform(1,0,0,1,0,0);
  g.globalCompositeOperation='source-over';g.globalAlpha=1;
  g.clearRect(0,0,S,S);
  g.fillStyle=STOCK;g.fillRect(0,0,S,S);
  const cell=Math.max(1,Math.round(dpr)), T=96;
  const tn=document.createElement('canvas');tn.width=tn.height=T;
  const tg=tn.getContext('2d'), rng=mulberry32(seed^0x9c4b71);
  const img=tg.createImageData(T,T);
  for(let y=0;y<T;y+=cell)for(let x=0;x<T;x+=cell){
    const v=196+Math.round(rng()*59);
    for(let dy=0;dy<cell&&y+dy<T;dy++)for(let dx=0;dx<cell&&x+dx<T;dx++){
      const o=((y+dy)*T+(x+dx))*4;
      img.data[o]=v;img.data[o+1]=v;img.data[o+2]=v;img.data[o+3]=255;
    }
  }
  tg.putImageData(img,0,0);
  g.globalCompositeOperation='multiply';
  g.globalAlpha=0.42;
  g.fillStyle=g.createPattern(tn,'repeat');g.fillRect(0,0,S,S);
  g.globalAlpha=1;
  /* fibres: short strokes in the stock's own shadow */
  const frng=mulberry32(seed^0x51b3d9), nf=Math.round(S*0.22/8);
  g.lineCap='round';
  for(let i=0;i<nf;i++){
    const x=frng()*S, y=frng()*S, a=frng()*6.2832, l=(0.3+frng()*1.5)*dpr*10;
    g.strokeStyle='rgba(120,101,72,'+(0.03+frng()*0.07).toFixed(3)+')';
    g.lineWidth=Math.max(1,dpr*0.5);
    g.beginPath();g.moveTo(x,y);
    g.lineTo(x+Math.cos(a)*l,y+Math.sin(a)*l*0.5);g.stroke();
  }
  g.globalCompositeOperation='source-over';
  const sh=g.createLinearGradient(0,S*0.72,S,S);
  sh.addColorStop(0,'rgba(64,48,28,0)');sh.addColorStop(1,'rgba(64,48,28,.09)');
  g.fillStyle=sh;g.fillRect(0,0,S,S);
  return cv;
}
/* the press state: tiles, their patterns, the separation canvases, the slip and
   the tremor. All of it a function of (seed, sheet size, card pitch). The
   canvases are allocated once and resized in place: the sheet size buckets into
   12-pixel steps, so a one-pixel refit of the window does not re-plate, and no
   print ever throws away a sheet-sized bitmap while the press is running. */
function ensurePrint(side,pad,cs,dpr,seed,M){
  const key=seed+':'+Math.round(side/12)+':'+M+':'+dpr;
  if(PRINT.key===key)return;
  /* the sheet is rasterised at the display's resolution, but never past 4096px a
     side: a sheet-sized bitmap per plate is 3 of them, and a canvas big enough
     to lose its backing store is a print that silently stops. Below that ceiling
     a plate is only ever drawn to `side` CSS px, so its own resolution is free. */
  const pdpr=(side*dpr>4096)?4096/side:dpr;
  PRINT.key=key;PRINT.dpr=dpr;PRINT.pdpr=pdpr;PRINT.side=side;PRINT.pad=pad;PRINT.cs=cs;
  const S=Math.max(64,Math.round(side*pdpr));
  PRINT.S=S;
  if(!PRINT.plate){
    PRINT.plate=[];PRINT.tiles=[];PRINT.pats=[];
    for(let k=0;k<3;k++){
      PRINT.plate.push(document.createElement('canvas'));
      const row=[];
      for(let L=0;L<=8;L++)row.push((L>=1&&L<=7)?document.createElement('canvas'):null);
      PRINT.tiles.push(row);
    }
    PRINT.paper=document.createElement('canvas');
  }
  const rng=mulberry32(seed^0x50524553);            /* "PRES" */
  const spDev=Math.max(2.4,cs*pdpr/3.2);            /* ~3.2 dots across a card */
  const slip=[],trem=[];
  for(let k=0;k<3;k++){
    const pl=PLATE[k], D=pl.p*pl.p+pl.q*pl.q;
    const Pdev=Math.max(4,Math.round(spDev*Math.sqrt(D)));
    const t=Pdev/D, sp=Pdev/Math.sqrt(D);
    const phx=rng()*Pdev, phy=rng()*Pdev;           /* the screen's phase: seeded */
    const pts=[], seen=Object.create(null);
    for(let i=0;i<D;i++)for(let j=0;j<D;j++){
      let x=((i*pl.p+j*pl.q)*t+phx)%Pdev; if(x<0)x+=Pdev;
      let y=((i*pl.q-j*pl.p)*t+phy)%Pdev; if(y<0)y+=Pdev;
      const pk=Math.round(x*8)+':'+Math.round(y*8);
      if(!seen[pk]){seen[pk]=1;pts.push(x,y);}
    }
    for(let L=1;L<=7;L++){
      const tc=PRINT.tiles[k][L];
      if(tc.width!==Pdev){tc.width=tc.height=Pdev;}
      const tg=tc.getContext('2d');
      tg.setTransform(1,0,0,1,0,0);
      tg.clearRect(0,0,Pdev,Pdev);
      tg.fillStyle=pl.ink;
      const r=Math.max(0.35,sp*Math.sqrt((L/8)/Math.PI));
      for(let i=0;i<pts.length;i+=2)
        for(let ux=-1;ux<=1;ux++)for(let uy=-1;uy<=1;uy++){
          tg.beginPath();tg.arc(pts[i]+ux*Pdev,pts[i+1]+uy*Pdev,r,0,6.2832);tg.fill();
        }
    }
    const pc=PRINT.plate[k];
    if(pc.width!==S){pc.width=pc.height=S;}
    const pg=pc.getContext('2d');
    const pr=[null];
    for(let L=1;L<=7;L++){
      const pat=pg.createPattern(PRINT.tiles[k][L],'repeat');
      /* the tiles are drawn at the press's own resolution: their lattice is
         measured in SHEET pixels, so a pattern that repeats in the plate's user
         space (CSS px) would print a screen dpr times too coarse. Scale the
         pattern back so one tile pixel is one sheet pixel. */
      if(pat&&pat.setTransform&&typeof DOMMatrix==='function')
        pat.setTransform(new DOMMatrix([1/pdpr,0,0,1/pdpr,0,0]));
      pr.push(pat);
    }
    pr.push(null);
    PRINT.pats[k]=pr;
    slip.push({x:(rng()-0.5)*0.30*cs, y:(rng()-0.5)*0.30*cs});
    trem.push({a:0.25+0.45*rng(),rx:0.55+0.85*rng(),ry:0.55+0.85*rng(),
               px:rng()*6.2832,py:rng()*6.2832});
  }
  PRINT.slip=slip;PRINT.trem=trem;
  buildPaper(PRINT.paper,S,pdpr,seed);
}
function inkStyle(g,k,L){
  if(L>=8)g.fillStyle=PLATE[k].ink;
  else g.fillStyle=PRINT.pats[k][L];
}

/* ── the board ───────────────────────────────────────────────────────────── */
/* the measured-fit routine for the empty board: the words shrink until they fit
   the board, exactly as before, and are then stencilled into all three plates */
function deadWords(ctx,opts,side){
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
  return {line1,why,f1:fit(line1,20,11,true),f2:fit(why,13,9,false)};
}
/* lay the three separations down over the sheet. Everything in here is a
   stencil: nothing is drawn in a colour that was chosen, only in an ink. */
function press(ctx,V,field,opts,M,cs,pad,side,dead){
  const dpr=PRINT.pdpr, plates=PRINT.plate;
  /* one path per plate per ink level, so cells sharing a tint print in one pass.
     The eye, pupil, burst, substrate and outline geometry is the same in all
     three plates, so those paths are built once and stencilled three times. */
  const body=[],used=[];
  for(let k=0;k<3;k++){
    const g=[],u=[];
    for(let L=0;L<=8;L++){g.push(new Path2D());u.push(0);}
    body.push(g);used.push(u);
  }
  const all=new Path2D(), ghost=new Path2D();
  let ghostOn=0;
  const eye=new Path2D(), pupil=new Path2D(), flash=new Path2D();
  const bobOn=R.bob?cs*0.055:0, clock=R.clock;
  let burst=Math.max(0,R.sparkBudget|0), sparkOn=cs>=9;
  for(let y=0,i=0;y<M;y++){
    for(let x=0;x<M;x++,i++){
      const live=V.live[i], fl=V.flip[i];
      if(!live&&fl<=0)continue;
      const bob=bobOn*Math.sin(clock*2.1+x*0.8+y*0.55);
      const X=pad+x*cs, Y=pad+y*cs+V.lift[i]*cs+bob;
      const sp=V.spin[i]*0.35;
      const mix=INKMIX[(V.col[i]|0)%INKMIX.length];
      /* the burst is printed BEHIND the card, as before, so only its arms clear
         the card and the ink reads against bare stock rather than board colour */
      if(sparkOn&&burst>0&&V.spark[i]>0.05){
        burst--;
        star(flash,X+cs/2,Y+cs/2,cs*(0.24+0.12*V.spark[i]));
      }
      if(live){
        const up=V.stack?V.stack[i]:0;
        for(let s=up;s>=1;s--){                /* the cards under the top one */
          const o=s*cs*0.20, ins=s*cs*0.05;
          for(let k=0;k<3;k++){
            const L=Math.min(8,mix[k]+3);
            rect(body[k][L],X+ins,Y-o+ins,cs-ins*2,cs-ins*2,cs*0.22,sp);used[k][L]=1;
          }
        }
        for(let k=0;k<3;k++){
          const L=mix[k];
          if(L){rect(body[k][L],X,Y,cs,cs,cs*0.22,sp);used[k][L]=1;}
        }
        rect(all,X,Y,cs,cs,cs*0.22,sp);
        if(V.face[i]){                         /* the eyes: knockout + overprint */
          const r=cs*0.13;
          disc(eye,X+cs*0.33,Y+cs*0.43,r*1.7);disc(eye,X+cs*0.67,Y+cs*0.43,r*1.7);
          disc(pupil,X+cs*0.36,Y+cs*0.45,r*0.85);
          disc(pupil,X+cs*0.70,Y+cs*0.45,r*0.85);
        }
      }
      if(fl>0){                    /* the paper flip: a weak impression, shrinking */
        const t=Math.min(1,fl), sx=cs*Math.abs(Math.cos(t*Math.PI*0.5));
        const w=Math.max(0.7,sx), rr2=cs*0.22*Math.max(0.35,w/cs);
        for(let k=0;k<3;k++){
          const L=Math.round(mix[k]*(1-t*0.9));
          if(L){rect(body[k][L],X+(cs-sx)/2,Y-t*cs*0.5,w,cs,rr2,sp);used[k][L]=1;}
        }
      }
    }
  }
  if(field&&opts.ghost!==false&&field.w===M&&field.h===M){
    ghostOn=1;
    /* the substrate is what the SHEET remembers of the record: it prints where
       the record has a cell and no card covers it. Under a card it would only
       tint that card's own ink, which is not a thing a print does. */
    for(let i=0;i<M*M;i++)if(field.mask[i]&&!V.live[i]&&V.flip[i]<=0)
      ghost.rect(pad+(i%M)*cs+cs*0.33,pad+((i/M)|0)*cs+cs*0.33,
                 Math.max(1,cs*0.34),Math.max(1,cs*0.34));
  }
  /* the margin: registration crosshairs, the ink swatches, the plate signature.
     Each plate prints its own copy at its own slip, so the crosshairs fringe. */
  const m=Math.max(2,pad*0.5), arm=Math.max(2,pad*0.34);
  const marks=new Path2D();
  const cross=(cx,cy)=>{marks.moveTo(cx-arm,cy);marks.lineTo(cx+arm,cy);
                        marks.moveTo(cx,cy-arm);marks.lineTo(cx,cy+arm);};
  cross(m,m);cross(side-m,m);cross(m,side-m);cross(side-m,side-m);
  let sig=null;
  if(pad>=10){
    const sq=pad*0.52, y0=side-pad*0.5-sq/2;
    /* three swatches, one per ink: each plate prints its own, so the swatches
       themselves show the registration slip and never touch each other */
    PRINT.swatch=[];
    for(let k=0;k<3;k++)
      PRINT.swatch.push({x:pad*0.7+k*(sq*1.9),y:y0,w:sq,h:sq});
    /* the signature is the plate's own identity: the seed is what changes */
    const txt='PLATE '+((opts.seed|0))+' · 3 INK · SCREEN 75.96/45.00/14.04 DEG · '+
              M+'x'+M;
    let px=Math.min(11,Math.max(6,Math.round(pad*0.42)));
    const lim=side-pad*0.7-(pad*0.7+3*sq*1.9+pad*0.6);
    for(;;){
      ctxFont(px);
      if(px<=6||ctxWidth(txt)<=lim)break;
      px--;
    }
    sig={txt:txt,px:px,x:side-pad*0.7,y:side-pad*0.5+px*0.35};
  }
  /* ── lay each separation down ─────────────────────────────────────────── */
  for(let k=0;k<3;k++){
    const g=plates[k].getContext('2d');
    g.setTransform(dpr,0,0,dpr,0,0);
    g.clearRect(0,0,side,side);
    g.lineCap='round';g.lineJoin='round';
    inkStyle(g,k,DARK);
    if(k===0&&ghostOn){inkStyle(g,k,GHOST);g.fill(ghost);}
    /* the bursts, printed before the cards so the card covers their middle */
    if(flash){g.lineWidth=Math.max(1,cs*0.11);g.stroke(flash);}
    for(let L=1;L<=8;L++)if(used[k][L]){inkStyle(g,k,L);g.fill(body[k][L]);}
    inkStyle(g,k,DARK);
    g.lineWidth=Math.max(1,cs*0.10);g.stroke(all);        /* the all-ink outline */
    g.lineWidth=Math.max(1,dpr);
    g.stroke(marks);                                      /* the crosshairs */
    if(sig){
      const s=PRINT.swatch[k];                            /* this plate's own ink */
      g.fillRect(s.x,s.y,s.w,s.h);
      ctxFont(sig.px,g);
      g.textAlign='right';g.fillText(sig.txt,sig.x,sig.y);g.textAlign='left';
    }
    /* the eyes are knocked out of EVERY plate, so bare stock shows through */
    g.globalCompositeOperation='destination-out';
    g.fill(eye);
    g.globalCompositeOperation='source-over';
    inkStyle(g,k,DARK);
    g.fill(pupil);                                        /* then the pupils print */
    if(dead){
      const fam='ui-rounded,"Chalkboard SE",sans-serif';
      g.textAlign='center';
      g.font='bold '+dead.f1+'px '+fam;
      g.fillText(dead.line1,side/2,side/2-2);
      g.font=dead.f2+'px '+fam;
      g.fillText(dead.why,side/2,side/2-2+dead.f1*1.15);
      g.textAlign='left';
    }
  }
  /* ── the plates go down, a little out of register, and multiply ───────── */
  const slip=PRINT.slip, trem=PRINT.trem;
  ctx.globalCompositeOperation='multiply';
  for(let k=0;k<3;k++){
    const tr=trem[k];
    /* the slip is the seed's; the tremor is the press running. Both are snapped
       to whole device pixels so the dots stay crisp instead of resampling. */
    const dx=slip[k].x+tr.a*Math.sin(clock*tr.rx+tr.px);
    const dy=slip[k].y+tr.a*Math.sin(clock*tr.ry+tr.py);
    ctx.drawImage(plates[k],Math.round(dx*dpr)/dpr,Math.round(dy*dpr)/dpr,side,side);
  }
  ctx.globalCompositeOperation='source-over';
}
/* the signature and the crosshairs are measured on the stage context, which has
   the same scale as the plates, then printed by each plate in its own ink */
let MEAS=null;
function ctxFont(px,g){
  const c=g||(MEAS||(MEAS=document.getElementById('stage').getContext('2d')));
  c.font=px+'px ui-rounded,"Chalkboard SE",sans-serif';
}
function ctxWidth(txt){
  return (MEAS||(MEAS=document.getElementById('stage').getContext('2d'))).measureText(txt).width;
}
function drawStage(V,field,opts){
  opts=opts||{};
  const ctx=stageCtx(),W=R.W,H=R.H,side=R.side,bx=R.bx,by=R.by,M=R.M;
  const dpr=Math.min(2,window.devicePixelRatio||1);
  const pad=margin(side);
  const board=Math.max(60,side-pad*2), cs=board/M;
  ensurePrint(side,pad,cs,dpr,(opts.seed|0),M);
  ctx.fillStyle='#070c16';ctx.fillRect(0,0,W,H);
  for(let i=0;i<190;i++){
    const x=h2(i*3+1,i*7+5)*W,y=h2(i*11+2,i*5+9)*H,a=h2(i,i*2);
    ctx.fillStyle='rgba(214,228,255,'+(0.05+a*0.15).toFixed(3)+')';
    ctx.fillRect(x,y,1.5,1.5);
  }
  ctx.save();ctx.translate(bx,by);
  /* the sheet on the table, then the sheet */
  ctx.fillStyle='rgba(0,0,0,.55)';rr(ctx,7,10,side,side,14);ctx.fill();
  ctx.save();rr(ctx,0,0,side,side,14);ctx.clip();
  ctx.drawImage(PRINT.paper,0,0,side,side);
  if(V&&V.n===M*M){
    const dead=opts.dead?deadWords(ctx,opts,side):null;
    press(ctx,V,field,opts,M,cs,pad,side,dead);
  }
  ctx.restore();
  /* the cut edge of the sheet: a hairline, not a drawn frame */
  ctx.strokeStyle='rgba(26,17,9,.5)';ctx.lineWidth=1.5;rr(ctx,0,0,side,side,14);ctx.stroke();
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

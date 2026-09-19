/* ═══════════════════════════════════════════════════════════════════════════
   w-shop.js — STANDING AT THE PRESS. The operator's view, and every control
   in it. There is no interface region: the sheet is a window in the middle of
   a machine that is drawn in the press's own three inks on the press's own
   paper, and every scalar the app owns is a physical part of that machine —
   a pin you nudge, a key you pull, a cam you engage, a wheel you turn, a
   lever you haul. Nothing else on screen is a widget, because nothing on
   screen is HTML.

   Loaded BEFORE w-app.js so the app's boot can call SHOPVIEW.init(); every
   reference to APP / SHOP / API happens inside a function, never at load.

   GEOMETRY IS COMPUTED HERE. The app asks R.slipScale for the press's real
   registration error and then calls drawStage(); this module then paints the
   machine around the sheet it just printed.
   ═══════════════════════════════════════════════════════════════════════════ */

const SHV = {
  G:null, kr:Math.min(2,window.devicePixelRatio||1),
  back:null, fore:null, sig:'', t:0,
  drag:null, hover:null, hot:null, grab:null,
  shakeTrack:null, oil:0,
  tape:[], tapeB:0, pile:[], pileIn:0, bin:0,
  paper:0, paperIn:false, lens:1,
  wob:0, wobP:0, kick:0,
  stock:[], drop:null, arm:null, hovering:null,
  countBlink:0, sprayPuff:0, cyl:0, fly:0,
  msg:{txt:'',until:0}
};

/* ── §1 · the press's vocabulary, in code ───────────────────────────────────
   Every surface is a COVERAGE TRIPLE — how much blue, pink and yellow ink the
   press lays down there — never a grey. inkedHex() (w-render.js) turns that
   into what those three inks actually print on this paper, and a half-tone
   screen of dots is laid over it wherever a tone needs to read as tone. That
   is the whole style rule: a casting is a heavy three-ink overprint with paper
   dots showing through it, a shadow is a 45° screen of blue, and nothing on
   this screen is a smooth grey gradient. */
const MONO='ui-monospace,Menlo,monospace';
const TC={
  paper :[0,0,0],
  /* The castings are BLUE ink first. An equal triple of all three inks is a
     neutral, and a neutral printed by this press is mud: the old ramp ran
     #bb9f9e -> #4d3d4e, a dusty mauve that made the machine look drab next to
     its own vivid sheet. Weighting the ramp toward blue prints iron as iron
     (#9fa3ab -> #335177 -> #1e253d) and leaves pink and yellow free to mean
     something — motive parts, ink, and warnings — instead of being spent on
     grey. */
  wash  :[0.09,0.03,0.03],
  pale  :[0.18,0.07,0.05],
  light :[0.30,0.12,0.08],
  mid   :[0.46,0.20,0.13],
  deep  :[0.64,0.30,0.19],
  dark  :[0.82,0.44,0.28],
  black :[0.96,0.66,0.46],
  grey  :[0.52,0.26,0.17],
  blue  :[0.90,0.13,0.03],
  cloud :[0.34,0.10,0.04],
  pink  :[0.09,0.90,0.03],
  rose  :[0.07,0.46,0.03],
  yell  :[0.05,0.09,0.92],
  straw :[0.04,0.06,0.48],
  red   :[0.86,0.86,0.05],
  violet:[0.60,0.58,0.14],
  teal  :[0.48,0.15,0.32]
};
function inkOf(c){return inkedHex(c);}

/* ── §2 · paper and screens ─────────────────────────────────────────────────
   A halftone varies the SIZE of its dots and prints them in solid ink. The
   first version of this file varied the OPACITY of a constant 1.2 px dot at a
   3.1 px pitch, which at 1:1 is not a screen at all — it is a uniform woven
   mesh, the same fabric on every surface, and it is what made the whole
   machine look flat and bland however the tones were re-cut.

   So: one pitch (the screen ruling), dots whose radius follows the coverage
   the caller asks for, printed at full strength in a HEAVIER lay of the same
   inks as the surface under them. Coverage c maps to radius by sqrt, because
   a dot's area — not its radius — is what the eye reads as tone. */
const TILE={};
const SCREEN=6.2;                       /* the house ruling, in CSS px */
function dotTile(col,cov,sp){
  const key=col+'_'+cov.toFixed(3)+'_'+sp.toFixed(2);
  if(TILE[key])return TILE[key];
  const n=Math.max(3,Math.round(sp)), c=cv(n,n), g=c.getContext('2d');
  g.fillStyle=col;
  if(cov>=1){g.fillRect(0,0,n,n);return TILE[key]=c;}
  const coverage=clamp(cov,0,1),r=Math.sqrt(Math.min(coverage,1-coverage)/Math.PI)*n;
  if(coverage<=.5){
    g.beginPath();g.arc(n/2,n/2,r,0,Math.PI*2);g.fill();
  }else{
    // Above half tone, paper holes keep the ruling from filling prematurely.
    g.fillRect(0,0,n,n);g.globalCompositeOperation='destination-out';
    for(const [x,y] of [[0,0],[n,0],[0,n],[n,n]]){
      g.beginPath();g.arc(x,y,r,0,Math.PI*2);g.fill();
    }
    g.globalCompositeOperation='source-over';
  }
  return TILE[key]=c;
}
function patFor(ctx,col,cov,sp,ang){
  const k=(ctx.__pat=ctx.__pat||{});
  const key=col+'_'+cov.toFixed(3)+'_'+sp.toFixed(2)+'_'+(ang||0);
  if(k[key])return k[key];
  const p=ctx.createPattern(dotTile(col,cov,sp),'repeat');
  try{ if(ang&&p.setTransform)p.setTransform(new DOMMatrix().rotate(ang)); }catch(e){}
  return k[key]=p;
}
/* the same inks, laid on heavier: what a second hit of the screen prints */
function heavier(tone,by){
  const f=by==null?1.75:by;
  return [Math.min(1,tone[0]*f+0.06),Math.min(1,tone[1]*f+0.05),Math.min(1,tone[2]*f+0.04)];
}
function cv(w,h){const c=document.createElement('canvas');c.width=Math.max(1,Math.round(w));
  c.height=Math.max(1,Math.round(h));return c;}

/* A surface: flat ink, then its own screen. `am` 0..1 is how hard the screen
   bites — a pale wash barely shows dots, a heavy casting is full of them.

   The ANGLE is not a decoration: this press screens blue at 15°, pink at 75°
   and yellow at 45°, and a surface here is screened at the angle of whichever
   ink dominates it. That is what stops the machine reading as one grey mass —
   every casting, every motive part and every ink path carries the rosette of
   the plate it is printed from, so parts differ in TEXTURE even where they are
   close in tone. A caller may still force an angle when it wants two adjacent
   parts of the same ink to separate. */
const INK_ANG=[15,75,45];
function dominantAng(tone){
  let m=0;for(let i=1;i<3;i++)if(tone[i]>tone[m])m=i;
  return INK_ANG[m];
}
function face(ctx,P,tone,am,ang){
  ctx.fillStyle=inkedHex(tone);ctx.fill(P);
  if(am===0||am===false)return;
  const a=am==null?0.30:am;
  const s=(SHV.G?SHV.G.s:1);
  /* `am` is the weight the caller asked for when a screen was an OPACITY over
     a fixed 44%-coverage dot. Keeping every call site honest means reading it
     back as the coverage it effectively produced — otherwise a real solid-ink
     screen at the same numbers prints roughly twice as heavy and swamps the
     type on every pale surface. */
  const sp=Math.max(3.4,SCREEN*Math.max(0.62,Math.min(1.25,s)));
  /* You cannot print darker than solid. On a heavy casting the screen is not
     another lay of ink — it is PAPER, knocked out of the solid, which is what
     gives a dark surface its tooth instead of leaving it a dead black field.
     On a light surface the screen is a heavier lay of the same inks. */
  const sum=tone[0]+tone[1]+tone[2], heavy=sum>1.55;
  ctx.save();
  ctx.fillStyle=patFor(ctx,inkedHex(heavy?TC.paper:heavier(tone)),
                       Math.min(0.96,a*(heavy?0.40:0.48)),sp,
                       ang==null?dominantAng(tone):ang);
  ctx.fill(P);ctx.restore();
}
/* A PART of the machine, as a print separates it from its neighbours: a paper
   gap trapped around it, then its ink, then a hard contour. Two castings of
   the same tone lying against each other are one shape without this — the gap
   and the line are the only things that make a printed machine legible, and
   they are cheaper and truer than the bevels and drop shadows a screen UI
   would reach for. `lw` is the contour weight in px. */
function part(ctx,P,tone,am,o){
  o=o||{};
  const gap=o.gap==null?3:o.gap;
  if(gap>0){
    ctx.save();ctx.strokeStyle=inkedHex(TC.paper);ctx.lineWidth=gap*2;
    ctx.lineJoin='round';ctx.stroke(P);ctx.restore();
  }
  face(ctx,P,tone,am,o.ang);
  ctx.save();ctx.strokeStyle=inkedHex(o.edge||TC.black);
  ctx.lineWidth=o.lw==null?Math.max(1.1,1.5*(SHV.G?SHV.G.s:1)):o.lw;
  ctx.lineJoin='round';ctx.stroke(P);ctx.restore();
}
/* a shadow the press could print: a coarse screen of the blue plate laid over
   whatever is under it, at the blue plate's own angle. No blur — a press
   cannot blur, and a blurred shadow is the tell of a screen UI pretending. */
function shadow(ctx,P,am,ang){
  const s=(SHV.G?SHV.G.s:1);
  ctx.save();
  ctx.fillStyle=patFor(ctx,inkedHex(TC.mid),Math.min(0.9,am*0.34),
                       Math.max(3.8,SCREEN*1.15*Math.max(0.62,Math.min(1.25,s))),ang||15);
  ctx.fill(P);ctx.restore();
}
/* engraver's hatching — how a machine reads as metal in a print is a hatch,
   never a gradient */
function hatch(ctx,P,x,y,w,h,ang,sp,lw,tone,am){
  ctx.save();ctx.clip(P);
  ctx.globalAlpha=am==null?0.85:am;ctx.strokeStyle=inkedHex(tone||TC.mid);
  ctx.lineWidth=lw||1;
  const rad=ang*Math.PI/180, c=Math.cos(rad), s=Math.sin(rad);
  const len=Math.hypot(w,h), cx=x+w/2, cy=y+h/2;
  ctx.beginPath();
  for(let d=-len;d<=len;d+=sp){
    ctx.moveTo(cx+c*d-s*len,cy+s*d+c*len);
    ctx.lineTo(cx+c*d+s*len,cy+s*d-c*len);
  }
  ctx.stroke();ctx.restore();
}
function rrP(x,y,w,h,r){const P=new Path2D();rr2(P,x,y,w,h,r||0);return P;}
function rr2(P,x,y,w,h,r){
  r=Math.min(r,Math.abs(w)/2,Math.abs(h)/2);
  P.moveTo(x+r,y);P.arcTo(x+w,y,x+w,y+h,r);P.arcTo(x+w,y+h,x,y+h,r);
  P.arcTo(x,y+h,x,y,r);P.arcTo(x,y,x+w,y,r);P.closePath();
}
function polyP(pts){const P=new Path2D();P.moveTo(pts[0][0],pts[0][1]);
  for(let i=1;i<pts.length;i++)P.lineTo(pts[i][0],pts[i][1]);P.closePath();return P;}
function circP(x,y,r){const P=new Path2D();P.arc(x,y,Math.max(0.5,r),0,6.2832);return P;}
function line(ctx,x1,y1,x2,y2,tone,lw,am){
  ctx.save();ctx.strokeStyle=inkedHex(tone);ctx.lineWidth=lw||1;
  ctx.globalAlpha=am==null?1:am;
  ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();ctx.restore();
}

/* ── §3 · engraved type ─────────────────────────────────────────────────────
   Cast letters on the machine, stencilled letters on its paper. Both are
   printed: a cast letter is paper-coloured metal with the ink shadowed under
   it, a stencil is one ink. No floating label anywhere — if it is on screen it
   is on the machine. */
function cut(ctx,x,y,txt,o){
  o=o||{};
  const size=o.size||10;
  ctx.save();
  ctx.font=(o.bold?'bold ':'')+size+'px '+MONO;
  if(o.track!=null)ctx.letterSpacing=o.track+'px';
  ctx.textAlign=o.align||'left';ctx.textBaseline=o.base||'alphabetic';
  const lines=String(txt).split('\n');
  for(let i=0;i<lines.length;i++){
    const yy=y+i*size*1.15;
    if(o.mode==='cast'){
      ctx.fillStyle=o.cast||inkedHex(TC.black);ctx.fillText(lines[i],x,yy+1);
      ctx.fillStyle=o.col||inkedHex(TC.paper);ctx.fillText(lines[i],x,yy);
    }else{
      if(o.col2){ctx.fillStyle=o.col2;ctx.fillText(lines[i],x+1,yy+1);}
      ctx.fillStyle=o.col||inkedHex(TC.black);ctx.fillText(lines[i],x,yy);
    }
  }
  ctx.restore();
  return size*lines.length;
}
function cutW(ctx,txt,size,bold){
  ctx.save();ctx.font=(bold?'bold ':'')+size+'px '+MONO;
  const w=ctx.measureText(txt).width;ctx.restore();return w;
}
/* Type on a press is cast to a measured width: a line that will not fit the
   stick is shortened by the compositor, never allowed to run into its
   neighbour or off the edge of the chase. fit() is that compositor — it trims
   from the right and sets an ellipsis, and it is the only way a caller should
   ever shorten a string. Slicing at a fixed character count (name.slice(0,20))
   cannot work here: the type is proportional at small sizes and the panel
   width follows the window. */
function fit(ctx,txt,size,maxW,bold){
  txt=String(txt);
  if(maxW<=0)return '';
  if(cutW(ctx,txt,size,bold)<=maxW)return txt;
  const e='…';
  let lo=0,hi=txt.length;
  while(lo<hi){
    const mid=(lo+hi+1)>>1;
    if(cutW(ctx,txt.slice(0,mid)+e,size,bold)<=maxW)lo=mid;else hi=mid-1;
  }
  return lo>0?txt.slice(0,lo)+e:'';
}
function wrap(ctx,txt,size,maxW,bold){
  ctx.save();ctx.font=(bold?'bold ':'')+size+'px '+MONO;
  const words=String(txt).split(/\s+/),out=[];let line='';
  for(const w of words){
    const t=line?line+' '+w:w;
    if(ctx.measureText(t).width>maxW&&line){out.push(line);line=w;}else line=t;
  }
  if(line)out.push(line);
  ctx.restore();return out;
}
function para(ctx,txt,x,y,size,maxW,lh,o){
  const ls=wrap(ctx,txt,size,maxW,o&&o.bold);
  for(let i=0;i<ls.length;i++)cut(ctx,x,y+i*lh,ls[i],Object.assign({},o,{size:size}));
  return ls.length*lh;
}

/* ── §4 · springs and knocks ────────────────────────────────────────────────
   Every physical part that is released has to settle, and every part that
   bottoms out has to thump. Springs are damped, the frame takes a knock as a
   short decaying wobble, and the whole thing is integrated off the app's own
   16 ms tick — never from requestAnimationFrame, which a hidden pane starves. */
const SPRINGS=[];
function sp(o,k,tgt,K,D){
  for(const s of SPRINGS)if(s.o===o&&s.k===k){s.t=tgt;if(K)s.K=K;if(D)s.D=D;return;}
  SPRINGS.push({o:o,k:k,t:tgt,K:K||240,D:D||25,v:0});
}
function killSp(o){for(let i=SPRINGS.length-1;i>=0;i--)if(SPRINGS[i].o===o)SPRINGS.splice(i,1);}
function tickSprings(dt){
  for(let i=SPRINGS.length-1;i>=0;i--){
    const s=SPRINGS[i],x=s.o[s.k];
    s.v+=((s.t-x)*s.K-s.v*s.D)*dt;
    const nx=x+s.v*dt;
    if(Math.abs(s.t-nx)<0.0007&&Math.abs(s.v)<0.007){s.o[s.k]=s.t;SPRINGS.splice(i,1);continue;}
    s.o[s.k]=nx;
  }
}
function knock(power){                      /* the whole machine takes it */
  SHV.kick=Math.max(SHV.kick,power);
  SHV.wobP=0;
}
function tickKnock(dt){
  SHV.wob*=Math.exp(-7.5*dt);SHV.wobP+=dt*36;
  if(SHV.kick>0){SHV.wob=Math.max(SHV.wob,SHV.kick*2.6);SHV.kick=0;SHV.wobP=0;}
}
function wob(){                              /* the frame's own shiver, in px */
  if(SHV.wob<0.06)return [0,0];
  return [SHV.wob*Math.sin(SHV.wobP*1.7),SHV.wob*Math.cos(SHV.wobP*2.3)];
}

/* ── §5 · the operator's view: where the furniture actually is ──────────────
   You are standing too close to a press. The sheet takes the middle because it
   is what you are making; everything else crowds in at the edges and is cut
   off by the window frame exactly where a machine is cut off when you stand
   this close. Nothing is centred: the drive side is heavy on the right, the
   delivery is cropped by the left edge, the feed pile runs off the bottom. */
function shopLayout(){
  const W=window.innerWidth,H=window.innerHeight;
  const kr=Math.min(2,window.devicePixelRatio||1);
  const s=clamp(Math.min(W/1560,H/980),0.40,1.8);
  const leftW=W*0.245, rightW=W*0.235, topH=H*0.155, botH=H*0.175;
  const availW=Math.max(120,W-leftW-rightW), availH=Math.max(120,H-topH-botH);
  const side=Math.max(90,Math.min(availW*0.95,availH*0.97));
  const bx=leftW+(availW-side)/2, by=topH+(availH-side)/2;
  const G={W:W,H:H,s:s,kr:kr,side:side,bx:bx,by:by,botH:botH,
    sheet:{x:bx,y:by,w:side,h:side},
    wall:{x:W*0.030,y:-H*0.030,w:W*0.375,h:topH+H*0.030},
    ducts:{x:W*0.412,y:-H*0.034,w:W*0.340,h:topH*0.70},
    cyl:{x:W*0.752,y:-H*0.055,w:W*0.248,h:topH*0.92},
    upright:{x:bx+side+W*0.030,y:topH*0.92,w:W*0.088,h:H-botH-topH*0.92},
    camRack:{x:W*0.947,y:H*0.185,w:W*0.056,h:H*0.545},
    wheelCol:{x:W*0.835,y:H*0.215,w:W*0.080,h:H*0.50},
    tape:{x:W*0.128,y:H-14,w:W*0.115},
    delivery:{x:-W*0.045,y:H*0.625,w:W*0.168,h:H*0.375},
    feed:{x:W*0.545,y:H-H*0.155,w:W*0.272,h:H*0.150},
    grip:{x:W*0.462,y:H-botH+H*0.048,w:W*0.150,h:botH*0.46},
    paperCol:{x:W*0.008,y:topH+H*0.008,w:W*0.175},
    lens:{x:bx+side*0.085,y:by+side*0.085,r:0}
  };
  G.lens.r=Math.max(26,side*0.072);
  /* the sheet's own furniture: the trim margin drawStage() will leave, in
     device pixels, converted back to the screen coordinates we draw in */
  const mg=Math.round(side*kr*(0.072));
  G.margin=mg/kr;
  /* three register pins, one per plate, at the sheet's edges: the instrument
     and the readout are the same object. */
  const pk=Math.max(11,16*s), prad=Math.max(18,30*s);
  G.pins=[
    {id:'blue',  ink:0,name:'BLUE',   hx:bx-prad*1.75,      hy:by+side*0.28, r:pk, rad:prad, dir:[-0.62, 0.78]},
    {id:'pink',  ink:1,name:'PINK',   hx:bx-prad*1.75,      hy:by+side*0.72, r:pk, rad:prad, dir:[-0.86, 0.50]},
    {id:'yellow',ink:2,name:'YELLOW', hx:bx+side+prad*1.65, hy:by+side*0.54, r:pk, rad:prad, dir:[0.30,-0.95]}
  ];
  /* the ink ducts: three, cropped by the top of the frame, one key pulled */
  G.keys=[];
  for(let i=0;i<3;i++){
    const dw=G.ducts.w/3;
    G.keys.push({ink:i,x:G.ducts.x+dw*i,y:G.ducts.y,w:dw,h:G.ducts.h});
  }
  /* the drive side: four cams on a shaft, the law wheels beside them */
  G.cams=[];
  for(let i=0;i<4;i++)
    G.cams.push({i:i,x:G.camRack.x,y:G.camRack.y+G.camRack.h*(i+0.5)/4,
      r:Math.max(20,Math.min(W*0.040,H*0.060))});
  G.wheels=[];
  return G;
}

/* every fixed rect of the machine, in one place, so the static plate, the
   moving parts and the hit tests cannot disagree about where a part is */
function machineFit(){
  const G=SHV.G,W=G.W,H=G.H,s=G.s,lw=Math.max(1,1.25*s);
  const M={lw:lw,fs:Math.max(7.5,9.6*s)};
  M.duct={x:G.ducts.x,y:H*0.014,w:G.ducts.w,h:Math.max(28,H*0.062)};
  M.cyl={x:W*0.762,y:H*0.020,w:W*0.250,h:Math.max(24,H*0.060)};
  M.cylCap={x:M.cyl.x,y:M.cyl.y+M.cyl.h*0.5,r:M.cyl.h*0.62};
  M.clamp={x:W*0.780,y:M.cyl.y+M.cyl.h+H*0.004,w:W*0.226,h:Math.max(16,H*0.026)};
  M.imp={x:W*0.752,y:M.cyl.y+M.cyl.h+H*0.052,r:Math.max(16,H*0.030)};
  M.spr={x:G.upright.x+G.upright.w*0.50,y:H*0.355,r:Math.max(12,H*0.022)};
  M.fly={x:W*1.048,y:H*0.848,r:Math.max(40,H*0.118)};
  M.clutch={x:W*0.900,y:H*0.905};
  M.count={x:W*0.858,y:H*0.928,r:Math.max(20,H*0.036)};
  M.thr={x:W*0.255,y:H-Math.max(40,H*0.052),w:W*0.100,travel:W*0.085};
  M.lever={px:W*0.476,py:H*0.900,kx:W*0.462,ky:H*0.700,
           ex:W*0.448,ey:H*0.985,r:Math.max(17,H*0.028)};
  M.feed=G.feed;
  M.grip={x:G.sheet.x,y:G.sheet.y+G.sheet.h-Math.max(8,H*0.010),
          w:G.sheet.w,h:Math.max(22,H*0.030)};
  M.lens={x:G.lens.x,y:G.lens.y,r:G.lens.r};
  return M;
}

/* ── §6 · the static plate ──────────────────────────────────────────────────
   Drawn once per layout (and once per plate/law change, because two names are
   cast into the metal). Everything here is machine: the wall the spare plates
   hang on, the three ink ducts, the plate cylinder and its clamps, the upright
   the operator's hand rests on, the cam rack's backplate, the apron. The tone
   of every surface is a screen of dots; the metal is hatched like an engraving. */
function buildStatic(){
  const G=SHV.G,W=G.W,H=G.H,s=G.s,kr=G.kr,M=machineFit();
  SHV.M=M;
  const mk=()=>{const c=cv(W*kr,H*kr),g=c.getContext('2d');g.setTransform(kr,0,0,kr,0,0);
    g.lineJoin='round';return {c:c,g:g};};
  const back=mk(), fore=mk();
  const b=back.g, f=fore.g;
  const LW=M.lw, BLACK=TC.black, DEEP=TC.deep, MID=TC.mid;
  /* no forced angle: every surface screens at the angle of the ink that
     dominates it, so two castings that sit at the same tone still read apart */
  const frame=(g,P,tone,am,dark)=>face(g,P,tone,am==null?0.34:am);
  const edge=(g,P,am)=>shadow(g,P,am==null?0.55:am,45);

  /* ── the room: the paper itself, barely screened. The ground used to be laid
     down at TC.pale under a 0.30 screen, which put a mid tone across the whole
     window and left every casting sitting on a value almost equal to its own —
     the machine blended into the room. The room is now nearly paper, so the
     iron reads against it. */
  b.fillStyle=inkedHex(TC.wash);b.fillRect(0,0,W,H);
  shadow(b,rrP(0,0,W,H),0.13,15);
  /* the wall behind, with the hooks the spare plates hang on */
  frame(b,polyP([[G.wall.x,0],[G.wall.x+G.wall.w,0],
                 [G.wall.x+G.wall.w*0.985,G.wall.h],[G.wall.x+G.wall.w*0.02,G.wall.h]]),TC.light,0.28);
  shadow(b,polyP([[G.wall.x,0],[G.wall.x+G.wall.w,0],
                 [G.wall.x+G.wall.w*0.985,G.wall.h],[G.wall.x+G.wall.w*0.02,G.wall.h]]),0.24,75);
  /* the wall's name is set once, BELOW the hanging plates, by drawWallPlates().
     A second caption cast here at a fixed height printed straight through the
     plates themselves. */

  /* ── three ink ducts, cropped by the top of the frame, each with its keys */
  for(let i=0;i<3;i++){
    const k=G.keys[i], x=k.x+6*s, w=k.w-12*s, y=M.duct.y, h=M.duct.h;
    const P=polyP([[x,y],[x+w,y+2*s],[x+w-2*s,y+h],[x+2*s,y+h-3*s]]);
    frame(b,P,i===0?TC.cloud:i===1?TC.rose:TC.straw,0.40);
    edge(b,P,0.42);
    hatch(b,P,x,y,w,h+6,78,Math.max(3,4.4*s),Math.max(0.7,0.9*s),TC.black,0.30);
    b.save();b.strokeStyle=inkedHex(BLACK);b.lineWidth=LW;b.stroke(P);b.restore();
    /* the row of key studs along the duct's lower lip */
    const n=10, kw=w/n;
    for(let j=0;j<n;j++){
      const cx=x+j*kw+kw*0.5, sy=y+h-3*s;
      face(b,rrP(cx-2.6*s,sy,5.2*s,16*s,2*s),TC.dark,0.42);
      b.save();b.strokeStyle=inkedHex(BLACK);b.lineWidth=LW*0.8;
      b.stroke(rrP(cx-2.6*s,sy,5.2*s,16*s,2*s));b.restore();
    }
    cut(b,x+3*s,y+h+22*s,[ 'BLUE INK','FLUORESCENT PINK','YELLOW INK'][i],
        {size:M.fs*0.86,track:1.0,col:inkedHex(TC.black)});
    cut(b,x+3*s,y+h+22*s+M.fs*1.15,'0   25   50   75  100',
        {size:M.fs*0.66,col:inkedHex(TC.mid)});
  }

  /* ── the plate cylinder, cropped by the top and the right of the frame,
        with the plate we are printing clamped to it */
  const cy=M.cyl;
  face(b,rrP(cy.x,cy.y,cy.w,cy.h,cy.h*0.5),TC.dark,0.34);
  hatch(b,rrP(cy.x,cy.y,cy.w,cy.h,cy.h*0.5),cy.x,cy.y,cy.w,cy.h,90,
        Math.max(4,6*s),Math.max(0.7,0.9*s),TC.black,0.34);
  b.save();b.strokeStyle=inkedHex(BLACK);b.lineWidth=LW*1.2;
  b.stroke(rrP(cy.x,cy.y,cy.w,cy.h,cy.h*0.5));b.restore();
  /* the bearing the cylinder turns in, and the cylinder's own name cast on it */
  face(b,circP(M.cylCap.x,M.cylCap.y,M.cylCap.r),TC.mid,0.36);
  b.save();b.strokeStyle=inkedHex(BLACK);b.lineWidth=LW;b.stroke(circP(M.cylCap.x,M.cylCap.y,M.cylCap.r));b.restore();
  face(b,circP(M.cylCap.x,M.cylCap.y,M.cylCap.r*0.32),TC.paper,0.20);
  b.save();b.strokeStyle=inkedHex(BLACK);b.lineWidth=LW;b.stroke(circP(M.cylCap.x,M.cylCap.y,M.cylCap.r*0.32));b.restore();
  /* the plate's clamp bar: two grub screws and the plate's own name */
  const cl=M.clamp;
  face(b,rrP(cl.x,cl.y,cl.w,cl.h,3*s),TC.mid,0.40);
  hatch(b,rrP(cl.x,cl.y,cl.w,cl.h,3*s),cl.x,cl.y,cl.w,cl.h,0,
        Math.max(3,4*s),Math.max(0.7,0.9*s),TC.black,0.26);
  b.save();b.strokeStyle=inkedHex(BLACK);b.lineWidth=LW;b.stroke(rrP(cl.x,cl.y,cl.w,cl.h,3*s));b.restore();

  /* ── the upright: the frame the operator's hand rests on, and where the
        whole machine is grabbed and shaken */
  const up=G.upright;
  const UP=polyP([[up.x,up.y-H*0.02],[up.x+up.w,up.y-0.0],[up.x+up.w,up.y+up.h],[up.x,up.y+up.h]]);
  frame(b,UP,TC.deep,0.32);
  hatch(b,UP,up.x,up.y,up.w,up.h,72,Math.max(5,8*s),Math.max(0.7,1.0*s),TC.black,0.30);
  edge(b,UP,0.30);
  b.save();b.strokeStyle=inkedHex(BLACK);b.lineWidth=LW*1.2;b.stroke(UP);b.restore();
  for(let i=0;i<6;i++){                       /* cap screws down the casting */
    const y=up.y+up.h*(0.10+i*0.155);
    face(b,circP(up.x+up.w*0.5,y,3.4*s),TC.dark,0.5);
    b.save();b.strokeStyle=inkedHex(BLACK);b.lineWidth=LW*0.8;
    b.stroke(circP(up.x+up.w*0.5,y,3.4*s));b.restore();
  }
  b.save();b.translate(up.x+up.w*0.50,up.y+up.h*0.64);b.rotate(-Math.PI/2);
  cut(b,0,0,'GRAB HERE · SHAKE',{size:M.fs,track:1.2,align:'center',
      col:inkedHex(TC.paper)});
  b.restore();

  /* The shaft and its control wheels share one casting. Cams stay inboard;
     only the housing, never a label or an operable rim, may crop. */
  const cr=G.camRack, rackX=G.wheelCol.x-6*s;
  const CP=rrP(rackX,cr.y-cr.w*0.20,W-rackX-6*s,cr.h+cr.w*0.40,6*s);
  part(b,CP,TC.deep,0.22,{gap:2*s,lw:LW});
  face(b,rrP(cr.x-cr.w*0.26,cr.y-cr.w*0.20,cr.w*0.52,cr.h+cr.w*0.40,4*s),TC.mid,0.30);
  b.save();b.strokeStyle=inkedHex(BLACK);b.lineWidth=LW*0.9;
  b.stroke(rrP(cr.x-cr.w*0.26,cr.y-cr.w*0.20,cr.w*0.52,cr.h+cr.w*0.40,4*s));b.restore();
  cut(b,rackX+8*s,cr.y-cr.w*0.20+14*s,'LAW · TURN A CAM',
      {size:M.fs*0.84,col:inkedHex(TC.paper)});

  /* ── the apron: the cast edge the sheet sits down in, and the near frame
        that crops it on every side */
  const sh=G.sheet;
  const ap=polyP([[0,sh.y+sh.h+G.margin+2],[W,sh.y+sh.h+G.margin+2],
                  [W,H],[0,H]]);
  frame(b,ap,TC.deep,0.30);hatch(b,ap,0,sh.y+sh.h, W,H,78,Math.max(6,10*s),Math.max(0.7,1*s),TC.black,0.26);
  b.save();b.strokeStyle=inkedHex(BLACK);b.lineWidth=LW*1.4;
  b.beginPath();b.moveTo(0,sh.y+sh.h+G.margin+2);b.lineTo(W,sh.y+sh.h+G.margin+2);b.stroke();b.restore();
  /* The apron is the largest single casting in the frame, and a plain filled
     polygon that size is a dead navy field — it is what made the bottom of
     the machine blend into itself. A real apron is not a plane: it has a
     bolted top rail, and webs cast underneath it at a regular pitch. The
     rhythm of the ribs is what gives the lower third its structure, and every
     mark here is flat ink, a screen or a hatch. */
  const apTop=sh.y+sh.h+G.margin+2, railH=Math.max(14,20*s);
  const rail=rrP(0,apTop,W,railH,0);
  face(b,rail,TC.mid,0.34);
  b.save();b.strokeStyle=inkedHex(BLACK);b.lineWidth=LW;
  b.beginPath();b.moveTo(0,apTop+railH);b.lineTo(W,apTop+railH);b.stroke();b.restore();
  const pitch=Math.max(70,W/16), nrib=Math.ceil(W/pitch);
  for(let i=0;i<nrib;i++){
    const rx=i*pitch+pitch*0.5;
    /* the bolt that holds the rail down onto the web below it */
    face(b,circP(rx,apTop+railH*0.5,Math.max(2.2,3*s)),TC.dark,0.5);
    b.save();b.strokeStyle=inkedHex(BLACK);b.lineWidth=Math.max(0.7,0.9*s);
    b.stroke(circP(rx,apTop+railH*0.5,Math.max(2.2,3*s)));
    /* the web itself, a shallow relief cast into the apron's face */
    const wW=pitch*0.34, wT=apTop+railH+Math.max(5,7*s);
    const web=polyP([[rx-wW/2,wT],[rx+wW/2,wT],[rx+wW*0.40,H],[rx-wW*0.40,H]]);
    b.restore();
    face(b,web,TC.dark,0.30);
    hatch(b,web,rx-wW/2,wT,wW,H-wT,90,Math.max(3,4.4*s),Math.max(0.6,0.8*s),TC.black,0.22);
    b.save();b.strokeStyle=inkedHex(BLACK);b.lineWidth=Math.max(0.8,1*s);
    b.stroke(web);b.restore();
  }
  /* the drive housing at the far right, mostly cropped by the frame edge */
  const fh=circP(M.fly.x,M.fly.y,M.fly.r*1.22);
  face(b,fh,TC.dark,0.32);edge(b,fh,0.34);
  b.save();b.strokeStyle=inkedHex(BLACK);b.lineWidth=LW*1.2;b.stroke(fh);b.restore();
  hatch(b,circP(M.fly.x,M.fly.y,M.fly.r*1.22),M.fly.x-M.fly.r*1.3,M.fly.y-M.fly.r*1.3,
        M.fly.r*2.6,M.fly.r*2.6,30,Math.max(6,9*s),Math.max(0.7,1*s),TC.black,0.26);
  /* the counter's rack, where the predetermining counter is bolted */
  face(b,rrP(M.count.x-M.count.r*1.5,M.count.y-M.count.r*1.3,M.count.r*3.0,M.count.r*2.6,4*s),TC.deep,0.36);
  b.save();b.strokeStyle=inkedHex(BLACK);b.lineWidth=LW;
  b.stroke(rrP(M.count.x-M.count.r*1.5,M.count.y-M.count.r*1.3,M.count.r*3.0,M.count.r*2.6,4*s));b.restore();
  cut(b,M.count.x,M.count.y-M.count.r*0.95,'EDITION OF',{size:M.fs*0.8,align:'center',col:inkedHex(TC.paper)});
  /* the delivery board the printed sheets slide off onto, cropped by the left */
  const dl=G.delivery;
  face(b,rrP(dl.x,dl.y-6*s,dl.w+34*s,dl.h,4*s),TC.mid,0.30);
  b.save();b.strokeStyle=inkedHex(BLACK);b.lineWidth=LW;
  b.stroke(rrP(dl.x,dl.y-6*s,dl.w+34*s,dl.h,4*s));b.restore();
  cut(b,dl.x+dl.w*0.52,dl.y+2*s,'DELIVERY',{size:M.fs*0.9,track:1.4,col:inkedHex(TC.black)});
  /* the feed board, where blank stock waits to be pushed into the grippers */
  const fd=M.feed;
  face(b,rrP(fd.x,fd.y-10*s,fd.w,fd.h+10*s,4*s),TC.mid,0.30);
  b.save();b.strokeStyle=inkedHex(BLACK);b.lineWidth=LW;
  b.stroke(rrP(fd.x,fd.y-10*s,fd.w,fd.h+10*s,4*s));b.restore();
  cut(b,fd.x+4*s,fd.y-6*s,'FEED BOARD',{size:M.fs*0.9,track:1.4,col:inkedHex(TC.black)});
  /* the paperwork column: the proofs and the ticket are pinned here */
  const pc=G.paperCol;
  face(b,rrP(pc.x+2,pc.y-4*s,pc.w,pc.w*0.62,2*s),TC.wash,0.22);
  /* the tape slot, where the press prints what it just did */
  const tp=G.tape;
  face(b,rrP(tp.x-8*s,H-11*s,tp.w+16*s,13*s,2*s),TC.black,0.46);
  b.save();b.strokeStyle=inkedHex(BLACK);b.lineWidth=LW*1.2;
  b.stroke(rrP(tp.x-8*s,H-11*s,tp.w+16*s,13*s,2*s));b.restore();

  /* ── the bed: a recess the sheet lies in, cropped by the near frame so you
        see the machine crowding in on the artwork from all four sides */
  const bed=rrP(sh.x-G.margin-Math.max(6,10*s),sh.y-G.margin-Math.max(6,10*s),
                sh.w+(G.margin+Math.max(6,10*s))*2,sh.h+(G.margin+Math.max(6,10*s))*2,4*s);
  /* The bed rings the artwork, so it must stay quiet: a dark casting with just
     enough knocked-out tooth to read as printed, never a 50% dither fighting
     the sheet it is holding. */
  face(b,bed,TC.black,0.20);
  hatch(b,bed,sh.x-G.margin,sh.y-G.margin,sh.w+G.margin*2,sh.h+G.margin*2,45,
        Math.max(4,6*s),Math.max(0.6,0.8*s),TC.deep,0.30);
  b.save();b.strokeStyle=inkedHex(TC.mid);b.lineWidth=LW*1.6;b.stroke(bed);b.restore();
  /* the aperture: the sheet is drawn by the app's own press, and shows through */
  b.clearRect(sh.x,sh.y,sh.w,sh.h);

  const lip=Math.max(5,7*s);
  /* the near lip of the bed, over the bottom of the sheet, and the head lip
     over the top: this is what makes the sheet a window in a machine */
  face(f,rrP(sh.x-lip,sh.y-lip,sh.w+lip*2,lip,2*s),TC.black,0.44);
  face(f,rrP(sh.x-lip,sh.y+sh.h,sh.w+lip*2,lip,2*s),TC.black,0.44);
  face(f,rrP(sh.x-lip,sh.y-lip,lip,sh.h+lip*2,2*s),TC.black,0.44);
  face(f,rrP(sh.x+sh.w,sh.y-lip,lip,sh.h+lip*2,2*s),TC.black,0.44);
  f.save();f.strokeStyle=inkedHex(TC.dark);f.lineWidth=1;
  f.strokeRect(sh.x-lip+0.5,sh.y-lip+0.5,sh.w+lip*2-1,sh.h+lip*2-1);f.restore();
  /* the grippers at the sheet's leading edge: the slot the stock goes into */
  const gp=M.grip;
  face(f,rrP(gp.x-2,gp.y+gp.h*0.30,gp.w+4,gp.h*0.46,2*s),TC.blue,0.44);
  f.save();f.strokeStyle=inkedHex(TC.black);f.lineWidth=LW;
  f.stroke(rrP(gp.x-2,gp.y+gp.h*0.30,gp.w+4,gp.h*0.46,2*s));f.restore();
  for(let i=0;i<9;i++){
    const x=gp.x+gp.w*(i+0.5)/9;
    face(f,rrP(x-2.6*s,gp.y+gp.h*0.26,5.2*s,gp.h*0.54,1.5*s),TC.black,0.42);
  }

  SHV.back=back.c;SHV.fore=fore.c;
  SHV.sig=staticSig();
}
function staticSig(){
  const p=(typeof APP!=='undefined'&&APP.field)?APP.field.label:'';
  const w=(typeof APP!=='undefined'&&APP.world)?APP.world.label:'';
  return SHV.G.W+'x'+SHV.G.H+'|'+SHV.kr+'|'+p+'|'+w;
}

/* ── §7 · the moving parts ──────────────────────────────────────────────────
   Everything below is drawn every frame: the parts with text on them, the
   parts that move, and the instruments. It is all vector and it is all cheap —
   the textured metal is in the cache behind it. */
function slipArr(){                     /* the per-plate registration, in force */
  const out=[0,0,0];
  for(let i=0;i<3;i++){
    const p=SHV.pins[i];
    if(!p){out[i]=3;continue;}
    const d=Math.hypot(p.x-p.hx,p.y-p.hy);
    out[i]=clamp(d/p.rad,0,1)*3;
  }
  return out;
}
function regErr(){                      /* worst plate-to-plate error, device px */
  try{ return measuredSlip(); }catch(e){ return 0; }
}
function buildPins(){
  const G=SHV.G,previous=SHV.pins||[];
  if(SHV.drag?.kind==='pin')SHV.drag=null;
  SHV.pins=G.pins.map(p=>{
    const o={id:p.id,ink:p.ink,name:p.name,hx:p.hx,hy:p.hy,r:p.r,rad:p.rad,
             x:p.hx+p.dir[0]*p.rad,y:p.hy+p.dir[1]*p.rad,
             col:[TC.blue,TC.pink,TC.yell][p.ink],flash:0,snap:0};
    const old=previous.find(q=>q.id===p.id);
    if(old){o.x=p.hx+(old.x-old.hx)/old.rad*p.rad;o.y=p.hy+(old.y-old.hy)/old.rad*p.rad;o.wasHome=old.wasHome;}
    return o;
  });
}
function pinResidual(p){return clamp(Math.hypot(p.x-p.hx,p.y-p.hy)/p.rad,0,1);}
/* the pin's arm: its plate's real slip, drawn at the same ×5 the lens uses, so
   the pin and the magnified mark are two views of one number */
function drawPinArm(g,p){
  let sl={dx:0,dy:0};
  try{ const all=slips(); if(all&&all[p.ink])sl=all[p.ink]; }catch(e){ return; }
  const armScale=5;
  const dx=sl.dx/SHV.kr*armScale, dy=sl.dy/SHV.kr*armScale;
  const m=Math.hypot(dx,dy);
  if(m<0.7)return;
  g.save();g.strokeStyle=inkedHex(p.col);g.lineWidth=Math.max(1.2,1.6*SHV.G.s);
  g.globalAlpha=0.95;
  g.beginPath();g.moveTo(p.hx,p.hy);g.lineTo(p.hx+dx*3,p.hy+dy*3);g.stroke();
  g.beginPath();g.arc(p.hx+dx*3,p.hy+dy*3,3.4*SHV.G.s,0,6.2832);
  g.stroke();g.restore();
}
function drawPins(g){
  const G=SHV.G,s=G.s,LW=SHV.M.lw;
  for(const p of SHV.pins){
    const res=pinResidual(p);
    /* the pocket the pin slides in, and the zero ring it has to reach */
    g.save();
    const pk=circP(p.hx,p.hy,p.rad*1.06);
    face(g,pk,TC.deep,0.40);shadow(g,pk,0.34,75);
    g.strokeStyle=inkedHex(TC.black);g.lineWidth=LW;g.stroke(pk);
    g.strokeStyle=inkedHex(TC.paper);g.lineWidth=Math.max(1,1.4*s);
    g.stroke(circP(p.hx,p.hy,p.rad*0.24));
    g.beginPath();g.moveTo(p.hx-p.rad*.4,p.hy);g.lineTo(p.hx+p.rad*.4,p.hy);
    g.moveTo(p.hx,p.hy-p.rad*.4);g.lineTo(p.hx,p.hy+p.rad*.4);g.stroke();
    g.fillStyle=inkedHex(TC.paper);
    g.fillRect(p.hx-28*s,p.hy-p.rad*1.22-10*s,56*s,14*s);
    g.restore();
    cut(g,p.hx,p.hy-p.rad*1.22,p.name,{size:Math.max(7,8.6*s)*0.92,track:1.0,
      align:'center',col:inkedHex(TC.black)});
    cut(g,p.hx,p.hy+p.rad*1.5,res<0.02?'0':(res*100).toFixed(0)+'%',
      {size:Math.max(7,8*s),align:'center',col:inkedHex(TC.paper)});
    drawPinArm(g,p);
    /* the pin itself: a knurled stud dropping into the notch when it is home */
    const x=p.x,y=p.y,rr=p.r*.80*(1-0.10*res);
    const st=circP(x,y,rr*1.35);
    face(g,st,TC.dark,0.44);hatch(g,st,x-rr*1.6,y-rr*1.6,rr*3.2,rr*3.2,60,
      Math.max(1.6,2.2*s),Math.max(0.6,0.8*s),TC.black,0.4);
    g.save();
    g.fillStyle=inkedHex(p.col);g.beginPath();g.arc(x,y,rr*0.62,0,6.2832);g.fill();
    g.strokeStyle=inkedHex(TC.black);g.lineWidth=LW*0.9;
    g.beginPath();g.arc(x,y,rr*1.35,0,6.2832);g.stroke();
    g.beginPath();g.arc(x,y,rr*0.62,0,6.2832);g.stroke();
    if(p.flash>0){
      g.globalAlpha=Math.min(1,p.flash);g.strokeStyle=inkedHex(TC.black);
      g.lineWidth=LW*1.6;g.beginPath();
      g.arc(x,y,rr*(1.6+3.4*(1-p.flash)),0,6.2832);g.stroke();g.globalAlpha=1;
    }
    g.restore();
    if(res<0.02)cut(g,x,y+rr*0.34,'✓',{size:rr*1.0,align:'center',col:inkedHex(TC.black)});
  }
}
/* ── §8 · the register magnifier ────────────────────────────────────────────
   The instrument and the readout are the same object: this is a ×5 glass over
   the sheet's own trim-corner crop mark, drawn with the same plate slips the
   press is printing, so the three coloured chains of halftone dots in here are
   literally the fringes on the sheet. Bring the pins home and they converge. */
function drawLens(g){
  const G=SHV.G,s=G.s,L=M0().lens,x0=G.sheet.x+G.margin,y0=G.sheet.y+G.margin;
  const mag=5, win=L.r*2/mag, ox=x0+1-win*0.42, oy=y0+1-win*0.42;
  const proj=(wx,wy)=>[L.x+(wx-ox)*mag,L.y+(wy-oy)*mag];
  g.save();
  g.beginPath();g.arc(L.x,L.y,L.r,0,6.2832);g.clip();
  g.fillStyle=inkedHex(TC.paper);g.fillRect(L.x-L.r,L.y-L.r,L.r*2,L.r*2);
  /* paper: a fine blue screen so the glass reads as paper, not as white */
  g.fillStyle=patFor(g,inkedHex(TC.pale),0.13,4.2,15);
  g.fillRect(L.x-L.r,L.y-L.r,L.r*2,L.r*2);
  const o=5, Ln=10, lw=1.4, dot=5*DOT/SHV.kr, rr=dot*0.54;
  let sl=[{dx:0,dy:0},{dx:0,dy:0},{dx:0,dy:0}];
  try{ sl=slips(); }catch(e){}
  for(let p=0;p<3;p++){
    const sx=sl[p].dx/SHV.kr*mag, sy=sl[p].dy/SHV.kr*mag;
    const col=inkedHex([TC.blue,TC.pink,TC.yell][p]);
    g.fillStyle=col;
    const seg=(ax,ay,bx,by)=>{
      const [X1,Y1]=proj(ax+sx,ay+sy),[X2,Y2]=proj(bx+sx,by+sy);
      const n=Math.max(2,Math.ceil(Math.hypot(X2-X1,Y2-Y1)/dot));
      for(let i=0;i<=n;i++){
        const t=i/n;
        g.beginPath();g.arc(X1+(X2-X1)*t,Y1+(Y2-Y1)*t,rr,0,6.2832);g.fill();
      }
    };
    seg(x0-o,y0,x0-o-Ln,y0);
    seg(x0,y0-o,x0,y0-o-Ln);
  }
  /* the sheet's own trim corner: the edge of the printed image, inside the glass */
  const [tx,ty]=proj(x0,y0);
  g.globalAlpha=0.30;g.strokeStyle=inkedHex(TC.black);g.lineWidth=1;
  g.beginPath();g.moveTo(tx,ty);g.lineTo(tx,ty+L.r*2);g.moveTo(tx,ty);g.lineTo(tx+L.r*2,ty);
  g.stroke();g.globalAlpha=1;
  g.restore();
  /* the bezel: a bolted ring of cast metal with the instrument's name on it */
  const r=regErr();
  g.save();
  g.strokeStyle=inkedHex(TC.black);g.lineWidth=Math.max(2.4,3.4*s);
  g.beginPath();g.arc(L.x,L.y,L.r+Math.max(1.6,2.4*s),0,6.2832);g.stroke();
  g.strokeStyle=inkedHex(TC.dark);g.lineWidth=Math.max(1,1.4*s);
  g.beginPath();g.arc(L.x,L.y,L.r+Math.max(4,6*s),0,6.2832);g.stroke();
  for(let i=0;i<6;i++){
    const a=i*Math.PI/3+0.5, bx=L.x+Math.cos(a)*(L.r+Math.max(4,6*s)),
          by=L.y+Math.sin(a)*(L.r+Math.max(4,6*s));
    g.fillStyle=inkedHex(TC.mid);g.beginPath();
    g.arc(bx,by,Math.max(1.6,2.2*s),0,6.2832);g.fill();
  }
  g.restore();
  cut(g,L.x,L.y-L.r-Math.max(7,9*s),'REGISTER ×5',{size:Math.max(7,8.6*s),
    track:1.4,align:'center',col:inkedHex(TC.black)});
  /* the number the operator works to, cast into the bezel */
  const tight=r<0.30;
  cut(g,L.x,L.y+L.r+Math.max(12,15*s),tight?'DEAD ON':r.toFixed(2)+' px',
    {size:Math.max(9,12*s),track:0.8,align:'center',bold:true,
     col:inkedHex(tight?TC.teal:TC.red)});
  cut(g,L.x,L.y+L.r+Math.max(22,27*s),'WORST PLATE TO PLATE',
    {size:Math.max(6.5,7.4*s),track:1.0,align:'center',col:inkedHex(TC.mid)});
}
function M0(){return SHV.M;}

/* ── §9 · the ink ducts ─────────────────────────────────────────────────────
   Three keys, pulled toward the operator to open. A key is not a slider: it
   has travel, it hisses ink into the duct when it moves, and the bead of ink
   in the duct under it is the same number, printed. */
function drawKeys(g){
  const G=SHV.G,s=G.s,M=SHV.M,LW=M.lw;
  for(let i=0;i<3;i++){
    const k=G.keys[i], x=k.x+6*s, w=k.w-12*s, y=M.duct.y, h=M.duct.h;
    const open=SHV.key[i], sy=y+h-3*s;
    /* the bead of ink along the duct's lip: how far the key is open */
    const bh=Math.max(2,7*s)*(0.14+0.86*open);
    g.save();
    const bead=rrP(x+4*s,sy+18*s-bh,w-8*s,bh,bh*0.5);
    face(g,bead,i===0?TC.blue:i===1?TC.pink:TC.yell,0.36);
    g.strokeStyle=inkedHex(TC.black);g.lineWidth=LW*0.8;g.stroke(bead);
    g.restore();
    cut(g,x+4*s,sy+16*s,['BLUE','PINK','YELLOW'][i]+'  KEY '+(open*100).toFixed(0)+'%',
      {size:Math.max(7,8.2*s),track:0.8,col:inkedHex(TC.black)});
    /* the master key: the one big stud per duct, hanging below the lip */
    const kx=x+w-Math.max(14,17*s), ky=sy-4*s, kp=open*Math.max(20,26*s);
    const keyP=rrP(kx-Math.max(5,6.4*s),ky+kp,Math.max(10,12.8*s),Math.max(26,34*s),2.4*s);
    face(g,keyP,TC.dark,0.44);
    hatch(g,keyP,kx-8*s,ky,16*s,34*s,84,Math.max(2,2.6*s),Math.max(0.6,0.8*s),TC.black,0.42);
    g.save();g.strokeStyle=inkedHex(TC.black);g.lineWidth=LW*1.1;g.stroke(keyP);g.restore();
    /* the key's scale: five notches and the pull's own shadow */
    for(let j=0;j<=4;j++){
      const yy=ky+j*Math.max(5,6.5*s);
      line(g,kx-16*s,yy,kx-8*s,yy,TC.black,Math.max(0.8,1*s),0.8);
    }
    if(SHV.keyHi===i){
      g.save();g.strokeStyle=inkedHex(TC.paper);g.lineWidth=LW*1.4;
      g.stroke(rrP(kx-9*s,ky+kp-2,Math.max(18,21*s),Math.max(30,38*s),3*s));g.restore();
    }
  }
}

/* ── §10 · the cylinder head: the plate's screws, the impression, the spray ── */
function drawHead(g){
  const G=SHV.G,s=G.s,M=SHV.M,LW=M.lw;
  /* the plate clamped to the cylinder: its name, stamped, and its two screws */
  const plate=(typeof APP!=='undefined'&&APP.field)?APP.field.label:'—';
  const labelX=M.clamp.x+8*s, labelW=Math.min(M.clamp.w,G.W-labelX)-16*s;
  cut(g,labelX,M.clamp.y+M.clamp.h*0.70,
      fit(g,'PLATE · '+plate,Math.max(7.5,9*s),labelW),
      {size:Math.max(7.5,9*s),col:inkedHex(TC.paper)});
  const fp=(typeof API!=='undefined'&&API.fieldParams)?API.fieldParams():[];
  SHV.headHit=[];
  for(let i=0;i<fp.length;i++){
    const p=fp[i], cx=G.sheet.x+G.sheet.w*(0.62+i*0.19), cy=M.clamp.y+M.clamp.h*0.52;
    if(p.options){
      /* a two-position detent lever, because a choice is not a range */
      const on=p.value===p.options[1].value;
      const P=rrP(cx-Math.max(9,11*s),cy-Math.max(5,6*s),Math.max(18,22*s),Math.max(10,12*s),3*s);
      face(g,P,TC.mid,0.40);
      const kx=cx+(on?1:-1)*Math.max(6,7.5*s);
      face(g,circP(kx,cy,Math.max(4,5.4*s)),TC.red,0.40);
      g.save();g.strokeStyle=inkedHex(TC.black);g.lineWidth=LW*0.9;
      g.stroke(P);g.stroke(circP(kx,cy,Math.max(4,5.4*s)));g.restore();
      cut(g,cx,cy-Math.max(9,11*s),shortLab(p.label),{size:Math.max(6.5,7.4*s),track:0.8,
        align:'center',col:inkedHex(TC.black)});
      cut(g,cx,cy+Math.max(13,16*s),(on?p.options[1].label:p.options[0].label).slice(0,12),
        {size:Math.max(6,6.8*s),align:'center',col:inkedHex(TC.mid)});
      SHV.headHit.push({i:i,cx:cx,cy:cy,r:Math.max(11,13*s)});
    }else{
      const kn=circP(cx,cy,Math.max(9,11*s));
      face(g,kn,TC.dark,0.42);
      hatch(g,kn,cx-12*s,cy-12*s,24*s,24*s,45,Math.max(2,2.6*s),Math.max(0.6,0.8*s),TC.black,0.42);
      const t=(p.value-p.min)/(p.max-p.min||1);
      g.save();
      g.strokeStyle=inkedHex(TC.black);g.lineWidth=LW*0.8;g.stroke(kn);
      g.strokeStyle=inkedHex(TC.red);g.lineWidth=LW*1.1;
      g.beginPath();g.moveTo(cx,cy);
      g.lineTo(cx+Math.cos(-Math.PI/2+t*6.2832)*Math.max(7,8.6*s),
               cy+Math.sin(-Math.PI/2+t*6.2832)*Math.max(7,8.6*s));
      g.stroke();g.restore();
      cut(g,cx,cy-Math.max(12,15*s),shortLab(p.label),{size:Math.max(6.5,7.4*s),
        align:'center',col:inkedHex(TC.black)});
      cut(g,cx,cy+Math.max(14,17.5*s),fmt(p.value),{size:Math.max(6.5,7.6*s),
        align:'center',col:inkedHex(TC.mid)});
      SHV.headHit.push({i:i,cx:cx,cy:cy,r:Math.max(10,12*s)});
    }
  }
  /* the impression: a wheel on the cylinder's bearing that packs the plate */
  const I=M.imp;
  face(g,circP(I.x,I.y,I.r),TC.dark,0.40);
  hatch(g,circP(I.x,I.y,I.r),I.x-I.r,I.y-I.r,I.r*2,I.r*2,0,
        Math.max(2.4,3.2*s),Math.max(0.6,0.8*s),TC.black,0.40);
  g.save();g.strokeStyle=inkedHex(TC.black);g.lineWidth=LW;g.stroke(circP(I.x,I.y,I.r));g.restore();
  for(let i=0;i<10;i++){
    const a=i*Math.PI/5+SHV.impA;
    line(g,I.x+Math.cos(a)*I.r*0.72,I.y+Math.sin(a)*I.r*0.72,
          I.x+Math.cos(a)*I.r*0.98,I.y+Math.sin(a)*I.r*0.98,TC.black,Math.max(1,1.3*s),0.8);
  }
  face(g,circP(I.x,I.y,I.r*0.30),TC.paper,0.22);
  g.save();g.strokeStyle=inkedHex(TC.black);g.lineWidth=LW*0.9;
  g.stroke(circP(I.x,I.y,I.r*0.30));g.restore();
  cut(g,I.x,I.y-Math.max(11,13.5*s),'IMPRESSION',{size:Math.max(6.5,7.4*s),track:1.0,
    align:'center',col:inkedHex(TC.black)});
  cut(g,I.x,I.y+I.r+Math.max(10,12.5*s),Mimp()+' × '+Mimp(),{size:Math.max(7.5,9*s),align:'center',
      bold:true,col:inkedHex(TC.red)});
  /* the anti-setoff spray: the air valve that pops the starbursts */
  const S2=M.spr, v=R.sparkBudget/40;
  cut(g,S2.x,S2.y-S2.r-Math.max(9,11*s),'SETOFF SPRAY',{size:Math.max(6.5,7.4*s),
    align:'center',col:inkedHex(TC.paper)});
  const nz=rrP(S2.x-S2.r*0.55,S2.y-S2.r*0.2,S2.r*1.1,S2.r*1.5,3*s);
  face(g,nz,TC.mid,0.42);
  g.save();g.strokeStyle=inkedHex(TC.black);g.lineWidth=LW;g.stroke(nz);g.restore();
  const vp=rrP(S2.x-S2.r*0.30,S2.y-S2.r*0.2+v*S2.r*1.2,S2.r*0.6,S2.r*0.5,2*s);
  face(g,vp,TC.blue,0.40);
  cut(g,S2.x,S2.y+S2.r*1.6,String(R.sparkBudget|0)+' pops',{size:Math.max(6.5,7.6*s),
    align:'center',col:inkedHex(TC.paper)});
  if(SHV.sprayPuff>0){
    g.save();g.globalAlpha=Math.min(0.9,SHV.sprayPuff);
    g.fillStyle=inkedHex(TC.blue);
    for(let i=0;i<11;i++){
      const a=-Math.PI*0.62+i*0.055, d=S2.r*(0.5+2.2*(1-SHV.sprayPuff));
      g.beginPath();g.arc(S2.x+Math.cos(a)*d,S2.y+Math.sin(a)*d,Math.max(1.1,1.5*s),0,6.2832);
      g.fill();
    }
    g.restore();
  }
}
function shortLab(l){
  const map={'gap sample space':'FIT','gap neighbour rank':'NEIGHBOUR RANK','coupling':'COUPLING K',
    'record detune':'DETUNE','energy spread':'SPREAD','record pull':'RECORD PULL','step':'STEP',
    'terrain gravity':'GRAVITY','topple above (4-card minimum)':'TOPPLE AT','record feed':'RECORD FEED',
    'loud source columns':'SOURCE COLUMNS','phase steers falls':'PHASE STEERS','feed F':'FEED F',
    'kill k':'KILL K','diffusion U / V':'DIFFUSION','record modulation':'RECORD MOD.'};
  return map[l]||l.toUpperCase().slice(0,14);
}
function fmt(v){
  if(typeof v!=='number')return String(v);
  return Math.abs(v)>=100?v.toFixed(0):(Math.abs(v)>=10?v.toFixed(1):v.toFixed(2));
}
/* ── §11 · the law: cams on the drive side, and the wheels that set one ──────
   The four laws are four cams on the shaft. The one whose follower is riding it
   is the law working the ink; you swap it by hauling another cam toward you
   along the shaft, and the old one springs out. The engaged cam's tappets —
   its own params — are the knurled wheels beside it, and nothing else on the
   machine has that many wheels. */
function camState(){
  const cams=SHV.cams||(SHV.cams=G0().cams.map(c=>({i:c.i,x:0,out:0})));
  if(!SHV.camsInit){SHV.camsInit=1;for(const c of cams)c.x=1;}
  return cams;
}
function G0(){return SHV.G;}
function drawCams(g){
  const G=SHV.G,s=G.s,M=SHV.M,LW=M.lw,cams=camState();
  const list=(typeof API!=='undefined'&&API.worlds)?API.worlds():[];
  const cur=(typeof APP!=='undefined')?APP.wrldId:'';
  for(let i=0;i<G.cams.length;i++){
    const c=G.cams[i],st=cams[i],w=list[i];
    if(!w)continue;
    const on=(w.id===cur);
    /* the follower rides the engaged cam and stands off the others */
    const dx=(st.x===undefined?1:st.x), cx=c.x+dx*0.30*c.r;
    part(g,circP(cx,c.y,c.r),on?TC.cloud:TC.mid,0.20,{gap:2*s,lw:LW});
    hatch(g,circP(cx,c.y,c.r),cx-c.r,c.y-c.r,c.r*2,c.r*2,on?0:30,
          Math.max(3,4.2*s),Math.max(0.6,0.8*s),TC.black,0.34);
    /* the lobe: the part of the cam that does the work */
    const lobe=polyP([[cx,c.y],[cx+c.r*0.98,c.y-c.r*0.40],
                      [cx+c.r*0.62,c.y+c.r*0.62]]);
    face(g,lobe,on?TC.red:TC.deep,0.40);
    g.save();
    g.strokeStyle=inkedHex(TC.black);g.lineWidth=LW;
    g.stroke(circP(cx,c.y,c.r));g.stroke(lobe);
    g.beginPath();g.arc(cx,c.y,c.r*0.20,0,6.2832);g.stroke();
    g.restore();
    /* the law's name cast into its own cam */
    g.save();g.translate(cx-c.r*0.34,c.y);g.rotate(-Math.PI/2);
    cut(g,0,0,fit(g,w.label,Math.max(7,8.4*s),c.r*1.6),
      {size:Math.max(7,8.4*s),align:'center',bold:on,col:inkedHex(TC.paper)});
    g.restore();
    /* the follower arm, on the engaged cam only */
    if(on){
      const ax=cx-c.r-Math.max(10,13*s);
      face(g,rrP(ax-Math.max(22,28*s),c.y-Math.max(3.4,4.2*s),
        Math.max(22,28*s),Math.max(6.8,8.4*s),2*s),TC.dark,0.42);
      g.save();g.strokeStyle=inkedHex(TC.black);g.lineWidth=LW;
      g.stroke(rrP(ax-Math.max(22,28*s),c.y-Math.max(3.4,4.2*s),
        Math.max(22,28*s),Math.max(6.8,8.4*s),2*s));
      g.strokeStyle=inkedHex(TC.red);g.lineWidth=LW*1.3;
      g.beginPath();g.arc(cx-c.r,c.y,Math.max(2.4,3.2*s),0,6.2832);g.stroke();
      g.restore();
    }else{
      g.save();g.globalAlpha=0.55;g.strokeStyle=inkedHex(TC.deep);
      g.lineWidth=LW*0.9;g.beginPath();g.arc(cx,c.y,c.r,0,6.2832);g.stroke();g.restore();
    }
    if(SHV.camHi===i){
      g.save();g.strokeStyle=inkedHex(TC.paper);g.lineWidth=LW*1.6;
      g.beginPath();g.arc(cx,c.y,c.r+Math.max(3,4*s),0,6.2832);g.stroke();g.restore();
    }
  }
}
/* the law's own tappet wheels: one per param of the cam that is on the shaft */
function drawWheels(g){
  const G=SHV.G,s=G.s,M=SHV.M,LW=M.lw;
  const ps=(typeof API!=='undefined'&&API.worldParams)?API.worldParams():[];
  const col=G.wheelCol, n=ps.length;
  SHV.wheelHit=[];
  if(!n)return;
  const step=col.h/n, r=Math.min(Math.max(13,20*s),step*0.40);
  for(let i=0;i<n;i++){
    const p=ps[i], cx=col.x+col.w*0.45, cy=col.y+step*(i+0.5);
    const labelSize=Math.max(6.5,8.4*s);
    cut(g,cx,cy-r-Math.max(7,9*s),fit(g,shortLab(p.label),labelSize,col.w-8*s),
      {size:labelSize,align:'center',col:inkedHex(TC.paper)});
    if(p.options){
      const on=p.value===p.options[1].value;
      const P=rrP(cx-Math.max(9,11*s),cy-Math.max(7,8.6*s),Math.max(30,36*s),Math.max(14,17*s),3*s);
      face(g,P,TC.deep,0.42);
      const kx=cx+(on?1:-1)*Math.max(9,11*s);
      face(g,circP(kx,cy,Math.max(5,6*s)),TC.red,0.40);
      g.save();g.strokeStyle=inkedHex(TC.black);g.lineWidth=LW*0.9;g.stroke(P);
      g.stroke(circP(kx,cy,Math.max(5,6*s)));g.restore();
      cut(g,cx,cy+r+Math.max(7,8.4*s),(on?p.options[1].label:p.options[0].label).slice(0,10),
        {size:Math.max(6,7.4*s),align:'center',col:inkedHex(TC.paper)});
      SHV.wheelHit.push({i:i,cx:cx,cy:cy,r:r});
      continue;
    }
    const t=(p.value-p.min)/(p.max-p.min||1);
    part(g,circP(cx,cy,r),TC.mid,0.20,{gap:1.6*s,lw:LW});
    hatch(g,circP(cx,cy,r),cx-r,cy-r,r*2,r*2,60,Math.max(2,2.6*s),
          Math.max(0.6,0.8*s),TC.black,0.42);
    g.save();
    g.strokeStyle=inkedHex(TC.black);g.lineWidth=LW;g.stroke(circP(cx,cy,r));
    for(let j=0;j<8;j++){
      const a=j*Math.PI/4;
      g.beginPath();g.moveTo(cx+Math.cos(a)*r*0.66,cy+Math.sin(a)*r*0.66);
      g.lineTo(cx+Math.cos(a)*r*0.94,cy+Math.sin(a)*r*0.94);g.stroke();
    }
    g.strokeStyle=inkedHex(TC.paper);g.lineWidth=LW*1.6;
    const a=-Math.PI*0.5+t*6.2832;
    g.beginPath();g.moveTo(cx,cy);
    g.lineTo(cx+Math.cos(a)*r*0.70,cy+Math.sin(a)*r*0.70);g.stroke();
    g.restore();
    face(g,circP(cx,cy,r*0.17),TC.paper,0.20);
    cut(g,cx,cy+r+Math.max(8,9.6*s),fmt(p.value),{size:Math.max(7,8.2*s),
      align:'center',bold:true,col:inkedHex(TC.paper)});
    SHV.wheelHit.push({i:i,cx:cx,cy:cy,r:r});
  }
}
/* ── §12 · the drive: the flywheel you turn by hand to inch the press, the
   clutch that decides whether it runs at all, and the predetermining counter */
function drawDrive(g){
  const G=SHV.G,s=G.s,M=SHV.M,LW=M.lw,F=M.fly;
  /* the flywheel: cropped by the right edge of the frame, spinning when the
     drive is in, and turned by a circular drag to inch the machine */
  face(g,circP(F.x,F.y,F.r),TC.mid,0.34);
  hatch(g,circP(F.x,F.y,F.r),F.x-F.r,F.y-F.r,F.r*2,F.r*2,90,
        Math.max(4,5.5*s),Math.max(0.6,0.8*s),TC.black,0.30);
  g.save();
  g.strokeStyle=inkedHex(TC.black);g.lineWidth=LW*1.5;
  g.beginPath();g.arc(F.x,F.y,F.r,0,6.2832);g.stroke();
  g.lineWidth=LW;g.beginPath();g.arc(F.x,F.y,F.r*0.80,0,6.2832);g.stroke();
  g.strokeStyle=inkedHex(TC.deep);g.lineWidth=Math.max(3,4.2*s);
  for(let i=0;i<6;i++){
    const a=SHV.fly+i*Math.PI/3;
    g.beginPath();g.moveTo(F.x+Math.cos(a)*F.r*0.30,F.y+Math.sin(a)*F.r*0.30);
    g.lineTo(F.x+Math.cos(a)*F.r*0.78,F.y+Math.sin(a)*F.r*0.78);g.stroke();
  }
  g.strokeStyle=inkedHex(TC.red);g.lineWidth=LW*1.2;
  const a0=SHV.fly;
  g.beginPath();g.moveTo(F.x,F.y);
  g.lineTo(F.x+Math.cos(a0)*F.r*0.70,F.y+Math.sin(a0)*F.r*0.70);g.stroke();
  g.restore();
  face(g,circP(F.x,F.y,F.r*0.20),TC.dark,0.42);
  g.save();g.strokeStyle=inkedHex(TC.black);g.lineWidth=LW;g.stroke(circP(F.x,F.y,F.r*0.20));g.restore();
  cut(g,F.x-F.r*0.5,F.y-F.r*0.86,'TURN TO INCH',{size:Math.max(6.5,7.4*s),track:0.8,
    align:'center',col:inkedHex(TC.black)});
  cut(g,F.x-F.r*0.5,F.y-F.r*0.86+Math.max(8,9.5*s),
    (typeof playing!=='undefined'&&playing)?'DRIVE IN':'DRIVE OUT',
    {size:Math.max(7,8.4*s),align:'center',bold:true,
     col:inkedHex((typeof playing!=='undefined'&&playing)?TC.teal:TC.red)});
  /* the clutch: two detents, in or out, nothing in between */
  const C=M.clutch, up=(typeof playing!=='undefined'&&playing);
  const P=rrP(C.x-Math.max(13,17*s),C.y-Math.max(16,20*s),Math.max(26,34*s),Math.max(32,40*s),3*s);
  face(g,P,TC.dark,0.42);
  g.save();g.strokeStyle=inkedHex(TC.black);g.lineWidth=LW;g.stroke(P);g.restore();
  const kx=C.x+(up?1:-1)*Math.max(9,11*s), ky=C.y-Math.max(12,15*s);
  g.save();g.strokeStyle=inkedHex(TC.black);g.lineWidth=LW*1.2;
  g.beginPath();g.moveTo(C.x,C.y+Math.max(12,15*s)*(up?-1:1));g.lineTo(kx,ky);g.stroke();
  g.restore();
  face(g,circP(kx,ky,Math.max(6,7.6*s)),TC.red,0.40);
  g.save();g.strokeStyle=inkedHex(TC.black);g.lineWidth=LW;g.stroke(circP(kx,ky,Math.max(6,7.6*s)));g.restore();
  line(g,C.x-Math.max(11,14*s),C.y-Math.max(16,20*s)-Math.max(5,6*s),
       C.x+Math.max(11,14*s),C.y-Math.max(16,20*s)-Math.max(5,6*s),TC.black,Math.max(0.8,1*s),0.8);
  cut(g,C.x,C.y+Math.max(28,34*s),'CLUTCH',{size:Math.max(6.5,7.4*s),track:1.0,
    align:'center',col:inkedHex(TC.paper)});
  /* the predetermining counter: the edition length is a dial on the delivery */
  const K=M.count, N=(typeof SHOP!=='undefined'?SHOP.N:8), dn=(typeof SHOP!=='undefined'?SHOP.pulled.length:0);
  face(g,circP(K.x,K.y,K.r),TC.dark,0.42);
  hatch(g,circP(K.x,K.y,K.r),K.x-K.r,K.y-K.r,K.r*2,K.r*2,75,
        Math.max(2.4,3.2*s),Math.max(0.6,0.8*s),TC.black,0.40);
  g.save();g.strokeStyle=inkedHex(TC.black);g.lineWidth=LW;g.stroke(circP(K.x,K.y,K.r));g.restore();
  face(g,rrP(K.x-K.r*0.52,K.y-K.r*0.34,K.r*1.04,K.r*0.68,2*s),TC.paper,0.20);
  g.save();g.strokeStyle=inkedHex(TC.black);g.lineWidth=LW*0.9;
  g.stroke(rrP(K.x-K.r*0.52,K.y-K.r*0.34,K.r*1.04,K.r*0.68,2*s));g.restore();
  cut(g,K.x,K.y+K.r*0.22,String(N),{size:K.r*0.62,align:'center',bold:true,
    col:inkedHex(TC.black)});
  cut(g,K.x,K.y+K.r*1.55,'SET · '+dn+' RUN',{size:Math.max(6.5,7.6*s),align:'center',
    col:inkedHex(TC.paper)});
}
/* ── §13 · the throttle: travel and detents, and nothing in between ───────── */
function drawThrottle(g){
  const G=SHV.G,s=G.s,M=SHV.M,LW=M.lw,T=M.thr;
  const det=[0,10,25,45,60];
  const v=(typeof speed!=='undefined')?speed:10;
  let near=0,bd=1e9;
  for(const d of det){const q=Math.abs(d-v);if(q<bd){bd=q;near=d;}}
  const t=near/60;
  const x=T.x+t*T.travel;
  /* the gate: five notches cut into the frame, and the lever that drops into
     one of them */
  const gate=rrP(T.x-Math.max(10,13*s),T.y-Math.max(12,15*s),
                 T.travel+Math.max(20,26*s),Math.max(30,38*s),3*s);
  face(g,gate,TC.deep,0.42);hatch(g,gate,T.x,T.y,T.travel,40,0,
       Math.max(3,4*s),Math.max(0.6,0.8*s),TC.black,0.30);
  g.save();g.strokeStyle=inkedHex(TC.black);g.lineWidth=LW;g.stroke(gate);g.restore();
  for(let i=0;i<det.length;i++){
    const nx=T.x+det[i]/60*T.travel, ny=T.y+Math.max(11,14*s);
    line(g,nx,ny,nx,ny+Math.max(5,6.5*s),TC.black,Math.max(1,1.3*s),0.85);
    cut(g,nx,ny+Math.max(15,19*s),String(det[i]),{size:Math.max(6,6.8*s),
      align:'center',col:inkedHex(TC.paper)});
  }
  const H=Math.max(24,31*s);
  const arm=rrP(x-Math.max(4,5*s),T.y-H,Math.max(8,10*s),H,2*s);
  face(g,arm,TC.mid,0.42);
  g.save();g.strokeStyle=inkedHex(TC.black);g.lineWidth=LW;g.stroke(arm);g.restore();
  const kn=circP(x,T.y-H,Math.max(9,11.5*s));
  face(g,kn,TC.red,0.40);shadow(g,kn,0.30,45);
  g.save();g.strokeStyle=inkedHex(TC.black);g.lineWidth=LW;g.stroke(kn);g.restore();
  const tagX=T.x-8*s, tagY=T.y-H-34*s, tagW=T.travel+16*s;
  const tag=rrP(tagX,tagY,tagW,22*s,1.5*s);
  face(g,tag,TC.paper,0.08);
  line(g,x,tagY+22*s,x,T.y-H-10*s,TC.paper,LW,1);
  cut(g,tagX+tagW/2,tagY+9*s,'PRESS SPEED',{size:Math.max(6.5,7.2*s),
    align:'center',col:inkedHex(TC.black)});
  cut(g,tagX+tagW/2,tagY+18*s,Math.round(v)+' gen/s',{size:Math.max(7,8*s),
    align:'center',bold:true,col:inkedHex(TC.black)});
  if(SHV.thrHi){
    g.save();g.strokeStyle=inkedHex(TC.paper);g.lineWidth=LW*1.5;
    g.stroke(circP(x,T.y-H,Math.max(13,16*s)));g.restore();
  }
}
/* ── §14 · the lever: the biggest thing in the frame after the sheet, coming
   toward you out of the machine. It has travel, it resists, it bottoms out and
   it thumps back. Nothing else in this shop makes a sheet exist. */
function drawLever(g){
  const G=SHV.G,s=G.s,M=SHV.M,LW=M.lw,L=M.lever,t=SHV.lev||0;
  const px=L.px,py=L.py;
  const kx=lerp(L.kx,L.ex,t), ky=lerp(L.ky,L.ey,t);
  const r=L.r*(1+0.30*t);
  /* the bracket bolted to the apron */
  const br=rrP(px-Math.max(24,30*s),py+Math.max(10,13*s),Math.max(48,60*s),Math.max(30,38*s),4*s);
  face(g,br,TC.dark,0.44);
  hatch(g,br,px-30*s,py,60*s,50*s,80,Math.max(3,4*s),Math.max(0.6,0.8*s),TC.black,0.34);
  g.save();g.strokeStyle=inkedHex(TC.black);g.lineWidth=LW*1.2;g.stroke(br);g.restore();
  for(const q of [-1,1]){
    face(g,circP(px+q*Math.max(18,22*s),py+Math.max(26,32*s),Math.max(2.6,3.4*s)),TC.black,0.5);
  }
  /* the linkage: a cast arm that takes the strain, hatched like an engraving */
  const w0=Math.max(9,11.5*s), w1=Math.max(13,17*s)+6*s*t;
  const P=polyP([[px-w0,py],[px+w0,py],[kx+w1,ky],[kx-w1,ky]]);
  face(g,P,TC.mid,0.34);
  hatch(g,P,Math.min(px,kx)-w1,py,w1*2+w0*2,ky-py,90,
        Math.max(3,4.2*s),Math.max(0.6,0.8*s),TC.black,0.34);
  g.save();g.strokeStyle=inkedHex(TC.black);g.lineWidth=LW*1.4;g.stroke(P);g.restore();
  /* the handle: a paper-wound grip, because that is what a press handle is */
  const kp=circP(kx,ky,r);
  face(g,kp,TC.dark,0.44);
  hatch(g,kp,kx-r,ky-r,r*2,r*2,60,Math.max(2.6,3.4*s),Math.max(0.6,0.9*s),TC.black,0.40);
  g.save();
  g.strokeStyle=inkedHex(TC.black);g.lineWidth=LW*1.6;g.stroke(kp);
  g.strokeStyle=inkedHex(TC.red);g.lineWidth=LW*1.2;g.stroke(circP(kx,ky,r*0.52));
  g.restore();
  /* The tag wired to the bracket: what this pull would do, in the press's own
     words. It is a manila shop tag — chamfered at the top, punched, and hung
     on a wire off the pivot — and NOT a rounded white rectangle floating over
     the machine, which is the one shape on this screen that would read as a
     browser tooltip instead of a thing in the room. */
  const lab=leverTag();
  const tw=Math.max(104,132*s), th=Math.max(36,46*s);
  const ax=px-Math.max(34,42*s), ay=py-Math.max(60,76*s);
  const ch=Math.max(7,9*s);                       /* the chamfer at the head */
  g.save();
  g.translate(ax,ay);g.rotate(-0.055);
  const tagP=polyP([[ch,0],[tw-ch,0],[tw,ch],[tw,th],[0,th],[0,ch]]);
  face(g,tagP,TC.paper,0.17);
  hatch(g,tagP,0,0,tw,th,15,Math.max(5,6.5*s),Math.max(0.5,0.6*s),TC.pale,0.30);
  g.strokeStyle=inkedHex(TC.black);g.lineWidth=LW*1.1;g.stroke(tagP);
  /* the punched eyelet, ringed the way a tag's eyelet is ringed */
  const ex=tw*0.5,ey=Math.max(7,8.5*s);
  g.fillStyle=inkedHex(TC.wash);g.fill(circP(ex,ey,Math.max(2.4,3*s)));
  g.strokeStyle=inkedHex(TC.deep);g.lineWidth=Math.max(0.7,0.9*s);
  g.stroke(circP(ex,ey,Math.max(3.6,4.6*s)));
  const tsz=Math.max(7,8.4*s);
  const lines=wrap(g,lab.txt,tsz,tw-10*s,true);
  let ty0=ey+Math.max(11,13*s);
  for(let i=0;i<lines.length;i++)
    cut(g,5*s,ty0+i*Math.max(9,10.5*s),lines[i],
      {size:tsz,bold:true,col:inkedHex(lab.tone)});
  cut(g,5*s,ty0+(lines.length-1)*Math.max(9,10.5*s)+Math.max(10,12*s),
    fit(g,lab.sub,Math.max(6,6.9*s),tw-10*s),
    {size:Math.max(6,6.9*s),col:inkedHex(TC.mid)});
  g.restore();
  /* the wire, slack, from the pivot up to the eyelet */
  g.save();g.strokeStyle=inkedHex(TC.deep);g.lineWidth=Math.max(0.8,1*s);
  const hx=ax+Math.cos(-0.055)*(tw*0.5)-Math.sin(-0.055)*(Math.max(7,8.5*s));
  const hy=ay+Math.sin(-0.055)*(tw*0.5)+Math.cos(-0.055)*(Math.max(7,8.5*s));
  g.beginPath();g.moveTo(px,py);
  g.quadraticCurveTo((px+hx)/2+6*s,(py+hy)/2+10*s,hx,hy);
  g.stroke();g.restore();
  /* the pull's own travel scale, cast into the apron beside the bracket */
  for(let i=0;i<=4;i++){
    const yy=py+Math.max(4,5*s)+i*Math.max(8,10*s);
    line(g,px+Math.max(30,38*s),yy,px+Math.max(36,46*s),yy,TC.black,Math.max(0.8,1*s),0.8);
  }
  cut(g,px+Math.max(24,30*s),py+Math.max(48,58*s),'TRAVEL',
    {size:Math.max(6,6.9*s),track:0.8,col:inkedHex(TC.black)});
  if(t>0.02){
    cut(g,kx,ky+r+Math.max(12,15*s),(t*100).toFixed(0)+'%',
      {size:Math.max(8,10*s),align:'center',bold:true,col:inkedHex(t>0.85?TC.red:TC.black)});
  }
}
function leverTag(){
  const st=(typeof SHOP!=='undefined')?SHOP.state:'makeready';
  if(st==='makeready')return {txt:'PULL A PROOF',sub:'THE PRESS IS NOT READY YET',tone:TC.red};
  if(st==='proof')return {txt:'APPROVE THE PROOF',sub:'CHANGE ANYTHING AND IT IS VOID',tone:TC.teal};
  if(st==='run')return {txt:'PULL SHEET '+Math.min(SHOP.n,SHOP.N)+' OF '+SHOP.N,
    sub:'EDITION RUNNING',tone:TC.black};
  return {txt:'NEW COMMISSION',sub:'RUN COMPLETE · '+SHOP.N+' DELIVERED',tone:TC.black};
}
/* ── §15 · the feed board ───────────────────────────────────────────────────
   A dropped file is a piece of stock: it lands on the pile, it can be carried,
   and it goes into the grippers like any other sheet. Nothing is loaded off a
   dialog. The picker behind the file input is opened by a physical hotspot on
   the board, and the input itself is never seen. */
function stockList(){
  const out=[{id:'gsfc',label:'GSFC QC6 STRAIN',kind:'house'},
             {id:'noise',label:'SEEDED NOISE',kind:'house'}];
  const f=(typeof APP!=='undefined')?APP.file:null;
  if(f)out.push({id:'file',label:(f.name||'DROPPED FILE').toUpperCase().slice(0,22),kind:f.kind,
                 file:f,thumb:SHV.thumb});
  return out;
}
function drawFeed(g){
  const G=SHV.G,s=G.s,M=SHV.M,LW=M.lw,F=M.feed;
  const list=stockList(), cur=(typeof APP!=='undefined')?APP.srcId:'';
  SHV.feedHit=[];
  const n=list.length, pitch=Math.min(Math.max(72,92*s),(F.w-10)/Math.max(1,n));
  /* the pile of blank stock the board carries, stepped like a real pile */
  for(let i=5;i>=0;i--){
    const P=rrP(F.x+8*s+i*2.4*s,F.y+F.h-26*s-i*3.2*s,F.w-16*s,20*s,1.5*s);
    face(g,P,TC.wash,0.16);
    g.save();g.strokeStyle=inkedHex(TC.deep);g.lineWidth=Math.max(0.7,0.9*s);g.stroke(P);g.restore();
  }
  for(let i=0;i<n;i++){
    const it=list[i], on=(it.id===cur);
    const x=F.x+6*s+pitch*i, y=F.y+(on?-6*s:4*s), w=pitch-8*s, h=Math.max(44,58*s);
    const P=rrP(x,y,w,h,1.6*s);
    face(g,P,on?TC.pale:TC.wash,0.14);
    shadow(g,P,0.20,45);
    g.save();
    g.strokeStyle=inkedHex(TC.black);g.lineWidth=LW*(on?1.2:0.9);g.stroke(P);
    g.restore();
    /* the sample is a proof of what is on it: the trajectory of that record */
    const px=x+5*s, py=y+5*s, pw=w-10*s, ph=h-24*s;
    if(it.kind==='house'||it.id==='file'){
      miniRecord(g,px,py,pw,ph,it.id==='gsfc'?(SHV.gsfc||null):(it.id==='file'?null:(SHV.noiseRec||null)));
    }
    if(it.kind==='image'&&SHV.thumb){
      g.save();g.clip(rrP(px,py,pw,ph,1.5));
      g.drawImage(SHV.thumb,px,py,pw,ph);g.restore();
    }
    const lines=wrap(g,it.label,Math.max(6,7*s),w-8*s,true);
    for(let j=0;j<Math.min(2,lines.length);j++)
      cut(g,x+4*s,y+h-Math.max(13,16*s)+j*Math.max(7.4,8.6*s),lines[j],
        {size:Math.max(6,7*s),bold:true,col:inkedHex(TC.black)});
    if(on){
      face(g,rrP(x+2*s,y-4*s,w-4*s,6*s,1.5*s),TC.yell,0.36);
      cut(g,x,y-6*s,'ON THE CYLINDER',{size:Math.max(6,6.9*s),track:0.6,
        col:inkedHex(TC.black)});
    }
    SHV.feedHit.push({i:i,x:x,y:y,w:w,h:h,it:it});
    if(SHV.stockHi===i){
      g.save();g.strokeStyle=inkedHex(TC.paper);g.lineWidth=LW*1.5;
      g.stroke(rrP(x-3,y-3,w+6,h+6,3*s));g.restore();
    }
  }
  /* the hotspot that opens the picker: a printed requisition slip, torn off
     and handed in — the only place a file dialog can be reached from */
  const hx=F.x+6*s+pitch*n+2*s, hy=F.y+8*s;
  if(hx+Math.max(52,66*s)<F.x+F.w+8*s){
    const P=rrP(hx,hy,Math.max(52,66*s),Math.max(30,38*s),1.5*s);
    face(g,P,TC.paper,0.14);
    g.save();g.strokeStyle=inkedHex(TC.black);g.lineWidth=LW*0.9;
    g.stroke(P);g.restore();
    cut(g,hx+4*s,hy+Math.max(12,15*s),'+ BUY',{size:Math.max(6.5,7.6*s),bold:true,
      col:inkedHex(TC.black)});
    cut(g,hx+4*s,hy+Math.max(21,25*s),'STOCK',{size:Math.max(6.5,7.6*s),bold:true,
      col:inkedHex(TC.black)});
    SHV.buyHit={x:hx,y:hy,w:Math.max(52,66*s),h:Math.max(30,38*s)};
  }else SHV.buyHit=null;
  /* a sheet of stock carried in the hand, or just landed: it is a real object */
  for(const d of SHV.stock){
    const P=rrP(d.x-d.w/2,d.y-d.h/2,d.w,d.h,2*s);
    face(g,P,TC.paper,0.14);shadow(g,P,0.30,45);
    g.save();g.strokeStyle=inkedHex(TC.black);g.lineWidth=LW*1.1;g.stroke(P);g.restore();
    const lines=wrap(g,d.label,Math.max(7,8.4*s),d.w-12*s,true);
    for(let j=0;j<Math.min(3,lines.length);j++)
      cut(g,d.x-d.w/2+6*s,d.y-d.h/2+Math.max(16,20*s)+j*Math.max(9,10.5*s),lines[j],
        {size:Math.max(7,8.4*s),bold:true,col:inkedHex(TC.black)});
    cut(g,d.x-d.w/2+6*s,d.y+d.h/2-Math.max(8,10*s),'STOCK · '+(d.size||''),
      {size:Math.max(6,7*s),col:inkedHex(TC.mid)});
  }
}
/* ── §16 · the delivery: sheets slide off and stack, cropped by the frame ─── */
function drawDelivery(g){
  const G=SHV.G,s=G.s,M=SHV.M,LW=M.lw,D=G.delivery;
  const pile=(typeof SHOP!=='undefined')?SHOP.pulled:[];
  const show=Math.min(6,pile.length);
  SHV.pileHit=[];
  for(let i=0;i<show;i++){
    const p=pile[pile.length-show+i];
    if(!p)continue;
    if(!p._im&&p.url){p._im=new Image();p._im.src=p.url;}
    const k=show-1-i;                        /* newest is on top of the pile */
    const side=Math.max(78,150*s);
    const cx=D.x+D.w*0.46+k*2.6*s, cy=D.y+D.h-18*s-k*9.5*s;
    const rot=(k%2?1:-1)*0.012;
    g.save();
    g.translate(cx,cy);g.rotate(rot);
    const P=rrP(-side/2,-side/2,side,side,1.5*s);
    face(g,P,TC.paper,0.12);shadow(g,P,0.26,45);
    g.save();g.clip(rrP(-side/2,-side/2,side,side,1.5*s));
    if(p._im&&p._im.complete&&p._im.naturalWidth)g.drawImage(p._im,-side/2,-side/2,side,side);
    g.restore();
    g.save();g.strokeStyle=inkedHex(TC.black);g.lineWidth=LW*1.1;
    g.stroke(rrP(-side/2,-side/2,side,side,1.5*s));g.restore();
    /* the pull is stamped on the sheet's own edge, like every other sheet here */
    const cap=(p.kind==='proof'?'PROOF':(p.n+'/'+p.N))+' · '+p.seed;
    cut(g,-side/2+2*s,side/2+Math.max(8,9.6*s),cap,{size:Math.max(6,6.9*s),
      col:inkedHex(p.kind==='proof'?TC.pink:TC.black)});
    g.restore();
    /* the top sheet is the one you can pick up */
    SHV.pileHit.push({i:pile.length-show+i,x:cx-side/2,y:cy-side/2,w:side,h:side,rot:rot,
      top:i===show-1,p:p});
  }
  /* The bay is deliberately cropped by the left frame — a sheet pile runs off
     the edge of a real press. Type cannot be cropped with it, so everything
     lettered here is centred on the VISIBLE part of the bay, not on a centre
     that sits out in the margin. */
  const vx=Math.max(D.x,8*s), vw=D.x+D.w-vx, vcx=vx+vw*0.5;
  if(!pile.length){
    /* The delivery bay is a dark casting, so this line is KNOCKED OUT of it —
       pale ink on the dark, never dark ink on dark, which is what made it
       unreadable. */
    const lines=wrap(g,'nothing pulled yet — make the press ready, then haul the lever',
      Math.max(6.5,7.4*s),vw*0.9);
    for(let i=0;i<lines.length;i++)
      cut(g,vcx,D.y+D.h*0.42+i*Math.max(9,10.5*s),lines[i],
        {size:Math.max(6.5,7.4*s),align:'center',col:inkedHex(TC.wash)});
  }
  const k=pile.length;
  cut(g,vcx,D.y-4*s,k?(k+(k===1?' SHEET':' SHEETS')):'',{size:Math.max(6.5,7.6*s),
    align:'center',col:inkedHex(TC.wash)});
}
/* ── §17 · the tape: the press prints one line about what it just did, out of
   a slot in the frame. Messages are paper, not tooltips. */
function drawTape(g){
  const G=SHV.G,s=G.s,M=SHV.M;
  const W=G.tape.w-14*s, size=Math.max(6.5,7.4*s), lh=size*1.32;
  let y=G.H-11*s;
  SHV.tapeHit=[];
  for(let i=SHV.tape.length-1;i>=0;i--){
    const t=SHV.tape[i], lines=wrap(g,t.txt,size,W-lh);
    const hgt=lines.length*lh+7*s;
    const age=(SHV.t-i);
    const P=rrP(G.tape.x,y-hgt-3*s,W,hgt,1.4*s);
    g.save();
    /* Older slips recede, but a slip you cannot read is litter. The floor is
       set where 7px mono still holds on the dark casting. */
    if(age>0)g.globalAlpha=Math.max(0.66,1-age*0.16);
    face(g,P,TC.paper,0.10);shadow(g,P,0.14,45);
    g.strokeStyle=inkedHex(TC.black);g.lineWidth=Math.max(0.8,1*s);g.stroke(P);
    for(let j=0;j<lines.length;j++)
      cut(g,G.tape.x+5*s,y-hgt+8*s+j*lh+size*0.2,lines[j],
        {size:size,col:inkedHex(t.tone||TC.black)});
    g.restore();
    y-=hgt+4*s;
    if(y<G.H*0.55)break;
  }
}
/* ── §18 · the paperwork: the proofs pinned to the frame and the job ticket,
   plus the drawer you pull out when you actually need to read a number ────── */
function miniRecord(g,x,y,w,h,rec){
  g.save();
  /* clip(P) with the path as an ARGUMENT. `beginPath(); rrP(...); clip()`
     builds a Path2D that is never handed to the context and then clips to the
     empty current path, so everything drawn afterwards is discarded — that is
     what emptied the record trace, the plate proof, the population plot, the
     delivered sheets and the carried sheet, all at once. */
  g.clip(rrP(x,y,w,h,1.5));
  g.fillStyle=inkedHex(TC.paper);g.fillRect(x,y,w,h);
  g.fillStyle=patFor(g,inkedHex(TC.pale),0.16,4.6,15);g.fillRect(x,y,w,h);
  if(rec&&rec.re&&rec.re.length){
    const n=rec.re.length;let rmax=0;
    for(let i=0;i<n;i++){const r=Math.hypot(rec.re[i],rec.im[i]);if(r>rmax)rmax=r;}
    rmax=rmax||1;
    const cx=x+w/2,cy=y+h/2,sc=(Math.min(w,h)/2-4)/rmax;
    g.lineWidth=Math.max(0.8,1.1*SHV.G.s);
    g.beginPath();
    for(let i=0;i<n;i++){
      const X=cx+rec.re[i]*sc,Y=cy-rec.im[i]*sc;
      if(i)g.lineTo(X,Y);else g.moveTo(X,Y);
    }
    g.strokeStyle=inkedHex(TC.grey);g.stroke();
  }
  g.restore();
  g.save();g.strokeStyle=inkedHex(TC.deep);g.lineWidth=Math.max(0.7,0.9*SHV.G.s);
  g.stroke(rrP(x,y,w,h,1.5));g.restore();
}
function fieldProof(){
  const f=(typeof APP!=='undefined')?APP.field:null;
  if(!f)return null;
  if(SHV.fpFor===f&&SHV.fpCv)return SHV.fpCv;
  const c=cv(f.w,f.h),g=c.getContext('2d'),img=g.createImageData(f.w,f.h);
  const P=PAPER;
  for(let i=0;i<f.w*f.h;i++){
    const t=clamp((f.freq[i]+1)*0.5,0,1);
    const r=31+224*t,gg=111-32*t,b=198-168*t;
    const a=clamp(0.08+f.amp[i]*0.92,0,1)*(f.mask[i]?1:0.28),o=i*4;
    img.data[o]=Math.round(P[0]+(r-P[0])*a);
    img.data[o+1]=Math.round(P[1]+(gg-P[1])*a);
    img.data[o+2]=Math.round(P[2]+(b-P[2])*a);
    img.data[o+3]=255;
  }
  g.putImageData(img,0,0);
  SHV.fpFor=f;SHV.fpCv=c;
  return c;
}
function drawPaperwork(g){
  const G=SHV.G,s=G.s,M=SHV.M,LW=M.lw,pc=G.paperCol;
  const rec=(typeof APP!=='undefined')?APP.rec:null;
  const size=Math.max(6.2,6.9*s);
  /* the commission proof: the record itself, as it arrived at the counter */
  miniRecord(g,pc.x+4,pc.y+4,pc.w-8,72*s,rec);
  const capS=Math.max(6.4,7.2*s), capW=pc.w-12;
  cut(g,pc.x+6,pc.y+72*s+Math.max(12,14*s),
    fit(g,'COMMISSION — '+((rec&&rec.name)?rec.name.toUpperCase():'—'),capS,capW),
    {size:capS,col:inkedHex(TC.black)});
  /* the plate proof: what the field will print */
  const fy=pc.y+72*s+Math.max(24,28*s);
  const fp=fieldProof();
  const box=rrP(pc.x+4,fy,pc.w-8,72*s,1.5);
  g.save();face(g,box,TC.paper,0.12);
  g.clip(rrP(pc.x+4,fy,pc.w-8,72*s,1.5));
  if(fp)g.drawImage(fp,pc.x+4,fy,pc.w-8,72*s);
  g.restore();
  g.save();g.strokeStyle=inkedHex(TC.deep);g.lineWidth=Math.max(0.8,1*s);g.stroke(box);g.restore();
  cut(g,pc.x+6,fy+72*s+Math.max(12,14*s),
    fit(g,'PLATE PROOF — '+(((typeof APP!=='undefined')&&APP.field)?APP.field.label:'—'),capS,capW),
    {size:capS,col:inkedHex(TC.black)});
  /* the job ticket: the whole state of the shop as one document you can read */
  const ty=fy+72*s+Math.max(24,28*s);
  const tk=rrP(pc.x+2,ty,pc.w-4,Math.max(150,186*s),2*s);
  face(g,tk,TC.paper,0.14);
  g.save();g.strokeStyle=inkedHex(TC.black);g.lineWidth=LW;g.stroke(tk);g.restore();
  const A=(typeof APP!=='undefined')?APP:null,SH=(typeof SHOP!=='undefined')?SHOP:null;
  const st=SH?SH.state:'makeready';
  const stateW={makeready:'MAKING READY',proof:'PROOF ON THE TABLE',run:'EDITION RUNNING',
                done:'DELIVERED'}[st]||'—';
  const rows=[
    ['JOB','№ '+String(SH?SH.job:1).padStart(3,'0')],
    ['COMMISSION',(A&&A.rec&&A.rec.name)?A.rec.name:'—'],
    ['PLATE',(A&&A.field)?A.field.label:'—'],
    ['LAW',(A&&A.world)?A.world.label:'—'],
    ['IMPRESSION',Mimp()+'×'+Mimp()+' CARDS'],
    ['EDITION',st==='run'||st==='done'
      ?(SH?Math.min(SH.n-1,SH.N):0)+' OF '+(SH?SH.N:8)+' OUT'
      :(SH?SH.N:8)+' SHEETS ORDERED'],
    ['INK KEYS',[0,1,2].map(i=>Math.round((SHV.key[i]||0)*100)).join('/')],
    ['REGISTER',regErr()<0.30?'DEAD ON':regErr().toFixed(2)+' PX OUT'],
    ['STATE',stateW]
  ];
  let ry=ty+Math.max(13,15.5*s);
  cut(g,pc.x+8,ry,'JOB TICKET',{size:Math.max(7,8.2*s),track:2.0,bold:true,col:inkedHex(TC.black)});
  cut(g,pc.x+pc.w-10,ry,rows[0][1],{size:Math.max(8,9.6*s),align:'right',bold:true,col:inkedHex(TC.black)});
  line(g,pc.x+8,ry+3*s,pc.x+pc.w-10,ry+3*s,TC.black,Math.max(0.9,1.1*s),0.9);
  ry+=Math.max(11,13*s);
  for(let i=1;i<rows.length;i++){
    /* label left, value right, and the value gets whatever the label leaves.
       A long commission name is shortened by the compositor rather than
       reversing into the label, which is what produced "COMMGSFC_QC6…". */
    const lx=pc.x+8, rx=pc.x+pc.w-10;
    const lw=cutW(g,rows[i][0],size*0.92,false);
    cut(g,lx,ry,rows[i][0],{size:size*0.92,col:inkedHex(TC.mid)});
    cut(g,rx,ry,fit(g,rows[i][1],size,rx-lx-lw-Math.max(6,7*s),true),
      {size:size,bold:true,align:'right',col:inkedHex(TC.black)});
    line(g,lx,ry+2.4*s,rx,ry+2.4*s,TC.pale,1,0.9);
    ry+=Math.max(11,13*s);
  }
  /* the law's measured note, wrapped into the ticket's foot: this is the one
     place the numbers live, and it is paper */
  const note=(A&&A.world)?((WORLD_NOTE||{})[A.world.id]||A.world.blurb||''):'';
  ry+=Math.max(3,4*s);
  line(g,pc.x+8,ry-2*s,pc.x+pc.w-10,ry-2*s,TC.black,Math.max(0.9,1.1*s),0.9);
  para(g,note.slice(0,300),pc.x+8,ry+size,size*0.94,pc.w-20,size*1.28,{col:inkedHex(TC.deep)});
  /* the drawer: the full paperwork, pulled out when you want it */
  const drY=ty+Math.max(150,186*s)+Math.max(6,8*s);
  const tab=rrP(pc.x+2,drY,pc.w-4,Math.max(20,24*s),2*s);
  face(g,tab,SHV.paper>0.5?TC.pale:TC.wash,0.18);
  g.save();g.strokeStyle=inkedHex(TC.black);g.lineWidth=LW;g.stroke(tab);g.restore();
  cut(g,pc.x+8,drY+Math.max(14,17*s),
    (SHV.paper>0.5?'◀ PUSH THE PAPERWORK BACK':'PULL THE PAPERWORK OUT ▶'),
    {size:Math.max(6.4,7.2*s),col:inkedHex(TC.black)});
  SHV.paperTab={x:pc.x+2,y:drY,w:pc.w-4,h:Math.max(20,24*s)};
  /* the population plot, taped under the ticket: the board's own history */
  const py=drY+Math.max(26,31*s);
  const pb=rrP(pc.x+4,py,pc.w-8,Math.max(40,48*s),1.5);
  face(g,pb,TC.paper,0.12);
  g.save();g.clip(rrP(pc.x+4,py,pc.w-8,Math.max(40,48*s),1.5));
  const hist=(A&&A.hist)?A.hist:null, hn=(A&&A.histN)?A.histN:0;
  if(hist&&hn>2){
    const n=Math.min(hn,hist.length);let mx=1;
    for(let i=0;i<n;i++){const v=hist[(hn-n+i+hist.length*2)%hist.length];if(v>mx)mx=v;}
    g.beginPath();
    for(let i=0;i<n;i++){
      const v=hist[(hn-n+i+hist.length*2)%hist.length];
      const X=pc.x+6+(pc.w-16)*i/(n-1), Y=py+Math.max(40,48*s)-4-(Math.max(40,48*s)-24)*(v/mx);
      i?g.lineTo(X,Y):g.moveTo(X,Y);
    }
    g.strokeStyle=inkedHex(TC.pink);g.lineWidth=Math.max(1,1.4*s);g.stroke();
  }
  g.restore();
  g.save();g.strokeStyle=inkedHex(TC.deep);g.lineWidth=Math.max(0.8,1*s);g.stroke(pb);g.restore();
  cut(g,pc.x+8,py+Math.max(11,13.5*s),'THE BOARD, LIVE',
    {size:Math.max(6.2,7*s),col:inkedHex(TC.black)});
}
/* ── §19 · the counter window: the machine's own instrumentation ─────────── */
function drum(g,x,y,w,h,txt,size){
  const P=rrP(x,y,w,h,1.5);
  face(g,P,TC.black,0.42);
  g.save();g.strokeStyle=inkedHex(TC.dark);g.lineWidth=1;g.stroke(P);g.restore();
  for(let i=0;i<txt.length;i++){
    const cw=w/Math.max(1,txt.length);
    face(g,rrP(x+i*cw+0.6,y+1,cw-1.2,h-2,1),TC.paper,0.16);
    cut(g,x+i*cw+cw*0.5,y+h*0.78,txt[i],{size:size,align:'center',bold:true,col:inkedHex(TC.black)});
  }
}
function drawWindow(g){
  const G=SHV.G,s=G.s,M=SHV.M,LW=M.lw,up=G.upright;
  const x=up.x+up.w*0.06, w=up.w*0.88, y=up.y+G.H*0.010, h=G.H*0.056;
  const box=rrP(x-4,y-4,w+8,h*2+16,3*s);
  face(g,box,TC.black,0.44);
  g.save();g.strokeStyle=inkedHex(TC.dark);g.lineWidth=LW;g.stroke(box);g.restore();
  /* never name these gen/liveN: this block would shadow the app's own counters
     and the typeof guard would then read the const in its own dead zone */
  const g0=(typeof gen!=='undefined')?gen:0, l0=(typeof liveN!=='undefined')?liveN:0;
  cut(g,x,y+h*0.42,'GEN',{size:Math.max(6.5,7.6*s),track:1.2,col:inkedHex(TC.paper)});
  drum(g,x,y+h*0.5,w,h*0.62,String(g0).padStart(4,'0').slice(-4),h*0.42);
  cut(g,x,y+h*1.42,'CARDS',{size:Math.max(6.5,7.6*s),track:1.2,col:inkedHex(TC.paper)});
  drum(g,x,y+h*1.5,w,h*0.62,String(l0).padStart(5,'0').slice(-5),h*0.42);
  const ex=((typeof APP!=='undefined')&&APP.world&&APP.S)
    ? safeHud() : '';
  if(ex)cut(g,x,y+h*2+11*s,fit(g,'› '+ex,Math.max(6,6.8*s),w),
    {size:Math.max(6,6.8*s),col:inkedHex(TC.paper)});
}
function safeHud(){
  try{ return APP.world.HUD(APP.S,APP.field,APP.pw)||''; }catch(e){ return ''; }
}
/* ── §20 · the loupe: a sheet held up to the light ──────────────────────────
   Clicking a delivered sheet picks it up off the pile; clicking it again puts
   it back. There is no modal and no overlay — it is the same sheet, nearer. */
function drawLoupe(g){
  const G=SHV.G,s=G.s,M=SHV.M,LW=M.lw;
  const p=SHV.loupe;if(!p)return;
  if(!p._big&&p.url420){p._big=new Image();p._big.src=p.url420;}
  const side=Math.min(G.W*0.56,G.H*0.74);
  const cx=G.W*0.50, cy=G.H*0.46;
  g.save();
  g.translate(cx,cy);g.rotate(-0.012);
  const P=rrP(-side/2,-side/2,side,side,2*s);
  face(g,P,TC.paper,0.14);shadow(g,P,0.34,45);
  g.save();g.clip(rrP(-side/2,-side/2,side,side,2*s));
  if(p._big&&p._big.complete&&p._big.naturalWidth)g.drawImage(p._big,-side/2,-side/2,side,side);
  g.restore();
  g.strokeStyle=inkedHex(TC.black);g.lineWidth=LW*1.4;g.stroke(P);
  g.restore();
  const line=(p.kind==='proof'?'PROOF':'SHEET '+p.n+' OF '+p.N)+' · JOB № '+
    String(p.job).padStart(3,'0')+' · '+p.plate+' · '+p.law;
  cut(g,cx,cy+side/2+Math.max(14,17*s),line,{size:Math.max(7.4,9*s),align:'center',
    bold:true,col:inkedHex(TC.black)});
  cut(g,cx,cy+side/2+Math.max(24,29*s),
    'PULL '+p.seed+' · GEN '+p.gen+' · REG '+p.reg.toFixed(2)+' PX  ·  CLICK TO PUT IT BACK',
    {size:Math.max(6.4,7.4*s),align:'center',col:inkedHex(TC.mid)});
  g.save();g.strokeStyle=inkedHex(TC.mid);g.lineWidth=LW;
  g.strokeRect(cx-side/2-6,cy-side/2-6,side+12,side+12);g.restore();
}
/* ── §21 · the drawer's contents, laid over the machine when it is out ───── */
function drawDrawer(g){
  const G=SHV.G,s=G.s,M=SHV.M,LW=M.lw;
  const t=SHV.paper;if(t<=0.001)return;
  const w=Math.min(G.W*0.46,540*s), h=Math.min(G.H*0.60,420*s);
  const x=G.paperCol.x+120*s, y=G.H*0.16+(1-t)*40*s;
  const A=(typeof APP!=='undefined')?APP:null;
  g.save();
  g.globalAlpha=Math.min(1,t*1.4);
  g.translate(x+w*0.5,y+h*0.5);g.rotate(-0.008);
  const P=rrP(-w/2,-h/2,w,h,2*s);
  face(g,P,TC.paper,0.14);shadow(g,P,0.34,45);
  g.strokeStyle=inkedHex(TC.black);g.lineWidth=LW*1.4;g.stroke(P);
  const sz=Math.max(6.4,7.2*s), pad=10*s;
  cut(g,-w/2+pad,-h/2+pad+sz,'THE PAPERWORK · JOB № '+
    String((typeof SHOP!=='undefined')?SHOP.job:1).padStart(3,'0'),
    {size:sz*1.25,track:1.6,bold:true,col:inkedHex(TC.black)});
  let yy=-h/2+pad+sz*2.6;
  const block=(title,txt,tone)=>{
    if(!txt)return;
    cut(g,-w/2+pad,yy,title,{size:sz*0.92,track:1.2,col:inkedHex(tone||TC.mid)});
    yy+=sz*1.35;
    yy+=para(g,txt,-w/2+pad,yy+sz,sz,w-pad*2,sz*1.26,{col:inkedHex(TC.black)});
    yy+=sz*1.0;
    if(yy>h/2-pad*3)return false;
    return true;
  };
  const rec=(A&&A.rec)?A.rec:null;
  block('THE COMMISSION',
    rec?((rec.name||'record')+' — '+rec.re.length+' complex samples'+
      (rec.turns!=null?', '+rec.turns.toFixed(2)+' turns of phase':'')+
      (rec.amax!=null?', |h| up to '+rec.amax.toFixed(3):'')):'—');
  block('HOW IT BECAME A RECORD',(A&&A.wmeta)?waveTxt(A.wmeta):'');
  block('THE PLATE ON THE CYLINDER',
    (A&&A.field?(((A.field.label)+' — '+(A.field.note||'')+' '+(A.field.blurb||''))):''));
  if(A&&A.world)block('THE LAW WORKING THE INK',
    A.world.label+' — '+(A.world.blurb||'')+' '+((WORLD_NOTE||{})[A.world.id]||''));
  g.restore();
}
function waveTxt(m){
  try{ return (typeof waveText==='function')?waveText(m):''; }catch(e){ return ''; }
}
/* ── §22 · the spare plates on the back wall ────────────────────────────────
   Four plates hang on hooks behind the machine, half out of frame. The one on
   the cylinder is missing from its hook, which is how you know what is
   mounted. You reach up, take a plate down and clamp it on the cylinder. */
function wallPlates(){
  const G=SHV.G,s=G.s,W=G.wall;
  const list=(typeof API!=='undefined')?API.fields():[];
  const cur=(typeof APP!=='undefined')?APP.fldId:'';
  const n=list.length||4, gap=W.w/(n+0.35), pw=Math.min(gap*0.72,120*s), ph=pw*1.24;
  const out=[];
  for(let i=0;i<n;i++){
    const x=W.x+gap*(i+0.35)-pw/2, y=H0y()+i*0;
    out.push({i:i,x:x,y:y,w:pw,h:ph,id:list[i]?list[i].id:'',label:list[i]?list[i].label:'PLATE '+i,
      on:(list[i]&&list[i].id===cur)});
  }
  return out;
}
/* where the plates hang: one hook height for the whole wall */
function H0y(){return SHV.G.wall.y+SHV.G.wall.h*0.16;}
function drawWallPlates(g){
  const G=SHV.G,s=G.s,LW=SHV.M.lw;
  const ps=wallPlates();
  SHV.plateHit=[];
  for(const p of ps){
    if(p.on)continue;                       /* it is on the cylinder */
    const P=rrP(p.x,p.y,p.w,p.h,2*s);
    /* trapped in paper and contoured, so four plates hanging side by side on
       the same wall read as four objects and not one grey field */
    part(g,P,TC.light,0.26,{gap:Math.max(2,2.6*s),lw:LW*1.35});
    hatch(g,P,p.x,p.y,p.w,p.h,90,Math.max(3,4*s),Math.max(0.6,0.8*s),TC.deep,0.30);
    /* the hook and its wire, cast into the wall */
    line(g,p.x+p.w*0.5,p.y,p.x+p.w*0.5,p.y-12*s,TC.black,Math.max(1,1.3*s),0.85);
    face(g,circP(p.x+p.w*0.5,p.y-14*s,Math.max(2,2.6*s)),TC.black,0.5);
    /* the label is set UP from the foot of the plate, so a name that wraps to
       two lines grows into the plate instead of off the bottom of it */
    const lsz=Math.max(6,7*s), lh=Math.max(7.4,8.6*s);
    const lines=wrap(g,p.label,lsz,p.w-6*s,true);
    const lTop=p.y+p.h-Math.max(6,7*s)-(lines.length-1)*lh;
    for(let j=0;j<lines.length;j++)
      cut(g,p.x+3*s,lTop+j*lh,lines[j],{size:lsz,bold:true,col:inkedHex(TC.black)});
    p._hit={x:p.x,y:p.y,w:p.w,h:p.h};
    SHV.plateHit.push(p);
    if(SHV.plateHi===p.i){
      g.save();g.strokeStyle=inkedHex(TC.paper);g.lineWidth=LW*1.5;
      g.stroke(rrP(p.x-3,p.y-3,p.w+6,p.h+6,3*s));g.restore();
    }
  }
  /* The wall is named ONCE, below the hanging plates. A caption cast at a
     fixed fraction of the wall's height printed straight through them. */
  const foot=ps.length?ps[0].y+ps[0].h+Math.max(12,15*s):G.wall.h*0.62;
  const isz=Math.max(6.8,7.8*s);
  cut(g,G.wall.x+8*s,foot,
    fit(g,'SPARE PLATES  ·  BACK WALL  —  REACH UP AND SWAP ONE',isz,G.wall.w-16*s),
    {size:isz,track:1.1,bold:true,col:inkedHex(TC.black)});
}
/* ── §23 · what is in the hand ──────────────────────────────────────────────
   A carried plate, or a sheet of stock: drawn last, larger, and it lands where
   you let go of it. */
function drawCarried(g){
  const G=SHV.G,s=G.s,d=SHV.grab;
  if(!d||!d.carry)return;
  const P=rrP(d.x-d.w/2,d.y-d.h/2,d.w,d.h,2*s);
  face(g,P,TC.pale,0.20);shadow(g,P,0.36,45);
  g.save();g.strokeStyle=inkedHex(TC.black);g.lineWidth=SHV.M.lw*1.6;g.stroke(P);g.restore();
  hatch(g,P,d.x-d.w/2,d.y-d.h/2,d.w,d.h,90,Math.max(3.4,4.6*s),Math.max(0.6,0.9*s),TC.deep,0.30);
  const lines=wrap(g,d.label,Math.max(7,8.6*s),d.w-8*s,true);
  for(let j=0;j<lines.length;j++)
    cut(g,d.x-d.w/2+4*s,d.y-d.h/2+Math.max(14,17*s)+j*Math.max(9,10.5*s),lines[j],
      {size:Math.max(7,8.6*s),bold:true,col:inkedHex(TC.black)});
  cut(g,d.x,d.y+d.h/2+Math.max(10,12*s),d.grip||'',{size:Math.max(6.4,7.2*s),
    align:'center',col:inkedHex(TC.deep)});
}
/* ── §24 · hit testing, and the hand ────────────────────────────────────────
   Every part is tested here against the same geometry that drew it. Nothing
   is a rectangle in a stylesheet; a cam is a disc, the lever is a bar you can
   grab anywhere along it, the flywheel is a rim. */
function dist2seg(px,py,x1,y1,x2,y2){
  const dx=x2-x1,dy=y2-y1,L=dx*dx+dy*dy;
  let t=L?((px-x1)*dx+(py-y1)*dy)/L:0;t=clamp(t,0,1);
  return Math.hypot(px-(x1+dx*t),py-(y1+dy*t));
}
function shopPick(x,y){
  const G=SHV.G,M=SHV.M,s=G.s,T=SHV;
  /* the loupe owns the screen while it is up */
  if(T.loupe)return {kind:'loupe'};
  /* the drawer, when it is out, is a piece of paper lying on the machine */
  if(T.paper>0.35){
    const w=Math.min(G.W*0.46,540*s),h=Math.min(G.H*0.60,420*s);
    const dx=G.paperCol.x+120*s,dy=G.H*0.16+(1-T.paper)*40*s;
    if(x>dx-10&&x<dx+w+10&&y>dy-10&&y<dy+h+10)return {kind:'drawer'};
  }
  /* Pins paint above the lever. Hit the stud, or touch its visible pocket to
     put the stud there; the central cross is an exact zero, not decoration. */
  for(const p of T.pins){
    if(Math.hypot(x-p.x,y-p.y)<Math.max(20,p.r*1.4))return {kind:'pin',p:p};
    if(Math.hypot(x-p.hx,y-p.hy)<p.rad*1.12)return {kind:'pin',p:p,atPoint:true};
  }
  const d=T.grab;
  /* the lever: grab it anywhere on the bar or the handle */
  const L=M.lever,t=T.lev||0;
  const kx=lerp(L.kx,L.ex,t), ky=lerp(L.ky,L.ey,t), r=L.r*(1+0.30*t);
  if(Math.hypot(x-kx,y-ky)<r*1.7||dist2seg(x,y,L.px,L.py,kx,ky)<Math.max(10,13*s))
    return {kind:'lev'};
  /* the ink duct keys */
  for(let i=0;i<3;i++){
    const k=G.keys[i],sx=k.x+6*s,w=k.w-12*s,sy=M.duct.y+M.duct.h-3*s;
    const kx2=sx+w-Math.max(14,17*s);
    const open=(T.key||[0,0,0])[i];
    const kp=open*Math.max(20,26*s);
    if(x>kx2-Math.max(12,15*s)&&x<kx2+Math.max(12,15*s)&&
       y>sy-8*s&&y<sy+Math.max(30,40*s)+kp)return {kind:'key',i:i,y:y};
  }
  /* the cams */
  const cams=camState();
  for(let i=0;i<G.cams.length;i++){
    const c=G.cams[i],dx=cams[i].x===undefined?1:cams[i].x;
    const cx=c.x+dx*0.30*c.r;
    if(Math.hypot(x-cx,y-c.y)<c.r*1.05)return {kind:'cam',i:i};
  }
  /* the law's tappet wheels */
  for(const h of (T.wheelHit||[]))
    if(Math.hypot(x-h.cx,y-h.cy)<h.r*1.5)return {kind:'wheel',i:h.i};
  /* the plate's screws on the cylinder clamp */
  for(const h of (T.headHit||[]))
    if(Math.hypot(x-h.cx,y-h.cy)<h.r*1.6)return {kind:'head',i:h.i};
  /* the impression, the spray, the flywheel, the clutch, the counter */
  if(Math.hypot(x-M.imp.x,y-M.imp.y)<M.imp.r*1.25)return {kind:'imp'};
  if(Math.hypot(x-M.spr.x,y-M.spr.y)<M.spr.r*1.6)return {kind:'spr'};
  { const d0=Math.hypot(x-M.fly.x,y-M.fly.y);
    if(Math.abs(d0-M.fly.r*0.80)<M.fly.r*0.34)return {kind:'fly'}; }
  if(Math.abs(x-M.clutch.x)<Math.max(24,30*s)&&Math.abs(y-M.clutch.y)<Math.max(26,33*s))
    return {kind:'clutch'};
  if(Math.hypot(x-M.count.x,y-M.count.y)<M.count.r*1.2)return {kind:'count'};
  /* the throttle: the knob and the gate */
  { const v=(typeof speed!=='undefined')?speed:10;
    const tx=M.thr.x+v/60*M.thr.travel, H=Math.max(24,31*s);
    if(Math.hypot(x-tx,y-(M.thr.y-H))<Math.max(16,20*s))return {kind:'thr'};
    if(x>M.thr.x-14*s&&x<M.thr.x+M.thr.travel+18*s&&
       y>M.thr.y-H-8*s&&y<M.thr.y+24*s)return {kind:'thr'}; }
  /* the harmonics wheel, when an image is on the feed */
  if(T.plugHit&&Math.hypot(x-T.plugHit.cx,y-T.plugHit.cy)<T.plugHit.r*1.5)
    return {kind:'plug'};
  /* the paperwork drawer tab */
  if(T.paperTab&&x>T.paperTab.x&&x<T.paperTab.x+T.paperTab.w&&
     y>T.paperTab.y&&y<T.paperTab.y+T.paperTab.h)return {kind:'paper'};
  /* the stock on the feed board, newest first so a carried sheet wins */
  for(let i=T.stock.length-1;i>=0;i--){
    const d0=T.stock[i];
    if(Math.abs(x-d0.x)<d0.w*0.6&&Math.abs(y-d0.y)<d0.h*0.6)return {kind:'stock',obj:d0};
  }
  for(const h of (T.feedHit||[]))
    if(x>h.x&&x<h.x+h.w&&y>h.y&&y<h.y+h.h)return {kind:'feed',i:h.i,it:h.it};
  if(T.buyHit&&x>T.buyHit.x&&x<T.buyHit.x+T.buyHit.w&&
     y>T.buyHit.y&&y<T.buyHit.y+T.buyHit.h)return {kind:'buy'};
  /* the plates on the wall */
  for(const p of (T.plateHit||[]))
    if(x>p.x&&x<p.x+p.w&&y>p.y&&y<p.y+p.h)return {kind:'plate',p:p};
  /* the delivery pile, top sheet first */
  for(let i=(T.pileHit||[]).length-1;i>=0;i--){
    const h=T.pileHit[i];
    const dx=x-h.x-h.w/2, dy=y-h.y-h.h/2;
    const c=Math.cos(-h.rot), sn=Math.sin(-h.rot);
    if(Math.abs(dx*c-dy*sn)<h.w/2&&Math.abs(dx*sn+dy*c)<h.h/2)
      return {kind:'sheet',h:h};
  }
  /* the grippers, and the frame you grab to shake the machine */
  if(y>M.grip.y-4&&y<M.grip.y+M.grip.h+8&&x>M.grip.x&&x<M.grip.x+M.grip.w)
    return {kind:'grip'};
  if(x<G.upright.x+G.upright.w+8&&y<G.H-G.botH*0.4&&y>G.upright.y)
    return {kind:'frame'};
  return {kind:'none'};
}
/* ── §25 · the hand on the machine ──────────────────────────────────────────
   Pointer down finds the part; the gesture is the part's own (a pin slides in
   its pocket, a key pulls, a cam slides on the shaft, a lever hauls, the
   flywheel turns); pointer up lets it settle under its own springs. */
function shopDown(x,y){
  const T=SHV,G=SHV.G,M=SHV.M,s=G.s;
  if(T.loupe){T.loupeOpen=null;T.loupe=null;return;}
  const hit=shopPick(x,y);
  T.hit=hit;
  const st={kind:hit.kind,x0:x,y0:y,x:x,y:y,t0:performance.now(),moved:0};
  T.drag=st;
  if(hit.kind==='pin'){
    st.p=hit.p;st.ox=hit.atPoint?0:hit.p.x-x;st.oy=hit.atPoint?0:hit.p.y-y;
    killSp(hit.p);p0WasHome(hit.p);
    if(hit.atPoint)shopMove(x,y);
  }
  else if(hit.kind==='key'){st.i=hit.i;st.v0=T.key[hit.i];
    st.sy=M.duct.y+M.duct.h-3*s0();st.travel=Math.max(20,26*s0());}
  else if(hit.kind==='cam'){st.i=hit.i;st.x0v=(camState()[hit.i].x===undefined?1:camState()[hit.i].x);}
  else if(hit.kind==='wheel'){st.i=hit.i;st.v0=wheelVal(hit.i);
    st.span=Math.max(46,G.wheelCol.h*0.30);}
  else if(hit.kind==='head'){st.i=hit.i;st.v0=headVal(hit.i);st.span=Math.max(40,60*G.s);}
  else if(hit.kind==='lev'){st.v0=T.lev||0;killSp(T);}
  else if(hit.kind==='sheet'){st.h=hit.h;}
  else if(hit.kind==='stock'){const o=hit.obj;killSp(o);
    T.grab={carry:true,kind:'stock',obj:o,x:x,y:y,w:o.w,h:o.h,label:o.label,
      grip:'PUSH IT INTO THE GRIPPERS'};T.drag=null;T.grabIt=null;}
  else if(hit.kind==='thr'){st.v0=(typeof speed!=='undefined')?speed:10;}
  else if(hit.kind==='count'){st.v0=(typeof SHOP!=='undefined')?SHOP.N:8;}
  else if(hit.kind==='imp'){st.v0=Mimp();T.impA0=T.impA;st.span=Math.max(60,SHV.G.H*0.26);}
  else if(hit.kind==='spr'){st.v0=R.sparkBudget;}
  else if(hit.kind==='plug'){st.v0=(typeof API!=='undefined'&&API.harmonics)?API.harmonics():48;}
  else if(hit.kind==='fly'){st.a0=Math.atan2(y-M.fly.y,x-M.fly.x);st.acc=0;st.turn=0;}
  else if(hit.kind==='paper'){st.v0=T.paper;}
  else if(hit.kind==='feed'){st.it=hit.it;
    T.grab={carry:true,kind:'feed',x:x,y:y,w:Math.max(70,96*s),h:Math.max(50,64*s),
      label:hit.it.label,grip:'PUSH IT INTO THE GRIPPERS'};T.drag=null;
    T.grabIt=hit.it;T.grabIt._hit=hit.it;}
  else if(hit.kind==='plate'){st.p=hit.p;
    T.grab={carry:true,kind:'plate',x:x,y:y,w:hit.p.w*1.15,h:hit.p.h*1.15,
      label:hit.p.label,grip:'CLAMP IT ON THE CYLINDER'};T.drag=null;T.grabIt=hit.p;}
  else if(hit.kind==='frame'||hit.kind==='none'||hit.kind==='grip'){
    T.drag=null;
    T.shake={x:x,y:y,dir:0,rev:0,travel:0};
  }
}
function s0(){return SHV.G.s;}
function p0WasHome(p){p.wasHome=pinResidual(p)<0.02?1:0;}
function wheelVal(i){
  const ps=(typeof API!=='undefined'&&API.worldParams)?API.worldParams():[];
  const p=ps[i];return p?p.value:0;
}
function headVal(i){
  const ps=(typeof API!=='undefined'&&API.fieldParams)?API.fieldParams():[];
  const p=ps[i];return p?p.value:0;
}
function shopMove(x,y){
  const T=SHV,G=T.G,d=T.drag;
  T.mx=x;T.my=y;
  if(T.grab){T.grab.x=x;T.grab.y=y;T.hover=null;return;}
  if(!d){
    if(T.shake){
      const dx=x-T.shake.x,dy=y-T.shake.y,dd=Math.hypot(dx,dy);
      if(dd<7)return;
      const dir=Math.abs(dx)>Math.abs(dy)?Math.sign(dx):Math.sign(dy);
      if(T.shake.dir&&dir&&dir!==T.shake.dir)T.shake.rev++;
      T.shake.dir=dir;T.shake.travel+=dd;T.shake.x=x;T.shake.y=y;
      if(T.shake.rev>=3&&T.shake.travel>110){
        const pw=clamp(T.shake.travel/1400,0.25,1);
        T.shake=null;knock(0.8);
        if(typeof API!=='undefined'&&API.shake)API.shake(pw);
      }
    }
    return;
  }
  d.x=x;d.y=y;d.moved=Math.max(d.moved,Math.hypot(x-d.x0,y-d.y0));
  const dx=x-d.x0, dy=y-d.y0;
  switch(d.kind){
    case 'pin':{
      const p=d.p, hx=p.hx, hy=p.hy;
      let nx=x+d.ox-hx, ny=y+d.oy-hy;
      const dd=Math.hypot(nx,ny), lim=p.rad*1.12;
      if(dd>lim){nx=nx/dd*lim;ny=ny/dd*lim;}
      if(Math.hypot(nx,ny)<p.rad*0.11){nx=0;ny=0;}
      p.x=hx+nx;p.y=hy+ny;
      if(nx===0&&ny===0&&!p.wasHome){
        p.wasHome=1;p.flash=1;knock(0.25);
        say(p.name+' PLATE IN REGISTER',TC.teal);
        if(SHV.pins.every(q=>pinResidual(q)<0.02))
          say('ALL THREE PLATES HOME · THE SHEET IS DEAD ON',TC.teal);
      }else if(nx!==0||ny!==0)p.wasHome=0;
      break;
    }
    case 'key':{
      API.setInkKey(d.i,d.v0-dy/d.travel);
      break;
    }
    case 'cam':{
      const c=camState()[d.i];
      c.x=clamp(d.x0v-dx/(SHV.G.cams[d.i].r*0.55),0,1);
      break;
    }
    case 'wheel':{
      const ps=(typeof API!=='undefined'&&API.worldParams)?API.worldParams():[];
      const p=ps[d.i];if(!p)break;
      if(p.options){
        const want=dx<-8?p.options[1].value:dx>8?p.options[0].value:null;
        if(want!=null&&want!==p.value)API.setWorldParam(p.key,want);
        break;
      }
      let v=d.v0-dy/d.span*(p.max-p.min);
      if(p.step){v=Math.round(v/p.step)*p.step;}
      v=clamp(v,p.min,p.max);
      API.setWorldParam(p.key,v);
      break;
    }
    case 'head':{
      const ps=(typeof API!=='undefined'&&API.fieldParams)?API.fieldParams():[];
      const p=ps[d.i];if(!p)break;
      if(p.options){
        const on=p.value===p.options[1].value;
        const want=(dx<-8)?p.options[1].value:(dx>8?p.options[0].value:null);
        if(want!=null&&want!==p.value)API.setFieldParam(p.key,want);
        break;
      }
      let v=d.v0-dy/d.span*(p.max-p.min);
      if(p.step){v=Math.round(v/p.step)*p.step;}
      API.setFieldParam(p.key,clamp(v,p.min,p.max));
      break;
    }
    case 'lev':{
      const L=SHV.M.lever, span=Math.max(40,L.ey-L.ky);
      SHV.lev=clamp(d.v0+dy/span,0,1);
      break;
    }
    case 'thr':{
      const MM=SHV.M, t=clamp((x-MM.thr.x)/MM.thr.travel,0,1);
      let v=t*60, near=null;
      for(const dt of [0,10,25,45,60])if(Math.abs(dt-v)<2.6)near=dt;
      API.setSpeed(near!=null?near:v);
      break;
    }
    case 'count':{
      const N=clamp(d.v0-Math.round(dy/Math.max(9,11*SHV.G.s)),1,24);
      API.setN(N);
      break;
    }
    case 'imp':{
      const v=clamp(d.v0-Math.round(dy/ (SHV.G.H*0.26) *96/4)*4,24,120);
      SHV.impA+=dy*0.02;
      API.setM(v,false);
      break;
    }
    case 'spr':{
      const v=clamp(d.v0-Math.round(dy/(SHV.G.H*0.10)*40),0,40);
      API.setSpark(v);
      break;
    }
    case 'plug':{
      const v=clamp(Math.round(d.v0-Math.round(dy/(SHV.G.H*0.34)*1023)),1,1023);
      API.setHarmonics(v);
      break;
    }
    case 'fly':{
      const a=Math.atan2(y-SHV.M.fly.y,x-SHV.M.fly.x);
      let da=a-d.a0;
      while(da>Math.PI)da-=6.2832;
      while(da<-Math.PI)da+=6.2832;
      d.a0=a;d.acc+=da;SHV.fly+=da;
      const step=0.55;
      while(Math.abs(d.acc)>=step){
        d.acc-=Math.sign(d.acc)*step;
        API.inch();
      }
      break;
    }
    case 'paper':{
      SHV.paper=clamp(d.v0+(y-d.y0)/(SHV.G.H*0.30),0,1);
      break;
    }
    case 'sheet':{
      /* only the top sheet can be dragged, and dragging it off the board bins it */
      break;
    }
  }
}
function shopUp(x,y){
  const T=SHV,d=T.drag;
  if(T.grab){
    const it=T.grabIt, obj=T.grab.obj;
    const inGrip=x>SHV.M.grip.x-40&&x<SHV.M.grip.x+SHV.M.grip.w+40&&
      y>SHV.M.grip.y-SHV.G.sheet.h*0.25&&y<SHV.M.grip.y+SHV.M.grip.h+SHV.G.sheet.h*0.20;
    if(T.grab.kind==='feed'){
      if(inGrip){
        if(it.id==='file'&&it.file)API.loadStock(it.file);
        else API.setSource(it.id);
        knock(0.35);say('STOCK INTO THE GRIPPERS · '+it.label,TC.teal);
      }
    }else if(T.grab.kind==='stock'){
      if(inGrip){
        if(obj.file)API.loadStock(obj.file);
        knock(0.35);
        const k=SHV.stock.indexOf(obj);if(k>=0)SHV.stock.splice(k,1);
      }else{
        sp(obj,'x',obj.slotX,70,22);sp(obj,'y',obj.slotY,70,22);
      }
    }else if(T.grab.kind==='plate'){
      const G=SHV.G,M=SHV.M,p=it;
      const onCyl=y<G.H*0.235&&x>G.W*0.52;
      if(onCyl){
        knock(0.55);
        API.setField(p.id);
        say('PLATE CLAMPED · '+p.label,TC.teal);
      }
      killSp(p);
    }
    T.grab=null;T.grabIt=null;T.drag=null;return;
  }
  if(!d)return;
  T.drag=null;
  const dxx=x-d.x0,dyy=y-d.y0;
  const quick=Math.hypot(dxx,dyy)<9&&(performance.now()-d.t0)<600;
  switch(d.kind){
    case 'pin':{
      const p=d.p,res=pinResidual(p);
      if(res<0.30){sp(p,'x',p.hx,300,26);sp(p,'y',p.hy,300,26);}
      break;
    }
    case 'key':case 'thr':case 'count':case 'plug':case 'spr':case 'imp':case 'wheel':break;
    case 'cam':{
      const c=camState()[d.i];
      sp(c,'x',c.x>0.5?0:1,220,26);
      if(c.x>0.5){
        const list=API.worlds(), w=list[d.i];
        if(w&&w.id!==APP.wrldId){
          say('CAM ON THE SHAFT · '+w.label,TC.black);
          API.setWorld(w.id);
        }
      }
      break;
    }
    case 'lev':{
      const t=T.lev||0;
      if(t>0.62){
        T.lev=1;
        knock(1.5);
        API.pull();
        SHV.fireAt=performance.now()+140;
      }else{
        sp(T,'lev',0,150,15);
      }
      break;
    }
    case 'clutch':{
      if(Math.abs(dyy)>10)API.hold(dyy<0);
      break;
    }
    case 'paper':{
      sp(SHV,'paper',SHV.paper>0.5?1:0,120,20);
      break;
    }
    case 'feed':{
      /* a sample pulled out of its slot and not fed goes back in the rack */
      break;
    }
    case 'plate':{
      if(!d.moved)API.setField(d.p.id);
      break;
    }
    case 'sheet':{
      const h=d.h;
      const inside=x>SHV.G.delivery.x-60&&x<SHV.G.delivery.x+SHV.G.delivery.w+90&&
                   y>SHV.G.delivery.y-70&&y<SHV.G.H+20;
      if(quick)T.loupe=h.p;
      else if(!inside){API.discard(h.i);say('SHEET BINNED',TC.pink);}
      break;
    }
    case 'buy':{
      if(quick)openPicker();
      break;
    }
    case 'loupe':{
      T.loupe=null;
      break;
    }
    case 'drawer':{
      if(quick)sp(SHV,'paper',0,120,20);
      break;
    }
  }
  if(T.hoverLock)SHV.hoverLock={kind:d.kind,i:d.i,p:d.p};
}
function openPicker(){
  const el=document.getElementById('f_any');
  if(el){el.value='';el.click();}
}
/* ── §26 · the tick: springs settle, the press turns, the tape ages ───────── */
function shopTick(dt){
  const T=SHV;
  if(!T.G)return;
  T.t+=dt;
  tickSprings(Math.min(dt,1/40));
  tickKnock(Math.min(dt,1/40));
  for(const p of T.pins){p.flash*=Math.exp(-4.5*dt);}
  for(const c of camState())if(c.x===undefined)c.x=1;
  if(T.fireAt&&performance.now()>T.fireAt){
    T.fireAt=0;
    sp(T,'lev',0,150,13);
  }
  if(typeof playing!=='undefined'&&playing&&typeof speed!=='undefined'){
    T.fly+=dt*speed*0.42;
    T.impA+=dt*speed*0.06;
    T.oil+=dt;
    if(R.sparkBudget>0){
      T.sprayPuff=Math.max(0,T.sprayPuff-dt*1.6);
      if(T.sprayPuff<=0&&T.oil>0.55){T.sprayPuff=1;T.oil=0;}
    }
  }
  if(T.mat&&Math.hypot(T.mx-(T.mat.x||0),T.my-(T.mat.y||0))>8)T.mat=null;
  /* the stock you carried in from the OS settles onto the feed board */
  for(const d of T.stock){
    if(d._carried)continue;
    if(d._vx||d._vy){
      d.x+=d._vx*dt;d.y+=d._vy*dt;d._vx*=Math.exp(-2.2*dt);d._vy*=Math.exp(-2.2*dt);
      if(Math.abs(d._vx)<0.4&&Math.abs(d._vy)<0.4){d._vx=0;d._vy=0;}
    }
  }
  const now=T.t;
  while(T.tape.length>5)T.tape.shift();
  if(T.tape.length>1)while(T.tape.length>1&&now-T.tape[0].t>13)T.tape.shift();
  T.pileT=Math.max(0,(T.pileT||0)-dt*2.2);
}
function say(txt,tone){
  SHV.tape.push({txt:String(txt),t:SHV.t||0,tone:tone});
  while(SHV.tape.length>5)SHV.tape.shift();
}
/* ── §27 · paint ────────────────────────────────────────────────────────────
   The sheet is printed by the app's press; everything around it is printed here
   with the same three inks and the same screens. The whole machine takes the
   knock when the lever bottoms out, which is why the sheet moves with it. */
function drawHover(g){
  const T=SHV,hit=T.hover;
  if(!hit||T.drag||T.grab)return;
  const s=SHV.G.s;
  g.save();g.globalAlpha=0.55;g.strokeStyle=inkedHex(TC.paper);
  g.lineWidth=Math.max(1.4,1.8*s);
  const ring=(x,y,r)=>{g.beginPath();g.arc(x,y,r,0,6.2832);g.stroke();};
  if(hit.kind==='pin')ring(hit.p.x,hit.p.y,Math.max(12,15*s));
  else if(hit.kind==='cam'){const c=SHV.G.cams[hit.i];
    const cc=camState()[hit.i],dx=cc.x===undefined?1:cc.x;
    ring(c.x+dx*0.30*c.r,c.y,c.r*1.08);}
  else if(hit.kind==='wheel'||hit.kind==='head'){
    const arr=(hit.kind==='wheel')?T.wheelHit:T.headHit;
    for(const h of (arr||[]))if(h.i===hit.i)ring(h.cx,h.cy,h.r*1.35);
  }else if(hit.kind==='lev'){
    const M=SHV.M,L=M.lever,t=T.lev||0;
    ring(lerp(L.kx,L.ex,t),lerp(L.ky,L.ey,t),L.r*1.7);
  }else if(hit.kind==='fly')ring(SHV.M.fly.x,SHV.M.fly.y,SHV.M.fly.r*1.04);
  else if(hit.kind==='imp')ring(SHV.M.imp.x,SHV.M.imp.y,SHV.M.imp.r*1.15);
  else if(hit.kind==='spr')ring(SHV.M.spr.x,SHV.M.spr.y,SHV.M.spr.r*1.7);
  else if(hit.kind==='count')ring(SHV.M.count.x,SHV.M.count.y,SHV.M.count.r*1.15);
  else if(hit.kind==='thr'){const M=SHV.M;
    g.strokeRect(M.thr.x-8,M.thr.y-Math.max(30,38*s),M.thr.travel+18,Math.max(50,62*s));}
  else if(hit.kind==='plug'&&T.plugHit)ring(T.plugHit.cx,T.plugHit.cy,T.plugHit.r*1.4);
  else if(hit.kind==='paper'&&T.paperTab)g.strokeRect(T.paperTab.x-2,T.paperTab.y-2,
    T.paperTab.w+4,T.paperTab.h+4);
  g.restore();
}
function shopPaint(V,field,opts){
  const G=shopEnsure();
  const ctx=stageCtx();
  const w=wob();
  SHV.paintX=w[0];SHV.paintY=w[1];
  R.bx=G.bx+w[0];R.by=G.by+w[1];R.side=G.side;
  if(R.inkKey)for(let i=0;i<3;i++)R.inkKey[i]=0.30+1.10*(SHV.key[i]==null?0.64:SHV.key[i]);
  drawStage(V,field,opts);
  R.bx=G.bx;R.by=G.by;
  ctx.save();
  ctx.translate(w[0],w[1]);
  ctx.drawImage(SHV.back,0,0,G.W,G.H);
  ctx.drawImage(SHV.fore,0,0,G.W,G.H);
  drawPaperwork(ctx);
  drawDelivery(ctx);
  drawHead(ctx);
  drawKeys(ctx);
  drawCams(ctx);
  drawWheels(ctx);
  drawDrive(ctx);
  drawThrottle(ctx);
  drawWallPlates(ctx);
  drawLever(ctx);
  drawWindow(ctx);
  drawFeed(ctx);
  drawHarmonics(ctx);
  drawDrawer(ctx);
  drawPins(ctx);
  drawLens(ctx);
  drawTape(ctx);
  drawCarried(ctx);
  drawHover(ctx);
  if(SHV.loupe)drawLoupe(ctx);
  ctx.restore();
}
function shopEnsure(){
  const W=window.innerWidth,H=window.innerHeight,kr=Math.min(2,window.devicePixelRatio||1);
  if(!SHV.G||SHV.G.W!==W||SHV.G.H!==H||SHV.G.kr!==kr){
    SHV.G=shopLayout();
    buildPins();
    SHV.camsInit=0;SHV.plateHit=null;SHV.pileHit=null;
    SHV.sig='';
  }
  if(SHV.sig!==staticSig())buildStatic();
  R.bx=SHV.G.bx;R.by=SHV.G.by;R.side=SHV.G.side;
  if(typeof M!=='undefined'&&typeof setM==='function')setM(Mimp());
  return SHV.G;
}
function Mimp(){ return (typeof M!=='undefined')?M:52; }
function drawHarmonics(g){
  const G=SHV.G,s=G.s;
  if(!(typeof API!=='undefined'&&API.hasHarmonics&&API.hasHarmonics())){
    SHV.plugHit=null;return;
  }
  const cx=G.paperCol.x+G.paperCol.w*0.72, cy=G.H*0.545, r=Math.max(26,42*s);
  const v=API.harmonics(), t=(v-1)/1022;
  const P=circP(cx,cy,r);
  face(g,P,TC.dark,0.42);
  hatch(g,P,cx-r,cy-r,r*2,r*2,60,Math.max(2.6,3.4*s),Math.max(0.6,0.9*s),TC.black,0.42);
  g.save();
  g.strokeStyle=inkedHex(TC.black);g.lineWidth=SHV.M.lw;g.stroke(P);
  for(let i=0;i<12;i++){
    const a=i*Math.PI/6;
    g.beginPath();g.moveTo(cx+Math.cos(a)*r*0.70,cy+Math.sin(a)*r*0.70);
    g.lineTo(cx+Math.cos(a)*r*0.96,cy+Math.sin(a)*r*0.96);g.stroke();
  }
  g.strokeStyle=inkedHex(TC.red);g.lineWidth=Math.max(1.4,1.8*s);
  const a=-Math.PI*0.5+t*6.2832;
  g.beginPath();g.moveTo(cx,cy);g.lineTo(cx+Math.cos(a)*r*0.66,cy+Math.sin(a)*r*0.66);g.stroke();
  g.restore();
  face(g,circP(cx,cy,r*0.17),TC.paper,0.20);
  cut(g,cx,cy-r-Math.max(9,11*s),'HARMONICS P',{size:Math.max(6.5,7.4*s),track:1.0,
    align:'center',col:inkedHex(TC.black)});
  cut(g,cx,cy+r+Math.max(10,12.5*s),String(v),{size:Math.max(9,11*s),align:'center',
    bold:true,col:inkedHex(TC.red)});
  cut(g,cx,cy+r+Math.max(20,25*s),'THE WAVE FROM THE IMAGE',{size:Math.max(6,6.9*s),
    align:'center',col:inkedHex(TC.mid)});
  SHV.plugHit={cx:cx,cy:cy,r:r};
}
/* ── §28 · boot and the public face ───────────────────────────────────────── */
const SHOPVIEW={
  init(){
    const T=SHV,c=document.getElementById('stage');
    T.key=[0.64,0.64,0.64];
    /* the two house stocks, so the feed board shows what is on its sheets even
       before anything has been fed: a proof of the record, not a label */
    try{ SHV.gsfc=recFromGSFC(); }catch(e){}
    try{ const r0=makeNoise(7); r0.smooth=true; SHV.noiseRec=prepRecord(r0); }catch(e){}
    T.impA=0;T.lev=0;T.paper=0;T.stock=[];T.tape=[];
    SHV.G=shopLayout();buildPins();
    const at=e=>{
      const r=c.getBoundingClientRect();
      return [(e.clientX-r.left)*innerWidth/r.width,(e.clientY-r.top)*innerHeight/r.height];
    };
    const onPress=(x,y)=>[x-(T.paintX||0),y-(T.paintY||0)];
    c.addEventListener('pointerdown',e=>{
      const [sx,sy]=at(e);
      if(e.button&&e.button!==0)return;
      if(ROOMVIEW.down(e,sx,sy))return;
      const [x,y]=onPress(sx,sy);
      if(SHV.loupe){SHV.loupe=null;return;}
      shopDown(x,y);
      try{c.setPointerCapture(e.pointerId);}catch(err){}
      e.preventDefault();
    });
    window.addEventListener('pointermove',e=>{
      const [sx,sy]=at(e);
      if(ROOMVIEW.move(e,sx,sy))return;
      const [x,y]=onPress(sx,sy);
      if(SHV.drag||SHV.grab||SHV.shake)shopMove(x,y);
      else{
        SHV.mx=x;SHV.my=y;
        const h=shopPick(x,y);
        SHV.hover=h;
        c.style.cursor=(h.kind==='none'||h.kind==='frame'||h.kind==='grip')?'grab':
          (h.kind==='sheet'||h.kind==='buy'||h.kind==='drawer'||h.kind==='loupe'||
           h.kind==='clutch'||h.kind==='drum')?'pointer':'grabbing';
      }
    },{passive:true});
    window.addEventListener('pointerup',e=>{
      const [sx,sy]=at(e);
      if(ROOMVIEW.up(e,sx,sy))return;
      const [x,y]=onPress(sx,sy);
      if(SHV.drag||SHV.grab||SHV.shake)shopUp(x,y);
      else SHV.shake=null;
      try{c.releasePointerCapture(e.pointerId);}catch(err){}
    });
    window.addEventListener('pointercancel',()=>{SHV.drag=null;SHV.grab=null;SHV.shake=null;ROOMVIEW.cancel();});
    c.addEventListener('wheel',e=>{
      const [sx,sy]=at(e);
      if(ROOMVIEW.wheel(e,sx,sy))return;
      const [x,y]=onPress(sx,sy);
      const h=shopPick(x,y);
      const dir=Math.sign(e.deltaY);
      if(h.kind==='wheel'){
        const p=(API.worldParams())[h.i];
        if(p&&!p.options){
          let v=p.value-dir*(p.max-p.min)/60;
          if(p.step)v=Math.round(v/p.step)*p.step;
          API.setWorldParam(p.key,clamp(v,p.min,p.max));
        }else if(p)API.setWorldParam(p.key,
          p.value===p.options[1].value?p.options[0].value:p.options[1].value);
        e.preventDefault();
      }else if(h.kind==='head'){
        const p=(API.fieldParams())[h.i];
        if(p&&!p.options){
          let v=p.value-dir*(p.max-p.min)/60;
          if(p.step)v=Math.round(v/p.step)*p.step;
          API.setFieldParam(p.key,clamp(v,p.min,p.max));
        }
        e.preventDefault();
      }else if(h.kind==='plug'){
        API.setHarmonics(clamp(API.harmonics()-dir*17,1,1023));e.preventDefault();
      }else if(h.kind==='key'){
        API.setInkKey(h.i,SHV.key[h.i]-dir*0.06);e.preventDefault();
      }
    },{passive:false});
    window.addEventListener('keydown',e=>{
      if(ROOMVIEW.key(e))return;
      if(e.key==='Escape'){SHV.loupe=null;sp(SHV,'paper',0,120,20);}
      else if(e.code==='Space'&&e.target===document.body){
        e.preventDefault();
        if(SHV.lev<0.62){SHV.lev=1;knock(1.5);API.pull();SHV.fireAt=performance.now()+140;}
      }
    });
    /* a phone is shaken, not grabbed: the same power mapping, the same rules */
    const A={mean:0,last:0};
    window.addEventListener('devicemotion',e=>{
      const a=e.accelerationIncludingGravity;if(!a)return;
      const m=Math.hypot(a.x||0,a.y||0,a.z||0);
      if(!A.mean)A.mean=m;
      A.mean=A.mean*0.92+m*0.08;
      const dev=Math.abs(m-A.mean),now=performance.now();
      if(dev>4.5&&now-A.last>700){A.last=now;knock(0.7);API.shake(clamp((dev-4.5)/12,0.15,1));}
    });
    window.addEventListener('dragstart',e=>e.preventDefault());
    window.addEventListener('dragover',e=>{
      if(e.dataTransfer&&Array.from(e.dataTransfer.types).includes('Files')){
        e.preventDefault();e.dataTransfer.dropEffect='copy';
      }
    });
    window.addEventListener('drop',e=>{
      if(!e.dataTransfer||!e.dataTransfer.files.length)return;
      e.preventDefault();
      if(ROOMVIEW.drop(e.dataTransfer.files))return;
      const raw=at(e),[x,y]=onPress(raw[0],raw[1]);
      SHOPVIEW.dropFiles(e.dataTransfer.files,x,y);
    });
    say('JOB 001 ON THE COUNTER · THE PLATES ARE OFF REGISTER — BRING THE PINS HOME',TC.pink);
    say('DROP ANY FILE ANYWHERE: IT LANDS ON THE FEED BOARD AS STOCK',TC.black);
  },
  /* the app asks for the pitch of the three plates before it prints */
  slip(){return slipArr();},
  reg(){return regErr();},
  say(txt,tone){say(txt,tone);},
  tick(dt){shopTick(dt);},
  paint(V,field,opts){shopPaint(V,field,opts);},
  /* the app hands a dropped file to the feed board: it is stock, not a dialog */
  dropFiles(files,x,y){
    const T=SHV,G=T.G,M=T.M;
    const inGrip=(px,py)=>px>M.grip.x-40&&px<M.grip.x+M.grip.w+40&&
      py>M.grip.y-G.sheet.h*0.25&&py<M.grip.y+M.grip.h+G.sheet.h*0.20;
    for(const f of files){
      if(inGrip(x,y)){
        if(typeof API!=='undefined'&&API.loadStock)API.loadStock(f);
        knock(0.3);
        continue;
      }
      const w=Math.max(84,120*G.s), h=Math.max(60,84*G.s);
      const d={x:x,y:y,w:w,h:h,label:(f.name||'STOCK').toUpperCase(),
        size:((f.size/1024)|0)+'K',kind:'drop',file:f,_carried:false};
      d.slotX=G.feed.x+G.feed.w*(0.30+0.22*T.stock.length);
      d.slotY=G.feed.y-G.feed.h*0.22;
      d._vx=(Math.random()*2-1);d._vy=-0.4;
      T.stock.push(d);
      if(/^image\//.test(f.type))createImageBitmap(f).then(b=>{SHV.thumb=b;}).catch(()=>{});
    }
  },
  deliver(kind){SHV.pileT=1;},
  openPicker(){openPicker();},
  pick(x,y){return shopPick(x,y).kind;},
  lens:function(){return SHV.lens;},
  geometry:function(){return SHV.G;},
  /* a test seam: the same numbers the machine reads, for the report */
  state:function(){
    return {pins:SHV.pins.map(p=>+pinResidual(p).toFixed(3)),
            slip:slipArr().map(v=>+v.toFixed(3)),reg:+regErr().toFixed(3),
            key:SHV.key.slice(),lev:+(SHV.lev||0).toFixed(3),
            paper:+SHV.paper.toFixed(3),tape:SHV.tape.length};
  },
  /* drags the machine itself, for a scripted test */
  grab(kind,x,y){shopDown(x,y);return SHV.hit?SHV.hit.kind:null;},
  move(x,y){shopMove(x,y);},
  up(x,y){shopUp(x,y);}
};






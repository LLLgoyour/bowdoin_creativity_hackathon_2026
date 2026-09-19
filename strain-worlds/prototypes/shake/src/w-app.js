/* ═══════════════════════════════════════════════════════════════════════════
   w-app.js — state, controls, loop. Owns everything the user touches.
   Timer-driven on purpose: requestAnimationFrame does not fire in a hidden or
   throttled pane, which is what made the previous iteration look frozen.
   ═══════════════════════════════════════════════════════════════════════════ */
const APP = {
  rec:null, field:null, world:null, S:null, pw:null, rng:null, img:null,
  /* path + synch: measured as the only pair that stays occupied on every board
     size. At 24x24 synch holds its whole mask (454/270/250/67 cells live on
     path/matrix/spectro/hst) while life on path, whose 79%-dense mask is
     dominated by its boundary at that size, dies out within a few generations. */
  srcId:'gsfc', fldId:'path', wrldId:'synch', seed:20260919,
  par:{field:{}, worlds:{}}, hist:new Int32Array(420), histN:0
};
let M=52, Muser=false, speed=10, playing=true, gen=0, liveN=0,
    acc=0, lastT=performance.now(), lastErr='',
    shakeMsg='', shakeUntil=0, szT=0, power=1;

const $=id=>document.getElementById(id);
const safe=(fn,d)=>{try{return fn();}catch(e){return d;}};

function fail(e){
  lastErr=String((e&&e.message)||e);
  $('hudtxt').style.color='#ff8a7a';
  $('hudtxt').textContent='ERROR · '+lastErr;
}
window.addEventListener('error',e=>fail(e));

/* ── the return: the app measures recovery, the worlds never predict it ──────
   A shake is one disturbance. Whether the board comes back is a fact about the
   world, so it is measured here, in the app, and not asserted by any world:
   every shake() in src/ still returns only what the kick did as it landed.

   The measurement is against a MATCHED CONTROL — a structural copy of the board
   taken one instant before the kick lands, with its own copy of the random
   stream, stepped in lockstep with the live board and never shaken. Each world
   is scored on its own order parameter (RET_SPEC, named in the panel), and the
   verdict is the first generation after which the two agree for RET.need
   consecutive generations. "No return within the window" is a result, not a
   failure. Every tolerance below was chosen from measurements in
   tools/probe-shake-return.mjs, and the panel prints it next to every number. */
const RET={
  win:600,        /* generations plotted, and the horizon for "no return" */
  need:12,        /* consecutive generations that must agree */
  cells:3,        /* absolute floor of a count tolerance, in cards */
  settle:400,     /* generations of settling before a kick is allowed to land */
  n:0, at:-1, ret:-1, done:false, ctl:null, err:'', pending:null,
  verified:null, log:{}, sig:''
};
/* live[] is the shaken board's scalar; ctrl[] is the control's. A world scored
   on a PAIRWISE scalar (how far apart the two boards are) has one number for
   both, so it is written into live[] and ctrl[] stays 0 — one scan and one
   tolerance rule then serve both kinds of world. */
RET.live=new Float64Array(RET.win+1);RET.ctrl=new Float64Array(RET.win+1);

/* What each world is scored on.
   synch/grav/life: the world's own population statistic, stats(), with a band
   proportional to the control because a count scales with the board.
   rd: the largest chemical disagreement between the two reefs. Its population
   cannot serve — measured in the probe, a full-power kick moves the reef count
   by at most 5 cards at 52x52 and at most 3 at 120x120 over 600 generations,
   while the largest |V difference| starts at 0.018, peaks at 0.034 and is still
   0.008 after 600 generations at 120x120. That is also the quantity the world's
   own probe measures recovery with. */
const RET_SPEC={
  synch:{mode:'board',rel:0.05,label:'locally locked cards',
    what:'stats(): cards whose neighbours are in phase within 0.9'},
  grav:{mode:'board',rel:0.01,label:'occupied piles',hud:'recovery',
    what:'stats(): cells holding at least one grain'},
  life:{mode:'board',rel:0.20,label:'live cards',
    what:'stats(): cards the row rule keeps alive'},
  rd:{mode:'pair',abs:0.005,label:'largest |ΔV| on the mask',
    what:'the biggest chemical disagreement anywhere on the record\'s footprint',
    pair:(S,C,field)=>{
      let m=0;
      for(let i=0;i<S.n;i++)if(field.mask[i]){
        const d=Math.abs(S.v[i]-C.v[i]);
        if(d>m)m=d;
      }
      return m;
    }}
};
const RET_FALLBACK={mode:'board',rel:0.01,label:'stats()',
  what:'the world\'s own population statistic'};
function retSpec(){return RET_SPEC[APP.wrldId]||RET_FALLBACK;}
function retTol(ctrl){
  const s=retSpec();
  return s.mode==='pair'?s.abs:Math.max(RET.cells,Math.round(s.rel*ctrl));
}
function retTolText(){
  const s=retSpec();
  return s.mode==='pair'?s.abs.toFixed(3)+' of the 0..1 concentration scale':
    'max('+RET.cells+' cards, '+Math.round(100*s.rel)+'% of the control)';
}

/* The worlds draw from mulberry32, and its k-th value depends only on the seed
   and k (its state advances by one constant per draw), so the same sequence can
   be produced by an indexed generator — and copying the generator is then just
   copying the index. tools/probe-shake-return.mjs checks this value for value
   against core.js's mulberry32, so the swap cannot change any board. A control
   that shared the live board's generator would not be a control: the two boards
   would be splitting one stream. */
function forkRng(seed,start){
  const box={seed:seed|0,k:start>>>0};
  const f=function(){
    const a=(box.seed+Math.imul((box.k+1)|0,0x6D2B79F5))|0;
    box.k=(box.k+1)>>>0;
    let t=Math.imul(a^a>>>15,1|a);
    t=t+Math.imul(t^t>>>7,61|t)^t;
    return((t^t>>>14)>>>0)/4294967296;
  };
  f.__seq=box;
  return f;
}
/* Worlds keep their state in numbers and typed arrays, so a structural copy
   reproduces it exactly — including several properties pointing at one array,
   because the copy map is by identity. Anything else (an uncopyable closure, a
   node) throws, and the panel reports that the control could not be built
   rather than reporting a return from a control that is not one. */
function cloneState(v,map){
  if(v===null||typeof v!=='object'){
    if(typeof v==='function'){
      if(!v.__seq)throw new Error('state holds a closure that cannot be copied');
      return forkRng(v.__seq.seed,v.__seq.k);
    }
    return v;
  }
  if(ArrayBuffer.isView(v))return v.slice();
  if(map.has(v))return map.get(v);
  const o={};
  map.set(v,o);
  for(const k of Object.keys(v))o[k]=cloneState(v[k],map);
  return o;
}
function cloneBoard(S){return cloneState(S,new Map());}
/* every own property, every element of every typed array, nested objects too
   (a world's view buffers live in one) */
function sameState(a,b){
  const ka=Object.keys(a);
  if(ka.length!==Object.keys(b).length)return false;
  for(const k of ka){
    const x=a[k],y=b[k];
    if(ArrayBuffer.isView(x)){
      if(!ArrayBuffer.isView(y)||x.constructor!==y.constructor||x.length!==y.length)return false;
      for(let i=0;i<x.length;i++)if(x[i]!==y[i])return false;
    }else if(typeof x==='function'){
      if(!x.__seq||!y.__seq||x.__seq.k!==y.__seq.k||x.__seq.seed!==y.__seq.seed)return false;
    }else if(x&&typeof x==='object'){
      if(!y||typeof y!=='object'||!sameState(x,y))return false;
    }else if(x!==y)return false;
  }
  return true;
}
/* Proof, once per world and board size, that a copy is faithful: two copies of
   the same board stepped in lockstep with no shake between them must stay
   identical, every state array, every generation. Run on copies, so the live
   board is untouched. If it fails, the panel says so and reports no return. */
const CTL_CHECK={};
function ctlVerified(w){
  const key=w.id+'@'+M;
  if(CTL_CHECK[key])return CTL_CHECK[key];
  const r={ok:0,gens:12,note:''};
  try{
    const a=cloneBoard(APP.S),b=cloneBoard(a);
    for(let g=0;g<r.gens;g++){
      w.step(a,APP.field,APP.pw);w.step(b,APP.field,APP.pw);
      if(!sameState(a,b)){r.note='copies diverged at generation '+(g+1);break;}
      r.ok++;
    }
    if(!r.note&&r.ok!==r.gens)r.note='copies differed';
  }catch(e){r.note=String((e&&e.message)||e);}
  CTL_CHECK[key]=r;
  return r;
}
/* the first generation whose difference stayed inside tolerance `need` times */
function retScan(){
  let run=0;
  for(let g=0;g<RET.n;g++){
    const d=Math.abs(RET.live[g]-RET.ctrl[g]);
    run=d<=retTol(RET.ctrl[g])?run+1:0;
    if(run>=RET.need)return g-RET.need+1;
  }
  return -1;
}
/* Called BEFORE the kick lands, so the control is the board the kick did not
   touch — same seed, same field, same parameters, same generation. */
function forkControl(w){
  RET.n=0;RET.at=-1;RET.ret=-1;RET.done=false;RET.ctl=null;RET.err='';RET.sig='';
  RET.live.fill(0);RET.ctrl.fill(0);
  RET.verified=ctlVerified(w);
  if(!RET.verified.ok){RET.err='could not be verified ('+RET.verified.note+')';return;}
  try{RET.ctl=cloneBoard(APP.S);}
  catch(e){RET.err='could not be built ('+((e&&e.message)||e)+')';RET.ctl=null;}
}
function recordTrace(){
  if(!RET.ctl||RET.n>RET.win)return;
  const w=APP.world,s=retSpec();
  if(s.mode==='pair'){
    /* one number describes the two boards, so it goes in live[] and ctrl[]
       stays 0 (see the note on RET.live) */
    RET.live[RET.n]=safe(()=>s.pair(APP.S,RET.ctl,APP.field),0)||0;
  }else{
    RET.live[RET.n]=safe(()=>w.stats(APP.S),0)||0;
    RET.ctrl[RET.n]=safe(()=>w.stats(RET.ctl),0)||0;
  }
  RET.n++;
  const r=retScan();
  if(r>=0&&RET.ret<0)RET.ret=r;
  /* the window has been served: stop spending a second board on it, but keep
     the traces on screen — a frozen verdict is still a result */
  if(RET.n>RET.win){RET.done=true;RET.ctl=null;}
}
/* the world's own impulse line, and what a kick does to this world (read off
   each world's shake(), no numbers invented here) */
const WORLD_KICK={
  synch:'A kick adds a seeded phase offset of up to π·power to every card in the mask and '+
        'rebases the bonds, so the impulse lands in phase, never in geometry.',
  grav:'16·power extra grains are dropped above each loud source column in one burst and '+
       'relaxed immediately: a finite impulse, never a persistent tilt.',
  rd:'One seeded frontier cell inside the mask receives a bounded blob of the second '+
     'chemical, strongest at the centre, tapering to nothing at the blob edge.',
  life:'Every cell of the mask is seeded with probability power/8 and existing cards are '+
       'rejuvenated rather than deleted, so the next rule generation reorganises the seed.'
};
const RET_STEP='every state array of two copies of the same board, stepped in lockstep';

/* ── sources ─────────────────────────────────────────────────────────────── */
function recFromGSFC(){
  /* smooth:true is the module's flag for "this record needs no reduction".
     773 samples are point-sampled by design, so without it matrix/spectro/hst
     block-average the record and serve a different picture from the one the
     probes measure (19.231% became 18.3% on matrix). */
  return prepRecord({name:GSFC.name,re:decodeF64(GSFC.re),im:decodeF64(GSFC.im),
    t:decodeF64(GSFC.t),smooth:true});
}
function recFromNoise(){
  const r=makeNoise(APP.seed);r.smooth=true;      /* 773 samples, same as the strain record */
  return prepRecord(r);
}
function setSource(id){
  APP.srcId=id;
  if(id==='gsfc')APP.rec=recFromGSFC();
  else if(id==='noise')APP.rec=recFromNoise();
  else if(id==='image'){
    if(!APP.img)return;
    APP.rec={kind:'image',name:APP.img.name||'image'};
  }
  rebuild();
}
function loadTextFile(f){
  if(!f)return;
  const r=new FileReader();
  r.onload=()=>{
    try{
      const o=parseNumeric(String(r.result));
      if(!o.re.length)throw new Error('no numbers found in '+f.name);
      APP.rec=prepRecord(o);APP.rec.name=f.name;APP.srcId='file';APP.img=null;
      $('note').textContent=f.name+' — '+o.re.length+' samples read';
      drawSourceChips();drawFieldChips();
      rebuild();
    }catch(e){fail(e);}
  };
  r.readAsText(f);
}
function loadImageFile(f){
  if(!f)return;
  createImageBitmap(f).then(bmp=>{
    APP.img=bmp;APP.imgName=f.name;APP.srcId='image';
    $('note').textContent=f.name+' — '+bmp.width+'×'+bmp.height+' pixels';
    drawSourceChips();drawFieldChips();drawParams();
    rebuild();
  }).catch(fail);
}
/* the image is re-sampled on EVERY rebuild, so changing M or resizing the window
   cannot leave a stale field behind (a defect the old version had) */
function imageField(W,H){
  const bmp=APP.img;
  const c=document.createElement('canvas');c.width=bmp.width;c.height=bmp.height;
  const g=c.getContext('2d',{willReadFrequently:true});
  g.drawImage(bmp,0,0);
  const d=g.getImageData(0,0,c.width,c.height);
  return fieldFromImage(d.data,c.width,c.height,W,H);
}

/* ── build ───────────────────────────────────────────────────────────────── */
function buildField(){
  if(!APP.rec){APP.field=null;return;}
  if(APP.rec.kind==='image'){APP.field=imageField(M,M);return;}
  const F=fieldById(APP.fldId);
  if(!F)return;
  APP.field=F.build(APP.rec,M,M,APP.par.field);
}
function livePar(wid){                       /* the object the world reads every step */
  const w=worldById(wid),store=APP.par.worlds[wid]||(APP.par.worlds[wid]={});
  for(const p of (w.params||[]))if(store[p.key]===undefined)store[p.key]=p.def;
  const o={};
  for(const p of (w.params||[]))
    Object.defineProperty(o,p.key,{get:()=>store[p.key],set:v=>{store[p.key]=v},enumerable:true});
  Object.defineProperty(o,'speed',{get:()=>speed,enumerable:true});
  Object.defineProperty(o,'seed',{get:()=>APP.seed,enumerable:true});
  return o;
}
function startWorld(){
  const w=worldById(APP.wrldId);
  if(!w||!APP.field){APP.world=null;APP.S=null;return;}
  APP.world=w;APP.pw=livePar(APP.wrldId);
  APP.rng=forkRng(APP.seed^0x9e3779b9,0);
  APP.S=w.init(M,M,APP.field,APP.rng,APP.pw);
  APP.V=safe(()=>w.view(APP.S),null);        /* the same buffers, kept for the app */
  gen=0;liveN=safe(()=>w.stats(APP.S),0)||0;
  APP.histN=0;APP.hist.fill(0);
  APP.hist[0]=liveN;APP.histN=1;
  dropControl();                             /* a new board has never been shaken */
}
/* every board is gone: no control, no traces, no verdict */
function dropControl(){
  RET.ctl=null;RET.n=0;RET.at=-1;RET.ret=-1;RET.done=false;RET.err='';RET.pending=null;
  RET.live.fill(0);RET.ctrl.fill(0);RET.sig='';
}
/* The one stepping path: the frame loop and the step button both come through
   here, so the control cannot slip out of lockstep with the live board. */
function stepBoards(steps){
  const w=APP.world;
  if(!w||!APP.S)return;
  for(let i=0;i<steps;i++){
    decaySpark();
    w.step(APP.S,APP.field,APP.pw);
    if(RET.ctl)w.step(RET.ctl,APP.field,APP.pw);
    gen++;
    if(RET.at>=0&&!RET.done)recordTrace();
  }
  /* the board has settled: land the kick the user asked for */
  if(RET.pending!==null&&gen>=RET.settle){
    const p=RET.pending;
    RET.pending=null;
    doShake(p);
  }
  liveN=safe(()=>w.stats(APP.S),liveN)||0;
  APP.hist[APP.histN%APP.hist.length]=liveN;APP.histN++;
}
function rebuild(){
  try{
    /* A kick the user asked for outlives the board it was asked on: the panel
       counts down to it in live generations, so dropping it here would break a
       promise already on screen. The new board settles and then takes the kick. */
    const queued=RET.pending;
    buildField();
    startWorld();
    if(queued!==null)RET.pending=queued;
    drawRecordPanel(APP.rec&&APP.rec.re?APP.rec:null);
    drawFieldPanel(APP.field);
    drawParams();
    updateNotes();
    shakeMsg='';shakeUntil=0;APP.lastShake='';
    paint();
  }catch(e){fail(e);}
}
function reseed(){                       /* same record, same field, new seed */
  APP.seed=(APP.seed+1)|0;
  if(APP.srcId==='noise'&&APP.rec)APP.rec=recFromNoise();
  try{
    const queued=RET.pending;            /* a queued kick outlives a new seed too */
    if(APP.srcId==='noise')buildField();
    startWorld();
    if(queued!==null)RET.pending=queued;
    paint();
  }catch(e){fail(e);}
}

/* ── the loop ────────────────────────────────────────────────────────────── */
/* The app owns starburst decay, and it decays once per GENERATION (not per
   frame), so a spark's brightness is 0.78^g at g generations after the birth and
   is invisible (under 0.05) after about twelve, at any frame rate. A world only
   ever sets V.spark[i] = 1 on the tick a birth happens; it must not decay the
   array itself, and it must not carry spark state in S. */
function decaySpark(){
  const V=APP.V;if(!V)return;
  const sp=V.spark;
  for(let i=0;i<sp.length;i++)sp[i]*=0.78;
}
function paint(){
  /* view() returns the CURRENT state and is cheap (measured 0.001-0.046 ms), so
     it is called on every paint. Never cache the object across steps: worlds are
     allowed to sync their view inside view() rather than inside step(), and a
     cached array then shows the state from whenever it was fetched. */
  const V=(APP.world&&APP.S)?safe(()=>APP.world.view(APP.S),null):null;
  APP.V=V;
  drawStage(V,APP.field,{dead:!!(V&&liveN===0&&gen>2),
    what:APP.world?APP.world.label:'',size:M});
  drawPopPanel(APP.hist,APP.histN,liveN);
  drawReturnPanel();
  updateShakeNote();
  updateHud();
}
function frame(){
  const now=performance.now();
  const dt=Math.min(0.5,(now-lastT)/1000);lastT=now;
  R.clock=now/1000;
  if(playing&&APP.world&&APP.S){
    acc+=dt*speed;
    let steps=Math.floor(acc);
    if(steps>0){
      acc-=steps;
      if(steps>90)steps=90;
      try{stepBoards(steps);}
      catch(e){playing=false;$('b_play').textContent='▶ play';fail(e);}
      paint();
    }
  }
}
function updateHud(){
  if(lastErr&&$('hudtxt').textContent.startsWith('ERROR'))return;
  $('hudtxt').style.color='#f6c344';
  const w=APP.world,extra=w?safe(()=>w.HUD(APP.S,APP.field,APP.pw),''):'';
  /* A world's HUD string is its own readout and several of them print the
     generation and the live count themselves. When one does, its string is the
     whole caption and the app's own counters stay in the stats panel rather than
     being printed twice in the same line. */
  const own=/gen\s+\d+/i.test(extra);
  const mine='gen '+gen+' · '+liveN.toLocaleString()+' cells';
  $('hudtxt').textContent=own?extra:(mine+(extra?' · '+extra:''));
  const shake=(shakeUntil>performance.now()&&shakeMsg)?['SHAKE '+shakeMsg]:[];
  $('ticker').textContent=shake.concat([APP.field?APP.field.label:'',w?w.label:'',
    own?extra:(extra+' · '+mine)]).filter(Boolean).join('   ·   ');
}
function updateNotes(){
  const f=APP.field,w=APP.world;
  $('fnote').textContent=f?f.note:'';
  $('wnote').innerHTML=(w?('<b>'+w.label+'.</b> '+(w.blurb||'')+' '+(WORLD_NOTE[w.id]||'')):'');
  if(APP.rec&&APP.rec.re){
    const n=APP.rec.re.length;
    $('note').textContent=(APP.rec.name||'record')+' — '+n+' complex samples'+
      (APP.rec.turns!=null?', '+APP.rec.turns.toFixed(2)+' turns of phase':'')+
      (APP.rec.amax!=null?', |h| up to '+APP.rec.amax.toFixed(3):'');
  }
}
/* the measured headline for each world; every number here is from that world's
   probe or from the browser, and none of them are estimates */
const WORLD_NOTE={
  synch:'Measured on the record: the board locks 0.84/0.83/0.90 of its cells at 52/76/120 '+
        'while the global order parameter swings 0.17/0.23/0.29. "Locked" counts cells whose '+
        'LOCAL order is above 0.9 and r is the GLOBAL phase average, so the two need not '+
        'agree: coherent domains cancel each other in the global average. The disorder '+
        'spread scales with board area because recorded phase varies more slowly across '+
        'neighbouring cards on a larger board; the exponent 0.25 is fitted to this record, '+
        'not to a physical law. Lock fronts travel: with the record\'s frequencies the '+
        'central phase gradient runs 0.00 to 0.33 rad/cell over 500 generations.',
  grav:'Measured on the record at 52x52: mass is conserved exactly over 2000 steps '+
       '(1386 + 2189 = 3435 + 140, boundary losses counted), but the basin is still filling '+
       'at the end of that run — mean mass 3025.24 over steps 1501-1750 against 3311.76 '+
       'over 1751-2000 — so its late statistics describe a transient, not a steady state. '+
       'Over steps 801-1000 every one of the 200 generations cascades, averaging 1813 '+
       'topplings with a largest cascade of 3549, and all 200 events exceed 200 topplings: '+
       'a truncated distribution, and no heavy-tailed law is established. At 120x120 the '+
       'same parameters are dormant — 6 cascades in 200 generations, 0.03 per generation, '+
       'against 194 that move nothing. Controls separate the mechanism from a random walk: '+
       'flat, equal-mass terrain topples 0 times, a drained variant empties instead of '+
       'piling, and a field with no downhill direction emits nothing.',
  rd:'Measured on the record at 52x52: the reef turns over rather than settling — its first '+
     '200 generations hold 763, 504, 423 and 506 live cells at generations 50/100/150/200 — '+
     'and it reaches 26.7% of the board by generation 2000 with 14 births and 7 deaths in '+
     'the final 200. The record is in the dynamics, not only in the picture: switching the '+
     'field to a non-isometric one at generation 500 lands on a different equilibrium — '+
     '27.15% of the board in 1 blob where the baseline held 26.74% in 5, with a mean-v '+
     'difference of 0.1199 — and both states keep reacting. On thin substrates it runs '+
     'near-static instead: 17 of 143 cells on the Hilbert spectrum at 120x120.',
  life:'A B/S rule on the record\'s self-similarity bands: the one rule family borrowed '+
       'wholesale rather than driven, though both the substrate and the per-row rules come '+
       'from the record. Measured: every one of the eight amplitude rows changes the rule '+
       'in a way the picture can see — 1343 cells under uniform rules against 2796 under '+
       'row rules by generation 100 — and the record\'s own substrate churns at 16 births '+
       'and 16 deaths per generation at 52x52, 64 and 64 at 120x120, and 5 and 5 on the '+
       'raw-gap substrate. Its falling variant ships off by default and is not a pile: at '+
       '52x52 with gravity the colony thins to 59 cards from 68 and its centroid moves up '+
       'to row 18.1 from 21.9, because the material the fall strands dies rather than '+
       'accumulating.'
};

/* ── controls ────────────────────────────────────────────────────────────── */
function chip(label,on,fn){
  const b=document.createElement('div');
  b.className='chip'+(on?' on':'');b.textContent=label;
  b.addEventListener('click',fn);return b;
}
function drawSourceChips(){
  const c=$('srcs');c.innerHTML='';
  const add=(id,lab)=>c.appendChild(chip(lab,APP.srcId===id,()=>{setSource(id);drawSourceChips();}));
  add('gsfc','GSFC strain');
  add('noise','noise');
  if(APP.img)c.appendChild(chip((APP.imgName||'image').slice(0,12),APP.srcId==='image',()=>{setSource('image');drawSourceChips();}));
  c.appendChild(chip('+ file',false,()=>$('f_any').click()));
  c.appendChild(chip('+ image',false,()=>$('f_img').click()));
}
function drawFieldChips(){
  const c=$('flds');c.innerHTML='';
  if(APP.rec&&APP.rec.kind==='image'){
    c.appendChild(chip('image',true,()=>{}));
    return;
  }
  for(const f of FIELDS)
    c.appendChild(chip(f.label,APP.fldId===f.id,()=>{APP.fldId=f.id;drawFieldChips();drawParams();rebuild();}));
  if(!FIELDS.length)c.appendChild(chip('(field module missing)',false,()=>{}));
}
function drawWorldChips(){
  const c=$('wrlds');c.innerHTML='';
  for(const w of WORLDS)
    c.appendChild(chip(w.label,APP.wrldId===w.id,()=>{APP.wrldId=w.id;drawWorldChips();drawParams();startWorld();updateNotes();paint();}));
  if(!WORLDS.length)c.appendChild(chip('(world modules missing)',false,()=>{}));
}
function rangeRow(holder,label,key,min,max,step,get,set){
  const row=document.createElement('div');row.className='row';
  const l=document.createElement('label');l.textContent=label;
  const r=document.createElement('input');r.type='range';
  r.min=min;r.max=max;r.step=step;r.value=get();
  const o=document.createElement('output');o.value=String(get());
  r.addEventListener('input',()=>{set(parseFloat(r.value));o.value=String(get());});
  row.appendChild(l);row.appendChild(r);row.appendChild(o);
  holder.appendChild(row);
}
/* A param with `options` is a choice, not a range: the field or world declares
   [{value,label}] and its `def` is one of the values. Rendering it as a range
   would print NaN bounds and silently write a number where a string belongs. */
function selectRow(holder,label,options,get,set){
  const row=document.createElement('div');row.className='row';
  const l=document.createElement('label');l.textContent=label;
  const s=document.createElement('select');
  for(const o of options){
    const opt=document.createElement('option');
    opt.value=o.value;opt.textContent=o.label;if(get()===o.value)opt.selected=true;
    s.appendChild(opt);
  }
  s.addEventListener('change',()=>set(s.value));
  row.appendChild(l);row.appendChild(s);holder.appendChild(row);
}
function drawParams(){
  const h=$('params');h.innerHTML='';
  const f=fieldById(APP.fldId);
  if(f&&f.params&&!(APP.rec&&APP.rec.kind==='image')){
    const t=document.createElement('div');t.className='chips';t.style.marginTop='7px';
    t.appendChild(chip('field: '+f.label,true,()=>{}));h.appendChild(t);
    for(const p of f.params){
      if(APP.par.field[p.key]===undefined)APP.par.field[p.key]=p.def;
      if(p.options)selectRow(h,p.label,p.options,()=>APP.par.field[p.key],
        v=>{APP.par.field[p.key]=v;rebuild();});
      else rangeRow(h,p.label,p.key,p.min,p.max,p.step,
        ()=>APP.par.field[p.key],v=>{APP.par.field[p.key]=v;rebuild();});
    }
  }
  const w=worldById(APP.wrldId);
  if(w&&w.params){
    for(const p of w.params){
      const store=APP.par.worlds[w.id]||(APP.par.worlds[w.id]={});
      if(store[p.key]===undefined)store[p.key]=p.def;
      if(p.options)selectRow(h,p.label,p.options,()=>store[p.key],v=>{store[p.key]=v;});
      else rangeRow(h,p.label,p.key,p.min,p.max,p.step,()=>store[p.key],v=>{store[p.key]=v;});
    }
  }
}
/* ── the shake ───────────────────────────────────────────────────────────────
   The audience-facing interaction, and the content of this variant: one
   disturbance, four temperaments. shake() is still a pure function of the
   world's state, the field and power, driven by the world's own seeded
   generator, and it still returns one line of measured numbers describing what
   the kick did as it landed — never a recovery time, which cannot exist yet at
   the moment it returns. The recovery is measured out here, afterwards.

   A kick on a board that has not settled has no steady state to disturb, so it
   would measure the board's startup rather than its world: the sandpile is
   still dropping its first burst, the reef is still spreading in. The contract
   therefore holds the kick until the board has run RET.settle generations. The
   panel counts the wait down, and it is short — at the default speed the board
   crosses 400 generations in a fraction of a second. */
function doShake(pw){
  const w=APP.world;
  if(!w||!APP.S||!APP.field)return '';
  power=clamp(pw,0,1);syncPower();
  if(typeof w.shake!=='function'){
    shakeMsg='no shake for '+w.label;shakeUntil=performance.now()+2600;
    dropControl();RET.err='this world cannot be shaken';paint();return '';
  }
  if(gen<RET.settle){                  /* no steady state yet: queue the kick */
    RET.pending=power;RET.sig='';
    shakeMsg='settling · kick queued';
    shakeUntil=performance.now()+2600;
    paint();
    return '';
  }
  forkControl(w);                 /* the board one instant BEFORE the kick */
  let msg;
  try{msg=w.shake(APP.S,APP.field,power);}catch(e){fail(e);return '';}
  shakeUntil=performance.now()+2600;
  if(lastErr)return '';
  APP.lastShake=msg||'';
  shakeMsg=msg||('shake '+power.toFixed(2));
  RET.at=gen;                     /* the kick landed at this generation */
  recordTrace();                  /* row 0 exists even if the board is paused */
  paint();
  return APP.lastShake;
}
/* ── the return panel ────────────────────────────────────────────────────────
   Two traces on one pair of axes: the shaken board and its control. The gap
   between them is filled, and the control is drawn with its tolerance corridor
   around it, so the disturbance and the re-convergence are the same picture.
   The reaction world is scored on how far apart the two boards are (its
   population does not feel a bounded local injection), so for it the corridor
   sits along the bottom and one trace — the distance — climbs out of it.
   The x axis is generations since the kick on a scale that opens as the trace
   grows, so a 30-generation return is still readable. */
function drawReturnPanel(){
  const cv=$('c_ret');if(!cv)return;
  const g=cv.getContext('2d'),w=cv.width,h=cv.height;
  g.clearRect(0,0,w,h);g.fillStyle='#0e1424';g.fillRect(0,0,w,h);
  g.strokeStyle='rgba(246,195,68,.45)';g.lineWidth=1.5;g.strokeRect(1.5,1.5,w-3,h-3);
  g.font='9px ui-rounded,sans-serif';
  const n=RET.n,L=30,Rr=w-6,T=20,B=h-14,plotW=Rr-L,plotH=B-T;
  if(!APP.world){return;}
  if(RET.pending!==null){
    g.fillStyle='rgba(246,195,68,.9)';
    g.fillText('SETTLING · the kick fires at generation '+RET.settle+
      ' (+'+Math.max(0,RET.settle-gen)+')',8,h/2-6);
    g.fillStyle='rgba(159,176,208,.9)';
    g.fillText('a kick on a board with no steady state would measure its startup',8,h/2+7);
    return;
  }
  if(RET.err||RET.at<0||n<2){
    g.fillStyle='rgba(246,231,200,.8)';
    g.fillText(RET.err?('CONTROL '+RET.err.toUpperCase()):'shake the board to start a pair of traces',8,h/2+3);
    return;
  }
  const pair=retSpec().mode==='pair',tolA=retTol(0);
  const fmt=pair?(v=>v.toFixed(3)):(v=>Math.round(v).toLocaleString());
  const xmax=Math.max(40,Math.min(RET.win,Math.round((n-1)*1.25)));
  let ymax=0;
  for(let i=0;i<n;i++){
    if(RET.live[i]>ymax)ymax=RET.live[i];
    if(!pair){
      const top=RET.ctrl[i]+retTol(RET.ctrl[i]);
      if(top>ymax)ymax=top;
    }
  }
  if(pair&&tolA>ymax)ymax=tolA;
  ymax=ymax*1.08;
  if(!pair)ymax=Math.max(4,Math.round(ymax));
  const X=i=>L+plotW*i/xmax, Y=v=>B-plotH*(v/ymax);
  const step=Math.max(1,Math.ceil(n/plotW));
  const trace=(arr,col,lw)=>{
    g.strokeStyle=col;g.lineWidth=lw;g.beginPath();
    for(let i=0;i<n;i+=step)g.lineTo(X(i),Y(arr[i]));
    g.stroke();
  };
  if(pair){
    /* the two boards are one number apart: the corridor is the tolerance, and
       the trace above it is how far apart the two reefs are */
    g.fillStyle='rgba(90,127,216,.22)';
    g.fillRect(L,Y(tolA),plotW,Math.max(1,Y(0)-Y(tolA)));
    g.strokeStyle='rgba(90,127,216,.8)';g.lineWidth=1;
    g.beginPath();g.moveTo(L,Y(tolA));g.lineTo(Rr,Y(tolA));g.stroke();
    trace(RET.live,'#f6c344',1.8);
    g.fillStyle='rgba(159,176,208,.95)';
    g.fillText('tolerance '+fmt(tolA),L+3,Y(tolA)+9);
  }else{
    /* the corridor: what "agreement" means, drawn around the control */
    g.fillStyle='rgba(90,127,216,.18)';
    g.beginPath();
    for(let i=0;i<n;i+=step)g.lineTo(X(i),Y(RET.ctrl[i]+retTol(RET.ctrl[i])));
    for(let i=n-1;i>=0;i-=step)g.lineTo(X(i),Y(Math.max(0,RET.ctrl[i]-retTol(RET.ctrl[i]))));
    g.closePath();g.fill();
    /* the gap between the boards: that IS the disturbance, and its closing is
       the return */
    g.fillStyle='rgba(232,86,63,.32)';
    g.beginPath();
    for(let i=0;i<n;i+=step)g.lineTo(X(i),Y(RET.live[i]));
    for(let i=n-1;i>=0;i-=step)g.lineTo(X(i),Y(RET.ctrl[i]));
    g.closePath();g.fill();
    trace(RET.ctrl,'#5a7fd8',1.5);
    trace(RET.live,'#f6c344',1.8);
  }
  /* the kick, at generation 0 of the trace */
  g.save();g.setLineDash([2,2]);
  g.strokeStyle='rgba(246,231,200,.55)';g.lineWidth=1;
  g.beginPath();g.moveTo(X(0),T-6);g.lineTo(X(0),B);g.stroke();
  /* the reported return */
  if(RET.ret>=0&&RET.ret<n){
    g.strokeStyle='rgba(87,172,74,.9)';g.lineWidth=1.2;
    g.beginPath();g.moveTo(X(RET.ret),T-6);g.lineTo(X(RET.ret),B);g.stroke();
    g.restore();
    g.fillStyle='#57ac4a';
    g.fillText('+'+RET.ret,X(RET.ret)+2,T-8);
  }else g.restore();
  g.fillStyle='rgba(246,231,200,.8)';
  g.fillText('kick',X(0)+3,T-8);
  g.fillText(fmt(ymax),2,T-8);
  g.fillText('0',L-8,B+4);
  g.fillText('+'+xmax+' generations',Rr-78,B+4);
  /* legend: the same colours as the traces */
  g.fillStyle='#f6c344';g.fillRect(L+34,T-14,6,6);
  g.fillStyle='rgba(246,231,200,.85)';
  g.fillText(pair?'largest |ΔV| between the two boards':'shaken',L+43,T-8);
  if(!pair){
    g.fillStyle='#5a7fd8';g.fillRect(L+134,T-14,6,6);
    g.fillStyle='rgba(246,231,200,.85)';g.fillText('control',L+143,T-8);
  }
}
/* the widest the two boards ever got, and when */
function retPeak(){
  let p=0,at=0;
  for(let i=0;i<RET.n;i++){
    const d=Math.abs(RET.live[i]-RET.ctrl[i]);
    if(d>p){p=d;at=i;}
  }
  return {p:p,at:at};
}
/* ── the verdict, in words ───────────────────────────────────────────────── */
function retVerdict(){
  if(!APP.world)return {t:'no world',k:0};
  if(RET.err)return {t:'no control: '+RET.err,k:3};
  if(RET.pending!==null){
    const left=Math.max(0,RET.settle-gen);
    return {t:'SETTLING · the kick fires in '+left+(left===1?' generation':' generations'),
      k:1,queue:true,left:left};
  }
  if(RET.at<0)return {t:'not shaken yet',k:0};
  const n=RET.n;
  if(!n)return {t:'measuring',k:1};
  const l=RET.live[n-1],c=RET.ctrl[n-1],d=Math.abs(l-c),tol=retTol(c);
  const bits={d:d,tol:tol,l:l,c:c,mode:retSpec().mode};
  if(RET.ret>=0)return Object.assign({t:'RETURNED AT +'+RET.ret+' GENERATIONS',k:2},bits);
  if(RET.done)return Object.assign({t:'NO RETURN WITHIN '+RET.win+' GENERATIONS',k:3},bits);
  return Object.assign({t:'measuring · +'+(n-1)+' of '+RET.win+' generations',k:1},bits);
}
function updateShakeNote(){
  const w=APP.world,v=retVerdict();
  const sig=[w?w.id:'',M,RET.at,RET.n,RET.ret,RET.done?1:0,RET.err,power.toFixed(2),
    RET.pending===null?'-':gen,
    RET.n?RET.live[RET.n-1]:0,RET.n?RET.ctrl[RET.n-1]:0,APP.lastShake||''].join('|');
  if(sig===RET.sig)return;
  RET.sig=sig;
  const line=$('retline');
  line.textContent=v.t;
  line.style.color=v.k===2?'#57ac4a':v.k===3?'#e8563f':v.k===1?'#f6c344':'#9fb0d0';
  const num=$('retnum');
  if(v.queue){
    num.innerHTML='the kick waits for a board that has settled ('+RET.settle+
      ' generations): a kick on the startup transient would measure the board\'s first '+
      'breath, not its world.';
  }
  else if(v.d===undefined)num.textContent='';
  else{
    const pk=retPeak();
    if(v.mode==='pair')num.innerHTML='largest chemical difference <b>'+v.d.toFixed(4)+
      '</b> · worst <b>'+pk.p.toFixed(4)+'</b> at +'+pk.at+' · tolerance '+v.tol.toFixed(3);
    else num.innerHTML='shaken <b>'+v.l.toLocaleString()+'</b> · control <b>'+
      v.c.toLocaleString()+'</b> · apart <b>'+v.d.toLocaleString()+'</b> cards · tolerance ±'+
      v.tol.toLocaleString()+' · worst '+Math.round(pk.p).toLocaleString()+' at +'+pk.at;
  }
  const s=retSpec();
  $('kickline').textContent=APP.lastShake?('the kick, verbatim: '+APP.lastShake):'';
  $('retcrit').innerHTML='criterion: '+(v.mode==='pair'?'the distance between the two boards':
    '|shaken − control|')+' ≤ '+retTolText()+' for '+RET.need+' consecutive generations, horizon '+
    RET.win+' · scalar: '+(w?(s.label+' — '+s.what):'')+
    (s.hud&&w?(' · '+w.label.toLowerCase()+'’s HUD also tracks its own '+s.hud+
      ' on its own criterion — that one is the world’s internal history; the number above '+
      'is measured here, between the two boards'):'');
  $('ctlbadge').innerHTML=RET.at<0?'':'control: the same board copied one instant before the '+
    'kick, never shaken, stepped in lockstep · copy check: <b>'+
    (RET.verified?RET.verified.ok+'/'+RET.verified.gens:'0')+'</b> generations identical ('+
    RET_STEP+')'+(RET.verified&&RET.verified.note?' — '+RET.verified.note:'');
  $('kw').textContent=w?(WORLD_KICK[w.id]||''):'';
  /* the comparison this variant exists for: what each world has answered so far */
  if(w&&RET.verified&&RET.verified.ok){
    if(RET.ret>=0||RET.done)RET.log[w.id]={ret:RET.ret,n:RET.n,p:power,M:M,at:RET.at};
  }
  const rows=[];
  for(const x of WORLDS){
    const r=RET.log[x.id];
    if(!r)continue;
    rows.push(x.label+' '+(r.ret>=0?'+'+r.ret+'g':'>'+RET.win+'g')+
      ' (p'+r.p.toFixed(1)+', '+r.M+'×'+r.M+', kicked at gen '+r.at+')');
  }
  $('retlog').textContent=rows.length>1?'four laws, one disturbance — measured here: '+rows.join(' · '):'';
}
function syncPower(){
  const r=$('r_pow'),o=$('o_pow');
  if(r)r.value=String(power);
  if(o)o.value=power.toFixed(2);
}
function bindShake(){
  /* a drag-shake: three direction reversals inside one gesture, power from how
     far the pointer travelled — 2600 px of travel is full power, and a gesture
     that qualifies is never treated as a nudge */
  const G={on:false,x:0,y:0,dir:0,travel:0,rev:0};
  window.addEventListener('pointerdown',e=>{
    if(e.target&&e.target.closest&&e.target.closest('#rail'))return;
    G.on=true;G.x=e.clientX;G.y=e.clientY;G.dir=0;G.travel=0;G.rev=0;
  });
  window.addEventListener('pointermove',e=>{
    if(!G.on)return;
    const dx=e.clientX-G.x,dy=e.clientY-G.y,d=Math.hypot(dx,dy);
    if(d<6)return;
    const dir=Math.abs(dx)>Math.abs(dy)?Math.sign(dx):Math.sign(dy);
    if(G.dir&&dir&&dir!==G.dir)G.rev++;
    G.dir=dir;G.travel+=d;G.x=e.clientX;G.y=e.clientY;
    if(G.rev>=3){G.on=false;doShake(clamp(G.travel/2600,0.25,1));}
  });
  window.addEventListener('pointerup',()=>{G.on=false;});
  window.addEventListener('pointercancel',()=>{G.on=false;});
  /* DeviceMotionEvent on a phone: deviation from a slow baseline of the
     including-gravity magnitude. Same mapping to power, same rules. */
  const A={mean:0,last:0};
  window.addEventListener('devicemotion',e=>{
    const a=e.accelerationIncludingGravity;if(!a)return;
    const m=Math.hypot(a.x||0,a.y||0,a.z||0);
    if(!A.mean)A.mean=m;
    A.mean=A.mean*0.92+m*0.08;
    const dev=Math.abs(m-A.mean),now=performance.now();
    if(dev>4.5&&now-A.last>700){A.last=now;doShake(clamp((dev-4.5)/12,0.15,1));}
  });
  $('b_shake').addEventListener('click',()=>{
    const dm=window.DeviceMotionEvent;
    if(dm&&typeof dm.requestPermission==='function'){
      dm.requestPermission().then(r=>{
        if(r!=='granted'){shakeMsg='motion not granted · the button still shakes';
          shakeUntil=performance.now()+2600;paint();}
      }).catch(()=>{});
    }
    doShake(power);
  });
  /* the power is a control, not a constant: the same power on all four worlds
     is what makes the four temperaments comparable, and the presets shake at
     once so a world can be compared without touching two controls */
  const rp=$('r_pow');rp.value=String(power);$('o_pow').value=power.toFixed(2);
  rp.addEventListener('input',()=>{power=clamp(parseFloat(rp.value),0,1);syncPower();paint();});
  const pws=$('pws');
  for(const p of [0.2,0.5,1])pws.appendChild(chip('shake '+p.toFixed(1),false,()=>doShake(p)));
  window.addEventListener('keydown',e=>{
    if(e.key==='s'||e.key==='S'){e.preventDefault();doShake(power);}
  });
}
function bindOnce(){
  $('f_any').addEventListener('change',e=>loadTextFile(e.target.files[0]));
  $('f_img').addEventListener('change',e=>loadImageFile(e.target.files[0]));
  window.addEventListener('dragover',e=>{e.preventDefault();});
  window.addEventListener('drop',e=>{
    e.preventDefault();
    const f=e.dataTransfer.files[0];if(!f)return;
    if(/^image\//.test(f.type))loadImageFile(f);else loadTextFile(f);
  });
  $('b_play').addEventListener('click',()=>{
    playing=!playing;$('b_play').textContent=playing?'⏸ pause':'▶ play';
  });
  $('b_step').addEventListener('click',()=>{
    if(!APP.world||!APP.S)return;
    try{stepBoards(1);paint();}catch(e){fail(e);}
  });
  $('b_reset').addEventListener('click',reseed);
  bindShake();
  $('chip').addEventListener('click',()=>{
    const r=$('rail');
    r.style.display=(getComputedStyle(r).display==='none')?'block':'none';
    relayout();
  });
  const sp=$('r_speed');sp.value=speed;$('o_speed').value=speed;
  sp.addEventListener('input',()=>{speed=parseFloat(sp.value);$('o_speed').value=speed;});
  const sz=$('r_size');
  sz.addEventListener('input',()=>{
    Muser=true;M=parseInt(sz.value,10);$('o_size').value=M;
    /* rebuilding the field on every tick freezes the drag on a long record
       (block-averaging a 24 kHz file costs hundreds of ms), so the rebuild
       waits for the drag to pause */
    clearTimeout(szT);
    szT=setTimeout(()=>{setM(M);rebuild();},90);
  });
  const sk=$('r_spark');sk.value=R.sparkBudget;$('o_spark').value=R.sparkBudget;
  sk.addEventListener('input',()=>{
    R.sparkBudget=parseInt(sk.value,10);$('o_spark').value=R.sparkBudget;
  });
  window.addEventListener('resize',()=>relayout());
}
function relayout(){
  const suggest=layout();
  const sz=$('r_size');
  sz.min=24;sz.max=120;
  if(!Muser){M=suggest;sz.value=M;}
  $('o_size').value=M;
  setM(M);
  rebuild();
}
/* ── boot ────────────────────────────────────────────────────────────────── */
(function boot(){
  try{
    if(window.innerWidth<900)$('rail').style.display='none';
    bindOnce();
    drawSourceChips();drawFieldChips();drawWorldChips();drawParams();
    if(typeof prepRecord==='function'&&typeof GSFC!=='undefined'){
      try{setSource('gsfc');}catch(e){fail(e);}
      drawSourceChips();
    }
    relayout();
    drawRecordPanel(APP.rec&&APP.rec.re?APP.rec:null);
    if(!FIELDS.length||!WORLDS.length){
      $('hudtxt').textContent='waiting for modules · fields '+FIELDS.length+' · worlds '+WORLDS.length;
    }
    setInterval(frame,16);
    frame();
  }catch(e){
    $('hudtxt').textContent='BOOT ERROR · '+((e&&e.message)||e);
    $('hudtxt').style.color='#ff8a7a';
  }
})();

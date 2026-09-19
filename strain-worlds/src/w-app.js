/* ═══════════════════════════════════════════════════════════════════════════
   w-app.js — state, controls, loop. Owns everything the user touches.
   Timer-driven on purpose: requestAnimationFrame does not fire in a hidden or
   throttled pane, which is what made the previous iteration look frozen.
   ═══════════════════════════════════════════════════════════════════════════ */
const APP = {
  rec:null, feedback:null, field:null, world:null, S:null, pw:null, rng:null,
  hist:new Float64Array(180), histN:0,
  scopeHist:new Float32Array(420), scopeN:0, scopeOffset:40,
  /* the file source: APP.file is the file itself (kind, name, cached contour or
     record) and APP.wmeta the measured numbers of the wave it became */
  file:null, wmeta:null, waveP:48, actx:null,
  /* path + synch: measured as the only pair that stays occupied on every board
     size. At 24x24 synch holds its whole mask (454/270/250/67 cells live on
     path/matrix/spectro/hst) while life on path, whose 79%-dense mask is
     dominated by its boundary at that size, dies out within a few generations. */
  srcId:'gsfc', fldId:'path', wrldId:'synch', seed:20260919,
  par:{field:{}, worlds:{}}
};
let M=52, Muser=false, speed=10, playing=true, gen=0, liveN=0,
    tickClock=performance.now(), lastT=performance.now(), lastErr='';

const safe=(fn,d)=>{try{return fn();}catch(e){return d;}};

/* the press has no place to print a stack trace, so a failure is a slug on the
   machine and the drive stops: the operator is standing right there          */
function fail(e){
  lastErr=String((e&&e.message)||e);
  if(typeof SHOPVIEW!=='undefined'&&SHOPVIEW.say)
    SHOPVIEW.say('THE PRESS STOPPED — '+lastErr,TC.pink);
  if(typeof ROOMVIEW!=='undefined')ROOMVIEW.say('COULD NOT COMPLETE — '+lastErr);
}
window.addEventListener('error',e=>fail(e));

/* ── sources ───────────────────────────────────────────────────────────────
   This variant's claim, made structural: there is no image source and no audio
   source, only a wave source. An image becomes the epicycles of its own
   outline, an audio file becomes its analytic signal x + i·H(x), and a text
   file of numbers is already the record. All three arrive as {re, im, t} and
   the four fields and the four worlds never learn which one they got. */
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
function fileKind(f){
  if(/^image\//.test(f.type)||/\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(f.name))return 'image';
  if(/^audio\//.test(f.type)||/\.(wav|mp3|m4a|aac|ogg|oga|opus|flac|weba)$/i.test(f.name))return 'audio';
  return 'text';
}
/* the record the selected source means right now: for an image this re-runs the
   harmonic fit at whatever P the dial holds, from the cached contour */
function deriveFile(){
  const f=APP.file;
  if(!f)return;
  if(f.kind==='image'){
    const raw=waveFit(f.contour,APP.waveP);
    APP.rec=prepRecord(raw);APP.wmeta=raw.wave;
  }else{APP.rec=f.rec;APP.wmeta=f.meta;}
}
function setSource(id){
  /* loading the sheet of stock that is already on the feed board changes
     nothing, so the proof stands. A fresh sheet of house noise is a fresh
     sheet: the noise is drawn from the press's own seed, so re-loading it
     re-cuts the wave. */
  const same=!!(APP.field&&APP.world&&id===APP.srcId&&id!=='file'&&id!=='noise');
  APP.srcId=id;
  if(id==='gsfc'){APP.rec=recFromGSFC();APP.wmeta=null;}
  else if(id==='noise'){APP.seed=(APP.seed+1)>>>0;APP.rec=recFromNoise();APP.wmeta=null;}
  else if(id==='file'&&APP.file)deriveFile();
  if(same)return;
  if(typeof knockBack==='function')knockBack('A DIFFERENT COMMISSION');
  rebuild();
}
function loadTextFile(f){
  if(!f)return;
  const r=new FileReader();
  r.onload=()=>{
    try{
      const o=parseNumeric(String(r.result));
      if(!o.re.length)throw new Error('no numbers found in '+f.name);
      const rec=prepRecord(o);rec.name=f.name;
      APP.file={kind:'text',name:f.name,rec,meta:{kind:'text',file:f.name,points:o.re.length,columns:o.kind}};
      APP.srcId='file';deriveFile();
      knockBack('A FILE CAME IN AS A NEW COMMISSION');rebuild();
    }catch(e){fail(e);}
  };
  r.readAsText(f);
}
/* ── a picture becomes a wave, and the wave is the picture ──────────────────
   The outline is traced once (tools/probe-wave.mjs measures the same function
   headlessly) and cached; the P dial only re-runs the harmonic fit, so dragging
   it costs a millisecond instead of a contour trace. */
function traceImage(f,bmp){
  const c=document.createElement('canvas');
  c.width=bmp.width;c.height=bmp.height;
  const g=c.getContext('2d',{willReadFrequently:true});
  g.drawImage(bmp,0,0);
  const d=g.getImageData(0,0,c.width,c.height);
  return waveContour({rgba:d.data,width:c.width,height:c.height,name:f.name});
}
function loadImageFile(f){
  if(!f)return;
  createImageBitmap(f).then(bmp=>{
    const contour=traceImage(f,bmp);
    APP.file={kind:'image',name:f.name,contour,size:bmp.width+'×'+bmp.height};
    APP.srcId='file';deriveFile();
    knockBack('A PICTURE CAME IN AS A NEW COMMISSION');rebuild();
  }).catch(fail);
}
function audioCtx(){
  if(!APP.actx)APP.actx=new (window.AudioContext||window.webkitAudioContext)();
  return APP.actx;
}
function loadAudioFile(f){
  if(!f)return;
  const r=new FileReader();
  r.onload=()=>{
    audioCtx().decodeAudioData(r.result).then(buf=>{
      const ch=buf.numberOfChannels,n=buf.length,mix=new Float64Array(n);
      for(let c=0;c<ch;c++){
        const d=buf.getChannelData(c);
        for(let i=0;i<n;i++)mix[i]+=d[i]/ch;
      }
      const raw=waveAudio({samples:mix,sr:buf.sampleRate,name:f.name});
      APP.file={kind:'audio',name:f.name,rec:prepRecord(raw),meta:raw.wave,size:ch+'ch'};
      APP.srcId='file';deriveFile();
      knockBack('A SOUND CAME IN AS A NEW COMMISSION');rebuild();
    }).catch(()=>fail(new Error('cannot decode '+f.name+' as audio')));
  };
  r.readAsArrayBuffer(f);
}
function loadFile(f){
  if(!f)return;
  const kind=fileKind(f);
  if(kind==='image')loadImageFile(f);
  else if(kind==='audio')loadAudioFile(f);
  else loadTextFile(f);
}
/* ── build ───────────────────────────────────────────────────────────────── */
function buildField(){
  if(!APP.rec){APP.field=null;return;}
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
  APP.rng=mulberry32(APP.seed^0x9e3779b9);
  APP.S=w.init(M,M,APP.field,APP.rng,APP.pw);
  /* the drive has been turning while you were at the counter: a freshly
     mounted plate does not arrive as a blank board, or the first thing the
     operator sees is an empty sheet and no way to tell it from a broken one */
  const warm=(w.id==='grav')?40:120;
  for(let i=0;i<warm;i++)safe(()=>w.step(APP.S,APP.field,APP.pw));
  gen=warm;
  APP.histN=0;
  APP.scopeN=0;AUDIO.lastIndex=-1;
  APP.V=safe(()=>w.view(APP.S),null);        /* the same buffers, kept for the app */
  liveN=safe(()=>w.stats(APP.S),0)||0;
  tickClock=performance.now();
  recordPopulation();
}
function rebuild(){
  try{
    buildField();
    startWorld();
    paint();
  }catch(e){fail(e);}
}
function recordPopulation(){
  APP.hist[APP.histN%APP.hist.length]=liveN;
  APP.histN++;
  recordScopePoint();
  APP.feedback=APP.wrldId==='life'&&APP.rec&&APP.S?lifeFeedback(APP.rec,APP.S):null;
  AUDIO.lastIndex=-1;
}
function scopeStride(rec){return rec&&rec.re?Math.max(1,Math.round(rec.re.length/360)):1;}
function scopeIndex(rec){return rec&&rec.re?(Math.floor(rec.re.length*APP.scopeOffset/100)+gen*scopeStride(rec))%rec.re.length:-1;}
function recordScopePoint(){
  const value=APP.wrldId==='synch'&&APP.S?APP.S.order:liveN/Math.max(1,M*M);
  APP.scopeHist[APP.scopeN%APP.scopeHist.length]=clamp(value,0,1);APP.scopeN++;
}
/* Upstream sonification, operated by the listening bench. Both instruments
   follow one sample cursor. Display gain/offset never change the record. */
const AUDIO={ctx:null,enabled:false,mode:'tone',volume:.65,lastIndex:-1,
  lastMode:'',lastVolume:-1,reading:{}};
function stopAudio(){
  const ctx=AUDIO.ctx;AUDIO.ctx=null;AUDIO.enabled=false;AUDIO.lastIndex=-1;
  if(ctx)ctx.close().catch(()=>{});
  ROOMVIEW.say('Sound stopped. Loudness ← amplitude; pitch ← phase rotation; stereo ← complex phase.');
}
function startAudio(){
  if(AUDIO.enabled)return;
  if(!APP.rec||!APP.rec.re){ROOMVIEW.say('Choose a record or bring a file to hear its waveform.');return;}
  const AudioCtor=window.AudioContext||window.webkitAudioContext;
  if(!AudioCtor){ROOMVIEW.say('This browser does not support Web Audio.');return;}
  try{
    const ctx=new AudioCtor();AUDIO.ctx=ctx;
    const fund=ctx.createOscillator(),harm=ctx.createOscillator();
    const g1=ctx.createGain(),g2=ctx.createGain(),filter=ctx.createBiquadFilter();
    const pan=ctx.createStereoPanner?ctx.createStereoPanner():null,master=ctx.createGain();
    fund.type='sine';harm.type='triangle';g1.gain.value=.82;g2.gain.value=.18;
    filter.type='lowpass';filter.Q.value=.7;master.gain.value=0;
    fund.connect(g1);harm.connect(g2);g1.connect(filter);g2.connect(filter);
    if(pan){filter.connect(pan);pan.connect(master);}else filter.connect(master);
    master.connect(ctx.destination);fund.start();harm.start();
    Object.assign(AUDIO,{fund,harm,filter,pan,master,enabled:true,lastIndex:-1});
    playing=true;
    ctx.resume().then(()=>{if(AUDIO.ctx===ctx)updateAudio(true);})
      .catch(e=>{if(AUDIO.ctx===ctx){stopAudio();ROOMVIEW.say('Audio could not start: '+e.message);}});
  }catch(e){stopAudio();ROOMVIEW.say('Audio could not start: '+e.message);}
}
function updateAudio(force){
  if(!AUDIO.enabled||!AUDIO.ctx)return;
  const a=AUDIO,now=a.ctx.currentTime,rec=APP.rec&&APP.rec.re?APP.rec:null;
  if(!playing||speed<=0||!rec){
    if(a.lastIndex!==-2){a.master.gain.setTargetAtTime(0,now,.025);a.lastIndex=-2;}return;
  }
  const index=scopeIndex(rec);
  if(!force&&index===a.lastIndex&&a.lastMode===a.mode&&a.lastVolume===a.volume)return;
  const v=APP.feedback?sonifyLifeFrame(rec,APP.feedback,index,a.mode,a.reading):sonifyFrame(rec,index,a.mode,a.reading);
  a.fund.frequency.setTargetAtTime(v.pitch,now,.035);
  a.harm.frequency.setTargetAtTime(v.pitch*2,now,.035);
  a.filter.frequency.setTargetAtTime(400+4200*v.brightness,now,.06);
  if(a.pan)a.pan.pan.setTargetAtTime(v.pan,now,.08);
  a.master.gain.setTargetAtTime(a.volume*(.003+.45*Math.pow(v.level,.85)),now,.07);
  a.lastIndex=index;a.lastMode=a.mode;a.lastVolume=a.volume;
  ROOMVIEW.say((a.mode==='music'?'PHASE MUSIC':'STRAIN TONE')+' · '+Math.round(v.pitch)+
    ' Hz audible · amplitude '+Math.round(v.level*100)+'% · intentional sonification');
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

/* ── the shop floor ──────────────────────────────────────────────────────────
   A print shop is not a panel of settings; it is a sequence with consequences,
   and the consequences are now carried by the machine itself. Work arrives at
   the counter, the press is MADE READY, a proof is pulled and approved, and
   only then does the edition run. Nothing in this file draws: the operator's
   hands are in w-shop.js, and this is the ledger of what the floor has done.
   The only thing the sheet is allowed to know about the state below is which
   of the three modes it is printed in — a makeready sheet is scrap and says so,
   a proof carries every mark the operator needs to judge it, and an approved
   edition sheet is trimmed clean. You learn what the marks are for by watching
   them be taken away.                                                     */
const SHOP={ state:'makeready', job:1, N:8, n:1, pulled:[] };
const SHEET_MODE={makeready:'makeready',proof:'proof',run:'edition',done:'edition'};
/* every message the floor has to give is a slip of paper coming out of the
   machine, so the app has no channel for text other than the shop's own tape */
function shopSay(t,tone){
  if(typeof SHOPVIEW!=='undefined'&&SHOPVIEW.say)SHOPVIEW.say(t,tone||TC.black);
}
/* Registration is the operator's own work on the three pins, and the pin is the
   instrument, so the press has no registration setting: it asks the shop, every
   frame, how far out each plate is and prints exactly that. */
function pressSlip(){
  return (typeof SHOPVIEW!=='undefined'&&SHOPVIEW.slip)?SHOPVIEW.slip():1;
}
/* the sheet's own registration error in device px: the renderer's own function,
   which reads R.slipScale — the three plate slips the shop's pins are holding.
   Never name a function here measuredSlip: the renderer already owns that name
   on the page, and a second declaration would overwrite it and recurse. */
function pressSlipErr(){ return (typeof measuredSlip==='function')?measuredSlip():0; }
/* Changing what the job IS voids the proof lying on the table — the press is no
   longer set up for the thing that was approved, so the sheet comes off the pile
   and goes in the bin. It costs a proof and never the sheets already delivered:
   SHOP.n is not rewound, so re-approving resumes the edition where it stopped. */
function knockBack(why){
  if(SHOP.state==='makeready')return;
  const last=SHOP.pulled[SHOP.pulled.length-1];
  if(last&&last.kind==='proof'){
    SHOP.pulled.pop();
    if(typeof SHOPVIEW!=='undefined'&&SHOPVIEW.deliver)SHOPVIEW.deliver('void');
  }
  SHOP.state='makeready';
  shopSay(why+' — THE PROOF IS VOID');
}
/* Each pull advances the paper: a new seed means a new registration slip, a new
   dot phase and a new grain, so two sheets of one edition are two impressions
   of the same plates and not one picture shown twice. */
function advancePaper(){ APP.seed=(APP.seed+1)|0; }
/* A delivered sheet carries no machine on it: the sheet is drawn on its own over
   the stage, read back, and the press paints itself over it again next frame. */
function sheetSnap(maxPx){
  if(!APP.field||!(typeof R!=='undefined'&&R.side>0))return '';
  try{
    drawStage(APP.V,APP.field,APP.sheetOpts||{});
    return snapshotSheet(maxPx);
  }catch(e){return '';}
}
function addSheet(kind){
  const url=sheetSnap(158);
  if(!url)return;
  SHOP.pulled.push({kind:kind,url:url,job:SHOP.job,n:SHOP.n,N:SHOP.N,
    plate:(APP.field&&APP.field.label)||'—',law:(APP.world&&APP.world.label)||'—',
    seed:APP.seed,gen:gen,reg:pressSlipErr()});
  if(typeof SHOPVIEW!=='undefined'&&SHOPVIEW.deliver)SHOPVIEW.deliver(kind);
}
function newJob(){
  SHOP.job++;SHOP.n=1;SHOP.pulled.length=0;SHOP.state='makeready';
  APP.seed=(APP.seed+1)|0;
  if(typeof SHOPVIEW!=='undefined'&&SHOPVIEW.deliver)SHOPVIEW.deliver('clear');
  shopSay('JOB '+String(SHOP.job).padStart(3,'0')+' ON THE COUNTER');
  rebuild();
}
/* The lever is the only thing in the shop that makes a sheet exist, and what it
   does depends on where the job has got to: it pulls a proof, it approves the
   proof and lets the drive in, it pulls the next sheet of the edition, and when
   the run is delivered it takes the next commission off the counter. */
function pull(){
  const st=SHOP.state;
  if(st==='makeready'){
    /* a proof is pulled from a stopped press so it can actually be read */
    SHOP.state='proof';playing=false;
    paint();addSheet('proof');
    shopSay('PROOF PULLED AT GEN '+gen+' — read it, then approve it or change something');
  }else if(st==='proof'){
    SHOP.state='run';playing=true;
    shopSay('PROOF APPROVED — running the edition of '+SHOP.N+', drive in');
  }else if(st==='run'){
    paint();addSheet('edition');
    SHOP.n++;advancePaper();
    if(SHOP.n>SHOP.N){SHOP.state='done';shopSay('RUN COMPLETE — '+SHOP.N+' SHEETS DELIVERED');}
  }else{ newJob();paint();return; }
  paint();
}
/* ── the machine's own API ───────────────────────────────────────────────────
   Everything the furniture drawn on the canvas is allowed to ask the press to
   do. There is no other way in: the pins, the keys, the cams, the wheels, the
   throttle, the clutch, the lever and the feed board all call through here, so
   the whole interface is exactly this list.                                */
const API={
  /* -- the plate on the cylinder ------------------------------------------ */
  fields(){ return (typeof FIELDS!=='undefined')?FIELDS.map(f=>({id:f.id,label:f.label})):[]; },
  fieldParams(){
    const f=fieldById(APP.fldId),out=[];
    if(!f||!f.params)return out;
    for(const q of f.params){
      if(APP.par.field[q.key]===undefined)APP.par.field[q.key]=q.def;
      out.push({key:q.key,label:q.label,value:APP.par.field[q.key],
        min:q.min,max:q.max,step:q.step,options:q.options});
    }
    return out;
  },
  setField(id){
    if(!id||APP.fldId===id)return;
    APP.fldId=id;knockBack('A NEW PLATE WENT ON THE CYLINDER');rebuild();
  },
  setFieldParam(key,v){
    const f=fieldById(APP.fldId);
    if(!f||!f.params)return;
    const q=f.params.filter(x=>x.key===key)[0];
    if(!q)return;
    APP.par.field[key]=v;knockBack('THE PLATE WAS RE-CUT');rebuild();
  },
  /* -- the law on the drive shaft ----------------------------------------- */
  worlds(){ return (typeof WORLDS!=='undefined')?WORLDS.map(w=>({id:w.id,label:w.label})):[]; },
  worldParams(){
    const w=worldById(APP.wrldId),out=[];
    if(!w||!w.params)return out;
    const store=APP.par.worlds[w.id]||(APP.par.worlds[w.id]={});
    for(const q of w.params){
      if(store[q.key]===undefined)store[q.key]=q.def;
      out.push({key:q.key,label:q.label,value:store[q.key],
        min:q.min,max:q.max,step:q.step,options:q.options});
    }
    return out;
  },
  setWorld(id){
    if(!id||APP.wrldId===id)return;
    APP.wrldId=id;knockBack('THE LAW ON THE SHAFT CHANGED');
    startWorld();paint();
  },
  setWorldParam(key,v){
    const w=worldById(APP.wrldId);
    if(!w||!w.params)return;
    const store=APP.par.worlds[w.id]||(APP.par.worlds[w.id]={});
    store[key]=v;knockBack('THE LAW WAS RE-SET');
  },
  /* -- the stock on the feed board ---------------------------------------- */
  setSource(id){ setSource(id); },
  loadStock(f){ if(f)loadFile(f); },
  setInkKey(i,v){
    const n=clamp(v,0,1);if(n===SHV.key[i])return;
    SHV.key[i]=n;
    if(R.inkKey)R.inkKey[i]=.30+1.10*n;
    knockBack('THE INK COVERAGE WAS CHANGED');
  },
  sourceCount(){ return 3; },
  /* -- the harmonics plug: it exists only while an image is on the feed ---- */
  hasHarmonics(){ return !!(APP.srcId==='file'&&APP.file&&APP.file.kind==='image'&&APP.wmeta&&
    APP.wmeta.kind==='image'); },
  harmonics(){ return APP.waveP; },
  setHarmonics(v){
    const n=clamp(Math.round(v),1,1023);
    if(n===APP.waveP)return;
    APP.waveP=n;
    knockBack('THE COMMISSION WAS RE-CUT');
    if(APP.srcId==='file'&&APP.file&&APP.file.kind==='image'){deriveFile();rebuild();}
  },
  /* -- the drive side ----------------------------------------------------- */
  setSpeed(v){ const n=clamp(v,1,60); if(Math.round(n)!==Math.round(speed))speed=n; },
  hold(down){ playing=!!down; },
  inch(n){
    if(!APP.world||!APP.S)return;
    n=(n|0)||1;
    for(let i=0;i<n;i++){
      decaySpark();
      try{APP.world.step(APP.S,APP.field,APP.pw);}catch(e){fail(e);break;}
      gen++;
    }
    liveN=safe(()=>APP.world.stats(APP.S),liveN)||0;
    recordPopulation();
    paint();
  },
  setSpark(v){ R.sparkBudget=clamp(Math.round(v),0,40); },
  setN(v){ SHOP.N=clamp(Math.round(v),1,24); },
  setM(v){
    const n=clamp(Math.round(v),16,120);
    if(n===M)return;
    Muser=true;M=n;setM(M);
    knockBack('THE IMPRESSION CHANGED');
    rebuild();
  },
  /* -- the lever ---------------------------------------------------------- */
  pull(){ pull(); },
  discard(i){
    if(!SHOP.pulled.length)return;
    const k=(i==null)?SHOP.pulled.length-1:clamp(i|0,0,SHOP.pulled.length-1);
    SHOP.pulled.splice(k,1);
    if(typeof SHOPVIEW!=='undefined'&&SHOPVIEW.deliver)SHOPVIEW.deliver('clear');
  },
  shake(p){ doShake(p); },
  say(t,tone){ if(typeof SHOPVIEW!=='undefined'&&SHOPVIEW.say)SHOPVIEW.say(t,tone); }
};

/* ── the shake ───────────────────────────────────────────────────────────────
   The audience-facing interaction, and it is a physical one: grab the frame of
   the machine and shake it. shake() is a pure function of the world's state,
   the field and power, driven by the world's own seeded generator, so the same
   gesture on the same board replays exactly. It returns one line of measured
   numbers describing what the kick did as it landed — never a recovery time,
   which cannot exist yet at the moment it returns. */
function doShake(power){
  const w=APP.world;
  if(!w||!APP.S||!APP.field)return '';
  if(typeof w.shake!=='function'){
    if(typeof SHOPVIEW!=='undefined'&&SHOPVIEW.say)
      SHOPVIEW.say('NO SHAKE FOR '+w.label,TC.pink);
    return '';
  }
  let msg;
  try{msg=w.shake(APP.S,APP.field,clamp(power,0,1));}catch(e){fail(e);return '';}
  if(lastErr)return '';
  APP.lastShake=msg||'';
  if(typeof SHOPVIEW!=='undefined'&&SHOPVIEW.say)
    SHOPVIEW.say(msg||('KNOCK '+clamp(power,0,1).toFixed(2)),TC.black);
  liveN=safe(()=>w.stats(APP.S),liveN)||0;
  recordPopulation();
  paint();
  return APP.lastShake;
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
  APP.gen=gen;          /* the edition stamp prints the generation it pulled at */
  /* the press is only as registered as the operator has made it, and what the
     sheet carries is decided by where the job has got to — not by a setting */
  R.slipScale=pressSlip();
  APP.sheetOpts={dead:!!(V&&liveN===0&&gen>2),
    what:APP.world?APP.world.label:'',size:M,
    mode:SHEET_MODE[SHOP.state]||'proof',
    edition:{n:Math.min(SHOP.n,SHOP.N),N:SHOP.N}};
  if(ROOMVIEW.mode==='press'){
    SHOPVIEW.paint(V,APP.field,APP.sheetOpts);
    ROOMVIEW.back(stageCtx());
  }else ROOMVIEW.paint(V,APP.field,APP.sheetOpts);
}
function frame(){
  const now=performance.now();
  const dt=Math.min(0.05,(now-lastT)/1000);lastT=now;
  R.clock=now/1000;
  if(playing&&APP.world&&APP.S){
    /* The press runs on a clock, not on the display's permission. A hidden or
       throttled pane fires this interval once a second, and an accumulator that
       adds a CLAMPED delta then never reaches one whole generation: the drive
       is engaged, the clock is moving, and the sheet stays blank. Generations
       are therefore counted off the wall clock, so the edition runs at the
       speed the throttle asks for whatever the pane is doing. */
    const due=1000/Math.max(1,speed);
    let steps=Math.floor((now-tickClock)/due);
    if(steps>0){
      if(steps>120){steps=120;tickClock=now;}
      else tickClock+=steps*due;
      for(let i=0;i<steps;i++){
        decaySpark();
        try{APP.world.step(APP.S,APP.field,APP.pw);}
        catch(e){playing=false;fail(e);break;}
        gen++;
      }
      liveN=safe(()=>APP.world.stats(APP.S),liveN)||0;
      recordPopulation();
    }
  }else tickClock=now;
  /* the machine is painted every frame whatever the world is doing: springs
     settle, the flywheel coasts and the lever thumps back on its own time */
  if(typeof SHOPVIEW!=='undefined'&&SHOPVIEW.tick)SHOPVIEW.tick(dt);
  updateAudio(false);
  paint();
}
/* the impression the window can afford, in cards: the old rail-and-console
   layout is gone, so the sheet takes the whole window and M follows it */
function autoM(){
  const G=(typeof SHOPVIEW!=='undefined'&&SHOPVIEW.geometry)?SHOPVIEW.geometry():null;
  const side=(G&&G.side)?G.side:Math.min(window.innerWidth,window.innerHeight);
  return clamp(Math.round(side/11/4)*4,16,120);
}
/* ── boot ────────────────────────────────────────────────────────────────── */
(function boot(){
  try{
    const homeLink=document.getElementById('life-home-link');
    if(homeLink&&window.location.protocol==='file:')
      homeLink.href=window.location.pathname.endsWith('/shell.html')
        ?'../site/index.html':'../../site/index.html';
    /* the worlds have finished pushing the colours they invent, so the press
       can align the whole palette to what it can actually print */
    snapPalette();
    if(typeof SHOPVIEW==='undefined'||!SHOPVIEW.init)
      throw new Error('w-shop.js did not load — no machine to stand at');
    SHOPVIEW.init();
    M=autoM();Muser=false;setM(M);
    /* Showcase links can start at the LIFE listening bench while the usual
       entrance still opens the room with its default world. */
    const entrance=new URLSearchParams(window.location.search);
    if(entrance.get('world')==='life'){
      APP.wrldId='life';
      APP.fldId='matrix'; // recurrence bands keep LIFE active through the warm-up
    }
    if(typeof prepRecord==='function'&&typeof GSFC!=='undefined')setSource('gsfc');
    else throw new Error('no record module: GSFC missing');
    if(entrance.get('station')==='scope')ROOMVIEW.enter('scope');
    shopSay('JOB 001 ON THE COUNTER — the plates are off register: bring the three pins home');
    /* Source intake loads directly; files placed on the press feed board remain
       physical stock until they are fed into the gripper. */
    const fa=document.getElementById('f_any');
    if(fa)fa.addEventListener('change',e=>{
      const f=e.target.files&&e.target.files[0],G=SHOPVIEW.geometry();
      if(f&&ROOMVIEW.mode==='stock')API.loadStock(f);
      else if(f&&G)SHOPVIEW.dropFiles([f],G.feed.x+G.feed.w*0.5,G.feed.y-G.s*16);
    });
    setInterval(frame,16);
    frame();
    window.addEventListener('resize',()=>{
      if(!Muser){const n=autoM();if(n!==M){M=n;setM(M);rebuild();}}
      else paint();
    });
  }catch(e){ fail(e); }
})();

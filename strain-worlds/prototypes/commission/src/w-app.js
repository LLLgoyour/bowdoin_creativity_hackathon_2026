/* ═══════════════════════════════════════════════════════════════════════════
   w-app.js — state, controls, loop. Owns everything the user touches.
   Timer-driven on purpose: requestAnimationFrame does not fire in a hidden or
   throttled pane, which is what made the previous iteration look frozen.
   ═══════════════════════════════════════════════════════════════════════════ */
const APP = {
  rec:null, field:null, world:null, S:null, pw:null, rng:null,
  /* the file source: APP.file is the file itself (kind, name, cached contour or
     record) and APP.wmeta the measured numbers of the wave it became */
  file:null, wmeta:null, waveP:48, actx:null,
  /* path + synch: measured as the only pair that stays occupied on every board
     size. At 24x24 synch holds its whole mask (454/270/250/67 cells live on
     path/matrix/spectro/hst) while life on path, whose 79%-dense mask is
     dominated by its boundary at that size, dies out within a few generations. */
  srcId:'gsfc', fldId:'path', wrldId:'synch', seed:20260919,
  par:{field:{}, worlds:{}}, hist:new Int32Array(420), histN:0
};
let M=52, Muser=false, speed=10, playing=true, gen=0, liveN=0,
    acc=0, lastT=performance.now(), lastErr='',
    shakeMsg='', shakeUntil=0, szT=0;

const $=id=>document.getElementById(id);
const safe=(fn,d)=>{try{return fn();}catch(e){return d;}};

function fail(e){
  lastErr=String((e&&e.message)||e);
  $('hudtxt').style.color='#ff8a7a';
  $('hudtxt').textContent='ERROR · '+lastErr;
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
  APP.srcId=id;
  if(id==='gsfc')APP.rec=recFromGSFC();
  else if(id==='noise')APP.rec=recFromNoise();
  else if(id==='file'&&APP.file)deriveFile();
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
      syncWaveRow();drawSourceChips();drawFieldChips();rebuild();
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
    syncWaveRow();drawSourceChips();drawFieldChips();rebuild();
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
      syncWaveRow();drawSourceChips();drawFieldChips();rebuild();
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
/* the measured numbers of the conversion, printed next to the dial */
function waveText(m){
  if(m.kind==='image')
    return 'traced the '+(m.invert?'light':'dark')+' side at level '+m.level.toFixed(4)+': '+m.loops+
      ' traversal'+(m.loops===1?'':'s')+', '+m.crossings+' crossings, resampled to '+m.points+
      ' points on a '+m.frame+' frame; the record is their '+m.P+' largest harmonics of '+m.maxP+
      ' — RMS '+m.rms.toFixed(3)+' px, max '+m.max.toFixed(3)+' px, silhouette IoU '+m.iou.toFixed(4);
  if(m.kind==='audio')
    return m.source+' samples at '+m.sr+' Hz box-averaged by '+m.factor+' onto '+m.points+' at '+
      m.rate.toFixed(1)+' Hz; the record is their analytic signal x + i·H(x)';
  return m.points+' '+m.columns+' samples read straight as the complex record';
}
function syncWaveRow(){
  const m=APP.wmeta,onFile=APP.srcId==='file',show=!!(onFile&&m&&m.kind==='image');
  $('wvrow').style.display=show?'flex':'none';
  if(show){$('r_harm').max=m.maxP;$('r_harm').value=m.P;$('o_harm').value=m.P;}
  $('wvnote').textContent=(onFile&&m)?waveText(m):'';
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
  APP.V=safe(()=>w.view(APP.S),null);        /* the same buffers, kept for the app */
  gen=0;liveN=safe(()=>w.stats(APP.S),0)||0;
  APP.histN=0;APP.hist.fill(0);
  APP.hist[0]=liveN;APP.histN=1;
}
function rebuild(){
  try{
    buildField();
    startWorld();
    drawRecordPanel(APP.rec&&APP.rec.re?APP.rec:null);
    drawFieldPanel(APP.field);
    drawParams();
    updateNotes();
    syncWaveRow();
    shakeMsg='';shakeUntil=0;APP.lastShake='';
    paint();
  }catch(e){fail(e);}
}
function reseed(){                       /* same record, same field, new seed */
  APP.seed=(APP.seed+1)|0;
  if(APP.srcId==='noise'&&APP.rec)APP.rec=recFromNoise();
  try{ if(APP.srcId==='noise')buildField(); startWorld(); paint(); }catch(e){fail(e);}
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
      for(let i=0;i<steps;i++){
        decaySpark();
        try{APP.world.step(APP.S,APP.field,APP.pw);}
        catch(e){playing=false;$('b_play').textContent='▶ play';fail(e);break;}
        gen++;
      }
      liveN=safe(()=>APP.world.stats(APP.S),liveN)||0;
      APP.hist[APP.histN%APP.hist.length]=liveN;APP.histN++;
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
  /* the third source is one chip whatever the file was: a file is a wave */
  if(APP.file)add('file','wave from file · '+(APP.file.name||'').slice(0,14));
  c.appendChild(chip(APP.file?'+ open another':'+ wave from file',false,()=>$('f_any').click()));
  c.appendChild(chip('+ trace an image',false,()=>$('f_img').click()));
}
function drawFieldChips(){
  const c=$('flds');c.innerHTML='';
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
  if(f&&f.params){
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
   The audience-facing interaction. shake() is a pure function of the world's
   state, the field and power, driven by the world's own seeded generator, so the
   same gesture on the same board replays exactly. It returns one line of
   measured numbers describing what the kick did as it landed — never a recovery
   time, which cannot exist yet at the moment it returns. */
function doShake(power){
  const w=APP.world;
  if(!w||!APP.S||!APP.field)return '';
  if(typeof w.shake!=='function'){
    shakeMsg='no shake for '+w.label;shakeUntil=performance.now()+2600;
    paint();return '';
  }
  let msg;
  try{msg=w.shake(APP.S,APP.field,clamp(power,0,1));}catch(e){fail(e);return '';}
  shakeUntil=performance.now()+2600;
  if(lastErr)return '';
  APP.lastShake=msg||'';
  shakeMsg=msg||('shake '+clamp(power,0,1).toFixed(2));
  paint();
  return APP.lastShake;
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
    doShake(1);
  });
}
function bindOnce(){
  $('f_any').addEventListener('change',e=>loadFile(e.target.files[0]));
  $('f_img').addEventListener('change',e=>loadImageFile(e.target.files[0]));
  window.addEventListener('dragover',e=>{e.preventDefault();});
  window.addEventListener('drop',e=>{
    e.preventDefault();
    const f=e.dataTransfer.files[0];if(!f)return;
    loadFile(f);                 /* picture, sound, or numbers: all waves */
  });
  const hr=$('r_harm');
  hr.addEventListener('input',()=>{
    APP.waveP=parseInt(hr.value,10);
    if(APP.srcId==='file'&&APP.file&&APP.file.kind==='image'){deriveFile();rebuild();}
    else $('o_harm').value=APP.waveP;
  });
  $('b_play').addEventListener('click',()=>{
    playing=!playing;$('b_play').textContent=playing?'⏸ pause':'▶ play';
  });
  $('b_step').addEventListener('click',()=>{
    if(!APP.world||!APP.S)return;
    try{decaySpark();APP.world.step(APP.S,APP.field,APP.pw);gen++;
      liveN=safe(()=>APP.world.stats(APP.S),liveN)||0;
      APP.hist[APP.histN%APP.hist.length]=liveN;APP.histN++;
      paint();}catch(e){fail(e);}
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

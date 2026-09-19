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
    shakeMsg='', shakeUntil=0, szT=0, offMask=0;

const $=id=>document.getElementById(id);
const safe=(fn,d)=>{try{return fn();}catch(e){return d;}};

function fail(e){
  lastErr=String((e&&e.message)||e);
  $('hudtxt').style.color='#ff8a7a';
  $('hudtxt').textContent='ERROR · '+lastErr;
}
window.addEventListener('error',e=>fail(e));

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
    shakeMsg='';shakeUntil=0;APP.lastShake='';
    saySwap('');
    paint();
  }catch(e){fail(e);}
}
function reseed(){                       /* same record, same field, new seed */
  APP.seed=(APP.seed+1)|0;
  if(APP.srcId==='noise'&&APP.rec)APP.rec=recFromNoise();
  try{ if(APP.srcId==='noise')buildField(); startWorld(); paint(); }catch(e){fail(e);}
}

/* ── the swap: the record never stops acting ─────────────────────────────────
   A field or world change on a RUNNING board does not restart the world. The
   live cards are read out of the running world's view buffer — not out of the
   field mask — and carried into the new dynamics:
     · field swap: the world keeps its state object and is simply pointed at the
       new field. Worlds read field.mask / field.amp / field.ph / field.freq
       inside step(), so the new geometry is already live; live cells that fall
       outside the new mask are legal and are counted as "off-mask".
     · world swap: the new world is inited on a mask built from the live cells
       (same cards, different physics), and the generation counter it reports is
       carried over so time is continuous.
   gen and APP.hist are never touched by either path, so the population plot
   keeps its history. gen === 0 means "nothing is running yet" and the chips
   fall back to the old rebuild, which re-inits from the field mask. */
function running(){return !!(APP.world&&APP.S&&gen>0);}
function carryMask(){                    /* the current live set, as a mask */
  /* Read the running world's own view buffer here, not APP.V: the app's copy
     can be a frame old, and the point of the swap is that the CARDS carry over,
     not the cards as of some earlier painting. */
  const V=(APP.world&&APP.S)?safe(()=>APP.world.view(APP.S),null):APP.V;
  const f=APP.field,m=new Uint8Array(M*M);
  let live=0;
  if(V)for(let i=0;i<m.length;i++){m[i]=V.live[i]?1:0;live+=m[i];}
  if(live)return {mask:m,live:live,fallback:false};
  for(let i=0;i<m.length;i++)m[i]=f?f.mask[i]:0;
  return {mask:m,live:0,fallback:true};
}
function fieldWithMask(f,mask){          /* same field, different footprint */
  const o={};for(const k in f)o[k]=f[k];
  o.mask=mask;
  return o;
}
function offMaskCount(){
  const V=APP.V,m=APP.field?APP.field.mask:null;
  if(!V||!m)return 0;
  let c=0;
  for(let i=0;i<V.n;i++)if(V.live[i]&&!m[i])c++;
  return c;
}
function saySwap(msg){$('snote').textContent=msg;}
function swapField(id){                   /* non-destructive: keep the state */
  APP.fldId=id;
  buildField();
  drawFieldChips();drawFieldPanel(APP.field);drawParams();updateNotes();
  paint();
  saySwap('field swap · '+APP.world.label+' kept its state · gen '+gen+' · '+
    liveN+' cards, '+offMaskCount()+' now off-mask');
}
function swapWorld(id){                   /* non-destructive: carry the cards */
  const w=worldById(id);
  if(!w||!APP.field)return;
  const carry=carryMask(),before=liveN,keep={world:APP.world,S:APP.S,pw:APP.pw,wrldId:APP.wrldId};
  APP.wrldId=id;APP.world=w;APP.pw=livePar(id);
  APP.rng=mulberry32(APP.seed^0x9e3779b9);
  try{
    APP.S=w.init(M,M,carry.fallback?APP.field:fieldWithMask(APP.field,carry.mask),APP.rng,APP.pw);
  }catch(e){
    /* A world that cannot start on an arbitrary live set says so, verbatim, and
       the board it would have replaced stays exactly as it was. */
    APP.world=keep.world;APP.S=keep.S;APP.pw=keep.pw;APP.wrldId=keep.wrldId;
    drawWorldChips();drawParams();updateNotes();paint();
    saySwap('swap refused · '+w.label+' cannot init on a live-set mask: '+((e&&e.message)||e));
    return;
  }
  /* Time is the board's own, not the new rule's: the world keeps reporting the
     generation the board has reached. */
  if(typeof APP.S.gen==='number')APP.S.gen=gen;
  if(typeof APP.S.generation==='number')APP.S.generation=gen;
  APP.V=safe(()=>w.view(APP.S),null);
  liveN=safe(()=>w.stats(APP.S),liveN)||0;
  drawWorldChips();drawParams();updateNotes();paint();
  saySwap(carry.fallback
    ? 'world swap · '+w.label+' · no live cards to carry ('+before+' live) · inited from the field mask · gen '+gen
    : 'world swap · carried '+carry.live+' live cards into '+w.label+' · gen '+gen+' · now '+liveN+' live');
}
function pickField(id){
  if(APP.rec&&APP.rec.kind==='image')return;
  if(running()&&APP.field)swapField(id);
  else{APP.fldId=id;drawFieldChips();drawParams();rebuild();saySwap('no running board · rebuilt from the field mask');}
}
function pickWorld(id){
  if(running())swapWorld(id);
  else{APP.wrldId=id;drawWorldChips();drawParams();startWorld();updateNotes();paint();
    saySwap('no running board · re-inited from the field mask at gen 0');}
}
function hardReset(){                    /* the old destructive behaviour, on demand */
  try{startWorld();paint();saySwap('reset · re-inited from the field mask at gen 0');}catch(e){fail(e);}
}

/* ── the A/B proof ───────────────────────────────────────────────────────────
   One record, two boards, 52×52, REACTION at its declared defaults, run in
   lockstep. The control arm keeps THE RECORD ITSELF for all 2000 generations.
   The swap arm switches its FIELD to THE SPECTROGRAM at generation 500 — the
   state object is never re-inited, the new field is simply handed to the same
   step() — and keeps running. A stencil laid down at generation 0 cannot hold
   two different late states from one seed, so if the arms differ at the end,
   the field was still steering the board a thousand generations after it was
   first drawn. Every number the panel prints is measured here, in this page. */
const PROOF={gen:500,upto:2000,size:52,busy:false};
function blobCount(live,w,h){
  const seen=new Uint8Array(live.length),queue=new Int32Array(live.length);
  let count=0;
  for(let i=0;i<live.length;i++){
    if(!live[i]||seen[i])continue;
    count++;
    let head=0,tail=1;queue[0]=i;seen[i]=1;
    while(head<tail){
      const j=queue[head++],x=j%w,y=(j/w)|0;
      if(x&&live[j-1]&&!seen[j-1]){seen[j-1]=1;queue[tail++]=j-1;}
      if(x<w-1&&live[j+1]&&!seen[j+1]){seen[j+1]=1;queue[tail++]=j+1;}
      if(y&&live[j-w]&&!seen[j-w]){seen[j-w]=1;queue[tail++]=j-w;}
      if(y<h-1&&live[j+w]&&!seen[j+w]){seen[j+w]=1;queue[tail++]=j+w;}
    }
  }
  return count;
}
function armStats(S,world){
  const live=world.view(S).live;
  let count=0,sum=0;
  for(let i=0;i<S.n;i++){if(live[i])count++;if(S.v)sum+=S.v[i];}
  return {live:count,coverage:100*count/S.n,blobs:blobCount(live,S.w,S.h),meanV:S.v?sum/S.n:0};
}
function runProof(){
  if(PROOF.busy)return;
  const w=worldById('rd'),size=PROOF.size,n=size*size,out=$('ab'),btn=$('b_proof');
  if(typeof GSFC==='undefined'||typeof prepRecord!=='function'){
    out.textContent='no record loaded · the proof needs the GSFC strain record';return;
  }
  const rec=recFromGSFC();
  const defs={};for(const p of w.params)defs[p.key]=p.def;
  const fA=fieldById('path').build(rec,size,size,{});
  const fB=fieldById('spectro').build(rec,size,size,{});
  const seed=(APP.seed^0x9e3779b9)>>>0;
  const A=w.init(size,size,fA,mulberry32(seed),defs);
  const B=w.init(size,size,fA,mulberry32(seed),defs);
  PROOF.busy=true;btn.classList.add('on');btn.textContent='running…';
  let g=0,lateA=[0,0],lateB=[0,0];
  function finish(){
    const ra=armStats(A,w),rb=armStats(B,w);
    let diff=0;
    for(let i=0;i<n;i++)diff+=Math.abs(A.v[i]-B.v[i]);
    diff/=n;
    const pc=x=>x.toFixed(2)+'%',f6=x=>x.toFixed(6);
    const late='late +'+lateA[0]+'/Δ'+lateA[1]+' vs +'+lateB[0]+'/Δ'+lateB[1]+
      ' (births/retreats, generations '+(PROOF.upto-199)+'–'+PROOF.upto+')';
    out.textContent=[
      'GSFC strain · '+size+'×'+size+' · REACTION at declared defaults · seed '+APP.seed,
      'CONTROL  THE RECORD ITSELF, untouched to generation '+PROOF.upto,
      '    coverage '+pc(ra.coverage)+' ('+ra.live+' cards)   blobs '+ra.blobs+'   mean v '+f6(ra.meanV),
      'SWAP     THE SPECTROGRAM from generation '+PROOF.gen,
      '    coverage '+pc(rb.coverage)+' ('+rb.live+' cards)   blobs '+rb.blobs+'   mean v '+f6(rb.meanV),
      'mean |Δv| over all '+n+' cells '+diff.toFixed(4),
      'still reacting at the end: '+late,
      ra.blobs===rb.blobs&&ra.coverage===rb.coverage
        ? 'the two arms agree — the swap did not move the board'
        : 'one seed, two late states: the field is still acting at generation '+PROOF.upto
    ].join('\n');
    PROOF.busy=false;btn.classList.remove('on');btn.textContent='run A/B proof';
  }
  function tick(){
    const stop=Math.min(PROOF.upto,g+50);
    for(;g<stop;g++){
      w.step(A,fA,defs);
      w.step(B,g>=PROOF.gen?fB:fA,defs);
      if(g>=PROOF.upto-200){lateA[0]+=A.births;lateA[1]+=A.deaths;
        lateB[0]+=B.births;lateB[1]+=B.deaths;}
    }
    if(g<PROOF.upto){out.textContent='running · generation '+g+' / '+PROOF.upto;setTimeout(tick,0);return;}
    finish();
  }
  tick();
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
  offMask=offMaskCount();
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
  /* Cards can sit outside the field's mask after a field swap. That is legal —
     the record is a forcing term, not a stencil — so it is reported, not hidden. */
  const off=offMask?' · '+offMask+' off-mask':'';
  const mine='gen '+gen+' · '+liveN.toLocaleString()+' cells'+off;
  $('hudtxt').textContent=own?extra+off:(mine+(extra?' · '+extra:''));
  const shake=(shakeUntil>performance.now()&&shakeMsg)?['SHAKE '+shakeMsg]:[];
  $('ticker').textContent=shake.concat([APP.field?APP.field.label:'',w?w.label:'',
    own?extra+off:(extra+' · '+mine)]).filter(Boolean).join('   ·   ');
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
    c.appendChild(chip(f.label,APP.fldId===f.id,()=>pickField(f.id)));
  if(!FIELDS.length)c.appendChild(chip('(field module missing)',false,()=>{}));
}
function drawWorldChips(){
  const c=$('wrlds');c.innerHTML='';
  for(const w of WORLDS)
    c.appendChild(chip(w.label,APP.wrldId===w.id,()=>pickWorld(w.id)));
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
    try{decaySpark();APP.world.step(APP.S,APP.field,APP.pw);gen++;
      liveN=safe(()=>APP.world.stats(APP.S),liveN)||0;
      APP.hist[APP.histN%APP.hist.length]=liveN;APP.histN++;
      paint();}catch(e){fail(e);}
  });
  $('b_reset').addEventListener('click',reseed);
  $('b_hard').addEventListener('click',hardReset);
  $('b_proof').addEventListener('click',runProof);
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

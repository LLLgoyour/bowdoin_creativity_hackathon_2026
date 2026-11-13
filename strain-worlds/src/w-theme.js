/* ═══════════════════════════════════════════════════════════════════════════
   w-theme.js — THE ROOM'S OWN TUNE. Not the live mapping (that is w-sonify.js
   and w-phrase.js, which print what the record is doing right now): this is a
   piece with a form, played by the room itself, and every instrument in it is
   an artifact standing on the floor.

   THE ENSEMBLE — one instrument per artifact, and the pan is where the artifact
   actually stands on the floor plan (shopLayout), so the stereo image is the
   room:
     THE RECORD          the lead, a whistle band-passed at twice the note
     THE PLATE           the pad, two triangles a few cents apart
     THE LAW             the bass, the tonic folded into 55..110 Hz
     THE PRESS           the platen gesture, on the drive side
     THE FEED BOARD      the sheet gesture, where the stock feeds in
     THE REGISTER PINS   the snap gesture, tuned to the tune's tonic
     THE THREE INKS      the three plate voices (a just major triad) + the slap
     THE DELIVERY PILE   the rustle, hard left where the pile is cropped
     THE TAPE            the tape tick, on the wall
     THE SPARE PLATES    the snap again, an octave above the pins
     THE BENCH           the master chain — glue, shelf, clip (see bench())
     THE ROOM            the plate-reverb bus inside w-synth.js

   EVERY NUMBER COMES FROM THE DATASETS. The tonic is the record's own pitch
   folded into the bass register; the tempo is one bar per turn of the record's
   phase, so the tune accelerates with the inspiral; the melody is the record's
   pitch quantised onto the five slots and it takes a breath whenever the record
   holds still; the bass line is the world's occupation; the pad's level and
   detune are the field's magnitude and phase; the pans are the floor plan.

   THE TUNE IS JUST INTONATION: 1/1 9/8 5/4 3/2 5/3, five slots to the octave,
   low integers only — the same five slots the plates already print, so the
   harmony cannot fight the instrument. There is no whole-tone scale in it.

   THE MASTER CHAIN, in this order and nothing else:
     sum → glue compressor 2:1, gentle, never more than 12 dB of reduction →
     high shelf −4 dB at 5.5 kHz → soft-clip waveshaper, oversampling OFF → out.
   bench() builds exactly that on its own, so its transfer can be measured
   without the tune playing through it.
   ═══════════════════════════════════════════════════════════════════════════ */
const THEME=(()=>{
const num=(v,d)=>(typeof v==='number'&&isFinite(v))?v:d;

/* ── §1 · every number the tune believes ─────────────────────────────────── */
const T={
  /* five slots to the octave, just intonation: 0 204 386 702 884 cents above
     the tonic. The steps are 204, 182, 316, 182, 316 — a pentatonic, not a
     whole-tone scale, and the third is 5/4 rather than 400 cents. */
  scale:[1,1.125,1.25,1.5,1.6666666666666667],
  scaleName:['1/1','9/8','5/4','3/2','5/3'],
  /* the lead: a pure carrier with its own second harmonic, the pair taken
     through a band at TWICE the note. That band is the whistle. No sawtooth, no
     resonant squeal, no breath layer of any kind — a whistle is a harmonic and
     not noise — and the lead sits well below the bass in level. */
  lead:{trim:.115,body:.5,harm:.5,bpQ:3.2,band:2,attack:.035,decay:1.3,rest:.75,
        level:.5,lo:165,hi:440},
  /* the bass: the tonic folded into the register a press is heard in, a sub
     octave under it and a triangle for the body, all behind one low band */
  bass:{lo:55,hi:110,trim:.42,sub:.62,body:.34,band:210,q:.7,attack:.012,
        release:.16,level:.5,fifth:3},
  /* the pad: the field through two triangles a few cents apart, mid band, with
     the slowest envelope on the floor because the field moves slowly */
  pad:{oct:2,trim:.16,detune:9,band:1250,q:.6,attack:1.6,level:.5,
       floor:.35,span:.65,width:.34},
  /* the harmony: the press's own three plates, a just major triad four octaves
     up so the tune and the instrument agree, held for a beat and a half */
  harmony:{oct:4,degrees:[0,2,4],brightness:.15,level:1,hold:3,pan:.12},
  /* the tempo: one bar is one turn of the record's own phase, four beats to the
     bar, clamped to the range a press can actually be operated at */
  tempo:{min:.30,max:1.20,fallback:.483},
  /* the bench: the glue is gentle and never takes more than 12 dB */
  glue:{threshold:-18,knee:6,ratio:2,attack:.012,release:.28},
  shelf:{frequency:5500,gain:-4},
  clip:{drive:1.15,samples:1024,oversample:'none'},
  fade:{in:.08,out:.12},
  quiet:.0008,
  /* the floor plan, in fractions of the layout width. Used only when the shop
     has not published its own layout (an offline render before boot). */
  place:{record:.5,field:.5,world:.5,press:.876,stock:.681,plates:.582,
         delivery:.039,tapes:.1855,wall:.2175,pins:.5,bench:.5,room:.5}
};

/* ── §2 · the arrangement ────────────────────────────────────────────────────
   One row per section; a bar is eight half-beats. The four sections are the
   record's own arc: the plates come up, the proof is pulled, the edition runs,
   then everything is on the floor at once. `lead` is 1 when the record's line
   may sing, `pad` is the section the field is heard in. */
const HIT={platen:1,sheet:2,pins:4,ink:8,harmony:16,delivery:32,tape:64,wall:128};
const FORM=[
  {name:'MAKEREADY',bars:4,lead:0,
   hits:{platen:[0,4],pins:[0]},bass:[0,4]},
  {name:'PROOF',bars:4,lead:1,
   hits:{platen:[0,4],pins:[0],sheet:[3,6]},bass:[0,2,4,6]},
  {name:'EDITION',bars:4,lead:1,
   hits:{platen:[0,4],pins:[0],sheet:[3,6],ink:[4],harmony:[4],delivery:[7]},
   bass:[0,2,4,6]},
  {name:'DELIVERY',bars:4,lead:1,
   hits:{platen:[0,2,4,6],pins:[0],sheet:[3,6],ink:[4],harmony:[4],delivery:[7],
         tape:[5],wall:[2,6]},
   bass:[0,1,2,3,4,5,6,7]}
];
const BARS=FORM.reduce((n,f)=>n+f.bars,0);
const UNITS=BARS*8;                    /* half-beats in the whole form */
const SCORE=new Uint8Array(UNITS);     /* what is struck, by half-beat */
const LINE=new Uint8Array(UNITS);      /* the bass line: bit 1 beat, bit 4 sub */
const SECTION=new Uint8Array(BARS),LEAD=new Uint8Array(BARS);
(function arrange(){
  let bar=0;
  for(let s=0;s<FORM.length;s++){
    const f=FORM[s];
    for(let b=0;b<f.bars;b++,bar++){
      SECTION[bar]=s;LEAD[bar]=f.lead?1:0;
      for(const name in f.hits){
        const bit=HIT[name];if(!bit)continue;
        const at=f.hits[name];
        for(let k=0;k<at.length;k++)SCORE[bar*8+(at[k]|0)]|=bit;
      }
      for(let k=0;k<f.bass.length;k++)LINE[bar*8+(f.bass[k]|0)]|=1;
      LINE[bar*8]|=4;                  /* the sub octave answers the downbeat */
    }
  }
})();
const SECTION_NAME=FORM.map(f=>f.name);

/* ── §3 · the tune over the record ───────────────────────────────────────────
   Pure and allocation-free: fold a pitch into a register, quantise a pitch onto
   the five slots, and read the tempo the record asks for. */
function fold(hz,lo,hi){
  if(!(hz>0))return 0;
  let v=hz,k=0;
  while(v<lo&&k++<64)v*=2;
  while(v>=hi&&k++<64)v/=2;
  return v;
}
function slotOfSlot(slot){return ((slot%5)+5)%5;}
function slotOf(hz,tonic){
  if(!(hz>0)||!(tonic>0))return 0;
  return ((Math.round(Math.log(hz/tonic)/Math.LN2*5)%5)+5)%5;
}
function slotHz(tonic,slot){
  const d=slotOfSlot(slot),o=(slot-d)/5;
  return tonic*T.scale[d]*Math.pow(2,o);
}
function slotName(slot){return T.scaleName[slotOfSlot(slot)];}
/* the tempo the record asks for: one bar per turn of its own phase. The drive
   walks `stride` samples per generation at `speed` generations a second, so a
   turn takes (samples / turns) / (stride * speed) seconds. */
function tempoFor(rec,stride,speed){
  const len=rec&&rec.re?rec.re.length:0,turns=rec&&rec.turns>0?rec.turns:0;
  const st=Math.max(1,stride||1),sp=Math.max(1e-3,speed||1);
  const turn=(len>0&&turns>0)?(len/turns)/(st*sp):0;
  return {turn:turn,beat:clamp(turn>0?turn/4:T.tempo.fallback,T.tempo.min,T.tempo.max)};
}

/* ── §4 · the bench: the master chain, and nothing else ──────────────────────
   Sum in, glue, shelf, soft clip, out — built on its own so it can be measured
   on its own. create() feeds the whole floor through these same nodes. */
function softCurve(drive,samples){
  const n=Math.max(64,samples|0),c=new Float32Array(n),k=1/Math.tanh(drive);
  for(let i=0;i<n;i++)c[i]=Math.tanh(drive*(i/(n-1)*2-1))*k;
  return c;
}
function bench(ctx,opts){
  const o=opts||{};
  const input=ctx.createGain(),output=ctx.createGain();
  input.gain.value=1;output.gain.value=1;
  let glue=null;
  if(typeof ctx.createDynamicsCompressor==='function'&&o.glue!==false){
    glue=ctx.createDynamicsCompressor();
    glue.threshold.value=num(o.threshold,T.glue.threshold);
    glue.knee.value=T.glue.knee;glue.ratio.value=T.glue.ratio;
    glue.attack.value=T.glue.attack;glue.release.value=T.glue.release;
  }
  /* then the shelf, then the soft clip. The curve has no corner in it at any
     level, so the output can leave the machine without a hard edge; oversampling
     stays off because the curve is already smooth and nothing else in this app
     oversamples. */
  const shelf=ctx.createBiquadFilter();
  shelf.type='highshelf';shelf.frequency.value=T.shelf.frequency;
  shelf.gain.value=num(o.shelf,T.shelf.gain);
  const clip=ctx.createWaveShaper();
  clip.curve=softCurve(T.clip.drive,T.clip.samples);
  clip.oversample=T.clip.oversample;
  if(glue){input.connect(glue);glue.connect(shelf);}else input.connect(shelf);
  shelf.connect(clip);clip.connect(output);
  return {input:input,glue:glue,shelf:shelf,clip:clip,output:output};
}

/* ── §5 · the tune itself ────────────────────────────────────────────────────
   The transport runs on the instrument's own clock: live, the context is the
   clock; offline, the clock is the sum of the frame steps the caller schedules,
   so a render is reproducible. Nothing in step() allocates. */
function create(ctx,opts){
  const o=opts||{};
  const offline=typeof ctx.startRendering==='function';
  const board=bench(ctx,o);
  const master=ctx.createGain();
  const masterLevel=clamp(num(o.master,.65),0,1);
  master.gain.value=0;
  board.output.connect(master);master.connect(o.out||ctx.destination);
  const space=clamp(num(o.space,.38),0,1),character=clamp(num(o.character,.5),0,1);

  /* ── the press's own instrument lands on the bench's input instead of the
     speakers: its plates are the harmony and its gestures are the percussion,
     and both keep the dials the bench already has */
  const synth=(typeof SYNTH!=='undefined'&&SYNTH.create)
    ?SYNTH.create(ctx,{master:1,space:space,character:character,out:board.input}) : null;
  const HITS=(typeof SYNTH!=='undefined'&&SYNTH.HITS)?SYNTH.HITS:[];
  function inHits(name){
    for(let i=0;i<HITS.length;i++)if(HITS[i]===name)return true;
    return false;
  }

  /* ── the floor plan: every pan is where that artifact actually stands */
  const G=L_from(o.layout);
  const W=G?num(G.W,1560):1560;
  function at(frac){return clamp(frac*2-1,-1,1);}
  function where(id){
    const p=T.place[id];
    if(G){
      if(id==='press'&&G.cyl)return at((G.cyl.x+G.cyl.w*0.5)/W);
      if(id==='stock'&&G.feed)return at((G.feed.x+G.feed.w*0.5)/W);
      if(id==='plates'&&G.ducts)return at((G.ducts.x+G.ducts.w*0.5)/W);
      if(id==='delivery'&&G.delivery)return at((G.delivery.x+G.delivery.w*0.5)/W);
      if(id==='tapes'&&G.tape)return at((G.tape.x+G.tape.w*0.5)/W);
      if(id==='wall'&&G.wall)return at((G.wall.x+G.wall.w*0.5)/W);
    }
    return at(p);
  }
  const ENSEMBLE=[
    {id:'record',label:'THE RECORD',inst:'LEAD WHISTLE AT 2x'},
    {id:'field',label:'THE PLATE',inst:'PAD'},
    {id:'world',label:'THE LAW',inst:'BASS'},
    {id:'press',label:'THE PRESS',inst:'PLATEN'},
    {id:'stock',label:'THE FEED BOARD',inst:'SHEET'},
    {id:'pins',label:'THE REGISTER PINS',inst:'SNAP IN KEY'},
    {id:'plates',label:'THE THREE INKS',inst:'JUST TRIAD + SLAP'},
    {id:'delivery',label:'THE DELIVERY PILE',inst:'RUSTLE'},
    {id:'tapes',label:'THE TAPE',inst:'PAPER TICK'},
    {id:'wall',label:'THE SPARE PLATES',inst:'SNAP AT 2x'},
    {id:'bench',label:'THE BENCH',inst:'GLUE · SHELF · CLIP'},
    {id:'room',label:'THE ROOM',inst:'PLATE REVERB'}
  ];
  for(let i=0;i<ENSEMBLE.length;i++)ENSEMBLE[i].pan=where(ENSEMBLE[i].id);

  const osc=(type)=>{const n=ctx.createOscillator();n.type=type;n.frequency.value=220;n.start();return n;};
  const gain=(v)=>{const n=ctx.createGain();n.gain.value=v;return n;};
  const panner=(v)=>{
    if(ctx.createStereoPanner){const n=ctx.createStereoPanner();n.pan.value=clamp(v,-1,1);return n;}
    return gain(1);
  };

  /* ── THE RECORD · the lead. A sine at the note and a triangle at exactly
     twice it, together through a band at twice the note: the band is the
     whistle. The two source gains are fixed for the life of the piece — the
     note envelope is the only thing that moves. */
  const lead=osc('sine'),lead2=osc('triangle');
  const leadBody=gain(T.lead.body),leadHarm=gain(T.lead.harm);
  const leadBP=ctx.createBiquadFilter();
  leadBP.type='bandpass';leadBP.frequency.value=880;leadBP.Q.value=T.lead.bpQ;
  const leadEnv=gain(0),leadTrim=gain(T.lead.trim),leadPan=panner(ENSEMBLE[0].pan);
  lead.connect(leadBody);lead2.connect(leadHarm);
  leadBody.connect(leadBP);leadHarm.connect(leadBP);
  leadBP.connect(leadEnv);leadEnv.connect(leadTrim);leadTrim.connect(leadPan);
  leadPan.connect(board.input);

  /* ── THE LAW · the bass. Tonic, sub octave and body behind one low band */
  const bassA=osc('sine'),bassSub=osc('sine'),bassBody=osc('triangle');
  const bassSubG=gain(T.bass.sub),bassBodyG=gain(T.bass.body);
  const bassLP=ctx.createBiquadFilter();
  bassLP.type='lowpass';bassLP.frequency.value=T.bass.band;bassLP.Q.value=T.bass.q;
  const bassEnv=gain(0),bassTrim=gain(T.bass.trim),bassPan=panner(ENSEMBLE[2].pan);
  bassA.connect(bassEnv);bassSub.connect(bassSubG);bassBody.connect(bassBodyG);
  bassSubG.connect(bassEnv);bassBodyG.connect(bassEnv);
  bassEnv.connect(bassLP);bassLP.connect(bassTrim);bassTrim.connect(bassPan);
  bassPan.connect(board.input);

  /* ── THE PLATE · the pad. Two triangles a few cents apart, one mid band,
     panned wide because the field is wide */
  const padA=osc('triangle'),padB=osc('triangle');
  const padFilter=ctx.createBiquadFilter();
  padFilter.type='lowpass';padFilter.frequency.value=T.pad.band;padFilter.Q.value=T.pad.q;
  const padEnv=gain(0),padTrim=gain(T.pad.trim);
  const padPanA=panner(-T.pad.width),padPanB=panner(T.pad.width);
  padA.connect(padFilter);padB.connect(padFilter);padFilter.connect(padEnv);
  padEnv.connect(padTrim);padTrim.connect(padPanA);padTrim.connect(padPanB);
  padPanA.connect(board.input);padPanB.connect(board.input);

  /* ── THE THREE INKS · the harmony, fed to the press's own three voices. The
     phrase object is written in place, so a frame allocates nothing. */
  const chord={move:false,root:0,brightness:T.harmony.brightness,voices:[]};
  for(let i=0;i<3;i++)chord.voices.push({pitch:220,gate:0,level:0,pan:0,
    brightness:T.harmony.brightness,fm:0,fmDepth:1});

  /* ── the transport. `pos` is in half-beats, `beat` in seconds. */
  let clock=num(o.start,ctx.currentTime),pos=0,bar=-1,harmonyUntil=-1,lastLead=-99;
  let tonic=0,sheetRoot=0,turn=0,beat=T.tempo.fallback,leverOn=false,dead=false;
  const HZ={hz:0};
  const stats={section:-1,sectionName:FORM[0].name,bar:0,unit:0,bpm:0,tonic:0,
    turn:0,lead:0,degree:'1/1',ensemble:ENSEMBLE.length};

  function tick(dt){
    const real=ctx.currentTime;
    clock=Math.max(clock+dt,real);
    if(!offline&&clock>real+0.05)clock=real+0.05;
    return clock;
  }
  function hold(a,now){
    if(a.cancelAndHoldAtTime)a.cancelAndHoldAtTime(now);
    else a.cancelScheduledValues(now);
  }
  /* every envelope in this file is written on a gain NODE, so the helper takes
     the node and reaches its param itself: three call sites, one rule */
  function env(node,now,attack,peak,decay){
    const a=node.gain;
    hold(a,now);
    a.linearRampToValueAtTime(peak,now+attack);
    a.exponentialRampToValueAtTime(T.quiet,now+attack+decay);
    a.setValueAtTime(0,now+attack+decay+0.002);
  }
  /* schedule a target only when the value really moved: a still field or a
     still record costs a comparison and no automation events */
  function push(param,v,now,tau,eps){
    if(Math.abs(v-param.value)<eps&&param.value>0)return;
    param.setTargetAtTime(v,now,tau);
  }
  function leadNote(now,hz){
    const band=hz*T.lead.band;
    lead.frequency.setTargetAtTime(hz,now,.04);
    lead2.frequency.setTargetAtTime(hz,now,.04);
    leadBP.frequency.setTargetAtTime(band,now,.04);
    env(leadEnv,now,T.lead.attack,T.lead.level,T.lead.decay);
  }
  function bassNote(now,hz){
    bassA.frequency.setTargetAtTime(hz,now,.03);
    bassSub.frequency.setTargetAtTime(hz*.5,now,.03);
    bassBody.frequency.setTargetAtTime(hz*2,now,.03);
    env(bassEnv,now,T.bass.attack,T.bass.level,T.bass.release);
  }
  function harmonyStrike(now){
    const root=tonic*Math.pow(2,T.harmony.oct);
    chord.move=true;chord.root=root;
    for(let j=0;j<3;j++){
      const v=chord.voices[j];
      v.pitch=root*T.scale[T.harmony.degrees[j]];
      v.gate=1;v.level=T.harmony.level;
      v.pan=j===0?-T.harmony.pan:(j===1?T.harmony.pan:ENSEMBLE[6].pan*.6);
      v.brightness=T.harmony.brightness;
    }
    harmonyUntil=pos+T.harmony.hold;
  }
  function harmonyRelease(){
    for(let j=0;j<3;j++)chord.voices[j].gate=0;
    harmonyUntil=-1;
  }
  function strike(name,energy){
    if(synth&&inHits(name))synth.hit(name,energy);
  }
  function strikeInKey(name,energy,hz){
    if(synth&&inHits(name)){HZ.hz=hz;synth.hit(name,energy,HZ);}
  }

  /* one half-beat of the arrangement: everything the score puts on this beat */
  function fire(unit,barInForm,state,now){
    const u=(barInForm*8+unit)|0,bit=SCORE[u]||0;
    if(bit&HIT.platen)strike('platen',unit===0?1:.72);
    if(bit&HIT.sheet)strike('sheet',.5);
    if(bit&HIT.pins&&tonic>0)strikeInKey('snap',.9,tonic*2);
    if(bit&HIT.wall&&tonic>0)strikeInKey('snap',.55,tonic*4);
    if(bit&HIT.tape)strike('tape',.4);
    if(bit&HIT.delivery)strike('delivery',.7);
    if(bit&HIT.harmony&&tonic>0)harmonyStrike();
    if(bit&HIT.ink)strike('ink',.55);
    if(LINE[u]&1){
      const fifth=(num(state&&state.live,0)>.5)?T.bass.fifth:1;
      const hz=fold(tonic*fifth,T.bass.lo,T.bass.hi);
      bassA.frequency.setTargetAtTime(hz,now,.03);
      bassSub.frequency.setTargetAtTime(hz*.5,now,.03);
      bassBody.frequency.setTargetAtTime(hz*2,now,.03);
      env(bassEnv,now,(LINE[u]&4)?T.bass.attack*1.4:T.bass.attack,
        (LINE[u]&4)?T.bass.level*1.15:T.bass.level,T.bass.release);
    }
  }

  function step(dt,state){
    if(dead)return;
    const d=clamp(num(dt,1/60),.005,.5);
    const now=tick(d);
    if(!leverOn){leverOn=true;master.gain.setTargetAtTime(masterLevel,now,T.fade.in);}
    const rec=state?state.rec:null;
    const ph=state?state.ph:null;
    const barNow=Math.floor(pos/8);
    if(barNow!==bar){
      const t=tempoFor(rec,num(state&&state.stride,1),num(state&&state.speed,10));
      turn=t.turn;beat=t.beat;bar=barNow;
      /* the tonic moves only between bars: the tune has a key, not a wobble */
      if(ph&&ph.root>0){sheetRoot=ph.root;tonic=fold(ph.root,T.bass.lo,T.bass.hi);}
      else if(!(tonic>0))tonic=fold(220,T.bass.lo,T.bass.hi);
    }
    /* the pad is the field: level from the magnitude, detune from the phase.
       Only a real change is scheduled, so a still field costs two compares. */
    const mag=clamp(num(state&&state.mag,.5),0,1);
    const phase=num(state&&state.phase,0);
    const det=T.pad.detune*(.35+.65*Math.abs(Math.sin(phase)));
    push(padEnv.gain,T.pad.trim*(T.pad.floor+T.pad.span*mag),now,.6,.002);
    const base=tonic*Math.pow(2,T.pad.oct);
    push(padA.frequency,base*Math.pow(2,-det/1200),now,.9,.01);
    push(padB.frequency,base*Math.pow(2,det/1200),now,.9,.01);
    /* the transport: every half-beat crossed since the last call is fired, in
       the frame that contains it */
    const before=pos;
    pos+=d/beat*2;
    const first=Math.ceil(before-1e-9),last=Math.floor(pos+1e-9);
    for(let u=first;u<=last;u++){
      const barInForm=((u/8)|0)%BARS;
      fire(u%8,barInForm,state,now);
      const sec=SECTION[barInForm];
      if(sec!==stats.section){stats.section=sec;stats.sectionName=SECTION_NAME[sec];}
    }
    if(harmonyUntil>0&&pos>harmonyUntil)harmonyRelease();
    /* the record's line: it sings when the record's quantisation moves, then
       takes a breath — the lead has air around it and stays pure */
    const singing=LEAD[bar<0?0:bar%BARS]===1;
    if(singing&&sheetRoot>0&&ph){
      if((ph.move&&(pos-lastLead)>T.lead.rest)||(pos-lastLead)>6){
        const slot=slotOf(ph.root,sheetRoot);
        const hz=fold(sheetRoot*T.scale[slot],T.lead.lo,T.lead.hi);
        leadNote(now,hz);
        stats.lead=hz*T.lead.band;
        stats.degree=slotName(slot);
        lastLead=pos;
      }
    }else if(!singing)lastLead=pos;
    if(synth){synth.apply(chord,d);chord.move=false;}
    stats.bar=bar<0?0:bar%BARS;stats.unit=Math.round(pos%8);
    stats.bpm=60/beat;stats.tonic=tonic;stats.turn=turn;
  }

  function setMaster(v){
    if(dead)return;
    const n=clamp(num(v,masterLevel),0,1);
    const now=tick(0);
    if(n<=0)master.gain.setTargetAtTime(0,now,T.fade.out);
    else{leverOn=true;master.gain.setTargetAtTime(n,now,T.fade.in);}
  }
  function setSpace(v){if(synth)synth.setSpace(v);}
  function setCharacter(v){if(synth)synth.setCharacter(v);}
  function hit(name,energy,hz){
    if(!synth||!inHits(name))return;
    if(hz!=null&&hz>0){HZ.hz=hz;synth.hit(name,energy,HZ);}
    else synth.hit(name,energy);
  }
  function silence(seconds){
    if(synth)synth.silence(seconds);
    const now=tick(0);
    master.gain.setTargetAtTime(0,now,Math.max(.01,num(seconds,.1)/3));
  }
  function dispose(){
    if(dead)return;dead=true;
    if(synth){try{synth.dispose();}catch(e){}}
    const nodes=[lead,lead2,bassA,bassSub,bassBody,padA,padB,leadBody,leadHarm,
      leadBP,leadEnv,leadTrim,leadPan,bassSubG,bassBodyG,bassLP,bassEnv,bassTrim,
      bassPan,padFilter,padEnv,padTrim,padPanA,padPanB,board.input,board.shelf,
      board.clip,board.output,master];
    if(board.glue)nodes.push(board.glue);
    for(let i=0;i<nodes.length;i++){
      const n=nodes[i];if(!n)continue;
      try{if(n.stop)n.stop();}catch(e){}
      try{n.disconnect();}catch(e){}
    }
  }
  function report(){return stats;}
  function tempoNow(){return {turn:turn,beat:beat,bpm:60/beat};}
  return {step:step,hit:hit,setMaster:setMaster,setSpace:setSpace,
    setCharacter:setCharacter,silence:silence,dispose:dispose,report:report,
    tempoNow:tempoNow,synth:synth,bench:board,
    parts:{lead:leadEnv,bass:bassEnv,pad:padEnv},
    ensemble:ENSEMBLE,level:masterLevel};
}
/* the shop publishes its layout on SHV.G; before boot there is none */
function L_from(v){return v&&typeof v==='object'?v:null;}

return {create:create,bench:bench,softCurve:softCurve,fold:fold,slotOf:slotOf,
  slotHz:slotHz,slotName:slotName,tempoFor:tempoFor,TUNE:T,FORM:FORM,
  FORM_NAME:SECTION_NAME,HIT:HIT,SCORE:SCORE,LINE:LINE,SECTION:SECTION,LEAD:LEAD,
  BARS:BARS,UNITS:UNITS};
})();

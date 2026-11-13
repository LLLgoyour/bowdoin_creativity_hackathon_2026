/* ═══════════════════════════════════════════════════════════════════════════
   w-synth.js — the press's own voice. The three ink plates are three voices: a
   two-operator FM carrier plus a detuned pair per plate, each through that
   plate's own resonant band, its own stereo position and its own gain. The
   ink dials on the wall are this instrument's mix through the phrase: w-phrase
   has already folded each plate's coverage into its level and brightness, so
   those two fields arrive as the operator's mix and the engine takes them as
   given. A plate-reverb bus — two damped delay lines, one per ear, each
   ringing on its own with native nodes only — is the room the press stands in,
   and six mechanical gestures (platen, sheet, snap, ink, delivery, tape) are
   struck from voices that already exist.

   Honesty: every sound here is synthesised from the phrase the record makes.
   The source frequency is sub-audible, so this is an intentional sonification
   and never a claim that the numerical-relativity file is audio.

   Everything is built once in create(): while the app runs this file creates
   no node and allocates nothing, and every parameter is moved with
   setTargetAtTime/setValueAtTime on the instrument's own clock — which follows
   a live AudioContext and, offline, is the sum of the frames the caller
   schedules — so the same schedule renders identically in an
   OfflineAudioContext.
   ═══════════════════════════════════════════════════════════════════════════ */
const SYNTH=(()=>{

/* ── one source of truth for every number the instrument believes ───────────
   Nothing here is a taste knob without a reason: each value is either a
   physical behaviour of the press or the musical consequence of the record. */
const TUNE={
  /* the app's own click-free ramp constants, in seconds. A note event snaps,
     a glide inside a note is slower, and nothing is short enough to click */
  ramp:{frame:.04,pitch:.035,bright:.06,gain:.07,pan:.08,space:.09,wake:.025,
        strike:.006,duck:.04,duckUp:.13,lead:.05},
  /* the three plates, in plate order: BLUE, PINK, YELLOW. Every carrier sits on
     exactly the pitch the phrase supplies — what differs is the ink: the
     carrier's waveform, the interval and detune of its two partners, the ratio
     and index of the press's own mechanical overtone, the band its filter
     occupies and its loudness trim. */
  plates:[
    /* BLUE prints first and holds the sheet up: fundamental, an octave mark */
    {name:'BLUE',car:'sine',p1:{wave:'triangle',ratio:1,cents:-7,gain:.30},
     p2:{wave:'triangle',ratio:2,cents:0,gain:.16},fm:{ratio:2,index:.70},
     tone:1,q:2.6,trim:.30},
    /* PINK is the fluorescent plate: beating, a fifth of acid, a hot band */
    {name:'PINK',car:'triangle',p1:{wave:'sawtooth',ratio:1,cents:9,gain:.34},
     p2:{wave:'sawtooth',ratio:1.5,cents:0,gain:.20},fm:{ratio:3,index:1.60},
     tone:1.5,q:4.6,trim:.26},
    /* YELLOW is the warm plate: a sub-octave body under a dark band */
    {name:'YELLOW',car:'sine',p1:{wave:'triangle',ratio:1,cents:4,gain:.20},
     p2:{wave:'sawtooth',ratio:.5,cents:0,gain:.34},fm:{ratio:1.5,index:.45},
     tone:.66,q:1.8,trim:.28}
  ],
  /* the phrase's brightness is mapped as a ratio and not a linear sweep: 300 Hz
     to 6 kHz is the band a plate can actually hold, and a filter that opens by
     octaves is what makes one record read dull and the next read hot. The band
     walks log2(span) octaves over the dial, and a fixed-Q band takes 6 dB per
     octave out of a 1/n source, so the compensation is exactly span^(b-pivot) —
     the measured loss, not a taste. A moving band is therefore a timbre control
     and not a volume control, which is what keeps the ink dial's loudness the
     phrase's own equation */
  bright:{min:300,span:20,floor:160,ceil:9000,tilt:2.995732,pivot:.45},
  /* the modulator's depth is the plate's own ink as well: a full plate is
     mechanically deeper, an almost-empty one is nearly a pure tone. Nothing in
     the phrase carries this, so the FM depth is the one place this engine
     reads the press's key itself */
  fmCover:{open:.45,span:.55},
  /* the press's own coverage equation (w-ink.js): 0.30 + 1.10*key, clamped. A
     press with no shop yet reads the plate at 0.64, which is a full sheet.
     w-phrase folds coverage into level, brightness and gate itself, so the
     level law stays linear and the dial is applied exactly once */
  cover:{base:.30,span:1.10,fallback:.64},
  /* the room is two damped delay lines with a damped lowpass in each loop, one
     line per ear. 93 ms is a plate's own dimension. Each line rings on its own:
     one DelayNode to a cycle is the only shape this browser's offline renderer
     breaks deterministically, while two lines crossing each other make one
     cycle holding two delays, and that renders two different signals from one
     schedule — which is what made a replay of the same pass drift. `ratio` is
     the second line's length instead: at 1.07 the two trains only meet again
     after 107 echoes (9.95 s), past the longest tail the dial can ask for, so
     the ears never hear the same echo and the tail stays wide. Decay is asked
     for in seconds of RT60 and turned into a loop gain over that line's own
     round trip, so the dial means a tail and not a number. The send is trimmed
     and down-mixed to mono: a plate has one input, and the ink's own stereo
     image must stay on the dry path instead of being folded into the room */
  space:{delay:.093,ratio:1.07,rt60Min:.35,rt60Span:3.2,send:.5,wetMin:.03,
         wetSpan:.4,dampMin:900,dampMax:6000,dampPerRoot:8,dampQ:.7,hp:180,
         fbCeil:.9,width:.85},
  /* the master: a soft odd-harmonic shaper and a compressor that only catches a
     hot mix. tanh is odd, so the distortion adds odd harmonics and cannot hard
     clip; the drive is compensated after the shaper so the character dial
     changes the harmonics and not the loudness of the press. The compressor
     sits at one setting on purpose: one dial, one effect */
  shape:{slope:1.8,samples:1024,driveMin:.55,driveSpan:1.5,threshold:-8,
         knee:14,ratio:3.5,attack:.006,release:.22},
  duck:{level:.34},                 /* the platen landing sits on the mix */
  quiet:.0008,                      /* an exponential ramp cannot reach zero */
  master:1,                         /* the trim on the app's volume dial */
  maxGain:1.5,                      /* a plate's gain never exceeds this */
  dry:.62,                          /* headroom for three voices at full ink */
  hit:.55,                          /* gestures sit under the plates, not over */
  pitchMin:20,pitchMax:8000,
  energy:.7,                        /* a hit without a stated energy */
  noise:{seconds:2,seed:917221},    /* one buffer, one seed: a probe render of
                                       the same schedule is comparable */
  /* the five gestures: where each one happens left-to-right on the floor, how
     loud it is, how long it rings, and the numbers of its own mechanism. The
     levels are set against each other on the instrument's own meter: the bar
     coming down leads, paper follows, a pin and a roller sit under them */
  hits:{
    platen:{pan:-.45,decay:.16,thump:{f0:210,f1:54,time:.10,level:.55,attack:.0018},
            body:{f:190,q:1.1,attack:.004,decay:.09,level:.32}},
    sheet:{pan:.50,level:.22,attack:.030,decay:.28,hp:900,q:.7,
           from:700,to:2600,time:.20},
    snap:{pan:-.60,level:.42,attack:.0012,decay:.055,f:2650,q:15,
          ping:{f:3300,drop:2900,time:.05,level:.17,attack:.0012,decay:.05}},
    ink:{pan:0,level:.9,attack:.006,decay:.13,f:620,q:3.2,from:.8,to:1.2},
    delivery:{pan:.35,level:.16,decay:.34,hp:1800,q:.6,rasp:3400,raspQ:1.4,
              flutter:.045,steps:7,onset:.012},
    /* the wall's tape slips: a dry tick and not a swish, in its own band up
       under the sheet, with two steps of flutter and gone */
    tape:{pan:.20,level:.14,decay:.09,hp:2500,q:.8,lp:6000,lpQ:.7,
          flutter:.030,steps:3,onset:.006}
  },
  /* a retunable gesture lands exactly on a caller's hz: `tone` is the frequency
     the gesture settles on (the band a click rings in, the pitch a thump lands
     on), and every other frequency of that gesture scales with it, so the
     gesture keeps its shape and the theme can pin it to its own key. The guard
     is wide on purpose — a 2915 Hz pin has to be able to ring at 110 Hz, a
     ratio of 0.038 — and it exists only to keep a caller's number from
     producing zero or sub-audible frequencies. A gesture with no tone (sheet,
     tape, delivery) is noise and ignores hz */
  retuneMin:.02,retuneMax:16
};
/* the settled frequency of each retunable gesture, derived here so the table
   above remains the one place any of these numbers is written down */
TUNE.hits.platen.tone=TUNE.hits.platen.body.f;
TUNE.hits.snap.tone=TUNE.hits.snap.f*1.1;
TUNE.hits.ink.tone=TUNE.hits.ink.f*TUNE.hits.ink.to;

const num=(v,d)=>(typeof v==='number'&&isFinite(v))?v:d;

/* a deterministic noise bed: one buffer for every gesture, seeded off the
   generator the rest of the app already uses */
function noiseBed(ctx){
  const n=Math.max(2,Math.round(ctx.sampleRate*TUNE.noise.seconds));
  const buf=ctx.createBuffer(1,n,ctx.sampleRate),d=buf.getChannelData(0);
  const rnd=mulberry32(TUNE.noise.seed);
  for(let i=0;i<n;i++)d[i]=rnd()*2-1;
  return buf;
}

/* the shaper's curve, built once for the file: an odd function, so the
   distortion is odd-harmonic only and its ends are a plateau, not a clip */
let CURVE=null;
function shapeCurve(){
  if(CURVE)return CURVE;
  const n=TUNE.shape.samples,s=TUNE.shape.slope,c=CURVE=new Float32Array(n);
  for(let i=0;i<n;i++)c[i]=Math.tanh(s*(2*i/(n-1)-1));
  return c;
}

/* the plate's own key from the workshop, read defensively: the shop may not
   have been built when the first frame sounds, and a missing shop is a press
   set to a full sheet on all three plates. w-phrase reads this equation too and
   folds it into level, brightness and gate, so this engine keeps it for the one
   thing the phrase does not carry: how deep the plate's FM runs */
function coverage(out){
  const k=(typeof SHV!=='undefined'&&SHV&&SHV.key)?SHV.key:null;
  for(let i=0;i<3;i++){
    const v=clamp(num(k&&k[i],TUNE.cover.fallback),0,1);
    out[i]=clamp(TUNE.cover.base+TUNE.cover.span*v,0,1);
  }
  return out;
}

/* wet return and loop gain for a decay dial position (see TUNE.space). Each
   line is its own loop, so the gain answers to that line's own round trip:
   `trip` is the delay, in seconds, that this gain closes around */
function wetFor(s){return TUNE.space.wetMin+TUNE.space.wetSpan*s;}
function fbFor(s,trip){
  const rt=TUNE.space.rt60Min+TUNE.space.rt60Span*s;
  return clamp(Math.pow(10,-3*trip/rt),0,TUNE.space.fbCeil);
}
function driveFor(c){return TUNE.shape.driveMin+TUNE.shape.driveSpan*c;}

/* ── the engine ──────────────────────────────────────────────────────────────
   create() builds the whole press once and starts every source silently: the
   graph makes no sound until the first apply(), which is what lets the app
   treat "sound on" as one call and not as a warm-up. */
function create(ctx,opts){
  opts=opts||{};
  const T=TUNE;
  const havePan=typeof ctx.createStereoPanner==='function';
  const haveComp=typeof ctx.createDynamicsCompressor==='function';
  const nodes=[],srcs=[],hitGains=[];
  const keep=n=>{nodes.push(n);return n;};
  const gain=v=>{const g=ctx.createGain();g.gain.value=v;return keep(g);};
  const filt=(type,f,q)=>{const b=ctx.createBiquadFilter();b.type=type;b.frequency.value=f;
    b.Q.value=q;return keep(b);};
  const delay=t=>{const d=ctx.createDelay(1);d.delayTime.value=t;return keep(d);};
  const pan=v=>{
    if(!havePan){const g=gain(1);g.pan=null;return g;}   /* no panner: identity */
    const p=ctx.createStereoPanner();p.pan.value=v;return keep(p);
  };
  const osc=(type,f)=>{const o=ctx.createOscillator();o.type=type;o.frequency.value=f;
    keep(o);srcs.push(o);o.start();return o;};
  const noise=()=>{const s=ctx.createBufferSource();s.buffer=NOISE;s.loop=true;
    keep(s);srcs.push(s);s.start();return s;};

  /* ── the buses ─────────────────────────────────────────────────────────── */
  const voiceSum=gain(1),dry=gain(T.dry),mixBus=gain(1),hitBus=gain(T.hit);
  /* one input to the room, down-mixed to mono: the plates keep their own stereo
     image on the dry path, and the two return panners build the room's width
     out of a single signal instead of folding the image into both ears */
  const send=gain(T.space.send);
  send.channelCount=1;send.channelCountMode='explicit';
  send.channelInterpretation='speakers';
  voiceSum.connect(dry);dry.connect(mixBus);
  voiceSum.connect(send);
  hitBus.connect(mixBus);hitBus.connect(send);

  /* ── the three plate voices ────────────────────────────────────────────── */
  const voices=[];
  for(let i=0;i<3;i++){
    const P=T.plates[i];
    const car=osc(P.car,220),mod=osc('sine',440),modG=gain(0);
    const a1=osc(P.p1.wave,220),a1G=gain(P.p1.gain);
    const a2=osc(P.p2.wave,220),a2G=gain(P.p2.gain);
    const carG=gain(1),mix=gain(1);
    const bp=filt('bandpass',1400,P.q);
    const pn=pan(0),vg=gain(0);
    car.connect(carG);carG.connect(mix);
    a1.connect(a1G);a1G.connect(mix);
    a2.connect(a2G);a2G.connect(mix);
    mod.connect(modG);modG.connect(car.frequency);
    mix.connect(bp);bp.connect(pn);pn.connect(vg);
    vg.connect(voiceSum);vg.connect(send);
    voices.push({car:car.frequency,mod:mod.frequency,modG:modG.gain,
      a1:a1.frequency,a2:a2.frequency,bp:bp.frequency,pn:pn.pan,vg:vg.gain,
      /* the pair's fixed intervals, in the plate's own cents */
      f1:P.p1.ratio*Math.pow(2,P.p1.cents/1200),
      f2:P.p2.ratio*Math.pow(2,P.p2.cents/1200),
      ratio:P.fm.ratio,index:P.fm.index,tone:P.tone,trim:P.trim});
  }

  /* ── the room: two damped lines, one per ear, each ringing on its own ──── */
  const sendHp=filt('highpass',T.space.hp,.7);   /* the room holds no rumble */
  send.connect(sendHp);
  const tripA=T.space.delay,tripB=T.space.delay*T.space.ratio;
  const dA=delay(tripA),dB=delay(tripB);
  const dampA=filt('lowpass',1200,T.space.dampQ),dampB=filt('lowpass',1200,T.space.dampQ);
  const sl=num(opts.space,.38);
  const fbA=gain(fbFor(sl,tripA)),fbB=gain(fbFor(sl,tripB));
  const wA=pan(-T.space.width),wB=pan(T.space.width);
  const wet=gain(wetFor(sl));
  sendHp.connect(dA);sendHp.connect(dB);
  dA.connect(dampA);dampA.connect(fbA);fbA.connect(dA);   /* A rings on its own */
  dB.connect(dampB);dampB.connect(fbB);fbB.connect(dB);   /* B rings on its own */
  dA.connect(wA);wA.connect(wet);
  dB.connect(wB);wB.connect(wet);
  wet.connect(mixBus);

  /* ── the master chain ──────────────────────────────────────────────────── */
  const d0=driveFor(num(opts.character,.5));
  const drive=gain(d0),post=gain(1/(T.shape.slope*d0));
  const shaper=ctx.createWaveShaper();
  shaper.curve=shapeCurve();shaper.oversample='2x';keep(shaper);
  const duckG=gain(1),master=gain(0);
  mixBus.connect(drive);drive.connect(shaper);shaper.connect(post);
  let comp=null;
  if(haveComp){                       /* the safety, not the sound */
    comp=ctx.createDynamicsCompressor();
    comp.knee.value=T.shape.knee;comp.ratio.value=T.shape.ratio;
    comp.attack.value=T.shape.attack;comp.release.value=T.shape.release;
    comp.threshold.value=T.shape.threshold;
    keep(comp);post.connect(comp);comp.connect(duckG);
  }else post.connect(duckG);
  /* the master lands on the destination unless the caller hands over a node:
     a theme that wants to chain the press into its own mix — its own lead, bass
     and pad, its own glue and sheen — gives this instrument the port to land on */
  const outNode=(opts.out&&typeof opts.out.connect==='function')?
    opts.out:ctx.destination;
  duckG.connect(master);master.connect(outNode);

  /* ── the five gestures: struck, never built ────────────────────────────── */
  const NOISE=noiseBed(ctx);
  function hitPan(v){const p=pan(v);p.connect(hitBus);return p;}
  /* a noise path: the bed through its own filters into its own envelope gain */
  function path(p,filters){
    const n=noise(),fs=[];
    let node=n;
    for(let i=0;i<filters.length;i++){
      const b=filt(filters[i][0],filters[i][1],filters[i][2]);
      fs.push(b);node.connect(b);node=b;
    }
    const g=gain(0);hitGains.push(g);node.connect(g);g.connect(p);
    return {f:fs,g:g.gain};
  }
  /* the platen: the bar comes down. A low thump whose pitch drops as it lands,
     plus the machine's own body answering through a low band */
  const hPlaten=(()=>{
    const H=T.hits.platen,p=hitPan(H.pan);
    const o=osc('sine',H.thump.f0),og=gain(0);
    o.connect(og);og.connect(p);hitGains.push(og);
    const body=path(p,[['bandpass',H.body.f,H.body.q]]);
    return {op:o.frequency,og:og.gain,ng:body.g,nf:body.f[0].frequency};
  })();
  /* the sheet: a filtered swish whose band rises as the paper feeds */
  const hSheet=(()=>{
    const H=T.hits.sheet,p=hitPan(H.pan);
    const s=path(p,[['highpass',H.hp,H.q]]);
    return {g:s.g,hf:s.f[0].frequency};
  })();
  /* the snap: a pin coming home — a resonant click and a small ping over it */
  const hSnap=(()=>{
    const H=T.hits.snap,p=hitPan(H.pan);
    const c=path(p,[['bandpass',H.f,H.q]]);
    const o=osc('triangle',H.ping.f),og=gain(0);
    o.connect(og);og.connect(p);hitGains.push(og);
    return {g:c.g,cf:c.f[0].frequency,op:o.frequency,og:og.gain};
  })();
  /* the ink: a damped bandpassed slap of a roller meeting the plate */
  const hInk=(()=>{
    const H=T.hits.ink,p=hitPan(H.pan);
    const s=path(p,[['bandpass',H.f,H.q]]);
    return {g:s.g,kf:s.f[0].frequency};
  })();
  /* the delivery: paper rustle — a fluttering high band over a rasp */
  const hDelivery=(()=>{
    const H=T.hits.delivery,p=hitPan(H.pan);
    const n=noise();
    const hp=filt('highpass',H.hp,H.q),g1=gain(0);
    n.connect(hp);hp.connect(g1);g1.connect(p);hitGains.push(g1);
    const rp=filt('bandpass',H.rasp,H.raspQ),g2=gain(0);
    n.connect(rp);rp.connect(g2);g2.connect(p);hitGains.push(g2);
    return {g:g1.gain,r:g2.gain};
  })();

  /* the tape: the wall's tape slips — a dry tick in its own band, so it is a
     highpassed click and not the sheet's swish */
  const hTape=(()=>{
    const H=T.hits.tape,p=hitPan(H.pan);
    const s=path(p,[['highpass',H.hp,H.q],['lowpass',H.lp,H.lpQ]]);
    return {g:s.g};
  })();

  /* ── state ─────────────────────────────────────────────────────────────── */
  const cov=new Float32Array(3);
  const lastPitch=new Float32Array(3),lastLevel=new Float32Array(3),
        lastPan=new Float32Array(3),lastBright=new Float32Array(3),
        lastDepth=new Float32Array(3),lastRoot=new Float32Array(1);
  lastPitch.fill(-1);lastLevel.fill(-1);lastPan.fill(-2);lastBright.fill(-1);
  lastDepth.fill(-1);lastRoot[0]=-1;
  let masterLevel=clamp(num(opts.master,.65),0,1);
  let spaceLevel=clamp(num(opts.space,.38),0,1);
  let charLevel=clamp(num(opts.character,.5),0,1);
  let live=false;         /* the press has been operated at least once      */
  let down=true;          /* the master is down: the next apply() lifts it  */
  let ducked=false,dead=false;
  /* ── the clock ───────────────────────────────────────────────────────────
     An AudioContext advances on its own, so the context is the clock there: the
     cursor follows it and can never drift more than one lead ahead of it. An
     OfflineAudioContext does NOT advance until it renders, so a caller that
     schedules a whole pass before startRendering() has only the sum of its own
     frames as time — this cursor is what makes the same schedule render in
     both. The max() is the whole trick: the later of the two wins. */
  const offline=typeof ctx.startRendering==='function';
  let clock=ctx.currentTime;
  function tick(seconds){
    const real=ctx.currentTime;
    clock=Math.max(clock+seconds,real);
    if(!offline&&clock>real+TUNE.ramp.lead)clock=real+TUNE.ramp.lead;
    return clock;
  }
  /* lifting the master is one path, so a gesture before the first frame is
     heard and the stop path is the only thing that overrules it. A strike
     lifts it faster than a frame does: the attack of a gesture is the gesture */
  function lift(now,tau){
    down=false;
    const m=master.gain;
    m.cancelScheduledValues(now);
    m.setTargetAtTime(masterLevel*TUNE.master,now,tau);
  }

  /* ── scheduling helpers: every one of them is click-free by construction ─
     A ramp with no event before it can smear from time zero — which, in an
     offline render, is the entire pass — so every gesture states where it
     begins. The step down onto the quiet anchor is -62 dB: that is a strike
     truncating the tail it interrupts, not a click. */
  function env(a,now,attack,peak,decay){
    a.cancelScheduledValues(now);
    a.setValueAtTime(TUNE.quiet,now);
    a.linearRampToValueAtTime(peak,now+attack);
    a.exponentialRampToValueAtTime(TUNE.quiet,now+attack+decay);
    a.setValueAtTime(0,now+attack+decay+0.002);
  }
  function sweep(a,now,f0,f1,time){
    a.cancelScheduledValues(now);
    a.setValueAtTime(f0,now);
    if(time>0)a.exponentialRampToValueAtTime(f1,now+time);
  }

  function fire(name,energy,opts){
    if(dead)return;
    const e=clamp(num(energy,T.energy),0,1);
    if(e<=0)return;                 /* no energy, no gesture */
    const now=tick(0),H=TUNE.hits[name];
    /* a gesture is the press being operated, so the first one lifts the master
       the way the first frame does: a lever pulled before the tone starts is
       still heard. A gesture after the stop path stays down. */
    if(!live){live=true;if(down)lift(now,TUNE.ramp.strike);}
    /* opts.hz pins a retunable gesture to the caller's key: the frequency the
       gesture settles on is exactly that, and every frequency of the gesture
       scales by the same factor, so it stays the same gesture in another key.
       With no hz the factor is 1 and the gesture is bit-for-bit what it was */
    const hz=num(opts&&opts.hz,0);
    const r=(H&&H.tone&&hz>0)?clamp(hz/H.tone,TUNE.retuneMin,TUNE.retuneMax):1;
    switch(name){
      case 'platen':{
        sweep(hPlaten.op,now,H.thump.f0*(0.6+0.8*e)*r,H.thump.f1*r,H.thump.time);
        env(hPlaten.og,now,H.thump.attack,H.thump.level*e,H.decay);
        env(hPlaten.ng,now,H.body.attack,H.body.level*e,H.decay);
        sweep(hPlaten.nf,now,H.body.f*(0.8+0.4*e)*r,H.body.f*r,H.body.decay);
        break;
      }
      case 'sheet':{
        sweep(hSheet.hf,now,H.from*(0.6+0.5*e),H.to,H.time);
        env(hSheet.g,now,H.attack,H.level*e,H.decay);
        break;
      }
      case 'snap':{
        sweep(hSnap.cf,now,H.f*(0.9+0.2*e)*r,H.f*1.1*r,0.03);
        env(hSnap.g,now,H.attack,H.level*e,H.decay);
        sweep(hSnap.op,now,H.ping.f*r,H.ping.drop*r,H.ping.time);
        env(hSnap.og,now,H.ping.attack,H.ping.level*e,H.ping.decay);
        break;
      }
      case 'ink':{
        sweep(hInk.kf,now,H.f*H.from*(0.8+0.4*e)*r,H.f*H.to*r,H.decay*0.8);
        env(hInk.g,now,H.attack,H.level*e,H.decay);
        break;
      }
      case 'delivery':{
        const peak=H.level*e,a=hDelivery.g;
        /* paper does not decay, it flutters: small alternating steps of the
           high band are what a rustle is, over one damped rasp */
        a.cancelScheduledValues(now);
        a.setValueAtTime(TUNE.quiet,now);
        a.linearRampToValueAtTime(peak,now+H.onset);
        for(let k=1;k<H.steps;k++)a.setValueAtTime(peak*(k%2?0.42:1),now+H.onset+k*H.flutter);
        const end=now+H.onset+H.steps*H.flutter+H.decay;
        a.exponentialRampToValueAtTime(TUNE.quiet,end);
        a.setValueAtTime(0,end+0.002);
        env(hDelivery.r,now,H.onset,peak*0.8,H.decay*0.8);
        break;
      }
      case 'tape':{
        /* a slip, not a swish: the tick is immediate, then two or three steps
           of flutter as the tape settles back, and it is gone */
        const peak=H.level*e,a=hTape.g;
        a.cancelScheduledValues(now);
        a.setValueAtTime(TUNE.quiet,now);
        a.linearRampToValueAtTime(peak,now+H.onset);
        for(let k=1;k<H.steps;k++)a.setValueAtTime(peak*(k%2?0.4:1),
          now+H.onset+k*H.flutter);
        const end=now+H.onset+H.steps*H.flutter+H.decay;
        a.exponentialRampToValueAtTime(TUNE.quiet,end);
        a.setValueAtTime(0,end+0.002);
        break;
      }
      default:break;                  /* an unknown gesture is nothing, not a fault */
    }
  }

  function applyCharacter(now){
    const d=driveFor(charLevel);
    drive.gain.setTargetAtTime(d,now,TUNE.ramp.space);
    post.gain.setTargetAtTime(1/(TUNE.shape.slope*d),now,TUNE.ramp.space);
  }
  function applySpace(now){
    wet.gain.setTargetAtTime(wetFor(spaceLevel),now,TUNE.ramp.space);
    fbA.gain.setTargetAtTime(fbFor(spaceLevel,tripA),now,TUNE.ramp.space);
    fbB.gain.setTargetAtTime(fbFor(spaceLevel,tripB),now,TUNE.ramp.space);
  }
  function setMaster(v){
    if(dead)return;
    const n=clamp(num(v,masterLevel),0,1);
    if(Math.abs(n-masterLevel)<0.0005)return;
    masterLevel=n;
    if(!down)master.gain.setTargetAtTime(masterLevel*TUNE.master,tick(0),
      TUNE.ramp.gain);
  }
  function setSpace(v){
    if(dead)return;
    const n=clamp(num(v,spaceLevel),0,1);
    if(Math.abs(n-spaceLevel)<0.0005)return;
    spaceLevel=n;applySpace(tick(0));
  }
  function setCharacter(v){
    if(dead)return;
    const n=clamp(num(v,charLevel),0,1);
    if(Math.abs(n-charLevel)<0.0005)return;
    charLevel=n;applyCharacter(tick(0));
  }
  /* the platen landing is a momentary dip, not a change of level */
  function duck(on){
    if(dead)return;
    const want=!!on;
    if(want===ducked)return;
    ducked=want;
    duckG.gain.setTargetAtTime(want?TUNE.duck.level:1,tick(0),
      want?TUNE.ramp.duck:TUNE.ramp.duckUp);
  }
  /* the stop path: the master comes down, every ringing gesture with it, and
     the graph stays alive so the next apply() brings it back up */
  function silence(seconds){
    if(dead)return;
    const d=clamp(num(seconds,0.12),0,3),now=tick(0);
    down=true;
    const m=master.gain;
    m.cancelScheduledValues(now);
    m.setTargetAtTime(0,now,Math.max(0.005,d/3));
    m.setValueAtTime(0,now+Math.max(0.01,d));
    for(let i=0;i<hitGains.length;i++){
      const a=hitGains[i].gain;
      a.cancelScheduledValues(now);
      a.setTargetAtTime(0,now,0.03);
    }
  }

  /* ── the one function the loop calls ──────────────────────────────────────
     A phrase frame in, no allocation out. Every parameter is compared with
     what was last written and only what changed is scheduled, so a frame that
     changes nothing costs fifteen numeric reads. */
  function apply(phrase,seconds){
    if(dead||!phrase)return;
    /* seconds is the caller's frame step and nothing else: it advances the
       clock. Every ramp length is a constant from TUNE.ramp */
    const now=tick(clamp(num(seconds,TUNE.ramp.frame),0.005,0.5));
    const vpitch=phrase.move?TUNE.ramp.pitch*0.67:TUNE.ramp.pitch; /* a note snaps */

    coverage(cov);
    const list=phrase.voices;
    for(let i=0;i<3;i++){
      const V=voices[i],v=list&&list[i];
      if(!v)continue;                /* a phrase with no voice leaves the plate */
      const pitch=clamp(num(v.pitch,220),TUNE.pitchMin,TUNE.pitchMax);
      const gate=clamp(num(v.gate,1),0,1);
      /* the phrase's gate is the plate's coverage times the colony's activity,
         and the coverage is already in the level: what is left for this engine
         to apply is the activity itself, so the ink dial is applied exactly
         once and a plate whose colony has gone is silent all the same */
      const act=cov[i]>0?clamp(gate/cov[i],0,1):gate;
      const level=clamp(num(v.level,0),0,1)*act;
      const bright=clamp(num(v.brightness,num(phrase.brightness,0)),0,1);
      const pn=clamp(num(v.pan,0),-1,1);
      const depth=clamp(num(v.fmDepth,1),0,1)*
        (TUNE.fmCover.open+TUNE.fmCover.span*cov[i]);
      /* the plate's own gain: the phrase's level — the ink dial is already in
         it — and the tilt that keeps a moving band from being a volume knob */
      const gain=clamp(level*V.trim*Math.exp(TUNE.bright.tilt*(bright-TUNE.bright.pivot)),
        0,TUNE.maxGain);

      if(Math.abs(pitch-lastPitch[i])>0.02){
        /* fm is the modulator's ratio, cycles per carrier cycle (PhraseMap);
           a plate's own character ratio stands in when the phrase has none */
        const f=num(v.fm,0);
        const ratio=f>0?f:V.ratio;
        V.car.setTargetAtTime(pitch,now,vpitch);
        V.mod.setTargetAtTime(pitch*ratio,now,vpitch);
        V.a1.setTargetAtTime(pitch*V.f1,now,vpitch);
        V.a2.setTargetAtTime(pitch*V.f2,now,vpitch);
        lastPitch[i]=pitch;
      }
      if(Math.abs(depth-lastDepth[i])>Math.max(0.005,depth*0.005)){
        V.modG.setTargetAtTime(pitch*V.index*depth,now,TUNE.ramp.bright);
        lastDepth[i]=depth;
      }
      if(Math.abs(gain-lastLevel[i])>0.0015){
        V.vg.setTargetAtTime(gain,now,TUNE.ramp.gain);
        lastLevel[i]=gain;
      }
      if(Math.abs(bright-lastBright[i])>0.002){
        V.bp.setTargetAtTime(clamp(TUNE.bright.min*Math.pow(TUNE.bright.span,bright)*
          V.tone,TUNE.bright.floor,TUNE.bright.ceil),now,TUNE.ramp.bright);
        lastBright[i]=bright;
      }
      if(V.pn&&Math.abs(pn-lastPan[i])>0.002){
        V.pn.setTargetAtTime(pn,now,TUNE.ramp.pan);
        lastPan[i]=pn;
      }
    }
    /* the tail is damped against the key the record is in: a low tonic leaves a
       dark room, a high one a brighter one */
    const root=num(phrase.root,130.81278265);
    if(root>0&&Math.abs(root-lastRoot[0])>0.5){
      const damp=clamp(root*TUNE.space.dampPerRoot,TUNE.space.dampMin,TUNE.space.dampMax);
      dampA.frequency.setTargetAtTime(damp,now,TUNE.ramp.space);
      dampB.frequency.setTargetAtTime(damp,now,TUNE.ramp.space);
      lastRoot[0]=root;
    }
    live=true;
    if(down)lift(now,TUNE.ramp.wake);
  }

  function dispose(){
    if(dead)return;
    dead=true;
    for(let i=0;i<srcs.length;i++){try{srcs[i].stop();}catch(e){}}
    for(let i=0;i<nodes.length;i++){try{nodes[i].disconnect();}catch(e){}}
    nodes.length=0;srcs.length=0;hitGains.length=0;
  }

  return {apply,hit:fire,setMaster,setSpace,setCharacter,duck,silence,dispose};
}

/* Object.freeze keeps the tuning table the one place these numbers live: a
   caller can read what the instrument believes, and cannot edit it in flight */
return {create,TUNE:Object.freeze(TUNE),
  HITS:Object.freeze(['platen','sheet','snap','ink','delivery','tape'])};
})();

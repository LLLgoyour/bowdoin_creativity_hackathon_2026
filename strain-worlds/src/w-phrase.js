/* ═══════════════════════════════════════════════════════════════════════════
   w-phrase.js — WHAT THE THREE PLATES PLAY. One pure function, one sample
   cursor in, one chord out. No audio nodes, no DOM, no per-frame allocation:
   the caller owns `out` and its three voice objects, and this file only writes
   numbers into them, in constant time.

   It is a superset of sonifyLifeFrame. The fields that function already fills —
   pitch, level, pan, brightness, sourceHz, noteStep — are produced by calling
   it, so they are bit-identical to it, and the printed claims that rest on them
   stay true. Everything below is what the three plates add.

   THE MAPPING (this paragraph is the printed claim; every clause is the code
   in phraseFrame):

   · Cursor. index selects one sample of the prepared record and, one sample
     back, its neighbour. Nothing here looks at any other sample.

   · Key. prepRecord unwrapped the record's complex phasor into an accumulated
     phase (rec.ph, radians). Its rotation since the sample of index 0, divided
     by a quarter turn (π/2 rad), is the note step — the same quantisation the
     existing mapping documents. A record that turns less than a quarter turn in
     total (rec.turns < 0.25) has no rotation to read and takes its step from
     amplitude instead, floor(10 × amplitude), exactly as before. The step
     selects one of fifteen slots of the five-slot just-intonation grid this
     file shares with w-sonify.js (1/1, 9/8, 5/4, 3/2, 5/3 over the
     130.81278265 Hz C3), stretched over three octaves; that slot is the
     chord's tonic, printed as out.root in Hz.

   · Chord. The tonic's position in the five-slot octave (the scale degree,
     printed 1-5 as out.degree) picks the voicing: DEG 1 root-fifth-octave,
     DEG 2 root-third-octave, DEG 3 root-fifth-ninth, DEG 4 root-second-octave,
     DEG 5 root-third-sixth. BLUE sounds the tonic, FLUORESCENT PINK the middle
     tone, YELLOW the top tone; the voicing stacks above the tonic slot, so the
     top plate can sit above the three-octave grid. out.chordName prints the
     tonic slot's ratio and the voicing's three ratios above it, e.g.
     '1/1 · 1/1 · 3/2 · 1/1 ×2' — a name for the ratios the mapping asks for,
     never an invented number.

   · Mode. 'music' places every voice on that grid, and rounds the feedback bend
     below to whole scale steps, so a bend never leaves the key. 'tone' keeps
     the continuous sweep the existing mapping documents: BLUE sounds out.pitch
     itself (the record's instantaneous phase-rotation rate mapped to 110-800
     Hz) and PINK and YELLOW sound that same sweep at the chord's intervals,
     bent continuously rather than snapped. The voices are held inside
     55-4000 Hz. In music mode the plates are the chord on the current grid
     slot while out.pitch stays the melodic line the existing mapping prints:
     the two agree pitch for pitch while the record's rotation is inside its
     first two octaves and neither is bent, and part company above that — the
     plates keep climbing the third octave the grid covers while the melodic
     line folds back an octave — and wherever a bend differs, because the plates
     snap their bend to scale steps and the melodic line rounds its to
     semitones.

   · LIFE feedback. While the LIFE world runs, its feedback wave — the live
     colony turned into a complex phasor, as lifeFeedback builds it — is read at
     the same cursor. Its real component (the in-phase column mass) bends pitch
     and sets stereo position, its imaginary component (the quadrature part)
     bends pitch a second time and drifts tuning, and PINK and YELLOW add their
     own bend on top of the leader's. Each plate bends by its own gain (BLUE
     1.00, PINK 1.35, YELLOW 0.75), so the three plates separate audibly rather
     than moving as one. The colony's activity (which falls to 0 when no cell is
     alive) gates the plates, and the feedback amplitude at the cursor is their
     loudness.

   · The record's own quantity in each case: amplitude is loudness, phase
     rotation is pitch, and the complex phase at the cursor is stereo position.

   · Ink keys are the mix. Plate i's level and brightness are that plate's
     coverage, clamp(0.30 + 1.10 × SHV.key[i], 0, 1) — the press's own key
     equation, read defensively and defaulting to 0.64 before the shop has set
     the dial — times the record's own level and brightness; its gate is that
     coverage times the colony's activity, and the coverage alone when no
     feedback wave is supplied at all — when the LIFE world is not the world the
     press is running; and its tuning is a static plate trim (0, −6,
     +6 cents) plus a drift of up to ±18 cents scaled by the plate's own bend
     gain. Nothing here reads a dial at load time.

   · Adjacent plates modulate each other: each voice's fm is the ratio of the
     next plate's pitch to its own (modulator cycles per carrier cycle, a
     ratio, not a frequency — the interval the chord already names) and fmDepth
     is how deep that modulation runs: a floor set by the plate's coverage and
     the record's brightness, lifted by the quadrature component of the feedback
     at that cursor.

   · move is true exactly at a sample whose note step differs from the previous
     sample's step, so whoever is listening for a note event can strike one. It
     is a property of the record and the index, never of call history.

   · activity is the colony's live activity at this cursor (0 when the LIFE
     world is not the world the press is running, or when it is extinct).

   The output is an intentional sonification, and the honest sentence for the
   sheet: nothing here claims the numerical-relativity file is audio.
   ═══════════════════════════════════════════════════════════════════════════ */
const PHRASE_REF=130.81278265;      /* C3, the reference w-sonify.js already uses */
const PHRASE_SCALE=[1,9/8,5/4,3/2,5/3];  /* just intonation: five slots to the octave */
const PHRASE_SLOTS=15;              /* those five slots over three octaves */
const PHRASE_RATIO=['1/1','9/8','5/4','3/2','5/3'];  /* the same five, as printed */
/* the voicing each scale degree asks for, as scale steps above the tonic:
   DEG 1 root-fifth-octave, DEG 2 root-third-octave, DEG 3 root-fifth-ninth,
   DEG 4 root-second-octave, DEG 5 root-third-sixth */
const PHRASE_SHAPE=[[0,3,5],[0,2,5],[0,3,6],[0,1,5],[0,2,4]];
const PHRASE_DEGREE=['DEG 1','DEG 2','DEG 3','DEG 4','DEG 5'];
const PHRASE_BEND=[1.00,1.35,0.75];                 /* each plate's own bend gain */
const PHRASE_TRIM=[0,-6,6];                         /* static plate trim, cents */
const PHRASE_PAN=[0,0.25,-0.25];                    /* plate spread with no colony */
const PHRASE_PAN_C=[1,0.766044443118978,-0.766044443118978]; /* cos of 0, ±40 degrees */
const PHRASE_PAN_S=[0,0.642787609686539,0.642787609686539];  /* sin of the same */
const PHRASE_PREV={};               /* one scratch object, rewritten every call */

function phraseSlotDegree(slot){return ((slot%5)+5)%5;}
function phraseSlotOctave(slot,deg){return (slot-deg)/5;}
/* one slot of the three-octave grid, on the same reference w-sonify.js uses and
   on the same five ratios, so slot k below the third octave is the pitch that
   mapping already names */
function phraseSlotHz(slot){
  const deg=phraseSlotDegree(slot);
  return PHRASE_REF*PHRASE_SCALE[deg]*Math.pow(2,phraseSlotOctave(slot,deg));
}
function phraseSlotName(slot){
  const deg=phraseSlotDegree(slot),oct=phraseSlotOctave(slot,deg);
  return PHRASE_RATIO[deg]+(oct?' ×'+(1<<oct):'');
}
/* the lettering table: one name per tonic slot, built once at load, because a
   string built while the machine is running would be an allocation per frame */
const PHRASE_CHORD=(()=>{
  const names=[];
  for(let s=0;s<PHRASE_SLOTS;s++){
    const sh=PHRASE_SHAPE[phraseSlotDegree(s)];
    names.push(phraseSlotName(s)+' · '+sh.map(k=>phraseSlotName(s+k)).join(' · '));
  }
  return names;
})();

/* The record, the LIFE colony and the three ink keys become one chord. `out` is
   the caller's, and so are out.voices' three objects: they are created on the
   first call and only ever written in place after that. */
function phraseFrame(rec,feedback,index,mode,out){
  /* the shared fields come from the existing mapping itself — sonifyLifeFrame
     falls through to sonifyFrame when there is no colony — so pitch, level,
     pan, brightness, sourceHz and noteStep are bit-identical to it, including
     its empty-record path */
  out=sonifyLifeFrame(rec,feedback,index,mode,out);
  let voices=out.voices;
  if(!voices||voices.length!==3){
    voices=[{pitch:0,level:0,pan:0,brightness:0,fm:1,fmDepth:0,detune:0,gate:0},
      {pitch:0,level:0,pan:0,brightness:0,fm:1,fmDepth:0,detune:0,gate:0},
      {pitch:0,level:0,pan:0,brightness:0,fm:1,fmDepth:0,detune:0,gate:0}];
    out.voices=voices;
  }
  if(!rec||!rec.re||!rec.re.length){
    out.root=0;out.move=false;out.activity=0;out.degree='NO RECORD';out.chordName='SILENT';
    for(let j=0;j<3;j++){const v=voices[j];
      v.pitch=0;v.level=0;v.pan=0;v.brightness=0;v.fm=1;v.fmDepth=0;v.detune=0;v.gate=0;}
    return out;
  }
  const i=clamp(index|0,0,rec.re.length-1);
  const step=out.noteStep,music=mode==='music',peak=rec.amax||1;
  const slot=((step%PHRASE_SLOTS)+PHRASE_SLOTS)%PHRASE_SLOTS,degree=slot%5;
  const fi=feedback?clamp(i,0,feedback.re.length-1):0;
  const fre=feedback?feedback.re[fi]/peak:0,fim=feedback?feedback.im[fi]/peak:0;
  const act=feedback?clamp(feedback.activity||0,0,1):0;
  const key=(typeof SHV!=='undefined'&&SHV&&SHV.key)?SHV.key:null;
  const sh=PHRASE_SHAPE[degree];

  out.root=phraseSlotHz(slot);
  out.degree=PHRASE_DEGREE[degree];
  out.chordName=PHRASE_CHORD[slot];
  out.activity=act;
  /* a note event is a change in the record's own quantisation, so it is read
     from the record's previous sample and not from any call history */
  out.move=i>0&&step!==sonifyFrame(rec,i-1,mode,PHRASE_PREV).noteStep;

  for(let j=0;j<3;j++){
    const v=voices[j];
    const cov=clamp(0.30+1.10*(key&&key[j]!=null?key[j]:0.64),0,1);
    const bend=clamp((0.5*fre+0.25*fim)*PHRASE_BEND[j],-0.6,0.6);
    const k=slot+sh[j];
    const ratio=phraseSlotHz(k)/phraseSlotHz(slot);
    /* music: the chord's interval plus a bend snapped to whole scale steps;
       tone: the continuous sweep at that interval, bent continuously */
    v.pitch=music?phraseSlotHz(slot+sh[j]+Math.round(bend*2))
      :clamp(out.pitch*ratio*Math.pow(2,j?bend:0),55,4000);
    v.level=clamp(out.level*cov,0,1);
    v.brightness=clamp(out.brightness*cov,0,1);
    v.gate=clamp(cov*(feedback?act:1),0,1);
    v.detune=clamp(PHRASE_TRIM[j]+(feedback?18*fim*PHRASE_BEND[j]:0),-45,45);
    v.pan=feedback?clamp(fre*PHRASE_PAN_C[j]-fim*PHRASE_PAN_S[j],-0.75,0.75)
      :clamp(out.pan+PHRASE_PAN[j],-0.75,0.75);
    v.fmDepth=clamp(cov*(0.06+0.44*(feedback?Math.min(1,Math.abs(fim)*2):0))*
      (0.5+0.5*out.brightness),0,1);
  }
  for(let j=0;j<3;j++){const v=voices[j],w=voices[(j+1)%3];
    v.fm=v.pitch>1e-9&&w.pitch>1e-9?w.pitch/v.pitch:1;}
  return out;
}

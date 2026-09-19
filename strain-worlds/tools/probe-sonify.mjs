import {readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const js=['core.js','w-field.js','data-gsfc.js','w-sonify.js']
  .map(name=>readFileSync(join(root,'src',name),'utf8')).join('\n');
const {rec,sonifyFrame}=new Function(js+'\nreturn {rec:prepRecord({name:GSFC.name,re:decodeF64(GSFC.re),im:decodeF64(GSFC.im),t:decodeF64(GSFC.t)}),sonifyFrame};')();
const tone={},music={},musicPitches=new Set();
let pitchMin=Infinity,pitchMax=0,stepMax=0,peakIndex=0;
for(let i=0;i<rec.re.length;i++){
  sonifyFrame(rec,i,'tone',tone);sonifyFrame(rec,i,'music',music);
  assert(Number.isFinite(tone.pitch)&&Number.isFinite(music.pitch));
  assert(tone.level>=0&&tone.level<=1&&tone.pan>=-0.75&&tone.pan<=0.75);
  if(tone.pitch<pitchMin)pitchMin=tone.pitch;
  if(tone.pitch>pitchMax)pitchMax=tone.pitch;
  if(music.noteStep>stepMax)stepMax=music.noteStep;
  if(rec.amp[i]>rec.amp[peakIndex])peakIndex=i;
  musicPitches.add(music.pitch);
}
/* the five slots the music mode sounds are just intonation on C3 — 1/1 9/8 5/4
   3/2 5/3 — and the mapping is held to exactly those ratios, each also an
   octave up: the grid is a claim this probe checks, not a table it trusts. */
const JI=[1,9/8,5/4,3/2,5/3].map(r=>130.81278265*r);
for(const hz of JI)for(const oct of [1,2]){
  assert([...musicPitches].some(v=>Math.abs(v-hz*oct)<1e-9),
    `music mode never sounds ${hz.toFixed(3)} Hz (x${oct}): ${[...musicPitches].map(v=>v.toFixed(3)).join(' ')}`);
}
assert.equal(musicPitches.size,JI.length*2,
  `expected the ten slots of two octaves, saw ${musicPitches.size}`);
const first=sonifyFrame(rec,0,'tone',{}),peak=sonifyFrame(rec,peakIndex,'tone',{});
assert(peak.level>first.level*20);
assert(Math.abs(peak.level-1)<1e-10);
assert(stepMax>=35);
const replay=sonifyFrame(rec,peakIndex,'tone',{});
assert.deepEqual(replay,peak);
console.log('PASS GSFC sonification:',rec.re.length,'samples; peak sample',peakIndex,
  'loudness',first.level.toFixed(3),'→',peak.level.toFixed(3),
  '; audible tone',pitchMin.toFixed(1),'..',pitchMax.toFixed(1),'Hz;',
  'phase quarter-turns',stepMax);
console.log('     music-mode slots, just intonation on C3 130.813 Hz:',
  JI.map(v=>v.toFixed(3)).join(' /'),'Hz (ratios 1/1 9/8 5/4 3/2 5/3;',
  'degree 1 =',JI[1].toFixed(3),'Hz);',musicPitches.size,'slots over two octaves');

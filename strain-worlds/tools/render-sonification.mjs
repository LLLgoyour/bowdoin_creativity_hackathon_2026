/* Render a short, shareable WAV preview of the same phase-music mapping used
   by the live browser synth. No libraries, network, or audio input required. */
import {readFileSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const js=['core.js','w-field.js','data-gsfc.js','w-sonify.js']
  .map(name=>readFileSync(join(root,'src',name),'utf8')).join('\n');
const {rec,sonifyFrame}=new Function(js+'\nreturn {rec:prepRecord({name:GSFC.name,re:decodeF64(GSFC.re),im:decodeF64(GSFC.im),t:decodeF64(GSFC.t)}),sonifyFrame};')();
const sampleRate=22050,seconds=28,frames=sampleRate*seconds;
const wav=Buffer.alloc(44+frames*4);
wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);
wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(2,22);
wav.writeUInt32LE(sampleRate,24);wav.writeUInt32LE(sampleRate*4,28);
wav.writeUInt16LE(4,32);wav.writeUInt16LE(16,34);
wav.write('data',36);wav.writeUInt32LE(frames*4,40);
let index=-1,pitch=130.8,level=0,pan=0,brightness=0,phase=0,lpL=0,lpR=0;
const reading={},tau=2*Math.PI;
const smoothPitch=1-Math.exp(-1/(sampleRate*0.035));
const smoothLevel=1-Math.exp(-1/(sampleRate*0.07));
const smoothPan=1-Math.exp(-1/(sampleRate*0.08));
for(let frame=0;frame<frames;frame++){
  const sample=Math.min(rec.re.length-1,Math.floor(frame*(rec.re.length-1)/(frames-1)));
  if(sample!==index){index=sample;sonifyFrame(rec,index,'music',reading);}
  pitch+=(reading.pitch-pitch)*smoothPitch;
  level+=(reading.level-level)*smoothLevel;
  pan+=(reading.pan-pan)*smoothPan;
  brightness+=(reading.brightness-brightness)*smoothLevel;
  phase=(phase+tau*pitch/sampleRate)%tau;
  const tone=0.82*Math.sin(phase)+0.18*(2/Math.PI)*Math.asin(Math.sin(2*phase));
  const fade=Math.min(1,frame/(sampleRate*0.12),(frames-1-frame)/(sampleRate*0.12));
  const gain=0.65*(0.003+0.45*Math.pow(level,0.85))*Math.max(0,fade);
  const angle=(pan+1)*Math.PI/4,cutoff=400+4200*brightness;
  const alpha=1-Math.exp(-tau*cutoff/sampleRate);
  lpL+=(tone*gain*Math.cos(angle)-lpL)*alpha;
  lpR+=(tone*gain*Math.sin(angle)-lpR)*alpha;
  wav.writeInt16LE(Math.round(Math.max(-1,Math.min(1,lpL))*32767),44+frame*4);
  wav.writeInt16LE(Math.round(Math.max(-1,Math.min(1,lpR))*32767),46+frame*4);
}
const out=join(root,'builds','gsfc-phase-music.wav');
writeFileSync(out,wav);
console.log('wrote',out,'—',seconds,'s, stereo PCM 16-bit,',sampleRate,'Hz');

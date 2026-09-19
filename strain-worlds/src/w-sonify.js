/* Pure mapping from a prepared complex record to audible control values.
   The signal's source frequency is sub-audible; the output is an intentional
   sonification, never a claim that the numerical-relativity file is audio. */
const SONIFY_SCALE=[0,2,4,7,9]; // C major pentatonic, repeated over two octaves
function sonifyFrame(rec,index,mode,out){
  out=out||{};
  if(!rec||!rec.re||!rec.re.length){
    out.level=0;out.pitch=110;out.pan=0;out.brightness=0;
    out.sourceHz=0;out.noteStep=0;return out;
  }
  const n=rec.re.length,i=clamp(index|0,0,n-1);
  const re=rec.re[i],im=rec.im?rec.im[i]:0;
  const mag=Math.hypot(re,im),level=clamp((rec.amp?rec.amp[i]:mag)/(rec.amax||1),0,1);
  const phase=rec.ph?rec.ph[i]:Math.atan2(im,re);
  const prev=rec.ph&&i?rec.ph[i-1]:phase;
  const dt=rec.t&&i?rec.t[i]-rec.t[i-1]:1;
  const sourceHz=i&&dt>0?Math.abs(phase-prev)/(2*Math.PI*dt):0;
  const turns=Math.abs(phase-(rec.ph?rec.ph[0]:0));
  const step=rec.turns>=0.25?Math.floor(turns/(Math.PI/2)):Math.floor(level*10);
  const degree=step%SONIFY_SCALE.length,octave=Math.floor(step/SONIFY_SCALE.length)%2;
  const melodic=130.81278265*Math.pow(2,(SONIFY_SCALE[degree]+12*octave)/12);
  out.pitch=mode==='music'?melodic:clamp(110+5500*sourceHz,110,800);
  out.level=level;
  out.pan=mag>1e-9?clamp(re/mag,-0.75,0.75):0;
  out.brightness=level;
  out.sourceHz=sourceHz;
  out.noteStep=step;
  return out;
}

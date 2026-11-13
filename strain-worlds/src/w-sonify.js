/* Pure mapping from a prepared complex record to audible control values.
   The signal's source frequency is sub-audible; the output is an intentional
   sonification, never a claim that the numerical-relativity file is audio. */
const SONIFY_SCALE=[1,9/8,5/4,3/2,5/3]; // just intonation: the five slots the plates print
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
  const melodic=130.81278265*SONIFY_SCALE[degree]*Math.pow(2,octave);
  out.pitch=mode==='music'?melodic:clamp(110+5500*sourceHz,110,800);
  out.level=level;
  out.pan=mag>1e-9?clamp(re/mag,-0.75,0.75):0;
  out.brightness=level;
  out.sourceHz=sourceHz;
  out.noteStep=step;
  return out;
}

/* LIFE turns each live column into a complex phasor. Its vertical positions
   set the phasor angle; neighbouring columns are averaged so isolated births
   change a contour rather than making a single-pixel spike. The original
   record remains the quiet backbone of the output wave. Nothing here edits it
   or the field driving the automaton. */
function lifeFeedback(rec,S){
  if(!rec||!rec.re||!S||!S.st)return null;
  const {w,h,st}=S,n=rec.re.length,peak=rec.amax||1;
  const columnsRe=new Float64Array(w),columnsIm=new Float64Array(w);
  let live=0;
  for(let y=0;y<h;y++){
    const angle=2*Math.PI*(y+0.5)/h,c=Math.cos(angle),s=Math.sin(angle);
    for(let x=0;x<w;x++)if(st[y*w+x]){
      columnsRe[x]+=c;columnsIm[x]+=s;live++;
    }
  }
  const smoothRe=new Float64Array(w),smoothIm=new Float64Array(w);
  let maxColumn=0,globalRe=0,globalIm=0;
  for(let x=0;x<w;x++){
    const left=(x+w-1)%w,right=(x+1)%w;
    smoothRe[x]=(columnsRe[left]+2*columnsRe[x]+columnsRe[right])/4;
    smoothIm[x]=(columnsIm[left]+2*columnsIm[x]+columnsIm[right])/4;
    maxColumn=Math.max(maxColumn,Math.hypot(smoothRe[x],smoothIm[x]));
    globalRe+=smoothRe[x];globalIm+=smoothIm[x];
  }
  const activity=clamp(Math.sqrt(live/Math.max(1,w*h*0.08)),0,1);
  const globalMag=Math.max(1,Math.hypot(globalRe,globalIm));
  const re=new Float64Array(n),im=new Float64Array(n);
  for(let i=0;i<n;i++){
    const x=i%w,textureRe=maxColumn?smoothRe[x]/maxColumn:0,
      textureIm=maxColumn?smoothIm[x]/maxColumn:0;
    re[i]=activity*(0.35*rec.re[i]+0.65*peak*(0.8*textureRe+0.2*globalRe/globalMag));
    im[i]=activity*(0.35*rec.im[i]+0.65*peak*(0.8*textureIm+0.2*globalIm/globalMag));
  }
  const wave=prepRecord({kind:'complex',name:'LIFE feedback',re,im,t:rec.t});
  wave.amax=peak; // a fixed scale makes a shrinking or extinct colony quieter
  wave.live=live;wave.activity=activity;
  return wave;
}

/* The same complex feedback wave shown by the scope controls the synth.
   The source phase still establishes the musical idea; cell positions bend
   pitch and pan, while the feedback wave's amplitude sets loudness. */
function sonifyLifeFrame(rec,feedback,index,mode,out){
  out=sonifyFrame(rec,index,mode,out);
  if(!feedback)return out;
  const i=clamp(index|0,0,feedback.re.length-1),peak=rec.amax||1;
  const re=feedback.re[i]/peak,im=feedback.im[i]/peak;
  const bend=clamp(0.5*re+0.25*im,-0.6,0.6);
  const semitones=mode==='music'?Math.round(bend*5):bend*12;
  out.pitch=clamp(out.pitch*Math.pow(2,semitones/12),90,1000);
  out.level=clamp(feedback.amp[i]/peak,0,1);
  out.pan=clamp(re,-0.75,0.75);
  out.brightness=out.level;
  return out;
}

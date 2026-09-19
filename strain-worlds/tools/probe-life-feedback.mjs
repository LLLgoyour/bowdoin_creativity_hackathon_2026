import {readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const js=['core.js','w-field.js','w-life.js','data-gsfc.js','w-sonify.js']
  .map(name=>readFileSync(join(root,'src',name),'utf8')).join('\n');
const {rec,lifeFeedback,sonifyLifeFrame,realLife}=new Function(js+`
  const rec=prepRecord({name:GSFC.name,re:decodeF64(GSFC.re),im:decodeF64(GSFC.im),t:decodeF64(GSFC.t)});
  return {rec,
    lifeFeedback,sonifyLifeFrame,
    realLife:()=>{const field=fieldById('path').build(rec,52,52,{}),world=worldById('life');
      const par={rule:0,ruleRows:0,wrap:1,gravity:0},state=world.init(52,52,field,mulberry32(7),par);
      const before=lifeFeedback(rec,state);world.step(state,field,par);
      return {before,after:lifeFeedback(rec,state)};}};`)();
const index=242,sourceSample=rec.re[index],w=12,h=12,st=new Uint8Array(w*h),S={w,h,st};
st[1*w+2]=st[3*w+4]=st[7*w+9]=1;
const first=lifeFeedback(rec,S),firstTone=sonifyLifeFrame(rec,first,index,'tone',{});
assert.equal(first.live,3);
assert.equal(rec.re[index],sourceSample,'feedback must leave the source untouched');
assert.deepEqual(lifeFeedback(rec,S).re,first.re,'the same board must make the same wave');
st[1*w+2]=0;st[9*w+2]=1;
const next=lifeFeedback(rec,S),nextTone=sonifyLifeFrame(rec,next,index,'tone',{});
assert.notDeepEqual(next.re,first.re,'a new generation must reshape the wave');
assert.notEqual(nextTone.pitch,firstTone.pitch,'cell positions must bend pitch');
assert.notEqual(nextTone.level,firstTone.level,'cell positions must change loudness');
st.fill(0);
const extinct=lifeFeedback(rec,S),silent=sonifyLifeFrame(rec,extinct,index,'music',{});
assert.equal(extinct.live,0);
assert.equal(extinct.re.every(v=>v===0),true);
assert.equal(silent.level,0,'extinction must silence the synth');
const evolved=realLife();
assert.notDeepEqual(evolved.before.re,evolved.after.re,'a real Conway step must change the scope wave');
console.log('PASS LIFE feedback: cell positions reshape both scope channels and tone; extinction is silent');

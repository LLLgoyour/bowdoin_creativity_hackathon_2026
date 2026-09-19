import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';

// One lexical realm, like classic scripts in the browser. A contextified vm
// changes global lookup costs and badly distorts small typed-array kernels.
const source=['core.js','w-grav.js'].map(file=>
  readFileSync(new URL('../src/'+file,import.meta.url),'utf8')).join('\n');
const {world,rng}=new Function(source+'\nreturn {world:worldById("grav"),rng:mulberry32};')();
const defaults=Object.fromEntries(world.params.map(p=>[p.key,p.def]));

// Independent synthetic record: two Gaussian loud basins on a gentle slope.
function field(w,h,mode='basins'){
  const amp=new Float32Array(w*h),ph=new Float32Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const u=x/(w-1||1),v=y/(h-1||1),i=y*w+x;
    amp[i]=mode==='flat'?0.5:Math.min(1,0.07+0.16*v+
      0.7*Math.exp(-((u-0.32)**2+(v-0.45)**2)/0.035)+
      0.55*Math.exp(-((u-0.76)**2+(v-0.7)**2)/0.022));
    ph[i]=Math.atan2(v-0.5,u-0.5)+u*6;
  }
  return {w,h,amp,ph};
}
function sum(a){let s=0;for(const x of a)s+=x;return s;}
function maximum(a){let s=0;for(const x of a)s=Math.max(s,x);return s;}
function replaceMass(S,fill){
  S.grains.fill(0);fill(S.grains);S.mass=sum(S.grains);S.initialMass=S.mass;
  S.live=S.grains.reduce((n,x)=>n+(x>0),0);S.age.fill(0);
}
function checkedStep(S,F,P){
  const before=sum(S.grains);world.step(S,F,P);
  const after=sum(S.grains),residual=before+S.added-after-S.out;
  assert.equal(residual,0,'integer conservation per generation');
  assert.equal(after,S.mass);
  assert.ok(maximum(S.grains)<=Math.max(3,P.slope));
  assert.equal(S.grains.BYTES_PER_ELEMENT,1);
  return Math.abs(residual);
}
function occupancy(S){
  let basinMass=0,basinCells=0,ridgeMass=0,ridgeCells=0;
  for(let i=0;i<S.n;i++){
    if(S.height[i]<0.55){basinCells++;basinMass+=S.grains[i];}
    else {ridgeCells++;ridgeMass+=S.grains[i];}
  }
  return {basinCells,basinMass,basinMean:+(basinMass/basinCells).toFixed(6),
    ridgeCells,ridgeMass,ridgeMean:+(ridgeMass/ridgeCells).toFixed(6)};
}
function distribution(values){
  const counts=new Map();for(const value of values)counts.set(value,(counts.get(value)||0)+1);
  return Object.fromEntries([...counts].sort((a,b)=>a[0]-b[0]));
}

function shakeExperiment(F,side,power,label){
  const P={...defaults},states=[];
  for(let r=0;r<3;r++){
    const state=world.init(side,side,F,rng(913),P);
    for(let g=0;g<500;g++)checkedStep(state,F,P);
    states.push(state);
  }
  const [shaken,replay,control]=states,before=shaken.mass,generation=shaken.gen;
  const viewCopies={};
  for(const [key,value] of Object.entries(world.view(shaken)))
    if(ArrayBuffer.isView(value))viewCopies[key]=value.slice();
  const fieldCopies={};
  for(const [key,value] of Object.entries(F))
    if(ArrayBuffer.isView(value))fieldCopies[key]=value.slice();
  const start=performance.now(),returned=world.shake(shaken,F,power),cost=performance.now()-start;
  const replayReturned=world.shake(replay,F,power);
  assert.equal(returned,replayReturned);
  assert.equal(shaken.gen,generation,'shake is an impulse, not a hidden generation');
  assert.equal(before+shaken.shakeAdded,shaken.mass+shaken.shakeOut,'mass across impulse');
  assert.deepEqual(shaken.grains,replay.grains);
  assert.deepEqual(shaken.age,replay.age);
  for(const [key,value] of Object.entries(viewCopies))assert.deepEqual(shaken.V[key],value,'shake never writes view '+key);
  for(const [key,value] of Object.entries(fieldCopies))assert.deepEqual(F[key],value,'shake never edits field '+key);
  assert.ok(!returned.includes('\n')&&!returned.includes('recovery'));
  const immediate={added:shaken.shakeAdded,out:shaken.shakeOut,cascades:shaken.shakeCascades,
    topples:shaken.shakeTopples,massBefore:before,massAfter:shaken.mass};
  let shakenTopples=0,shakenCascades=0,controlTopples=0,controlCascades=0,elapsed=0,maxResidual=0;
  for(let g=1;g<=1024;g++){
    maxResidual=Math.max(maxResidual,checkedStep(shaken,F,P),checkedStep(replay,F,P),checkedStep(control,F,P));
    if(g<=128){
      shakenTopples+=shaken.avalanche;shakenCascades+=shaken.avalanche>0?1:0;
      controlTopples+=control.avalanche;controlCascades+=control.avalanche>0?1:0;
    }
    elapsed=g;
    if(g>=128&&!shaken.shakeTracking)break;
  }
  assert.deepEqual(shaken.grains,replay.grains,'seeded replay after impulse');
  assert.deepEqual(shaken.age,replay.age);
  assert.equal(shaken.shakeRecovery,replay.shakeRecovery);
  assert.equal(shaken.initialMass+shaken.totalAdded,shaken.mass+shaken.totalOut);
  assert.equal(control.initialMass+control.totalAdded,control.mass+control.totalOut);
  console.log('shake',JSON.stringify({field:label,side,power,callAtGeneration:generation,
    returned,ms:+cost.toFixed(4),immediate,
    preShakeWindow:[generation-31,generation],baseline:{cascadeRate:shaken.shakeBaselineRate,meanTopples:shaken.shakeBaselineTopples},
    matchedPostWindow:[1,128],shaken:{cascades:shakenCascades,topples:shakenTopples,
      topplesIncludingImpulse:shakenTopples+immediate.topples},
    unshaken:{cascades:controlCascades,topples:controlTopples},
    recoveryGenerations:shaken.shakeTracking?null:shaken.shakeRecovery,observedGenerations:elapsed,
    finalMass:{shaken:shaken.mass,unshaken:control.mass},maxMassResidual:maxResidual,
    deterministic:true,viewUnchangedAtCall:true,fieldUnchanged:true,HUD:world.HUD(shaken)}));
}

// The four-grain rule itself, including every exposed side of a 1x1 board.
const tiny=field(1,1,'flat'),tinyP={...defaults,source:0,slope:2};
const one=world.init(1,1,tiny,rng(1),tinyP);
const guardF=field(3,3,'flat'),guard=world.init(3,3,guardF,rng(2),tinyP);
replaceMass(guard,m=>m[4]=3);checkedStep(guard,guardF,tinyP);
assert.equal(guard.mass,3);assert.equal(guard.avalanche,0);
replaceMass(one,m=>m[0]=4);checkedStep(one,tiny,tinyP);
assert.equal(one.mass,0);assert.equal(one.out,4);assert.equal(one.avalanche,1);
console.log('four_grain_boundary',JSON.stringify({at3:3,at4:one.mass,out:one.out,topples:one.avalanche,duration:one.avalancheDuration}));

const F=field(52,52),P={...defaults,advect:1};
const S=world.init(52,52,F,rng(7319),P);
let maxResidual=0,steadyMass1=0,steadyMass2=0,sizeStart=0,sizeEnd=0;
const sizes=[],durations=[];
for(let g=0;g<2000;g++){
  maxResidual=Math.max(maxResidual,checkedStep(S,F,P));
  if(g>=1500&&g<1750)steadyMass1+=S.mass;
  if(g>=1750)steadyMass2+=S.mass;
  if(g>=1000&&S.avalanche&&sizes.length<500){
    if(!sizeStart)sizeStart=g+1;sizeEnd=g+1;
    sizes.push(S.avalanche);durations.push(S.avalancheDuration);
  }
}
assert.equal(sizes.length,500,'500 complete nonzero cascades');
assert.ok(S.totalOut>0&&S.totalTopples>0,'drive reaches open-boundary avalanche regime');
assert.equal(S.initialMass+S.totalAdded,S.mass+S.totalOut);
const histogram=new Array(9).fill(0);for(const m of S.grains)histogram[m]++;
console.log('conservation',JSON.stringify({steps:2000,maxResidual,initial:S.initialMass,
  added:S.totalAdded,boundaryOut:S.totalOut,remaining:S.mass,
  lhs:S.initialMass+S.totalAdded,rhs:S.mass+S.totalOut}));
console.log('basin_height_histogram_gen2000_0_to_8',JSON.stringify(histogram));
console.log('late_mean_mass_windows_not_steady',JSON.stringify({steps1501to1750:steadyMass1/250,steps1751to2000:steadyMass2/250}));
console.log('basin_occupancy',JSON.stringify(occupancy(S)));
console.log('avalanche_definition complete cascade to quiescence per generation; size=topplings (4 grains each); duration=FIFO relaxation rounds; world_generations=1');
console.log('avalanche_summary',JSON.stringify({window:[sizeStart,sizeEnd],events:sizes.length,largest:maximum(sizes),
  mean:sizeMean(sizes),longestRounds:maximum(durations),meanRounds:sizeMean(durations),
  allRunTopples:S.totalTopples,allRunLargest:S.largestAvalanche}));
console.log('avalanche_size_to_frequency',JSON.stringify(distribution(sizes)));
console.log('avalanche_rounds_to_frequency',JSON.stringify(distribution(durations)));
function sizeMean(values){return +(sum(values)/values.length).toFixed(3);}

// Isolate terrain alone: exactly the same mass, feed=0, no boundary losses.
// A flat shelf retains 3-card piles; the basin gathers them into 4-card piles
// and cascades. The main experiment above separately proves ongoing feeding.
const A=field(31,31,'flat'),B=field(31,31,'flat');
for(let y=0;y<31;y++)for(let x=0;x<31;x++)
  B.amp[y*31+x]=Math.exp(-((x-15)**2+(y-15)**2)/50);
const sensitivityP={...defaults,gravity:8,source:0};
const shelf=world.init(31,31,A,rng(41),sensitivityP),basin=world.init(31,31,B,rng(41),sensitivityP);
for(const state of [shelf,basin])replaceMass(state,m=>{
  for(let y=11;y<=19;y++)for(let x=11;x<=19;x++)m[y*31+x]=3;
});
for(let g=0;g<120;g++){
  checkedStep(shelf,A,sensitivityP);checkedStep(basin,B,sensitivityP);
}
assert.equal(shelf.mass,basin.mass);
assert.equal(shelf.totalAdded,basin.totalAdded);
assert.equal(shelf.totalOut,0);assert.equal(basin.totalOut,0);
assert.notEqual(maximum(shelf.grains),maximum(basin.grains));
assert.ok(basin.totalTopples>shelf.totalTopples);
console.log('equal_mass_terrain_sensitivity',JSON.stringify({initial:shelf.initialMass,
  feed:sensitivityP.source,addedEach:shelf.totalAdded,remainingEach:shelf.mass,
  flat:{maxPile:maximum(shelf.grains),topples:shelf.totalTopples,largest:shelf.largestAvalanche},
  basin:{maxPile:maximum(basin.grains),topples:basin.totalTopples,largest:basin.largestAvalanche}}));

// Live record drive changes without rebuilding the terrain; equal budgets,
// different amplitude peaks must select different source cells after init.
const left=field(12,12,'flat'),right=field(12,12,'flat');
for(let y=0;y<12;y++)for(let x=0;x<12;x++)
  left.amp[y*12+x]=right.amp[y*12+x]=0.2+y*0.03;
const feedP={...defaults,gravity:0,source:1,slope:8};
const L=world.init(12,12,left,rng(51),feedP),R=world.init(12,12,right,rng(51),feedP);
replaceMass(L,()=>{});replaceMass(R,()=>{});
for(let y=0;y<12;y++)for(let x=0;x<12;x++){
  left.amp[y*12+x]=x<6?1:0;right.amp[y*12+x]=x<6?0:1;
}
for(let i=0;i<25;i++){checkedStep(L,left,feedP);checkedStep(R,right,feedP);}
let leftHalfL=0,leftHalfR=0;
for(let i=0;i<144;i++)if(i%12<6){leftHalfL+=L.grains[i];leftHalfR+=R.grains[i];}
assert.equal(L.totalAdded,R.totalAdded);assert.ok(leftHalfL>leftHalfR*5);
console.log('live_record_source',JSON.stringify({sameAdded:L.totalAdded,leftPeakedLeftMass:leftHalfL,rightPeakedLeftMass:leftHalfR}));

// Reproducibility, view purity/reuse, earned faces, live params and top rain.
const DF=field(13,11),DP={...defaults,source:0.9};
const D1=world.init(13,11,DF,rng(91),DP),D2=world.init(13,11,DF,rng(91),DP);
for(let i=0;i<100;i++){checkedStep(D1,DF,DP);checkedStep(D2,DF,DP);}
assert.deepEqual(D1.grains,D2.grains);assert.equal(D1.totalTopples,D2.totalTopples);
const V=world.view(D1);assert.equal(V,world.view(D1));
for(let i=0;i<D1.n;i++){
  assert.equal(V.live[i],D1.grains[i]>0?1:0);
  assert.equal(V.stack[i],Math.min(4,Math.max(0,D1.grains[i]-1)));
  assert.ok(V.col[i]<12);
}
const restF=field(3,3,'flat'),restP={...defaults,source:0};
const rest=world.init(3,3,restF,rng(11),restP);
replaceMass(rest,m=>{m[0]=m[1]=m[2]=1;m[4]=2;});
for(let i=0;i<39;i++)checkedStep(rest,restF,restP);
assert.equal(world.view(rest).face[4],0);
checkedStep(rest,restF,restP);assert.equal(world.view(rest).face[4],1);
const rainF=field(16,16),rainP={...defaults,source:1};
const rain=world.init(16,16,rainF,rng(13),rainP);replaceMass(rain,()=>{});
checkedStep(rain,rainF,rainP);
assert.equal(sum(rain.grains.subarray(16)),0);assert.equal(sum(rain.grains.subarray(0,16)),rain.added);
const rainAdded=rain.added;rainP.source=0;checkedStep(rain,rainF,rainP);assert.equal(rain.added,0);
console.log('behavior_checks',JSON.stringify({deterministicMass:D1.mass,deterministicTopples:D1.totalTopples,
  faceAfter:rest.age[4],stackMax:maximum(V.stack),rainTopRowAdded:rainAdded,liveSourceOff:rain.added}));

const blockedF=field(16,16,'flat'),blockedP={...defaults,source:1};
const blocked=world.init(16,16,blockedF,rng(71),blockedP);replaceMass(blocked,()=>{});
for(let i=0;i<100;i++)checkedStep(blocked,blockedF,blockedP);
assert.equal(blocked.totalAdded,0);assert.equal(blocked.mass,0);
console.log('counterexample_no_downhill',JSON.stringify({steps:100,emitted:blocked.totalAdded,remaining:blocked.mass}));

for(const side of [52,120]){
  const SF=field(side,side),SP={...defaults},state=world.init(side,side,SF,rng(913),SP);
  const occupancies={},bins={'0':0,'1':0,'2':0,'3-5':0,'6-15':0,'16-50':0,'51-200':0,'>200':0};
  let emission=0,removal=0,bottom=0,topples=0,events=0,largest=0,base=0,residual=0;
  for(let g=1;g<=1000;g++){
    if(g===801)base=state.mass;
    residual=Math.max(residual,checkedStep(state,SF,SP));
    if(g===100||g===300||g===600||g===1000)occupancies[g]=+(state.live/state.n).toFixed(6);
    if(g<=800)continue;
    emission+=state.added;removal+=state.out;bottom+=state.bottomOut;topples+=state.avalanche;
    if(state.avalanche)events++;
    largest=Math.max(largest,state.avalanche);
    const a=state.avalanche;
    bins[a<3?String(a):a<=5?'3-5':a<=15?'6-15':a<=50?'16-50':a<=200?'51-200':'>200']++;
  }
  assert.equal(base+emission,state.mass+removal);
  assert.ok(maximum(Object.values(occupancies))<0.6);
  assert.ok(state.totalTopples>0);
  console.log('basin_1000',JSON.stringify({side,occupancies,final200:{window:[801,1000],
    meanEmission:emission/200,meanRemoval:removal/200,meanBottomDrain:bottom/200,
    meanTopples:topples/200,cascades:events,meanCascades:events/200,largest,histogram:bins,massDrift:state.mass-base},
    maxResidual:residual,trappedOrResidentMass:state.mass,totalOut:state.totalOut,
    tail:bins['>200']===200?'all events >200: heavy-tail shape NOT established':
      bins['>200']?'rare large bursts; heavy-tail law NOT established':'no >200-event tail in this window'}));
}

// A monotone draining control distinguishes a real sink from basin trapping.
for(const side of [52,120]){
  const CF=field(side,side),CP={...defaults};
  for(let y=0;y<side;y++)for(let x=0;x<side;x++)
    CF.amp[y*side+x]=0.05+0.78*y/(side-1)+0.12*Math.exp(-(((x/side-0.5)/0.13)**2));
  const state=world.init(side,side,CF,rng(213),CP),occupancies={};
  let emission=0,removal=0,bottom=0,base=0,residual=0;
  for(let g=1;g<=1000;g++){
    if(g===801)base=state.mass;
    residual=Math.max(residual,checkedStep(state,CF,CP));
    if(g===100||g===300||g===600||g===1000)occupancies[g]=+(state.live/state.n).toFixed(6);
    if(g>800){emission+=state.added;removal+=state.out;bottom+=state.bottomOut;}
  }
  assert.equal(base+emission,state.mass+removal);
  assert.ok(bottom>0,'monotone terrain drains through bottom');
  const heights=new Array(9).fill(0);for(const m of state.grains)heights[m]++;
  console.log('draining_control_1000',JSON.stringify({side,occupancies,
    final200:{meanEmission:emission/200,meanRemoval:removal/200,meanBottomDrain:bottom/200,massDrift:state.mass-base},
    maxResidual:residual,remaining:state.mass,heightHistogram:heights}));
}

// Clean timing: 60 warm-up generations, then only step() in 120 timed loops.
for(const side of [52,120]){
  const TF=field(side,side),TP={...defaults,advect:1},T=world.init(side,side,TF,rng(313),TP);
  for(let i=0;i<60;i++)world.step(T,TF,TP);
  const before=T.totalTopples,start=performance.now(),steps=120;
  for(let i=0;i<steps;i++)world.step(T,TF,TP);
  const elapsed=performance.now()-start;
  console.log('timing',JSON.stringify({side,cells:side*side,steps,
    msPerStep:+(elapsed/steps).toFixed(4),topplesPerStep:(T.totalTopples-before)/steps}));
}

const zeroF=field(9,9),zeroP={...defaults};
const zeroA=world.init(9,9,zeroF,rng(913),zeroP),zeroB=world.init(9,9,zeroF,rng(913),zeroP);
assert.equal(world.shake(zeroA,zeroF,0),'burst=0 cascades=0 topples=0 out=0');
checkedStep(zeroA,zeroF,zeroP);checkedStep(zeroB,zeroF,zeroP);
assert.deepEqual(zeroA.grains,zeroB.grains,'zero power neither changes state nor consumes rng');
console.log('shake_recovery_definition trailing32-generation cascade rate within0.125 and mean topplings within max(0.5,25%baseline); first eligible window ends32 generations after impulse; censored at1024');
shakeExperiment(field(52,52),52,0.5,'synthetic-basins');

// Optional integration lane. The default probe above depends only on core and
// grav; --record explicitly opts into FieldKit's real path/hst implementations.
if(process.argv.includes('--record')){
  const recordSource=['data-gsfc.js','w-field.js'].map(file=>
    readFileSync(new URL('../src/'+file,import.meta.url),'utf8')).join('\n');
  const real=new Function(source+'\n'+recordSource+
    '\nreturn {record:prepRecord({...GSFC}),fields:FIELDS};')();
  for(const id of ['path','hst'])for(const side of [52,120]){
    const RF=real.fields.find(f=>f.id===id).build(real.record,side,side,{});
    const RP={...defaults},state=world.init(side,side,RF,rng(913),RP);
    const occupancies={},bins={'0':0,'1':0,'2':0,'3-5':0,'6-15':0,'16-50':0,'51-200':0,'>200':0};
    let emission=0,removal=0,bottom=0,topples=0,events=0,largest=0,base=0,residual=0;
    let minOccupancy=1,maxOccupancy=0;
    for(let g=1;g<=2000;g++){
      if(g===1801)base=state.mass;
      residual=Math.max(residual,checkedStep(state,RF,RP));
      if(g===200||g===600||g===1000||g===2000)occupancies[g]=+(state.live/state.n).toFixed(6);
      if(g<=1800)continue;
      emission+=state.added;removal+=state.out;bottom+=state.bottomOut;topples+=state.avalanche;
      minOccupancy=Math.min(minOccupancy,state.live/state.n);maxOccupancy=Math.max(maxOccupancy,state.live/state.n);
      if(state.avalanche)events++;
      largest=Math.max(largest,state.avalanche);
      const a=state.avalanche;
      bins[a<3?String(a):a<=5?'3-5':a<=15?'6-15':a<=50?'16-50':a<=200?'51-200':'>200']++;
    }
    assert.equal(base+emission,state.mass+removal);
    const heights=new Array(9).fill(0);for(const m of state.grains)heights[m]++;
    const fluxBalanced=emission>0&&removal>0&&Math.abs(emission-removal)<=0.2*emission;
    const occupancyFlat=maxOccupancy-minOccupancy<=0.01&&maxOccupancy<0.6;
    console.log('real_record_2000',JSON.stringify({field:id,side,occupancies,final200:{window:[1801,2000],
      meanEmission:emission/200,meanRemoval:removal/200,meanBottomDrain:bottom/200,
      meanTopples:topples/200,meanCascades:events/200,largest,histogram:bins,
      meanTopplesPerNonzeroCascade:events?+(topples/events).toFixed(6):0,
      occupancyRange:[+minOccupancy.toFixed(6),+maxOccupancy.toFixed(6)],massDrift:state.mass-base},
      maxResidual:residual,residentMass:state.mass,heightHistogram:heights,
      totalAdded:state.totalAdded,totalOut:state.totalOut,sourceDormant:emission===0,
      fluxBalancedWithin20Percent:fluxBalanced,occupancyFlatWithin1Percent:occupancyFlat,
      acceptance:fluxBalanced||occupancyFlat,tail:bins['>200']?
        'large cascades present; heavy-tail law NOT established':'no >200-event tail in this window'}));
  }
  for(const id of ['path','hst'])for(const side of [52,76,120]){
    const FF=real.fields.find(f=>f.id===id).build(real.record,side,side,{});
    const FP={...defaults},state=world.init(side,side,FF,rng(913),FP);
    for(let g=0;g<500;g++)world.step(state,FF,FP);
    let rested=0,stacked=0,tall=0,oldStacked=0;
    for(let i=0;i<state.n;i++){
      const m=state.grains[i],a=state.age[i];
      if(m&&a>=40)rested++;
      if(m>=2&&a>=40)stacked++;
      if(m>=3&&a>=40)tall++;
      if(m>=2&&a>=80)oldStacked++;
    }
    const before=state.grains.slice(),V=world.view(state),faces=sum(V.face);
    assert.deepEqual(state.grains,before,'view cannot change dynamics');
    assert.equal(sum(V.live),state.live);
    assert.ok(faces/state.live>=0.15&&faces/state.live<=0.35);
    for(let i=0;i<state.n;i++)if(V.face[i])assert.ok(state.grains[i]>=2&&state.age[i]>=40);
    const ranked=[];
    for(let i=0;i<state.n;i++)if(state.grains[i]>=2&&state.age[i]>=40)ranked.push(i);
    ranked.sort((a,b)=>state.grains[b]-state.grains[a]||state.age[b]-state.age[a]||a-b);
    const faceCount=Math.min(ranked.length,Math.floor(state.live/4));
    assert.equal(faces,faceCount);
    for(let i=0;i<ranked.length;i++)assert.equal(V.face[ranked[i]],i<faceCount?1:0);
    console.log('faces_generation_500',JSON.stringify({field:id,side,live:state.live,
      candidateCounts:{age40:rested,age40pile2:stacked,age40pile3:tall,age80pile2:oldStacked},
      criterion:'age>=40 and pile>=2; ranked height/age/index; cap25% live',faces,fraction:+(faces/state.live).toFixed(6)}));
  }
  for(const side of [52,76,120]){
    const shakeField=real.fields.find(f=>f.id==='path').build(real.record,side,side,{});
    for(const power of [0.2,0.5,1])shakeExperiment(shakeField,side,power,'path');
  }
}

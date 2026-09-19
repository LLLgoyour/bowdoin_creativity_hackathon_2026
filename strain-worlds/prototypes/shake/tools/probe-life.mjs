import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';

const here = new URL('../src/', import.meta.url);
const {life, random} = new Function(readFileSync(new URL('core.js', here), 'utf8') + '\n' +
  readFileSync(new URL('w-life.js', here), 'utf8') +
  '\nreturn {life:worldById(\"life\"), random:mulberry32};')();
const base = Object.fromEntries(life.params.map(p => [p.key, p.def]));
const names = ['LIFE','HIGHLIFE','MAZE','2×2','CORAL','DIAMOEBA','DAY&NIGHT','SEEDS'];
const specs = [['3','23'],['36','23'],['3','12345'],['36','125'],['3','45678'],['35678','5678'],['3678','34678'],['2','']];
const hash = a => createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex').slice(0, 16);
function checkView(S) {
  const V=life.view(S); let alive=0, ghosts=0, drawn=0;
  for(let i=0;i<V.n;i++) {
    if(V.live[i]) alive++;
    if(!V.live[i]&&V.flip[i]>0) ghosts++;
    if(V.live[i]||V.flip[i]>0) drawn++;
  }
  assert.equal(alive,life.stats(S));
  assert.equal(drawn-ghosts,life.stats(S));
  return alive;
}

function blank(w, h = w) {
  return {w, h, mask:new Uint8Array(w*h), amp:new Float32Array(w*h),
    ph:new Float32Array(w*h), freq:new Float32Array(w*h), occ:new Float32Array(w*h).fill(1)};
}
function bands(n) {
  // Independent synthetic, widening 11-turn trace; no field module or embedded record.
  const field = blank(n), re = new Float64Array(n), im = new Float64Array(n), k = 6;
  for (let y=0;y<n;y++) { const t=y/(n-1), a=0.015+0.985*t, p=22*Math.PI*t;
    re[y]=a*Math.cos(p); im[y]=a*Math.sin(p); field.amp.fill(a,y*n,(y+1)*n); }
  const ranks = Array.from({length:n},(_,y)=>Array.from({length:n},(_,x)=>x).filter(x=>x!==y)
    .sort((a,b)=>(re[y]-re[a])**2+(im[y]-im[a])**2-((re[y]-re[b])**2+(im[y]-im[b])**2)).slice(0,k));
  for (let r=0;r<k;r++) for (let y=0;y<n;y++) { const x=ranks[y][r], prev=y?ranks[y-1][r]:-1;
    field.mask[y*n+x]=1; if (prev>=0&&Math.abs(x-prev)<=Math.max(4,n/3))
      for(let j=Math.min(x,prev);j<=Math.max(x,prev);j++) field.mask[y*n+j]=1; }
  for(let y=0;y<n;y++) field.mask[y*n+y]=1;
  for(let y=0;y<n;y++) for(let x=0;x<n;x++) { let count=0;
    for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) count+=field.mask[((y+dy+n)%n)*n+(x+dx+n)%n];
    field.occ[y*n+x]=count/9; }
  return field;
}
function run(field, rule, gens = 200, seed = 20260919, extra = {}) {
  const P = {...base, rule, ...extra}, S = life.init(field.w,field.h,field,random(seed),P);
  const pop = [], checkpoints = [20,50,100,200]; let last20=0, extinct=0;
  checkView(S);
  for(let g=1;g<=gens;g++) { life.step(S,field,P);
    if(checkpoints.includes(g)) { pop.push(life.stats(S)); checkView(S); }
    if(g===60) checkView(S);
    if(g>gens-20) last20+=S.births; if(!S.live&&!extinct) extinct=g; }
  checkView(S);
  return {S, P, pop, last20, extinct};
}

// Exhaust the actual local-rule truth table; counts are never amplified.
let truthCases=0;
const offsets = [-8,-7,-6,-1,1,6,7,8], centre=24;
for(let r=0;r<8;r++) for(let alive=0;alive<2;alive++) for(let count=0;count<=8;count++) {
  const field=blank(7), P={...base,rule:r,wrap:0}; field.mask[centre]=alive;
  for(let j=0;j<count;j++) field.mask[centre+offsets[j]]=1;
  const S=life.init(7,7,field,random(42),P); life.step(S,field,P);
  assert.equal(S.st[centre],Number(specs[r][alive].includes(String(count))), `${names[r]} alive=${alive} n=${count}`);
  truthCases++;
}
console.log(`rule_truth_table cases=${truthCases} mismatches=0`);

console.log('historical_removed_gain priorVerifiedRun=1 rerun=0 synthetic192k6 floor=0.5 occupancySwapGen20to100 differingCells=375 (not shipped behaviour)');

const field=bands(192);
console.log(`substrate synthetic=11-turn-widening-spiral n=192 k=6 mask=${field.mask.reduce((a,b)=>a+b,0)} occupancy=true-3x3`);
for(let r=0;r<8;r++) {
  const a=run(field,r);
  console.log(`${names[r].padEnd(10)} B${specs[r][0]}/S${specs[r][1]} pop20/50/100/200=${a.pop.join('/')} births181-200=${a.last20} extinctGen=${a.extinct||'-'}`);
}

const a=run(field,base.rule), b=run(field,base.rule);
assert.deepEqual(Buffer.from(a.S.st),Buffer.from(b.S.st));
assert.deepEqual(Buffer.from(a.S.age.buffer),Buffer.from(b.S.age.buffer));
console.log(`determinism seed=20260919 gen=200 boardA=${hash(a.S.st)} boardB=${hash(b.S.st)} ageA=${hash(a.S.age)} ageB=${hash(b.S.age)} byteIdentical=1`);
const populationView=life.view(a.S);
console.log(`live_view stats=${life.stats(a.S)} liveFlags=${populationView.live.reduce((sum,v)=>sum+v,0)} substrate=${field.mask.reduce((sum,v)=>sum+v,0)} deathGhosts=${populationView.flip.reduce((sum,v,i)=>sum+Number(!populationView.live[i]&&v>0),0)}`);

const evolving=run(field,base.rule,20), changed=run(field,base.rule,20);
changed.P.ruleRows=1;
for(let i=0;i<80;i++) { life.step(evolving.S,field,evolving.P); life.step(changed.S,field,changed.P); }
let different=0;
for(let i=0;i<field.mask.length;i++) different+=evolving.S.st[i]!==changed.S.st[i];
assert.ok(different>0);
console.log(`ongoing_data rowRuleToggle fromGen20 toGen100 uniformPop=${evolving.S.live} loudnessRulesPop=${changed.S.live} differingCells=${different}`);

const rows=blank(7,8), rowP={...base,ruleRows:1};
for(let y=0;y<8;y++) rows.amp.fill((y+.5)/8,y*7,(y+1)*7);
const rowS=life.init(7,8,rows,random(1),rowP);
assert.equal(Array.from(rowS.rowRule).join(','),'0,1,2,3,4,5,6,7');
rows.amp.fill(1); life.step(rowS,rows,rowP); assert.ok(rowS.rowRule.every(r=>r===7));
rowP.ruleRows=0; rowP.rule=1; life.step(rowS,rows,rowP); assert.ok(rowS.rowRule.every(r=>r===1));
console.log('row_rules quiet→loud=0,1,2,3,4,5,6,7 quiet=LIFE loud=SEEDS liveFieldChange=8/8 liveToggleChange=8/8');

const rowBirth=blank(7); rowBirth.mask[23]=rowBirth.mask[24]=rowBirth.mask[25]=1;
const RP={...base,ruleRows:1}, quiet=life.init(7,7,rowBirth,random(9),RP);
life.step(quiet,rowBirth,RP); rowBirth.amp.fill(1);
const loud=life.init(7,7,rowBirth,random(9),RP); life.step(loud,rowBirth,RP);
assert.equal(quiet.st[17],1); assert.equal(loud.st[17],0);
console.log(`row_rule_dynamics quietB3=${quiet.st[17]} loudB3=${loud.st[17]}`);

const seam=blank(7); seam.mask[21]=seam.mask[22]=seam.mask[27]=1;
const wrapped=life.init(7,7,seam,random(1),{...base,rule:0});
const bounded=life.init(7,7,seam,random(1),{...base,rule:0,wrap:0});
life.step(wrapped,seam,{...base,rule:0}); life.step(bounded,seam,{...base,rule:0,wrap:0});
assert.equal(wrapped.live,3); assert.equal(bounded.live,0);
console.log(`wrap seamBlinkerWrapped=${wrapped.live} openBoundary=${bounded.live}`);

const gravity=blank(5), GP={...base,rule:2,gravity:1,wrap:1};
gravity.mask[21]=gravity.mask[22]=1;
const GS=life.init(5,5,gravity,random(8),GP); GS.age[21]=17; life.step(GS,gravity,GP);
assert.equal(GS.st[1]+GS.st[2],2); assert.equal(GS.live,2); assert.equal(GS.age[1],18);
assert.equal(GS.st[6]+GS.st[7],0);
GP.gravity=0; life.step(GS,gravity,GP); assert.equal(GS.st[1]+GS.st[2],2);
console.log('gravity seamFallRows=1 transportedAge=18 population=2 liveToggleStopsFall=1');

const dense=blank(7); dense.mask.fill(1);
const denseS=life.init(7,7,dense,random(2),base), initialView=checkView(denseS);
for(let g=0;g<60;g++) life.step(denseS,dense,base);
const finalView=checkView(denseS);
assert.equal(initialView,49); assert.equal(finalView,0);
console.log(`view_refresh gen0=${initialView} gen60=${finalView} staleAfterView=0`);

const dying=blank(7), DP={...base,rule:0,wrap:0}; dying.mask[24]=1;
const DS=life.init(7,7,dying,random(1),DP); life.step(DS,dying,DP);
assert.equal(life.view(DS).live[24],0); assert.equal(DS.V.flip[24],1);
let visibleSteps=0; while(DS.V.flip[24]>0) { visibleSteps++; life.step(DS,dying,DP); }
assert.equal(visibleSteps,12);
const old=blank(7); old.mask[16]=old.mask[17]=old.mask[23]=old.mask[24]=1;
const OS=life.init(7,7,old,random(1),DP); OS.age[16]=0; OS.age[17]=12; OS.age[23]=26; OS.age[24]=13;
const V=life.view(OS);
assert.equal(V.face[16],0); assert.equal(V.face[17],0); assert.equal(V.face[23],1);
assert.notEqual(V.col[16],V.col[17]); assert.notEqual(V.col[17],V.col[23]);
const birth=blank(7); birth.mask[23]=birth.mask[24]=birth.mask[25]=1;
let sparkBirths=0;
for(let seed=1;seed<=100;seed++) {
  const BS=life.init(7,7,birth,random(seed),DP); life.step(BS,birth,DP);
  assert.equal(BS.age[17],0); assert.ok(BS.V.spark[17]===0||BS.V.spark[17]===1);
  sparkBirths+=BS.V.spark[17]+BS.V.spark[31];
}
assert.ok(sparkBirths>10&&sparkBirths<40);
console.log(`view deathVisibleSteps=${visibleSteps} ageColours=${V.col[16]},${V.col[17]},${V.col[23]} faces=${V.face[16]},${V.face[17]},${V.face[23]} sparkEligibleBirths=${sparkBirths}/200 appOwnsSparkDecay=1`);

for(const population of [14,10,12,1,2,3]) {
  const f=blank(5,3); f.mask.fill(1,0,population);
  const S=life.init(5,3,f,random(7),base); S.age.fill(20);
  const faces=life.view(S).face.reduce((a,b)=>a+b,0);
  assert.equal(faces,Math.floor(population/4)); assert.equal(S.live,population);
  console.log(`face_cap live=${population} faces=${faces} fraction=${(faces/population).toFixed(4)}`);
}
for(let seed=1;seed<=32;seed++) {
  const f=blank(11,7), rng=random(seed);
  for(let i=0;i<f.mask.length;i++) f.mask[i]=rng()<.65?1:0;
  const S=life.init(11,7,f,random(seed),base);
  for(let i=0;i<S.n;i++) S.age[i]=(rng()*50)|0;
  const expected=Array.from({length:S.n},(_,i)=>i).filter(i=>S.st[i]&&S.age[i]>=12)
    .sort((a,b)=>S.age[b]-S.age[a]||a-b).slice(0,Math.floor(S.live/4)).sort((a,b)=>a-b);
  const view=life.view(S), actual=Array.from({length:S.n},(_,i)=>i).filter(i=>view.face[i]);
  assert.deepEqual(actual,expected);
}
console.log('face_ranking oracleCases=32 mismatches=0 below4Suppressed=1');

for(const n of [52,120]) {
  const f=bands(n), P={...base}, S=life.init(n,n,f,random(20260919),P);
  for(let i=0;i<100;i++) life.step(S,f,P);
  const start=performance.now(), steps=2000;
  for(let i=0;i<steps;i++) life.step(S,f,P);
  console.log(`timing ${n}x${n} steps=${steps} msPerStep=${((performance.now()-start)/steps).toFixed(4)} finalPop=${S.live}`);
}

// Independent shipped-field geometry, intentionally not importing w-field.js.
// Grid-k4 is the shipped default; the all-773 estimator remains an explicit variant.
const packed=new Function(readFileSync(new URL('data-gsfc.js',here),'utf8')+'; return GSFC;')();
const decode=s=>new Float64Array(Uint8Array.from(Buffer.from(s,'base64')).buffer);
const record={re:decode(packed.re),im:decode(packed.im)};
const gaps=new Float64Array(record.re.length), distances=new Float64Array(record.re.length-1);
let amax=0;
for(let i=0;i<record.re.length;i++) {
  amax=Math.max(amax,Math.hypot(record.re[i],record.im[i]));
  let j=0;
  for(let k=0;k<record.re.length;k++) if(k!==i)
    distances[j++]=Math.hypot(record.re[i]-record.re[k],record.im[i]-record.im[k]);
  distances.sort(); gaps[i]=distances[3];
}
gaps.sort();
const radius=gaps[gaps.length>>1];
function recurrence(n, gapSpace) {
  const f=blank(n), raw=new Uint8Array(n*n), dilated=new Uint8Array(n*n);
  const ix=Array.from({length:n},(_,i)=>Math.round(i*(record.re.length-1)/(n-1)));
  let eps=radius;
  if(gapSpace==='grid') {
    const sampledGaps=new Float64Array(n), rowDistances=new Float64Array(n-1);
    for(let y=0;y<n;y++) {
      let j=0;
      for(let x=0;x<n;x++) if(x!==y)
        rowDistances[j++]=Math.hypot(record.re[ix[y]]-record.re[ix[x]],record.im[ix[y]]-record.im[ix[x]]);
      rowDistances.sort(); sampledGaps[y]=rowDistances[3];
    }
    sampledGaps.sort();
    eps=(sampledGaps[(n-1)>>1]+sampledGaps[n>>1])/2;
  }
  for(let y=0;y<n;y++) {
    const yi=ix[y], amp=Math.hypot(record.re[yi],record.im[yi])/amax;
    f.amp.fill(amp,y*n,(y+1)*n);
    for(let x=0;x<n;x++) raw[y*n+x]=Number(
      Math.hypot(record.re[yi]-record.re[ix[x]],record.im[yi]-record.im[ix[x]])<=eps);
  }
  for(let y=0;y<n;y++) for(let x=0;x<n;x++) {
    let any=0;
    for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++)
      any|=raw[((y+dy+n)%n)*n+(x+dx+n)%n];
    dilated[y*n+x]=any;
  }
  for(let y=0;y<n;y++) for(let x=0;x<n;x++) {
    let all=1;
    for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++)
      all&=dilated[((y+dy+n)%n)*n+(x+dx+n)%n];
    f.mask[y*n+x]=all;
  }
  const histogram=new Uint32Array(9);
  for(let y=0;y<n;y++) for(let x=0;x<n;x++) {
    let neighbours=0;
    for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++)
      if(dx||dy) neighbours+=f.mask[((y+dy+n)%n)*n+(x+dx+n)%n];
    f.occ[y*n+x]=(neighbours+f.mask[y*n+x])/9;
    if(f.mask[y*n+x]) histogram[neighbours]++;
  }
  return {f,histogram,eps};
}
console.log(`recurrence record=${record.re.length} defaultGapSpace=grid alternateGapSpace=raw sampling=round-index closing=Chebyshev1-torus`);
for(const gapSpace of ['grid','raw']) for(const n of [52,120]) {
  const {f,histogram,eps}=recurrence(n,gapSpace), P={...base}, S=life.init(n,n,f,random(20260919),P);
  const checkpoints=[20,50,100,200,500,1000,2000], populations=[S.live];
  let events=0, activeSteps=0, births=0, deaths=0;
  const start=performance.now();
  for(let gen=1;gen<=2000;gen++) {
    life.step(S,f,P);
    if(checkpoints.includes(gen)) { populations.push(S.live); checkView(S); }
    if(gen===60) checkView(S);
    if(gen>1900) { births+=S.births; deaths+=S.deaths;
      const count=S.births+S.deaths; events+=count; if(count) activeSteps++; }
  }
  const ms=(performance.now()-start)/2000;
  checkView(S);
  console.log(`recurrence gapSpace=${gapSpace} ${n}x${n} eps=${eps.toFixed(9)} mask=${populations[0]} neighbourHistogram0to8=${Array.from(histogram).join(',')}`);
  console.log(`recurrence LIFE gapSpace=${gapSpace} ${n}x${n} pop0/20/50/100/200/500/1000/2000=${populations.join('/')} final100BirthsPerGen=${(births/100).toFixed(2)} deathsPerGen=${(deaths/100).toFixed(2)} eventsPerGen=${(events/100).toFixed(2)} activeSteps=${activeSteps}/100 lastStepEvents=${S.births+S.deaths} state=${activeSteps?'active':'settled'} msPerStep=${ms.toFixed(4)}`);
}

const gravityField=recurrence(52,'grid').f;
for(const gravity of [0,1]) {
  const P={...base,gravity}, S=life.init(52,52,gravityField,random(20260919),P);
  for(let gen=1;gen<=240;gen++) {
    life.step(S,gravityField,P);
    if(gen===60||gen===240) {
      let rows=0,lowest=-1;
      for(let i=0;i<S.n;i++) if(S.st[i]) { const y=Math.floor(i/52); rows+=y; lowest=Math.max(lowest,y); }
      console.log(`falling_variant grid52 gravity=${gravity} gen=${gen} pop=${S.live} centroid=${(rows/S.live).toFixed(4)} lowest=${lowest}`);
    }
  }
}

// Shake measurements use the canonical rule, no falling, and the shipped grid-k4 field.
function warmShake(f) {
  const P={...base,rule:0}, S=life.init(f.w,f.h,f,random(20260919),P);
  let population=0,births=0,deaths=0;
  for(let gen=1;gen<=2000;gen++) {
    life.step(S,f,P);
    if(gen>1900) { population+=S.live; births+=S.births; deaths+=S.deaths; }
  }
  life.view(S);
  return {S,P,population:population/100,births:births/100,deaths:deaths/100};
}
function viewBytes(S) {
  return Buffer.concat(Object.values(S.V).filter(v=>ArrayBuffer.isView(v))
    .map(v=>Buffer.from(v.buffer,v.byteOffset,v.byteLength)));
}
function stateBytes(S) {
  return Buffer.concat(Object.values(S).filter(v=>ArrayBuffer.isView(v))
    .map(v=>Buffer.from(v.buffer,v.byteOffset,v.byteLength)));
}
console.log('shake_definition rule=LIFE B3/S23 substrate=grid-k4 seed=20260919 warmup=2000 baseline=last100 recoveryHorizon=2000 window=20 confirmationWindows=20 tolerance=20pct absoluteFloor=2 sustainedReturn=terminalQualifyingRunConfirmedThroughHorizon firstCrossing=firstQualifyingWindow mapping=power/8 maskReadOnly=1 existingLivePreserved=1');
let minFullPower=Infinity, unchangedViews=0, replayCases=0;
for(const n of [52,76,120]) for(const power of [0.2,0.5,1]) {
  const f=recurrence(n,'grid').f, control=warmShake(f), replay=warmShake(f);
  const {S,P}=control, R=replay.S, before=S.live;
  const boardBefore=S.st.slice(), ageBefore=S.age.slice(), maskBefore=hash(f.mask);
  const visualBefore=viewBytes(S), stateBefore=stateBytes(S);
  assert.deepEqual(stateBefore,stateBytes(R));
  const started=performance.now(), returned=life.shake(S,f,power), kickMs=performance.now()-started;
  const replayed=life.shake(R,f,power);
  assert.equal(returned,replayed); assert.deepEqual(stateBytes(S),stateBytes(R));
  assert.deepEqual(viewBytes(S),visualBefore); unchangedViews++;
  assert.equal(hash(f.mask),maskBefore); assert.equal(S.gen,2000);
  assert.equal(S.live,before+S.births); assert.equal(S.deaths,0);
  assert.ok(S.live>=before&&S.live>0);
  for(let i=0;i<S.n;i++) {
    if(boardBefore[i]) assert.equal(S.st[i],1);
    if(!f.mask[i]) { assert.equal(S.st[i],boardBefore[i]); assert.equal(S.age[i],ageBefore[i]); }
  }
  const immediatePop=S.live, immediateBirths=S.births, immediateHash=hash(S.st);
  const pops=new Float64Array(2000), birthCounts=new Float64Array(2000), deathCounts=new Float64Array(2000);
  let sumPop=0,sumBirth=0,sumDeath=0,streakPop=0,streakBirth=0,streakBoth=0;
  let recoverPop=0,recoverBirth=0,recoverBoth=0,firstPop=0,firstBirth=0,firstDeath=0;
  let mean20Pop=0,mean20Birth=0,mean20Death=0,minimum=S.live;
  for(let gen=1;gen<=2000;gen++) {
    life.step(S,f,P); minimum=Math.min(minimum,S.live);
    if(gen<=60) {
      life.step(R,f,replay.P);
      assert.deepEqual(stateBytes(S),stateBytes(R));
      assert.deepEqual(viewBytes(S),viewBytes(R));
    }
    if(gen===1) { firstPop=S.live; firstBirth=S.births; firstDeath=S.deaths; }
    const i=gen-1;
    pops[i]=S.live; birthCounts[i]=S.births; deathCounts[i]=S.deaths;
    sumPop+=S.live; sumBirth+=S.births; sumDeath+=S.deaths;
    if(gen>20) { sumPop-=pops[i-20]; sumBirth-=birthCounts[i-20]; sumDeath-=deathCounts[i-20]; }
    if(gen===20) { mean20Pop=sumPop/20; mean20Birth=sumBirth/20; mean20Death=sumDeath/20; }
    if(gen>=20) {
      const nearPop=Math.abs(sumPop/20-control.population)<=Math.max(2,control.population*.2);
      const nearBirth=Math.abs(sumBirth/20-control.births)<=Math.max(2,control.births*.2);
      streakPop=nearPop?streakPop+1:0; streakBirth=nearBirth?streakBirth+1:0;
      streakBoth=nearPop&&nearBirth?streakBoth+1:0;
      if(!recoverPop&&nearPop) recoverPop=gen;
      if(!recoverBirth&&nearBirth) recoverBirth=gen;
      if(!recoverBoth&&nearPop&&nearBirth) recoverBoth=gen;
    }
  }
  replayCases++;
  if(power===1) { minFullPower=Math.min(minFullPower,minimum); assert.ok(minimum>0); }
  const recovery=n=>n||'>2000';
  const sustained=streak=>streak>=20?2000-streak+20:'>2000';
  console.log(`shake LIFE ${n}x${n} power=${power.toFixed(1)} prePop=${before} baselinePop/B/D=${control.population.toFixed(2)}/${control.births.toFixed(2)}/${control.deaths.toFixed(2)} instantPop/B/D=${immediatePop}/${immediateBirths}/0 nextPop/B/D=${firstPop}/${firstBirth}/${firstDeath} first20MeanPop/B/D=${mean20Pop.toFixed(2)}/${mean20Birth.toFixed(2)}/${mean20Death.toFixed(2)} sustainedReturnPop/B/joint=${sustained(streakPop)}/${sustained(streakBirth)}/${sustained(streakBoth)} firstCrossingPop/B/joint=${recovery(recoverPop)}/${recovery(recoverBirth)}/${recovery(recoverBoth)} final20MeanPop/B/D=${(sumPop/20).toFixed(2)}/${(sumBirth/20).toFixed(2)}/${(sumDeath/20).toFixed(2)} minPop=${minimum} replayHash=${immediateHash} callMs=${kickMs.toFixed(4)}`);
  console.log(`shake_return ${n}x${n} power=${power.toFixed(1)} "${returned}"`);
}
const zeroField=recurrence(52,'grid').f, zero=warmShake(zeroField), untouched=warmShake(zeroField);
const zeroState=stateBytes(zero.S), zeroView=viewBytes(zero.S), zeroString=life.shake(zero.S,zeroField,0);
assert.deepEqual(stateBytes(zero.S),zeroState); assert.deepEqual(viewBytes(zero.S),zeroView);
for(let gen=0;gen<20;gen++) {
  life.step(zero.S,zeroField,zero.P); life.step(untouched.S,zeroField,untouched.P);
  assert.deepEqual(stateBytes(zero.S),stateBytes(untouched.S)); assert.deepEqual(viewBytes(zero.S),viewBytes(untouched.S));
}
console.log(`shake_safety fullPowerMinimumPopOver2000=${minFullPower} deterministicCases=${replayCases}/9 unchangedViewCases=${unchangedViews}/9 zeroPowerNoOp=1 zeroReturn="${zeroString}"`);

const ghostField=blank(5); ghostField.mask[12]=1;
const ghostState=life.init(5,5,ghostField,random(1),base);
life.step(ghostState,ghostField,base); life.view(ghostState);
assert.equal(ghostState.V.flip[12],1);
const ghostVisual=viewBytes(ghostState);
life.shake(ghostState,ghostField,1);
assert.equal(ghostState.st[12],1); assert.deepEqual(viewBytes(ghostState),ghostVisual);
life.view(ghostState);
assert.equal(ghostState.V.live[12],1); assert.equal(ghostState.V.flip[12],0);
console.log('shake_revival live=1 staleDeathFlip=0 viewWritesDuringShake=0');

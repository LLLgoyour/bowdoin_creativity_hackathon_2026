/* Gravity is a driven, open-boundary sandpile on the record's terrain.
   H = 1 - amp: the quietest point is one terrain unit above the loudest.
   This monotone map preserves small amplitude differences without letting the
   few loud peaks erase the record's quieter valleys. Public grains stay 0..8;
   a separate integer work buffer holds the transient avalanche in flight. */
(()=>{
function loudColumn(S){
  let x=-1,highest=-1,ties=0;
  for(let j=0;j<S.w;j++){
    if(S.selected[j])continue;
    if(S.columnAmp[j]>highest){
      highest=S.columnAmp[j];x=j;ties=1;
    }else if(S.columnAmp[j]===highest){
      ties++;if(S.rng()*ties<1)x=j;
    }
  }
  S.selected[x]=1;
  return x;
}

function relax(S,animate){
  const n=S.n,m=S.work,nb=S.neighbours,V=S.V,changed=S.changed;
  const threshold=S.toppleThreshold,queue=S.queue,queued=S.queued;
  let head=0,tail=0,pending=0;
  for(let i=0;i<n;i++){
    if(m[i]<=threshold)continue;
    queue[tail]=i;if(++tail===n)tail=0;pending++;queued[i]=1;
  }
  let waveRemaining=pending;
  if(pending)S.avalancheDuration=1;
  while(pending){
    const i=queue[head];if(++head===n)head=0;pending--;queued[i]=0;
    const count=Math.floor((m[i]-threshold+3)/4);
    m[i]-=count*4;S.avalanche+=count;changed[i]=1;
    if(animate){V.spark[i]=1;V.flip[i]=1;}
    for(let d=0;d<4;d++){
      const j=nb[i*4+d];
      if(j<0){S.out+=count;continue;}
      m[j]+=count;changed[j]=1;
      if(animate)V.lift[j]=-0.35;
      if(m[j]>threshold&&!queued[j]){
        queue[tail]=j;if(++tail===n)tail=0;pending++;queued[j]=1;
      }
    }
    if(--waveRemaining===0&&pending){
      S.avalancheDuration++;waveRemaining=pending;
    }
  }
  for(let i=n-S.w;i<n;i++){S.bottomOut+=m[i];m[i]=0;}
  S.out+=S.bottomOut;
}

function commit(S,tick){
  let mass=0,live=0;
  for(let i=0;i<S.n;i++){
    const m=S.work[i];
    S.grains[i]=m;mass+=m;
    if(m){
      live++;S.age[i]=S.changed[i]?0:Math.min(65535,S.age[i]+tick);
    }else S.age[i]=0;
  }
  S.mass=mass;S.live=live;S.gen+=tick;
  S.totalAdded+=S.added;S.totalOut+=S.out;S.totalTopples+=S.avalanche;
  if(S.avalanche){
    S.avalancheEvents++;
    if(S.avalanche>S.largestAvalanche)S.largestAvalanche=S.avalanche;
  }
}

function trackActivity(S){
  const old=S.activity[S.activityCursor];
  S.activityTotal+=S.avalanche-old;
  S.activityEvents+=(S.avalanche>0?1:0)-(old>0?1:0);
  S.activity[S.activityCursor]=S.avalanche;
  S.activityCursor=(S.activityCursor+1)&31;
  S.activityCount=Math.min(32,S.activityCount+1);
  if(!S.shakeTracking)return;
  S.shakeElapsed++;
  if(S.shakeElapsed<32)return;
  const rate=S.activityEvents/32,mean=S.activityTotal/32;
  if(Math.abs(rate-S.shakeBaselineRate)<=0.125&&
      Math.abs(mean-S.shakeBaselineTopples)<=Math.max(0.5,S.shakeBaselineTopples*0.25)){
    S.shakeRecovery=S.shakeElapsed;S.shakeTracking=0;
  }
}

defWorld({
  id:'grav', label:'GRAVITY',
  blurb:'Loud valleys collect avalanches; the eyes are the tallest rested piles.',
  params:[
    {key:'gravity',label:'terrain gravity',min:0,max:8,step:0.1,def:3},
    {key:'slope',label:'topple above (4-card minimum)',min:2,max:8,step:1,def:4},
    {key:'source',label:'record feed',min:0,max:1,step:0.01,def:0.18},
    {key:'sources',label:'loud source columns',min:1,max:16,step:1,def:6},
    {key:'advect',label:'phase steers falls',min:0,max:1,step:1,def:0}
  ],
  init(w,h,field,rng,PAR){
    const n=w*h, grains=new Uint8Array(n), age=new Uint16Array(n);
    const height=new Float32Array(n), neighbours=new Int32Array(n*4);
    let mass=0, live=0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=y*w+x, p=i*4;
      height[i]=1-clamp(field.amp[i],0,1);
      neighbours[p]=y?i-w:-1;
      neighbours[p+1]=x<w-1?i+1:-1;
      neighbours[p+2]=y<h-1?i+w:-1;
      neighbours[p+3]=x?i-1:-1;
      grains[i]=rng()<0.35?1+Math.floor(rng()*2):0;
      age[i]=grains[i]?Math.floor(rng()*40):0;
      mass+=grains[i];if(grains[i])live++;
    }
    return {w,h,n,rng,grains,age,height,neighbours,V:newView(n),
      work:new Uint32Array(n), faceHeap:new Float64Array(Math.floor(n/4)),
      queue:new Int32Array(n), queued:new Uint8Array(n),
      changed:new Uint8Array(n), columnAmp:new Float32Array(w),
      selected:new Uint8Array(w),
      activity:new Float64Array(32),activityCursor:0,activityCount:0,activityTotal:0,activityEvents:0,
      toppleThreshold:clamp(Math.round(PAR.slope??4),3,8),
      sourceCount:clamp(Math.round(PAR.sources??6),1,w),
      shakeTracking:0,shakeElapsed:0,shakeRecovery:-1,shakeCount:0,
      shakeBaselineRate:0,shakeBaselineTopples:0,shakeAdded:0,shakeOut:0,shakeTopples:0,shakeCascades:0,
      colours:new Uint8Array([2,9,6,3,8,0,5,1]),
      gen:0,live,mass,initialMass:mass,
      added:0,out:0,bottomOut:0,totalAdded:0,totalOut:0,slides:0,
      avalanche:0,avalancheDuration:0,avalancheEvents:0,totalTopples:0,largestAvalanche:0};
  },
  step(S,field,PAR){
    const n=S.n, m=S.work, grains=S.grains, V=S.V, rng=S.rng;
    const H=S.height, nb=S.neighbours, changed=S.changed;
    const gravity=1+clamp(PAR.gravity??3,0,8);
    // Four outgoing grains require at least four incoming grains, even at 2.
    S.toppleThreshold=clamp(Math.round(PAR.slope??4),3,8);
    const advect=PAR.advect>=0.5;
    S.added=0;S.out=0;S.bottomOut=0;S.slides=0;S.avalanche=0;S.avalancheDuration=0;
    S.columnAmp.fill(0);S.selected.fill(0);
    changed.fill(0);
    for(let i=0;i<n;i++){
      m[i]=grains[i];
      V.flip[i]=Math.max(0,V.flip[i]-0.09);
      V.spark[i]=Math.max(0,V.spark[i]-0.12);
      V.lift[i]=Math.min(0,V.lift[i]+0.12);
      // Column peaks are refreshed from the current record without allocation.
      const x=i%S.w;
      if(field.amp[i]>S.columnAmp[x])S.columnAmp[x]=field.amp[i];
    }
    // Alternate a fixed sweep, and move at most one original top card per cell.
    // Received cards cannot get an extra turn merely because of sweep order.
    const reverse=S.gen&1, increment=reverse?-1:1;
    for(let i=reverse?n-1:0;i>=0&&i<n;i+=increment){
      if(!grains[i]||!m[i])continue;
      const own=gravity*H[i]+(m[i]-1)*0.125;
      const cx=advect?Math.cos(field.ph[i]):0;
      const cy=advect?Math.sin(field.ph[i]):0;
      let best=-1, bestPotential=Infinity, ties=0;
      for(let d=0;d<4;d++){
        const j=nb[i*4+d];
        if(j<0||m[j]>=8||H[j]>=H[i])continue;
        const landing=gravity*H[j]+m[j]*0.125;
        // The phase force may select a different downhill route, never uphill.
        if(landing>=own)continue;
        const drift=d===0?-cy:d===1?cx:d===2?cy:-cx;
        const potential=landing-(advect?0.08*drift:0);
        if(potential<bestPotential-1e-7){
          best=j;bestPotential=potential;ties=1;
        }else if(Math.abs(potential-bestPotential)<=1e-7){
          ties++;if(rng()*ties<1)best=j;
        }
      }
      if(best<0)continue;
      m[i]--;m[best]++;S.slides++;
      changed[i]=1;changed[best]=1;
      V.flip[i]=1;V.lift[best]=-0.65;
    }
    // Rain only above the K loudest columns, at most one grain per column.
    // The terrain must actually offer a downhill route; a flat or sealed
    // source emits nothing instead of silently filling an immobile board.
    const sources=clamp(Math.round(PAR.sources??6),1,S.w);
    S.sourceCount=sources;
    const feed=clamp(PAR.source??0.18,0,1);
    for(let k=0;k<sources;k++){
      const x=loudColumn(S);
      if(S.columnAmp[x]<=0||m[x]>=8)continue;
      let downhill=false;
      for(let d=0;d<4;d++){
        const j=nb[x*4+d];
        if(j>=0&&m[j]<8&&H[j]<H[x]){downhill=true;break;}
      }
      if(!downhill||rng()>=feed)continue;
      m[x]++;S.added++;changed[x]=1;V.lift[x]=-0.9;
    }
    // Same conservative relaxation is used by an ordinary generation and shake.
    relax(S,true);
    commit(S,1);
    trackActivity(S);
  },
  shake(S,field,power){
    power=clamp(power,0,1);
    if(!power)return 'burst=0 cascades=0 topples=0 out=0';
    S.shakeBaselineRate=S.activityCount?S.activityEvents/S.activityCount:0;
    S.shakeBaselineTopples=S.activityCount?S.activityTotal/S.activityCount:0;
    S.shakeTracking=1;S.shakeElapsed=0;S.shakeRecovery=-1;S.shakeCount++;
    S.added=0;S.out=0;S.bottomOut=0;S.slides=0;S.avalanche=0;S.avalancheDuration=0;
    S.columnAmp.fill(0);S.selected.fill(0);S.changed.fill(0);
    for(let i=0;i<S.n;i++){
      S.work[i]=S.grains[i];
      const x=i%S.w;
      if(field.amp[i]>S.columnAmp[x])S.columnAmp[x]=field.amp[i];
    }
    // A finite external impulse, not a persistent tilt: at full power sixteen
    // grains land in each loud source column. Only model state is touched.
    const perColumn=Math.ceil(16*power);
    for(let k=0;k<S.sourceCount;k++){
      const x=loudColumn(S);
      S.work[x]+=perColumn;S.changed[x]=1;S.added+=perColumn;
    }
    relax(S,false);
    commit(S,0);
    S.shakeAdded=S.added;S.shakeOut=S.out;S.shakeTopples=S.avalanche;
    S.shakeCascades=S.avalanche>0?1:0;
    return 'burst='+S.shakeAdded+' cascades='+S.shakeCascades+
      ' topples='+S.shakeTopples+' out='+S.shakeOut;
  },
  stats(S){return S.live;},
  view(S){
    const V=S.V,heap=S.faceHeap,limit=Math.floor(S.live/4),stride=S.n+1;
    let count=0;
    for(let i=0;i<S.n;i++){
      const m=S.grains[i];
      V.live[i]=m?1:0;V.col[i]=m?S.colours[m-1]:0;
      V.stack[i]=m?Math.min(4,m-1):0;
      V.face[i]=0;
      V.spin[i]=0;
      if(!limit||m<2||S.age[i]<40)continue;
      // Exact integer ordering: height, age, then lower cell index. A bounded
      // min-heap keeps only the tallest/oldest quarter; no sort or allocation.
      const rank=(m*65536+S.age[i])*stride+S.n-i;
      if(count<limit){
        let at=count++;
        while(at){
          const parent=(at-1)>>>1;
          if(heap[parent]<=rank)break;
          heap[at]=heap[parent];at=parent;
        }
        heap[at]=rank;
      }else if(rank>heap[0]){
        let at=0;
        while(at*2+1<count){
          let child=at*2+1;
          if(child+1<count&&heap[child+1]<heap[child])child++;
          if(heap[child]>=rank)break;
          heap[at]=heap[child];at=child;
        }
        heap[at]=rank;
      }
    }
    for(let i=0;i<count;i++)V.face[S.n-heap[i]%stride]=1;
    return V;
  },
  HUD(S){
    return 'GEN '+S.gen+' · '+S.mass+' cards · +'+S.added+' / −'+S.out+
      ' · '+S.slides+' falls · '+S.avalanche+' topples'+
      (S.shakeCount?' · shake '+S.shakeTopples+' topples · recovery '+
        (S.shakeTracking?'pending '+S.shakeElapsed+'g':S.shakeRecovery+'g'):'');
  }
});
})();

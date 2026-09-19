/* The workshop, seen from the doorway. Original scene drawing informed by
   a-small-light-three.vercel.app: isometric paper architecture, screened ink,
   purposeful props and small stop-motion gestures. No reference assets/code.
   The press and listening bench open their working instruments, not demos. */
const ROOMVIEW=(()=>{
  const Q={mode:'room',previous:'room',zoom:1,dx:0,dy:0,drag:null,hover:'',
    backdrop:null,art:document.createElement('canvas'),scope:document.createElement('canvas'),
    W:0,H:0,scale:1,ox:0,oy:0,frame:-1,knobs:[],actions:[],note:'',hotspots:new Map(),navigation:[]};
  const C={paper:TC.paper,blue:[.86,.43,.18],coral:[.02,.72,.54],
    teal:[.65,.02,.12],sun:TC.yell,pink:TC.rose};
  const P=(i,j,z=0)=>[(i-j)*32,(i+j)*16-z*32];
  const tile=(i,j,w,d,z=0)=>[P(i,j,z),P(i+w,j,z),P(i+w,j+d,z),P(i,j+d,z)];
  const wall=(side,a,b,z0,z1)=>side==='left'?
    [P(0,a,z0),P(0,b,z0),P(0,b,z1),P(0,a,z1)]:
    [P(a,0,z0),P(b,0,z0),P(b,0,z1),P(a,0,z1)];
  function path(g,p){g.beginPath();p.forEach((v,k)=>k?g.lineTo(...v):g.moveTo(...v));g.closePath();}
  const screens=new WeakMap();
  function screenInk(g,c,tone,angle=15){
    let bank=screens.get(g);if(!bank){bank=new Map();screens.set(g,bank);}
    tone=Math.round(clamp(tone,0,1)*100)/100; // bound reusable UI screens, not artwork precision
    const col=inkedHex(c),key=col+'|'+tone+'|'+angle;
    let p=bank.get(key);
    if(!p){p=g.createPattern(dotTile(col,tone,18),'repeat');
      p.setTransform(new DOMMatrix().rotateSelf(angle).scaleSelf(1/9));bank.set(key,p);}
    return p;
  }
  function region(key,p){
    const xs=p.map(v=>v[0]),ys=p.map(v=>v[1]);
    Q.hotspots.set(key,{id:key.split(':')[0],p,x0:Math.min(...xs),x1:Math.max(...xs),y0:Math.min(...ys),y1:Math.max(...ys)});
  }
  function contains(h,x,y,pad){
    if(x<h.x0-pad||x>h.x1+pad||y<h.y0-pad||y>h.y1+pad)return false;
    let inside=false;
    for(let i=0,j=h.p.length-1;i<h.p.length;j=i++){
      const a=h.p[j],b=h.p[i];
      if(dist2seg(x,y,a[0],a[1],b[0],b[1])<=pad)return true;
      if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
    }return inside;
  }
  function line(g,p,c=C.blue,w=.9){
    g.strokeStyle=inkedHex(c);g.lineWidth=w;g.lineCap='round';g.lineJoin='round';g.beginPath();
    for(let n=0;n<p.length;n++){
      if(!n){g.moveTo(...p[n]);continue;}
      const a=p[n-1],b=p[n],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy)||1;
      g.quadraticCurveTo((a[0]+b[0])/2-dy/len*.35,(a[1]+b[1])/2+dx/len*.35,...b);
    }g.stroke();
  }
  function poly(g,p,c=C.paper,tone=1,edge=true){
    path(g,p);g.fillStyle=inkedHex(C.paper);g.fill();
    if(c!==C.paper){g.fillStyle=screenInk(g,c,tone);g.fill();}
    if(edge)line(g,p.concat([p[0]]));
  }
  function shade(g,p,tone=.12){path(g,p);g.fillStyle=screenInk(g,C.blue,tone,45);g.fill();}
  function ellipse(x,y,rx,ry,n=28){const p=[];for(let k=0;k<n;k++){const a=k/n*Math.PI*2;p.push([x+Math.cos(a)*rx,y+Math.sin(a)*ry]);}return p;}
  function disc(g,x,y,r,c=C.blue,tone=1){poly(g,ellipse(x,y,r,r),c,tone);}
  function text(g,s,x,y,size=9,col=C.blue,align='left'){
    g.fillStyle=inkedHex(col);g.font=size+'px '+MONO;g.textAlign=align;g.fillText(s,x,y);g.textAlign='left';
  }
  function box(g,i,j,w,d,z,h,c=C.blue,t=.45,hit=''){
    const faces=[[P(i,j+d,z),P(i+w,j+d,z),P(i+w,j+d,z+h),P(i,j+d,z+h)],
      [P(i+w,j,z),P(i+w,j+d,z),P(i+w,j+d,z+h),P(i+w,j,z+h)],tile(i,j,w,d,z+h)];
    faces.forEach((p,k)=>{poly(g,p,c,[t,Math.min(1,t+.20),Math.max(.06,t-.12)][k]);if(hit)region(hit+k,p);});
  }
  function can(g,i,j,z,c,h=.36,r=.16){
    const p=P(i,j,z),top=P(i,j,z+h),rx=r*39,ry=r*20;
    poly(g,[[p[0]-rx,p[1]],[p[0]+rx,p[1]],[top[0]+rx,top[1]],[top[0]-rx,top[1]]],c,.82);
    poly(g,ellipse(...top,rx,ry),c,.55);line(g,[[p[0]-rx*.6,p[1]-h*14],[p[0]+rx*.6,p[1]-h*14]],C.paper,2);
  }
  function plant(g,i,j,z=0,s=1){
    const [x,y]=P(i,j,z);poly(g,[[x-8*s,y-12*s],[x+8*s,y-12*s],[x+6*s,y],[x-6*s,y]],C.coral,.82);
    poly(g,ellipse(x,y-12*s,8*s,3*s),C.blue,.45);
    for(let n=0;n<6;n++){
      const a=-2.9+n*.44,tx=x+Math.cos(a)*23*s,ty=y-12*s+Math.sin(a)*31*s;
      line(g,[[x,y-12*s],[tx,ty]],C.teal,1.3*s);
      poly(g,[[tx,ty],[tx-8*s,ty+2*s],[tx-7*s,ty-5*s],[tx,ty-10*s],[tx+4*s,ty-4*s]],C.teal,.68);
    }
  }
  function table(g,i,j,w,d,h,c=C.coral){
    for(const [a,b] of [[i+.12,j+.12],[i+w-.2,j+.12],[i+.12,j+d-.2],[i+w-.2,j+d-.2]])box(g,a,b,.10,.10,0,h,C.blue,.75);
    box(g,i,j,w,d,h,.12,c,.54);
  }
  function lamp(g,i,j,z){
    const [x,y]=P(i,j,z);line(g,[[x,y-40],[x+1,y-8]],C.blue,1.2);
    poly(g,[[x-13,y],[x+13,y],[x+6,y-13],[x-6,y-13]],C.sun,.9);
    poly(g,ellipse(x,y+1,13,4),C.sun,.5);line(g,[[x-5,y-11],[x-9,y-2]],C.paper,1.1);
  }
  function imageOn(g,im,p,w=im.width,h=im.height){
    if(!w||!h)return;g.save();g.transform((p[1][0]-p[0][0])/w,(p[1][1]-p[0][1])/w,
      (p[3][0]-p[0][0])/h,(p[3][1]-p[0][1])/h,p[0][0],p[0][1]);g.drawImage(im,0,0,w,h);g.restore();
  }
  function plaque(g,label,i,j,z,w=68,hit=''){
    const [x,y]=P(i,j,z),p=[[x-w/2,y-4],[x+w/2,y-3],[x+w/2+1,y+10],[x-w/2-1,y+9]];
    line(g,[[x,y-11],[x,y-4]],C.blue,.8);poly(g,p,C.paper);
    disc(g,x-w/2+4,y,1,C.coral);text(g,label,x,y+5.7,7,C.blue,'center');
    if(hit)region(hit,p);
  }
  function architecture(g){
    // Cutaway plinth: open front, two thin rear walls, daylight on the floor.
    box(g,0,0,12,10,-.42,.42,C.coral,.48);
    poly(g,tile(0,0,12,10),C.coral,.16);
    for(let j=.5;j<10;j+=.5)line(g,[P(0,j),P(12,j)],[.12,.18,.13],.4);
    for(let j=0;j<10;j+=.5)for(let i=(j%1?1:0);i<12;i+=2)line(g,[P(i,j),P(i,j+.5)],[.12,.18,.13],.35);
    poly(g,wall('left',0,10,0,3.55),C.blue,.69);
    poly(g,wall('right',0,12,0,3.55),C.blue,.57);
    poly(g,[P(-.14,0,3.55),P(-.14,10,3.55),P(0,10,3.55),P(0,0,3.55)],C.blue,.92);
    poly(g,[P(0,-.14,3.55),P(12,-.14,3.55),P(12,0,3.55),P(0,0,3.55)],C.blue,.84);
    line(g,[P(0,10,.16),P(0,0,.16),P(12,0,.16)],C.paper,2);
    for(let a=.25;a<12;a+=.23)line(g,[P(a,0,.25),P(a,0,3.45)],[.56,.27,.12],.35);
    for(let a=.25;a<10;a+=.23)line(g,[P(0,a,.25),P(0,a,3.45)],[.62,.30,.15],.35);
    poly(g,wall('left',6.45,9.15,.95,3.03),C.paper);
    poly(g,wall('left',6.59,9.01,1.10,2.9),C.sun,.15);
    // A tiny street beyond the window, still flat printed shapes.
    for(let j=6.65;j<8.9;j+=.39){
      const h=.30+.28*(.5+.5*Math.sin(j*20));poly(g,wall('left',j,j+.32,1.12,1.12+h),C.teal,.3);
      const q=P(0,j+.16,1.2+h*.55);poly(g,[[q[0]-1.5,q[1]-2],[q[0]+1.5,q[1]-2],[q[0]+1.5,q[1]+2],[q[0]-1.5,q[1]+2]],C.sun,.9);
    }
    line(g,[P(0,7.8,1.03),P(0,7.8,2.98)],C.blue,2);
    line(g,[P(0,6.51,2),P(0,9.1,2)],C.blue,2);
    poly(g,[P(.04,6.6),P(.04,9),P(3.35,9.55),P(3.35,7.15)],C.sun,.19,false);
    line(g,[P(.04,7.8),P(3.35,8.36)],C.paper,3);
    plant(g,.23,8.75,1.03,.65);
    // Ink library and the stock cabinet.
    box(g,.1,.4,.9,3.8,0,.85,C.coral,.47,'ink:cabinet');
    for(let n=0;n<4;n++){
      const j=.48+n*.9;poly(g,[P(1.005,j,.14),P(1.005,j+.76,.14),P(1.005,j+.76,.68),P(1.005,j,.68)],C.coral,.33);
      const q=P(1.015,j+.38,.4);disc(g,...q,1.8,C.sun);
    }
    for(const z of [1.65,2.4]){
      box(g,.05,.45,.58,3.9,z,.07,C.paper);
      for(let n=0;n<10;n++)can(g,.29,.63+n*.36,z+.07,[C.blue,C.coral,C.sun,C.teal][n%4],.24+(n%3)*.05,.11);
    }
    plaque(g,'INK LIBRARY',.3,2.2,2.85,83,'ink:label');
    region('ink:shelf',wall('left',.45,4.35,1.65,2.85));
    table(g,.2,4.8,1.2,1.3,.9,C.sun);
    for(let n=0;n<8;n++)poly(g,tile(.25+n%2*.025,4.95,1,.85,1.03+n*.018),C.paper);
    plaque(g,'BRING A FILE',.8,5.4,1.65,82,'stock:label');
    region('stock:paper',tile(.25,4.95,1,.85,1.2));
    // Listening bench. Its screen and speakers are drawn live above this.
    table(g,8.5,.6,3.0,1.5,.97,C.coral);
    box(g,8.7,.72,2.25,.6,1.10,1.26,C.teal,.6,'scope:case');
    box(g,11.05,.84,.38,.45,1.10,.77,C.blue,.82);
    const sp=P(11.25,1.31,1.48);poly(g,ellipse(...sp,5,10),C.paper,.9);disc(g,...sp,2,C.blue);
    line(g,[P(11.3,1.3,1.12),P(11.5,1.7,.8),P(11.2,2.1,.05),P(8.6,2.1,.05)],C.blue,1.2);
    plaque(g,'THE LISTENING BENCH',10,1.5,.86,121,'scope:label');
    // Work in progress is pegged up, not presented in interface cards.
    const rope=[];for(let i=1.3;i<7.6;i+=.12)rope.push(P(i,.05,2.75-.13*Math.sin((i-1.3)/6.3*Math.PI)));
    line(g,rope,C.paper,1.1);
    for(let k=0;k<4;k++){
      const i=1.8+k*1.4;poly(g,[P(i,.08,2.57),P(i+1.04,.08,2.57),P(i+1.04,.08,1.64),P(i,.08,1.64)],C.paper);
      for(const a of [i+.12,i+.91]){const q=P(a,.10,2.65);poly(g,[[q[0]-1.5,q[1]-3],[q[0]+1.5,q[1]-3],[q[0]+1.5,q[1]+4],[q[0]-1.5,q[1]+4]],C.sun);}
    }
    lamp(g,3,1.7,3.6);lamp(g,8.2,3,3.8);
    // Inked castings, open bed, feed and delivery furniture.
    for(const [i,j] of [[4.1,3.5],[7.4,3.5],[4.1,6],[7.4,6]])box(g,i,j,.24,.24,0,.3,C.blue,.9);
    box(g,4,3.45,3.75,2.85,.25,.92,C.blue,.58,'press:base');
    box(g,3.85,3.3,4.05,3.1,1.17,.16,C.teal,.7,'press:bed');
    for(let i=4.2;i<7.5;i+=.6){
      const q=P(i,6.31,.66);poly(g,ellipse(...q,5,12),C.blue,.94);
    }
    table(g,4.05,6.45,3.65,1.65,.70,C.blue);
    for(let n=0;n<5;n++)poly(g,tile(4.27,6.58,3.12,1.3,.84+n*.013),C.paper);
    region('press:delivery',tile(4.05,6.45,3.65,1.65,.84));
    plaque(g,'STEP TO THE PRESS',6.1,7.6,.15,119,'press:label');
    for(let n=0;n<3;n++)can(g,8.15+n*.55,3.7,0,[C.blue,C.coral,C.sun][n],.55,.20);
    // Small useful mess: offcuts, a wash bucket, apron, stool and fern.
    for(let k=0;k<9;k++){
      const i=2.2+k*.85,j=8.7+.2*Math.sin(k*4);poly(g,tile(i,j,.38,.12,.015),C.paper);
    }
    can(g,1.1,9.1,0,C.blue,.6,.33);const b=P(1.1,9.1,.7);
    line(g,[[b[0]-10,b[1]],[b[0]-8,b[1]-10],[b[0]+6,b[1]-12],[b[0]+11,b[1]]],C.blue,1.2);
    table(g,9.7,7.3,.75,.7,.56,C.coral);plant(g,11.2,8.4,0,1.3);
    const ap=P(.02,9.6,2.8);line(g,[[ap[0],ap[1]],[ap[0],ap[1]+9]],C.paper,1);
    poly(g,[[ap[0]-6,ap[1]+7],[ap[0]+6,ap[1]+7],[ap[0]+10,ap[1]+37],[ap[0]-11,ap[1]+38]],C.paper);
    for(let k=0;k<4;k++)disc(g,ap[0]-6+k*4,ap[1]+20+(k%2)*8,2,[C.coral,C.teal,C.sun][k%3],.7);
  }
  function cylinder(g,t){
    const i=4.10,j=4.03,z=1.93,r=.57,len=3.48;
    if(!Q.drum){
      const front=[],rear=[];
      for(let n=0;n<30;n++){const a=n/30*Math.PI*2;front.push(P(i+len,j+Math.cos(a)*r,z+Math.sin(a)*r));rear.push(P(i,j+Math.cos(a)*r,z+Math.sin(a)*r));}
      const pts=front.concat(rear).sort((a,b)=>a[0]-b[0]||a[1]-b[1]),lo=[],hi=[];
      const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
      for(const p of pts){while(lo.length>1&&cross(lo[lo.length-2],lo[lo.length-1],p)<=0)lo.pop();lo.push(p);}
      for(let n=pts.length-1;n>=0;n--){const p=pts[n];while(hi.length>1&&cross(hi[hi.length-2],hi[hi.length-1],p)<=0)hi.pop();hi.push(p);}
      lo.pop();hi.pop();Q.drum={front,hull:lo.concat(hi)};
    }
    poly(g,Q.drum.hull,C.teal,.7);
    for(let n=0;n<9;n++){
      const a=n/9*Math.PI*2+t;
      if(Math.cos(a)+Math.sin(a)>0)line(g,[P(i,j+Math.cos(a)*r,z+Math.sin(a)*r),P(i+len,j+Math.cos(a)*r,z+Math.sin(a)*r)],n%3?C.blue:C.paper,.9);
    }
    poly(g,Q.drum.front,C.blue,.75);const q=P(i+len,j,z);poly(g,ellipse(...q,15,20),C.sun,.7);
    for(let n=0;n<6;n++){const a=n*Math.PI/3+t;line(g,[q,[q[0]+Math.cos(a)*11,q[1]+Math.sin(a)*15]],C.blue,1.3);}
    disc(g,...q,3,C.blue);const arm=[q[0]+Math.cos(t)*24,q[1]+Math.sin(t)*25];line(g,[q,arm],C.blue,3);disc(g,...arm,4,C.coral);
  }
  function person(g,i,j,c,t,job){
    const [x,y]=P(i,j),bob=playing?Math.sin(t*2)*.7:0;
    shade(g,ellipse(x+4,y+2,15,5),.13);
    line(g,[[x-5,y-23],[x-7,y-11],[x-8,y]],C.blue,5);
    line(g,[[x+5,y-23],[x+6,y-10],[x+7,y]],C.blue,5);
    line(g,[[x-8,y],[x-13,y+1]],C.blue,3);line(g,[[x+7,y],[x+13,y+1]],C.blue,3);
    poly(g,[[x-7,y-49+bob],[x+7,y-48+bob],[x+9,y-23],[x-8,y-23]],c,.84);
    poly(g,[[x-4,y-43],[x+5,y-43],[x+6,y-25],[x-6,y-25]],C.paper);
    disc(g,x,y-57+bob,7,C.paper);poly(g,[[x-7,y-58+bob],[x-6,y-65+bob],[x+5,y-66+bob],[x+8,y-58+bob]],C.blue,.95);
    disc(g,x+4,y-57+bob,.65,C.blue);line(g,[[x,y-51],[x+1,y-48]],C.blue,1.5);
    const reach=job==='feed'?-15:16,dy=playing?Math.sin(t*1.6)*3:0;
    line(g,[[x+6,y-44],[x+reach*.7,y-35],[x+reach,y-41+dy]],c,5);
    line(g,[[x-6,y-44],[x-10,y-34],[x+reach-5,y-39+dy]],c,4);
    disc(g,x+reach,y-41+dy,2,C.paper);
    if(job==='feed')poly(g,[[x-26,y-42+dy],[x-6,y-49+dy],[x+1,y-40+dy],[x-19,y-32+dy]],C.paper);
  }
  function cat(g,t){
    const [x,y]=P(2.3,8.25);shade(g,ellipse(x+3,y+3,19,6),.12);
    poly(g,ellipse(x,y-7,16,9),C.coral,.7);
    poly(g,[[x+9,y-12],[x+8,y-24],[x+15,y-20],[x+21,y-24],[x+24,y-12]],C.coral,.8);
    line(g,[[x+13,y-14],[x+15,y-13]],C.blue,.8);line(g,[[x+19,y-14],[x+21,y-14]],C.blue,.8);
    line(g,[[x-13,y-7],[x-23,y-8],[x-27,y-16],[x-22,y-19+Math.sin(t)*2]],C.coral,4);
  }
  function makeBackdrop(){
    Q.backdrop=document.createElement('canvas');Q.backdrop.width=1600;Q.backdrop.height=1120;
    const g=Q.backdrop.getContext('2d');g.setTransform(2,0,0,2,760,280);architecture(g);
  }
  function layout(){
    Q.W=innerWidth;Q.H=innerHeight;Q.scale=Math.min((Q.W-48)/800,(Q.H-126)/535)*Q.zoom;
    Q.ox=Q.W/2+Q.dx;Q.oy=Q.H*.53-122*Q.scale+Q.dy;
  }
  function screen(x,y){return [Q.ox+x*Q.scale,Q.oy+y*Q.scale];}
  function world(x,y){return [(x-Q.ox)/Q.scale,(y-Q.oy)/Q.scale];}
  function target(x,y){
    if(Q.mode!=='room')return Q.knobs.find(k=>Math.hypot(x-k.x,y-k.y)<k.r+13)?.id||
      Q.actions.find(a=>x>=a.x&&x<=a.x+a.w&&y>=a.y&&y<=a.y+a.h)?.id||'';
    const [a,b]=world(x,y);let found='';
    for(const h of Q.hotspots.values())if(contains(h,a,b,8/Q.scale))found=h.id;
    return found;
  }
  function scopeCanvas(){
    const cv=Q.scope;if(cv.width!==700){cv.width=700;cv.height=400;}
    const g=cv.getContext('2d'),rec=APP.rec,scan=scopeIndex(rec);
    g.fillStyle=inkedHex(C.blue);g.fillRect(0,0,700,400);
    for(let x=24;x<686;x+=33)line(g,[[x,24],[x,366]],[.7,.35,.15],.55);
    for(let y=30;y<365;y+=28)line(g,[[24,y],[680,y]],[.7,.35,.15],.55);
    text(g,APP.feedback?'01  Re: source + LIFE':'01  Re(h)',30,23,12,C.sun);
    text(g,APP.feedback?'02  Im: source + LIFE':'02  Im(h)',248,23,12,C.coral);
    text(g,'03  '+(APP.wrldId==='synch'?'ORDER r':'OCCUPANCY'),444,23,12,C.paper);
    if(!rec||!rec.re||scan<0)return;
    const n=rec.re.length,span=Math.min(n-1,Math.max(72,Math.round(n*.32))),start=clamp(scan-Math.round(span*.58),0,n-1-span),end=start+span;
    const sx=i=>28+(i-start)/Math.max(1,span)*645,amp=rec.amax||1;
    const signal=APP.feedback||rec;
    for(const [key,cy,c] of [['re',99,C.sun],['im',207,C.coral]]){
      const a=signal[key]||signal.re;g.save();g.beginPath();g.rect(27,cy-45,647,90);g.clip();
      if(APP.feedback){const src=[];for(let i=start;i<=end;i++)src.push([sx(i),cy-rec[key][i]/amp*38*R.gain]);line(g,src,[.50,.32,.20],.9);}
      const pts=[];for(let i=start;i<=end;i++)pts.push([sx(i),cy-a[i]/amp*38*R.gain]);
      line(g,pts,c,2);line(g,[[sx(scan),cy-45],[sx(scan),cy+45]],C.paper,.9);
      disc(g,sx(scan),cy-a[scan]/amp*38*R.gain,2,c);g.restore();
      if(APP.feedback)text(g,'source is faint · '+APP.feedback.live+' live cells',29,cy+55,9,C.paper);
    }
    const count=Math.min(APP.scopeN,APP.scopeHist.length);let lo=1,hi=0;
    for(let k=0;k<count;k++){const v=APP.scopeHist[(APP.scopeN-count+k)%APP.scopeHist.length];lo=Math.min(lo,v);hi=Math.max(hi,v);}
    if(count){
      const pad=Math.max(.025,(hi-lo)*.18);lo=Math.max(0,lo-pad);hi=Math.min(1,Math.max(lo+.06,hi+pad));
      const pts=[];for(let k=0;k<count;k++){const v=APP.scopeHist[(APP.scopeN-count+k)%APP.scopeHist.length];pts.push([28+k/Math.max(1,count-1)*645,350-(v-lo)/(hi-lo)*67]);}
      line(g,pts,C.paper,1.7);text(g,(hi*100).toFixed(1)+'%',628,282,10,C.paper);text(g,(lo*100).toFixed(1)+'%',628,364,10,C.paper);
    }
    const ti=rec.t?rec.t[scan]:scan;
    text(g,'SAMPLE '+scan+' / '+(n-1)+'     t '+Number(ti).toFixed(3)+'     GAIN '+R.gain.toFixed(2)+'x',29,391,11,C.paper);
  }
  function knob(g,id,label,x,y,r,t,readout,collector=Q.knobs){
    collector.push({id,x,y,r});poly(g,ellipse(x,y,r+5,r+5),C.blue,.3);
    disc(g,x,y,r,C.paper);for(let n=0;n<11;n++){const a=-Math.PI*.75+n/10*Math.PI*1.5;line(g,[[x+Math.cos(a)*(r-2),y+Math.sin(a)*(r-2)],[x+Math.cos(a)*(r-6),y+Math.sin(a)*(r-6)]],C.blue,.8);}
    const a=-Math.PI*.75+t*Math.PI*1.5;line(g,[[x,y],[x+Math.cos(a)*r*.7,y+Math.sin(a)*r*.7]],C.coral,2.3);
    disc(g,x,y,3,C.blue);text(g,label,x,y-r-16,11,C.paper,'center');text(g,readout,x,y+r+23,11,C.paper,'center');
  }
  function instrument(g){
    const W=Q.W,H=Q.H,s=Math.min((W-42)/1020,(H-100)/740),x=(W-960*s)/2,y=(H-680*s)/2;
    Q.knobs=[];g.save();g.translate(x,y);g.scale(s,s);
    poly(g,[[0,25],[40,0],[960,0],[960,645],[0,680]],C.teal,.7);
    poly(g,[[0,25],[920,25],[920,680],[0,680]],C.blue,.8);
    for(const [a,b] of [[16,42],[903,42],[16,661],[903,661]]){disc(g,a,b,4,C.paper);line(g,[[a-2,b],[a+2,b]],C.blue,.8);}
    text(g,'THE LISTENING BENCH',40,64,17,C.paper);
    text(g,'ANALYTIC RECORD / WORLD RESPONSE',880,64,11,C.paper,'right');
    poly(g,[[37,85],[882,85],[882,490],[37,490]],C.paper);g.drawImage(Q.scope,45,93,828,388);
    const defs=[['sound','POWER',AUDIO.enabled?1:0,AUDIO.enabled?'SOUND ON':'SILENT'],
      ['mode','PHASE',AUDIO.mode==='music'?1:0,AUDIO.mode==='music'?'PENTATONIC':'CONTINUOUS'],
      ['gain','DISPLAY GAIN',(R.gain-.25)/3.75,R.gain.toFixed(2)+'x'],
      ['offset','SWEEP OFFSET',APP.scopeOffset/100,APP.scopeOffset.toFixed(0)+'%'],
      ['volume','LOUDNESS',AUDIO.volume,Math.round(AUDIO.volume*100)+'%']];
    defs.forEach((d,k)=>knob(g,d[0],d[1],112+k*173,565,29,d[2],d[3]));
    text(g,'Amplitude → loudness. Phase rotation → pitch. Complex phase → stereo.',460,646,11,C.paper,'center');
    g.restore();Q.knobs.forEach(k=>{k.x=x+k.x*s;k.y=y+k.y*s;k.r*=s;});
    text(g,Q.note||'Intentional sonification — not a recording of a sound in space.',W/2,H-23,Math.min(12,W/66),C.blue,'center');
    back(g);
  }
  function back(g){
    Q.navigation=[];
    const y=Q.mode==='press'?132:18,links=[['room','← ROOM'],['stock','SOURCE'],['ink','INKS'],['press','PRESS'],['scope','LISTEN']].filter(([id])=>id!==Q.mode);
    for(let k=0;k<links.length;k++){
      const [id,label]=links[k],w=Math.min(80,(Q.W-48)/4-6),x=18+k*(w+6);
      poly(g,[[x,y],[x+w,y-1],[x+w+2,y+25],[x-1,y+27]],C.paper);
      disc(g,x+7,y+7,1.5,C.coral);text(g,label,x+17,y+17,10,C.blue);
      Q.navigation.push({id,x:x-2,y:y-2,w:w+6,h:31});
    }
  }
  function paintRoom(V,field,opts){
    const f=Math.floor(performance.now()/(Q.mode==='scope'?33.333:83.333));
    if(Q.frame===f&&Q.lastMode===Q.mode&&Q.W===innerWidth&&Q.H===innerHeight)return;
    Q.frame=f;Q.lastMode=Q.mode;
    layout();const ctx=stageCtx();Q.actions=[];
    if(Q.mode==='stock'){
      ctx.fillStyle=inkedHex(C.paper);ctx.fillRect(0,0,Q.W,Q.H);
      Object.assign(Q,STOCK_STATION.paint(ctx,Q.W,Q.H,Q.art));stationNote(ctx);back(ctx);return;
    }
    if(Q.mode==='room'||Q.mode==='scope')scopeCanvas();
    if(Q.mode==='scope'){ctx.fillStyle=inkedHex(C.paper);ctx.fillRect(0,0,Q.W,Q.H);instrument(ctx);return;}
    if(!Q.backdrop)makeBackdrop();
    // Render a suitably sized real sheet, then place that same image on the bed.
    R.side=Math.round(clamp(210*Q.zoom,180,480));R.bx=0;R.by=0;setM(M);
    for(let n=0;n<3;n++)R.inkKey[n]=.30+1.10*SHV.key[n];
    drawStage(V,field,opts);
    const dpr=Math.min(2,devicePixelRatio||1),px=Math.round(R.side*dpr);
    if(Q.art.width!==px){Q.art.width=px;Q.art.height=px;}
    Q.art.getContext('2d').drawImage(document.getElementById('stage'),0,0,px,px,0,0,px,px);
    ctx.fillStyle=inkedHex(C.paper);ctx.fillRect(0,0,Q.W,Q.H);
    if(Q.mode==='ink'){Object.assign(Q,INK_STATION.paint(ctx,Q.W,Q.H,Q.art));stationNote(ctx);back(ctx);return;}
    text(ctx,'a record, a room, a small world.',Q.W/2,42,Math.min(17,Q.W/27),C.blue,'center');
    text(ctx,'THE PRESS TAKES COMMISSIONS',Q.W/2,64,Math.min(10,Q.W/42),C.coral,'center');
    ctx.save();ctx.translate(Q.ox,Q.oy);ctx.scale(Q.scale,Q.scale);
    ctx.drawImage(Q.backdrop,-380,-140,800,560);
    for(let n=0;n<4;n++){
      const i=1.83+n*1.4;imageOn(ctx,Q.art,[P(i,.085,2.52),P(i+.98,.085,2.52),P(i+.98,.085,1.69),P(i,.085,1.69)]);
    }
    imageOn(ctx,Q.scope,[P(8.82,1.33,2.24),P(10.84,1.33,2.24),P(10.84,1.33,1.24),P(8.82,1.33,1.24)]);
    person(ctx,3.3,4.1,C.coral,Math.floor(R.clock*12)/12,'feed');
    imageOn(ctx,Q.art,tile(4.24,4.28,3.28,2.0,1.34));
    cylinder(ctx,SHV.cyl);
    if(!Q.hotspots.has('press:drum'))region('press:drum',Q.drum.hull);
    if(SHOP.pulled.length){
      const pic=SHOP.pulled[SHOP.pulled.length-1];
      if(Q.pullSrc!==pic.url){Q.pullSrc=pic.url;Q.pullImage=new Image();Q.pullImage.src=pic.url;}
      if(Q.pullImage.complete&&Q.pullImage.naturalWidth)imageOn(ctx,Q.pullImage,tile(4.27,6.58,3.12,1.3,.92));
    }
    person(ctx,8.55,5.7,C.teal,Math.floor(R.clock*12)/12,'turn');cat(ctx,R.clock);
    if(Q.hover){
      const h=Q.hotspots.get(Q.hover+':label');
      if(h)line(ctx,[[h.x0,h.y1+2],[h.x1,h.y1+2]],C.coral,1.3);
    }
    ctx.restore();
    const small=Math.min(11,Q.W/59);
    text(ctx,'Click the press to work · click the bench to listen · drag to wander · scroll to look closer',Q.W/2,Q.H-40,small,C.blue,'center');
    text(ctx,(APP.rec?.name||'record')+'  /  '+(APP.world?.label||'')+'  /  '+SHOP.pulled.length+' sheets delivered',Q.W/2,Q.H-20,Math.min(10,Q.W/76),C.blue,'center');
  }
  function stationNote(g){if(Q.note)text(g,Q.note,Q.W/2,Q.H-19,Math.min(11,Q.W/95),C.blue,'center');}
  function enter(mode){Q.previous=Q.mode;Q.mode=mode;Q.frame=-1;Q.drag=null;Q.hover='';Q.note='';Q.actions=[];Q.knobs=[];SHV.drag=null;SHV.shake=null;SHV.grab=null;paint();}
  function setKnob(id,v){
    v=clamp(v,0,1);
    if(id==='gain')R.gain=Math.round((.25+v*3.75)*20)/20;
    if(id==='offset')APP.scopeOffset=Math.round(v*100);
    if(id==='volume')AUDIO.volume=v;
    if(id==='harmonics')API.setHarmonics(1+v*1022);
    if(id.startsWith('ink:'))API.setInkKey(Number(id.slice(4)),v);
    Q.frame=-1;paint();
    updateAudio(true);
  }
  function value(id){return id==='gain'?(R.gain-.25)/3.75:id==='offset'?APP.scopeOffset/100:
    id==='harmonics'?(API.harmonics()-1)/1022:id.startsWith('ink:')?SHV.key[Number(id.slice(4))]:AUDIO.volume;}
  function adjustable(id){return ['gain','offset','volume','harmonics'].includes(id)||id.startsWith('ink:');}
  function navigationAt(x,y){return Q.mode==='room'?null:Q.navigation.find(e=>x>=e.x&&x<=e.x+e.w&&y>=e.y&&y<=e.y+e.h);}
  function down(e,x,y){
    const nav=navigationAt(x,y);if(nav){enter(nav.id);return true;}
    if(Q.mode==='press')return false;
    const id=target(x,y);Q.drag={id,x,y,x0:x,y0:y,dx:Q.dx,dy:Q.dy,v:value(id),pid:e.pointerId};
    try{document.getElementById('stage').setPointerCapture(e.pointerId);}catch(_){}
    e.preventDefault();return true;
  }
  function move(e,x,y){
    if(Q.mode==='press')return false;
    const d=Q.drag;
    if(d){if(e.pointerId!==d.pid)return true;
      if(Q.mode==='room'){Q.dx=d.dx+x-d.x0;Q.dy=d.dy+y-d.y0;}
      else if(adjustable(d.id))setKnob(d.id,d.v+(x-d.x0-y+d.y0)/180);
    }
    Q.hover=Q.mode==='room'?target(x,y):'';
    document.getElementById('stage').style.cursor=navigationAt(x,y)||target(x,y)?'pointer':Q.mode==='room'?(d?'grabbing':'grab'):'default';
    if(d&&Q.mode==='room'){Q.frame=-1;paint();}
    return true;
  }
  function up(e,x,y){
    if(Q.mode==='press')return false;
    const d=Q.drag;if(!d||e.pointerId!==d.pid)return true;Q.drag=null;
    if(Math.hypot(x-d.x0,y-d.y0)<6){
      if(Q.mode==='room'){
        if(['press','scope','stock','ink'].includes(d.id))enter(d.id);
      }else if(d.id==='sound'){AUDIO.enabled?stopAudio():startAudio();}
      else if(d.id==='mode'){AUDIO.mode=AUDIO.mode==='tone'?'music':'tone';updateAudio(true);}
      else if(d.id==='source:open')SHOPVIEW.openPicker();
      else if(d.id.startsWith('source:')){API.setSource(d.id.slice(7));Q.note='Source ready. Continue at the press.';Q.frame=-1;paint();}
    }
    try{document.getElementById('stage').releasePointerCapture(e.pointerId);}catch(_){}
    return true;
  }
  function wheel(e,x,y){
    if(Q.mode==='press')return false;
    e.preventDefault();
    if(Q.mode!=='room'){const id=target(x,y);if(adjustable(id))setKnob(id,value(id)-Math.sign(e.deltaY)*(id==='harmonics'?1/1022:.025));return true;}
    const anchor=world(x,y),d=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?Q.H:1);
    Q.zoom=clamp(Q.zoom*Math.exp(-clamp(d,-600,600)*.0015),.65,2.8);layout();
    const q=screen(...anchor);Q.dx+=x-q[0];Q.dy+=y-q[1];Q.frame=-1;paint();return true;
  }
  function key(e){
    if(e.ctrlKey||e.metaKey||e.altKey)return false;
    const k=e.key.toLowerCase();
    if(k==='o'){enter(Q.mode==='scope'?'room':'scope');e.preventDefault();return true;}
    if(k==='i'){enter(Q.mode==='ink'?'room':'ink');e.preventDefault();return true;}
    if(k==='f'){enter(Q.mode==='stock'?'room':'stock');e.preventDefault();return true;}
    if(k==='escape'&&Q.mode!=='room'&&!SHV.loupe){enter('room');return true;}
    if(Q.mode==='press')return false;
    if(k==='p'){enter('press');return true;}
    if(Q.mode!=='room')return true;
    if(k==='0'){Q.zoom=1;Q.dx=Q.dy=0;}
    else if(k==='arrowleft')Q.dx+=60;else if(k==='arrowright')Q.dx-=60;
    else if(k==='arrowup')Q.dy+=60;else if(k==='arrowdown')Q.dy-=60;
    else if(k==='+'||k==='=')Q.zoom=clamp(Q.zoom*1.2,.65,2.8);
    else if(k==='-')Q.zoom=clamp(Q.zoom/1.2,.65,2.8);
    else return true;
    Q.frame=-1;paint();e.preventDefault();return true;
  }
  return Object.assign(Q,{paint:paintRoom,back,enter,down,move,up,wheel,key,screen,world,target,
    tools:{colors:C,poly,line,disc,ellipse,text,knob},
    cancel(){Q.drag=null;},say(s){Q.note=s;},drop(files){
      if(Q.mode==='press')return false;
      if(files.length){enter('stock');API.loadStock(files[0]);}
      return true;
    }});
})();

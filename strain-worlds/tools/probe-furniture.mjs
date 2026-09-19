/* probe-furniture.mjs — the sheet's furniture, measured against the shop.
 *
 * The press is being rewired around a shop workflow: INTAKE -> MAKEREADY ->
 * PROOF -> (approve|reject) -> RUNNING. The claim this file measures is that
 * the furniture on the sheet CHANGES with that state, and that registration is
 * something the operator brings in rather than a fixed property of the press:
 *
 *   1. measuredSlip() — the worst pairwise plate distance — is exactly the
 *      linear function of R.slipScale the app assumes: 0 at scale 0, 3x at
 *      scale 3. Printed per plate, with the pairwise distances it is the max of.
 *   2. the same seed at slipScale 3 pulls a DIFFERENT sheet than at scale 1:
 *      the scale reaches the halftone, not just the readout.
 *   3. makeready, proof and edition each render, and produce three different
 *      sheets (checksums). The furniture is the state.
 *   4. the four trim corners: crop marks print there on a proof and are absent
 *      on a trimmed edition pull (ink counted in the margin-side corner
 *      windows, so the count is the marks and not the picture).
 *   5. snapshotSheet(96) is a real PNG, exactly 96 on its longest side, carrying
 *      the sheet, and taking it leaves the stage canvas bit-identical.
 *
 * It loads the REAL src/w-render.js the same way probe-press.mjs does, and
 * runs its drawStage against a small software Canvas2D written for the job
 * (below), because the renderer's board path is the thing under test and node
 * has no canvas. Geometry, ink coverage, plate slips and furniture are real.
 * Two approximations, both noted where they bite: arcTo is treated as a
 * straight corner (so card corners are square here) and glyphs are solid boxes
 * of the right advance (so text is legible to a checksum, not to a human).
 *
 * usage: node tools/probe-furniture.mjs
 */
import {readFileSync, readdirSync} from 'node:fs';
import {deflateSync, inflateSync} from 'node:zlib';

/* ═══ a small Canvas2D, enough for the board path of w-render.js ═══════════ */
const CRC=(()=>{const t=new Int32Array(256);
  for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);t[n]=c;}
  return t;})();
function crc32(b){let c=~0;for(let i=0;i<b.length;i++)c=CRC[(c^b[i])&0xff]^(c>>>8);return ~c>>>0;}
function pngChunk(type,data){
  const out=Buffer.alloc(12+data.length);
  out.writeUInt32BE(data.length,0);out.write(type,4,'latin1');data.copy(out,8);
  out.writeUInt32BE(crc32(out.subarray(4,8+data.length)),8+data.length);
  return out;
}
function pngOf(w,h,d){
  const ihdr=Buffer.alloc(13);
  ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);
  ihdr[8]=8;ihdr[9]=6;ihdr[10]=0;ihdr[11]=0;ihdr[12]=0;      /* 8-bit RGBA */
  const stride=w*4, raw=Buffer.alloc((stride+1)*h);
  for(let y=0;y<h;y++){
    raw[y*(stride+1)]=0;                                     /* filter: none */
    Buffer.from(d.buffer,d.byteOffset+y*stride,stride).copy(raw,y*(stride+1)+1);
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
    pngChunk('IHDR',ihdr),pngChunk('IDAT',deflateSync(raw)),pngChunk('IEND',Buffer.alloc(0))]);
}
function col(s){
  if(Array.isArray(s))return s;
  if(typeof s!=='string')return [0,0,0,1];
  s=s.trim();
  if(s[0]==='#'){
    if(s.length===4)return [parseInt(s[1]+s[1],16),parseInt(s[2]+s[2],16),parseInt(s[3]+s[3],16),1];
    return [parseInt(s.slice(1,3),16),parseInt(s.slice(3,5),16),parseInt(s.slice(5,7),16),1];
  }
  const m=/^rgba?\(([^)]+)\)$/.exec(s);
  if(m){const p=m[1].split(',').map(v=>parseFloat(v));
    return [p[0]|0,p[1]|0,p[2]|0,p.length>3?p[3]:1];}
  return [0,0,0,1];
}
class StubCanvas{
  constructor(){this._w=0;this._h=0;this.style={};this.offsetWidth=0;
    this._data=new Uint8ClampedArray(0);this._ctx=null;}
  get width(){return this._w;}
  set width(v){v=Math.max(0,v|0);if(v!==this._w){this._w=v;this._alloc();}}
  get height(){return this._h;}
  set height(v){v=Math.max(0,v|0);if(v!==this._h){this._h=v;this._alloc();}}
  _alloc(){this._data=new Uint8ClampedArray(this._w*this._h*4);}
  getContext(){if(!this._ctx)this._ctx=new Ctx2D(this);return this._ctx;}
  toDataURL(){return 'data:image/png;base64,'+
    pngOf(this._w,this._h,this._data).toString('base64');}
}
class Ctx2D{
  constructor(cv){
    this.cv=cv;
    this.fillStyle='#000';this.strokeStyle='#000';this.lineWidth=1;this.globalAlpha=1;
    this.font='10px sans-serif';this.textAlign='start';this.textBaseline='alphabetic';
    this._m=[1,0,0,1,0,0];this._st=[];this._subs=[];this._cur=null;this._ux=0;this._uy=0;
  }
  get _d(){return this.cv._data;}
  save(){this._st.push([this._m.slice(),this.fillStyle,this.strokeStyle,this.lineWidth,
    this.globalAlpha,this.font,this.textAlign,this.textBaseline]);}
  restore(){
    const s=this._st.pop();if(!s)return;
    this._m=s[0];this.fillStyle=s[1];this.strokeStyle=s[2];this.lineWidth=s[3];
    this.globalAlpha=s[4];this.font=s[5];this.textAlign=s[6];this.textBaseline=s[7];
  }
  _mul(a,b,c,d,e,f){
    const m=this._m;
    const na=m[0]*a+m[2]*b, nb=m[1]*a+m[3]*b, nc=m[0]*c+m[2]*d, nd=m[1]*c+m[3]*d;
    m[4]=m[0]*e+m[2]*f+m[4];m[5]=m[1]*e+m[3]*f+m[5];
    m[0]=na;m[1]=nb;m[2]=nc;m[3]=nd;
  }
  setTransform(a,b,c,d,e,f){this._m=[a,b,c,d,e,f];}
  translate(x,y){this._mul(1,0,0,1,x,y);}
  scale(x,y){this._mul(x,0,0,y,0,0);}
  rotate(t){const c=Math.cos(t),s=Math.sin(t);this._mul(c,s,-s,c,0,0);}
  _tp(x,y){const m=this._m;return [m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];}
  _scl(){const m=this._m;return Math.hypot(m[0],m[1])||1;}
  _blend(x,y,c){
    x=x|0;y=y|0;
    const W=this.cv._w,H=this.cv._h;
    if(x<0||y<0||x>=W||y>=H)return;
    const sa=this.globalAlpha*(c[3]==null?1:c[3]);
    if(sa<=0)return;
    const d=this._d,o=(y*W+x)*4,da=d[o+3]/255,ao=sa+da*(1-sa);
    if(ao<=0)return;
    d[o]=(c[0]*sa+d[o]*da*(1-sa))/ao;
    d[o+1]=(c[1]*sa+d[o+1]*da*(1-sa))/ao;
    d[o+2]=(c[2]*sa+d[o+2]*da*(1-sa))/ao;
    d[o+3]=ao*255;
  }
  _fillPoly(pts,c){
    const n=pts.length;if(n<3)return;
    let ymin=Infinity,ymax=-Infinity;
    for(const p of pts){if(p[1]<ymin)ymin=p[1];if(p[1]>ymax)ymax=p[1];}
    const y0=Math.max(0,Math.floor(ymin)),y1=Math.min(this.cv._h-1,Math.ceil(ymax));
    const xs=[];
    for(let y=y0;y<=y1;y++){
      const cy=y+0.5;xs.length=0;
      for(let i=0,j=n-1;i<n;j=i++){
        const xi=pts[i][0],yi=pts[i][1],xj=pts[j][0],yj=pts[j][1];
        if((yi<=cy&&yj>cy)||(yj<=cy&&yi>cy))xs.push(xi+(cy-yi)/(yj-yi)*(xj-xi));
      }
      if(xs.length<2)continue;
      xs.sort((a,b)=>a-b);
      for(let i=0;i+1<xs.length;i+=2){
        const a=Math.max(0,Math.ceil(xs[i]-0.5)),b=Math.min(this.cv._w-1,Math.floor(xs[i+1]-0.5));
        for(let x=a;x<=b;x++)this._blend(x,y,c);
      }
    }
  }
  _seg(x0,y0,x1,y1,w,c){
    const dx=x1-x0,dy=y1-y0,len=Math.hypot(dx,dy);
    if(len<1e-6){
      this._fillPoly([[x0-w/2,y0-w/2],[x0+w/2,y0-w/2],[x0+w/2,y0+w/2],[x0-w/2,y0+w/2]],c);
      return;
    }
    const nx=-dy/len*w/2,ny=dx/len*w/2;
    this._fillPoly([[x0+nx,y0+ny],[x1+nx,y1+ny],[x1-nx,y1-ny],[x0-nx,y0-ny]],c);
  }
  beginPath(){this._subs=[];this._cur=null;}
  moveTo(x,y){this._cur=[this._tp(x,y)];this._subs.push(this._cur);this._subU=[x,y];}
  lineTo(x,y){
    if(!this._cur){this.moveTo(x,y);return;}
    this._cur.push(this._tp(x,y));
  }
  closePath(){if(this._cur)this._cur.push(this._tp(this._subU[0],this._subU[1]));}
  arc(cx,cy,r,a0,a1,ccw){
    let d=a1-a0;
    if(ccw){while(d>0)d-=2*Math.PI;}else{while(d<0)d+=2*Math.PI;}
    const steps=Math.max(6,Math.ceil(Math.abs(d)/0.2));
    for(let i=0;i<=steps;i++){
      const t=a0+d*i/steps;this.lineTo(cx+Math.cos(t)*r,cy+Math.sin(t)*r);
    }
  }
  /* arcTo as a straight corner: the press uses it only through rr(), where it
     rounds the corners of a card. Square corners move the ink budget by a hair
     and never the furniture, and every mark this probe measures is a rect, a
     line or a circle, none of which touch arcTo. */
  arcTo(x1,y1){this.lineTo(x1,y1);}
  fill(){const c=col(this.fillStyle);for(const sp of this._subs)this._fillPoly(sp,c);}
  stroke(){
    const w=Math.max(1,this.lineWidth*this._scl()),c=col(this.strokeStyle);
    for(const sp of this._subs)
      for(let i=0;i+1<sp.length;i++)this._seg(sp[i][0],sp[i][1],sp[i+1][0],sp[i+1][1],w,c);
  }
  fillRect(x,y,w,h){
    if(!(w>0)||!(h>0))return;
    const c=col(this.fillStyle);
    this._fillPoly([[x,y],[x+w,y],[x+w,y+h],[x,y+h]].map(p=>this._tp(p[0],p[1])),c);
  }
  strokeRect(x,y,w,h){
    const lw=Math.max(1,this.lineWidth*this._scl()),c=col(this.strokeStyle);
    const p=[[x,y],[x+w,y],[x+w,y+h],[x,y+h]].map(q=>this._tp(q[0],q[1]));
    for(let i=0;i<4;i++)this._seg(p[i][0],p[i][1],p[(i+1)%4][0],p[(i+1)%4][1],lw,c);
  }
  clearRect(x,y,w,h){
    const W=this.cv._w,H=this.cv._h,d=this._d;
    for(let j=Math.max(0,Math.round(y));j<Math.min(H,Math.round(y+h));j++)
      for(let i=Math.max(0,Math.round(x));i<Math.min(W,Math.round(x+w));i++){
        const o=(j*W+i)*4;d[o]=0;d[o+1]=0;d[o+2]=0;d[o+3]=0;
      }
  }
  _px(){const m=/^(\d+(?:\.\d+)?)px/.exec(this.font);return m?parseFloat(m[1]):10;}
  _adv(){return (this.font.indexOf('monospace')>=0?0.6:0.56)*this._px();}
  measureText(t){return {width:this._adv()*String(t).length};}
  fillText(txt,x,y){
    txt=String(txt);
    const px=this._px(),adv=this._adv(),c=col(this.fillStyle);
    let ox=x;
    if(this.textAlign==='center')ox-=adv*txt.length/2;
    else if(this.textAlign==='right'||this.textAlign==='end')ox-=adv*txt.length;
    let oy=y;
    if(this.textBaseline==='middle')oy+=px*0.36;
    else if(this.textBaseline==='top')oy+=px*0.72;
    for(let i=0;i<txt.length;i++){
      if(txt[i]===' ')continue;
      const cx=ox+i*adv;
      this._fillPoly([[cx,oy-px*0.70],[cx+adv*0.86,oy-px*0.70],
                      [cx+adv*0.86,oy],[cx,oy]].map(p=>this._tp(p[0],p[1])),c);
    }
  }
  createImageData(w,h){return {width:w,height:h,data:new Uint8ClampedArray(w*h*4)};}
  getImageData(x,y,w,h){
    x=Math.round(x);y=Math.round(y);w=Math.round(w);h=Math.round(h);
    const out=new Uint8ClampedArray(w*h*4),d=this._d,W=this.cv._w,H=this.cv._h;
    for(let j=0;j<h;j++){
      const sy=y+j;if(sy<0||sy>=H)continue;
      for(let i=0;i<w;i++){
        const sx=x+i;if(sx<0||sx>=W)continue;
        const so=(sy*W+sx)*4,t=(j*w+i)*4;
        out[t]=d[so];out[t+1]=d[so+1];out[t+2]=d[so+2];out[t+3]=d[so+3];
      }
    }
    return {width:w,height:h,data:out};
  }
  putImageData(img,dx,dy){                 /* putImageData ignores the transform */
    dx=Math.round(dx);dy=Math.round(dy);
    const d=this._d,W=this.cv._w,H=this.cv._h,sd=img.data;
    for(let j=0;j<img.height;j++){
      const ty=dy+j;if(ty<0||ty>=H)continue;
      for(let i=0;i<img.width;i++){
        const tx=dx+i;if(tx<0||tx>=W)continue;
        const so=(j*img.width+i)*4,t=(ty*W+tx)*4;
        d[t]=sd[so];d[t+1]=sd[so+1];d[t+2]=sd[so+2];d[t+3]=sd[so+3];
      }
    }
  }
  drawImage(img,sx,sy,sw,sh,dx,dy,dw,dh){
    if(dx===undefined)throw new Error('stub drawImage: the 9-argument form is the only one used');
    const d=img._data;
    for(let j=0;j<dh;j++){
      const syy=sy+Math.floor(j*sh/dh);
      if(syy<0||syy>=img.height)continue;
      for(let i=0;i<dw;i++){
        const sxx=sx+Math.floor(i*sw/dw);
        if(sxx<0||sxx>=img.width)continue;
        const o=(syy*img.width+sxx)*4;
        this._blend(dx+i,dy+j,[d[o],d[o+1],d[o+2],d[o+3]/255]);
      }
    }
  }
}
/* the page the renderer thinks it is in */
const VIEW={w:1024,h:768,dpr:2};
const stage=new StubCanvas();
const ELS={stage};
globalThis.document={
  getElementById:id=>ELS[id]||null,
  createElement:t=>{if(t!=='canvas')throw new Error('stub createElement: '+t);return new StubCanvas();}
};
globalThis.window={innerWidth:VIEW.w,innerHeight:VIEW.h,devicePixelRatio:VIEW.dpr};
globalThis.APP={seed:7,gen:42,field:{label:'SPECTRO'},world:{label:'RD'}};

/* ═══ load the real renderer ══════════════════════════════════════════════ */
const SRC=new URL('../src/',import.meta.url);
const order=['core.js','w-field.js','w-synch.js','w-grav.js','w-rd.js','w-life.js',
             'data-gsfc.js','w-render.js'];
const present=readdirSync(SRC).filter(f=>f.endsWith('.js'));
const files=order.filter(f=>present.includes(f));
const src=files.map(f=>`/* ${f} */\n`+readFileSync(new URL(f,SRC),'utf8')).join('\n');
const api=new Function(`${src}
return {R, PAL, INKS, PAPER, DOT, newView, setM, drawStage, snapshotSheet,
        slips, measuredSlip, regTargets, printSeed};
`)();

/* ═══ the board the press is asked to pull ════════════════════════════════ */
const M=64;
Object.assign(api.R,{side:700,bx:306,by:26});
api.setM(M);
const n=M*M, V=api.newView(n), field={w:M,h:M,mask:new Uint8Array(n)};
for(let y=0;y<M;y++)for(let x=0;x<M;x++){
  const i=y*M+x;
  if((x*7+y*13)%5===0){V.live[i]=1;V.col[i]=(x*3+y)%api.PAL.length;}
  if((x*5+y*11)%17===0)V.stack[i]=2;
  if((x*3+y*7)%23===0)V.face[i]=1;
  if((x+y)%19===0)V.spark[i]=1;
  if(i%3===0)field.mask[i]=1;
}
const k=Math.min(2,window.devicePixelRatio||1);
const S=Math.round(api.R.side*k);
console.log('board   view '+VIEW.w+'x'+VIEW.h+' @'+VIEW.dpr+'x  sheet side '+
  api.R.side+' CSS px = '+S+' device px   grid '+M+'x'+M+
  '   asset '+api.PAL.length+' colours, '+api.DOT+' px ruling');

let fails=0, checks=0;
const ok=(cond,label)=>{checks++;console.log('   '+(cond?'ok  ':'FAIL')+'  '+label);if(!cond)fails++;};

/* ── 1. measuredSlip is linear in R.slipScale ───────────────────────────── */
console.log('\n1  registration in force, and the slipScale the operator dials in');
const at=[];
for(const s of [0,1,3]){
  api.R.slipScale=s;
  const sl=api.slips(7);
  const pairs=[];
  for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)
    pairs.push(Math.hypot(sl[i].dx-sl[j].dx,sl[i].dy-sl[j].dy));
  const m=api.measuredSlip(7), mx=Math.max(...pairs);
  at.push(m);
  console.log('   slipScale '+s+'   plates '+
    sl.map(p=>'('+p.dx.toFixed(3)+','+p.dy.toFixed(3)+')').join(' ')+
    '   pairwise '+pairs.map(v=>v.toFixed(4)).join('/')+
    '   measuredSlip '+m.toFixed(6)+
    (Math.abs(m-mx)<=1e-12?'  = max pairwise':'  != max pairwise '+mx.toFixed(6)));
  ok(Math.abs(m-mx)<=1e-12,'measuredSlip equals the worst pairwise plate distance');
}
api.R.slipScale=0;const s0=api.measuredSlip(7);
api.R.slipScale=1;const s1=api.measuredSlip(7);
api.R.slipScale=3;const s3=api.measuredSlip(7);
console.log('   scale 0 -> '+s0.toFixed(6)+'   1 -> '+s1.toFixed(6)+
            '   3 -> '+s3.toFixed(6)+'   (3x = '+(3*s1).toFixed(6)+')');
ok(s0===0,'slipScale 0 is exactly 0 device px of registration error');
ok(Math.abs(s3-3*s1)<=1e-9,'slipScale 3 is exactly 3x slipScale 1 (within 1e-9)');
api.R.slipScale=1;
console.log('   measuredSlip() with no argument -> '+api.measuredSlip().toFixed(6)+
            '  (APP.seed '+APP.seed+' is the seed the board prints with)');
ok(api.measuredSlip()===api.measuredSlip(7),
   'measuredSlip() falls back to the sheet\'s own seed');

/* ── the sheet itself ──────────────────────────────────────────────────── */
function pull(mode,slipScale,edition){
  api.R.slipScale=slipScale;
  api.drawStage(V,field,mode?{mode,edition}:{mode});
  const g=stage.getContext('2d');
  return g.getImageData(Math.round(api.R.bx*k),Math.round(api.R.by*k),S,S);
}
function sum(sheet){
  let h=2166136261;
  const d=sheet.data;
  for(let i=0;i<d.length;i++){h^=d[i];h=Math.imul(h,16777619);}
  return (h>>>0).toString(16).padStart(8,'0');
}
const PAPER=[243,236,221];
const inked=(d,o)=>Math.abs(d[o]-PAPER[0])>24||Math.abs(d[o+1]-PAPER[1])>24||Math.abs(d[o+2]-PAPER[2])>24;
function inkCount(sheet){
  let c=0;const d=sheet.data;
  for(let i=0;i<d.length;i+=4)if(inked(d,i))c++;
  return c;
}

console.log('\n2  does the scale reach the halftone, or only the readout?');
const p1=pull('proof',1), p3=pull('proof',3);
console.log('   proof slipScale 1  checksum '+sum(p1)+'  ink '+inkCount(p1)+' px');
console.log('   proof slipScale 3  checksum '+sum(p3)+'  ink '+inkCount(p3)+' px');
ok(sum(p1)!==sum(p3),'a different slipScale pulls different pixels from the same seed');

console.log('\n3  three states, three sheets');
const mk=pull('makeready',1), pr=pull('proof',1), ed=pull('edition',1,{n:3,N:12});
for(const [name,sh] of [['makeready',mk],['proof',pr],['edition',ed]])
  console.log('   '+name.padEnd(10)+' checksum '+sum(sh)+'   ink '+inkCount(sh)+' px');
ok(sum(mk)!==sum(pr)&&sum(pr)!==sum(ed)&&sum(mk)!==sum(ed),
   'makeready, proof and edition are three different sheets');

/* ── 4. the trim corners: marks on a proof, none on a trimmed pull ──────── */
/* Ink in the margin is two different things: a halftone dot from the image
   next to the trim (which is the picture crossing its own cut line, a dot
   radius wide) and a mark deliberately printed in the margin. Distance from
   the trim box tells them apart without guessing, so the corners are counted
   in distance buckets and the far buckets are what "carries crop marks" means. */
const BUCK=[4,8,12,20,32,64];
const MARK=8;                          /* ink this far outside the trim is a mark */
const FAR=BUCK.indexOf(MARK)+1;        /* first bucket at or beyond MARK */
const FRAME=4;    /* the stage strokes the sheet's cut edge over the pixels the
                     press just pulled: that line is the desk's decoration, not
                     ink on the sheet, so the outermost pixels are not sampled */
console.log('\n4  the four trim corners, ink bucketed by distance from the trim');
console.log('   buckets, device px from the trim: '+
  BUCK.map((b,i)=>'['+(BUCK[i-1]||0)+','+b+')').join(' '));
function corners(mode,sheet){
  const mg=Math.round(S*(mode==='edition'?0.022:0.072)), inner=S-mg*2, W=Math.round(S*0.04);
  const at=[[mg,mg,-1,-1],[S-mg,mg,1,-1],[mg,S-mg,-1,1],[S-mg,S-mg,1,1]];
  const bins=new Array(BUCK.length).fill(0), tot=new Array(BUCK.length).fill(0);
  for(const [cx,cy,sx,sy] of at){
    for(let y=Math.max(FRAME,cy-W);y<=Math.min(S-1-FRAME,cy+W);y++)
      for(let x=Math.max(FRAME,cx-W);x<=Math.min(S-1-FRAME,cx+W);x++){
        const dx=Math.max(0,sx<0?mg-x:x-(mg+inner));
        const dy=Math.max(0,sy<0?mg-y:y-(mg+inner));
        const d=Math.hypot(dx,dy);
        if(d<=0||d>=BUCK[BUCK.length-1])continue;
        let b=0;while(b<BUCK.length&&d>=BUCK[b])b++;
        tot[b]++;
        if(inked(sheet.data,(y*sheet.width+x)*4))bins[b]++;
      }
  }
  console.log('   '+mode.padEnd(10)+' margin '+String(mg).padStart(3)+' px   '+
    bins.map((c,i)=>c+'/'+tot[i]).join('  '));
  return {far:bins.slice(FAR).reduce((a,b)=>a+b,0), total:bins.reduce((a,b)=>a+b,0),
          bins, tot};
}
const cPr=corners('proof',pr), cEd=corners('edition',ed), cMk=corners('makeready',mk);
console.log('   ink beyond '+MARK+' px of the trim: proof '+cPr.far+' px   edition '+
            cEd.far+' px   makeready '+cMk.far+' px');
ok(cPr.far>0,'proof prints crop marks in the trim corners ('+cPr.far+' px beyond '+MARK+' px)');
ok(cEd.far===0,'edition leaves the trim corners free of marks ('+cEd.far+
   ' px beyond '+MARK+' px; '+cEd.total+' px nearer than that is the image\'s own halftone crossing its trim)');
ok(cMk.far>0,'makeready carries crop marks too ('+cMk.far+' px beyond '+MARK+' px)');

/* ── 5. the pulled sheet, handed to the tray ───────────────────────────── */
console.log('\n5  snapshotSheet(96) — the sheet the tray stacks');
const before=sum(pull('edition',1,{n:3,N:12}));
const laid=api.R.side;
api.R.side=0;
const emptyUrl=api.snapshotSheet(96);
api.R.side=laid;
const url=api.snapshotSheet(96);
const after=sum(stage.getContext('2d').getImageData(
  Math.round(api.R.bx*k),Math.round(api.R.by*k),S,S));
const head='data:image/png;base64,';
const bytes=Buffer.from(url.slice(head.length),'base64');
const pw=bytes.readUInt32BE(16),ph=bytes.readUInt32BE(20);
const sig=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
let thumb=0;
if(sig){
  let off=8, idat=null;
  while(off<bytes.length){
    const len=bytes.readUInt32BE(off), type=bytes.toString('latin1',off+4,off+8);
    if(type==='IDAT')idat=bytes.subarray(off+8,off+8+len);
    off+=12+len;
  }
  const stride=pw*4, raw=inflateSync(idat);
  for(let y=0;y<ph;y++)for(let x=0;x<pw;x++)if(inked(raw,(y*(stride+1)+1+x*4)))thumb++;
}
console.log('   url       '+url.slice(0,32)+'…   '+(url.length/1024).toFixed(1)+' kB');
console.log('   no sheet laid out (R.side 0) -> '+
            (emptyUrl===''?"'' (empty string)":emptyUrl.length+' chars, expected empty'));
console.log('   decoded   '+pw+'x'+ph+' png, oldest byte '+bytes[0]+
            ', inked thumbnail px '+thumb);
console.log('   stage     checksum before snapshot '+before+'   after '+after);
ok(url.startsWith(head),'snapshotSheet(96) returns a data:image/png;base64, string');
ok(emptyUrl==='',"snapshotSheet returns '' when there is no sheet on the stage");
ok(sig&&pw===96&&ph===96&&Math.max(pw,ph)===96,'the PNG decodes to a 96 px longest side ('+pw+'x'+ph+')');
ok(thumb>0,'the thumbnail carries ink ('+thumb+' px), not an empty canvas');
ok(before===after,'taking the snapshot leaves the stage canvas bit-identical');

api.R.slipScale=1;
console.log('\n'+files.length+' files loaded, '+checks+' checks, '+fails+' failed  '+
  (fails?'FAIL':'all furniture checks pass'));
process.exit(fails?1:0);

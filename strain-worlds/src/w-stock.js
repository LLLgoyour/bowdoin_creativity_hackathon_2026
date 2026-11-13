/* ═══════════════════════════════════════════════════════════════════════════
   w-stock.js — THE LIGHT TABLE. The source desk, and nothing else.

   The press owns registration, the proof and the edition; the ink library owns
   coverage and mixing; the listening bench owns sound. This desk owns exactly
   one thing, and it draws nothing else: which stock the job is made of. It is a
   lit tracing table with the WHOLE record laid on the glass — every sample, at
   its own amplitude, in one still picture, not a scope window with a playhead
   and not LIFE feedback rolling through it — and a rack of paper sheets on the
   right, one folder per stock the machine can be fed.

   Everything printed here is a number the record or the file already carries:
   rec.re/rec.im/rec.t/rec.amax/rec.turns/rec.timeUnit, APP.file.kind/name/size
   and the measured APP.wmeta of the wave a picture or a sound became. Nothing
   is estimated and nothing is invented, and there are no controls for anything
   that is not stock: no inks, no pins, no sound, no transport.

   Input is Main's job. This file only paints, and returns the rectangles it
   drew, in viewport CSS coordinates, plus the dials it borrowed. It listens to
   nothing, mutates nothing and opens no picker.
   ═══════════════════════════════════════════════════════════════════════════ */
const STOCK_STATION=(()=>{
  const W0=1020, H0=700;          /* the desk's own drawing box, scaled to fit */

  /* ── numbers, printed the way a workshop ticket prints them ─────────────── */
  function trimZeros(s){return s.indexOf('.')<0?s:s.replace(/0+$/,'').replace(/\.$/,'');}
  function fmt(v){
    if(typeof v!=='number'||!Number.isFinite(v))return '—';
    const a=Math.abs(v);
    if(a===0)return '0';
    if(a>=1e6||a<1e-4)return v.toExponential(2);
    if(a>=1000)return v.toFixed(0);
    if(a>=1)return trimZeros(v.toFixed(3));
    return trimZeros(v.toFixed(4));
  }
  /* raw t is raw: three decimals when the column is fractional, the integer
     itself when a file supplied integer steps or sample indices */
  function fmtT(v){
    if(typeof v!=='number'||!Number.isFinite(v))return '—';
    return Number.isInteger(v)?String(v):v.toFixed(3);
  }
  /* long names must fit the sheet: hard-split a file name that has no spaces */
  function wrap(s,max){
    const raw=String(s==null?'':s),out=[];let cur='';
    for(const word of raw.split(/\s+/)){
      if(!word)continue;
      if(cur&&cur.length+1+word.length>max){out.push(cur);cur=word;}
      else cur=cur?cur+' '+word:word;
      while(cur.length>max){out.push(cur.slice(0,max));cur=cur.slice(max);}
    }
    if(cur)out.push(cur);
    return out.length?out:[raw];
  }
  const clampVal=v=>v>1?1:(v<-1?-1:v);

  function srcLabel(srcId,file){
    if(srcId==='gsfc')return 'GSFC STRAIN';
    if(srcId==='noise')return 'HOUSE NOISE';
    if(srcId==='file')return file?('A FILE · '+String(file.kind||'').toUpperCase()):'A FILE';
    return String(srcId||'—').toUpperCase();
  }
  /* prepRecord's own amplitude semantics, restated where the number is shown */
  function ampWhat(rec){
    if(!rec)return '|z|';
    if(rec.kind==='image')return 'AMP = CONTOUR x (px)';
    if(rec.kind==='audio')return 'AMP = 20MS RMS';
    return rec.kind==='numeric'?'AMP = |z|, NORMALISED':'AMP = |z|';
  }

  /* ── one sheet of stock, drawn as a paper folder ─────────────────────────
     A manila back with a cut tab, a crease, and the leaf inside it. The chosen
     one pulls its leaf out, takes the coral pin and says so; the others sit
     flat. The whole rectangle is the hit area, so what you click is the sheet. */
  function folder(g,TL,C,x,y,w,h,o){
    const back=[[x,y+22],[x+14,y+22],[x+26,y],[x+w,y],[x+w,y+h],[x,y+h]];
    TL.poly(g,back,C.sun,o.on?.66:.24);
    if(o.on)TL.line(g,back.concat([back[0]]),C.blue,1.8);
    TL.line(g,[[x+2,y+h*.56],[x+w-2,y+h*.56]],C.blue,.5);
    const pull=o.on?7:0;
    const leaf=[[x+5,y+h*.56],[x+w-5,y+h*.56],[x+w-9,y+h-4+pull],[x+9,y+h-4+pull]];
    TL.poly(g,leaf,C.paper);
    TL.text(g,o.label,x+34,y+17,11,C.blue);
    if(o.on){
      TL.disc(g,x+w-14,y+11,5,C.coral);
      TL.text(g,'ON THE TABLE',x+w-24,y+17,9,C.coral,'right');
    }else TL.text(g,o.n,x+w-12,y+17,10,C.blue,'right');
    const maxCh=(w-40)/6;
    let lines=wrap(o.sub,maxCh);
    if(lines.length>2)lines=[lines[0],lines[1].slice(0,maxCh-1)+'…'];
    lines.forEach((t,k)=>TL.text(g,t,x+14,y+h-13+pull-(lines.length-1-k)*13,9,C.blue));
    return {id:o.id,x:x-2,y:y-2,w:w+4,h:h+4};
  }

  function paint(ctx,W,H){
    const TL=ROOMVIEW.tools, C=TL.colors, g=ctx;
    const A=(typeof APP!=='undefined')?APP:null;
    const acts=[], knobs=[];
    const rec=A?A.rec:null;
    const srcId=A?String(A.srcId||''):'';
    const hasRec=!!(rec&&rec.re&&rec.re.length);
    const file=A?A.file:null;
    const hasFile=!!file;
    const hasHarm=!!(typeof API!=='undefined'&&API.hasHarmonics&&API.hasHarmonics());
    const partials=(hasHarm&&typeof API.harmonics==='function')?API.harmonics():0;

    /* ── the record, measured once per paint, in one pass ─────────────────── */
    let n=0,pk=0,amax=0,turns=0,t0=0,t1=0,reLo=0,reHi=0,imLo=0,imHi=0,pkAt=0;
    if(hasRec){
      n=rec.re.length;
      reLo=imLo=Infinity;reHi=imHi=-Infinity;
      for(let i=0;i<n;i++){
        const r=rec.re[i],m=rec.im[i];
        if(r<reLo)reLo=r; if(r>reHi)reHi=r;
        if(m<imLo)imLo=m; if(m>imHi)imHi=m;
        const a=Math.abs(r),b=Math.abs(m);
        if(a>pk){pk=a;pkAt=i;}
        if(b>pk){pk=b;pkAt=i;}
      }
      if(!Number.isFinite(reLo)){reLo=reHi=imLo=imHi=0;}
      amax=Number.isFinite(rec.amax)?rec.amax:0;
      turns=Number.isFinite(rec.turns)?rec.turns:0;
      t0=rec.t?rec.t[0]:0;
      t1=rec.t?rec.t[n-1]:n-1;
    }
    const span=pk>0?pk:1;                       /* the drawing's own amplitude */

    const s=Math.min((W-42)/W0,(H-100)/H0), ox=(W-W0*s)/2, oy=(H-H0*s)/2;
    g.save(); g.translate(ox,oy); g.scale(s,s);

    /* ── the table ────────────────────────────────────────────────────────── */
    const deck=[[10,36],[54,14],[1006,20],[1000,660],[36,678]];
    TL.poly(g,deck,C.blue,.42);                 /* the top, in blue ink       */
    for(const c of [[54,14],[1006,20],[1000,660],[36,678]]){
      TL.disc(g,c[0],c[1],4.6,C.paper);TL.disc(g,c[0],c[1],1.6,C.blue);
    }
    const sheet=[[30,46],[982,40],[976,652],[24,662]];
    TL.poly(g,sheet,C.paper);                   /* the tracing sheet itself   */
    TL.line(g,TL.ellipse(60,76,7,7),C.blue,.9);  /* its punched hole           */
    /* the bulldog clip holding the sheet down */
    TL.poly(g,[[480,20],[552,17],[554,29],[478,32]],C.paper);
    TL.poly(g,[[470,29],[562,26],[568,45],[466,48]],C.blue,.55);
    TL.disc(g,492,39,4,C.paper);TL.disc(g,542,37,4,C.paper);
    TL.line(g,[[518,24],[520,44]],C.blue,1.2);
    /* what this desk is, and the one thing it is not */
    TL.text(g,'THE LIGHT TABLE',92,76,18,C.blue);
    TL.text(g,'SOURCE · WHAT COMES IN IS THE COMMISSION',94,94,10,C.coral);

    /* ── the light table: the whole record, still ─────────────────────────── */
    const glass=[[46,120],[648,116],[644,508],[42,514]];
    TL.poly(g,glass,C.sun,.14);
    TL.line(g,glass.concat([glass[0]]),C.sun,2.6);              /* the lit rim  */
    TL.line(g,[[58,131],[636,127],[632,497],[54,503],[58,131]],C.blue,.6);

    const wx0=64,wx1=632;
    TL.text(g,'01  Re(h)',wx0,141,11,C.blue);
    TL.text(g,'02  Im(h)',300,141,11,C.coral);
    TL.text(g,'THE WHOLE RECORD',wx1,141,9,C.blue,'right');

    const tracks=[['re','Re',C.blue,190],['im','Im',C.coral,286]];
    const half=46;
    for(const tk of tracks){
      const key=tk[0],cy=tk[3],ink=tk[2],chan=rec?rec[key]:null;
      TL.line(g,[[wx0,cy],[wx1,cy]],C.blue,.45);
      TL.line(g,[[wx0,cy-half],[wx1,cy-half]],C.blue,.35);
      TL.disc(g,wx0+8,cy-half+8,3.2,ink,1);
      TL.text(g,tk[1],wx0+15,cy-half+12,10,ink);
      TL.text(g,'±'+fmt(span),wx1-4,cy-half+12,9,C.blue,'right');
      if(!hasRec||!chan||n<1)continue;
      /* one column per displayed pixel: the min and max inside each column keep
         the extremes of the record without one point per sample */
      const cols=Math.max(1,Math.min(Math.round(wx1-wx0),n));
      const hi=new Float64Array(cols),lo=new Float64Array(cols);
      for(let k=0;k<cols;k++){
        let a=Math.floor(k*n/cols),b=Math.max(a+1,Math.floor((k+1)*n/cols));
        if(b>n)b=n;
        let mx=-Infinity,mn=Infinity;
        for(let i=a;i<b;i++){const v=chan[i];if(v>mx)mx=v;if(v<mn)mn=v;}
        if(mx===-Infinity){mx=mn=chan[a]||0;}
        hi[k]=mx;lo[k]=mn;
      }
      const xa=k=>wx0+(cols>1?k/(cols-1):0)*(wx1-wx0);
      const band=[],top=[];
      for(let k=0;k<cols;k++){
        const x=xa(k),y=cy-clampVal(hi[k]/span)*half;
        band.push([x,y]);top.push([x,y]);
      }
      for(let k=cols-1;k>=0;k--)band.push([xa(k),cy-clampVal(lo[k]/span)*half]);
      TL.poly(g,band,ink,.30);                  /* the printed band           */
      TL.line(g,top,ink,1);                     /* and its upper edge         */
    }

    /* ── the t axis: real ends, real values, no playhead anywhere ─────────── */
    if(hasRec&&n>1){
      const unit=rec.timeUnit?String(rec.timeUnit):'raw t units';
      TL.line(g,[[wx0,348],[wx1,348]],C.blue,.9);
      for(let k=0;k<5;k++){
        const x=wx0+k/4*(wx1-wx0);
        TL.line(g,[[x,348],[x,341]],C.blue,.8);
        const t=fmtT(rec.t[Math.round(k/4*(n-1))]);
        TL.text(g,t,x,361,9,C.blue,k===0?'left':(k===4?'right':'center'));
      }
      TL.text(g,'t ('+unit+')',wx0,376,9,C.coral);
      TL.text(g,'SAMPLE INDEX 0 … '+(n-1),wx1,376,9,C.blue,'right');
    }

    /* ── the numbers the glass carries: this record, or the file it came from ─ */
    const band=[];
    if(hasFile&&srcId==='file'&&A.wmeta){
      const m=A.wmeta;
      if(m.kind==='image'){
        band.push('FIT  P '+fmt(m.P)+' OF '+fmt(m.maxP)+' PARTIALS · RMS '+fmt(m.rms)+
          ' px · WORST '+fmt(m.max)+' px');
        band.push('CONTOUR  '+m.points+' SAMPLES · '+m.loops+' LOOP'+(m.loops===1?'':'S')+
          ' · '+m.crossings+' CROSSINGS');
        band.push('FRAME  '+m.source+' → '+m.frame+' · OTSU '+fmt(m.level));
        band.push('SILHOUETTE IoU '+fmt(m.iou));
      }else if(m.kind==='audio'){
        band.push('SOURCE  '+m.source+' SAMPLES AT '+m.sr+' Hz');
        band.push('BOX-AVERAGED ×'+m.factor+' ONTO '+m.points+' SAMPLES AT '+fmt(m.rate)+' SAMPLES/s');
      }else{
        band.push('NUMERIC FILE  '+m.points+' POINTS IN '+m.columns+' COLUMN'+(m.columns===1?'':'S'));
        band.push('Re AND Im AS WRITTEN · NOTHING SMOOTHED');
      }
      TL.text(g,'MEASURED FROM THE FILE',64,392,9,C.coral);
    }else{
      TL.text(g,'MEASURED ON THE GLASS',64,392,9,C.coral);
      if(hasRec){
        band.push('PHASE SPAN  '+fmt(turns)+' TURNS OF ACCUMULATED PHASE');
        band.push('Re ['+fmt(reLo)+', '+fmt(reHi)+']   Im ['+fmt(imLo)+', '+fmt(imHi)+']');
        band.push('HEAVIEST SAMPLE '+pkAt+' OF '+(n-1));
        band.push('SET BY '+srcLabel(srcId,file));
      }
    }
    band.slice(0,4).forEach((t,k)=>TL.text(g,t,64,414+k*22,9,C.blue));

    /* ── the ticket under the glass: what is on the table right now ────────── */
    TL.text(g,'RECORD',64,524,10,C.coral);
    wrap(hasRec&&rec.name?String(rec.name):'NO STOCK ON THE TABLE',74).slice(0,2)
      .forEach((t,k)=>TL.text(g,t,156,524+k*15,10,C.blue));
    const row=(y,l1,v1,l2,v2)=>{
      TL.text(g,l1,64,y,10,C.coral); if(v1!=null)TL.text(g,v1,150,y,10,C.blue);
      TL.text(g,l2,360,y,10,C.coral); if(v2!=null)TL.text(g,v2,450,y,10,C.blue);
    };
    if(hasRec){
      row(572,'STOCK',srcLabel(srcId,file),
            'KIND',String(rec.kind||'—')+(srcId==='noise'?(' · SEED '+A.seed):''));
      row(600,'SAMPLES',n+' SAMPLES · INDEX 0 … '+(n-1),
            'PEAK',fmt(pk)+(pkAt?' AT '+pkAt:'')+' (|Re|,|Im|)');
      row(628,'TIME t',fmtT(t0)+' … '+fmtT(t1)+' · '+(rec.timeUnit?String(rec.timeUnit):'raw t units'),
            'AMP MAX',fmt(amax)+' · '+ampWhat(rec));
    }

    /* ── the rack: three sheets always, a fourth once a file has landed ───── */
    const rx=668,rw=326;
    TL.text(g,'CHOOSE THE SHEET',rx,140,13,C.blue);
    TL.text(g,'CLICK ONE · IT BECOMES THE COMMISSION',rx,156,9,C.coral);
    const sheets=[];
    sheets.push({id:'source:gsfc',label:'GSFC STRAIN',n:'1',
      sub:'INCLUDED · '+((typeof GSFC!=='undefined'&&GSFC.n)?GSFC.n:773)+' SAMPLES',on:srcId==='gsfc'});
    sheets.push({id:'source:noise',label:'HOUSE NOISE',n:'2',
      sub:'RE-CUT AT SEED '+(A?A.seed:'—'),on:srcId==='noise'});
    if(hasFile)sheets.push({id:'source:file',label:'ALREADY ON THE TABLE',n:'3',
      sub:String(file.kind||'').toUpperCase()+(file.size?(' '+file.size):'')+' · '+file.name,
      on:srcId==='file'});
    sheets.push({id:'source:open',label:'OPEN A REAL FILE',n:hasFile?'4':'3',
      sub:'IMAGE · SOUND · NUMBERS',on:false});
    let fy=166;
    for(const sh of sheets){acts.push(folder(g,TL,C,rx,fy,rw,64,sh));fy+=78;}

    /* ── the harmonics dial, only while a picture is on the table ─────────── */
    if(hasHarm){
      /* a small instrument bolted to the paper, not the bench's dark console:
         the plate is only as big as the dial needs for its pale labels */
      TL.poly(g,[[664,476],[758,474],[760,596],[666,598]],C.teal,.78);
      TL.disc(g,672,482,2.6,C.paper);TL.disc(g,750,590,2.6,C.paper);
      TL.knob(g,'harmonics','HARMONICS P',710,537,27,(partials-1)/1022,'P '+partials,knobs);
      TL.text(g,'PARTIALS OF THE DFT FIT',786,516,10,C.blue);
      TL.text(g,'MAX 1023',786,534,9,C.blue);
      TL.text(g,'RE-CUTS THE WAVE',786,552,9,C.blue);
      TL.text(g,'NEW STOCK VOIDS THE PROOF.',rx,628,9,C.blue);
      TL.text(g,'DELIVERED SHEETS STAY.',rx,644,9,C.blue);
    }else{
      /* a torn slip pinned to the rack, so the rule is on the desk and not in a
         dialog: stock IS the commission, and the edition is never rewound */
      TL.poly(g,[[rx+4,512],[rx+18,502],[rx+40,512],[rx+66,504],[rx+96,514],
        [rx+130,505],[rx+170,514],[rx+210,504],[rx+250,513],[rx+290,504],
        [rx+rw-4,512],[rx+rw-4,626],[rx+4,626]],C.paper);
      TL.line(g,[[rx+6,556],[rx+rw-8,556]],C.blue,.5);
      TL.disc(g,rx+rw-30,506,4.4,C.coral);
      TL.text(g,'NEW STOCK VOIDS THE PROOF.',rx+20,576,10,C.blue);
      TL.text(g,'DELIVERED SHEETS STAY.',rx+20,596,10,C.blue);
    }

    g.restore();
    /* the rectangles and dials leave in the window's own coordinates */
    for(const a of acts){a.x=ox+a.x*s;a.y=oy+a.y*s;a.w*=s;a.h*=s;}
    for(const k of knobs){k.x=ox+k.x*s;k.y=oy+k.y*s;k.r*=s;}
    return {actions:acts,knobs:knobs};
  }

  return {paint};
})();

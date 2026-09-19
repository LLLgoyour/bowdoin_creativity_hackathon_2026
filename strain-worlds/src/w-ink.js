/* ═══════════════════════════════════════════════════════════════════════════
   w-ink.js — THE INK LIBRARY. The mixing bench: three tins of the press's own
   inks (BLUE, FLUORESCENT PINK, YELLOW), each with the screen ladder of its own
   ink, the bench's fixed overprint chart, and the ONE current sample sheet. The
   sheet is not a picture of a sample — it is the press's own overprint, handed
   over by the app, so it changes the moment a plate's coverage changes.

   Three dials set how much of each plate reaches the paper. A dial is a
   COVERAGE MULTIPLIER, never a level gauge: it thins or heavies that plate's
   dots and it does not measure, mix or empty the tin, so nothing on this bench
   shows how much ink is left. Changing coverage is a job change — the press
   voids the proof it can no longer stand behind and a new proof has to be
   pulled and read — while sheets already delivered stay in the tray.

   Station contract: paint(ctx,W,H,sampleCanvas) draws in design units and
   returns {actions,knobs}. It attaches nothing, mutates nothing and routes
   nothing: the three knobs come back in viewport CSS coordinates for Main.
   ═══════════════════════════════════════════════════════════════════════════ */
const INK_STATION=(()=>{
  /* ── the bench, in the units it was drawn in ───────────────────────────── */
  const LW=1020, LH=740;
  const MONO_UI='ui-monospace,Menlo,monospace';
  /* the press's three plates, in the order the checking bar reads them */
  const INK_NAME=['BLUE','FLUORESCENT PINK','YELLOW'];
  const INK_SHORT=['BLUE','PINK','YELLOW'];
  const PLATE=[[1,0,0],[0,1,0],[0,0,1]];
  /* each plate's own screen ladder, light tint to solid, and its readout */
  const LADDER=[.12,.30,.50,.70,.88,1];
  const LADDER_PC=['12','30','50','70','88','100'];
  /* the checking bar's seven recipes, each at full ink and at half tint */
  const BAR=[[1,0,0],[0,1,0],[0,0,1],[1,1,0],[0,1,1],[1,0,1],[1,1,1]];
  const BAR_NAME=['BLUE','PINK','YELLOW','BLUE+PINK','PINK+YELLOW','BLUE+YELLOW',
                  'ALL THREE'];
  /* the shop's own workflow states, in the words the bench would letter */
  const PROOF={makeready:'MAKEREADY',proof:'PROOF PULLED',run:'EDITION RUNNING',
    done:'DELIVERED'};

  const TIN_Y=144, TIN_W=196, TIN_H=150, TIN_X=[6,214,422];
  const SHELF_Y=296;                        /* the board the tins stand on */
  const LAD_Y=326, LAD_W=28, LAD_GAP=1.4;
  const NOTE_Y=392, NOTE_W=612, NOTE_H=44;
  const CHART_Y=446, CHART_W=612, CHART_H=208;
  const CELL_W=38, CELL_GAP=4, CELL_X=18, CELL_H=60;
  const BAND_Y=672;                         /* the bench lettering rule */
  const BOARD_X=650, BOARD_Y=152, BOARD_W=370, BOARD_H=326;
  const SHEET_X=660, SHEET_Y=156, SHEET_W=356, SHEET_H=314;
  const WIN_X=720, WIN_Y=162, WIN_W=236, WIN_H=236;
  const SOURCE_Y=124, SOURCE_W=364, SOURCE_X=656;
  const PANEL_X=656, PANEL_Y=480, PANEL_W=364, PANEL_H=180;
  const DIAL_Y=576, DIAL_R=28, DIAL_X=[726,838,950];
  const CHIP_Y=510, CHIP_H=12, CHIP_W=90;
  const COVERAGE=v=>.30+1.10*v;             /* the press's own key equation */
  const TIMES='\u00d7';

  /* ── the vocabulary, taken from the workshop's own tools ────────────────
     Resolved on the first paint (never at load): the tools belong to the room
     and the room owns them. The three plates are the press's inks, not palette
     colours, so they are stated here in ink coverage like everything else. */
  let VOC=null;
  function voc(T){
    if(VOC)return VOC;
    const c=(T&&T.colors)||{};
    VOC={paper:c.paper||[0,0,0],
      blue:c.blue||[.86,.43,.18], coral:c.coral||[.02,.72,.54],
      teal:c.teal||[.65,.02,.12], sun:c.sun||[.05,.09,.92], pink:c.pink||[.07,.46,.03],
      wood:[.82,.44,.28], pane:[.96,.66,.46], mid:[.46,.20,.13], dim:[.58,.38,.30]};
    return VOC;
  }
  /* a line of lettering is set to the width it has been given: a label that
     runs off its own plate is a misprint, not a style */
  function fit(g,s,size,maxW){
    let z=size;
    g.font=z+'px '+MONO_UI;
    while(z>5.5&&g.measureText(s).width>maxW){z-=.25;g.font=z+'px '+MONO_UI;}
    return z;
  }
  function say(g,T,P,s,x,y,size,cov,align,maxW){
    T.text(g,s,x,y,maxW?fit(g,s,size,maxW):size,cov,align||'left');
  }

  /* ── the tins ────────────────────────────────────────────────────────────
     A tin is printed in its own ink: the body is that plate solid, the metal
     shoulder is a near-black screen, and the name plate is where the tin is
     named. No tin has a liquid drawn in it — the tins hold ink, the dials set
     coverage, and one is not a reading of the other. */
  function drawTin(g,T,P,x,i,plate){
    const w=TIN_W,h=TIN_H,y=TIN_Y,cx=x+w/2;
    T.poly(g,T.ellipse(cx,SHELF_Y+1,w*.46,7),P.pane,.24,false);
    T.poly(g,[[x+10,y],[x+w-10,y],[x+w,y+h],[x,y+h]],plate,1);
    /* a highlight down the near side and a shadow down the far one */
    T.poly(g,[[x+20,y+6],[x+54,y+6],[x+44,y+h-10],[x+12,y+h-10]],plate,.34,false);
    T.poly(g,[[x+w-34,y+6],[x+w-8,y+6],[x+w,y+h-10],[x+w-16,y+h-10]],P.pane,.30,false);
    /* the shoulder and the tin's mouth, seen a little from above */
    T.poly(g,T.ellipse(cx,y,w/2-10,11),plate,1);
    T.poly(g,T.ellipse(cx,y,w/2-21,7),P.pane,.55,false);
    T.line(g,[[x+10,y],[cx,y+11],[x+w-10,y]],P.pane,1.2);
    /* the lugs */
    for(const lx of [x+7,x+w-7]){
      T.disc(g,lx,y+h*.56,5,P.pane,.8);
      T.disc(g,lx,y+h*.56,2,P.paper,1);
    }
    /* the name plate */
    T.poly(g,[[x+16,y+54],[x+w-16,y+54],[x+w-16,y+102],[x+16,y+102]],P.pane,1);
    T.line(g,[[x+16,y+54],[x+w-16,y+54],[x+w-16,y+102],[x+16,y+102],[x+16,y+54]],P.paper,.9);
    say(g,T,P,INK_NAME[i],cx,y+83,15,P.paper,'center',w-44);
    say(g,T,P,'PLATE '+(i+1)+' · '+(i===1?'FLUORESCENT':'STRAIGHT'),cx,y+96,8.5,P.sun,'center',w-44);
  }
  /* each tin's own screen, drawn at the dots' real sizes: the ladder says what
     that ink looks like thinned, and the dials say how heavy it prints today */
  function drawLadder(g,T,P,x,i){
    for(let k=0;k<LADDER.length;k++){
      const v=LADDER[k],lx=x+10+k*(LAD_W+LAD_GAP);
      T.poly(g,[[lx,LAD_Y],[lx+LAD_W,LAD_Y],[lx+LAD_W,LAD_Y+40],[lx,LAD_Y+40]],
        [v*PLATE[i][0],v*PLATE[i][1],v*PLATE[i][2]],1,true);
      T.text(g,LADDER_PC[k],lx+LAD_W/2,LAD_Y+52,7,P.mid,'center');
    }
  }

  /* ── the bench: everything that never changes ─────────────────────────── */
  function drawBench(g,T,P){
    /* the backboard, cut square and printed in the press's own blue */
    T.poly(g,[[0,26],[40,0],[LW,0],[LW,88],[0,116]],P.blue,1);
    T.poly(g,[[0,30],[36,6],[LW-14,6],[LW-14,76],[0,100]],P.pane,.86,false);
    say(g,T,P,'THE INK LIBRARY',34,74,22,P.paper,'left');
    say(g,T,P,'COVERAGE · THE CURRENT SAMPLE',LW-32,54,11,P.sun,'right',480);

    /* the shelf, its brackets, and the three tins standing on it */
    T.poly(g,[[0,SHELF_Y],[624,SHELF_Y-4],[624,SHELF_Y+14],[0,SHELF_Y+18]],P.wood,1);
    T.line(g,[[0,SHELF_Y+18],[624,SHELF_Y+14]],P.pane,1.2);
    for(const bx of [40,566])
      T.poly(g,[[bx,SHELF_Y+18],[bx+22,SHELF_Y+17],[bx+22,SHELF_Y+42],[bx,SHELF_Y+44]],
        P.pane,.5,false);
    for(let i=0;i<3;i++)drawTin(g,T,P,TIN_X[i],i,PLATE[i]);
    for(let i=0;i<3;i++)drawLadder(g,T,P,TIN_X[i],i);

    /* the bench note: what the ladders are */
    T.poly(g,[[6,NOTE_Y],[6+NOTE_W,NOTE_Y-4],[6+NOTE_W,NOTE_Y+NOTE_H-4],[6,NOTE_Y+NOTE_H]],
      P.paper,1);
    T.disc(g,17,NOTE_Y+14,3.5,P.coral,1);
    say(g,T,P,'12% TO SOLID · ONE INK PER LADDER',
      30,NOTE_Y+12,9.5,P.blue,'left',NOTE_W-36);

    /* the overprint chart: the seven recipes the press can make, each solid and
       then at half tint, printed on this paper like everything else here */
    T.poly(g,[[6,CHART_Y+4],[6+CHART_W,CHART_Y],[6+CHART_W,CHART_Y+CHART_H-4],
      [6,CHART_Y+CHART_H]],P.paper,1);
    say(g,T,P,'OVERPRINT CHART',22,CHART_Y+24,12.5,P.blue,'left');
    for(let k=0;k<BAR.length;k++){
      const px=CELL_X+k*2*(CELL_W+CELL_GAP);
      say(g,T,P,BAR_NAME[k],px+CELL_W+CELL_GAP/2,CHART_Y+42,8,P.mid,'center',(CELL_W+CELL_GAP)*2-6);
      for(let h=0;h<2;h++){
        const c=BAR[k],x0=px+h*(CELL_W+CELL_GAP),top=CHART_Y+48;
        T.poly(g,[[x0,top],[x0+CELL_W,top],[x0+CELL_W,top+CELL_H],[x0,top+CELL_H]],
          h?[c[0]*.5,c[1]*.5,c[2]*.5]:c,1,true);
      }
    }
    say(g,T,P,'FULL INK LEFT · HALF TINT RIGHT',
      22,CHART_Y+132,10,P.blue,'left',CHART_W-28);

    /* the sample sheet on its own board, and the printing area it is laid in */
    T.poly(g,[[BOARD_X,BOARD_Y],[BOARD_X+BOARD_W,BOARD_Y],
      [BOARD_X+BOARD_W,BOARD_Y+BOARD_H+4],[BOARD_X,BOARD_Y+BOARD_H]],P.wood,1);
    T.poly(g,[[SHEET_X,SHEET_Y+SHEET_H],[SHEET_X+SHEET_W,SHEET_Y+SHEET_H],
      [SHEET_X+SHEET_W,SHEET_Y+SHEET_H+8],[SHEET_X,SHEET_Y+SHEET_H+8]],P.pane,.3,false);
    T.poly(g,[[SHEET_X,SHEET_Y],[SHEET_X+SHEET_W,SHEET_Y],
      [SHEET_X+SHEET_W,SHEET_Y+SHEET_H],[SHEET_X,SHEET_Y+SHEET_H]],P.paper,1);
    T.line(g,[[WIN_X,WIN_Y],[WIN_X+WIN_W,WIN_Y],[WIN_X+WIN_W,WIN_Y+WIN_H],
      [WIN_X,WIN_Y+WIN_H],[WIN_X,WIN_Y]],P.mid,1.1);
    for(const [cx,cy,sx,sy] of [[WIN_X,WIN_Y,-1,-1],[WIN_X+WIN_W,WIN_Y,1,-1],
                                [WIN_X,WIN_Y+WIN_H,-1,1],[WIN_X+WIN_W,WIN_Y+WIN_H,1,1]]){
      T.line(g,[[cx+sx*6,cy],[cx+sx*24,cy]],P.mid,1.6);
      T.line(g,[[cx,cy+sy*6],[cx,cy+sy*24]],P.mid,1.6);
    }
    T.line(g,[[SHEET_X+10,WIN_Y+WIN_H+14],[SHEET_X+SHEET_W-10,WIN_Y+WIN_H+14]],P.mid,.8);

    /* the board's label, and the dark plate the three dials sit on: the knob
       labels are pale ink, so they need a panel behind them */
    T.poly(g,[[SOURCE_X,SOURCE_Y],[SOURCE_X+SOURCE_W,SOURCE_Y],
      [SOURCE_X+SOURCE_W,SOURCE_Y+26],[SOURCE_X,SOURCE_Y+30]],P.pane,1);
    say(g,T,P,'THE SAMPLE ON THE PAPER',SOURCE_X+12,SOURCE_Y+17,11.5,P.paper,'left');
    T.poly(g,[[PANEL_X,PANEL_Y+4],[PANEL_X+PANEL_W,PANEL_Y],
      [PANEL_X+PANEL_W,PANEL_Y+PANEL_H],[PANEL_X,PANEL_Y+PANEL_H+4]],P.pane,1);
    T.line(g,[[PANEL_X+12,PANEL_Y+10],[PANEL_X+PANEL_W-12,PANEL_Y+8]],P.sun,1.1);
    say(g,T,P,'COVERAGE DIALS · ONE PER PLATE',PANEL_X+12,PANEL_Y+22,10.5,P.paper,'left');
    say(g,T,P,'0.30'+TIMES+' LIGHT · 1.40'+TIMES+' HEAVY',PANEL_X+PANEL_W-12,PANEL_Y+22,9,P.sun,'right');

    /* the bench lettering, cut along the front edge */
    T.line(g,[[0,BAND_Y],[LW,BAND_Y]],P.pane,1.2);
    say(g,T,P,'NEW COVERAGE VOIDS THE PROOF · KEPT SHEETS STAY',
      2,BAND_Y+22,12,P.coral,'left',LW-24);
  }

  /* ── the bench, printed once per window size ─────────────────────────────
     The bench is a fixed cut: it is drawn into its own sheet at the resolution
     the window asks for and stamped down, so the halftone stays crisp and no
     frame rebuilds two hundred shapes. Only a change of scale rebuilds it. */
  const ART={cv:null,key:''};
  function benchImage(A,T,P){
    const key=A.toFixed(2);
    if(ART.cv&&ART.key===key)return ART.cv;
    const cv=ART.cv||(ART.cv=document.createElement('canvas'));
    cv.width=Math.max(1,Math.round(LW*A));
    cv.height=Math.max(1,Math.round(LH*A));
    const g=cv.getContext('2d');
    g.save();g.scale(A,A);
    drawBench(g,T,P);
    g.restore();
    ART.key=key;
    return cv;
  }

  /* ── the sample: the press's own overprint, not a copy of one ─────────── */
  function drawSample(g,T,P,canvas,plate,law,state,kept,sheets,keys){
    if(canvas&&canvas.width>0&&canvas.height>0){
      const k=Math.min(WIN_W/canvas.width,WIN_H/canvas.height);
      const w=canvas.width*k,h=canvas.height*k;
      g.drawImage(canvas,WIN_X+(WIN_W-w)/2,WIN_Y+(WIN_H-h)/2,w,h);
    }else{
      /* no commission on the plate: say so instead of printing an example */
      T.text(g,'NO SAMPLE ON THE PLATE',WIN_X+WIN_W/2,WIN_Y+WIN_H/2-4,12,P.mid,'center');
      T.text(g,'A PROOF IS PULLED AT THE PRESS',WIN_X+WIN_W/2,WIN_Y+WIN_H/2+14,9,P.dim,'center');
    }
    const bx=SHEET_X+10,bw=SHEET_W-20,by=WIN_Y+WIN_H;
    say(g,T,P,'PLATE · '+plate+' · LAW · '+law,bx,by+32,9.5,P.blue,'left',bw);
    say(g,T,P,'STATE · '+state+(sheets?(' · '+kept+' OF '+sheets+' SHEETS KEPT'):''),
      bx,by+46,9.5,P.mid,'left',bw);
    say(g,T,P,'COVERAGE · '+keys[0]+TIMES+' '+keys[1]+TIMES+' '+keys[2]+TIMES+' ON THE THREE PLATES',
      bx,by+60,9.5,P.coral,'left',bw);
  }

  /* ── the three coverage dials ───────────────────────────────────────────
     Each dial carries the ink it moves and the paper key of that ink at the
     setting the dial is on: the chip above it is that plate's dots as the press
     will lay them, so the chip and the number are the same fact. */
  const K=[];
  const KNOBS=[{id:'ink:0',x:0,y:0,r:0},{id:'ink:1',x:0,y:0,r:0},{id:'ink:2',x:0,y:0,r:0}];
  function drawDials(g,T,P,keys){
    K.length=0;
    for(let i=0;i<3;i++){
      const x=DIAL_X[i],q=Math.round(clamp(COVERAGE(keys[i]),0,1)*40)/40;
      const chip=[i===0?q:0,i===1?q:0,i===2?q:0];
      T.poly(g,[[x-CHIP_W/2,CHIP_Y],[x+CHIP_W/2,CHIP_Y],
        [x+CHIP_W/2,CHIP_Y+CHIP_H],[x-CHIP_W/2,CHIP_Y+CHIP_H]],chip,1,true);
      T.text(g,INK_NAME[i],x,CHIP_Y+CHIP_H-3.5,7.5,P.paper,'center');
      T.knob(g,'ink:'+i,INK_SHORT[i],x,DIAL_Y,DIAL_R,keys[i],
        COVERAGE(keys[i]).toFixed(2)+TIMES,K);
    }
  }

  return {
    /* Main clears the canvas, draws the common navigation over y18..49, routes
       the pointer and keeps every mutation; this only prints the bench. */
    paint(ctx,W,H,sampleCanvas){
      const T=(typeof ROOMVIEW!=='undefined'&&ROOMVIEW.tools)||null;
      if(!T)return {actions:[],knobs:[]};
      const P=voc(T);
      const s=Math.min(2,Math.max(.2,Math.min((W-42)/LW,(H-100)/LH)));
      const ox=Math.round((W-LW*s)/2), oy=58;
      const dpr=Math.min(2,(typeof devicePixelRatio==='number'?devicePixelRatio:1)||1);
      const keys=[0,0,0];
      const key=(typeof SHV!=='undefined'&&SHV&&SHV.key)||null;
      for(let i=0;i<3;i++)keys[i]=clamp(key&&key[i]!=null?key[i]:0.64,0,1);
      const field=(typeof APP!=='undefined'&&APP&&APP.field)||null;
      const world=(typeof APP!=='undefined'&&APP&&APP.world)||null;
      const shop=(typeof SHOP!=='undefined'&&SHOP)||null;
      const pulled=(shop&&shop.pulled)||null;
      let kept=0;
      if(pulled)for(let i=0;i<pulled.length;i++)if(pulled[i]&&pulled[i].kind==='edition')kept++;

      ctx.save();
      ctx.drawImage(benchImage(clamp(s*dpr,1,2.5),T,P),ox,oy,LW*s,LH*s);
      ctx.translate(ox,oy);ctx.scale(s,s);
      drawSample(ctx,T,P,sampleCanvas,
        (field&&field.label)||'—',(world&&world.label)||'—',
        PROOF[(shop&&shop.state)||'makeready']||PROOF.makeready,
        kept,(shop&&shop.N)||0,
        [COVERAGE(keys[0]).toFixed(2),COVERAGE(keys[1]).toFixed(2),COVERAGE(keys[2]).toFixed(2)]);
      drawDials(ctx,T,P,keys);
      ctx.restore();

      for(let i=0;i<3;i++){const k=K[i];KNOBS[i].x=ox+k.x*s;KNOBS[i].y=oy+k.y*s;KNOBS[i].r=k.r*s;}
      return {actions:[],knobs:[KNOBS[0],KNOBS[1],KNOBS[2]]};
    }
  };
})();

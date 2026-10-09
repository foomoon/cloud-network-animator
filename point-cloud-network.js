// <point-cloud-network> — an animated proximity network of particles,
// optionally contained inside a shape (circle, heart, block text, ...).
//
// Usage:
//   <script src="point-cloud-network.js"></script>
//   <point-cloud-network shape-mode="text" shape-text="AI" style="height:400px"></point-cloud-network>
//
// Every config key can be set as a kebab-case attribute (point-count, fg-color, ...),
// as a JSON `config` attribute, or from script via el.setConfig({...}) / el.config = {...}.
// The `controls` attribute shows the settings panel; `hud` shows the status readout.
(() => {
  const TAG = 'point-cloud-network';
  if (customElements.get(TAG)) return;

  // ---------------------------------------------------------------------------
  // Config schema. Drives defaults, validation, attributes and the settings panel.
  // ---------------------------------------------------------------------------

  const SECTIONS = [
    {title:'Particles', fields:[
      {key:'pointCount', label:'Point count', type:'range', min:30, max:260, step:1, value:105},
      {key:'speed', label:'Speed', type:'range', min:5, max:220, step:1, value:90},
      {key:'nodeScale', label:'Node size', type:'range', min:0.4, max:3, step:0.05, value:1},
      {key:'nodeOpacity', label:'Node opacity', type:'range', min:0.1, max:1, step:0.01, value:0.8}
    ]},
    {title:'Connections', fields:[
      {key:'connectionDistance', label:'Max distance', type:'range', min:40, max:520, step:1, value:285},
      {key:'nearAlpha', label:'Near opacity', type:'range', min:0, max:0.8, step:0.01, value:0.34},
      {key:'farAlpha', label:'Far opacity', type:'range', min:0, max:0.25, step:0.005, value:0.025},
      {key:'lineWidth', label:'Line width', type:'range', min:0.2, max:3, step:0.05, value:0.85},
      {key:'showLines', label:'Show proximity connections', type:'checkbox', value:true}
    ]},
    {title:'Shape / Pattern', fields:[
      {key:'shapeMode', label:'Mode', type:'select', value:'free', options:[
        ['free','Free / bounce'], ['circle','Circle'], ['ring','Double ring'], ['grid','Grid'],
        ['wave','Wave'], ['spiral','Spiral'], ['heart','Heart'], ['text','Block text']
      ]},
      {key:'shapeText', label:'Text', type:'text', value:'TEXT', maxlength:24},
      {key:'shapeStrength', label:'Shape strength', type:'range', min:0, max:10, step:0.1, value:4.5},
      {key:'shapeDamping', label:'Shape damping', type:'range', min:0.75, max:0.999, step:0.001, value:0.93},
      {key:'shapeScale', label:'Shape scale', type:'range', min:0.25, max:1.35, step:0.01, value:0.96},
      {key:'drawBoundary', label:'Draw shape boundary', type:'checkbox', value:false},
      {key:'clipBoundaryConnections', label:'Prevent connections across boundary', type:'checkbox', value:true}
    ], buttons:[['scatter','Scatter'], ['regenerate','Regenerate shape']]},
    {title:'Appearance', fields:[
      {key:'fgColor', label:'Point / line color', type:'color', value:'#30b178'},
      {key:'bgColor', label:'Background', type:'color', value:'#05090c'}
    ], buttons:[['resetDefaults','Reset defaults'], ['randomize','Randomize','primary']]}
  ];

  const FIELDS = {
    showUI:{key:'showUI', type:'checkbox', value:false, attr:'controls'},
    showHud:{key:'showHud', type:'checkbox', value:false, attr:'hud'}
  };
  for (const s of SECTIONS) for (const f of s.fields) FIELDS[f.key] = f;

  const DEFAULTS = Object.fromEntries(Object.values(FIELDS).map(f => [f.key, f.value]));

  const kebab = k => k.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
  const ATTR_TO_KEY = Object.fromEntries(Object.values(FIELDS).map(f => [f.attr || kebab(f.key), f.key]));

  // Returns the validated value, or undefined to ignore it.
  function coerce(f, v){
    switch (f.type){
      case 'range': {
        let n = Number(v);
        if (v === '' || v === null || !Number.isFinite(n)) return undefined;
        n = Math.min(f.max, Math.max(f.min, n));
        return f.step >= 1 ? Math.round(n) : n;
      }
      case 'checkbox':
        return typeof v === 'string' ? !/^(false|0|off|no)$/i.test(v.trim()) : !!v;
      case 'select':
        return f.options.some(([o]) => o === v) ? v : undefined;
      case 'color': {
        const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(v).trim());
        if (!m) return undefined;
        const hex = m[1].length === 3 ? m[1].replace(/./g, c => c + c) : m[1];
        return '#' + hex.toLowerCase();
      }
      default:
        return String(v).slice(0, f.maxlength ?? Infinity);
    }
  }

  // ---------------------------------------------------------------------------
  // Simulation + rendering. Reads settings from the live `cfg` object each frame.
  // ---------------------------------------------------------------------------

  function createEngine(canvas, cfg){
    const ctx = canvas.getContext('2d');

    // Shape mask canvas: white = valid interior, black = outside.
    const maskCanvas = document.createElement('canvas');
    const maskCtx = maskCanvas.getContext('2d', {willReadFrequently:true});
    let maskData = null;
    let signedDistance = null;

    // Boundary pixels are precomputed whenever the shape changes.
    // They are drawn only when requested.
    let boundaryPixels = [];

    let W=0,H=0,DPR=1;
    let nodes=[];
    let interiorSamples=[];
    let lastTime=performance.now();

    const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
    const rand=(a,b)=>a+Math.random()*(b-a);

    function hexToRgb(hex){
      hex=hex.replace('#','');
      if(hex.length===3) hex=hex.split('').map(x=>x+x).join('');
      const n=parseInt(hex,16);
      return [(n>>16)&255,(n>>8)&255,n&255];
    }

    function resize(width,height){
      const first=!W||!H;
      DPR=Math.min(window.devicePixelRatio||1,2);
      W=Math.max(0,Math.round(width));
      H=Math.max(0,Math.round(height));
      canvas.width=Math.round(W*DPR);
      canvas.height=Math.round(H*DPR);
      ctx.setTransform(DPR,0,0,DPR,0,0);

      maskCanvas.width=W||1;
      maskCanvas.height=H||1;
      if(!W||!H) return;

      for(const n of nodes){
        n.x=clamp(n.x,n.r,W-n.r);
        n.y=clamp(n.y,n.r,H-n.r);
      }
      generateShapeMask();

      // Nodes created before the element had a size are all piled in a corner.
      if(first) scatter();
    }

    function randomVelocity(speed){
      const a=rand(0,Math.PI*2);
      return {vx:Math.cos(a)*speed,vy:Math.sin(a)*speed};
    }

    function makeNode(){
      const speed=cfg.speed;
      const v=randomVelocity(rand(speed*.55,speed*1.2));
      const roll=Math.random();

      let baseR;
      if(roll<.12) baseR=rand(3.3,5.4);
      else if(roll<.30) baseR=rand(2.0,3.2);
      else baseR=rand(.9,1.9);

      return {
        x:rand(10,Math.max(11,W-10)),
        y:rand(10,Math.max(11,H-10)),
        vx:v.vx, vy:v.vy,
        baseR,
        r:baseR*cfg.nodeScale,
        alpha:rand(.55,1),
        phase:rand(0,Math.PI*2),
        acquisitionTarget:null
      };
    }

    function setPointCount(count){
      count=Number(count);
      while(nodes.length<count) nodes.push(makeNode());
      if(nodes.length>count) nodes.length=count;
      assignAcquisitionTargets();
    }

    function renormalizeSpeeds(){
      const target=cfg.speed;
      for(const n of nodes){
        let mag=Math.hypot(n.vx,n.vy);
        if(mag<.01){
          const v=randomVelocity(target);
          n.vx=v.vx; n.vy=v.vy;
        } else {
          const desired=target*rand(.65,1.15);
          n.vx=n.vx/mag*desired;
          n.vy=n.vy/mag*desired;
        }
      }
    }

    function scatter(){
      const speed=cfg.speed;
      const shaped=cfg.shapeMode!=='free' && interiorSamples.length;

      for(const n of nodes){
        let p;
        if(shaped){
          p=interiorSamples[Math.floor(Math.random()*interiorSamples.length)];
        }
        n.x=p ? p.x : rand(n.r,Math.max(n.r+1,W-n.r));
        n.y=p ? p.y : rand(n.r,Math.max(n.r+1,H-n.r));
        const v=randomVelocity(rand(speed*.6,speed*1.2));
        n.vx=v.vx; n.vy=v.vy;
      }
    }

    function clearMask(){
      maskCtx.clearRect(0,0,W,H);
      maskCtx.fillStyle='#fff';
      maskCtx.strokeStyle='#fff';
    }

    function drawShapeToMask(mode){
      const scale=cfg.shapeScale;
      const cx=W/2, cy=H/2;

      // Use almost all available real estate.
      const maxW=W*.92*scale;
      const maxH=H*.86*scale;
      const d=Math.min(maxW,maxH);

      maskCtx.save();
      maskCtx.fillStyle='#fff';
      maskCtx.strokeStyle='#fff';
      maskCtx.lineJoin='round';
      maskCtx.lineCap='round';

      if(mode==='circle'){
        maskCtx.beginPath();
        maskCtx.arc(cx,cy,d*.49,0,Math.PI*2);
        maskCtx.fill();
      }

      else if(mode==='ring'){
        // Double ring becomes two broad annular "lanes", each with interior area.
        const outerR=d*.49;
        const outerBand=Math.max(28,d*.12);
        const innerR=d*.25;
        const innerBand=Math.max(24,d*.10);

        maskCtx.lineWidth=outerBand;
        maskCtx.beginPath();
        maskCtx.arc(cx,cy,outerR-outerBand*.55,0,Math.PI*2);
        maskCtx.stroke();

        maskCtx.lineWidth=innerBand;
        maskCtx.beginPath();
        maskCtx.arc(cx,cy,innerR,0,Math.PI*2);
        maskCtx.stroke();
      }

      else if(mode==='grid'){
        // Grid is treated as one large rectangular container, maximizing usable area.
        maskCtx.fillRect(cx-maxW/2,cy-maxH/2,maxW,maxH);
      }

      else if(mode==='wave'){
        // Broad ribbon around a sine wave.
        maskCtx.lineWidth=Math.max(60,maxH*.24);
        maskCtx.beginPath();
        const steps=180;
        for(let i=0;i<=steps;i++){
          const u=i/steps;
          const x=cx-maxW/2+u*maxW;
          const y=cy+Math.sin(u*Math.PI*4)*maxH*.24;
          if(i===0) maskCtx.moveTo(x,y); else maskCtx.lineTo(x,y);
        }
        maskCtx.stroke();
      }

      else if(mode==='spiral'){
        // Thick spiral corridor rather than forcing points onto the line.
        maskCtx.lineWidth=Math.max(52,d*.105);
        maskCtx.beginPath();
        const turns=3.25, steps=300;
        for(let i=0;i<=steps;i++){
          const u=i/steps;
          const a=u*Math.PI*2*turns;
          const r=u*d*.43;
          const x=cx+Math.cos(a)*r;
          const y=cy+Math.sin(a)*r;
          if(i===0) maskCtx.moveTo(x,y); else maskCtx.lineTo(x,y);
        }
        maskCtx.stroke();
      }

      else if(mode==='heart'){
        maskCtx.beginPath();
        const steps=280;
        for(let i=0;i<=steps;i++){
          const t=i/steps*Math.PI*2;
          const hx=16*Math.pow(Math.sin(t),3);
          const hy=13*Math.cos(t)-5*Math.cos(2*t)-2*Math.cos(3*t)-Math.cos(4*t);
          const x=cx+hx*(maxW/36);
          const y=cy-hy*(maxH/32);
          if(i===0) maskCtx.moveTo(x,y); else maskCtx.lineTo(x,y);
        }
        maskCtx.closePath();
        maskCtx.fill();
      }

      else if(mode==='text'){
        const text=(cfg.shapeText || 'TEXT').trim() || 'TEXT';

        // Fit block text to nearly the full area while keeping a safe border.
        let fontSize=Math.min(H*.66,maxW);
        maskCtx.font=`900 ${fontSize}px Arial Black, Impact, sans-serif`;

        const maxTextW=maxW;
        while(maskCtx.measureText(text).width>maxTextW && fontSize>24){
          fontSize-=4;
          maskCtx.font=`900 ${fontSize}px Arial Black, Impact, sans-serif`;
        }

        // If height is still excessive, cap by available height.
        fontSize=Math.min(fontSize,maxH*.82);
        maskCtx.font=`900 ${fontSize}px Arial Black, Impact, sans-serif`;
        maskCtx.textAlign='center';
        maskCtx.textBaseline='middle';
        maskCtx.fillText(text,cx,cy+fontSize*.03);
      }

      maskCtx.restore();
    }

    function generateShapeMask(){
      interiorSamples=[];
      const mode=cfg.shapeMode;

      if(mode==='free' || !W || !H){
        maskData=null;
        signedDistance=null;
        boundaryPixels=[];
        return;
      }

      clearMask();
      drawShapeToMask(mode);
      maskData=maskCtx.getImageData(0,0,W,H);
      computeSignedDistanceField();
      buildBoundaryPixels();

      // Sample the valid interior with a coarse grid.
      // These samples are only used to drive outside particles into the shape.
      const step=Math.max(5,Math.floor(Math.sqrt((W*H)/9000)));
      for(let y=step;y<H;y+=step){
        for(let x=step;x<W;x+=step){
          if(isInsideMask(x,y,1)) interiorSamples.push({x,y});
        }
      }

      assignAcquisitionTargets();
    }

    function buildBoundaryPixels(){
      boundaryPixels=[];
      if(!signedDistance) return;

      const stride=2;
      for(let y=1;y<H-1;y+=stride){
        for(let x=1;x<W-1;x+=stride){
          if(Math.abs(sampleSignedDistance(x,y))<1.35){
            boundaryPixels.push({x,y});
          }
        }
      }
    }

    function maskAlpha(x,y){
      if(!maskData) return 255;
      x=Math.round(x); y=Math.round(y);
      if(x<0||x>=W||y<0||y>=H) return 0;
      return maskData.data[(y*W+x)*4+3];
    }

    // Approximate Euclidean distance transform using a two-pass chamfer method.
    // Positive signed distance = inside shape; negative = outside.
    function distanceTransform(seedMask){
      const N=W*H, INF=1e9;
      const d=new Float32Array(N);
      for(let i=0;i<N;i++) d[i]=seedMask[i] ? INF : 0;

      const c1=1, c2=Math.SQRT2;

      for(let y=0;y<H;y++){
        for(let x=0;x<W;x++){
          const i=y*W+x;
          let v=d[i];
          if(x>0) v=Math.min(v,d[i-1]+c1);
          if(y>0) v=Math.min(v,d[i-W]+c1);
          if(x>0&&y>0) v=Math.min(v,d[i-W-1]+c2);
          if(x<W-1&&y>0) v=Math.min(v,d[i-W+1]+c2);
          d[i]=v;
        }
      }

      for(let y=H-1;y>=0;y--){
        for(let x=W-1;x>=0;x--){
          const i=y*W+x;
          let v=d[i];
          if(x<W-1) v=Math.min(v,d[i+1]+c1);
          if(y<H-1) v=Math.min(v,d[i+W]+c1);
          if(x<W-1&&y<H-1) v=Math.min(v,d[i+W+1]+c2);
          if(x>0&&y<H-1) v=Math.min(v,d[i+W-1]+c2);
          d[i]=v;
        }
      }
      return d;
    }

    function computeSignedDistanceField(){
      const N=W*H;
      const inside=new Uint8Array(N);
      const outside=new Uint8Array(N);

      for(let y=0;y<H;y++){
        for(let x=0;x<W;x++){
          const i=y*W+x;
          const isIn=maskAlpha(x,y)>=128;
          inside[i]=isIn?1:0;
          outside[i]=isIn?0:1;
        }
      }

      const toOutside=distanceTransform(inside);
      const toInside=distanceTransform(outside);

      signedDistance=new Float32Array(N);
      for(let i=0;i<N;i++){
        signedDistance[i]=inside[i] ? toOutside[i] : -toInside[i];
      }
    }

    function sampleSignedDistance(x,y){
      if(!signedDistance) return 1e6;
      x=clamp(x,0,W-1); y=clamp(y,0,H-1);

      const x0=Math.floor(x), y0=Math.floor(y);
      const x1=Math.min(W-1,x0+1), y1=Math.min(H-1,y0+1);
      const tx=x-x0, ty=y-y0;

      const a=signedDistance[y0*W+x0];
      const b=signedDistance[y0*W+x1];
      const c=signedDistance[y1*W+x0];
      const d=signedDistance[y1*W+x1];

      const ab=a+(b-a)*tx;
      const cd=c+(d-c)*tx;
      return ab+(cd-ab)*ty;
    }

    function sdfNormal(x,y){
      const e=2.0;
      const gx=sampleSignedDistance(x+e,y)-sampleSignedDistance(x-e,y);
      const gy=sampleSignedDistance(x,y+e)-sampleSignedDistance(x,y-e);
      const mag=Math.hypot(gx,gy);
      if(mag<1e-6) return null;
      return {x:gx/mag,y:gy/mag}; // inward normal
    }

    function isInsideMask(x,y,r=0){
      if(!signedDistance) return true;
      return sampleSignedDistance(x,y) >= r;
    }

    function assignAcquisitionTargets(){
      if(!interiorSamples.length){
        for(const n of nodes) n.acquisitionTarget=null;
        return;
      }
      for(const n of nodes){
        // Random interior locations spread points throughout the full area,
        // rather than putting them on the outline.
        const p=interiorSamples[Math.floor(Math.random()*interiorSamples.length)];
        n.acquisitionTarget={x:p.x,y:p.y};
      }
    }

    function bounceOffMask(n,oldX,oldY){
      // Find the boundary intersection by binary search along the move segment.
      let ax=oldX, ay=oldY;
      let bx=n.x, by=n.y;

      for(let i=0;i<10;i++){
        const mx=(ax+bx)/2, my=(ay+by)/2;
        if(isInsideMask(mx,my,n.r)){
          ax=mx; ay=my;
        } else {
          bx=mx; by=my;
        }
      }

      n.x=ax; n.y=ay;

      let normal=sdfNormal(n.x,n.y);
      if(!normal){
        // Fallback: reverse if the boundary gradient is ambiguous.
        n.vx*=-1;
        n.vy*=-1;
        return;
      }

      // Gradient normal points inward. Reflect velocity around the boundary normal.
      const dot=n.vx*normal.x+n.vy*normal.y;

      // Only reflect if moving outward.
      if(dot<0){
        n.vx-=2*dot*normal.x;
        n.vy-=2*dot*normal.y;
      } else {
        // Numerical fallback for unusual local mask geometry.
        n.vx*=-1;
        n.vy*=-1;
      }

      // Push inward until the particle has radius clearance from the boundary.
      const clearance=sampleSignedDistance(n.x,n.y);
      const push=Math.max(1,n.r-clearance+1);
      n.x+=normal.x*push;
      n.y+=normal.y*push;
    }

    function update(dt){
      const shaped=cfg.shapeMode!=='free' && maskData && interiorSamples.length;
      const speed=cfg.speed;

      for(const n of nodes){
        n.r=n.baseR*cfg.nodeScale;

        // If outside the requested shape, attract toward an interior location.
        // Once the particle gets inside, the spring turns OFF completely.
        if(shaped && !isInsideMask(n.x,n.y,n.r)){
          if(!n.acquisitionTarget){
            const p=interiorSamples[Math.floor(Math.random()*interiorSamples.length)];
            n.acquisitionTarget={x:p.x,y:p.y};
          }

          const target=n.acquisitionTarget;
          const k=cfg.shapeStrength;
          n.vx+=(target.x-n.x)*k*dt;
          n.vy+=(target.y-n.y)*k*dt;

          const damping=Math.pow(cfg.shapeDamping,dt*60);
          n.vx*=damping;
          n.vy*=damping;
        } else {
          // Inside the shape (or free mode): maintain normal particle speed.
          const mag=Math.hypot(n.vx,n.vy) || 1;
          const correction=1+(speed-mag)/Math.max(1,speed)*dt*.9;
          n.vx*=correction;
          n.vy*=correction;
        }

        const oldX=n.x, oldY=n.y;
        n.x+=n.vx*dt;
        n.y+=n.vy*dt;

        if(shaped){
          // Shape boundary replaces the element boundary.
          if(isInsideMask(oldX,oldY,n.r) && !isInsideMask(n.x,n.y,n.r)){
            bounceOffMask(n,oldX,oldY);
          }
        } else {
          // Full-area bounce behavior.
          if(n.x-n.r<=0){ n.x=n.r; n.vx=Math.abs(n.vx); }
          else if(n.x+n.r>=W){ n.x=W-n.r; n.vx=-Math.abs(n.vx); }

          if(n.y-n.r<=0){ n.y=n.r; n.vy=Math.abs(n.vy); }
          else if(n.y+n.r>=H){ n.y=H-n.r; n.vy=-Math.abs(n.vy); }
        }
      }
    }

    function connectionStaysInsideShape(a,b){
      // In free mode there is no interior boundary to cross.
      if(!maskData || cfg.shapeMode==='free') return true;

      const dx=b.x-a.x;
      const dy=b.y-a.y;
      const dist=Math.hypot(dx,dy);

      // Sample along the segment. A step of ~5 px is fine enough to catch
      // narrow concavities / holes in non-convex shapes without being too expensive.
      const steps=Math.max(2,Math.ceil(dist/5));

      for(let s=1;s<steps;s++){
        const t=s/steps;
        const x=a.x+dx*t;
        const y=a.y+dy*t;

        if(sampleSignedDistance(x,y)<0) return false;
      }
      return true;
    }

    function drawBoundary(rgb){
      if(
        !cfg.drawBoundary ||
        cfg.shapeMode==='free' ||
        !boundaryPixels.length
      ) return;

      ctx.fillStyle=`rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.55)`;

      // Precomputed mask-edge pixels provide an accurate outline even for
      // non-convex text, spirals, hearts, and shapes with narrow corridors.
      for(const p of boundaryPixels){
        ctx.fillRect(p.x,p.y,2,2);
      }
    }

    function drawConnections(rgb){
      if(!cfg.showLines) return;

      const maxD=cfg.connectionDistance;
      const nearAlpha=cfg.nearAlpha;
      const farAlpha=cfg.farAlpha;

      ctx.lineCap='round';
      ctx.lineWidth=cfg.lineWidth;

      for(let i=0;i<nodes.length;i++){
        const a=nodes[i];

        for(let j=i+1;j<nodes.length;j++){
          const b=nodes[j];
          const dx=a.x-b.x,dy=a.y-b.y;
          const d2=dx*dx+dy*dy;
          if(d2>maxD*maxD) continue;

          const d=Math.sqrt(d2);

          // In a non-convex container, two points can both be inside the shape
          // while the straight line between them exits and re-enters it.
          // Optionally reject those links.
          if(
            cfg.clipBoundaryConnections &&
            cfg.shapeMode!=='free' &&
            !connectionStaysInsideShape(a,b)
          ) continue;

          const t=clamp(d/maxD,0,1);
          const fade=Math.pow(1-t,1.35);

          // Close points = stronger/darker connection.
          // Far points = progressively fainter.
          const alpha=farAlpha+(nearAlpha-farAlpha)*fade;

          ctx.strokeStyle=`rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
          ctx.beginPath();
          ctx.moveTo(a.x,a.y);
          ctx.lineTo(b.x,b.y);
          ctx.stroke();
        }
      }
    }

    function drawNodes(now,rgb){
      const opacity=cfg.nodeOpacity;

      for(const n of nodes){
        const pulse=.97+.03*Math.sin(now*.0015+n.phase);
        const r=n.r*pulse;
        const a=n.alpha*opacity;

        if(r>3){
          ctx.fillStyle=`rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a*.10})`;
          ctx.beginPath();
          ctx.arc(n.x,n.y,r*1.8,0,Math.PI*2);
          ctx.fill();
        }

        ctx.fillStyle=`rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
        ctx.beginPath();
        ctx.arc(n.x,n.y,r,0,Math.PI*2);
        ctx.fill();
      }
    }

    function draw(now){
      ctx.fillStyle=cfg.bgColor;
      ctx.fillRect(0,0,W,H);

      const rgb=hexToRgb(cfg.fgColor);
      drawConnections(rgb);
      drawBoundary(rgb);
      drawNodes(now,rgb);
    }

    function tick(now){
      if(!W||!H){ lastTime=now; return; }
      const dt=Math.min((now-lastTime)/1000,.033);
      lastTime=now;
      update(dt);
      draw(now);
    }

    return {
      resize,
      tick,
      resetClock:()=>{ lastTime=performance.now(); },
      setPointCount,
      renormalizeSpeeds,
      scatter,
      generateShapeMask,
      get nodeCount(){ return nodes.length; }
    };
  }

  // ---------------------------------------------------------------------------
  // Settings panel markup + styles.
  // ---------------------------------------------------------------------------

  function fieldHtml(f){
    if(f.type==='checkbox'){
      return `<label class="toggle"><input type="checkbox" data-key="${f.key}"> ${f.label}</label>`;
    }
    let input;
    if(f.type==='select'){
      input=`<select data-key="${f.key}" aria-label="${f.label}">${
        f.options.map(([v,l])=>`<option value="${v}">${l}</option>`).join('')
      }</select>`;
    } else if(f.type==='range'){
      input=`<input type="range" data-key="${f.key}" aria-label="${f.label}" min="${f.min}" max="${f.max}" step="${f.step}">`;
    } else {
      input=`<input type="${f.type}" data-key="${f.key}" aria-label="${f.label}"${f.maxlength?` maxlength="${f.maxlength}"`:''}>`;
    }
    const readout=f.type==='range' ? `<span class="value" data-for="${f.key}"></span>` : '';
    return `<div class="row${readout?'':' wide'}"><label>${f.label}</label>${input}${readout}</div>`;
  }

  function buttonsHtml(buttons){
    return `<div class="buttons">${
      buttons.map(([action,label,cls])=>`<button data-action="${action}"${cls?` class="${cls}"`:''}>${label}</button>`).join('')
    }</div>`;
  }

  const PANEL_HTML = `
    <div class="panel" part="panel">
      <h1>Point Cloud Network Lab</h1>
      <div class="sub">Free-moving particles bounce off the edges. Shape mode pulls them inside a shape, where they keep moving freely and bounce off its boundary.</div>
      ${SECTIONS.map(s=>`
        <div class="section">
          <div class="section-title">${s.title}</div>
          ${s.fields.map(fieldHtml).join('')}
          ${s.buttons ? buttonsHtml(s.buttons) : ''}
        </div>`).join('')}
      <div class="section">
        <div class="section-title">JSON Configuration</div>
        <textarea class="json" spellcheck="false" aria-label="JSON configuration"></textarea>
        ${buttonsHtml([['applyJson','Apply JSON','primary']])}
        ${buttonsHtml([['exportJson','Export current settings'],['hideUi','Hide UI']])}
        <div class="status"></div>
      </div>
    </div>`;

  const STYLE = `
    :host{
      --panel:#0c1218e8;
      --panel-border:#26323c;
      --text:#dce7ee;
      --muted:#91a2ad;
      --accent:#30b178;
      display:block;
      position:relative;
      overflow:hidden;
      height:360px;
      container-type:inline-size;
      color:var(--text);
      font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    }
    :host([hidden]){display:none}
    *{box-sizing:border-box}
    [hidden]{display:none !important}
    canvas{
      display:block;
      position:absolute;
      inset:0;
      width:100%;
      height:100%;
    }
    .panel{
      position:absolute;
      top:14px;
      left:14px;
      width:min(330px,calc(100% - 28px));
      max-height:calc(100% - 28px);
      overflow:auto;
      padding:14px;
      border:1px solid var(--panel-border);
      border-radius:12px;
      background:var(--panel);
      backdrop-filter:blur(14px);
      box-shadow:0 10px 35px rgba(0,0,0,.35);
      z-index:5;
    }
    h1{
      font-size:15px;
      margin:0 0 4px;
      font-weight:700;
    }
    .sub{
      color:var(--muted);
      font-size:11px;
      line-height:1.35;
      margin-bottom:12px;
    }
    .section{
      padding-top:11px;
      margin-top:11px;
      border-top:1px solid #202a32;
    }
    .section-title{
      text-transform:uppercase;
      letter-spacing:.09em;
      font-size:10px;
      color:#94a7b2;
      margin-bottom:8px;
      font-weight:700;
    }
    .row{
      display:grid;
      grid-template-columns:118px 1fr 48px;
      gap:8px;
      align-items:center;
      min-height:28px;
      margin:4px 0;
    }
    .row label{
      font-size:11px;
      color:#cbd8df;
    }
    input[type="range"]{
      width:100%;
      accent-color:var(--accent);
    }
    input[type="text"],select{
      width:100%;
      min-width:0;
      border:1px solid #2a3842;
      color:var(--text);
      background:#0a1015;
      padding:7px 8px;
      border-radius:7px;
      outline:none;
      font-size:12px;
    }
    input[type="color"]{
      width:100%;
      height:26px;
      border:1px solid #2a3842;
      background:#0a1015;
      border-radius:7px;
      padding:2px;
    }
    .value{
      font-size:10px;
      text-align:right;
      color:#87a0ad;
      font-variant-numeric:tabular-nums;
    }
    .wide{
      grid-template-columns:118px 1fr;
    }
    .toggle{
      display:flex;
      gap:8px;
      align-items:center;
      font-size:11px;
      margin:6px 0;
    }
    .toggle input{accent-color:var(--accent)}
    .buttons{
      display:grid;
      grid-template-columns:1fr 1fr;
      gap:7px;
      margin-top:9px;
    }
    button{
      border:1px solid #2c3b45;
      background:#111a20;
      color:#dfe9ee;
      border-radius:8px;
      padding:8px 9px;
      font-size:11px;
      cursor:pointer;
    }
    button:hover{background:#17242c}
    button.primary{
      border-color:#257b58;
      background:#123526;
    }
    .json{
      width:100%;
      min-height:165px;
      resize:vertical;
      border:1px solid #2a3842;
      color:#dce7ee;
      background:#0a1015;
      padding:8px;
      border-radius:7px;
      font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
    }
    .status{
      margin-top:7px;
      min-height:14px;
      font-size:10px;
      color:#88a2af;
    }
    .status.error{color:#e28a8a}
    .hud{
      position:absolute;
      right:12px;
      bottom:10px;
      color:#70818b;
      font-size:10px;
      z-index:3;
      user-select:none;
      pointer-events:none;
    }
    @container (max-width:640px){
      .panel{width:min(290px,calc(100% - 28px))}
      .row{grid-template-columns:104px 1fr 42px}
      .wide{grid-template-columns:104px 1fr}
    }
  `;

  const decimals = step => Math.min(3,(String(step).split('.')[1]||'').length);
  const rand = (a,b) => a+Math.random()*(b-a);

  // ---------------------------------------------------------------------------
  // The custom element.
  // ---------------------------------------------------------------------------

  class PointCloudNetwork extends HTMLElement {
    static get observedAttributes(){
      return [...Object.keys(ATTR_TO_KEY), 'config'];
    }

    constructor(){
      super();
      this._cfg = {...DEFAULTS};
      this._raf = 0;
      this._visible = false;

      const root = this.attachShadow({mode:'open'});
      root.innerHTML = `<style>${STYLE}</style><canvas part="canvas"></canvas><div class="hud" part="hud"></div>${PANEL_HTML}`;
      this._panel = root.querySelector('.panel');
      this._hud = root.querySelector('.hud');
      this._json = root.querySelector('.json');
      this._status = root.querySelector('.status');

      this._engine = createEngine(root.querySelector('canvas'), this._cfg);
      this._engine.setPointCount(this._cfg.pointCount);

      this._bindPanel();
      this._syncUi();

      this._frame = this._frame.bind(this);
      this._ro = new ResizeObserver(() => this._engine.resize(this.clientWidth, this.clientHeight));
      this._io = new IntersectionObserver(([entry]) => {
        this._visible = entry.isIntersecting;
        this._updateRunning();
      });
    }

    connectedCallback(){
      // A `config` property set before the element was defined shadows the setter.
      if(Object.prototype.hasOwnProperty.call(this,'config')){
        const value = this.config;
        delete this.config;
        this.config = value;
      }
      this._ro.observe(this);
      this._io.observe(this);
    }

    disconnectedCallback(){
      this._ro.disconnect();
      this._io.disconnect();
      this._visible = false;
      this._updateRunning();
    }

    attributeChangedCallback(name, oldValue, value){
      if(name==='config'){
        if(value==null) return;
        try{ this.setConfig(JSON.parse(value)); }
        catch(err){ console.warn(`<${TAG}>: invalid config attribute`, err); }
        return;
      }
      const key = ATTR_TO_KEY[name];
      this.setConfig({[key]: value===null ? DEFAULTS[key] : value});
    }

    get config(){ return this.getConfig(); }
    set config(value){ this.setConfig(value); }

    getConfig(){ return {...this._cfg}; }

    // Applies a partial config. Unknown keys and invalid values are ignored;
    // numbers are clamped to their slider range. Returns the resulting config.
    setConfig(cfg, opts={}){
      if(!cfg || typeof cfg!=='object' || Array.isArray(cfg)){
        throw new Error('Configuration must be a JSON object.');
      }

      const changed = new Set();
      for(const [key,raw] of Object.entries(cfg)){
        const f = FIELDS[key];
        if(!f) continue;
        const value = coerce(f,raw);
        if(value===undefined || value===this._cfg[key]) continue;
        this._cfg[key] = value;
        changed.add(key);
      }

      const engine = this._engine;
      if(changed.has('pointCount')) engine.setPointCount(this._cfg.pointCount);
      if(changed.has('speed')) engine.renormalizeSpeeds();
      if(changed.has('shapeMode') || changed.has('shapeText') || changed.has('shapeScale')){
        engine.generateShapeMask();
      }
      if(opts.scatter) engine.scatter();

      this._syncUi();
      if(changed.size){
        this.dispatchEvent(new CustomEvent('configchange', {detail:this.getConfig()}));
      }
      return this.getConfig();
    }

    reset(){
      const {showUI, showHud, ...defaults} = DEFAULTS;
      return this.setConfig(defaults);
    }

    randomize(){
      return this.setConfig({
        pointCount:Math.round(rand(70,180)),
        speed:Math.round(rand(45,150)),
        nodeScale:+rand(.7,1.6).toFixed(2),
        connectionDistance:Math.round(rand(150,380)),
        nearAlpha:+rand(.18,.48).toFixed(2),
        farAlpha:+rand(.005,.05).toFixed(3),
        lineWidth:+rand(.55,1.25).toFixed(2)
      });
    }

    scatter(){ this._engine.scatter(); }
    regenerate(){ this._engine.generateShapeMask(); }

    exportConfig(){
      const text = JSON.stringify(this.getConfig(), null, 2);
      const url = URL.createObjectURL(new Blob([text], {type:'application/json'}));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'point-cloud-config.json';
      a.click();
      URL.revokeObjectURL(url);
      return text;
    }

    _updateRunning(){
      const run = this.isConnected && this._visible;
      if(run && !this._raf){
        this._engine.resetClock();
        this._raf = requestAnimationFrame(this._frame);
      } else if(!run && this._raf){
        cancelAnimationFrame(this._raf);
        this._raf = 0;
      }
    }

    _frame(now){
      this._raf = requestAnimationFrame(this._frame);
      this._engine.tick(now);
      if(this._cfg.showHud){
        const mode = this._cfg.shapeMode;
        this._hud.textContent = `${this._engine.nodeCount} points · ${mode}${mode!=='free'?' · contained':''}`;
      }
    }

    _bindPanel(){
      const root = this.shadowRoot;
      this._inputs = [...root.querySelectorAll('[data-key]')];
      this._readouts = [...root.querySelectorAll('.value[data-for]')];

      for(const el of this._inputs){
        const event = (el.type==='range' || el.type==='text' || el.type==='color') ? 'input' : 'change';
        el.addEventListener(event, () => {
          this.setConfig({[el.dataset.key]: el.type==='checkbox' ? el.checked : el.value});
        });
      }

      const actions = {
        scatter:() => this.scatter(),
        regenerate:() => this.regenerate(),
        resetDefaults:() => this.reset(),
        randomize:() => this.randomize(),
        applyJson:() => {
          try{
            this.setConfig(JSON.parse(this._json.value));
            this._setStatus('Configuration applied.');
          }catch(err){
            this._setStatus('Invalid JSON: '+err.message, true);
          }
        },
        exportJson:() => {
          this.exportConfig();
          this._setStatus('Current settings exported.');
        },
        hideUi:() => this.setConfig({showUI:false})
      };
      for(const btn of root.querySelectorAll('[data-action]')){
        btn.addEventListener('click', actions[btn.dataset.action]);
      }
    }

    _setStatus(text, isError=false){
      this._status.textContent = text;
      this._status.classList.toggle('error', isError);
    }

    _syncUi(){
      const cfg = this._cfg;
      this._panel.hidden = !cfg.showUI;
      this._hud.hidden = !cfg.showHud;
      if(!cfg.showUI) return;

      for(const el of this._inputs){
        const value = cfg[el.dataset.key];
        if(el.type==='checkbox') el.checked = value;
        else if(el.value!==String(value)) el.value = value;
      }
      for(const el of this._readouts){
        const key = el.dataset.for;
        el.textContent = Number(cfg[key]).toFixed(decimals(FIELDS[key].step));
      }
      this._json.value = JSON.stringify(this.getConfig(), null, 2);
    }
  }

  customElements.define(TAG, PointCloudNetwork);
})();

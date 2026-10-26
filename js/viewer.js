// Visionneuse et outil de contourage (reprise de la visionneuse du dépôt « contourage »).
// Trois vues liées, structures de référence en lecture seule, structures cibles vides à contourer,
// validation puis calcul du Dice contre les cibles du RTSTRUCT.
(function(){
const PRESETS=[
  {id:'mou',  name:'Tissus mous', W:400, L:40},
  {id:'pou',  name:'Poumon', W:1500, L:-600},
  {id:'os',   name:'Os', W:2000, L:400},
  {id:'cer',  name:'Cerveau', W:80, L:40},
  {id:'foie', name:'Foie', W:150, L:70},
];
const AIR=-400, BONE=600; // seuils HU de l'option « ne pas peindre l'air ni l'os »
const PAL=['#3987e5','#d95926','#199e70','#c98500','#d55181','#008300','#9085e9','#e66767'];
const esc=t=>String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const hex=c=>'#'+c.map(v=>Math.max(0,Math.min(255,v|0)).toString(16).padStart(2,'0')).join('');
const fmtPct=d=>d==null?'—':(d*100).toFixed(1).replace('.',',')+' %';
const fmtVol=v=>v.toFixed(1).replace('.',',')+' cm³';

function open(root,ctx){
  const {dossier,V,rois}=ctx, {NX,NY,NZ,vol}=V, [DX,DY,DZ]=V.spacing, NXY=NX*NY;
  const IDX=(x,y,z)=>(z*NY+y)*NX+x;
  const HU=(x,y,z)=>vol[IDX(x,y,z)];
  let preset=PRESETS[0];

  root.innerHTML=`
<header class="vtop">
  <a class="btn" href="#/">← Menu</a>
  <div class="vtitle"><h1>${esc(dossier.title)}</h1>
  <span class="meta">${esc(dossier.category)} · ${NX} × ${NY} × ${NZ} voxels · ${DX.toFixed(2)} × ${DY.toFixed(2)} × ${DZ.toFixed(2)} mm</span></div>
  <span class="grow"></span>
  <a class="btn" id="v-pdf" href="#" target="_blank" rel="noopener">Histoire clinique (PDF)</a>
  <a class="btn" href="#/historique/${encodeURIComponent(dossier.id)}">Historique</a>
</header>
<div class="app">
  <div class="views" id="views"></div>
  <aside>
    <section>
      <h2>Fenêtrage</h2>
      <div class="seg" id="presets"></div>
      <div class="wl" id="wl"></div>
    </section>
    <section>
      <h2>Affichage</h2>
      <div class="row"><label for="op">Opacité du remplissage</label><span class="zr" id="opv"></span></div>
      <input type="range" id="op" min="0" max="80" value="25">
      <div class="row"><label for="cont">Contours</label><input type="checkbox" id="cont" checked></div>
      <div class="row"><label for="cross">Réticule</label><input type="checkbox" id="cross" checked></div>
    </section>
    <section class="edit" id="edit">
      <h2 style="margin:0">Outils de contourage</h2>
      <div class="row"><label for="emode">Mode édition</label><input type="checkbox" id="emode" checked></div>
      <label class="hint" for="estruct">Structure à contourer</label>
      <select id="estruct"></select>
      <div class="seg" id="etool"><button aria-pressed="true" data-t="paint">Pinceau</button><button aria-pressed="false" data-t="erase">Gomme</button></div>
      <div class="row"><label for="erad">Rayon du pinceau</label><span class="zr" id="eradv"></span></div>
      <input type="range" id="erad" min="1" max="25" value="4">
      <div class="row"><label for="esoft">Ne pas peindre l'air (&lt; ${AIR} HU) ni l'os (&gt; ${BONE} HU)</label><input type="checkbox" id="esoft"></div>
      <div class="tools">
        <button class="btn" id="eundo" disabled>Annuler</button>
        <button class="btn" id="ecopyup" title="Recopier ici le contour de la coupe axiale au-dessus">Copier coupe sup.</button>
        <button class="btn" id="ecopydn" title="Recopier ici le contour de la coupe axiale en dessous">Copier coupe inf.</button>
        <button class="btn" id="eclear">Vider la coupe</button>
      </div>
      <div class="tools"><button class="btn" id="einterp" title="Créer les coupes axiales manquantes entre deux coupes contourées (raccourci I)">Interpoler les coupes</button></div>
      <div class="tools"><button class="btn danger" id="ewipe" title="Effacer la structure sur toutes les coupes (Ctrl+Z pour annuler)">Effacer toute la structure</button><span id="ewipe-confirm" hidden><button class="btn danger" id="ewipe-yes">Effacer</button> <button class="btn" id="ewipe-no">Garder</button></span></div>
      <div class="status" id="estatus">Les contours en cours sont enregistrés dans ce navigateur après chaque tracé.</div>
      <div class="hint">Peindre dans une vue modifie la coupe affichée. Interpoler : contourer une coupe sur deux ou trois, puis remplir les coupes intermédiaires ; une coupe retouchée à la main n'est plus recalculée. Raccourcis : P pinceau, G gomme, I interpoler, [ et ] rayon, Ctrl+Z annuler, flèches haut/bas pour changer de coupe axiale.</div>
    </section>
    <section class="dice" id="dice" hidden></section>
    <section>
      <h2>Structures (<span id="nvis"></span>)</h2>
      <div class="seg" id="groups" style="margin-bottom:6px"><button aria-pressed="true" data-g="*">Toutes</button><button aria-pressed="false" data-g="U">À contourer</button><button aria-pressed="false" data-g="R">Référence</button></div>
      <div class="tools"><button class="btn" id="all">Tout afficher</button><button class="btn" id="none">Tout masquer</button><button class="btn" id="here">Coupe courante</button></div>
      <ul class="list" id="list"></ul>
    </section>
  </aside>
</div>
<div class="validate-bar" id="vbar">
  <button class="btn primary" id="validate">Validation des contours</button>
  <span class="hint" id="vhint">Après validation, les contours ne sont plus modifiables et sont comparés aux contours de référence (index de Dice).</span>
</div>
<div class="tip" id="tip" hidden></div>`;
  const $=id=>root.querySelector('#'+id);
  if(ctx.pdfUrl) $('v-pdf').href=ctx.pdfUrl; else $('v-pdf').hidden=true;

  // ---- structures ----
  const emptyBox=()=>[NX,-1,NY,-1,NZ,-1];
  const targetSet=new Set(dossier.targets.map(DICOM.normName));
  let ci=0; const nextColor=()=>PAL[ci++%PAL.length];
  const mk=(o)=>{const color=o.color||nextColor(); return {...o,color,rgb:[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)),on:true};};
  const refs=[], targets=[], refTargets=[];
  rois.forEach((r,k)=>{
    const color=r.color?hex(r.color):null;
    if(targetSet.has(DICOM.normName(r.name))){
      // contour de référence d'une cible : masqué jusqu'à la validation
      const key=DICOM.normName(r.name);
      if(!refTargets.some(t=>t.key===key))
        refTargets.push(mk({g:'V',id:'v'+k,key,name:r.name+' · référence',color,...DICOM.rasterize(r,V),dashed:true}));
    } else refs.push(mk({g:'R',id:'r'+k,name:r.name,color,...DICOM.rasterize(r,V)}));
  });
  dossier.targets.forEach((t,k)=>{
    const key=DICOM.normName(t), ref=refTargets.find(x=>x.key===key);
    targets.push(mk({g:'U',id:'u'+k,key,name:t,color:ref?.color,editable:true,sl:new Array(NZ).fill(null),b:emptyBox(),interp:new Set()}));
  });
  let S=[...targets,...refs];
  const byId={}; [...targets,...refs,...refTargets].forEach(s=>byId[s.id]=s);

  const has=(st,x,y,z)=>{const s=st.sl[z]; if(!s) return false; const u=x-s.x0,v=y-s.y0; return u>=0&&v>=0&&u<s.w&&v<s.h&&s.m[v*s.w+u]===1;};
  const growBox=(st,x,y,z)=>{const b=st.b;if(x<b[0])b[0]=x;if(x>b[1])b[1]=x;if(y<b[2])b[2]=y;if(y>b[3])b[3]=y;if(z<b[4])b[4]=z;if(z>b[5])b[5]=z;};
  const fullSlice=(st,z)=>st.sl[z]||(st.sl[z]={x0:0,y0:0,w:NX,h:NY,m:new Uint8Array(NXY)});
  const getV=(st,i)=>{const z=(i/NXY)|0, s=st.sl[z]; return s?s.m[i-z*NXY]:0;};
  const setV=(st,i,val)=>{const z=(i/NXY)|0; if(!val&&!st.sl[z]) return; fullSlice(st,z).m[i-z*NXY]=val;};
  function tightBox(st){const b=emptyBox();
    st.sl.forEach((s,z)=>{ if(!s) return; for(let v=0;v<s.h;v++)for(let u=0;u<s.w;u++) if(s.m[v*s.w+u]) growBox({b},s.x0+u,s.y0+v,z); });
    return b;}

  // ---- contours en cours : (dé)sérialisation ----
  function packDraft(){
    const out={version:1,dims:[NX,NY,NZ],updated:Date.now(),structs:{}};
    for(const st of targets){ const arr=[];
      st.sl.forEach((s,z)=>{ if(!s) return; let x0=NX,x1=-1,y0=NY,y1=-1;
        for(let y=0;y<NY;y++){const o=y*NX; for(let x=0;x<NX;x++) if(s.m[o+x]){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}}
        if(x1<0) return; const w=x1-x0+1,h=y1-y0+1,by=new Uint8Array((w*h+7)>>3); let i=0;
        for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++,i++) if(s.m[y*NX+x]) by[i>>3]|=1<<(i&7);
        arr.push({z,x0,y0,w,h,bits:by}); });
      out.structs[st.name]=arr; (out.interp||(out.interp={}))[st.name]=[...st.interp]; }
    return out;}
  function loadDraft(d){
    if(!d||d.version!==1||d.dims+''!==[NX,NY,NZ]+'') return false; let any=false;
    for(const st of targets){ const arr=d.structs[st.name]; if(!arr) continue;
      for(const p of arr){ const s=fullSlice(st,p.z);
        for(let i=0;i<p.w*p.h;i++) if((p.bits[i>>3]>>(i&7))&1){const x=p.x0+i%p.w,y=p.y0+((i/p.w)|0); s.m[y*NX+x]=1; growBox(st,x,y,p.z); any=true;} }
      for(const z of (d.interp&&d.interp[st.name])||[]) st.interp.add(z); }
    return any;}

  // ---- état ----
  let pos={x:NX>>1,y:NY>>1,z:NZ>>1};
  let opacity=.25, showC=true, showX=true, hotId=null, validated=false;
  const ED={on:true, st:targets[0]||null, tool:'paint', r:4, soft:false, undo:[], stroke:null, hover:null};

  // ---- vues ----
  const K=Math.max(1,Math.min(4,1000/Math.max(NX*DX,NY*DY)));
  const VIEWS=[
    {id:'ax', name:'Axiale', main:true, nu:NX, nv:NY, su:DX, sv:DY, slice:'z', n:NZ, uv:(u,v,s)=>[u,v,s], oriTop:'A',oriBot:'P',oriL:'D',oriR:'G'},
    {id:'co', name:'Coronale', nu:NX, nv:NZ, su:DX, sv:DZ, slice:'y', n:NY, uv:(u,v,s)=>[u,s,NZ-1-v], oriTop:'S',oriBot:'I',oriL:'D',oriR:'G'},
    {id:'sa', name:'Sagittale', nu:NY, nv:NZ, su:DY, sv:DZ, slice:'x', n:NX, uv:(u,v,s)=>[s,u,NZ-1-v], oriTop:'S',oriBot:'I',oriL:'A',oriR:'P'},
  ];
  function range(vw,st,s){const b=st.b; if(!b||b[1]<b[0]) return null;
    if(vw.id==='ax') return (s<b[4]||s>b[5])?null:[b[0],b[1],b[2],b[3]];
    if(vw.id==='co') return (s<b[2]||s>b[3])?null:[b[0],b[1],NZ-1-b[5],NZ-1-b[4]];
    return (s<b[0]||s>b[1])?null:[b[2],b[3],NZ-1-b[5],NZ-1-b[4]];}
  const tip=$('tip'), wrap=$('views');
  for(const vw of VIEWS){
    const el=document.createElement('div'); el.className='view'+(vw.main?' main':''); vw.el=el;
    el.innerHTML=`<div class="vhead"><span>${vw.name}</span><b></b></div>
     <div style="position:relative"><canvas></canvas>
     <span class="orient" style="top:4px;left:50%;transform:translateX(-50%)">${vw.oriTop}</span>
     <span class="orient" style="bottom:4px;left:50%;transform:translateX(-50%)">${vw.oriBot}</span>
     <span class="orient" style="left:6px;top:50%;transform:translateY(-50%)">${vw.oriL}</span>
     <span class="orient" style="right:6px;top:50%;transform:translateY(-50%)">${vw.oriR}</span></div>
     <div class="vfoot"><input type="range" min="0" max="${vw.n-1}" aria-label="Coupe ${vw.name.toLowerCase()}"></div>`;
    wrap.appendChild(el);
    vw.cv=el.querySelector('canvas'); vw.ctx=vw.cv.getContext('2d');
    vw.cv.width=Math.round(vw.nu*vw.su*K); vw.cv.height=Math.round(vw.nv*vw.sv*K);
    vw.off=document.createElement('canvas'); vw.off.width=vw.nu; vw.off.height=vw.nv; vw.octx=vw.off.getContext('2d'); vw.img=vw.octx.createImageData(vw.nu,vw.nv);
    vw.ov=document.createElement('canvas'); vw.ov.width=vw.nu; vw.ov.height=vw.nv; vw.ovctx=vw.ov.getContext('2d'); vw.ovimg=vw.ovctx.createImageData(vw.nu,vw.nv);
    vw.sl=el.querySelector('input'); vw.lab=el.querySelector('.vhead b');
    vw.sl.addEventListener('input',()=>{pos[vw.slice]=+vw.sl.value; drawAll();});
    vw.cv.addEventListener('wheel',e=>{e.preventDefault(); const s=vw.slice; pos[s]=Math.max(0,Math.min(vw.n-1,pos[s]+(e.deltaY>0?-1:1))); drawAll();},{passive:false});
    const pickUV=e=>{const r=vw.cv.getBoundingClientRect(); return [(e.clientX-r.left)/r.width*vw.nu,(e.clientY-r.top)/r.height*vw.nv];};
    const pick=e=>{const [fu,fv]=pickUV(e),u=Math.floor(fu),v=Math.floor(fv);
      if(u<0||v<0||u>=vw.nu||v>=vw.nv) return null; return vw.uv(u,v,pos[vw.slice]);};
    vw.cv.addEventListener('pointerdown',e=>{
      if(editing()){ e.preventDefault(); vw.cv.setPointerCapture(e.pointerId); startStroke(vw); paintAt(vw,pickUV(e)); return; }
      const p=pick(e); if(!p)return; [pos.x,pos.y,pos.z]=p; drawAll();});
    vw.cv.addEventListener('pointermove',e=>{
      const fuv=pickUV(e); ED.hover={vw,fuv};
      if(editing()){ if(ED.stroke&&ED.stroke.vw===vw&&e.buttons===1) paintAt(vw,fuv); else draw(vw); tip.hidden=true; return; }
      const p=pick(e); if(!p){tip.hidden=true;return;}
      if(e.buttons===1){[pos.x,pos.y,pos.z]=p; drawAll();}
      const names=S.filter(s=>s.on&&has(s,...p)).map(s=>`<div style="color:${s.color}">${esc(s.name)}</div>`).join('');
      tip.innerHTML=names+`<div class="hu">${HU(...p)} HU</div>`; tip.hidden=false;
      tip.style.left=(e.clientX+14)+'px'; tip.style.top=(e.clientY+14)+'px';});
    const end=()=>{ if(ED.stroke&&ED.stroke.vw===vw) endStroke(); };
    vw.cv.addEventListener('pointerup',end); vw.cv.addEventListener('pointercancel',end);
    vw.cv.addEventListener('pointerleave',()=>{tip.hidden=true; if(ED.hover&&ED.hover.vw===vw){ED.hover=null; draw(vw);} });
  }
  const editing=()=>ED.on&&ED.st&&!validated;

  function lut(){const lo=preset.L-preset.W/2, hi=preset.L+preset.W/2, n=DICOM.HU_MAX-DICOM.HU_MIN+1, t=new Uint8Array(n);
    for(let i=0;i<n;i++){const h=i+DICOM.HU_MIN; t[i]=Math.max(0,Math.min(255,Math.round((h-lo)/(hi-lo)*255)));} return t;}
  let LUT=lut();

  function draw(vw){
    const s=pos[vw.slice], d=vw.img.data, o=vw.ovimg.data, act=editing()?ED.st:null, vis=S.filter(x=>x.on||x===act), H0=-DICOM.HU_MIN;
    for(let v=0;v<vw.nv;v++)for(let u=0;u<vw.nu;u++){const [x,y,z]=vw.uv(u,v,s), i=(v*vw.nu+u)*4, g=LUT[vol[IDX(x,y,z)]+H0]; d[i]=d[i+1]=d[i+2]=g; d[i+3]=255;}
    o.fill(0);
    const a=Math.round(opacity*255);
    const order=act?[act,...vis.filter(x=>x!==act)]:vis;
    if(a>0||act) for(const st of order.slice().reverse()){ if(st.dashed) continue; const R=range(vw,st,s); if(!R) continue;
      const al=st===act?Math.max(a,70):(st.id===hotId?Math.min(255,a+90):a); if(!al) continue;
      for(let v=R[2];v<=R[3];v++)for(let u=R[0];u<=R[1];u++){ if(!has(st,...vw.uv(u,v,s))) continue; const i=(v*vw.nu+u)*4; o[i]=st.rgb[0];o[i+1]=st.rgb[1];o[i+2]=st.rgb[2];o[i+3]=al; }}
    vw.octx.putImageData(vw.img,0,0); vw.ovctx.putImageData(vw.ovimg,0,0);
    const c=vw.ctx, W=vw.cv.width, H=vw.cv.height, pu=W/vw.nu, pv=H/vw.nv;
    c.imageSmoothingEnabled=true; c.drawImage(vw.off,0,0,W,H);
    c.imageSmoothingEnabled=false; c.drawImage(vw.ov,0,0,W,H);
    if(showC||act){
      for(const st of order){ if(!showC&&st!==act) continue; const R=range(vw,st,s); if(!R) continue;
        c.strokeStyle=st.color; c.lineWidth=(st.id===hotId||st===act)?3:(st.dashed?2:1.6); c.setLineDash(st.dashed?[5,4]:[]); c.beginPath(); let any=false;
        const hs=(uu,vv)=>uu>=0&&vv>=0&&uu<vw.nu&&vv<vw.nv&&has(st,...vw.uv(uu,vv,s));
        for(let v=R[2];v<=R[3];v++)for(let u=R[0];u<=R[1];u++){
          if(!hs(u,v)) continue; any=true; const X=u*pu,Y=v*pv;
          if(!hs(u,v-1)){c.moveTo(X,Y);c.lineTo(X+pu,Y);} if(!hs(u,v+1)){c.moveTo(X,Y+pv);c.lineTo(X+pu,Y+pv);}
          if(!hs(u-1,v)){c.moveTo(X,Y);c.lineTo(X,Y+pv);} if(!hs(u+1,v)){c.moveTo(X+pu,Y);c.lineTo(X+pu,Y+pv);}
        }
        if(any) c.stroke();
      }
      c.setLineDash([]);
    }
    if(showX&&!editing()){
      let cu,cv; if(vw.id==='ax'){cu=pos.x;cv=pos.y}else if(vw.id==='co'){cu=pos.x;cv=NZ-1-pos.z}else{cu=pos.y;cv=NZ-1-pos.z}
      c.strokeStyle='rgba(95,208,196,.55)'; c.lineWidth=1; c.setLineDash([4,4]); c.beginPath();
      c.moveTo((cu+.5)*pu,0);c.lineTo((cu+.5)*pu,H);c.moveTo(0,(cv+.5)*pv);c.lineTo(W,(cv+.5)*pv);c.stroke(); c.setLineDash([]);
    }
    if(editing()&&ED.hover&&ED.hover.vw===vw){ // curseur du pinceau, rayon en mm
      const [fu,fv]=ED.hover.fuv; c.strokeStyle=ED.tool==='erase'?'#ef6b5e':'#ffffff'; c.lineWidth=1.5;
      c.beginPath(); c.ellipse(fu*pu,fv*pv,ED.r*K,ED.r*K,0,0,Math.PI*2); c.stroke();
    }
    vw.sl.value=s;
    vw.lab.textContent=vw.slice==='z'?`coupe ${s+1}/${NZ}`:`${vw.slice} ${s+1}/${vw.n}`;
    vw.el.classList.toggle('editing',editing());
  }
  function drawAll(){VIEWS.forEach(draw); refreshList();}

  // ---- pinceau ----
  // une coupe modifiée à la main n'est plus une coupe interpolée (elle devient une coupe clé)
  function markManual(st,z){ if(!st.interp.has(z)) return; if(ED.stroke&&!ED.stroke.interpPrev) ED.stroke.interpPrev=new Set(st.interp); st.interp.delete(z); }
  function startStroke(vw){ ED.stroke={vw,st:ED.st,changes:new Map()}; }
  function paintAt(vw,[fu,fv]){
    const st=ED.stroke?.st; if(!st) return; const s=pos[vw.slice], val=ED.tool==='paint'?1:0;
    const ru=ED.r/vw.su, rv=ED.r/vw.sv;
    for(let v=Math.floor(fv-rv);v<=Math.ceil(fv+rv);v++)for(let u=Math.floor(fu-ru);u<=Math.ceil(fu+ru);u++){
      if(u<0||v<0||u>=vw.nu||v>=vw.nv) continue;
      const du=(u+.5-fu)*vw.su, dv=(v+.5-fv)*vw.sv; if(du*du+dv*dv>ED.r*ED.r) continue;
      const [x,y,z]=vw.uv(u,v,s), i=IDX(x,y,z);
      if(val&&ED.soft){const g=vol[i]; if(g<AIR||g>BONE) continue;}
      const old=getV(st,i); if(old===val) continue;
      if(!ED.stroke.changes.has(i)) ED.stroke.changes.set(i,old);
      setV(st,i,val); if(val) growBox(st,x,y,z); markManual(st,z);
    }
    ED.hover={vw,fuv:[fu,fv]}; draw(vw);
  }
  function endStroke(){
    const k=ED.stroke; ED.stroke=null; if(!k||!k.changes.size){drawAll();return;}
    ED.undo.push(k); if(ED.undo.length>50) ED.undo.shift();
    markDirty(k.st); drawAll(); updEdit();
  }
  function undo(){ if(validated) return; const k=ED.undo.pop(); if(!k) return;
    for(const [i,old] of k.changes){ setV(k.st,i,old); if(old) growBox(k.st,i%NX,((i/NX)|0)%NY,(i/NXY)|0); }
    if(k.interpPrev) k.st.interp=k.interpPrev;
    markDirty(k.st); drawAll(); updEdit();}
  function wipeStruct(){
    const st=ED.st; if(!st) return; const k={vw:VIEWS[0],st,changes:new Map(),interpPrev:new Set(st.interp)}; st.interp.clear();
    st.sl.forEach((s,z)=>{ if(!s) return; for(let j=0;j<NXY;j++) if(s.m[j]){k.changes.set(z*NXY+j,1); s.m[j]=0;} });
    st.b=emptyBox();
    if(k.changes.size){ED.undo.push(k); markDirty(st);} drawAll(); updEdit();
    setStatus(`${st.name} : structure effacée (Ctrl+Z pour annuler).`,'dirty');}
  function sliceOp(fn){ // opération sur la coupe axiale courante de la structure active
    const st=ED.st; if(!st) return; const k={vw:VIEWS[0],st,changes:new Map(),interpPrev:new Set(st.interp)}, z=pos.z; st.interp.delete(z);
    for(let y=0;y<NY;y++)for(let x=0;x<NX;x++){const i=IDX(x,y,z), nv=fn(x,y,z), ov=getV(st,i); if(nv===ov) continue; k.changes.set(i,ov); setV(st,i,nv); if(nv) growBox(st,x,y,z);}
    if(k.changes.size){ED.undo.push(k); markDirty(st);} drawAll(); updEdit();}

  // ---- interpolation entre coupes axiales ----
  // Morphing par cartes de distance signée : pour une coupe à la fraction t entre deux coupes clés A et B,
  // chaque forme est translatée vers le barycentre intermédiaire cA + t·(cB − cA), puis les distances
  // signées sont mélangées, (1 − t)·dA + t·dB, et la coupe garde les pixels où le mélange est négatif.
  const INF=1e20;
  function edt1d(f,n,s2,d,v,zz){ let k=0; v[0]=0; zz[0]=-Infinity; zz[1]=Infinity;
    for(let q=1;q<n;q++){ let sv;
      for(;;){ const p=v[k]; sv=((f[q]+s2*q*q)-(f[p]+s2*p*p))/(2*s2*(q-p)); if(sv<=zz[k]) k--; else break; }
      k++; v[k]=q; zz[k]=sv; zz[k+1]=Infinity; }
    k=0; for(let q=0;q<n;q++){ while(zz[k+1]<q) k++; const p=v[k]; d[q]=s2*(q-p)*(q-p)+f[p]; } }
  // distance euclidienne (mm) au pixel le plus proche où m[i] === val, sur une grille w × h
  function edt(m,val,w,h){ const g=new Float64Array(w*h), n=Math.max(w,h), f=new Float64Array(n), d=new Float64Array(n), v=new Int32Array(n), zz=new Float64Array(n+1);
    for(let i=0;i<w*h;i++) g[i]=m[i]===val?0:INF;
    for(let x=0;x<w;x++){ for(let y=0;y<h;y++) f[y]=g[y*w+x]; edt1d(f,h,DY*DY,d,v,zz); for(let y=0;y<h;y++) g[y*w+x]=d[y]; }
    for(let y=0;y<h;y++){ for(let x=0;x<w;x++) f[x]=g[y*w+x]; edt1d(f,w,DX*DX,d,v,zz); for(let x=0;x<w;x++) g[y*w+x]=Math.sqrt(d[x]); }
    return g; }
  function sliceInfo(s){ let n=0,sx=0,sy=0,x0=NX,x1=-1,y0=NY,y1=-1;
    for(let y=0;y<NY;y++){ const o=y*NX; for(let x=0;x<NX;x++) if(s.m[o+x]){n++;sx+=x;sy+=y;if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;} }
    return n?{n,cx:sx/n,cy:sy/n,b:[x0,x1,y0,y1]}:null; }
  function interpolate(){
    const st=ED.st; if(!st||validated) return;
    const info=st.sl.map((s,z)=>s&&!st.interp.has(z)?sliceInfo(s):null), keys=[];
    info.forEach((v,z)=>{ if(v) keys.push(z); });
    if(keys.length<2){ setStatus('Interpolation : contourer au moins deux coupes axiales de '+st.name+'.','err'); return; }
    const k={vw:VIEWS[0],st,changes:new Map(),interpPrev:new Set(st.interp)}; let made=0;
    for(let q=0;q+1<keys.length;q++){ const a=keys[q], b=keys[q+1]; if(b-a<2) continue;
      const A=info[a], B=info[b], sh=Math.ceil(Math.hypot(B.cx-A.cx,B.cy-A.cy))+4;
      // calcul restreint à la boîte commune des deux coupes, élargie du déplacement
      const X0=Math.max(0,Math.min(A.b[0],B.b[0])-sh), X1=Math.min(NX-1,Math.max(A.b[1],B.b[1])+sh), Y0=Math.max(0,Math.min(A.b[2],B.b[2])-sh), Y1=Math.min(NY-1,Math.max(A.b[3],B.b[3])+sh);
      const w=X1-X0+1, h=Y1-Y0+1, crop=s=>{ const c=new Uint8Array(w*h); for(let y=0;y<h;y++) c.set(s.m.subarray((Y0+y)*NX+X0,(Y0+y)*NX+X0+w),y*w); return c; };
      const sdf=s=>{ const c=crop(s), o=edt(c,1,w,h), i=edt(c,0,w,h); for(let j=0;j<w*h;j++) o[j]-=i[j]; return o; };
      const dA=sdf(st.sl[a]), dB=sdf(st.sl[b]);
      const at=(d,x,y)=>x<0||y<0||x>=w||y>=h?INF:d[y*w+x];
      for(let z=a+1;z<b;z++){ const t=(z-a)/(b-a), cx=A.cx+t*(B.cx-A.cx), cy=A.cy+t*(B.cy-A.cy);
        const ax=Math.round(cx-A.cx), ay=Math.round(cy-A.cy), bx=Math.round(cx-B.cx), by=Math.round(cy-B.cy);
        for(let y=0;y<NY;y++)for(let x=0;x<NX;x++){ const i=IDX(x,y,z);
          const u=x-X0, v=y-Y0, inside=u>=0&&v>=0&&u<w&&v<h&&(1-t)*at(dA,u-ax,v-ay)+t*at(dB,u-bx,v-by)<0, nv=inside?1:0, ov=getV(st,i);
          if(nv===ov) continue; k.changes.set(i,ov); setV(st,i,nv); if(nv) growBox(st,x,y,z); }
        st.interp.add(z); made++; }
    }
    if(!made){ setStatus('Interpolation : aucune coupe à créer entre les coupes contourées de '+st.name+'.'); return; }
    if(k.changes.size){ ED.undo.push(k); markDirty(st); }
    drawAll(); updEdit();
    setStatus(`${st.name} : ${made} coupe${made>1?'s':''} interpolée${made>1?'s':''} (Ctrl+Z pour annuler).`,'dirty');
  }

  // ---- enregistrement local des contours en cours ----
  let saveTimer=null, saving=false, pending=false;
  const stat=$('estatus');
  function setStatus(txt,cls){stat.textContent=txt; stat.className='status'+(cls?' '+cls:'');}
  function markDirty(st){ st.edited=true; setStatus('Enregistrement…','dirty'); clearTimeout(saveTimer); saveTimer=setTimeout(saveDraft,700); }
  async function saveDraft(){
    if(validated) return; if(saving){pending=true; return;} saving=true; pending=false;
    try{ await ctx.saveDraft(packDraft());
      setStatus(`Contours en cours enregistrés dans ce navigateur à ${new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}.`); }
    catch(e){ setStatus('Les contours n\'ont pas pu être enregistrés dans ce navigateur ('+e.message+'). Nouvel essai au prochain tracé.','err'); }
    finally{ saving=false; if(pending) saveDraft(); }
  }

  // ---- panneau ----
  const pre=$('presets');
  PRESETS.forEach(p=>{const b=document.createElement('button');b.textContent=p.name;b.setAttribute('aria-pressed',p===preset);
    b.onclick=()=>{preset=p;LUT=lut();[...pre.children].forEach(x=>x.setAttribute('aria-pressed',x===b));wlText();drawAll();};pre.appendChild(b);});
  const wlText=()=>$('wl').textContent=`W ${preset.W} / L ${preset.L} HU`;
  wlText();
  const op=$('op'), opv=$('opv');
  op.oninput=()=>{opacity=op.value/100;opv.textContent=op.value+' %';drawAll();}; opv.textContent=op.value+' %';
  $('cont').onchange=e=>{showC=e.target.checked;drawAll();};
  $('cross').onchange=e=>{showX=e.target.checked;drawAll();};
  const list=$('list'), sel=$('estruct');
  const GN={U:'Structures à contourer',R:'Structures de référence · lecture seule',V:'Contours de référence des cibles'};
  targets.forEach(st=>{const o=document.createElement('option');o.value=st.id;o.textContent=st.name;sel.appendChild(o);});
  function buildList(){
    list.innerHTML=''; let lastG=null;
    S.forEach(st=>{
      if(st.g!==lastG){const h=document.createElement('li');h.className='grp';h.textContent=GN[st.g];list.appendChild(h); lastG=st.g;}
      const li=document.createElement('li'); st.li=li;
      li.innerHTML=`<input type="checkbox" ${st.on?'checked':''} aria-label="Afficher ${esc(st.name)}"><span class="sw${st.dashed?' dash':''}" style="--c:${st.color}"></span><button class="nm" title="${esc(st.name)}">${esc(st.name)}</button><span class="zr"></span>`;
      li.querySelector('input').onchange=e=>{st.on=e.target.checked;drawAll();};
      li.querySelector('.nm').onclick=()=>{ if(st.editable&&!validated) selectStruct(st); const bb=st.b; if(bb&&bb[1]>=bb[0]){pos.x=(bb[0]+bb[1])>>1;pos.y=(bb[2]+bb[3])>>1;pos.z=(bb[4]+bb[5])>>1;} st.on=true; li.querySelector('input').checked=true; drawAll();};
      li.onmouseenter=()=>{hotId=st.id;drawAll();}; li.onmouseleave=()=>{hotId=null;drawAll();};
      list.appendChild(li);
    });
  }
  function refreshList(){let n=0;S.forEach(st=>{const b=st.b, ok=b&&b[5]>=b[4], here=ok&&pos.z>=b[4]&&pos.z<=b[5];
    st.li.classList.toggle('here',here); st.li.classList.toggle('hot',editing()&&st===ED.st); if(st.on)n++;
    st.li.querySelector('.zr').textContent=ok?`${b[4]+1}–${b[5]+1}`:(st.editable?'à contourer':'vide');});
    $('nvis').textContent=`${n}/${S.length}`;}
  const setAll=f=>{S.forEach(st=>{st.on=f(st);st.li.querySelector('input').checked=st.on;});drawAll();};
  $('all').onclick=()=>setAll(()=>true);
  $('none').onclick=()=>setAll(()=>false);
  $('here').onclick=()=>setAll(st=>{const b=st.b;return b&&pos.z>=b[4]&&pos.z<=b[5];});
  const gb=$('groups');
  [...gb.children].forEach(b=>b.onclick=()=>{[...gb.children].forEach(x=>x.setAttribute('aria-pressed',x===b));const g=b.dataset.g;setAll(st=>g==='*'||st.g===g||(g==='R'&&st.g==='V'));});

  // ---- contrôles d'édition ----
  function selectStruct(st){ED.st=st; sel.value=st.id; st.on=true; if(st.li) st.li.querySelector('input').checked=true; drawAll(); updEdit();}
  function updEdit(){
    $('edit').classList.toggle('on',ED.on);
    const dis=!ED.on||!targets.length;
    ['estruct','erad','esoft','ecopyup','ecopydn','eclear','einterp'].forEach(i=>$(i).disabled=dis);
    $('ewipe').disabled=dis||!ED.st||ED.st.b[1]<ED.st.b[0];
    [...$('etool').children].forEach(b=>{b.disabled=dis;b.setAttribute('aria-pressed',b.dataset.t===ED.tool);});
    $('eundo').disabled=dis||!ED.undo.length; $('eradv').textContent=ED.r+' mm';
  }
  $('emode').onchange=e=>{ED.on=e.target.checked; if(!ED.on) ED.hover=null; updEdit(); drawAll();};
  sel.onchange=()=>selectStruct(byId[sel.value]);
  [...$('etool').children].forEach(b=>b.onclick=()=>{ED.tool=b.dataset.t;updEdit();});
  $('erad').oninput=e=>{ED.r=+e.target.value;updEdit();};
  $('esoft').onchange=e=>{ED.soft=e.target.checked;};
  $('eundo').onclick=undo;
  $('ecopyup').onclick=()=>{ if(pos.z>=NZ-1)return; const st=ED.st; sliceOp((x,y,z)=>getV(st,IDX(x,y,z+1))); };
  $('ecopydn').onclick=()=>{ if(pos.z<=0)return; const st=ED.st; sliceOp((x,y,z)=>getV(st,IDX(x,y,z-1))); };
  $('eclear').onclick=()=>sliceOp(()=>0);
  $('einterp').onclick=interpolate;
  $('ewipe').onclick=()=>{$('ewipe').hidden=true;$('ewipe-confirm').hidden=false;};
  $('ewipe-no').onclick=()=>{$('ewipe').hidden=false;$('ewipe-confirm').hidden=true;};
  $('ewipe-yes').onclick=()=>{$('ewipe').hidden=false;$('ewipe-confirm').hidden=true; wipeStruct();};
  function onKey(e){
    if(e.target.closest&&e.target.closest('input[type=text],input[type=password],textarea,.modal')) return;
    if(e.key==='ArrowUp'||e.key==='ArrowDown'){ if(e.target.closest&&e.target.closest('select,input[type=range]')) return;
      e.preventDefault(); pos.z=Math.max(0,Math.min(NZ-1,pos.z+(e.key==='ArrowUp'?1:-1))); drawAll(); return; }
    if(!editing()||e.target.closest&&e.target.closest('select,input[type=range]')&&!(e.ctrlKey||e.metaKey)) return;
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undo();}
    else if(e.key==='i'||e.key==='I'){interpolate();}
    else if(e.key==='p'||e.key==='P'){ED.tool='paint';updEdit();} else if(e.key==='g'||e.key==='G'){ED.tool='erase';updEdit();}
    else if(e.key==='['){ED.r=Math.max(1,ED.r-1);$('erad').value=ED.r;updEdit();} else if(e.key===']'){ED.r=Math.min(25,ED.r+1);$('erad').value=ED.r;updEdit();}
    if(ED.hover) draw(ED.hover.vw);}
  document.addEventListener('keydown',onKey);

  // ---- validation et Dice ----
  function count(st){let n=0; st.sl.forEach(s=>{ if(s) for(let i=0;i<s.m.length;i++) n+=s.m[i]; }); return n;}
  function computeDice(){
    const vv=DX*DY*DZ/1000;
    return targets.map(u=>{
      const r=refTargets.find(x=>x.key===u.key);
      const nu=count(u), nr=r?count(r):0; let inter=0;
      if(r) r.sl.forEach((s,z)=>{ const us=u.sl[z]; if(!s||!us) return;
        for(let v=0;v<s.h;v++)for(let w=0;w<s.w;w++) if(s.m[v*s.w+w]&&us.m[(s.y0+v)*NX+s.x0+w]) inter++; });
      return {name:u.name, dice:nu+nr?2*inter/(nu+nr):null, volUser:nu*vv, volRef:nr*vv, color:u.color};
    });
  }
  function renderDice(scores){
    const ok=scores.filter(s=>s.dice!=null), mean=ok.length?ok.reduce((a,s)=>a+s.dice,0)/ok.length:null;
    $('dice').innerHTML=`<h2>Index de Dice</h2>
      <table class="dtab"><thead><tr><th>Structure</th><th>Dice</th></tr></thead><tbody>${scores.map(s=>`
        <tr><td><span class="sw" style="--c:${s.color}"></span> ${esc(s.name)}<div class="vols">vous ${fmtVol(s.volUser)} · réf. ${fmtVol(s.volRef)}</div></td>
        <td class="num ${s.dice!=null&&s.dice>=.8?'good':''}">${fmtPct(s.dice)}<div class="bar"><i style="width:${(s.dice||0)*100}%"></i><b></b></div></td></tr>`).join('')}
      </tbody>${scores.length>1?`<tfoot><tr><td>Moyenne</td><td class="num">${fmtPct(mean)}</td></tr></tfoot>`:''}</table>
      <div class="hint">Contours de l'utilisateur en trait plein, contours de référence en pointillés. Trait vertical : seuil de 80 %.</div>
      <div class="tools"><a class="btn" href="#/historique/${encodeURIComponent(dossier.id)}">Voir l'historique</a><a class="btn" href="#/">Retour au menu</a></div>`;
    $('dice').hidden=false;
  }
  $('validate').onclick=async()=>{
    if(validated) return;
    const empty=targets.filter(t=>t.b[1]<t.b[0]||!count(t)).map(t=>t.name);
    const ok=await ctx.confirm('Voulez-vous valider vos contours définitivement ? Il ne sera plus possible de les modifier',
      empty.length?`Structures encore vides : ${empty.join(', ')}.`:'');
    if(!ok) return;
    clearTimeout(saveTimer);
    validated=true; ED.on=false; ED.stroke=null; ED.undo=[];
    targets.forEach(t=>t.b=tightBox(t));
    const scores=computeDice();
    S=[...targets,...refTargets,...refs];
    buildList();
    $('edit').hidden=true; renderDice(scores);
    $('validate').disabled=true; $('validate').textContent='Contours validés';
    $('vhint').textContent='Contours validés le '+new Date().toLocaleString('fr-FR')+'. Rouvrir le dossier depuis le menu démarre une nouvelle session vierge.';
    drawAll();
    try{ await ctx.onValidated(scores); }catch(e){ $('vhint').textContent='Les résultats n\'ont pas pu être enregistrés dans ce navigateur : '+e.message; }
  };

  // ---- démarrage ----
  buildList();
  if(ctx.draft&&loadDraft(ctx.draft)){
    const t=new Date(ctx.draft.updated).toLocaleString('fr-FR');
    setStatus(`Contours en cours repris (dernier enregistrement : ${t}).`);
    const f=targets.find(t=>t.b[1]>=t.b[0]); if(f) pos.z=(f.b[4]+f.b[5])>>1;
  }
  if(!targets.length){ setStatus('Aucune structure à contourer n\'est définie pour ce dossier.','err'); ED.on=false; $('emode').checked=false; }
  updEdit(); drawAll();
  return { destroy(){ document.removeEventListener('keydown',onKey); clearTimeout(saveTimer); if(!validated&&targets.some(t=>t.edited)) saveDraft(); } };
}
window.Viewer={open};
})();

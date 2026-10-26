// Menu principal, chargement des dossiers, accès par mot de passe et navigation.
(function(){
const CATEGORIES=['Crâne','ORL','Sein','Poumon','Œsophage','Foie','Pancréas','Rein','Col utérin','Endomètre','Vessie','Prostate','Rectum','Canal anal','Os'];
const UPLOAD_PASSWORD='sfro';
const page=document.getElementById('page'), modalRoot=document.getElementById('modal-root');
const esc=t=>String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const unlocked=new Set(); // dossiers ouverts avec le bon mot de passe pendant cette visite
let current=null; // visionneuse ouverte
const pdfUrls={};

// ---- dossiers : catalogue publié (dossiers/catalogue.json) + dossiers chargés dans ce navigateur ----
async function loadCatalogue(){
  try{ const r=await fetch('dossiers/catalogue.json',{cache:'no-cache'}); if(!r.ok) return [];
    const j=await r.json();
    return (j.dossiers||[]).map(d=>({id:'cat-'+d.id,source:'catalogue',title:d.titre,category:d.categorie,targets:d.cibles||[],
      pwHash:d.mot_de_passe_sha256,pdf:d.pdf,rtss:d.rtstruct,images:d.images||[]})); }
  catch(e){ return []; }
}
async function loadAll(){
  const [cat,loc]=await Promise.all([loadCatalogue(),Store.listLocal().catch(()=>null)]);
  return {list:[...cat,...(loc||[]).map(d=>({...d,source:'local'}))], storeOk:loc!==null};
}
async function findDossier(id){ return (await loadAll()).list.find(d=>d.id===id); }
async function pdfUrl(d){
  if(d.source==='catalogue') return d.pdf;
  if(pdfUrls[d.id]) return pdfUrls[d.id];
  const f=await Store.getFiles(d.id); return f&&f.pdf?(pdfUrls[d.id]=URL.createObjectURL(f.pdf)):null;
}
// fichiers du dossier sous forme d'ArrayBuffer
async function dossierFiles(d,progress){
  if(d.source==='local'){
    const f=await Store.getFiles(d.id); if(!f) throw new Error('fichiers du dossier introuvables dans ce navigateur');
    let n=0; const images=await Promise.all(f.images.map(b=>b.arrayBuffer().then(x=>{progress(++n/f.images.length);return x;})));
    return {images,rtss:await f.rtss.arrayBuffer()};
  }
  const get=async u=>{const r=await fetch(u); if(!r.ok) throw new Error('fichier inaccessible : '+u); return r.arrayBuffer();};
  const images=new Array(d.images.length); let next=0, n=0;
  await Promise.all(Array.from({length:Math.min(8,d.images.length)},async()=>{ while(next<d.images.length){ const k=next++; images[k]=await get(d.images[k]); progress(++n/d.images.length); } }));
  return {images,rtss:await get(d.rtss)};
}

// ---- fenêtres ----
function modal(html,{wide=false}={}){
  const back=document.createElement('div'); back.className='modal-back';
  back.innerHTML=`<div class="modal${wide?' wide':''}" role="dialog" aria-modal="true">${html}</div>`;
  modalRoot.appendChild(back);
  const box=back.firstChild, close=()=>back.remove();
  return {box,close,$:s=>box.querySelector(s)};
}
function askPassword(title,check,intro=''){
  return new Promise(res=>{
    const m=modal(`<h2>${esc(title)}</h2>${intro?`<div class="hint">${esc(intro)}</div>`:''}
      <form class="field"><label for="pw">Mot de passe</label><input type="password" id="pw" autocomplete="off"><div class="pw-err" aria-live="polite"></div>
      <div class="actions"><button type="button" class="btn" data-x>Annuler</button><button class="btn primary">Valider</button></div></form>`);
    const inp=m.$('#pw'); inp.focus();
    const done=v=>{m.close(); document.removeEventListener('keydown',esck); res(v);};
    const esck=e=>{ if(e.key==='Escape') done(false); }; document.addEventListener('keydown',esck);
    m.$('[data-x]').onclick=()=>done(false);
    m.$('form').onsubmit=async e=>{ e.preventDefault(); if(await check(inp.value)) done(true);
      else { m.$('.pw-err').textContent='Mot de passe incorrect.'; inp.select(); } };
  });
}
function confirmBox(text,detail=''){
  return new Promise(res=>{
    const m=modal(`<h2>Confirmation</h2><div>${esc(text)}</div>${detail?`<div class="notice">${esc(detail)}</div>`:''}
      <div class="actions"><button class="btn" data-n>Annuler</button><button class="btn primary" data-y>Valider</button></div>`);
    m.$('[data-n]').onclick=()=>{m.close();res(false);}; m.$('[data-y]').onclick=()=>{m.close();res(true);}; m.$('[data-n]').focus();
  });
}
const checkDossierPw=d=>async pw=>(await Store.sha256(pw))===d.pwHash;

// ---- menu principal ----
async function renderHome(){
  page.innerHTML='<div class="loading">Chargement des dossiers…</div>';
  const {list,storeOk}=await loadAll();
  page.innerHTML=`<div class="home">
    <header class="brand">
      <div class="logo"><img src="assets/logo-hcl.png" alt="Hospices Civils de Lyon" onerror="this.parentNode.hidden=true"></div>
      <div><h1>Plateforme d'entraînement au contourage</h1><div class="sub">Dossiers cliniques classés par localisation tumorale</div></div>
    </header>
    ${storeOk?'':'<div class="errors">Ce navigateur bloque le stockage local : les dossiers chargés, les contours en cours et l\'historique des scores ne peuvent pas être enregistrés.</div>'}
    <div id="cats" style="display:grid;gap:18px"></div>
    <div class="add"><button class="btn primary" id="add">Ajouter un dossier</button></div>
    <footer class="disclaimer"><b>Avertissement :</b> cette plateforme est destinée exclusivement à la formation. Elle ne doit pas être utilisée pour la planification clinique des traitements.</footer>
  </div>`;
  const cats=page.querySelector('#cats');
  const extra=[...new Set(list.map(d=>d.category).filter(c=>!CATEGORIES.includes(c)))];
  for(const c of [...CATEGORIES,...extra]){
    const ds=list.filter(d=>d.category===c).sort((a,b)=>a.title.localeCompare(b.title,'fr'));
    const sec=document.createElement('section'); sec.className='cat'+(ds.length?'':' empty');
    sec.innerHTML=`<h2>${esc(c)} <span class="n">${ds.length||''}</span></h2>`+(ds.length?'':'<div class="none">Aucun dossier</div>');
    for(const d of ds){
      const row=document.createElement('div'); row.className='drow';
      row.innerHTML=`<div class="t">${esc(d.title)}<small>${d.targets.length} structure${d.targets.length>1?'s':''} à contourer : ${esc(d.targets.join(', '))}</small></div>
        <div class="acts"><a class="btn" data-pdf target="_blank" rel="noopener">Histoire clinique</a>
        <button class="btn primary" data-open>Contourage</button>
        <a class="btn" href="#/historique/${encodeURIComponent(d.id)}">Historique</a>
        ${d.source==='local'?'<button class="btn danger" data-del title="Supprimer ce dossier de ce navigateur">Supprimer</button>':''}</div>`;
      const a=row.querySelector('[data-pdf]');
      pdfUrl(d).then(u=>{ if(u) a.href=u; else a.hidden=true; }).catch(()=>{a.hidden=true;});
      row.querySelector('[data-open]').onclick=async()=>{
        if(await askPassword('Ouvrir « '+d.title+' »',checkDossierPw(d))){ unlocked.add(d.id); location.hash='#/contourage/'+encodeURIComponent(d.id); } };
      const del=row.querySelector('[data-del]');
      if(del) del.onclick=async()=>{
        if(!await askPassword('Supprimer « '+d.title+' »',async pw=>pw===UPLOAD_PASSWORD,'Mot de passe de chargement requis. L\'historique des scores est conservé.')) return;
        if(!await confirmBox('Supprimer définitivement le dossier « '+d.title+' » de ce navigateur ?')) return;
        await Store.removeDossier(d.id); renderHome(); };
      sec.appendChild(row);
    }
    cats.appendChild(sec);
  }
  page.querySelector('#add').onclick=async()=>{ if(await askPassword('Ajouter un dossier',async pw=>pw===UPLOAD_PASSWORD,'Mot de passe de chargement requis.')) uploadForm(); };
}

// ---- chargement d'un dossier ----
function uploadForm(){
  const m=modal(`<h2>Ajouter un dossier</h2>
    <div class="notice">Tous les éléments doivent être anonymisés avant mise en ligne.</div>
    <div class="field"><label for="u-title">Nom du dossier</label><input type="text" id="u-title" maxlength="120"></div>
    <div class="field"><label for="u-cat">Type tumoral</label><select id="u-cat"><option value="">— Choisir —</option>${CATEGORIES.map(c=>`<option>${esc(c)}</option>`).join('')}</select></div>
    <div class="field"><span class="lab">Images DICOM</span><div class="drop" id="d-img"><div class="pick">
      <label class="btn" for="u-img">Choisir les fichiers…</label><input type="file" id="u-img" multiple hidden>
      <label class="btn" for="u-dir">Choisir un dossier…</label><input type="file" id="u-dir" webkitdirectory multiple hidden></div>
      <div class="info">Aucun fichier sélectionné</div></div></div>
    <div class="field"><span class="lab">Fichier structure (RTSTRUCT)</span><div class="drop" id="d-rt"><div class="pick">
      <label class="btn" for="u-rt">Choisir le fichier…</label><input type="file" id="u-rt" hidden></div><div class="info">Aucun fichier sélectionné</div></div></div>
    <div class="field"><span class="lab">Histoire clinique (PDF)</span><div class="drop" id="d-pdf"><div class="pick">
      <label class="btn" for="u-pdf">Choisir le fichier…</label><input type="file" id="u-pdf" accept="application/pdf,.pdf" hidden></div><div class="info">Aucun fichier sélectionné</div></div></div>
    <div class="field"><span class="lab">Structures à contourer</span>
      <div class="hint">Le nom des structures à contourer doit correspondre au nom des structures cibles chargées dans le fichier structure.</div>
      <div class="targets" id="u-targets"></div>
      <div><button class="btn" id="u-addt">+ Ajouter une structure</button></div>
      <div class="info hint" id="u-names"></div></div>
    <div class="field"><label for="u-pw">Mot de passe d'ouverture du dossier</label><input type="password" id="u-pw" autocomplete="new-password"></div>
    <div class="errors" id="u-err" hidden></div>
    <div class="actions"><button class="btn" id="u-cancel">Annuler</button><button class="btn primary" id="u-ok">Valider le chargement</button></div>`,{wide:true});
  const F={images:[],rtss:null,pdf:null};
  const tl=m.$('#u-targets');
  const addT=(v='')=>{ const d=document.createElement('div'); d.className='t';
    d.innerHTML='<input type="text" placeholder="Nom de la structure (ex. CTV_T)" aria-label="Structure à contourer"><button class="btn" title="Retirer" aria-label="Retirer">×</button>';
    d.querySelector('input').value=v; d.querySelector('button').onclick=()=>{ if(tl.children.length>1) d.remove(); else d.querySelector('input').value=''; };
    tl.appendChild(d); return d.querySelector('input'); };
  addT(); m.$('#u-addt').onclick=()=>addT().focus();
  const info=(id,txt,ok)=>{ const d=m.$(id); d.querySelector('.info').textContent=txt; d.classList.toggle('ok',ok); };
  const setImgs=files=>{ F.images=[...files].filter(f=>!/^\./.test(f.name)&&!/\.(pdf|txt|xml|json|jpg|png)$/i.test(f.name));
    info('#d-img',F.images.length?`${F.images.length} fichier(s) · ${(F.images.reduce((a,f)=>a+f.size,0)/1048576).toFixed(1)} Mo`:'Aucun fichier sélectionné',F.images.length>0); };
  m.$('#u-img').onchange=e=>setImgs(e.target.files); m.$('#u-dir').onchange=e=>setImgs(e.target.files);
  m.$('#u-rt').onchange=async e=>{ F.rtss=e.target.files[0]||null; info('#d-rt',F.rtss?F.rtss.name:'Aucun fichier sélectionné',!!F.rtss); F.roiNames=null; m.$('#u-names').textContent='';
    if(!F.rtss) return;
    try{ const rs=DICOM.parseRTSS(await F.rtss.arrayBuffer()); F.roiNames=rs.rois.map(r=>r.name);
      m.$('#u-names').textContent='Structures du fichier : '+F.roiNames.join(', '); }
    catch(err){ m.$('#u-names').textContent='Fichier structure illisible : '+err.message; } };
  m.$('#u-pdf').onchange=e=>{ F.pdf=e.target.files[0]||null; info('#d-pdf',F.pdf?F.pdf.name:'Aucun fichier sélectionné',!!F.pdf); };
  m.$('#u-cancel').onclick=m.close;
  const showErr=errs=>{ const b=m.$('#u-err'); b.innerHTML='<b>Le dossier ne peut pas être chargé :</b><ul>'+errs.map(e=>'<li>'+esc(e)+'</li>').join('')+'</ul>'; b.hidden=false; b.scrollIntoView({block:'nearest'}); };
  m.$('#u-ok').onclick=async()=>{
    const title=m.$('#u-title').value.trim(), category=m.$('#u-cat').value, pw=m.$('#u-pw').value;
    let targets=[...tl.querySelectorAll('input')].map(i=>i.value.trim()).filter(Boolean);
    const errs=[];
    if(!title) errs.push('Le nom du dossier est manquant.');
    if(!category) errs.push('Le type tumoral n\'est pas choisi.');
    if(!F.images.length) errs.push('Aucune image DICOM n\'est chargée.');
    if(!F.rtss) errs.push('Le fichier structure n\'est pas chargé.');
    if(!F.pdf) errs.push('Le fichier PDF de l\'histoire clinique n\'est pas chargé.');
    else if(!/\.pdf$/i.test(F.pdf.name)&&F.pdf.type!=='application/pdf') errs.push('L\'histoire clinique doit être un fichier PDF.');
    if(!targets.length) errs.push('Aucune structure à contourer n\'est renseignée.');
    const dup=targets.filter((t,i)=>targets.findIndex(x=>DICOM.normName(x)===DICOM.normName(t))!==i);
    if(dup.length) errs.push('Structure à contourer en double : '+[...new Set(dup)].join(', ')+'.');
    if(!pw) errs.push('Le mot de passe d\'ouverture du dossier est manquant.');
    if(errs.length) return showErr(errs);
    // contrôle du contenu : images lisibles, RTSTRUCT lisible, cibles présentes et sur les images
    const ok=m.$('#u-ok'); ok.disabled=true; ok.textContent='Vérification des fichiers…'; m.$('#u-err').hidden=true;
    try{
      let rs, V;
      try{ rs=DICOM.parseRTSS(await F.rtss.arrayBuffer()); }catch(e){ errs.push('Fichier structure illisible : '+e.message); }
      try{ V=DICOM.buildVolume(await Promise.all(F.images.map(f=>f.arrayBuffer()))); }catch(e){ errs.push('Images DICOM illisibles : '+e.message); }
      if(rs){
        const miss=targets.filter(t=>!rs.rois.some(r=>DICOM.normName(r.name)===DICOM.normName(t)));
        if(miss.length) errs.push(`Structure(s) absente(s) du fichier structure : ${miss.join(', ')}. Structures disponibles : ${rs.rois.map(r=>r.name).join(', ')||'aucune'}.`);
        else if(V) for(const t of targets){ const r=rs.rois.find(r=>DICOM.normName(r.name)===DICOM.normName(t));
          if(DICOM.rasterize(r,V).b[1]<0) errs.push(`La structure « ${r.name} » ne recoupe pas les images chargées (contour vide ou série différente).`); }
      }
      if(errs.length) return showErr(errs);
      targets=targets.map(t=>rs.rois.find(r=>DICOM.normName(r.name)===DICOM.normName(t)).name); // nom exact du fichier structure
      const d={id:'loc-'+Date.now().toString(36)+Math.random().toString(36).slice(2,7),title,category,targets,pwHash:await Store.sha256(pw),created:new Date().toISOString(),
        dims:[V.NX,V.NY,V.NZ]};
      ok.textContent='Enregistrement…';
      await Store.addDossier(d,{images:F.images.map(f=>new Blob([f],{type:'application/dicom'})),rtss:new Blob([F.rtss],{type:'application/dicom'}),pdf:new Blob([F.pdf],{type:'application/pdf'})});
      m.close(); renderHome();
    }catch(e){ showErr(['Enregistrement impossible dans ce navigateur : '+e.message]); }
    finally{ ok.disabled=false; ok.textContent='Valider le chargement'; }
  };
  m.$('#u-title').focus();
}

// ---- contourage ----
async function renderViewer(id){
  const d=await findDossier(id);
  if(!d){ page.innerHTML='<div class="loading error">Dossier introuvable. <a href="#/">Retour au menu</a></div>'; return; }
  if(!unlocked.has(id)){
    page.innerHTML='';
    if(!await askPassword('Ouvrir « '+d.title+' »',checkDossierPw(d))){ location.hash='#/'; return; }
    unlocked.add(id);
  }
  page.innerHTML='<div class="loading"><div id="lmsg">Chargement des images…</div><div class="bar"><i></i></div></div>';
  const bar=page.querySelector('.bar i'), msg=page.querySelector('#lmsg');
  try{
    const files=await dossierFiles(d,p=>bar.style.width=(p*90).toFixed(0)+'%');
    msg.textContent='Reconstruction du volume et des structures…'; await new Promise(r=>setTimeout(r,30));
    const V=DICOM.buildVolume(files.images), rs=DICOM.parseRTSS(files.rtss);
    const draft=await Store.getDraft(d.id).catch(()=>null);
    if(location.hash!=='#/contourage/'+encodeURIComponent(id)) return; // l'utilisateur est parti entre-temps
    page.innerHTML='';
    current=Viewer.open(page,{dossier:d,V,rois:rs.rois,draft,pdfUrl:await pdfUrl(d).catch(()=>null),
      saveDraft:v=>Store.putDraft(d.id,v),
      confirm:confirmBox,
      onValidated:async scores=>{ await Store.addResult(d.id,{date:new Date().toISOString(),scores:scores.map(s=>({name:s.name,dice:s.dice,volUser:s.volUser,volRef:s.volRef}))});
        await Store.delDraft(d.id); }});
  }catch(e){ page.innerHTML=`<div class="loading error">Le dossier n'a pas pu être ouvert : ${esc(e.message)}. <a href="#/">Retour au menu</a></div>`; }
}

// ---- navigation ----
async function route(){
  if(current){ current.destroy(); current=null; }
  modalRoot.innerHTML='';
  const h=location.hash.replace(/^#\/?/,''), [r,arg]=h.split('/'), id=arg&&decodeURIComponent(arg);
  window.scrollTo(0,0);
  if(r==='contourage'&&id) return renderViewer(id);
  if(r==='historique'&&id){ const d=await findDossier(id); const res=await Store.getResults(id).catch(()=>[]);
    return DiceHistory.render(page,d||{id,title:'Dossier supprimé',category:'',targets:[]},res); }
  return renderHome();
}
window.addEventListener('hashchange',route);
window.addEventListener('beforeunload',()=>{ if(current) current.destroy(); });
route();
})();

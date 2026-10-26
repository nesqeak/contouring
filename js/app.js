// Menu principal, chargement des dossiers, accès par mot de passe et navigation.
(function(){
const CATEGORIES=['Crâne','ORL','Sein','Poumon','Œsophage','Foie','Pancréas','Rein','Col utérin','Endomètre','Vessie','Prostate','Rectum','Canal anal','Os'];
const UPLOAD_PASSWORD='sfro';
const page=document.getElementById('page'), modalRoot=document.getElementById('modal-root');
const esc=t=>String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const unlocked=new Set(); // dossiers ouverts avec le bon mot de passe pendant cette visite
let current=null; // visionneuse ouverte
// navigation interne : dans la fenêtre d'un Artifact, le fragment d'URL ne peut pas porter de chemin
let path=location.hash.replace(/^#\/?/,'');
function go(to){ path=to.replace(/^#\/?/,''); try{ history.replaceState(null,'','#/'+path); }catch(e){} route(); }
document.addEventListener('click',e=>{ const a=e.target.closest&&e.target.closest('a[href^="#/"]'); if(!a||e.defaultPrevented||e.button||e.metaKey||e.ctrlKey) return; e.preventDefault(); go(a.getAttribute('href')); });
const pdfUrls={};
// stockage partagé (plateforme publiée comme Artifact claude.ai) ; null en site statique
let shared=null;
const sharedP=Shared.init().catch(()=>null).then(s=>{ shared=s;
  if(s) s.onChange(()=>{ if(!path&&!modalRoot.children.length) renderHome(); }); });

// ---- dossiers : catalogue publié (dossiers/catalogue.json) + dossiers chargés dans ce navigateur ----
async function loadCatalogue(){
  try{ const r=await fetch('dossiers/catalogue.json',{cache:'no-cache'}); if(!r.ok) return [];
    const j=await r.json();
    return (j.dossiers||[]).map(d=>({id:'cat-'+d.id,source:'catalogue',title:d.titre,category:d.categorie,targets:d.cibles||[],structures:d.structures,
      pwHash:d.mot_de_passe_sha256,pdf:d.pdf,rtss:d.rtstruct,images:d.images||[]})); }
  catch(e){ return []; }
}
async function loadAll(){
  if(shared){ const ok=await Store.listLocal().then(()=>true,()=>false);
    return {list:await shared.list(),storeOk:ok}; }
  const [cat,loc]=await Promise.all([loadCatalogue(),Store.listLocal().catch(()=>null)]);
  return {list:[...cat,...(loc||[]).map(d=>({...d,source:'local'}))], storeOk:loc!==null};
}
async function findDossier(id){ return (await loadAll()).list.find(d=>d.id===id); }
async function pdfUrl(d){
  if(d.source==='catalogue') return d.pdf;
  if(d.source==='shared') return shared.pdfUrl(d);
  if(pdfUrls[d.id]) return pdfUrls[d.id];
  const f=await Store.getFiles(d.id); return f&&f.pdf?(pdfUrls[d.id]=URL.createObjectURL(f.pdf)):null;
}
// volume et structures du dossier
async function loadCase(d,progress,msg){
  if(d.source==='shared') return shared.load(d,progress);
  const files=await dossierFiles(d,progress);
  msg('Reconstruction du volume et des structures…'); await new Promise(r=>setTimeout(r,30));
  return {V:DICOM.buildVolume(files.images),rois:DICOM.parseRTSS(files.rtss).rois};
}
// fichiers DICOM du dossier sous forme d'ArrayBuffer
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
function message(title,text){
  return new Promise(res=>{ const m=modal(`<h2>${esc(title)}</h2><div>${esc(text)}</div><div class="actions"><button class="btn primary">OK</button></div>`);
    const b=m.$('button'); b.focus(); b.onclick=()=>{m.close();res();}; });
}
window.UI={message};
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
        ${d.source==='local'||(d.source==='shared'&&shared.canUpload)?'<button class="btn danger" data-del title="Supprimer ce dossier">Supprimer</button>':''}</div>`;
      const a=row.querySelector('[data-pdf]');
      pdfUrl(d).then(u=>{ if(u) a.href=u; else a.hidden=true; }).catch(()=>{a.hidden=true;});
      row.querySelector('[data-open]').onclick=async()=>{
        if(await askPassword('Ouvrir « '+d.title+' »',checkDossierPw(d))){ unlocked.add(d.id); go('#/contourage/'+encodeURIComponent(d.id)); } };
      const del=row.querySelector('[data-del]');
      if(del) del.onclick=async()=>{
        if(!await askPassword('Supprimer « '+d.title+' »',async pw=>pw===UPLOAD_PASSWORD,'Mot de passe de chargement requis. L\'historique des scores est conservé.')) return;
        if(!await confirmBox('Supprimer définitivement le dossier « '+d.title+' »'+(d.source==='shared'?' pour tous les utilisateurs ?':' de ce navigateur ?'))) return;
        try{ if(d.source==='shared') await shared.remove(d); else await Store.removeDossier(d.id); }
        catch(e){ await message('Suppression impossible',(shared?shared.errMsg(e):e.message)); }
        renderHome(); };
      sec.appendChild(row);
    }
    cats.appendChild(sec);
  }
  if(shared&&!shared.canUpload){ const b=page.querySelector('#add'); b.disabled=true; b.title='Ajout réservé aux éditeurs de la plateforme';
    b.insertAdjacentHTML('afterend','<div class="hint" style="margin-left:10px;align-self:center">Ajout réservé aux éditeurs de la plateforme.</div>'); }
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
    <div class="field"><span class="lab">Structures du fichier structure</span>
      <div class="hint" id="u-shint">Chargez le fichier structure pour choisir les structures du dossier.</div>
      <div class="tscroll" id="u-swrap" hidden><table class="stab"><thead><tr><th>Structure</th><th>Structure à charger</th><th>Structure cible</th></tr></thead><tbody id="u-structs"></tbody></table></div></div>
    <div class="field"><label for="u-pw">Mot de passe d'ouverture du dossier</label><input type="password" id="u-pw" autocomplete="new-password"></div>
    <div class="errors" id="u-err" hidden></div>
    <div class="actions"><button class="btn" id="u-cancel">Annuler</button><button class="btn primary" id="u-ok">Valider le chargement</button></div>`,{wide:true});
  const F={images:[],rtss:null,pdf:null};
  const sb=m.$('#u-structs');
  // une ligne par structure du RTSTRUCT : « à charger » et « cible » (une cible est forcément chargée)
  const showStructs=rois=>{
    sb.innerHTML=''; m.$('#u-swrap').hidden=!rois; if(!rois) return;
    m.$('#u-shint').textContent=rois.length?'Seules les structures cochées « à charger » sont ajoutées au dossier. Les structures cibles sont créées vides, à contourer par l\'utilisateur ; leur contour du fichier sert de référence pour le calcul du Dice.':'Le fichier structure ne contient aucune structure.';
    rois.forEach((r,k)=>{ const tr=document.createElement('tr'), empty=!r.contours.length;
      tr.innerHTML=`<td><span class="sw" style="--c:${r.color?'rgb('+r.color.join(',')+')':'var(--muted)'}"></span> ${esc(r.name)}${empty?' <span class="hint">(sans contour)</span>':''}</td>
        <td><input type="checkbox" data-load ${empty?'':'checked'} aria-label="Charger ${esc(r.name)}"></td>
        <td><input type="checkbox" data-target ${empty?'disabled':''} aria-label="${esc(r.name)} est une structure cible"></td>`;
      const ld=tr.querySelector('[data-load]'), tg=tr.querySelector('[data-target]');
      tg.onchange=()=>{ if(tg.checked){ ld.checked=true; ld.disabled=true; } else ld.disabled=false; };
      tr.dataset.k=k; sb.appendChild(tr); });
  };
  const info=(id,txt,ok)=>{ const d=m.$(id); d.querySelector('.info').textContent=txt; d.classList.toggle('ok',ok); };
  const setImgs=files=>{ F.images=[...files].filter(f=>!/^\./.test(f.name)&&!/\.(pdf|txt|xml|json|jpg|png)$/i.test(f.name));
    info('#d-img',F.images.length?`${F.images.length} fichier(s) · ${(F.images.reduce((a,f)=>a+f.size,0)/1048576).toFixed(1)} Mo`:'Aucun fichier sélectionné',F.images.length>0); };
  m.$('#u-img').onchange=e=>setImgs(e.target.files); m.$('#u-dir').onchange=e=>setImgs(e.target.files);
  m.$('#u-rt').onchange=async e=>{ F.rtss=e.target.files[0]||null; info('#d-rt',F.rtss?F.rtss.name:'Aucun fichier sélectionné',!!F.rtss); F.rs=null; showStructs(null);
    m.$('#u-shint').textContent='Chargez le fichier structure pour choisir les structures du dossier.';
    if(!F.rtss) return;
    try{ F.rs=DICOM.parseRTSS(await F.rtss.arrayBuffer()); showStructs(F.rs.rois); }
    catch(err){ m.$('#u-shint').textContent='Fichier structure illisible : '+err.message; } };
  m.$('#u-pdf').onchange=e=>{ F.pdf=e.target.files[0]||null; info('#d-pdf',F.pdf?F.pdf.name:'Aucun fichier sélectionné',!!F.pdf); };
  m.$('#u-cancel').onclick=m.close;
  const showErr=errs=>{ const b=m.$('#u-err'); b.innerHTML='<b>Le dossier ne peut pas être chargé :</b><ul>'+errs.map(e=>'<li>'+esc(e)+'</li>').join('')+'</ul>'; b.hidden=false; b.scrollIntoView({block:'nearest'}); };
  m.$('#u-ok').onclick=async()=>{
    const title=m.$('#u-title').value.trim(), category=m.$('#u-cat').value, pw=m.$('#u-pw').value;
    const rows=[...sb.children], sel=rows.filter(tr=>tr.querySelector('[data-load]').checked), tgt=rows.filter(tr=>tr.querySelector('[data-target]').checked);
    const errs=[];
    if(!title) errs.push('Le nom du dossier est manquant.');
    if(!category) errs.push('Le type tumoral n\'est pas choisi.');
    if(!F.images.length) errs.push('Aucune image DICOM n\'est chargée.');
    if(!F.rtss) errs.push('Le fichier structure n\'est pas chargé.');
    if(!F.pdf) errs.push('Le fichier PDF de l\'histoire clinique n\'est pas chargé.');
    else if(shared&&F.pdf.size>20*1048576) errs.push('Le PDF de l\'histoire clinique dépasse 20 Mo.');
    else if(!/\.pdf$/i.test(F.pdf.name)&&F.pdf.type!=='application/pdf') errs.push('L\'histoire clinique doit être un fichier PDF.');
    if(F.rtss&&!F.rs) errs.push('Le fichier structure est illisible.');
    else if(F.rs&&!tgt.length) errs.push('Aucune structure n\'est cochée comme structure cible.');
    const names=tgt.map(tr=>F.rs.rois[tr.dataset.k].name), dup=names.filter((t,i)=>names.findIndex(x=>DICOM.normName(x)===DICOM.normName(t))!==i);
    if(dup.length) errs.push('Plusieurs structures cibles portent le même nom : '+[...new Set(dup)].join(', ')+'.');
    if(!pw) errs.push('Le mot de passe d\'ouverture du dossier est manquant.');
    if(errs.length) return showErr(errs);
    // contrôle du contenu : images lisibles, RTSTRUCT lisible, cibles présentes et sur les images
    const ok=m.$('#u-ok'); ok.disabled=true; ok.textContent='Vérification des fichiers…'; m.$('#u-err').hidden=true;
    try{
      let V; const rois=sel.map(tr=>F.rs.rois[tr.dataset.k]), targets=tgt.map(tr=>F.rs.rois[tr.dataset.k]);
      try{ V=DICOM.buildVolume(await Promise.all(F.images.map(f=>f.arrayBuffer()))); }catch(e){ errs.push('Images DICOM illisibles : '+e.message); }
      if(V) for(const r of targets) if(DICOM.rasterize(r,V).b[1]<0) errs.push(`La structure cible « ${r.name} » ne recoupe pas les images chargées (contour vide ou série différente).`);
      if(errs.length) return showErr(errs);
      const d={id:'loc-'+Date.now().toString(36)+Math.random().toString(36).slice(2,7),title,category,targets:targets.map(r=>r.name),structures:rois.map(r=>r.name),pwHash:await Store.sha256(pw),created:new Date().toISOString(),
        dims:[V.NX,V.NY,V.NZ]};
      if(shared){ ok.textContent='Envoi… 0 %';
        await shared.add(d,V,rois,F.pdf,p=>ok.textContent='Envoi… '+Math.round(p*100)+' %');
        m.close(); renderHome(); return; }
      ok.textContent='Enregistrement…';
      await Store.addDossier(d,{images:F.images.map(f=>new Blob([f],{type:'application/dicom'})),rtss:new Blob([F.rtss],{type:'application/dicom'}),pdf:new Blob([F.pdf],{type:'application/pdf'})});
      m.close(); renderHome();
    }catch(e){ showErr([(shared?'Envoi impossible : ':'Enregistrement impossible dans ce navigateur : ')+e.message]); }
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
    if(!await askPassword('Ouvrir « '+d.title+' »',checkDossierPw(d))){ go('#/'); return; }
    unlocked.add(id);
  }
  page.innerHTML='<div class="loading"><div id="lmsg">Chargement des images…</div><div class="bar"><i></i></div></div>';
  const bar=page.querySelector('.bar i'), msg=page.querySelector('#lmsg');
  try{
    const {V,rois}=await loadCase(d,p=>bar.style.width=(p*90).toFixed(0)+'%',t=>msg.textContent=t);
    const draft=await Store.getDraft(d.id).catch(()=>null);
    if(path!=='contourage/'+encodeURIComponent(id)) return; // l'utilisateur est parti entre-temps
    page.innerHTML='';
    // seules les structures choisies au chargement (toutes pour un dossier sans liste) ; les cibles en font partie
    const keep=d.structures&&new Set([...d.structures,...d.targets].map(DICOM.normName));
    current=Viewer.open(page,{dossier:d,V,rois:keep?rois.filter(r=>keep.has(DICOM.normName(r.name))):rois,draft,pdfUrl:await pdfUrl(d).catch(()=>null),
      saveDraft:v=>Store.putDraft(d.id,v),
      confirm:confirmBox,
      onValidated:async scores=>{ await Store.addResult(d.id,{date:new Date().toISOString(),scores:scores.map(s=>({name:s.name,dice:s.dice,volUser:s.volUser,volRef:s.volRef}))});
        await Store.delDraft(d.id); }});
  }catch(e){ page.innerHTML=`<div class="loading error">Le dossier n'a pas pu être ouvert : ${esc(e.message)}. <a href="#/">Retour au menu</a></div>`; }
}

// ---- navigation ----
async function route(){
  await sharedP;
  if(current){ current.destroy(); current=null; }
  modalRoot.innerHTML='';
  const [r,arg]=path.split('/');
  document.body.classList.toggle('light',r!=='contourage'); // accueil et historique sur fond blanc, visionneuse en console sombre
  const id=arg&&decodeURIComponent(arg);
  window.scrollTo(0,0);
  if(r==='contourage'&&id) return renderViewer(id);
  if(r==='historique'&&id){ const d=await findDossier(id); const res=await Store.getResults(id).catch(()=>[]);
    return DiceHistory.render(page,d||{id,title:'Dossier supprimé',category:'',targets:[]},res); }
  return renderHome();
}
window.addEventListener('hashchange',()=>{ const h=location.hash.replace(/^#\/?/,''); if(h!==path){ path=h; route(); } });
window.addEventListener('beforeunload',()=>{ if(current) current.destroy(); });
route();
})();

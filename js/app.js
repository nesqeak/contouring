// Connexion, menu des dossiers (interne ou administrateur), chargement des dossiers et navigation.
(function(){
const CATEGORIES=['Crâne','ORL','Sein','Poumon','Œsophage','Foie','Pancréas','Rein','Col utérin','Endomètre','Vessie','Prostate','Rectum','Canal anal','Os'];
const page=document.getElementById('page'), modalRoot=document.getElementById('modal-root');
const esc=t=>String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let current=null; // visionneuse ouverte
// navigation interne : dans la fenêtre d'un Artifact, le fragment d'URL ne peut pas porter de chemin
let path=location.hash.replace(/^#\/?/,'');
function go(to){ path=to.replace(/^#\/?/,''); try{ history.replaceState(null,'','#/'+path); }catch(e){} route(); }
document.addEventListener('click',e=>{ const a=e.target.closest&&e.target.closest('a[href^="#/"]'); if(!a||e.defaultPrevented||e.button||e.metaKey||e.ctrlKey) return; e.preventDefault(); go(a.getAttribute('href')); });
// stockage partagé (plateforme publiée comme Artifact claude.ai) ; null en site statique.
// ARTIFACT : page servie par artifact.html, où les dossiers doivent aller au stockage partagé, jamais au navigateur.
const ARTIFACT=!!window.PLATEFORME_PARTAGEE;
let shared=null;
const sharedP=Shared.init().catch(()=>null).then(async s=>{ shared=s;
  if(!(ARTIFACT&&!s)){ Accounts.init(s&&s.db); await Accounts.restore().catch(()=>null); }
  if(s) s.onChange(()=>{ if(!path&&Accounts.me&&!modalRoot.children.length) renderHome(); }); });
const isAdmin=()=>Accounts.me&&Accounts.me.role==='admin';
const fullName=a=>`${a.prenom||''} ${a.nom||''}`.trim();

// ---- dossiers : catalogue publié (dossiers/catalogue.json) + dossiers chargés dans ce navigateur ----
async function loadCatalogue(){
  try{ const r=await fetch('dossiers/catalogue.json',{cache:'no-cache'}); if(!r.ok) return [];
    const j=await r.json();
    return (j.dossiers||[]).map(d=>({id:'cat-'+d.id,source:'catalogue',title:d.titre,category:d.categorie,targets:d.cibles||[],structures:d.structures,
      pdf:d.pdf,rtss:d.rtstruct,images:d.images||[]})); }
  catch(e){ return []; }
}
async function loadAll(){
  if(shared){ const [sh,loc]=await Promise.all([shared.list(),Store.listLocal().catch(()=>null)]), ids=new Set(sh.map(d=>d.id));
    return {list:[...sh,...(loc||[]).filter(d=>!ids.has(d.id)).map(d=>({...d,source:'local'}))],storeOk:loc!==null}; }
  const [cat,loc]=await Promise.all([loadCatalogue(),Store.listLocal().catch(()=>null)]);
  return {list:[...cat,...(loc||[]).map(d=>({...d,source:'local'}))], storeOk:loc!==null};
}
async function findDossier(id){ return (await loadAll()).list.find(d=>d.id===id); }
// Histoire clinique : dans un Artifact, un lien ouvrant un nouvel onglet ne peut pas lire le stockage de la
// plateforme ; le PDF est donc lu par la page puis proposé au téléchargement (capacité « downloads »).
async function openPdf(d,btn){
  const t=btn&&btn.textContent; if(btn){ btn.disabled=true; btn.textContent='Préparation…'; }
  try{
    const blob=d.source==='shared'?await shared.pdfBlob(d):d.source==='local'?(await Store.getFiles(d.id)).pdf:await (await fetch(d.pdf)).blob();
    const filename='Histoire clinique - '+d.title.replace(/[\\/:*?"<>|]+/g,' ').trim()+'.pdf';
    const dl=window.claude&&typeof claude.use==='function'?await claude.use('downloads'):null;
    if(dl){ try{ await dl.save({filename,data:blob}); }catch(e){ if(e&&e.code!=='declined') throw new Error(e.message||e.code); } }
    else { const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; a.target='_blank'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),60000); }
  }catch(e){ await message('Histoire clinique indisponible',e.message||String(e)); }
  finally{ if(btn){ btn.disabled=false; btn.textContent=t; } }
}

// volume et structures du dossier
async function loadCase(d,progress,msg){
  if(d.source==='shared') return shared.load(d,progress);
  const files=await dossierFiles(d,progress);
  msg('Reconstruction du volume et des structures…'); await new Promise(r=>setTimeout(r,30));
  const fus=(d.source==='local'&&(await Store.getFiles(d.id)).fusions)||[];
  return {V:DICOM.buildVolume(files.images),rois:DICOM.parseRTSS(files.rtss).rois,
    fusions:fus.map(f=>({name:f.name,modality:f.modality,load:async()=>new Uint8Array(await f.data.arrayBuffer())}))};
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

// ---- en-tête commun : logo HCL, titre de la plateforme, compte connecté ----
function siteHeader(){
  const u=Accounts.me;
  return `<header class="sitebar"><div class="sb-in">
    <img class="sb-logo" src="assets/logo-hcl.png" alt="Hospices Civils de Lyon">
    <div class="sb-t"><b>Plateforme d'entraînement au contourage</b></div>
    <span class="grow"></span>
    ${u?`<span class="sb-user">${esc(fullName(u))}<small>${u.role==='admin'?'Administrateur':'Interne'}</small></span>
      <button class="btn" data-act="profil">Profil</button><button class="btn" data-act="logout">Déconnexion</button>`:''}
  </div></header>`;
}
document.addEventListener('click',e=>{ const b=e.target.closest&&e.target.closest('[data-act]'); if(!b) return;
  if(b.dataset.act==='profil') profileModal();
  else if(b.dataset.act==='logout'){ Accounts.logout(); go('#/'); } });

// localisations repliées / dépliées, retenues dans ce navigateur (simple confort, sans conséquence si indisponible)
const FKEY='plateforme-contourage:localisations';
const fold=(()=>{ try{ return JSON.parse(localStorage.getItem(FKEY))||{}; }catch(e){ return {}; } })();
const saveFold=()=>{ try{ localStorage.setItem(FKEY,JSON.stringify(fold)); }catch(e){} };

// ---- menu principal ----
async function renderHome(){
  page.innerHTML=siteHeader()+'<div class="loading">Chargement des dossiers…</div>';
  const {list,storeOk}=await loadAll(), admin=isAdmin();
  page.innerHTML=siteHeader()+`<div class="home">
    <header class="brand">
      <div><h1>Plateforme d'entraînement au contourage</h1><div class="sub">Dossiers cliniques classés par localisation tumorale</div></div>
      ${admin?`<div class="admbar"><button class="btn primary" data-a="add">Ajouter un dossier</button><button class="btn" data-a="account">Créer un compte</button><a class="btn" href="#/suivi">Suivi des internes</a><a class="btn" href="#/admins">Administrateurs</a></div>`:''}
    </header>
    ${ARTIFACT&&!shared?'<div class="errors"><b>Stockage partagé indisponible dans cette vue.</b> Ouvrez la plateforme depuis son lien claude.ai, en étant connecté à votre compte (pas dans un onglet séparé ni depuis un fichier enregistré). L\'ajout de dossiers est désactivé ici pour qu\'aucun dossier ne reste enfermé dans ce navigateur.</div>':''}
    ${storeOk?'':'<div class="errors">Ce navigateur bloque le stockage local : les dossiers chargés, les contours en cours et l\'historique des scores ne peuvent pas être enregistrés.</div>'}
    <div class="catbar"><button class="btn" data-fold="1">Tout déplier</button><button class="btn" data-fold="0">Tout replier</button></div>
    <div id="cats" style="display:grid;gap:14px"></div>
    ${admin?`<div class="add"><button class="btn primary" id="add">Ajouter un dossier</button></div>
    <div class="hint" style="text-align:center;margin-top:-12px">${shared?'Stockage partagé : les dossiers ajoutés sont visibles par toutes les personnes ayant accès à la plateforme.':'Version locale : les dossiers et les comptes restent dans ce navigateur.'}</div>`:''}
    <footer class="disclaimer"><b>Avertissement :</b> cette plateforme est destinée exclusivement à la formation. Elle ne doit pas être utilisée pour la planification clinique des traitements.</footer>
  </div>`;
  const cats=page.querySelector('#cats');
  const extra=[...new Set(list.map(d=>d.category).filter(c=>!CATEGORIES.includes(c)))];
  for(const c of [...CATEGORIES,...extra]){
    const ds=list.filter(d=>d.category===c).sort((a,b)=>a.title.localeCompare(b.title,'fr'));
    // localisation repliable ; l'état choisi est retenu dans ce navigateur (par défaut : dépliée si elle a des dossiers)
    const sec=document.createElement('details'); sec.className='cat'+(ds.length?'':' empty'); sec.dataset.cat=c;
    sec.open=c in fold?fold[c]:ds.length>0;
    sec.innerHTML=`<summary><h2>${esc(c)} <span class="n">${ds.length?ds.length+' dossier'+(ds.length>1?'s':''):''}</span></h2></summary>`+(ds.length?'':'<div class="none">Aucun dossier</div>');
    sec.addEventListener('toggle',()=>{ fold[c]=sec.open; saveFold(); });
    for(const d of ds){
      const row=document.createElement('div'); row.className='drow';
      const onlyHere=shared&&d.source==='local';
      row.innerHTML=`<div class="t">${esc(d.title)}${onlyHere?' <span class="tag">dans ce navigateur uniquement</span>':''}<small>${d.targets.length} structure${d.targets.length>1?'s':''} à contourer : ${esc(d.targets.join(', '))}</small></div>
        <div class="acts">${admin&&onlyHere&&shared.canUpload?'<button class="btn" data-share title="Envoyer ce dossier vers le stockage partagé">Mettre en partage</button>':''}<button class="btn" data-pdf>Histoire clinique</button>
        <button class="btn primary" data-open>Contourage</button>
        ${admin?`<a class="btn" href="#/stats/${encodeURIComponent(d.id)}">Statistiques</a>`:`<a class="btn" href="#/historique/${encodeURIComponent(d.id)}">Historique</a>`}
        ${admin&&(d.source==='local'||(d.source==='shared'&&shared.canUpload))?'<button class="btn danger" data-del title="Supprimer ce dossier">Supprimer</button>':''}</div>`;
      const a=row.querySelector('[data-pdf]');
      if(d.source==='shared'?!d.pdf:d.source==='catalogue'?!d.pdf:false) a.hidden=true;
      a.onclick=()=>openPdf(d,a);
      row.querySelector('[data-open]').onclick=()=>{
        go('#/contourage/'+encodeURIComponent(d.id)); };
      const sh=row.querySelector('[data-share]');
      if(sh) sh.onclick=()=>shareLocal(d,sh);
      const del=row.querySelector('[data-del]');
      if(del) del.onclick=()=>{ // suppression protégée par le mot de passe administrateur
        const m=modal(`<h2>Supprimer le dossier « ${esc(d.title)} »</h2>
          <div class="errors"><b>Attention cette action est irréversible.</b> Le dossier ${d.source==='shared'?'est supprimé pour tous les utilisateurs':'est supprimé de ce navigateur'} (images, structures, histoire clinique) ; les scores déjà obtenus restent dans l'historique des internes.</div>
          <div class="field"><label for="dd-pw">Votre mot de passe administrateur</label><input type="password" id="dd-pw" autocomplete="current-password"></div>
          <div class="pw-err" aria-live="polite"></div>
          <div class="actions"><button class="btn" data-x>Annuler</button><button class="btn danger" data-ok>Supprimer définitivement</button></div>`);
        m.$('[data-x]').onclick=m.close; m.$('#dd-pw').focus();
        m.$('[data-ok]').onclick=async()=>{ const err=m.$('.pw-err'); err.textContent='';
          if(!await checkAdminPw(m.$('#dd-pw').value)){ err.textContent='Mot de passe incorrect.'; return; }
          try{ if(d.source==='shared') await shared.remove(d); else await Store.removeDossier(d.id); m.close(); renderHome(); }
          catch(e){ err.textContent='Suppression impossible : '+(shared?shared.errMsg(e):e.message); } }; };
      sec.appendChild(row);
    }
    cats.appendChild(sec);
  }
  page.querySelectorAll('[data-fold]').forEach(b=>b.onclick=()=>{ cats.querySelectorAll('details.cat').forEach(x=>{ x.open=b.dataset.fold==='1'; }); });
  if(!admin) return;
  const adds=page.querySelectorAll('#add,[data-a="add"]');
  if(shared&&!shared.canUpload) adds.forEach(b=>{ b.disabled=true; b.title='Ajout réservé aux éditeurs de l\'Artifact (menu Partager de claude.ai)'; });
  adds.forEach(b=>b.onclick=uploadForm);
  page.querySelector('[data-a="account"]').onclick=()=>createAccountModal();
}

// dossier enregistré dans ce navigateur -> stockage partagé (même identifiant : historique et contours en cours suivent)
async function shareLocal(d,btn){
  btn.disabled=true; const t=btn.textContent;
  try{
    btn.textContent='Lecture…';
    const f=await Store.getFiles(d.id); if(!f) throw new Error('fichiers du dossier introuvables dans ce navigateur');
    const V=DICOM.buildVolume(await Promise.all(f.images.map(b=>b.arrayBuffer()))), rs=DICOM.parseRTSS(await f.rtss.arrayBuffer());
    const keep=d.structures&&new Set([...d.structures,...d.targets].map(DICOM.normName));
    const {source,...meta}=d; void source;
    const fus=await Promise.all((f.fusions||[]).map(async x=>({name:x.name,modality:x.modality,data:new Uint8Array(await x.data.arrayBuffer())})));
    await shared.add(meta,V,keep?rs.rois.filter(r=>keep.has(DICOM.normName(r.name))):rs.rois,f.pdf,p=>btn.textContent='Envoi… '+Math.round(p*100)+' %',fus);
    await Store.removeDossierFiles(d.id);
    renderHome();
  }catch(e){ btn.disabled=false; btn.textContent=t; await message('Mise en partage impossible',e.message); }
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
    <div class="field"><span class="lab">Imageries de fusion <span class="hint">(facultatif)</span></span>
      <div class="hint">Pour chaque série (IRM, TEP…) : ses images DICOM et le fichier de recalage (REG) vers le scanner. Le REG peut être omis si la série partage le référentiel du scanner (TEP-TDM par exemple).</div>
      <div class="fusions" id="u-fus"></div>
      <div><button class="btn" id="u-addf">+ Ajouter une imagerie de fusion</button></div></div>
    <div class="field"><span class="lab">Structures du fichier structure</span>
      <div class="hint" id="u-shint">Chargez le fichier structure pour choisir les structures du dossier.</div>
      <div class="tscroll" id="u-swrap" hidden><table class="stab"><thead><tr><th>Structure</th><th>Structure à charger</th><th>Structure cible</th></tr><tr class="all"><td><label for="u-all">Tout cocher / tout décocher</label></td><td><input type="checkbox" id="u-all" aria-label="Charger toutes les structures"></td><td></td></tr></thead><tbody id="u-structs"></tbody></table></div></div>
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
      tg.onchange=()=>{ if(tg.checked){ ld.checked=true; ld.disabled=true; } else ld.disabled=false; syncAll(); };
      ld.onchange=syncAll;
      tr.dataset.k=k; sb.appendChild(tr); });
    syncAll();
  };
  // case « tout cocher » : cochée si tout est chargé, intermédiaire si une partie seulement ; les cibles restent chargées
  const all=m.$('#u-all');
  const syncAll=()=>{ const tot=[...sb.querySelectorAll('[data-load]')];
    const on=tot.filter(x=>x.checked).length; all.checked=on===tot.length&&tot.length>0; all.indeterminate=on>0&&on<tot.length; };
  all.onchange=()=>{ sb.querySelectorAll('[data-load]:not([disabled])').forEach(x=>{ x.checked=all.checked; }); syncAll(); };
  const info=(id,txt,ok)=>{ const d=m.$(id); d.querySelector('.info').textContent=txt; d.classList.toggle('ok',ok); };
  const setImgs=files=>{ F.images=[...files].filter(f=>!/^\./.test(f.name)&&!/\.(pdf|txt|xml|json|jpg|png)$/i.test(f.name));
    info('#d-img',F.images.length?`${F.images.length} fichier(s) · ${(F.images.reduce((a,f)=>a+f.size,0)/1048576).toFixed(1)} Mo`:'Aucun fichier sélectionné',F.images.length>0); };
  m.$('#u-img').onchange=e=>setImgs(e.target.files); m.$('#u-dir').onchange=e=>setImgs(e.target.files);
  m.$('#u-rt').onchange=async e=>{ F.rtss=e.target.files[0]||null; info('#d-rt',F.rtss?F.rtss.name:'Aucun fichier sélectionné',!!F.rtss); F.rs=null; showStructs(null);
    m.$('#u-shint').textContent='Chargez le fichier structure pour choisir les structures du dossier.';
    if(!F.rtss) return;
    try{ F.rs=DICOM.parseRTSS(await F.rtss.arrayBuffer()); showStructs(F.rs.rois); }
    catch(err){ m.$('#u-shint').textContent='Fichier structure illisible : '+err.message; } };
  // imageries de fusion : nom, images DICOM, recalage REG
  const FUS=[], fl=m.$('#u-fus');
  m.$('#u-addf').onclick=()=>{ const f={images:[],reg:null}, k=FUS.length; FUS.push(f);
    const box=document.createElement('div'); box.className='fusion';
    box.innerHTML=`<div class="fhead"><input type="text" placeholder="Nom affiché (ex. IRM T1 gadolinium)" aria-label="Nom de l'imagerie de fusion"><button class="btn" title="Retirer cette imagerie" aria-label="Retirer">×</button></div>
      <div class="drop" data-img><div class="pick"><label class="btn" for="f-img${k}">Images DICOM…</label><input type="file" id="f-img${k}" multiple hidden>
        <label class="btn" for="f-dir${k}">Dossier…</label><input type="file" id="f-dir${k}" webkitdirectory multiple hidden></div><div class="info">Aucune image sélectionnée</div></div>
      <div class="drop" data-reg><div class="pick"><label class="btn" for="f-reg${k}">Fichier de recalage (REG)…</label><input type="file" id="f-reg${k}" hidden></div><div class="info">Aucun fichier de recalage</div></div>`;
    f.box=box; f.nameEl=box.querySelector('input[type=text]');
    const setI=files=>{ f.images=[...files].filter(x=>!/^\./.test(x.name)&&!/\.(pdf|txt|xml|json|jpg|png)$/i.test(x.name)); const d=box.querySelector('[data-img]');
      d.querySelector('.info').textContent=f.images.length?`${f.images.length} fichier(s) · ${(f.images.reduce((a,x)=>a+x.size,0)/1048576).toFixed(1)} Mo`:'Aucune image sélectionnée'; d.classList.toggle('ok',f.images.length>0); };
    box.querySelector('#f-img'+k).onchange=e=>setI(e.target.files); box.querySelector('#f-dir'+k).onchange=e=>setI(e.target.files);
    box.querySelector('#f-reg'+k).onchange=e=>{ f.reg=e.target.files[0]||null; const d=box.querySelector('[data-reg]'); d.querySelector('.info').textContent=f.reg?f.reg.name:'Aucun fichier de recalage'; d.classList.toggle('ok',!!f.reg); };
    box.querySelector('.fhead button').onclick=()=>{ f.removed=true; box.remove(); };
    fl.appendChild(box); f.nameEl.focus(); };
  m.$('#u-pdf').onchange=e=>{ F.pdf=e.target.files[0]||null; info('#d-pdf',F.pdf?F.pdf.name:'Aucun fichier sélectionné',!!F.pdf); };
  m.$('#u-cancel').onclick=m.close;
  const showErr=errs=>{ const b=m.$('#u-err'); b.innerHTML='<b>Le dossier ne peut pas être chargé :</b><ul>'+errs.map(e=>'<li>'+esc(e)+'</li>').join('')+'</ul>'; b.hidden=false; b.scrollIntoView({block:'nearest'}); };
  m.$('#u-ok').onclick=async()=>{
    const title=m.$('#u-title').value.trim(), category=m.$('#u-cat').value;
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
    const fusIn=FUS.filter(f=>!f.removed);
    fusIn.forEach((f,i)=>{ if(!f.images.length) errs.push(`Imagerie de fusion n° ${i+1} : aucune image DICOM n'est chargée.`); });
    if(errs.length) return showErr(errs);
    // contrôle du contenu : images lisibles, RTSTRUCT lisible, cibles présentes et sur les images
    const ok=m.$('#u-ok'); ok.disabled=true; ok.textContent='Vérification des fichiers…'; m.$('#u-err').hidden=true;
    try{
      let V; const rois=sel.map(tr=>F.rs.rois[tr.dataset.k]), targets=tgt.map(tr=>F.rs.rois[tr.dataset.k]);
      try{ V=DICOM.buildVolume(await Promise.all(F.images.map(f=>f.arrayBuffer()))); }catch(e){ errs.push('Images DICOM illisibles : '+e.message); }
      if(V) for(const r of targets) if(DICOM.rasterize(r,V).b[1]<0) errs.push(`La structure cible « ${r.name} » ne recoupe pas les images chargées (contour vide ou série différente).`);
      // fusions : lecture, recalage, rééchantillonnage sur la grille du scanner
      const fusions=[];
      if(V) for(const [i,f] of fusIn.entries()){ const lab=`Imagerie de fusion n° ${i+1}`;
        try{ ok.textContent=`Recalage de la fusion ${i+1}…`; await new Promise(r=>setTimeout(r,20));
          const FV=DICOM.buildVolume(await Promise.all(f.images.map(x=>x.arrayBuffer())),null,{raw:true});
          const reg=f.reg?DICOM.parseREG(await f.reg.arrayBuffer()):null;
          const data=DICOM.resample(V,FV,DICOM.registration(V,FV,reg));
          let n=0; for(let j=0;j<data.length;j+=97) if(data[j]) n++;
          if(!n) throw new Error('après recalage, la série ne recoupe pas le scanner');
          fusions.push({name:f.nameEl.value.trim()||[FV.modality,FV.description].filter(Boolean).join(' · ')||lab,modality:FV.modality,data}); }
        catch(e){ errs.push(`${lab} : ${e.message}.`); } }
      if(errs.length) return showErr(errs);
      const d={id:'loc-'+Date.now().toString(36)+Math.random().toString(36).slice(2,7),title,category,targets:targets.map(r=>r.name),structures:rois.map(r=>r.name),created:new Date().toISOString(),
        dims:[V.NX,V.NY,V.NZ],fusions:fusions.map(f=>({name:f.name,modality:f.modality}))};
      if(shared){ ok.textContent='Envoi… 0 %';
        await shared.add(d,V,rois,F.pdf,p=>ok.textContent='Envoi… '+Math.round(p*100)+' %',fusions);
        m.close(); renderHome(); return; }
      ok.textContent='Enregistrement…';
      await Store.addDossier(d,{images:F.images.map(f=>new Blob([f],{type:'application/dicom'})),rtss:new Blob([F.rtss],{type:'application/dicom'}),pdf:new Blob([F.pdf],{type:'application/pdf'}),
        fusions:fusions.map(f=>({name:f.name,modality:f.modality,data:new Blob([f.data])}))});
      m.close(); renderHome();
    }catch(e){ showErr([(shared?'Envoi impossible : ':'Enregistrement impossible dans ce navigateur : ')+e.message]); }
    finally{ ok.disabled=false; ok.textContent='Valider le chargement'; }
  };
  m.$('#u-title').focus();
}

// ---- contourage ----
async function renderViewer(id){
  const d=await findDossier(id);
  if(!d){ page.innerHTML=siteHeader()+'<div class="loading error">Dossier introuvable. <a href="#/">Retour au menu</a></div>'; return; }
  page.innerHTML=siteHeader()+'<div class="loading"><div id="lmsg">Chargement des images…</div><div class="bar"><i></i></div></div>';
  const bar=page.querySelector('.bar i'), msg=page.querySelector('#lmsg');
  try{
    const {V,rois,fusions}=await loadCase(d,p=>bar.style.width=(p*90).toFixed(0)+'%',t=>msg.textContent=t);
    const me=Accounts.me, dkey=me.id+':'+d.id; // contours en cours propres à chaque compte
    const draft=await Store.getDraft(dkey).catch(()=>null);
    if(path!=='contourage/'+encodeURIComponent(id)) return; // l'utilisateur est parti entre-temps
    page.innerHTML=siteHeader()+'<div id="vroot"></div>';
    // seules les structures choisies au chargement (toutes pour un dossier sans liste) ; les cibles en font partie
    const keep=d.structures&&new Set([...d.structures,...d.targets].map(DICOM.normName));
    current=Viewer.open(page.querySelector('#vroot'),{dossier:d,V,fusions:fusions||[],rois:keep?rois.filter(r=>keep.has(DICOM.normName(r.name))):rois,draft,openPdf:btn=>openPdf(d,btn),
      saveDraft:v=>Store.putDraft(dkey,v),
      confirm:confirmBox,
      onValidated:async scores=>{ await Accounts.addResult({account:me.id,role:me.role,dossier:d.id,title:d.title,category:d.category,date:new Date().toISOString(),
          scores:scores.map(s=>({name:s.name,dice:s.dice,volUser:s.volUser,volRef:s.volRef}))});
        await Store.delDraft(dkey); }});
  }catch(e){ page.innerHTML=siteHeader()+`<div class="loading error">Le dossier n'a pas pu être ouvert : ${esc(e.message)}. <a href="#/">Retour au menu</a></div>`; }
}

// ---- connexion ----
function renderNoStorage(){
  page.innerHTML=siteHeader()+`<div class="login"><h1>Plateforme d'entraînement au contourage</h1>
    <div class="errors"><b>Stockage partagé indisponible dans cette vue.</b> Ouvrez la plateforme depuis son lien claude.ai, en étant connecté à votre compte claude.ai (pas dans un onglet séparé ni depuis un fichier enregistré).</div></div>`;
}
async function renderLogin(){
  page.innerHTML=siteHeader()+'<div class="loading">Chargement…</div>';
  let accounts=[], err=null;
  try{ accounts=await Accounts.listAccounts(); }catch(e){ err=e; }
  const first=!err&&!accounts.length;
  page.innerHTML=siteHeader()+`<div class="login">
    <h1>Plateforme d'entraînement au contourage</h1>
    ${err?`<div class="errors">Les comptes ne peuvent pas être lus : ${esc(err.message||String(err))}</div>`:first?`
    <form class="card lform" id="boot"><h2>Premier démarrage</h2>
      <div class="hint">Aucun compte n'existe encore. Créez le compte administrateur principal.</div>
      <div class="field"><label for="b-nom">Nom</label><input type="text" id="b-nom" autocomplete="family-name"></div>
      <div class="field"><label for="b-prenom">Prénom</label><input type="text" id="b-prenom" autocomplete="given-name"></div>
      <div class="field"><label for="b-mail">Adresse e-mail</label><input type="email" id="b-mail" autocomplete="email"></div>
      ${pwFields('b-')}
      <div class="pw-err" aria-live="polite"></div>
      <button class="btn primary">Créer le compte administrateur</button></form>`:`
    <form class="card lform" id="login"><h2>Connexion</h2>
      <div class="field"><label for="l-mail">Adresse e-mail</label><input type="email" id="l-mail" autocomplete="username"></div>
      <div class="field" id="l-pwf"><label for="l-pw">Mot de passe</label><input type="password" id="l-pw" autocomplete="current-password"></div>
      <div class="field" id="l-codef" hidden><label for="l-code">Code d'activation (8 chiffres)</label><input type="text" id="l-code" inputmode="numeric" autocomplete="one-time-code" maxlength="9"></div>
      <div class="hint" id="l-hint">Première connexion : saisissez votre adresse e-mail et le code d'activation à 8 chiffres transmis par l'administrateur (laissez le mot de passe vide).</div>
      <div class="pw-err" aria-live="polite"></div>
      <button class="btn primary">Se connecter</button></form>`}
    <footer class="disclaimer"><b>Avertissement :</b> cette plateforme est destinée exclusivement à la formation. Elle ne doit pas être utilisée pour la planification clinique des traitements.</footer>
  </div>`;
  const f=page.querySelector('form'); if(!f) return;
  const errEl=f.querySelector('.pw-err'), btn=f.querySelector('button');
  f.querySelector('input').focus();
  const lm=f.querySelector('#l-mail'); // autre adresse : on revient au champ mot de passe
  if(lm) lm.oninput=()=>{ f.querySelector('#l-codef').hidden=true; f.querySelector('#l-pwf').hidden=false; errEl.textContent=''; };
  f.onsubmit=async e=>{ e.preventDefault(); errEl.textContent=''; btn.disabled=true;
    try{
      if(first){ const nom=f.querySelector('#b-nom').value.trim(), prenom=f.querySelector('#b-prenom').value.trim(), email=f.querySelector('#b-mail').value.trim();
        if(!nom||!prenom||!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Renseignez le nom, le prénom et une adresse e-mail valide.');
        const pw=readPw({$:q=>f.querySelector(q)},'b-');
        await Accounts.login((await Accounts.create({nom,prenom,email,role:'admin',pw})).account); return route(); }
      const acc=await Accounts.findByEmail(f.querySelector('#l-mail').value);
      if(!acc) throw new Error('Aucun compte ne correspond à cette adresse e-mail.');
      if(acc.pw){ if(!await Accounts.checkPw(acc,f.querySelector('#l-pw').value)) throw new Error('Mot de passe incorrect.'); }
      else { // compte pas encore activé : code d'activation obligatoire
        const cf=f.querySelector('#l-codef');
        if(cf.hidden){ cf.hidden=false; f.querySelector('#l-pwf').hidden=true; f.querySelector('#l-hint').textContent='Ce compte n\'est pas encore activé : saisissez le code d\'activation à 8 chiffres transmis par l\'administrateur.'; f.querySelector('#l-code').focus(); btn.disabled=false; return; }
        if(!acc.activation||!await Accounts.checkCode(acc,f.querySelector('#l-code').value)) throw new Error('Code d\'activation incorrect.'); }
      await Accounts.login(acc); route();
    }catch(e){ errEl.textContent=e.message; btn.disabled=false; } };
}

// ---- profil ----
const yearOpts=sel=>Accounts.years().map(y=>`<option${y===sel?' selected':''}>${y}</option>`).join('');
const subOpts=sel=>Accounts.SUBDIVISIONS.map(s=>`<option${s===sel?' selected':''}>${esc(s)}</option>`).join('');
const pwFields=(p='')=>`<div class="field"><label for="${p}pw1">Mot de passe</label><input type="password" id="${p}pw1" autocomplete="new-password"></div>
  <div class="field"><label for="${p}pw2">Confirmation du mot de passe</label><input type="password" id="${p}pw2" autocomplete="new-password"></div>
  <div class="hint">Au moins 12 caractères, dont au moins un chiffre et une majuscule.</div>`;
const readPw=(m,p='')=>{ const a=m.$('#'+p+'pw1').value, b=m.$('#'+p+'pw2').value; const pb=Accounts.pwProblem(a); if(pb) throw new Error(pb); if(a!==b) throw new Error('Les deux mots de passe ne sont pas identiques.'); return a; };
// première ouverture du compte : profil à compléter, impossible à fermer sans le valider
function profileSetup(){
  const u=Accounts.me, st=u.role!=='admin', hasPw=!!u.pw;
  return new Promise(res=>{
    const m=modal(`<h2>Compléter votre profil</h2>
      <div class="kv"><span>Nom</span><b>${esc(fullName(u))}</b><span>Adresse e-mail</span><b>${esc(u.email)}</b></div>
      <div class="field"><label for="p-sub">Subdivision</label><select id="p-sub"><option value="">— Choisir —</option>${subOpts()}</select></div>
      ${st?`<div class="field"><label for="p-year">Année de début d'internat</label><select id="p-year"><option value="">— Choisir —</option>${yearOpts()}</select></div>`:''}
      ${hasPw?'':pwFields()}
      <div class="notice">Une fois validées, ces informations ne pourront plus être modifiées, en dehors du mot de passe.</div>
      <div class="pw-err" aria-live="polite"></div>
      <div class="actions"><button class="btn" data-x>Se déconnecter</button><button class="btn primary" data-ok>Valider mon profil</button></div>`);
    m.$('[data-x]').onclick=()=>{ m.close(); Accounts.logout(); go('#/'); };
    m.$('[data-ok]').onclick=async()=>{ const err=m.$('.pw-err'); err.textContent='';
      try{ const sub=m.$('#p-sub').value, year=st?+m.$('#p-year').value:null;
        if(!sub) throw new Error('Choisissez votre subdivision.'); if(st&&!year) throw new Error('Choisissez votre année de début d\'internat.');
        const pw=hasPw?null:readPw(m), a=await Accounts.refresh();
        a.profile=st?{subdivision:sub,annee:year}:{subdivision:sub}; a.profileDone=true; if(pw){ a.pw=await Accounts.hashPw(pw); a.activation=null; } if(st&&!a.semestres) a.semestres=[];
        await Accounts.save(a); m.close(); res(); }
      catch(e){ err.textContent=e.message; } };
    m.$('#p-sub').focus();
  });
}
const SEM=k=>k===1?'1er semestre':`${k}ème semestre`;
async function profileModal(){
  const u=await Accounts.refresh(), st=u.role!=='admin', sem=u.semestres||[];
  const m=modal(`<h2>Profil</h2>
    <div class="kv"><span>Nom</span><b>${esc(fullName(u))}</b><span>Adresse e-mail</span><b>${esc(u.email)}</b>
      <span>Compte</span><b>${st?'Interne':'Administrateur'}</b><span>Subdivision</span><b>${esc(u.profile?.subdivision||'—')}</b>
      ${st?`<span>Début d'internat</span><b>${esc(u.profile?.annee||'—')}</b>`:''}</div>
    ${st?`<div class="field"><span class="lab">Mes semestres</span><div class="tscroll"><table class="semtab"><thead><tr><th></th><th>Période</th><th>Spécialité</th><th>Terrain de stage</th></tr></thead><tbody>
      ${Array.from({length:10},(_,i)=>{ const s=sem[i]||{}; return `<tr><th scope="row">${SEM(i+1)}</th>${['periode','specialite','terrain'].map(f=>`<td><input type="text" data-s="${i}" data-f="${f}" value="${esc(s[f]||'')}" aria-label="${SEM(i+1)} : ${f==='periode'?'période':f==='specialite'?'spécialité':'terrain de stage'}"></td>`).join('')}</tr>`; }).join('')}
      </tbody></table></div><div><button class="btn" data-sem>Enregistrer les semestres</button> <span class="hint" data-semok></span></div></div>`:''}
    <details class="pwchange"><summary>Changer le mot de passe</summary>
      <div class="field"><label for="c-old">Mot de passe actuel</label><input type="password" id="c-old" autocomplete="current-password"></div>
      ${pwFields('c-')}<div class="pw-err" aria-live="polite"></div><div><button class="btn primary" data-pw>Changer le mot de passe</button></div></details>
    <div class="actions"><button class="btn" data-x>Fermer</button></div>`,{wide:st});
  m.$('[data-x]').onclick=m.close;
  if(st) m.$('[data-sem]').onclick=async()=>{ const a=await Accounts.refresh(), out=Array.from({length:10},()=>({periode:'',specialite:'',terrain:''}));
    m.box.querySelectorAll('[data-s]').forEach(i=>{ out[+i.dataset.s][i.dataset.f]=i.value.trim(); });
    a.semestres=out; await Accounts.save(a); m.$('[data-semok]').textContent='Semestres enregistrés.'; };
  m.$('[data-pw]').onclick=async()=>{ const err=m.$('.pwchange .pw-err'); err.textContent='';
    try{ const a=await Accounts.refresh();
      if(!await Accounts.checkPw(a,m.$('#c-old').value)) throw new Error('Mot de passe actuel incorrect.');
      await Accounts.setPassword(a,readPw(m,'c-')); m.close(); await message('Mot de passe changé','Votre nouveau mot de passe est enregistré.'); }
    catch(e){ err.textContent=e.message; } };
}

// ---- création de compte (administrateur) ----
function createAccountModal(onCreated){
  const m=modal(`<h2>Créer un compte</h2>
    <div class="field"><label for="a-nom">Nom</label><input type="text" id="a-nom"></div>
    <div class="field"><label for="a-prenom">Prénom</label><input type="text" id="a-prenom"></div>
    <div class="field"><label for="a-mail">Adresse e-mail (identifiant du compte)</label><input type="email" id="a-mail"></div>
    <fieldset class="roles"><legend>Type de compte</legend>
      <label><input type="radio" name="a-role" value="etudiant" checked> Étudiant</label>
      <label><input type="radio" name="a-role" value="admin"> Administrateur</label></fieldset>
    <div class="pw-err" aria-live="polite"></div>
    <div class="actions"><button class="btn" data-x>Annuler</button><button class="btn primary" data-ok>Créer le compte</button></div>`);
  m.$('[data-x]').onclick=m.close; m.$('#a-nom').focus();
  m.$('[data-ok]').onclick=async()=>{ const err=m.$('.pw-err'); err.textContent='';
    try{ const nom=m.$('#a-nom').value.trim(), prenom=m.$('#a-prenom').value.trim(), email=m.$('#a-mail').value.trim(), role=m.box.querySelector('[name=a-role]:checked').value;
      if(!nom||!prenom) throw new Error('Renseignez le nom et le prénom.'); if(!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Adresse e-mail invalide.');
      const {account:a,code}=await Accounts.create({nom,prenom,email,role}); m.close();
      showCode(a,code,'Compte créé'); if(onCreated) onCreated(); }
    catch(e){ err.textContent=e.message.charAt(0).toUpperCase()+e.message.slice(1)+'.'; } };
}
// code d'activation affiché une seule fois (il n'est conservé que sous forme hachée)
function showCode(a,code,title){
  const m=modal(`<h2>${esc(title)}</h2>
    <div>${esc(fullName(a))} (${a.role==='admin'?'administrateur':'étudiant'}) se connectera avec l'adresse <b>${esc(a.email)}</b> et ce code d'activation :</div>
    <div class="code" aria-label="Code d'activation">${code.slice(0,4)} ${code.slice(4)}</div>
    <div class="notice">Notez ou transmettez ce code maintenant : il ne sera plus affiché. À la première connexion, il est demandé avant de compléter le profil et de choisir le mot de passe. En cas de perte, un nouveau code peut être généré depuis le suivi des internes.</div>
    <div class="actions"><button class="btn" data-copy>Copier le code</button><button class="btn primary" data-x>Fermer</button></div>`);
  m.$('[data-x]').onclick=m.close;
  m.$('[data-copy]').onclick=async e=>{ try{ await navigator.clipboard.writeText(code); e.target.textContent='Code copié'; }catch(err){ const r=document.createRange(); r.selectNodeContents(m.$('.code')); getSelection().removeAllRanges(); getSelection().addRange(r); e.target.textContent='Code sélectionné'; } };
}
const checkAdminPw=async pw=>Accounts.checkPw(await Accounts.refresh(),pw);

// ---- statistiques d'un dossier (administrateur) ----
const pct=v=>v==null||isNaN(v)?'—':(v*100).toFixed(1).replace('.',',')+' %';
function stats(vals){ const n=vals.length; if(!n) return {n}; const s=[...vals].sort((a,b)=>a-b), mean=s.reduce((a,b)=>a+b,0)/n;
  const med=n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2, sd=n>1?Math.sqrt(s.reduce((a,v)=>a+(v-mean)**2,0)/(n-1)):null; return {n,mean,med,sd,min:s[0],max:s[n-1]}; }
async function renderStats(id){
  page.innerHTML=siteHeader()+'<div class="loading">Calcul des statistiques…</div>';
  const d=await findDossier(id), all=(await Accounts.results({dossier:id})).filter(r=>r.role==='etudiant');
  // une valeur par interne : sa dernière validation du dossier
  const last=new Map(); for(const r of all) last.set(r.account,r);
  const rs=[...last.values()], names=[]; rs.forEach(r=>r.scores.forEach(s=>{ if(!names.includes(s.name)) names.push(s.name); }));
  if(d) d.targets.forEach(t=>{ if(!names.includes(t)) names.push(t); });
  const rows=names.map(n=>({name:n,...stats(rs.map(r=>r.scores.find(s=>s.name===n)?.dice).filter(v=>v!=null))}));
  page.innerHTML=siteHeader()+`<div class="hist">
    <header class="vtop"><a class="btn" href="#/">← Menu</a>
      <div class="vtitle"><h1>Statistiques du Dice</h1><span class="meta">${esc(d?.category||'')}${d?' · ':''}${esc(d?.title||'Dossier supprimé')}</span></div>
      <span class="grow"></span>${rs.length?'<button class="btn primary" id="st-pdf">Exporter en PDF</button>':''}</header>
    <section class="card"><h2>Par structure</h2>
      <div class="hint">${rs.length} interne${rs.length>1?'s':''} ${rs.length>1?'ont':'a'} validé ce dossier (${all.length} validation${all.length>1?'s':''} au total). Pour chaque interne, seule sa dernière validation est comptée.</div>
      ${rs.length?`<div class="tscroll"><table class="htab"><thead><tr><th>Structure</th><th>Internes</th><th>Moyenne</th><th>Médiane</th><th>Écart type</th><th>Minimum</th><th>Maximum</th></tr></thead>
      <tbody>${rows.map(r=>`<tr><td>${esc(r.name)}</td><td>${r.n}</td><td class="${r.mean>=.8?'good':''}">${pct(r.mean)}</td><td>${pct(r.med)}</td><td>${r.sd==null?'—':pct(r.sd)}</td><td>${pct(r.min)}</td><td>${pct(r.max)}</td></tr>`).join('')}</tbody></table></div>
      <div class="hint">Écart type calculé sur l'échantillon (n − 1) ; il faut au moins deux internes. En vert : moyenne ≥ 80 %.</div>`:'<div class="hint">Aucun interne n\'a encore validé ce dossier.</div>'}
    </section></div>`;
  const bp=page.querySelector('#st-pdf');
  if(bp) bp.onclick=async()=>{ bp.disabled=true; const t=bp.textContent; bp.textContent='Préparation…';
    try{ await DiceHistory.exportStatsPdf(d||{title:'Dossier supprimé',category:''},rows,
      `${rs.length} interne${rs.length>1?'s':''} ${rs.length>1?'ont':'a'} validé ce dossier (${all.length} validation${all.length>1?'s':''} au total). Pour chaque interne, seule sa dernière validation est comptée.`); }
    catch(e){ if(e&&e.code!=='declined') await message('Export PDF impossible',e.message||String(e)); }
    finally{ bp.disabled=false; bp.textContent=t; } };
}

// ---- suivi des internes (administrateur) ----
async function renderSuivi(sel){
  page.innerHTML=siteHeader()+'<div class="loading">Chargement des comptes…</div>';
  const st=(await Accounts.listAccounts()).filter(a=>a.role==='etudiant').sort(Accounts.byName);
  const yrs=[...new Set(st.map(a=>a.profile?.annee).filter(Boolean))].sort((a,b)=>b-a);
  page.innerHTML=siteHeader()+`<div class="hist">
    <header class="vtop"><a class="btn" href="#/">← Menu</a><div class="vtitle"><h1>Suivi des internes</h1><span class="meta">${st.length} compte${st.length>1?'s':''} interne${st.length>1?'s':''}</span></div></header>
    <section class="card filters">
      <div class="field"><label for="s-sub">Subdivision</label><select id="s-sub"><option value="">Toutes</option>${subOpts()}</select></div>
      <div class="field"><label for="s-year">Année de début d'internat</label><select id="s-year"><option value="">Toutes</option>${yrs.map(y=>`<option>${y}</option>`).join('')}</select></div>
      <div class="field wide"><label for="s-who">Interne</label><select id="s-who"></select></div>
    </section>
    <div id="s-detail"></div></div>`;
  const who=page.querySelector('#s-who'), fs=page.querySelector('#s-sub'), fy=page.querySelector('#s-year');
  const fill=()=>{ const l=st.filter(a=>(!fs.value||a.profile?.subdivision===fs.value)&&(!fy.value||String(a.profile?.annee)===fy.value)), cur=who.value;
    who.innerHTML=`<option value="">— ${l.length} interne${l.length>1?'s':''} —</option>`+l.map(a=>`<option value="${a.id}">${esc((a.nom||'').toUpperCase())} ${esc(a.prenom||'')} — ${esc(a.profile?.subdivision||'profil non complété')}${a.profile?.annee?' — '+a.profile.annee:''}</option>`).join('');
    if(l.some(a=>a.id===cur)) who.value=cur; };
  fs.onchange=fy.onchange=()=>{ fill(); showIntern(st.find(a=>a.id===who.value)); };
  who.onchange=()=>showIntern(st.find(a=>a.id===who.value));
  fill(); if(sel&&st.some(a=>a.id===sel)){ who.value=sel; showIntern(st.find(a=>a.id===sel)); }
}
async function showIntern(a){
  const box=page.querySelector('#s-detail'); if(!a){ box.innerHTML=''; return; }
  box.innerHTML='<div class="loading">Chargement…</div>';
  const [res,{list}]=await Promise.all([Accounts.results({account:a.id}),loadAll()]);
  const sem=a.semestres||[], byD=new Map(); res.forEach(r=>{ if(!byD.has(r.dossier)) byD.set(r.dossier,[]); byD.get(r.dossier).push(r); });
  const ds=[...byD.keys()].map(id=>{ const d=list.find(x=>x.id===id), r=byD.get(id)[0]; return d||{id,title:(r.title||'Dossier')+' (supprimé)',category:r.category||'Autre',targets:[]}; });
  const cats=[...CATEGORIES,...new Set(ds.map(d=>d.category).filter(c=>!CATEGORIES.includes(c)))].filter(c=>ds.some(d=>d.category===c));
  box.innerHTML=`<section class="card"><h2>Profil</h2>
      <div class="kv"><span>Nom</span><b>${esc((a.nom||'').toUpperCase())} ${esc(a.prenom||'')}</b><span>Adresse e-mail</span><b>${esc(a.email)}</b>
        <span>Subdivision</span><b>${esc(a.profile?.subdivision||'profil non complété')}</b><span>Début d'internat</span><b>${esc(a.profile?.annee||'—')}</b>
        <span>Compte créé le</span><b>${new Date(a.created).toLocaleDateString('fr-FR')}</b><span>Activation</span><b>${a.pw?'compte activé':'en attente (code non encore utilisé)'}</b></div>
      <div class="tools"><button class="btn primary" data-ipdf>Exporter le suivi en PDF</button>${a.pw?'':'<button class="btn" data-code>Nouveau code d\'activation</button>'}<button class="btn" data-reset>Réinitialiser le mot de passe</button><button class="btn danger" data-delete>Supprimer le compte</button></div></section>
    <section class="card"><h2>Semestres</h2><div class="tscroll"><table class="htab semro"><thead><tr><th></th><th>Période</th><th>Spécialité</th><th>Terrain de stage</th></tr></thead><tbody>
      ${Array.from({length:10},(_,i)=>{ const s=sem[i]||{}; return `<tr><th scope="row">${SEM(i+1)}</th><td>${esc(s.periode||'')}</td><td>${esc(s.specialite||'')}</td><td>${esc(s.terrain||'')}</td></tr>`; }).join('')}</tbody></table></div></section>
    <section class="card"><h2>Historique des scores par dossier</h2>
      ${cats.length?cats.map(c=>{ const l=ds.filter(d=>d.category===c).sort((x,y)=>x.title.localeCompare(y.title,'fr'));
        return `<details class="cgroup"><summary>${esc(c)} <span class="n">${l.length} dossier${l.length>1?'s':''}</span></summary>${l.map(d=>`<details class="dsheet" data-d="${esc(d.id)}"><summary>${esc(d.title)} <span class="n">${byD.get(d.id).length} validation${byD.get(d.id).length>1?'s':''}</span></summary><div class="dbody"></div></details>`).join('')}</details>`; }).join('')
      :'<div class="hint">Cet interne n\'a encore validé aucun dossier.</div>'}</section>`;
  box.querySelectorAll('.dsheet').forEach(el=>el.addEventListener('toggle',()=>{ if(!el.open||el.dataset.done) return; el.dataset.done=1;
    const d=ds.find(x=>x.id===el.dataset.d); DiceHistory.render(el.querySelector('.dbody'),d,byD.get(d.id).sort((x,y)=>x.date.localeCompare(y.date)),{embedded:true,who:`${a.prenom} ${(a.nom||'').toUpperCase()}`}); }));
  const bp=box.querySelector('[data-ipdf]');
  bp.onclick=async()=>{ bp.disabled=true; const t=bp.textContent; bp.textContent='Préparation…';
    try{ const groups=cats.map(c=>({category:c,dossiers:ds.filter(d=>d.category===c).sort((x,y)=>x.title.localeCompare(y.title,'fr'))
        .map(d=>({d,results:byD.get(d.id).slice().sort((x,y)=>x.date.localeCompare(y.date))}))}));
      await DiceHistory.exportInternPdf(a,sem,groups); }
    catch(e){ if(e&&e.code!=='declined') await message('Export PDF impossible',e.message||String(e)); }
    finally{ bp.disabled=false; bp.textContent=t; } };
  bindAccountActions(box,a,()=>renderSuivi());
}

// actions sur un compte (interne ou administrateur), toutes soumises au mot de passe de l'administrateur connecté
function bindAccountActions(box,a,onDeleted){
  const bc=box.querySelector('[data-code]');
  if(bc) bc.onclick=async()=>{ if(!await askPassword('Nouveau code d\'activation pour '+fullName(a),checkAdminPw,'Confirmez avec votre mot de passe administrateur. L\'ancien code ne fonctionnera plus.')) return;
    const acc=await Accounts.backend.getAccount(a.id); showCode(acc,await Accounts.newActivation(acc),'Nouveau code d\'activation'); };
  const br=box.querySelector('[data-reset]');
  if(br) br.onclick=async()=>{
    if(!await askPassword('Réinitialiser le mot de passe de '+fullName(a),checkAdminPw,'Confirmez avec votre mot de passe administrateur.')) return;
    const m=modal(`<h2>Nouveau mot de passe pour ${esc(fullName(a))}</h2>${pwFields('r-')}<div class="pw-err" aria-live="polite"></div>
      <div class="actions"><button class="btn" data-x>Annuler</button><button class="btn primary" data-ok>Enregistrer</button></div>`);
    m.$('[data-x]').onclick=m.close; m.$('#r-pw1').focus();
    m.$('[data-ok]').onclick=async()=>{ try{ const acc=await Accounts.backend.getAccount(a.id); await Accounts.setPassword(acc,readPw(m,'r-')); m.close();
        await message('Mot de passe réinitialisé',`Communiquez le nouveau mot de passe à ${fullName(a)} ; il pourra le changer depuis son profil.`); }
      catch(e){ m.$('.pw-err').textContent=e.message; } }; };
  const bd=box.querySelector('[data-delete]');
  if(bd) bd.onclick=async()=>{
    if(a.role==='admin'){ // garde-fous : pas de suppression de son propre compte ni du dernier administrateur
      if(a.id===Accounts.me.id) return message('Suppression impossible','Vous ne pouvez pas supprimer votre propre compte. Un autre administrateur peut le faire.');
      const admins=(await Accounts.listAccounts()).filter(x=>x.role==='admin'&&x.id!==a.id&&x.pw);
      if(!admins.length) return message('Suppression impossible','Il doit rester au moins un autre administrateur activé.'); }
    const m=modal(`<h2>Supprimer le compte de ${esc(fullName(a))}</h2>
      <div class="errors"><b>Attention, cette action est irréversible, toutes les données liées au compte sont perdues.</b></div>
      <div class="field"><label for="d-pw">Votre mot de passe administrateur</label><input type="password" id="d-pw" autocomplete="current-password"></div>
      <div class="pw-err" aria-live="polite"></div>
      <div class="actions"><button class="btn" data-x>Annuler</button><button class="btn danger" data-ok>Supprimer définitivement</button></div>`);
    m.$('[data-x]').onclick=m.close; m.$('#d-pw').focus();
    m.$('[data-ok]').onclick=async()=>{ const err=m.$('.pw-err'); err.textContent='';
      if(!await checkAdminPw(m.$('#d-pw').value)){ err.textContent='Mot de passe incorrect.'; return; }
      try{ await Accounts.remove(a); m.close(); await message('Compte supprimé',`Le compte de ${fullName(a)} et ses résultats ont été supprimés.`); onDeleted(); }
      catch(e){ err.textContent='Suppression impossible : '+e.message; } }; };
}

// ---- comptes administrateurs ----
async function renderAdmins(){
  page.innerHTML=siteHeader()+'<div class="loading">Chargement des comptes…</div>';
  const ad=(await Accounts.listAccounts()).filter(a=>a.role==='admin').sort(Accounts.byName), me=Accounts.me;
  page.innerHTML=siteHeader()+`<div class="hist">
    <header class="vtop"><a class="btn" href="#/">← Menu</a><div class="vtitle"><h1>Comptes administrateurs</h1><span class="meta">${ad.length} compte${ad.length>1?'s':''}</span></div>
      <span class="grow"></span><button class="btn primary" data-a="account">Créer un compte</button></header>
    <section class="card"><div class="tscroll"><table class="htab admtab"><thead><tr><th>Nom</th><th>Adresse e-mail</th><th>Subdivision</th><th>Activation</th><th>Créé le</th><th></th></tr></thead><tbody>
      ${ad.map(a=>`<tr data-id="${a.id}"><td>${esc((a.nom||'').toUpperCase())} ${esc(a.prenom||'')}${a.id===me.id?' <span class="tag me">vous</span>':''}</td><td>${esc(a.email)}</td>
        <td>${esc(a.profile?.subdivision||'—')}</td><td>${a.pw?'activé':'en attente'}</td><td>${new Date(a.created).toLocaleDateString('fr-FR')}</td>
        <td><div class="acts">${a.pw?'':'<button class="btn" data-code>Nouveau code</button>'}${a.id===me.id?'':'<button class="btn" data-reset>Réinitialiser le mot de passe</button><button class="btn danger" data-delete>Supprimer</button>'}</div></td></tr>`).join('')}
    </tbody></table></div>
    <div class="hint">Vous ne pouvez pas supprimer votre propre compte ; il doit toujours rester au moins un autre administrateur activé. Votre mot de passe se change depuis « Profil ».</div></section></div>`;
  page.querySelectorAll('.admtab tr[data-id]').forEach(tr=>bindAccountActions(tr,ad.find(a=>a.id===tr.dataset.id),()=>renderAdmins()));
  page.querySelector('[data-a="account"]').onclick=()=>createAccountModal(()=>renderAdmins());
}

// ---- navigation ----
async function route(){
  await sharedP;
  if(current){ current.destroy(); current=null; }
  modalRoot.innerHTML='';
  const [r,arg]=path.split('/');
  document.body.classList.toggle('light',r!=='contourage'); // pages sur fond blanc, visionneuse en console sombre
  const id=arg&&decodeURIComponent(arg);
  window.scrollTo(0,0);
  if(ARTIFACT&&!shared) return renderNoStorage();
  const me=Accounts.me;
  if(!me) return renderLogin();
  if(!me.profileDone){ page.innerHTML=siteHeader(); await profileSetup(); }
  if(r==='contourage'&&id) return renderViewer(id);
  if(r==='historique'&&id){ const d=await findDossier(id); const res=await Accounts.results({account:me.id,dossier:id}).catch(()=>[]);
    page.innerHTML=siteHeader()+'<div id="hroot"></div>';
    return DiceHistory.render(page.querySelector('#hroot'),d||{id,title:'Dossier supprimé',category:'',targets:[]},res); }
  if(r==='stats'&&id&&isAdmin()) return renderStats(id);
  if(r==='suivi'&&isAdmin()) return renderSuivi();
  if(r==='admins'&&isAdmin()) return renderAdmins();
  if(r) { path=''; try{ history.replaceState(null,'','#/'); }catch(e){} }
  return renderHome();
}
window.addEventListener('hashchange',()=>{ const h=location.hash.replace(/^#\/?/,''); if(h!==path){ path=h; route(); } });
window.addEventListener('beforeunload',()=>{ if(current) current.destroy(); });
route();
})();

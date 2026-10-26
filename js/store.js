// Stockage local (IndexedDB) : dossiers chargés depuis ce navigateur, fichiers, contours en cours, résultats Dice.
// Les dossiers publiés pour tous sont décrits dans dossiers/catalogue.json (voir README).
(function(){
const DB_NAME='plateforme-contourage', STORES=['dossiers','files','drafts','results'];
let dbp=null;
function open(){
  if(dbp) return dbp;
  dbp=new Promise((res,rej)=>{
    if(!window.indexedDB) return rej(new Error('stockage local indisponible dans ce navigateur'));
    const rq=indexedDB.open(DB_NAME,1);
    rq.onupgradeneeded=()=>{ const db=rq.result; for(const s of STORES) if(!db.objectStoreNames.contains(s)) db.createObjectStore(s); };
    rq.onsuccess=()=>res(rq.result); rq.onerror=()=>rej(rq.error||new Error('stockage local indisponible'));
  });
  dbp.catch(()=>{dbp=null;});
  return dbp;
}
async function tx(store,mode,fn){
  const db=await open();
  return new Promise((res,rej)=>{ const t=db.transaction(store,mode), s=t.objectStore(store); let out;
    const r=fn(s); if(r) r.onsuccess=()=>{out=r.result;};
    t.oncomplete=()=>res(out); t.onerror=()=>rej(t.error); t.onabort=()=>rej(t.error||new Error('écriture interrompue (espace de stockage plein ?)')); });
}
const get=(st,k)=>tx(st,'readonly',s=>s.get(k));
const put=(st,k,v)=>tx(st,'readwrite',s=>s.put(v,k));
const del=(st,k)=>tx(st,'readwrite',s=>s.delete(k));
const all=st=>tx(st,'readonly',s=>s.getAll());

async function sha256(txt){
  if(window.crypto&&crypto.subtle){ const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(txt));
    return [...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,'0')).join(''); }
  return 'clair:'+txt; // contexte non sécurisé (http hors localhost)
}

window.Store={
  listLocal:()=>all('dossiers'),
  getDossier:id=>get('dossiers',id),
  async addDossier(d,files){ await put('files',d.id,files); try{ await put('dossiers',d.id,d); }catch(e){ await del('files',d.id).catch(()=>{}); throw e; } },
  async removeDossier(id){ await del('dossiers',id); await del('files',id); await del('drafts',id); },
  getFiles:id=>get('files',id),
  getDraft:id=>get('drafts',id),
  putDraft:(id,v)=>put('drafts',id,v),
  delDraft:id=>del('drafts',id),
  async getResults(id){ return (await get('results',id))||[]; },
  async addResult(id,r){ const l=(await get('results',id))||[]; l.push(r); await put('results',id,l); return l; },
  sha256,
};
})();

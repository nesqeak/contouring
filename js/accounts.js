// Comptes (étudiant / administrateur), résultats Dice par compte et session.
// Le stockage est interchangeable : base partagée de l'Artifact quand elle est disponible, sinon base du
// navigateur (version statique). Un futur serveur (Supabase, serveur des HCL) n'aura qu'à fournir les mêmes
// méthodes que sharedBackend / localBackend.
(function(){
const SUBDIVISIONS=['Clermont-Ferrand','Grenoble','Lyon','Saint-Etienne'];
const FIRST_YEAR=2000;
const years=()=>{ const y=new Date().getFullYear(), l=[]; for(let k=y;k>=FIRST_YEAR;k--) l.push(k); return l; };
const rid=p=>p+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
const normEmail=e=>String(e||'').trim().toLowerCase();

// ---- mots de passe : PBKDF2-SHA-256, sel aléatoire ----
const ITER=150000;
const hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
const unhex=h=>new Uint8Array(h.match(/../g).map(x=>parseInt(x,16)));
async function hashPw(pw,salt,iter=ITER){
  if(!(window.crypto&&crypto.subtle)) throw new Error('ce navigateur ne permet pas le chiffrement des mots de passe (page non sécurisée)');
  salt=salt||hex(crypto.getRandomValues(new Uint8Array(16)));
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(pw),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:unhex(salt),iterations:iter},key,256);
  return {salt,hash:hex(bits),iter};
}
async function checkPw(acc,pw){ if(!acc||!acc.pw||!pw) return false; return (await hashPw(pw,acc.pw.salt,acc.pw.iter)).hash===acc.pw.hash; }
// règle : au moins 12 caractères, dont au moins un chiffre
const pwProblem=pw=>!pw||pw.length<12?'Le mot de passe doit contenir au moins 12 caractères.':!/\d/.test(pw)?'Le mot de passe doit contenir au moins un chiffre.':null;

// ---- stockage ----
function sharedBackend(db){
  const C=db.collection('comptes'), R=db.collection('resultats');
  const list=async q=>(await q.get()).docs.map(d=>({...d.data(),id:d.id}));
  return {
    kind:'shared',
    listAccounts:()=>list(C),
    getAccount:async id=>{ const s=await C.doc(id).get(); return s.exists?{...s.data(),id}:null; },
    putAccount:a=>{ const {id,...data}=a; return C.doc(id).set(data); },
    deleteAccount:id=>C.doc(id).delete(),
    listResults:async({account,dossier}={})=>{ let q=R; if(account) q=q.where('account','==',account); if(dossier) q=q.where('dossier','==',dossier); return list(q); },
    addResult:r=>{ const {id,...data}=r; return R.doc(id).set(data); },
    deleteResult:id=>R.doc(id).delete(),
  };
}
function localBackend(){
  return {
    kind:'local',
    listAccounts:()=>Store.kv.all('comptes'),
    getAccount:async id=>(await Store.kv.get('comptes',id))||null,
    putAccount:a=>Store.kv.put('comptes',a.id,a),
    deleteAccount:id=>Store.kv.del('comptes',id),
    listResults:async({account,dossier}={})=>(await Store.kv.all('resultats')).filter(r=>(!account||r.account===account)&&(!dossier||r.dossier===dossier)),
    addResult:r=>Store.kv.put('resultats',r.id,r),
    deleteResult:id=>Store.kv.del('resultats',id),
  };
}

let B=null, me=null;
const SKEY='plateforme-contourage:session';
const ss={ get:()=>{ try{ return sessionStorage.getItem(SKEY); }catch(e){ return null; } },
  set:v=>{ try{ v?sessionStorage.setItem(SKEY,v):sessionStorage.removeItem(SKEY); }catch(e){} } };
const byName=(a,b)=>(a.nom||'').localeCompare(b.nom||'','fr',{sensitivity:'base'})||(a.prenom||'').localeCompare(b.prenom||'','fr',{sensitivity:'base'});

window.Accounts={
  SUBDIVISIONS, years, pwProblem, checkPw, hashPw, normEmail, byName,
  init(sharedDb){ B=sharedDb?sharedBackend(sharedDb):localBackend(); return B; },
  get backend(){ return B; },
  get me(){ return me; },
  // reprend la session de l'onglet (le compte est relu : il peut avoir été modifié ou supprimé)
  async restore(){ const id=ss.get(); if(!id) return null; me=await B.getAccount(id).catch(()=>null); if(!me) ss.set(null); return me; },
  async refresh(){ if(me) me=await B.getAccount(me.id); return me; },
  async findByEmail(email){ const e=normEmail(email); return (await B.listAccounts()).find(a=>a.email===e)||null; },
  async login(acc){ me=acc; ss.set(acc.id); },
  logout(){ me=null; ss.set(null); },
  async create({nom,prenom,email,role}){
    const e=normEmail(email);
    if(await this.findByEmail(e)) throw new Error('un compte existe déjà avec cette adresse e-mail');
    const a={id:rid('u-'),nom:nom.trim(),prenom:prenom.trim(),email:e,role,created:new Date().toISOString(),pw:null,profileDone:false,profile:null,semestres:[]};
    await B.putAccount(a); return a;
  },
  async save(a){ await B.putAccount(a); if(me&&me.id===a.id) me=a; return a; },
  async setPassword(a,pw){ a.pw=await hashPw(pw); return this.save(a); },
  async remove(a){ for(const r of await B.listResults({account:a.id})) await B.deleteResult(r.id); await B.deleteAccount(a.id); },
  results:(q)=>B.listResults(q).then(l=>l.sort((x,y)=>x.date.localeCompare(y.date))),
  addResult:(r)=>B.addResult({id:rid('r-'),...r}),
  listAccounts:()=>B.listAccounts(),
};
})();

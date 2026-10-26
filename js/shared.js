// Stockage partagé quand la plateforme est publiée comme Artifact claude.ai : les dossiers sont des
// documents de la base partagée (collection « dossiers »), leurs fichiers des assets de l'Artifact.
// Les assets n'acceptent pas le DICOM : au chargement, le scanner est converti en PNG 16 bits en niveaux
// de gris (HU + 1024, sans perte, plusieurs coupes empilées par image) et les structures en JSON
// (contours en coordonnées voxel).
(function(){
const OFF=1024, MAX_RAW=18*1048576; // octets bruts par PNG : reste sous la limite de 20 Mio par asset

// ---- PNG 16 bits niveaux de gris ----
const CRC=(()=>{const t=new Uint32Array(256); for(let n=0;n<256;n++){let c=n; for(let k=0;k<8;k++) c=c&1?0xEDB88320^(c>>>1):c>>>1; t[n]=c>>>0;} return t;})();
function crc(bytes){let c=0xFFFFFFFF; for(let i=0;i<bytes.length;i++) c=CRC[(c^bytes[i])&255]^(c>>>8); return (c^0xFFFFFFFF)>>>0;}
function chunk(type,data){
  const b=new Uint8Array(12+data.length), dv=new DataView(b.buffer);
  dv.setUint32(0,data.length); for(let i=0;i<4;i++) b[4+i]=type.charCodeAt(i); b.set(data,8);
  dv.setUint32(8+data.length,crc(b.subarray(4,8+data.length))); return b;}
const pipe=async(bytes,stream)=>new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

// vol : Int16Array des HU (PNG 16 bits) ou Uint8Array d'une fusion (PNG 8 bits), coupes z0..z0+nz-1 empilées verticalement
async function encodePNG(vol,NX,NY,z0,nz){
  const b8=vol instanceof Uint8Array, H=NY*nz, rowB=NX*(b8?1:2), raw=new Uint8Array(H*(rowB+1));
  for(let r=0;r<H;r++){ const o=r*(rowB+1), src=(z0*NY+r)*NX; raw[o]=1; // filtre « Sub »
    if(b8){ let pv=0; for(let x=0;x<NX;x++){ const v=vol[src+x]; raw[o+1+x]=(v-pv)&255; pv=v; } continue; }
    let ph=0,pl=0;
    for(let x=0;x<NX;x++){ const v=vol[src+x]+OFF, h=v>>8, l=v&255; raw[o+1+2*x]=(h-ph)&255; raw[o+2+2*x]=(l-pl)&255; ph=h; pl=l; } }
  const ih=new Uint8Array(13), dv=new DataView(ih.buffer); dv.setUint32(0,NX); dv.setUint32(4,H); ih[8]=b8?8:16; ih[9]=0;
  const idat=await pipe(raw,new CompressionStream('deflate'));
  return new Blob([new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',idat),chunk('IEND',new Uint8Array(0))],{type:'image/png'});
}
async function decodePNG(buf,vol,NX,NY,z0){
  const u8=new Uint8Array(buf), dv=new DataView(buf); let o=8, W=0, H=0, bd=16; const parts=[];
  while(o<u8.length){ const len=dv.getUint32(o), type=String.fromCharCode(...u8.subarray(o+4,o+8));
    if(type==='IHDR'){ W=dv.getUint32(o+8); H=dv.getUint32(o+12); bd=u8[o+16]; if((bd!==16&&bd!==8)||u8[o+17]!==0) throw new Error('image de volume inattendue'); }
    else if(type==='IDAT') parts.push(u8.subarray(o+8,o+8+len)); else if(type==='IEND') break;
    o+=12+len; }
  if(W!==NX) throw new Error('image de volume incohérente');
  const cat=new Uint8Array(parts.reduce((a,p)=>a+p.length,0)); let k=0; for(const p of parts){cat.set(p,k);k+=p.length;}
  const bpp=bd/8, raw=await pipe(cat,new DecompressionStream('deflate')), rowB=W*bpp, prev=new Uint8Array(rowB), cur=new Uint8Array(rowB);
  for(let r=0;r<H;r++){ const f=raw[r*(rowB+1)], s=r*(rowB+1)+1;
    for(let i=0;i<rowB;i++){ const a=i>=bpp?cur[i-bpp]:0, b=prev[i], c=i>=bpp?prev[i-bpp]:0, x=raw[s+i]; let v;
      if(f===0) v=x; else if(f===1) v=x+a; else if(f===2) v=x+b; else if(f===3) v=x+((a+b)>>1);
      else { const p=a+b-c, pa=Math.abs(p-a), pb=Math.abs(p-b), pc=Math.abs(p-c); v=x+(pa<=pb&&pa<=pc?a:pb<=pc?b:c); }
      cur[i]=v&255; }
    const d=(z0*NY+r)*NX;
    if(bpp===1) vol.set(cur,d); else for(let x=0;x<W;x++) vol[d+x]=((cur[2*x]<<8)|cur[2*x+1])-OFF;
    prev.set(cur); }
}

// contours RTSTRUCT convertis en coordonnées voxel (x, y continus ; z = indice de coupe)
function roisToVoxel(rois,V){
  return rois.map(r=>({name:r.name,color:r.color,contours:r.contours.map(d=>{
    const n=d.length/3, out=[]; let z=null, far=0;
    for(let p=0;p<n;p++){ const [i,j,zz,dist]=V.toIndex([d[3*p],d[3*p+1],d[3*p+2]]); if(z===null) z=zz; far=Math.max(far,dist); out.push(+i.toFixed(2),+j.toFixed(2),z); }
    return far>V.spacing[2]*0.6?null:out; }).filter(Boolean)}));
}

async function init(){
  if(!(window.claude&&typeof claude.use==='function')) return null;
  const db=await claude.use('db'); if(!db) return null;
  const assets=await claude.use('assets').catch(()=>null);
  const col=db.collection('dossiers');
  const fetchBuf=async id=>{ const r=await fetch('/_blob/'+id); if(!r.ok) throw new Error('fichier du dossier inaccessible ('+r.status+')'); return r.arrayBuffer(); };
  const up=async(blob,type)=>(await assets.upload(blob,type?{type}:undefined)).id;
  const errMsg=e=>({quota_or_state:'espace de stockage de la plateforme plein',too_large:'fichier trop volumineux (20 Mio maximum)',rate_limited:'trop de requêtes, réessayer dans un instant',not_granted:'chargement réservé aux éditeurs de la plateforme'}[e&&e.code]||(e&&e.message)||'erreur inconnue');
  return {
    canUpload:!!assets,
    errMsg,
    async list(){ const s=await col.get(); return s.docs.map(d=>({...d.data(),id:d.id,source:'shared'})); },
    onChange(fn){ return col.onSnapshot(()=>fn(),()=>{}); },
    pdfUrl:d=>d.pdf?'/_blob/'+d.pdf:null,
    // d : métadonnées ; V : volume construit ; rois : RTSTRUCT lu ; pdf : File
    // fusions : [{name, modality, data: Uint8Array sur la grille du scanner}]
    async add(d,V,rois,pdf,progress,fusions=[]){
      const {NX,NY,NZ,vol}=V, per=Math.max(1,Math.floor(MAX_RAW/(NY*(NX*2+1)))), per8=Math.max(1,Math.floor(MAX_RAW/(NY*(NX+1)))), ids=[];
      const steps=Math.ceil(NZ/per)+fusions.length*Math.ceil(NZ/per8)+2; let done=0; const tick=()=>progress(++done/steps);
      const pngs=async(data,p)=>{ const out=[]; for(let z0=0;z0<NZ;z0+=p){ const nz=Math.min(p,NZ-z0), id=await up(await encodePNG(data,NX,NY,z0,nz)); ids.push(id); out.push({id,z0,nz}); tick(); } return out; };
      try{
        const chunks=await pngs(vol,per), fus=[];
        for(const f of fusions) fus.push({name:f.name,modality:f.modality,vol:await pngs(f.data,per8)});
        const sid=await up(new Blob([JSON.stringify({version:1,rois:roisToVoxel(rois,V)})],{type:'application/json'}),'application/json'); ids.push(sid); tick();
        const pid=await up(pdf,'application/pdf'); ids.push(pid); tick();
        await col.doc(d.id).set({...d,dims:[NX,NY,NZ],spacing:V.spacing,vol:chunks,structs:sid,pdf:pid,fusions:fus});
      }catch(e){ for(const id of ids) assets.delete(id).catch(()=>{}); throw new Error(errMsg(e)); }
    },
    async remove(d){ await col.doc(d.id).delete(); if(assets) for(const id of [...(d.vol||[]).map(c=>c.id),...(d.fusions||[]).flatMap(f=>f.vol.map(c=>c.id)),d.structs,d.pdf]) if(id) await assets.delete(id).catch(()=>{}); },
    async load(d,progress){
      const [NX,NY,NZ]=d.dims, vol=new Int16Array(NX*NY*NZ); let n=0;
      await Promise.all(d.vol.map(async c=>{ await decodePNG(await fetchBuf(c.id),vol,NX,NY,c.z0); progress(++n/(d.vol.length+1)); }));
      const s=JSON.parse(new TextDecoder().decode(await fetchBuf(d.structs)));
      const V={NX,NY,NZ,spacing:d.spacing,vol,toIndex:P=>[P[0],P[1],P[2],0]};
      const fusions=(d.fusions||[]).map(f=>({name:f.name,modality:f.modality,load:async()=>{ const u=new Uint8Array(NX*NY*NZ);
        await Promise.all(f.vol.map(async c=>decodePNG(await fetchBuf(c.id),u,NX,NY,c.z0))); return u; }}));
      return {V,rois:s.rois.map(r=>({...r,contours:r.contours.map(c=>Float64Array.from(c))})),fusions};
    },
  };
}
window.Shared={init,encodePNG,decodePNG,roisToVoxel};
})();

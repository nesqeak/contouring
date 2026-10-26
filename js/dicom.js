// Lecture DICOM minimale : images CT non compressées et RTSTRUCT.
// Syntaxes de transfert prises en charge : Implicit VR Little Endian, Explicit VR Little Endian.
(function(){
const UNDEF=0xFFFFFFFF;
const LONG=new Set(['OB','OW','OF','OD','OL','OV','SQ','UT','UN','UC','UR','SV','UV']);
const T={
  charset:0x00080005, modality:0x00080060, sopClass:0x00080016, series:0x0020000E, frameRef:0x00200052,
  ipp:0x00200032, iop:0x00200037, rows:0x00280010, cols:0x00280011, ps:0x00280030,
  bits:0x00280100, pixRep:0x00280103, slope:0x00281053, inter:0x00281052, spp:0x00280002, pixel:0x7FE00010,
  roiSeq:0x30060020, roiNum:0x30060022, roiName:0x30060026,
  contourSeqTop:0x30060039, refRoi:0x30060084, color:0x3006002A, contourSeq:0x30060040, geom:0x30060042, data:0x30060050,
  obsSeq:0x30060080, interpType:0x300600A4,
};
// séquences connues, utiles en Implicit VR (pas de VR dans le flux)
const SQ_TAGS=new Set([T.roiSeq,T.contourSeqTop,T.contourSeq,T.obsSeq,0x30060010,0x30060012,0x30060014,0x30060016,0x00081115,0x00081140,0x00081250]);
const TS_OK={'1.2.840.10008.1.2':false,'1.2.840.10008.1.2.1':true}; // valeur : VR explicite

function parse(buf){
  const u8=new Uint8Array(buf), dv=new DataView(buf);
  const tagAt=o=>((dv.getUint16(o,true)<<16)|dv.getUint16(o+2,true))>>>0;
  let off=0, ts='1.2.840.10008.1.2', meta=new Map();
  if(u8.length>=132&&u8[128]===68&&u8[129]===73&&u8[130]===67&&u8[131]===77){ // « DICM »
    off=132;
    while(off+8<=u8.length&&dv.getUint16(off,true)===0x0002){
      const vr=String.fromCharCode(u8[off+4],u8[off+5]); let len,h;
      if(LONG.has(vr)){len=dv.getUint32(off+8,true);h=12;}else{len=dv.getUint16(off+6,true);h=8;}
      meta.set(tagAt(off),{vr,off:off+h,len}); off+=h+len;
    }
    const e=meta.get(0x00020010);
    if(e) ts=latin1(u8.subarray(e.off,e.off+e.len)).replace(/[\0 ]+$/,'');
  } else if(!(u8.length>8&&dv.getUint16(0,true)===0x0008)) throw new Error('fichier non DICOM');
  if(!(ts in TS_OK)){
    const err=new Error(ts==='1.2.840.10008.1.2.2'?'syntaxe Big Endian non prise en charge':'images compressées (syntaxe '+ts+') non prises en charge : exporter en DICOM non compressé');
    err.code='ts'; throw err; }
  const explicit=TS_OK[ts];
  const isItem=o=>o+4<=u8.length&&tagAt(o)===0xFFFEE000;

  function readDS(o,end){
    const ds=new Map();
    while(o+8<=end){
      const g=dv.getUint16(o,true), tag=tagAt(o);
      if(tag===0xFFFEE00D) return [ds,o+8]; // fin d'item
      let vr=null,len,h;
      if(explicit&&g!==0xFFFE){ vr=String.fromCharCode(u8[o+4],u8[o+5]);
        if(LONG.has(vr)){len=dv.getUint32(o+8,true);h=12;}else{len=dv.getUint16(o+6,true);h=8;} }
      else { len=dv.getUint32(o+4,true); h=8; }
      o+=h; const el={vr,off:o,len};
      if(tag===T.pixel){ if(len===UNDEF){el.encapsulated=true; o=skipUndef(o);} else o+=len; ds.set(tag,el); continue; }
      if(vr==='SQ'||len===UNDEF||(!vr&&(SQ_TAGS.has(tag)||(len>=8&&isItem(o))))){
        const [items,o2]=readSeq(o,len); el.items=items; o=o2; }
      else o+=len;
      ds.set(tag,el);
    }
    return [ds,o];
  }
  function readSeq(o,len){
    const items=[], end=len===UNDEF?u8.length:o+len;
    while(o+8<=end){
      const tag=tagAt(o), il=dv.getUint32(o+4,true); o+=8;
      if(tag===0xFFFEE0DD) break;
      if(tag!==0xFFFEE000) throw new Error('séquence DICOM mal formée');
      if(il===UNDEF){ const [ds,o2]=readDS(o,u8.length); items.push(ds); o=o2; }
      else { const [ds]=readDS(o,o+il); items.push(ds); o+=il; }
    }
    return [items,len===UNDEF?o:end];
  }
  function skipUndef(o){ while(o+8<=u8.length){ const tag=tagAt(o), l=dv.getUint32(o+4,true); o+=8; if(tag===0xFFFEE0DD) return o; o+=l; } return o; }

  const [root]=readDS(off,u8.length);
  const csEl=root.get(T.charset);
  const utf8=csEl&&/ISO_IR 192/.test(latin1(u8.subarray(csEl.off,csEl.off+csEl.len)));
  const dec=utf8?new TextDecoder('utf-8'):{decode:latin1};
  const f={u8,dv,ts,root,
    has:(tag,ds=root)=>ds.has(tag),
    str:(tag,ds=root)=>{const e=ds.get(tag); return e&&!e.items?dec.decode(u8.subarray(e.off,e.off+e.len)).replace(/[\0 ]+$/,'').trim():'';},
    nums:(tag,ds=root)=>{const s=f.str(tag,ds); return s?s.split('\\').map(Number):[];},
    num:(tag,ds=root,def=NaN)=>{const v=f.nums(tag,ds)[0]; return Number.isFinite(v)?v:def;},
    u16:(tag,ds=root)=>{const e=ds.get(tag); return e&&e.len>=2?dv.getUint16(e.off,true):NaN;},
    seq:(tag,ds=root)=>(ds.get(tag)?.items)||[],
  };
  return f;
}
function latin1(b){let s='';for(let i=0;i<b.length;i+=0x8000)s+=String.fromCharCode.apply(null,b.subarray(i,i+0x8000));return s;}

const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const HU_MIN=-1024, HU_MAX=3071;

// Volume CT à partir des fichiers image (ArrayBuffer[]). Les axes sont remis en
// orientation d'affichage standard : x vers la gauche du patient, y vers l'arrière, z vers le haut.
function buildVolume(bufs, onProgress){
  const series=new Map(); let skipped=0, tsErr=null;
  bufs.forEach((b,k)=>{ let f; try{ f=parse(b); }catch(e){ if(e.code==='ts') tsErr=e; skipped++; return; }
    if(!f.has(T.pixel)||!f.has(T.ipp)||!f.has(T.iop)) return;
    const m=f.str(T.modality); if(m==='RTSTRUCT'||m==='RTDOSE'||m==='RTPLAN') return;
    const uid=f.str(T.series)||'?'; if(!series.has(uid)) series.set(uid,[]); series.get(uid).push(f);
    if(onProgress&&k%20===0) onProgress(k/bufs.length); });
  if(!series.size) throw tsErr||new Error('aucune coupe d\'image DICOM lisible');
  // la série CT la plus longue
  let sl=[...series.values()].sort((a,b)=>(b[0].str(T.modality)==='CT')-(a[0].str(T.modality)==='CT')||b.length-a.length)[0];
  const f0=sl[0], NX=f0.u16(T.cols), NY=f0.u16(T.rows), iop=f0.nums(T.iop), r=iop.slice(0,3), c=iop.slice(3,6), n=cross(r,c);
  if(f0.u16(T.bits)!==16) throw new Error('seules les images 16 bits sont prises en charge');
  if(sl.some(f=>f.u16(T.cols)!==NX||f.u16(T.rows)!==NY)) throw new Error('coupes de tailles différentes dans la série');
  const sgn=n[2]<0?-1:1, key=f=>dot(f.nums(T.ipp),n)*sgn;
  sl=sl.map(f=>({f,k:key(f)})).sort((a,b)=>a.k-b.k).filter((s,i,a)=>i===0||Math.abs(s.k-a[i-1].k)>1e-3);
  const NZ=sl.length;
  const ps=f0.nums(T.ps); const dy=ps[0]||1, dx=ps[1]||ps[0]||1;
  const dzs=sl.slice(1).map((s,i)=>s.k-sl[i].k).sort((a,b)=>a-b); const dz=NZ>1?dzs[dzs.length>>1]:1;
  const flipX=r[0]<0, flipY=c[1]<0, NXY=NX*NY;
  const vol=new Int16Array(NXY*NZ);
  sl.forEach((s,z)=>{ const f=s.f, e=f.root.get(T.pixel);
    if(e.encapsulated) throw new Error('images compressées non prises en charge');
    const signed=f.u16(T.pixRep)===1, slope=f.num(T.slope,f.root,1), inter=f.num(T.inter,f.root,0);
    let px; const bo=f.u8.byteOffset+e.off;
    if(bo%2===0) px=signed?new Int16Array(f.u8.buffer,bo,NXY):new Uint16Array(f.u8.buffer,bo,NXY);
    else { const cp=f.u8.slice(e.off,e.off+NXY*2); px=signed?new Int16Array(cp.buffer):new Uint16Array(cp.buffer); }
    const base=z*NXY;
    for(let j=0;j<NY;j++){ const y=flipY?NY-1-j:j, o=base+y*NX;
      for(let i=0;i<NX;i++){ let v=px[j*NX+i]*slope+inter; v=v<HU_MIN?HU_MIN:v>HU_MAX?HU_MAX:v; vol[o+(flipX?NX-1-i:i)]=v; } }
  });
  const o0=sl[0].f.nums(T.ipp), keys=sl.map(s=>s.k);
  // coordonnées patient (mm) -> indices voxel continus (x, y) et coupe la plus proche
  const toIndex=P=>{ const d=[P[0]-o0[0],P[1]-o0[1],P[2]-o0[2]]; let i=dot(d,r)/dx, j=dot(d,c)/dy;
    if(flipX) i=NX-1-i; if(flipY) j=NY-1-j; const k=dot(P,n)*sgn;
    let lo=0,hi=NZ-1; while(hi-lo>1){const m=(lo+hi)>>1; if(keys[m]<k) lo=m; else hi=m;}
    const z=Math.abs(keys[lo]-k)<=Math.abs(keys[hi]-k)?lo:hi; return [i,j,z,Math.abs(keys[z]-k)]; };
  return {NX,NY,NZ,spacing:[dx,dy,dz],vol,toIndex,frameRef:f0.str(T.frameRef),skipped,nFiles:bufs.length};
}

// RTSTRUCT : liste des ROI avec nom, couleur et contours (tableaux de points en mm)
function parseRTSS(buf){
  const f=parse(buf);
  if(f.str(T.modality)!=='RTSTRUCT') throw new Error('le fichier structure n\'est pas un RTSTRUCT (modalité '+(f.str(T.modality)||'inconnue')+')');
  const rois=new Map();
  for(const it of f.seq(T.roiSeq)){ const num=f.num(T.roiNum,it); rois.set(num,{num,name:f.str(T.roiName,it)||('ROI '+num),color:null,contours:[]}); }
  for(const it of f.seq(T.contourSeqTop)){
    const roi=rois.get(f.num(T.refRoi,it)); if(!roi) continue;
    const col=f.nums(T.color,it); if(col.length===3) roi.color=col;
    for(const c of f.seq(T.contourSeq,it)){
      const g=f.str(T.geom,c); if(g&&g!=='CLOSED_PLANAR') continue;
      const d=f.nums(T.data,c); if(d.length>=9) roi.contours.push(Float64Array.from(d)); }
  }
  return {rois:[...rois.values()],frameRef:f.str(T.frameRef)};
}

// Rastérisation d'une ROI sur la grille du volume : masques par coupe, recadrés sur la boîte des contours.
// Les contours d'une même coupe sont combinés en OU exclusif (les trous sont respectés).
function rasterize(roi,V){
  const {NX,NY,NZ,spacing}=V, byZ=new Map();
  for(const d of roi.contours){
    const n=d.length/3, xs=new Float64Array(n), ys=new Float64Array(n); let zz=null, far=0;
    for(let p=0;p<n;p++){ const [i,j,z,dist]=V.toIndex([d[3*p],d[3*p+1],d[3*p+2]]); xs[p]=i; ys[p]=j; if(zz===null) zz=z; far=Math.max(far,dist); }
    if(far>spacing[2]*0.6) continue; // contour hors des coupes du scanner
    if(!byZ.has(zz)) byZ.set(zz,[]); byZ.get(zz).push([xs,ys]);
  }
  const sl=new Array(NZ).fill(null), b=[NX,-1,NY,-1,NZ,-1];
  for(const [z,polys] of byZ){
    let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
    for(const [xs,ys] of polys) for(let p=0;p<xs.length;p++){ if(xs[p]<x0)x0=xs[p]; if(xs[p]>x1)x1=xs[p]; if(ys[p]<y0)y0=ys[p]; if(ys[p]>y1)y1=ys[p]; }
    x0=Math.max(0,Math.ceil(x0)); x1=Math.min(NX-1,Math.floor(x1)); y0=Math.max(0,Math.ceil(y0)); y1=Math.min(NY-1,Math.floor(y1));
    if(x1<x0||y1<y0) continue;
    const w=x1-x0+1, h=y1-y0+1, m=new Uint8Array(w*h); let any=false;
    for(const [xs,ys] of polys){ const n=xs.length, cut=[];
      for(let y=y0;y<=y1;y++){ cut.length=0;
        for(let p=0,q=n-1;p<n;q=p++){ const ya=ys[q], yb=ys[p];
          if((ya<=y&&yb>y)||(yb<=y&&ya>y)) cut.push(xs[q]+(y-ya)/(yb-ya)*(xs[p]-xs[q])); }
        cut.sort((a,b)=>a-b);
        for(let k=0;k+1<cut.length;k+=2){ const a=Math.max(x0,Math.ceil(cut[k])), e=Math.min(x1,Math.ceil(cut[k+1])-1);
          for(let x=a;x<=e;x++){ m[(y-y0)*w+x-x0]^=1; any=true; } }
      } }
    if(!any) continue;
    sl[z]={x0,y0,w,h,m};
    if(x0<b[0])b[0]=x0; if(x1>b[1])b[1]=x1; if(y0<b[2])b[2]=y0; if(y1>b[3])b[3]=y1; if(z<b[4])b[4]=z; if(z>b[5])b[5]=z;
  }
  return {sl,b};
}

const normName=s=>String(s||'').trim().toLowerCase();
window.DICOM={parse,buildVolume,parseRTSS,rasterize,normName,HU_MIN,HU_MAX};
})();

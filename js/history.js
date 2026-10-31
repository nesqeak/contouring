// Historique des scores Dice d'un dossier : tableau, courbes de progression, export PDF.
(function(){
const esc=t=>String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
// palette catégorielle (ordre fixe) ; le rouge est réservé à la ligne des 80 %
const SERIES={dark:['#3987e5','#d95926','#199e70','#c98500','#d55181','#008300','#9085e9'],light:['#2a78d6','#eb6834','#1baf7a','#eda100','#e87ba4','#008300','#6250d6']};
const THEME={
  dark:{surface:'#151b20',grid:'#25303a',axis:'#3a4652',text:'#8a99a5',ref:'#e66767',series:SERIES.dark},
  page:{surface:'#f2f9fd',grid:'#dbe9f2',axis:'#b9cfdd',text:'#56697f',ref:'#e34948',series:SERIES.light}, // historique sur fond blanc
  light:{surface:'#ffffff',grid:'#e6e6e3',axis:'#c3c2b7',text:'#52514e',ref:'#e34948',series:SERIES.light},
};
const pct=d=>d==null?'—':(d*100).toFixed(1).replace('.',',')+' %';
const fdate=s=>new Date(s).toLocaleDateString('fr-FR');
const fdt=s=>new Date(s).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
const mean=r=>{const v=r.scores.filter(s=>s.dice!=null); return v.length?v.reduce((a,s)=>a+s.dice,0)/v.length:null;};
const namesOf=results=>{const n=[]; results.forEach(r=>r.scores.forEach(s=>{if(!n.includes(s.name)) n.push(s.name);})); return n;};
const val=(r,name)=>{const s=r.scores.find(x=>x.name===name); return s?s.dice:null;};

// Courbes : une ligne par structure, x = validations successives, y = Dice (0–100 %)
function drawChart(cv,results,names,theme,W,H,hover){
  const T=THEME[theme], dpr=cv._dpr||1, c=cv.getContext('2d');
  c.setTransform(dpr,0,0,dpr,0,0); c.fillStyle=T.surface; c.fillRect(0,0,W,H);
  const L=46,R=18,Tp=14,B=40, pw=W-L-R, ph=H-Tp-B, n=results.length;
  const I=34, X=i=>L+I+(n===1?(pw-2*I)/2:i*(pw-2*I)/(n-1)), Y=v=>Tp+ph*(1-v);
  c.font='12px "IBM Plex Mono",ui-monospace,monospace'; c.textBaseline='middle';
  for(let k=0;k<=5;k++){ const y=Y(k/5); c.strokeStyle=k?T.grid:T.axis; c.lineWidth=1; c.beginPath(); c.moveTo(L,y+.5); c.lineTo(W-R,y+.5); c.stroke();
    c.fillStyle=T.text; c.textAlign='right'; c.fillText(k*20+' %',L-8,y); }
  // seuil 80 %
  c.strokeStyle=T.ref; c.lineWidth=1.5; c.setLineDash([6,5]); c.beginPath(); c.moveTo(L,Y(.8)); c.lineTo(W-R,Y(.8)); c.stroke(); c.setLineDash([]);
  c.fillStyle=T.ref; c.textAlign='left'; c.textBaseline='bottom'; c.fillText('80 %',L+4,Y(.8)-3); c.textBaseline='middle';
  // dates en abscisse (allégées si nombreuses)
  c.fillStyle=T.text; c.textAlign='center'; const step=Math.ceil(n/Math.max(1,Math.floor(pw/86)));
  results.forEach((r,i)=>{ if(i%step&&i!==n-1) return; c.fillText(fdate(r.date),X(i),H-B+16); c.fillText('n° '+(i+1),X(i),H-B+30); });
  if(hover!=null){ c.strokeStyle=T.axis; c.lineWidth=1; c.beginPath(); c.moveTo(X(hover)+.5,Tp); c.lineTo(X(hover)+.5,Tp+ph); c.stroke(); }
  names.forEach((nm,k)=>{ const col=T.series[k%T.series.length];
    c.strokeStyle=col; c.lineWidth=2; c.lineJoin='round'; c.beginPath(); let started=false;
    results.forEach((r,i)=>{ const v=val(r,nm); if(v==null){started=false;return;} if(started) c.lineTo(X(i),Y(v)); else {c.moveTo(X(i),Y(v)); started=true;} });
    c.stroke();
    results.forEach((r,i)=>{ const v=val(r,nm); if(v==null) return; c.beginPath(); c.arc(X(i),Y(v),i===hover?5.5:4,0,Math.PI*2); c.fillStyle=col; c.fill(); c.lineWidth=2; c.strokeStyle=T.surface; c.stroke(); });
  });
  return {X,L:L+I,R,pw:pw-2*I,n};
}

// opts.embedded : fiche insérée dans une autre page (suivi des internes) ; opts.who : nom de l'interne, repris dans le PDF
function render(root,d,results,opts={}){
  const names=namesOf(results), th=document.body.classList.contains('light')?'page':'dark', ser=THEME[th].series;
  root.innerHTML=`<div class="hist${opts.embedded?' embedded':''}">
    ${opts.embedded?(results.length?'<div class="tools"><button class="btn h-pdf">Exporter en PDF</button></div>':''):`<header class="vtop"><a class="btn" href="#/">← Menu</a>
      <div class="vtitle"><h1>Historique des scores Dice</h1><span class="meta">${esc(d.category)}${d.category?' · ':''}${esc(d.title)}</span></div>
      <span class="grow"></span>${results.length?'<button class="btn primary h-pdf">Exporter en PDF</button>':''}</header>`}
    ${results.length?`
    <section class="card"><h2>Progression du Dice</h2>
      ${results.length>1?`<div class="legend">${names.map((n,k)=>`<span><i style="--c:${ser[k%7]}"></i>${esc(n)}</span>`).join('')}<span><i class="ref"></i>Seuil 80 %</span></div>
      <div class="chart"><canvas class="h-cv" aria-label="Courbes de progression du Dice par structure"></canvas><div class="ctip" hidden></div></div>`
      :'<div class="hint">La courbe de progression apparaîtra après la deuxième validation de ce dossier.</div>'}
    </section>
    <section class="card"><h2>Résultats par validation</h2><div class="tscroll"><table class="htab">
      <thead><tr><th>Validation</th>${names.map(n=>`<th>${esc(n)}</th>`).join('')}${names.length>1?'<th>Moyenne</th>':''}</tr></thead>
      <tbody>${results.map((r,i)=>`<tr><td>n° ${i+1} · ${fdt(r.date)}</td>${names.map(n=>{const v=val(r,n);return `<td class="${v!=null&&v>=.8?'good':''}">${pct(v)}</td>`;}).join('')}${names.length>1?`<td>${pct(mean(r))}</td>`:''}</tr>`).join('')}</tbody>
    </table></div><div class="hint">Index de Dice = 2 |A ∩ B| / (|A| + |B|) entre le contour de l'utilisateur et le contour de référence du fichier structure. En vert : Dice ≥ 80 %.</div></section>`
    :`<section class="card"><div class="hint">Aucun résultat pour ce dossier. Les scores apparaissent ici après la validation d'une session de contourage.</div></section>`}
  </div>`;
  const cv=root.querySelector('.h-cv');
  if(cv){
    const tip=root.querySelector('.ctip'); let geo=null, hover=null;
    const paint=()=>{ const W=cv.parentNode.clientWidth, H=Math.max(240,Math.min(380,W*.45)), dpr=window.devicePixelRatio||1;
      cv._dpr=dpr; cv.width=W*dpr; cv.height=H*dpr; cv.style.height=H+'px'; geo=drawChart(cv,results,names,th,W,H,hover); };
    paint(); const ro=new ResizeObserver(paint); ro.observe(cv.parentNode);
    cv.addEventListener('pointermove',e=>{ const r=cv.getBoundingClientRect(), x=e.clientX-r.left;
      const i=geo.n===1?0:Math.max(0,Math.min(geo.n-1,Math.round((x-geo.L)/geo.pw*(geo.n-1))));
      if(i!==hover){hover=i; paint();}
      const res=results[i];
      tip.innerHTML=`<div><b>n° ${i+1}</b><span>${fdt(res.date)}</span></div>`+names.map((n,k)=>`<div><span><span class="sw" style="--c:${ser[k%7]}"></span> ${esc(n)}</span><b>${pct(val(res,n))}</b></div>`).join('');
      tip.hidden=false; const tx=geo.X(i)+12, w=tip.offsetWidth; tip.style.left=(tx+w>r.width?geo.X(i)-w-12:tx)+'px'; tip.style.top='8px'; });
    cv.addEventListener('pointerleave',()=>{hover=null; tip.hidden=true; paint();});
  }
  const btn=root.querySelector('.h-pdf');
  if(btn) btn.onclick=async()=>{ btn.disabled=true; const t=btn.textContent; btn.textContent='Préparation…';
    try{ await exportPdf(d,results,names,opts.who); }catch(e){ if(e&&e.code!=='declined') UI.message('Export PDF impossible',e.message||String(e)); }
    finally{ btn.disabled=false; btn.textContent=t; } };
}

let jspdfP=null;
const loadJsPDF=()=>jspdfP||(jspdfP=new Promise((res,rej)=>{ if(window.jspdf) return res(window.jspdf);
  const s=document.createElement('script'); s.src='lib/jspdf.umd.min.js'; s.onload=()=>res(window.jspdf); s.onerror=()=>{jspdfP=null; rej(new Error('bibliothèque PDF introuvable'));}; document.head.appendChild(s); }));

async function exportPdf(d,results,names,who){
  const {jsPDF}=await loadJsPDF();
  const doc=new jsPDF({unit:'mm',format:'a4'}), PW=210, M=15, CW=PW-2*M; let y=M;
  const txt=(s,x,yy,o)=>doc.text(String(s),x,yy,o);
  doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(110);
  txt('Service de Radiothérapie · Plateforme d\'entraînement au contourage',M,y); txt('Exporté le '+new Date().toLocaleDateString('fr-FR'),PW-M,y,{align:'right'});
  y+=10; doc.setTextColor(20); doc.setFont('helvetica','bold'); doc.setFontSize(18); txt(d.category||'—',M,y);
  y+=8; doc.setFont('helvetica','normal'); doc.setFontSize(13); doc.splitTextToSize(d.title,CW).forEach(l=>{txt(l,M,y); y+=6;});
  if(who){ doc.setFontSize(10); doc.setTextColor(90); txt('Interne : '+who,M,y); y+=5; doc.setTextColor(20); }
  y+=2; doc.setDrawColor(200); doc.line(M,y,PW-M,y); y+=8;

  // tableau
  doc.setFont('helvetica','bold'); doc.setFontSize(11); txt('Résultats Dice',M,y); y+=6;
  const cols=['Validation',...names,...(names.length>1?['Moyenne']:[])], first=42, cw=(CW-first)/Math.max(1,cols.length-1);
  const fs=cols.length>7?7:8.5; doc.setFontSize(fs);
  const head=cols.map((c,i)=>doc.splitTextToSize(c,(i?cw:first)-2)), hh=Math.max(...head.map(h=>h.length))*fs*.42+2;
  const xOf=i=>i?M+first+(i-1)*cw:M;
  const header=()=>{ doc.setFont('helvetica','bold'); doc.setTextColor(80); head.forEach((h,i)=>h.forEach((l,k)=>txt(l,i?xOf(i)+cw-1:xOf(i),y+k*fs*.42,{align:i?'right':'left'})));
    y+=hh; doc.setDrawColor(180); doc.line(M,y-1.5,PW-M,y-1.5); y+=2.5; };
  header();
  doc.setFont('helvetica','normal');
  results.forEach((r,ri)=>{
    if(y>282){ doc.addPage(); y=M; header(); doc.setFont('helvetica','normal'); }
    const cells=[`n° ${ri+1} · ${fdt(r.date)}`,...names.map(n=>pct(val(r,n))),...(names.length>1?[pct(mean(r))]:[])];
    cells.forEach((c,i)=>{ const v=i&&i<=names.length?val(r,names[i-1]):null; doc.setTextColor(v!=null&&v>=.8?20:40); if(v!=null&&v>=.8) doc.setTextColor(0,125,60);
      txt(c,i?xOf(i)+cw-1:xOf(i),y,{align:i?'right':'left'}); });
    doc.setTextColor(40); doc.setDrawColor(225); doc.line(M,y+2,PW-M,y+2); y+=6;
  });
  doc.setFontSize(7.5); doc.setTextColor(110); y+=1; txt('Dice = 2|A∩B| / (|A|+|B|) entre le contour de l\'utilisateur et le contour de référence. En vert : Dice ≥ 80 %.'.replace('∩','n').replace('≥','>='),M,y); y+=9;

  // courbes
  if(results.length>1){
    const ch=95; if(y+ch+20>287){ doc.addPage(); y=M; }
    doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(20); txt('Progression du Dice',M,y); y+=4;
    const W=900, H=Math.round(W*ch/CW), cv=document.createElement('canvas'); cv._dpr=2; cv.width=W*2; cv.height=H*2;
    drawChart(cv,results,names,'light',W,H,null);
    doc.addImage(cv.toDataURL('image/png'),'PNG',M,y,CW,ch); y+=ch+5;
    doc.setFont('helvetica','normal'); doc.setFontSize(8.5); let x=M;
    const leg=[...names.map((n,k)=>({n,c:SERIES.light[k%7]})),{n:'Seuil 80 %',c:'#e34948',dash:true}];
    for(const l of leg){ const w=doc.getTextWidth(l.n)+12; if(x+w>PW-M){x=M;y+=5;}
      const [r,g,b]=[1,3,5].map(i=>parseInt(l.c.slice(i,i+2),16)); doc.setDrawColor(r,g,b); doc.setLineWidth(.7);
      if(l.dash) doc.setLineDashPattern([1.2,1],0); doc.line(x,y-1,x+6,y-1); doc.setLineDashPattern([],0); doc.setLineWidth(.2);
      doc.setTextColor(40); txt(l.n,x+8,y); x+=w; }
    y+=8;
  }
  doc.setFontSize(7.5); doc.setTextColor(130);
  txt('Plateforme à but de formation : ne doit pas être utilisée pour la planification clinique.',PW/2,290,{align:'center'});
  const safe=s=>s.replace(/Œ/g,'OE').replace(/œ/g,'oe').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\w-]+/g,'_').replace(/^_+|_+$/g,'');
  const filename=`Dice_${who?safe(who)+'_':''}${safe(d.category||'dossier')}_${safe(d.title)}.pdf`;
  // dans un Artifact, le téléchargement passe par la capacité « downloads » (confirmation du lecteur)
  const dl=window.claude&&typeof claude.use==='function'?await claude.use('downloads'):null;
  if(dl) await dl.save({filename,data:doc.output('blob')}); else doc.save(filename);
}
// Export PDF des statistiques d'un dossier (page administrateur) : rows = [{name,n,mean,med,sd,min,max}]
async function exportStatsPdf(d,rows,info){
  const {jsPDF}=await loadJsPDF();
  const doc=new jsPDF({unit:'mm',format:'a4'}), PW=210, M=15, CW=PW-2*M; let y=M;
  const txt=(s,x,yy,o)=>doc.text(String(s),x,yy,o), dash=v=>v==null||isNaN(v)?'-':pct(v);
  doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(110);
  txt('Service de Radiothérapie · Plateforme d\'entraînement au contourage',M,y); txt('Exporté le '+new Date().toLocaleDateString('fr-FR'),PW-M,y,{align:'right'});
  y+=10; doc.setTextColor(20); doc.setFont('helvetica','bold'); doc.setFontSize(18); txt(d.category||'-',M,y);
  y+=8; doc.setFont('helvetica','normal'); doc.setFontSize(13); doc.splitTextToSize(d.title,CW).forEach(l=>{txt(l,M,y); y+=6;});
  y+=2; doc.setDrawColor(200); doc.line(M,y,PW-M,y); y+=8;
  doc.setFont('helvetica','bold'); doc.setFontSize(11); txt('Statistiques du Dice par structure',M,y); y+=6;
  doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(70);
  doc.splitTextToSize(info,CW).forEach(l=>{txt(l,M,y); y+=4.5;}); y+=3;
  const cols=['Structure','Internes','Moyenne','Médiane','Écart type','Minimum','Maximum'], first=58, cw=(CW-first)/6, xOf=i=>i?M+first+(i-1)*cw:M;
  const header=()=>{ doc.setFont('helvetica','bold'); doc.setFontSize(8.5); doc.setTextColor(80);
    cols.forEach((c,i)=>txt(c,i?xOf(i)+cw-1:xOf(i),y,{align:i?'right':'left'})); y+=2; doc.setDrawColor(180); doc.line(M,y,PW-M,y); y+=5; doc.setFont('helvetica','normal'); };
  header();
  for(const r of rows){
    if(y>280){ doc.addPage(); y=M; header(); }
    const name=doc.splitTextToSize(r.name,first-3);
    const cells=[r.n,dash(r.mean),dash(r.med),r.sd==null?'-':dash(r.sd),dash(r.min),dash(r.max)];
    doc.setFontSize(9); doc.setTextColor(40); name.forEach((l,k)=>txt(l,M,y+k*4));
    cells.forEach((c,i)=>{ if(i===1&&r.mean>=.8) doc.setTextColor(0,125,60); else doc.setTextColor(40); txt(c,xOf(i+1)+cw-1,y,{align:'right'}); });
    y+=Math.max(1,name.length)*4; doc.setDrawColor(225); doc.line(M,y-2,PW-M,y-2); y+=4;
  }
  doc.setFontSize(7.5); doc.setTextColor(110); y+=2;
  txt('Écart type calculé sur l\'échantillon (n - 1), à partir de deux internes. En vert : moyenne >= 80 %.',M,y);
  doc.setTextColor(130); txt('Plateforme à but de formation : ne doit pas être utilisée pour la planification clinique.',PW/2,290,{align:'center'});
  const safe=s=>s.replace(/Œ/g,'OE').replace(/œ/g,'oe').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^\w-]+/g,'_').replace(/^_+|_+$/g,'');
  const filename=`Statistiques_Dice_${safe(d.category||'dossier')}_${safe(d.title)}.pdf`;
  const dl=window.claude&&typeof claude.use==='function'?await claude.use('downloads'):null;
  if(dl) await dl.save({filename,data:doc.output('blob')}); else doc.save(filename);
}
window.DiceHistory={render,exportStatsPdf};
})();

// Single UI resource for ChatGPT (MCP Apps). Renders tool results: slots, estimate, plan, vehicle card, job status.
// Reads data through the standard ui/notifications/tool-result bridge, with window.openai as ChatGPT fallback.
// All data is treated as untrusted: rendered with textContent only.
export const WIDGET_URI = 'ui://garagee/widget-v4.html';

export const WIDGET_HTML = `<!doctype html><html translate="no"><head><meta name="google" content="notranslate"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light dark;--line:rgba(127,127,127,.3);--muted:rgba(127,127,127,1);--acc:#0b6bcb}
body{overflow-wrap:anywhere;-webkit-text-size-adjust:100%;margin:0;font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:transparent}
.wrap{padding:12px}.h{font-weight:700;font-size:15px;margin:0 0 8px}.muted{color:var(--muted);font-size:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.card{border:1px solid var(--line);border-radius:10px;padding:10px}.big{font-size:16px;font-weight:700}
button{margin-top:8px;background:var(--acc);color:#fff;border:0;border-radius:8px;padding:7px 12px;font:inherit;font-weight:600;cursor:pointer}
button[disabled]{opacity:.5;cursor:default}button{min-height:40px}td,th{word-break:break-word}
.brand{display:flex;align-items:center;gap:8px;font-weight:700;font-size:13px;color:var(--muted);margin:12px 12px 0}
.brand .spin{width:24px;height:24px;box-shadow:0 3px 8px rgba(0,0,0,.25)}
.spin{position:relative;display:inline-block;vertical-align:middle;border-radius:22%;animation:spin3d 2.4s cubic-bezier(.25,.7,.25,1) both;transform-style:preserve-3d}.spin>img,.spin>svg{display:block;width:100%;height:100%;border-radius:22%}.spin::after{content:'';position:absolute;inset:0;border-radius:22%;pointer-events:none;background:linear-gradient(115deg,rgba(255,255,255,0) 38%,rgba(255,255,255,.9) 50%,rgba(255,255,255,0) 62%);background-size:260% 100%;background-position:160% 0;opacity:0;animation:shine 2.4s ease both}.spin i.sp{position:absolute;width:22%;height:22%;pointer-events:none;background:#fff6cc;clip-path:polygon(50% 0,59% 41%,100% 50%,59% 59%,50% 100%,41% 59%,0 50%,41% 41%);filter:drop-shadow(0 0 3px rgba(255,190,40,.95)) drop-shadow(0 0 6px rgba(255,220,120,.8));opacity:0;animation:twinkle 2.4s ease both}.spin i.sp:nth-of-type(1){top:-6%;right:-4%}.spin i.sp:nth-of-type(2){bottom:4%;left:-8%;width:15%;height:15%;animation-delay:.15s}.spin i.sp:nth-of-type(3){top:30%;right:-12%;width:12%;height:12%;animation-delay:.3s}@keyframes spin3d{0%{transform:perspective(600px) rotateY(-180deg) scale(.45);opacity:0}25%{opacity:1}60%{transform:perspective(600px) rotateY(20deg) scale(1.15)}100%{transform:perspective(600px) rotateY(0) scale(1)}}@keyframes shine{0%,48%{opacity:0;background-position:160% 0}58%{opacity:1}85%{opacity:1;background-position:-60% 0}100%{opacity:0;background-position:-60% 0}}@keyframes twinkle{0%,55%{opacity:0;transform:scale(.2) rotate(0)}70%{opacity:1;transform:scale(1.15) rotate(45deg)}88%{opacity:0;transform:scale(.3) rotate(90deg)}100%{opacity:0}}@media (prefers-reduced-motion:reduce){.spin,.spin::after,.spin i.sp{animation:none}.spin i.sp,.spin::after{display:none}}
table{width:100%;border-collapse:collapse}td,th{padding:5px 4px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}td.r,th.r{text-align:right}
.bar{height:8px;border-radius:4px;background:var(--line);overflow:hidden}.bar>i{display:block;height:100%;background:var(--acc)}
.red{color:#c62828}.amber{color:#b26a00}.green{color:#2e7d32}
</style></head><body><div class="brand" aria-hidden="true"><span class="spin"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"> <rect rx="112" fill="#0B6BCB"/> <path d="M368 162A140 140 0 1 0 396 256H346" fill="none" stroke="#fff" stroke-width="56" stroke-linecap="round" stroke-linejoin="round"/> <circle cx="256" cy="256" r="46" fill="#fff"/> <g stroke="#fff" stroke-width="18" stroke-linecap="round">  <path d="M256 210V150M216 233l-52-30M216 279l-52 30M256 302v60"/> </g> <circle cx="256" cy="256" r="16" fill="#0B6BCB"/></svg><i class="sp"></i><i class="sp"></i><i class="sp"></i></span>Garagee</div><div class="wrap" id="root"><div class="muted">Garagee…</div></div>
<script>
(function(){
  var root=document.getElementById('root'); var reqId=1; var pending={};
  function el(tag,cls,text){var e=document.createElement(tag); if(cls)e.className=cls; if(text!=null)e.textContent=String(text); return e;}
  function dd(s,loc){ if(!s) return '–'; try{ return new Date(s+'T00:00:00Z').toLocaleDateString(loc||undefined,{day:'numeric',month:'numeric',year:'numeric',timeZone:'UTC'});}catch(e){return s;} }
  function fmt(n,cur,loc){ if(n==null) return '–'; try{return new Intl.NumberFormat(loc||undefined,{style:'currency',currency:cur||'EUR'}).format(n);}catch(e){return n+' '+(cur||'');} }
  function dt(s,loc){ if(!s) return '–'; try{var d=new Date(s+':00Z'); return d.toLocaleString(loc||undefined,{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'UTC'});}catch(e){return s.replace('T',' ');} }
  function rpc(method,params){ return new Promise(function(res,rej){ var id=reqId++; pending[id]={res:res,rej:rej}; window.parent.postMessage({jsonrpc:'2.0',id:id,method:method,params:params},'*'); setTimeout(function(){ if(pending[id]){delete pending[id]; rej(new Error('timeout'));} },20000); }); }
  function callTool(name,args){
    if(window.openai && window.openai.callTool) return window.openai.callTool(name,args);
    return rpc('tools/call',{name:name,arguments:args});
  }
  window.addEventListener('message',function(ev){
    if(ev.source!==window.parent) return; var m=ev.data||{};
    if(m.id && pending[m.id]){ var p=pending[m.id]; delete pending[m.id]; m.error?p.rej(m.error):p.res(m.result); return; }
    if(m.method==='ui/notifications/tool-result' && m.params) render(m.params.structuredContent||m.params);
  });
  try{ rpc('ui/initialize',{appInfo:{name:'Garagee',version:'1'},appCapabilities:{},protocolVersion:'2026-01-26'}).then(function(){ window.parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized',params:{}},'*'); }).catch(function(){}); }catch(e){}
  function fromOpenAI(){ if(window.openai && window.openai.toolOutput) render(window.openai.toolOutput); }
  window.addEventListener('openai:set_globals',fromOpenAI); fromOpenAI();

  function render(d){
    if(!d || !d.view) return; root.innerHTML=''; var L=d.labels||{}; var loc=d.locale; var U=d.ui||{}; var N=d.names||{}; function nm(x){ return (x&&x.code&&N[x.code])||(x&&x.name)||''; }
    if(d.title) root.appendChild(el('div','h',d.title));
    if(d.view==='slots'){
      var g=el('div','grid'); (d.slots||[]).forEach(function(s){
        var c=el('div','card'); c.appendChild(el('div','big',dt(s.start,loc)));
        c.appendChild(el('div','muted',(s.bayName||'')+' · '+(s.assignments||[]).map(function(a){return nm(a)+': '+(a.mechanicNames||[]).join(' + ');}).join(', ')));
        if(d.vehicleId){ var b=el('button',null,L.book||'Book'); b.onclick=function(){ b.disabled=true; b.textContent='…'; callTool('book_appointment',{vehicleId:d.vehicleId,operations:d.operations,start:s.start}).then(function(){b.textContent='✓';}).catch(function(){b.disabled=false;b.textContent=L.book||'Book';}); }; c.appendChild(b); }
        g.appendChild(c); }); root.appendChild(g);
      if(!(d.slots||[]).length) root.appendChild(el('div','muted',U.noSlots||'No free slot in the next 3 weeks.'));
    }
    if(d.view==='estimate'){
      var t=el('table'); var h=el('tr'); [U.labourCol||'Labour', U.hours||'h', ''].forEach(function(x,i){ h.appendChild(el('th',i?'r':null,x)); }); t.appendChild(h);
      (d.lines||[]).forEach(function(l){ var r=el('tr'); r.appendChild(el('td',null,nm(l))); r.appendChild(el('td','r',l.hours)); r.appendChild(el('td','r',d.laborRate!=null?fmt(Math.round(l.hours*d.laborRate*100)/100,d.currency,loc):'–')); t.appendChild(r);
        if(l.samples){ var r2=el('tr'); var c2=el('td','muted',(U.shopAvg||'shop average {h} h from {n} jobs').replace('{h}',l.shopMedianHours).replace('{n}',l.samples)); c2.colSpan=3; r2.appendChild(c2); t.appendChild(r2); } });
      root.appendChild(t);
      if((d.parts||[]).length){ var tp=el('table'); tp.style.marginTop='8px'; var hp=el('tr'); hp.appendChild(el('th',null,U.partsCol||'Parts')); hp.appendChild(el('th','r','')); tp.appendChild(hp);
        (d.parts||[]).forEach(function(p){ var r=el('tr'); r.appendChild(el('td',null,(p.qty>1?p.qty+'× ':'')+nm(p))); r.appendChild(el('td','r',p.unitPrice==null?'?':fmt(p.unitPrice*(p.qty||1),d.currency,loc))); tp.appendChild(r); }); root.appendChild(tp); }
      var T=d.totals||{}; var s=el('div','card'); s.style.marginTop='8px';
      var parts=[(L.labor||'Labour')+' '+fmt(T.labour,d.currency,loc),(L.parts||'Parts')+' '+fmt(T.parts,d.currency,loc)]; if(T.supplies) parts.push((U.supplies||'Shop supplies')+' '+fmt(T.supplies,d.currency,loc)); if(T.tax!=null) parts.push((U.vat||'VAT')+' '+(d.vatRate!=null?d.vatRate+' % ':'')+fmt(T.tax,d.currency,loc));
      s.appendChild(el('div','muted',parts.join(' · ')));
      s.appendChild(el('div','big',(L.total||'Total incl. tax')+': '+fmt(T.gross,d.currency,loc))); root.appendChild(s);
      (d.overlaps||[]).forEach(function(o){ root.appendChild(el('div','green','• '+(U.overlap||'Shared access ({ops}): −{h} h').replace('{ops}',o.codes.map(function(c){ var ln=(d.lines||[]).filter(function(l){return l.code===c;})[0]; return N[c]||(ln&&ln.name)||c; }).join(' + ')).replace('{h}',o.hours))); });
      if((d.parts||[]).some(function(p){return /reference/.test(p.priceSource||'');})) root.appendChild(el('div','muted','• '+(U.refPrices||'Part prices are reference prices – confirm with the supplier.')));
      if(L.estimateNote) root.appendChild(el('div','muted','• '+L.estimateNote));
    }
    if(d.view==='plan'){
      var u=d.utilisation||{}; (u.bays||[]).concat(u.mechanics||[]).forEach(function(x){ var row=el('div'); row.appendChild(el('div',null,x.name+' – '+x.busyPct+' %')); var bar=el('div','bar'); var i=el('i'); i.style.width=Math.min(100,x.busyPct)+'%'; bar.appendChild(i); row.appendChild(bar); root.appendChild(row); });
      var t2=el('table'); (d.jobs||[]).forEach(function(j){ var r=el('tr'); r.appendChild(el('td',null,dt(j.start,loc))); r.appendChild(el('td',null,j.ref+' '+(j.title||''))); r.appendChild(el('td','muted',(j.bay||'')+' · '+(j.mechanics||[]).join(', '))); t2.appendChild(r); }); root.appendChild(t2);
    }
    if(d.view==='vehicle'){
      var v=d.vehicle||{}; root.appendChild(el('div','big',[v.plate,v.make,v.model,v.year].filter(Boolean).join(' · ')));
      if(v.vin) root.appendChild(el('div','muted','VIN '+v.vin));
      var ni=d.nextInspection||{}; if(ni.due) root.appendChild(el('div',ni.daysLeft<30?'red':(ni.daysLeft<90?'amber':null),(ni.name||'')+': '+dd(ni.due,loc)+(ni.overdue?' – '+(U.overdue||'overdue'):'')+(ni.assumedFromRegistration?' ('+(U.fromReg||'calculated from first registration')+')':'')));
      var t3=el('table'); ((d.maintenance||{}).items||[]).slice(0,6).forEach(function(m){ var r=el('tr'); r.appendChild(el('td',null,nm(m))); r.appendChild(el('td',(m.daysLeft!=null&&m.daysLeft<30)?'red':null,m.due?(dd(m.due,loc)+(m.assumed?' *':'')):'?')); t3.appendChild(r); }); root.appendChild(t3); if(((d.maintenance||{}).items||[]).some(function(m){return m.assumed;})) root.appendChild(el('div','muted',U.assumedNote||'* / ? no service record – estimated, check the service book')); (d.declinedWorkToRemind||[]).forEach(function(x){ root.appendChild(el('div','amber','↻ '+x.item+(x.note?' – '+x.note:''))); });
    }
    if(d.view==='status'){
      root.appendChild(el('div','big',d.summary||d.status));
      (d.inspection||[]).forEach(function(i){ root.appendChild(el('div',i.status,(i.status==='red'?'● ':i.status==='amber'?'◐ ':'○ ')+i.item+(i.note?' – '+i.note:'')+' ['+i.decision+']')); });
    }
    if(d.view==='intake'){
      var L2=d.labels||{}; var data=d.data||{};
      root.appendChild(el('div',d.complete?'green':'amber',d.status==='completed'?('✓ '+(U.completed||'Intake completed – job')+' '+(d.jobRef||'')):(d.complete?'✓ '+(U.ready||'ready to complete'):(U.missing||'Missing')+': '+(d.missingLabels||[]).join(', '))));
      var t5=el('table'); Object.keys(L2).forEach(function(k){ var v=data[k]; var miss=(d.missing||[]).indexOf(k)>=0; if(v==null&&!miss) return; var tr=el('tr'); tr.appendChild(el('td',miss?'red':null,L2[k])); var sv=v==null?'–':(v===true?'✓':(v==='none'?(U.none||'none'):(k==='category'?(U['cat_'+v]||v):(k==='fuel'?(U['fuel_'+v]||v):((k==='mileage'||k==='maxWeightKg')&&typeof v==='number'?new Intl.NumberFormat(loc||undefined).format(v)+(k==='mileage'?' km':' kg'):String(v)))))); tr.appendChild(el('td',null,sv)); t5.appendChild(tr); }); root.appendChild(t5);
      (d.errors||[]).forEach(function(e){ root.appendChild(el('div','red',e)); });
    }
    if(d.view==='list'){
      var t4=el('table'); (d.rows||[]).forEach(function(r){ var tr=el('tr'); (r||[]).forEach(function(c){ tr.appendChild(el('td',null,c)); }); t4.appendChild(tr); }); root.appendChild(t4);
    }
    if(d.footnote) root.appendChild(el('div','muted',d.footnote));
  }
})();
</script></body></html>`;

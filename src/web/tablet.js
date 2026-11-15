// Mechanic tablet: today's tasks, vehicle intake by typing or voice, works offline (queue + idempotent sync).
// Voice uses the browser's speech recognition (Chrome/Edge/Safari), in the shop's language.
import { page } from './html.js';

export const SERVICE_WORKER = `
const C='garagee-app-v3';
self.addEventListener('install',e=>e.waitUntil(caches.open(C).then(c=>c.addAll(['/app']))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k))))));
self.addEventListener('fetch',e=>{ const u=new URL(e.request.url); if(e.request.method==='GET' && u.pathname==='/app'){ e.respondWith(fetch(e.request).then(r=>{caches.open(C).then(c=>c.put(e.request,r.clone()));return r;}).catch(()=>caches.match(e.request))); }});`;

export function tabletPage() {
  return page('Garagee – Workshop', `
<style>
.tabs{display:flex;gap:8px;margin:8px 0 16px}.tabs button{flex:1}.tabs button.on{background:var(--acc);color:#fff}.tabs button:not(.on){background:transparent;color:var(--acc);border:1px solid var(--acc)}
.fld{display:flex;gap:6px;align-items:flex-end}.fld label{flex:1;margin:8px 0}.mic{padding:10px 12px;min-width:44px}.mic.rec{background:#c62828}
.req::after{content:" *";color:var(--red)}.miss input,.miss select,.miss textarea{border-color:var(--red)}
.big{width:100%;padding:16px;font-size:1.1rem;margin:8px 0}.ok{color:var(--green);font-weight:600}
h3{margin:18px 0 4px;font-size:1rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
</style>
<h1>Garagee – workshop</h1>
<div id="login" class="card" hidden>
  <label>E-mail<input id="em" type="email" autocomplete="username"></label>
  <label>Password<input id="pw" type="password" autocomplete="current-password"></label>
  <button id="go">Sign in</button> <span id="lerr" class="err"></span>
</div>
<div id="app" hidden>
  <p class="muted small"><span id="net"></span> · <span id="q"></span> <button class="secondary" id="out" style="padding:4px 10px">Sign out</button></p>
  <div class="tabs"><button id="tToday" class="on">Today</button><button id="tIntake">+ Vehicle intake</button></div>
  <div id="today"></div>
  <div id="intake" hidden>
    <button class="big mic" id="dictAll">🎤 Dictate everything</button>
    <p class="muted small" id="dictHint">Walk around the car and say e.g.: “ZA 123AB, passenger car, 142 thousand km, tank one quarter, customer Ján Novák 0900 123 456, problem: brakes squeak, damage: scratch on rear bumper, two keys.”</p>
    <p id="heard" class="muted small"></p>
    <form id="iform"></form>
    <p id="istatus"></p>
    <button class="big" id="isave">Save intake</button>
  </div>
</div>
<script>
const $=id=>document.getElementById(id);
const S={get t(){return localStorage.getItem('garagee_t')}, set t(v){v?localStorage.setItem('garagee_t',v):localStorage.removeItem('garagee_t')},
  get q(){try{return JSON.parse(localStorage.getItem('garagee_q')||'[]')}catch{return []}}, set q(v){localStorage.setItem('garagee_q',JSON.stringify(v))},
  get cache(){try{return JSON.parse(localStorage.getItem('garagee_today')||'null')}catch{return null}}, set cache(v){localStorage.setItem('garagee_today',JSON.stringify(v))},
  get draft(){try{return JSON.parse(localStorage.getItem('garagee_intake')||'{}')}catch{return {}}}, set draft(v){localStorage.setItem('garagee_intake',JSON.stringify(v))}};
if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
async function api(p,o={}){const r=await fetch(p,{...o,headers:{'content-type':'application/json',authorization:'Bearer '+S.t}});if(r.status===401){S.t=null;show();throw new Error('auth')}if(!r.ok)throw new Error(r.status);return r.json()}
function status(){ $('net').textContent=navigator.onLine?'online':'OFFLINE – changes are saved on this tablet'; $('q').textContent=S.q.length?S.q.length+' change(s) waiting to sync':'all synced'; }
async function sync(){ if(!navigator.onLine||!S.q.length) return status(); try{ const res=await api('/api/app/sync',{method:'POST',body:JSON.stringify({ops:S.q})}); const done=new Set(res.results.filter(r=>r.status!=='error').map(r=>r.clientOpId)); const errs=res.results.filter(r=>r.status==='error'); S.q=S.q.filter(o=>!done.has(o.clientOpId)&&!errs.some(e=>e.clientOpId===o.clientOpId)); if(errs.length) alertBox(errs.map(e=>e.error).join(' | ')); else if(done.size) load(); }catch(e){} status(); }
function alertBox(msg){ $('istatus').innerHTML=''; const p=document.createElement('span'); p.className='err'; p.textContent=msg; $('istatus').appendChild(p); }

// ---------- today
function renderToday(d){ const L=$('today'); L.innerHTML=''; if(!d){L.textContent='No data yet.';return}
  if(!(d.jobs||[]).length){ const p=document.createElement('p'); p.className='muted'; p.textContent='No jobs planned today.'; L.appendChild(p); }
  (d.jobs||[]).forEach(j=>{ const c=document.createElement('div'); c.className='card'; const h=document.createElement('b'); h.textContent=j.ref+' · '+(j.vehicle||'')+' · '+(j.start||'').replace('T',' '); c.appendChild(h);
    (j.tasks||[]).forEach(t=>{ const row=document.createElement('div'); row.className='row'; const s=document.createElement('span'); s.textContent=(t.done?'✓ ':'')+t.name+' ('+t.hours+' h)'; row.appendChild(s);
      if(!t.done){ const inp=document.createElement('input'); inp.type='number'; inp.step='0.1'; inp.min='0.1'; inp.placeholder='actual h'; inp.style.width='110px'; const b=document.createElement('button'); b.textContent='Done';
        b.onclick=()=>{ const h=parseFloat(inp.value); if(!(h>0)) return inp.focus(); S.q=[...S.q,{clientOpId:crypto.randomUUID(),type:'clock',taskId:t.id,actualHours:h,done:true}]; t.done=true; S.cache=d; renderToday(d); sync(); };
        row.appendChild(inp); row.appendChild(b);} c.appendChild(row); });
    L.appendChild(c); }); }

// ---------- intake form (built from the server schema, labels in the shop language)
const GROUPS={vehicle:'Vehicle',condition:'Condition at intake',customer:'Customer',job:'Work'};
const LONG=['damage','complaint','notes','itemsInCar','warningLights','tyres'];
function schema(){ return (S.cache&&S.cache.intake)||{labels:{},fields:[]}; }
function buildForm(){ const f=$('iform'); f.innerHTML=''; const sc=schema(); const d=S.draft; let g='';
  sc.fields.forEach(x=>{ const grp=['plate','vin','make','model','year','category','maxWeightKg','fuel','firstRegistration','lastInspection'].includes(x.key)?'vehicle':['mileage','fuelLevel','warningLights','damage','tyres','itemsInCar','keys'].includes(x.key)?'condition':['customerName','customerPhone','customerEmail'].includes(x.key)?'customer':'job';
    if(grp!==g){ g=grp; const h=document.createElement('h3'); h.textContent=GROUPS[g]; f.appendChild(h); }
    const wrap=document.createElement('div'); wrap.className='fld'; wrap.dataset.key=x.key;
    const lab=document.createElement('label'); const span=document.createElement('span'); span.textContent=sc.labels[x.key]||x.key; if(x.required) span.className='req'; lab.appendChild(span);
    let inp;
    if(x.enum){ inp=document.createElement('select'); const o0=document.createElement('option'); o0.value=''; o0.textContent='–'; inp.appendChild(o0); x.enum.forEach(v=>{ const o=document.createElement('option'); o.value=v; o.textContent=v==='M1'?'M1 – passenger car':v==='N1'?'N1 – van ≤ 3.5 t':v; inp.appendChild(o); }); }
    else if(x.key==='customerWaiting'){ inp=document.createElement('input'); inp.type='checkbox'; inp.style.width='auto'; }
    else if(LONG.includes(x.key)){ inp=document.createElement('textarea'); inp.rows=2; }
    else { inp=document.createElement('input'); inp.type=['mileage','year','keys','maxWeightKg'].includes(x.key)?'number':['firstRegistration','lastInspection','promisedBy'].includes(x.key)?'date':x.key==='customerPhone'?'tel':x.key==='customerEmail'?'email':'text'; if(x.key==='maxWeightKg'){inp.max=3500;} }
    inp.id='f_'+x.key; if(x.key==='customerWaiting') inp.checked=!!d[x.key]; else if(d[x.key]!=null) inp.value=d[x.key];
    inp.oninput=inp.onchange=()=>{ const v=x.key==='customerWaiting'?inp.checked:inp.value; const dd=S.draft; if(v===''||v===false) delete dd[x.key]; else dd[x.key]=['mileage','year','keys','maxWeightKg'].includes(x.key)?Number(v):v; S.draft=dd; mark(); };
    lab.appendChild(inp); wrap.appendChild(lab);
    if(SR && x.key!=='customerWaiting' && !x.enum){ const m=document.createElement('button'); m.type='button'; m.className='mic'; m.textContent='🎤'; m.onclick=()=>listen(m,txt=>{ if(LONG.includes(x.key)&&inp.value) inp.value+=' '+txt; else inp.value=x.key==='plate'||x.key==='vin'?txt.toUpperCase().replace(/[^A-Z0-9 ]/g,''):txt.replace(/[.]$/,''); inp.oninput(); }); wrap.appendChild(m); }
    f.appendChild(wrap); });
  mark(); }
function missing(){ const d=S.draft; const m=[]; schema().fields.forEach(x=>{ if(x.required===true && (d[x.key]==null||d[x.key]==='')) m.push(x.key); }); if(!d.plate&&!d.vin) m.push('plate'); if(d.maxWeightKg>3500) m.push('maxWeightKg'); return m; }
function mark(){ const m=missing(); document.querySelectorAll('#iform .fld').forEach(w=>w.classList.toggle('miss',m.includes(w.dataset.key))); const L=schema().labels; $('istatus').innerHTML=''; const p=document.createElement('span'); p.className=m.length?'err':'ok'; p.textContent=m.length?('Missing: '+m.map(k=>L[k]||k).join(', ')):'✓ Ready to save'; if(S.draft.maxWeightKg>3500) p.textContent+=' – over 3.5 t: not accepted'; $('istatus').appendChild(p); }

// ---------- voice
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
function listen(btn,onText,continuous){ if(!SR){alertBox('Voice input is not supported in this browser – use Chrome, Edge or Safari, or type.');return;}
  const r=new SR(); r.lang=(S.cache&&S.cache.locale)||'sk-SK'; r.interimResults=true; r.continuous=!!continuous; let final='';
  btn.classList.add('rec'); const old=btn.textContent; if(continuous) btn.textContent='⏹ Stop';
  r.onresult=e=>{ let interim=''; for(let i=e.resultIndex;i<e.results.length;i++){ const t=e.results[i][0].transcript; if(e.results[i].isFinal) final+=t+' '; else interim+=t; } $('heard').textContent=(final+interim).trim(); };
  r.onerror=e=>{ alertBox('Microphone: '+e.error+(e.error==='not-allowed'?' – allow the microphone for this page':'')); };
  r.onend=()=>{ btn.classList.remove('rec'); btn.textContent=old; btn.onclick=btn._start; if(final.trim()) onText(final.trim()); };
  btn._start=btn.onclick; btn.onclick=()=>r.stop(); r.start(); }
$('dictAll').onclick=function(){ listen(this, async txt=>{ const d=S.draft; d._transcript=((d._transcript||'')+' '+txt).trim(); S.draft=d;
  if(!navigator.onLine){ alertBox('Offline – dictation saved as note; fill fields by typing.'); d.notes=((d.notes||'')+' '+txt).trim(); S.draft=d; buildForm(); return; }
  try{ const r=await api('/api/app/intake/parse',{method:'POST',body:JSON.stringify({text:txt,current:S.draft})}); const dd=S.draft; Object.entries(r.fields).forEach(([k,v])=>{ if(v!=null&&v!=='') dd[k]=v; }); S.draft=dd; buildForm(); }catch(e){ alertBox('Could not process dictation: '+e.message); } }, true); };
$('isave').onclick=()=>{ const m=missing(); if(m.length){ mark(); return; } const d={...S.draft}; const text=d._transcript||''; delete d._transcript;
  S.q=[...S.q,{clientOpId:crypto.randomUUID(),type:'intake',fields:d,text,complete:true}]; S.draft={}; buildForm(); $('istatus').innerHTML='<span class="ok">✓ Intake saved – job created in the planning queue</span>'; sync(); };

// ---------- shell
async function load(){ renderToday(S.cache); try{ const d=await api('/api/app/today'); S.cache=d; renderToday(d); if(!$('intake').hidden) buildForm(); }catch(e){} status(); }
function tab(which){ $('today').hidden=which!=='today'; $('intake').hidden=which!=='intake'; $('tToday').classList.toggle('on',which==='today'); $('tIntake').classList.toggle('on',which==='intake'); if(which==='intake') buildForm(); }
$('tToday').onclick=()=>tab('today'); $('tIntake').onclick=()=>tab('intake');
function show(){ $('login').hidden=!!S.t; $('app').hidden=!S.t; if(S.t){load();sync();} }
$('go').onclick=async()=>{ $('lerr').textContent=''; const r=await fetch('/api/app/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:$('em').value,password:$('pw').value})}); if(!r.ok){$('lerr').textContent=r.status===429?'Too many attempts – wait 10 minutes':'Sign-in failed';return} S.t=(await r.json()).access_token; show(); };
$('out').onclick=()=>{S.t=null;show()};
if(!SR){ $('dictAll').hidden=true; $('dictHint').textContent='Voice input needs Chrome, Edge or Safari – you can type everything.'; }
addEventListener('online',sync); addEventListener('offline',status); setInterval(sync,30000); show();
</script>`, { head: '<meta name="theme-color" content="#0b6bcb">', noTranslate: true });
}

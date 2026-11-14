// Mechanic tablet: today's tasks, clock actual time, works offline (queue + idempotent sync).
// Fixes "if we lose internet the whole shop is down".
import { page } from './html.js';

export const SERVICE_WORKER = `
const C='caree-app-v1';
self.addEventListener('install',e=>e.waitUntil(caches.open(C).then(c=>c.addAll(['/app']))));
self.addEventListener('fetch',e=>{ const u=new URL(e.request.url); if(e.request.method==='GET' && u.pathname==='/app'){ e.respondWith(fetch(e.request).then(r=>{caches.open(C).then(c=>c.put(e.request,r.clone()));return r;}).catch(()=>caches.match(e.request))); }});`;

export function tabletPage() {
  return page('Caree – Workshop', `
<h1>Caree – workshop</h1>
<div id="login" class="card" hidden>
  <label>E-mail<input id="em" type="email" autocomplete="username"></label>
  <label>Password<input id="pw" type="password" autocomplete="current-password"></label>
  <button id="go">Sign in</button> <span id="lerr" class="err"></span>
</div>
<div id="app" hidden>
  <p class="muted"><span id="net"></span> · <span id="q"></span> <button class="secondary" id="out">Sign out</button></p>
  <div id="list"></div>
</div>
<script>
const $=id=>document.getElementById(id);
const S={get t(){return localStorage.getItem('caree_t')}, set t(v){v?localStorage.setItem('caree_t',v):localStorage.removeItem('caree_t')},
  get q(){try{return JSON.parse(localStorage.getItem('caree_q')||'[]')}catch{return []}}, set q(v){localStorage.setItem('caree_q',JSON.stringify(v))},
  get cache(){try{return JSON.parse(localStorage.getItem('caree_today')||'null')}catch{return null}}, set cache(v){localStorage.setItem('caree_today',JSON.stringify(v))}};
if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
async function api(p,o={}){const r=await fetch(p,{...o,headers:{'content-type':'application/json',authorization:'Bearer '+S.t}});if(r.status===401){S.t=null;show();throw new Error('auth')}if(!r.ok)throw new Error(r.status);return r.json()}
function status(){ $('net').textContent=navigator.onLine?'online':'OFFLINE – changes are saved on this tablet'; $('q').textContent=S.q.length?S.q.length+' change(s) waiting to sync':'all synced'; }
async function sync(){ if(!navigator.onLine||!S.q.length) return status(); try{ const res=await api('/api/app/sync',{method:'POST',body:JSON.stringify({ops:S.q})}); const done=new Set(res.results.filter(r=>r.status!=='error').map(r=>r.clientOpId)); S.q=S.q.filter(o=>!done.has(o.clientOpId)); }catch(e){} status(); }
function render(d){ const L=$('list'); L.innerHTML=''; if(!d){L.textContent='No data yet.';return}
  (d.jobs||[]).forEach(j=>{ const c=document.createElement('div'); c.className='card'; const h=document.createElement('b'); h.textContent=j.ref+' · '+(j.vehicle||'')+' · '+(j.start||'').replace('T',' '); c.appendChild(h);
    (j.tasks||[]).forEach(t=>{ const row=document.createElement('div'); row.className='row'; const s=document.createElement('span'); s.textContent=(t.done?'✓ ':'')+t.name+' ('+t.hours+' h)'; row.appendChild(s);
      if(!t.done){ const inp=document.createElement('input'); inp.type='number'; inp.step='0.1'; inp.min='0.1'; inp.placeholder='actual h'; inp.style.width='110px'; const b=document.createElement('button'); b.textContent='Done';
        b.onclick=()=>{ const h=parseFloat(inp.value); if(!(h>0)) return inp.focus(); S.q=[...S.q,{clientOpId:crypto.randomUUID(),type:'clock',taskId:t.id,actualHours:h,done:true}]; t.done=true; S.cache=d; render(d); sync(); };
        row.appendChild(inp); row.appendChild(b);} c.appendChild(row); });
    L.appendChild(c); }); }
async function load(){ render(S.cache); try{ const d=await api('/api/app/today'); S.cache=d; render(d);}catch(e){} status(); }
function show(){ $('login').hidden=!!S.t; $('app').hidden=!S.t; if(S.t){load();sync();} }
$('go').onclick=async()=>{ $('lerr').textContent=''; const r=await fetch('/api/app/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:$('em').value,password:$('pw').value})}); if(!r.ok){$('lerr').textContent='Sign-in failed';return} S.t=(await r.json()).access_token; show(); };
$('out').onclick=()=>{S.t=null;show()};
addEventListener('online',sync); addEventListener('offline',status); setInterval(sync,30000); show();
</script>`);
}

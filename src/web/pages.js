const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="112" fill="#0B6BCB"/>
  <path d="M368 162A140 140 0 1 0 396 256H346" fill="none" stroke="#fff" stroke-width="56" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="256" cy="256" r="46" fill="#fff"/>
  <g stroke="#fff" stroke-width="18" stroke-linecap="round">
    <path d="M256 210V150M216 233l-52-30M216 279l-52 30M256 302v60"/>
  </g>
  <circle cx="256" cy="256" r="16" fill="#0B6BCB"/>
</svg>`;
// Public pages: driver booking link, estimate approval link (no app install, no account), landing.
import express from 'express';
import { page, esc } from './html.js';
import { strings, pickLanguage, LANGUAGES } from '../config/i18n.js';
import { COUNTRIES } from '../config/countries.js';
import { PLANS } from '../config/plans.js';
import { formatMoney } from '../core/estimator.js';
import { privacyPage, termsPage, dpaPage, supportPage } from './legal.js';
import { tabletPage, SERVICE_WORKER } from './tablet.js';

export function publicRouter(svc, { baseUrl, provider }) {
  const r = express.Router();
  const form = express.urlencoded({ extended: false, limit: '20kb' });

  r.get('/', (req, res) => res.type('html').send(page('Garagee – AI workshop assistant', `
    <h1 translate="no">Garagee</h1><p>The AI workshop assistant for repair shops servicing passenger cars and vans up to 3.5 t – vehicle intake by voice, bookings, estimates, digital inspections, workshop planning and parts ordering, right inside ChatGPT.</p>
    <p class="muted">Available in ${LANGUAGES.length} languages with country rules for Slovakia, Czechia, Germany, Austria, Poland, Hungary, France, Italy, Spain, the Netherlands, Belgium, the UK, the US, Canada and Australia.</p>
    <p><a href="/signup"><b>Create your shop</b></a> · <a href="/app">Workshop tablet</a> · <a href="/plans">Plans</a></p>
    <p><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/dpa">DPA</a> · <a href="/support">Support</a></p>`)));

  // ---- self-service sign-up of a shop (owner account) ----
  const signupHits = new Map();
  const limited = (ip) => { const now = Date.now(); const h = (signupHits.get(ip) || []).filter((t) => now - t < 3600e3); h.push(now); signupHits.set(ip, h); return h.length > 5; };
  const countryOptions = (sel) => Object.entries(COUNTRIES).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${esc(v.name)}</option>`).join('');
  const signupForm = (v = {}, err = '') => page('Create your shop – Garagee', `
    <h1>Create your shop</h1>
    <p class="muted">For independent repair shops servicing passenger cars and vans up to 3.5 t. You become the owner of the shop account; your shop is the controller of its customers' data and housee s.r.o. processes it on your behalf.</p>
    ${err ? `<p class="err" role="alert">${esc(err)}</p>` : ''}
    <form method="post" action="/signup" class="card">
      <label>Shop name<br><input name="shopName" required maxlength="80" value="${esc(v.shopName || '')}"></label><br>
      <label>Country<br><select name="country" required>${countryOptions(v.country || 'SK')}</select></label><br>
      <label>Your name<br><input name="ownerName" maxlength="80" value="${esc(v.ownerName || '')}"></label><br>
      <label>E-mail (your login)<br><input type="email" name="email" required value="${esc(v.email || '')}" autocomplete="username"></label><br>
      <label>Password (at least 10 characters)<br><input type="password" name="password" required minlength="10" autocomplete="new-password"></label><br>
      <label><input type="checkbox" name="accept" value="1" required> I accept the <a href="/terms" target="_blank">Terms</a> and the <a href="/dpa" target="_blank">Data Processing Agreement</a> and have read the <a href="/privacy" target="_blank">Privacy Policy</a>.</label><br>
      <button type="submit">Create shop</button>
    </form>`);
  r.get('/signup', (_q, res) => res.type('html').send(signupForm()));
  r.post('/signup', form, (req, res) => {
    const b = req.body || {};
    if (limited(req.ip)) return res.status(429).type('html').send(signupForm(b, 'Too many sign-ups from this network – try again in an hour.'));
    if (b.accept !== '1') return res.status(400).type('html').send(signupForm(b, 'Please accept the Terms and the Data Processing Agreement.'));
    try {
      const { tenant, user } = svc.signup({ shopName: b.shopName, country: b.country, ownerName: b.ownerName, email: b.email, password: b.password });
      res.type('html').send(page('Shop created – Garagee', `
        <h1>Your shop is ready</h1>
        <p><b>${esc(tenant.name)}</b> – sign in with <b>${esc(user.email)}</b>.</p>
        <h2>Next steps</h2>
        <ol>
          <li>In ChatGPT open <b>Apps</b>, find <b>Garagee</b> and choose <b>Connect</b>. Sign in with the e-mail and password above.</li>
          <li>Ask: <i>“Set up my workshop: 2 lifts, mechanics Peter and Jana, labour rate 45 € per hour.”</i></li>
          <li>On the workshop tablet open <a href="/app">${esc(new URL('/app', baseUrl).href)}</a> for today's jobs and voice intake.</li>
        </ol>
        <p class="muted">Your public booking link for drivers: <a href="/b/${esc(tenant.publicSlug || tenant.public_slug || '')}">${esc(new URL('/b/' + (tenant.publicSlug || tenant.public_slug || ''), baseUrl).href)}</a></p>`));
    } catch (e) {
      res.status(400).type('html').send(signupForm(b, e.message || 'Sign-up failed.'));
    }
  });


  // ---- plans (website only; never shown or linked inside ChatGPT) ----
  r.get('/plans', (_q, res) => {
    const lim = (v) => v == null ? 'unlimited' : v.toLocaleString('en');
    res.type('html').send(page('Plans – Garagee', `
    <h1>Garagee plans</h1>
    <p class="muted">Every shop starts on <b>Start</b>. The same limits apply in ChatGPT, on the workshop tablet and on the web. Existing vehicles always keep working; at the limit only adding new vehicles is paused.</p>
    <table><tr><th></th><th>Start</th><th>Profi</th><th>Workshop+</th></tr>
      <tr><td>Active vehicles</td><td>${lim(PLANS.start.vehicles)}</td><td>${lim(PLANS.profi.vehicles)}</td><td>${lim(PLANS.workshop.vehicles)}</td></tr>
      <tr><td>Users</td><td>1</td><td>up to 5</td><td>unlimited, several locations</td></tr>
      <tr><td>Vehicle intake (typing or voice), estimates, free slots, bookings, workshop plan</td><td>✓</td><td>✓</td><td>✓</td></tr>
      <tr><td>Workshop tablet with offline mode</td><td>✓</td><td>✓</td><td>✓</td></tr>
      <tr><td>Digital inspection and customer approval link</td><td>✓</td><td>✓</td><td>✓</td></tr>
      <tr><td>Parts orders</td><td>by e-mail</td><td>by e-mail; supplier systems – planned</td><td>by e-mail; supplier systems – planned</td></tr>
      <tr><td>Service and inspection reminders to customers (SMS / e-mail)</td><td>–</td><td>planned</td><td>planned</td></tr>
      <tr><td>Invoicing and accounting export</td><td>–</td><td>planned</td><td>planned</td></tr>
      <tr><td>Model-specific labour times</td><td>catalogue</td><td>catalogue</td><td>planned</td></tr>
      <tr><td>Data import from your previous system</td><td>–</td><td>✓ (on request)</td><td>✓ (on request)</td></tr>
      <tr><td>Support</td><td>e-mail</td><td>priority e-mail</td><td>phone</td></tr>
    </table>
    <p>Profi and Workshop+ are arranged directly with housee s.r.o. – write to <a href="/support">support</a>.</p>`));
  });

  // ---- account deletion by the shop owner ----
  const deleteForm = (err = '') => page('Delete shop account – Garagee', `
    <h1>Delete your shop account</h1>
    <p>This permanently deletes your shop and all data stored for it in Garagee: customers, vehicles, jobs, inspections, settings and all user accounts of the shop. Export anything you need first (in ChatGPT: “export the data of customer …”). This cannot be undone.</p>
    ${err ? `<p class="err" role="alert">${esc(err)}</p>` : ''}
    <form method="post" action="/account/delete" class="card">
      <label>Owner e-mail<br><input type="email" name="email" required autocomplete="username"></label><br>
      <label>Password<br><input type="password" name="password" required autocomplete="current-password"></label><br>
      <label>Type DELETE to confirm<br><input name="confirm" required pattern="DELETE"></label><br>
      <button type="submit">Delete permanently</button>
    </form>`);
  r.get('/account/delete', (_q, res) => res.type('html').send(deleteForm()));
  r.post('/account/delete', form, (req, res) => {
    const b = req.body || {};
    if (b.confirm !== 'DELETE') return res.status(400).type('html').send(deleteForm('Type DELETE to confirm.'));
    const c = provider ? provider.checkLogin(b.email, b.password) : { user: svc.login(b.email, b.password) };
    if (!c.user) return res.status(c.status || 401).type('html').send(deleteForm(c.error || 'Wrong e-mail or password.'));
    if (c.user.role !== 'owner') return res.status(403).type('html').send(deleteForm('Only the shop owner can delete the shop.'));
    svc.deleteTenant(c.user.tenantId);
    res.type('html').send(page('Shop deleted – Garagee', '<h1>Your shop has been deleted</h1><p>All data stored for it in Garagee was removed. Copies in backups expire automatically within 30 days.</p>'));
  });

  r.get('/privacy', (_q, res) => res.type('html').send(privacyPage()));
  r.get('/terms', (_q, res) => res.type('html').send(termsPage()));
  r.get('/dpa', (_q, res) => res.type('html').send(dpaPage()));
  r.get('/support', (_q, res) => res.type('html').send(supportPage()));
  r.get('/health', (_q, res) => res.json({ ok: true }));
  r.get(['/logo.svg', '/favicon.svg'], (_q, res) => res.type('image/svg+xml').set('cache-control', 'public, max-age=86400').send(LOGO_SVG));
  r.get('/.well-known/openai-apps-challenge', (_q, res) => {
    if (!process.env.OPENAI_APPS_CHALLENGE) return res.status(404).type('text').send('not configured');
    res.type('text/plain').send(process.env.OPENAI_APPS_CHALLENGE);
  });

  // Driver booking request – the fix for "no scheduling link for customers"
  r.get('/b/:slug', (req, res) => {
    let shop; try { shop = svc.tenantBySlug(req.params.slug); } catch { return res.status(404).type('html').send(page('Garagee', '<p>Shop not found.</p>')); }
    const lang = pickLanguage(req.get('accept-language'), svc.settings(shop.id).language);
    const L = strings(lang);
    res.type('html').send(page(`${shop.name} – ${L.book}`, `
      <h1>${esc(L.book)}</h1><p class="muted">${esc(shop.name)}</p>
      <form method="post"><input type="hidden" name="language" value="${esc(lang)}">
      <label>${esc(L.service)}<textarea name="service" rows="3" required maxlength="500"></textarea></label>
      <label>${esc(L.plate)}<input name="plate" maxlength="20"></label>
      <label>${esc(L.date)}<input name="date" type="date"></label>
      <label>${esc(L.name)}<input name="name" required maxlength="120" autocomplete="name"></label>
      <label>${esc(L.phone)}<input name="phone" required maxlength="40" autocomplete="tel"></label>
      <label>${esc(L.email)}<input name="email" type="email" maxlength="160" autocomplete="email"></label>
      <label class="chk"><input type="checkbox" name="consent" value="1" required> <span>${esc(L.consent)} <a href="/privacy">${esc(L.privacy)}</a></span></label>
      <button type="submit">${esc(L.submit)}</button></form>`, { lang }));
  });
  r.post('/b/:slug', form, (req, res) => {
    const L = strings(req.body.language);
    try { svc.bookingRequest(req.params.slug, { ...req.body, consent: req.body.consent === '1' }); res.type('html').send(page('Garagee', `<h1>✓</h1><p>${esc(L.thanks)}</p>`, { lang: req.body.language })); }
    catch (e) { res.status(400).type('html').send(page('Garagee', `<p class="err">${esc(e.message)}</p>`)); }
  });

  // Estimate approval – evidence-based, no pressure; declined items are remembered for the next visit
  r.get('/q/:token', (req, res) => {
    let q; try { q = svc.quoteByToken(req.params.token); } catch { return res.status(404).type('html').send(page('Garagee', '<p>Link not valid.</p>')); }
    const lang = q.language || pickLanguage(req.get('accept-language'), q.shop.language);
    const L = strings(lang);
    const cur = q.shop.currency, loc = q.shop.locale;
    const items = q.recommendations.map((i) => `
      <div class="card"><div class="${esc(i.status)}"><b>${i.status === 'red' ? esc(L.urgent) : i.status === 'amber' ? esc(L.soon) : esc(L.ok)}</b> – ${esc(i.item)}</div>
      ${i.note ? `<div>${esc(i.note)}</div>` : ''}${i.measurement ? `<div class="muted">${esc(i.measurement)}</div>` : ''}
      ${(i.photoUrls || []).filter((u) => /^https:\/\//.test(u)).map((u) => `<img src="${esc(u)}" alt="" style="max-width:100%;border-radius:8px;margin-top:8px">`).join('')}
      <div class="row" style="margin-top:8px"><b>${esc(formatMoney(i.price, cur, loc))}</b></div>
      ${i.decision === 'pending' ? `<div class="row"><label class="chk"><input type="radio" name="d_${esc(i.id)}" value="approved"> ${esc(L.approve)}</label><label class="chk"><input type="radio" name="d_${esc(i.id)}" value="declined"> ${esc(L.decline)}</label></div>` : `<div class="muted">${esc(i.decision === 'approved' ? L.approved : L.declined)}</div>`}
      </div>`).join('');
    res.type('html').send(page(`${q.shop.name} – ${L.quote}`, `
      <h1>${esc(L.quote)}</h1><p class="muted">${esc(q.shop.name)} · ${esc([q.job.vehicle?.plate, q.job.vehicle?.make, q.job.vehicle?.model].filter(Boolean).join(' '))} · ${esc(q.job.ref)}</p>
      <form method="post">${items || '<p>–</p>'}${q.recommendations.some((i) => i.decision === 'pending') ? `<button type="submit">${esc(L.submit)}</button>` : ''}</form>
      <p class="muted small">${esc(L.estimateNote)} ${q.shop.vatRate ? `(${esc(L.total)}: ${esc(q.shop.vatRate)} %)` : ''}</p>`, { lang }));
  });
  r.post('/q/:token', form, (req, res) => {
    const decisions = Object.entries(req.body).filter(([k]) => k.startsWith('d_')).map(([k, v]) => ({ itemId: k.slice(2), decision: v === 'approved' ? 'approved' : 'declined' }));
    try { const out = svc.decide(req.params.token, decisions); res.redirect(303, `/q/${encodeURIComponent(req.params.token)}?saved=${out.added.length}`); }
    catch (e) { res.status(400).type('html').send(page('Garagee', `<p class="err">${esc(e.message)}</p>`)); }
  });

  // Tablet app for mechanics (offline-capable PWA)
  r.get('/app', (_q, res) => res.type('html').send(tabletPage()));
  r.get('/sw.js', (_q, res) => res.type('application/javascript').set('Service-Worker-Allowed', '/').send(SERVICE_WORKER));
  return r;
}

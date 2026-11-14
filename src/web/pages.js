// Public pages: driver booking link, estimate approval link (no app install, no account), landing.
import express from 'express';
import { page, esc } from './html.js';
import { strings, pickLanguage, LANGUAGES } from '../config/i18n.js';
import { formatMoney } from '../core/estimator.js';
import { privacyPage, termsPage, dpaPage, supportPage } from './legal.js';
import { tabletPage, SERVICE_WORKER } from './tablet.js';

export function publicRouter(svc, { baseUrl }) {
  const r = express.Router();
  const form = express.urlencoded({ extended: false, limit: '20kb' });

  r.get('/', (req, res) => res.type('html').send(page('Caree – AI workshop assistant', `
    <h1 translate="no">Caree</h1><p>The AI workshop assistant for repair shops servicing passenger cars and vans up to 3.5 t – vehicle intake by voice, bookings, estimates, digital inspections, workshop planning and parts ordering, right inside ChatGPT.</p>
    <p class="muted">Available in ${LANGUAGES.length} languages with country rules for Slovakia, Czechia, Germany, Austria, Poland, Hungary, France, Italy, Spain, the Netherlands, Belgium, the UK, the US, Canada and Australia.</p>
    <p><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/dpa">DPA</a> · <a href="/support">Support</a></p>`)));
  r.get('/privacy', (_q, res) => res.type('html').send(privacyPage()));
  r.get('/terms', (_q, res) => res.type('html').send(termsPage()));
  r.get('/dpa', (_q, res) => res.type('html').send(dpaPage()));
  r.get('/support', (_q, res) => res.type('html').send(supportPage()));
  r.get('/health', (_q, res) => res.json({ ok: true }));
  r.get('/.well-known/openai-apps-challenge', (_q, res) => {
    if (!process.env.OPENAI_APPS_CHALLENGE) return res.status(404).type('text').send('not configured');
    res.type('text/plain').send(process.env.OPENAI_APPS_CHALLENGE);
  });

  // Driver booking request – the fix for "no scheduling link for customers"
  r.get('/b/:slug', (req, res) => {
    let shop; try { shop = svc.tenantBySlug(req.params.slug); } catch { return res.status(404).type('html').send(page('Caree', '<p>Shop not found.</p>')); }
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
    try { svc.bookingRequest(req.params.slug, { ...req.body, consent: req.body.consent === '1' }); res.type('html').send(page('Caree', `<h1>✓</h1><p>${esc(L.thanks)}</p>`, { lang: req.body.language })); }
    catch (e) { res.status(400).type('html').send(page('Caree', `<p class="err">${esc(e.message)}</p>`)); }
  });

  // Estimate approval – evidence-based, no pressure; declined items are remembered for the next visit
  r.get('/q/:token', (req, res) => {
    let q; try { q = svc.quoteByToken(req.params.token); } catch { return res.status(404).type('html').send(page('Caree', '<p>Link not valid.</p>')); }
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
    catch (e) { res.status(400).type('html').send(page('Caree', `<p class="err">${esc(e.message)}</p>`)); }
  });

  // Tablet app for mechanics (offline-capable PWA)
  r.get('/app', (_q, res) => res.type('html').send(tabletPage()));
  r.get('/sw.js', (_q, res) => res.type('application/javascript').set('Service-Worker-Allowed', '/').send(SERVICE_WORKER));
  return r;
}

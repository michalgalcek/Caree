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
import { WEB_LANGS, webLang, webT } from '../config/web-i18n.js';
import { formatMoney } from '../core/estimator.js';
import { privacyPage, termsPage, dpaPage, supportPage } from './legal.js';
import { tabletPage, SERVICE_WORKER } from './tablet.js';

export function publicRouter(svc, { baseUrl, provider }) {
  const r = express.Router();
  const form = express.urlencoded({ extended: false, limit: '20kb' });

  // Language switch shown on public website pages (?lang=xx).
  const langBar = (path, cur) => `<p class="muted small" translate="no">${WEB_LANGS.map((l) => l === cur ? `<b>${l.toUpperCase()}</b>` : `<a href="${path}?lang=${l}">${l.toUpperCase()}</a>`).join(' · ')}</p>`;
  const footer = (t, lang) => `<p><a href="/privacy">${t('privacy')}</a> · <a href="/terms">${t('terms')}</a> · <a href="/dpa">${t('dpa')}</a> · <a href="/support">${t('support')}</a>${lang !== 'en' ? ` <span class="muted small">(${t('legalNote')})</span>` : ''}</p>`;

  r.get('/', (req, res) => {
    const lang = webLang(req); const t = webT(lang); const q = lang === 'en' ? '' : `?lang=${lang}`;
    res.type('html').send(page('Garagee', `${langBar('/', lang)}
    <h1 translate="no">Garagee</h1><p>${t('tagline')}</p>
    <p class="muted">${t('langs', { n: LANGUAGES.length })}</p>
    <p><a href="/signup${q}"><b>${t('create')}</b></a> · <a href="/app">${t('tablet')}</a> · <a href="/plans${q}">${t('plans')}</a></p>
    ${footer(t, lang)}`, { lang }));
  });

  // ---- self-service sign-up of a shop (owner account) ----
  const signupHits = new Map();
  const limited = (ip) => { const now = Date.now(); const h = (signupHits.get(ip) || []).filter((x) => now - x < 3600e3); h.push(now); signupHits.set(ip, h); return h.length > 5; };
  const countryOptions = (sel) => Object.entries(COUNTRIES).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${esc(v.name)}</option>`).join('');
  const signupForm = (lang, v = {}, err = '') => { const t = webT(lang); return page(`${t('s_title')} – Garagee`, `${langBar('/signup', lang)}
    <h1>${t('s_title')}</h1>
    <p class="muted">${t('s_intro')}</p>
    ${err ? `<p class="err" role="alert">${esc(err)}</p>` : ''}
    <form method="post" action="/signup" class="card">
      <input type="hidden" name="lang" value="${lang}">
      <label>${t('shopName')}<br><input name="shopName" required maxlength="80" value="${esc(v.shopName || '')}"></label><br>
      <label>${t('country')}<br><select name="country" required>${countryOptions(v.country || { sk: 'SK', cs: 'CZ', de: 'DE', pl: 'PL', hu: 'HU', fr: 'FR', it: 'IT', es: 'ES', nl: 'NL' }[lang] || 'GB')}</select></label><br>
      <label>${t('yourName')}<br><input name="ownerName" maxlength="80" value="${esc(v.ownerName || '')}"></label><br>
      <label>${t('emailLogin')}<br><input type="email" name="email" required value="${esc(v.email || '')}" autocomplete="username"></label><br>
      <label>${t('pwd10')}<br><input type="password" name="password" required minlength="10" autocomplete="new-password"></label><br>
      <label><input type="checkbox" name="accept" value="1" required> ${t('accept', { terms: `<a href="/terms" target="_blank">${t('termsL')}</a>`, dpa: `<a href="/dpa" target="_blank">${t('dpaL')}</a>`, privacy: `<a href="/privacy" target="_blank">${t('privacyL')}</a>` })}</label><br>
      <button type="submit">${t('createBtn')}</button>
    </form>`, { lang }); };
  r.get('/signup', (req, res) => res.type('html').send(signupForm(webLang(req))));
  r.post('/signup', form, (req, res) => {
    const b = req.body || {}; const lang = WEB_LANGS.includes(b.lang) ? b.lang : webLang(req); const t = webT(lang);
    if (limited(req.ip)) return res.status(429).type('html').send(signupForm(lang, b, t('errTooMany')));
    if (b.accept !== '1') return res.status(400).type('html').send(signupForm(lang, b, t('errAccept')));
    try {
      const { tenant, user } = svc.signup({ shopName: b.shopName, country: b.country, ownerName: b.ownerName, email: b.email, password: b.password });
      const appUrl = new URL('/app', baseUrl).href; const bookUrl = new URL('/b/' + tenant.public_slug, baseUrl).href;
      res.type('html').send(page(`${t('readyTitle')} – Garagee`, `
        <h1>${t('readyTitle')}</h1>
        <p><b>${esc(tenant.name)}</b> – ${t('signInWith')} <b>${esc(user.email)}</b>.</p>
        <h2>${t('next')}</h2>
        <ol><li>${t('step1')}</li><li>${t('step2')}</li><li>${t('step3', { link: `<a href="/app">${esc(appUrl)}</a>` })}</li></ol>
        <p class="muted">${t('bookingLink')} <a href="/b/${esc(tenant.public_slug)}">${esc(bookUrl)}</a></p>`, { lang }));
    } catch (e) {
      res.status(400).type('html').send(signupForm(lang, b, e.message || t('errFail')));
    }
  });

  // ---- plans (website only; never shown or linked inside ChatGPT) ----
  r.get('/plans', (req, res) => {
    const lang = webLang(req); const t = webT(lang); const loc = lang === 'en' ? 'en' : lang;
    const lim = (v) => v == null ? t('unlimited') : v.toLocaleString(loc);
    const row = (label, a, b, c) => `<tr><td>${label}</td><td>${a}</td><td>${b}</td><td>${c}</td></tr>`;
    res.type('html').send(page(`Garagee – ${t('plans')}`, `${langBar('/plans', lang)}
    <h1><span translate="no">Garagee</span> – ${t('p_title')}</h1>
    <p class="muted">${t('p_intro')}</p>
    <table><tr><th></th><th translate="no">Start</th><th translate="no">Profi</th><th translate="no">Workshop+</th></tr>
      ${row(t('vehicles'), lim(PLANS.start.vehicles), lim(PLANS.profi.vehicles), lim(PLANS.workshop.vehicles))}
      ${row(t('users'), '1', t('upto5'), t('unlLoc'))}
      ${row(t('r_core'), '✓', '✓', '✓')}
      ${row(t('r_tablet'), '✓', '✓', '✓')}
      ${row(t('r_insp'), '✓', '✓', '✓')}
      ${row(t('r_parts'), t('byEmail'), t('supPlanned'), t('supPlanned'))}
      ${row(t('r_remind'), '–', t('planned'), t('planned'))}
      ${row(t('r_invoice'), '–', t('planned'), t('planned'))}
      ${row(t('r_labour'), t('catalogue'), t('catalogue'), t('planned'))}
      ${row(t('r_import'), '–', t('onRequest'), t('onRequest'))}
      ${row(t('r_support'), t('sEmail'), t('sPrio'), t('sPhone'))}
    </table>
    <p>${t('contact', { profi: '<span translate="no">Profi</span>', ws: '<span translate="no">Workshop+</span>', co: '<span translate="no">housee s.r.o.</span>', support: `<a href="/support">${t('support')}</a>` })}</p>
    ${footer(t, lang)}`, { lang }));
  });

  // ---- account deletion by the shop owner ----
  const deleteForm = (lang, err = '') => { const t = webT(lang); return page(`${t('d_title')} – Garagee`, `${langBar('/account/delete', lang)}
    <h1>${t('d_title')}</h1>
    <p>${t('d_text')}</p>
    ${err ? `<p class="err" role="alert">${esc(err)}</p>` : ''}
    <form method="post" action="/account/delete" class="card">
      <input type="hidden" name="lang" value="${lang}">
      <label>${t('ownerEmail')}<br><input type="email" name="email" required autocomplete="username"></label><br>
      <label>${t('password')}<br><input type="password" name="password" required autocomplete="current-password"></label><br>
      <label>${t('typeDelete')}<br><input name="confirm" required pattern="DELETE"></label><br>
      <button type="submit">${t('deleteBtn')}</button>
    </form>`, { lang }); };
  r.get('/account/delete', (req, res) => res.type('html').send(deleteForm(webLang(req))));
  r.post('/account/delete', form, (req, res) => {
    const b = req.body || {}; const lang = WEB_LANGS.includes(b.lang) ? b.lang : webLang(req); const t = webT(lang);
    if (b.confirm !== 'DELETE') return res.status(400).type('html').send(deleteForm(lang, t('errType')));
    const c = provider ? provider.checkLogin(b.email, b.password) : { user: svc.login(b.email, b.password) };
    if (!c.user) return res.status(c.status || 401).type('html').send(deleteForm(lang, c.status === 429 ? c.error : t('errWrong')));
    if (c.user.role !== 'owner') return res.status(403).type('html').send(deleteForm(lang, t('errOwner')));
    svc.deleteTenant(c.user.tenantId);
    res.type('html').send(page(`${t('deletedTitle')} – Garagee`, `<h1>${t('deletedTitle')}</h1><p>${t('deletedText')}</p>`, { lang }));
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

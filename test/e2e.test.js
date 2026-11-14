import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createApp } from '../src/server.js';
import { openDb } from '../src/db.js';

let srv, base, token, tenantSvc;
const rpcId = (() => { let i = 1; return () => i++; })();

async function mcp(method, params) {
  const r = await fetch(base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer ' + token, 'mcp-protocol-version': '2025-06-18' }, body: JSON.stringify({ jsonrpc: '2.0', id: rpcId(), method, params }) });
  const text = await r.text();
  assert.equal(r.status, 200, text);
  return JSON.parse(text);
}
const call = async (name, args = {}) => (await mcp('tools/call', { name, arguments: args })).result;

before(async () => {
  const net = await import('node:net');
  const port = await new Promise((res) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
  base = `http://localhost:${port}`;
  const { app, svc } = createApp({ db: openDb(':memory:'), baseUrl: base, seed: true });
  tenantSvc = svc;
  await new Promise((r) => { srv = app.listen(port, r); });
});
after(() => srv?.close());

test('OAuth: metadata, dynamic registration, PKCE login, token', async () => {
  const meta = await (await fetch(base + '/.well-known/oauth-authorization-server')).json();
  assert.ok(meta.registration_endpoint && meta.code_challenge_methods_supported.includes('S256'));
  const prm = await fetch(base + '/.well-known/oauth-protected-resource/mcp');
  assert.equal(prm.status, 200);
  const unauth = await fetch(base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(unauth.status, 401);
  assert.match(unauth.headers.get('www-authenticate') || '', /resource_metadata/);

  const reg = await (await fetch(meta.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'ChatGPT test', redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) })).json();
  assert.ok(reg.client_id);
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const au = new URL(meta.authorization_endpoint);
  Object.entries({ response_type: 'code', client_id: reg.client_id, redirect_uri: reg.redirect_uris[0], code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', scope: 'workshop', resource: base + '/mcp' }).forEach(([k, v]) => au.searchParams.set(k, v));
  const page = await (await fetch(au)).text();
  const rid = page.match(/name="rid" value="([^"]+)"/)[1];
  const bad = await fetch(base + '/oauth/login', { method: 'POST', redirect: 'manual', body: new URLSearchParams({ rid, email: 'demo@caree.test', password: 'wrong-password' }) });
  assert.equal(bad.status, 401);
  const login = await fetch(base + '/oauth/login', { method: 'POST', redirect: 'manual', body: new URLSearchParams({ rid, email: 'demo@caree.test', password: 'demo-password-123' }) });
  assert.equal(login.status, 302);
  const loc = new URL(login.headers.get('location'));
  assert.equal(loc.searchParams.get('state'), 'xyz');
  const tr = await fetch(meta.token_endpoint, { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code: loc.searchParams.get('code'), code_verifier: verifier, client_id: reg.client_id, redirect_uri: reg.redirect_uris[0], resource: base + '/mcp' }) });
  const tj = await tr.json();
  assert.equal(tr.status, 200, JSON.stringify(tj));
  token = tj.access_token;
  const refreshed = await (await fetch(meta.token_endpoint, { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tj.refresh_token, client_id: reg.client_id }) })).json();
  assert.ok(refreshed.access_token);
  token = refreshed.access_token;
});

test('MCP: tools listed with explicit annotations and UI template', async () => {
  const init = await mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  assert.ok(init.result.serverInfo.name === 'caree');
  const { result } = await mcp('tools/list', {});
  assert.ok(result.tools.length >= 20);
  for (const t of result.tools) for (const k of ['readOnlyHint', 'destructiveHint', 'openWorldHint']) assert.equal(typeof t.annotations[k], 'boolean', `${t.name}.${k}`);
  const slots = result.tools.find((t) => t.name === 'find_free_slots');
  assert.equal(slots._meta.ui.resourceUri, 'ui://caree/widget-v1.html');
  const res = await mcp('resources/read', { uri: 'ui://caree/widget-v1.html' });
  assert.equal(res.result.contents[0].mimeType, 'text/html;profile=mcp-app');
});

test('MCP: end-to-end workshop flow', async () => {
  const found = await call('find_vehicle', { query: 'ZA 123' });
  const vid = found.structuredContent.vehicles[0].id;
  const card = await call('get_vehicle', { vehicleId: vid });
  assert.equal(card.structuredContent.view, 'vehicle');
  assert.ok(card.structuredContent.nextInspection.due);
  const est = await call('estimate_job', { operations: ['TIMING_BELT', 'WATER_PUMP'], vehicleId: vid });
  assert.ok(!est.isError, est.content[0].text);
  assert.equal(est.structuredContent.vatRate, 23);
  const slots = await call('find_free_slots', { operations: ['OIL_SERVICE'], vehicleId: vid });
  assert.ok(slots.structuredContent.slots.length >= 1, slots.content[0].text);
  const booked = await call('book_appointment', { vehicleId: vid, operations: ['OIL_SERVICE'], start: slots.structuredContent.slots[0].start });
  assert.ok(!booked.isError, booked.content[0].text);
  const ref = booked.structuredContent.job.ref;
  const again = await call('book_appointment', { vehicleId: vid, operations: ['CLUTCH'], start: slots.structuredContent.slots[0].start });
  // either placed in parallel on a second lift or refused – never double-books one lift
  if (!again.isError) assert.notEqual(again.structuredContent.job.bayId, booked.structuredContent.job.bayId);
  const st = await call('job_status', { query: 'J-00001' });
  assert.match(st.content[0].text, /approval/);
  const link = await call('create_approval_link', { jobRef: 'J-00001' });
  const url = link.structuredContent.url;
  const qpage = await (await fetch(url)).text();
  assert.match(qpage, /21\.4 mm/);
  const items = [...qpage.matchAll(/name="d_([^"]+)" value="approved"/g)].map((m) => m[1]);
  const form = new URLSearchParams({ ['d_' + items[0]]: 'approved', ['d_' + items[1]]: 'declined' });
  const post = await fetch(url, { method: 'POST', body: form, redirect: 'manual' });
  assert.equal(post.status, 303);
  const card2 = await call('get_vehicle', { vehicleId: vid });
  assert.equal(card2.structuredContent.declinedWorkToRemind.length, 1);
  const cmp = await call('compare_parts', { jobRef: 'J-00001' });
  assert.ok(!cmp.isError, cmp.content[0].text);
  const best = Object.values(cmp.structuredContent.best).filter(Boolean);
  assert.ok(best.length > 0);
  const noConfirm = await call('order_parts', { jobRef: 'J-00001', supplierId: best[0].supplierId, items: [{ code: best[0].code, name: best[0].name, qty: 1 }] });
  assert.equal(noConfirm.isError, true);
  const ord = await call('order_parts', { jobRef: 'J-00001', supplierId: best[0].supplierId, items: [{ code: best[0].code, name: best[0].name, qty: 1, eta: best[0].eta }], confirmed: true });
  assert.ok(!ord.isError, ord.content[0].text);
  const plan = await call('plan_workshop', {});
  assert.equal(plan.structuredContent.view, 'plan');
  const cancel = await call('cancel_appointment', { jobRef: ref });
  assert.match(cancel.content[0].text, /cancelled/);
  const up = await call('upcoming_services', { days: 365 });
  assert.ok(!up.isError);
  const rules = await call('country_rules', { country: 'AT' });
  assert.match(rules.content[0].text, /Pickerl/);
  const vin = await call('decode_vin', { vin: 'WVWZZZ1KZAW000001' });
  assert.match(vin.content[0].text, /Volkswagen/);
});

test('Tenant isolation: another shop cannot see demo data', async () => {
  const t2 = tenantSvc.createTenant({ name: 'Other', country: 'DE' });
  assert.equal(tenantSvc.q('SELECT COUNT(*) n FROM vehicles WHERE tenant_id=?').get(t2.id).n, 0);
  const r = (() => { try { return tenantSvc.findVehicles(t2.id, 'ZA 123'); } catch { return []; } })();
  assert.equal(r.length, 0);
});

test('Public booking page, legal pages, offline sync', async () => {
  const slug = tenantSvc.q('SELECT public_slug FROM tenants LIMIT 1').get().public_slug;
  const pg = await fetch(`${base}/b/${slug}`, { headers: { 'accept-language': 'de-DE' } });
  assert.match(await pg.text(), /Service buchen/);
  const post = await fetch(`${base}/b/${slug}`, { method: 'POST', body: new URLSearchParams({ name: 'Max', phone: '+49 1', service: 'Ölwechsel', consent: '1', language: 'de' }) });
  assert.equal(post.status, 200);
  for (const p of ['/privacy', '/terms', '/dpa', '/support']) assert.equal((await fetch(base + p)).status, 200, p);
  const login = await (await fetch(base + '/api/app/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'demo@caree.test', password: 'demo-password-123' }) })).json();
  const auth = { authorization: 'Bearer ' + login.access_token, 'content-type': 'application/json' };
  const job = tenantSvc.q(`SELECT jt.id FROM job_tasks jt JOIN jobs j ON j.id=jt.job_id WHERE j.ref='J-00001' LIMIT 1`).get();
  const op = { clientOpId: 'op-1', type: 'clock', taskId: job.id, actualHours: 0.7, done: true };
  const s1 = await (await fetch(base + '/api/app/sync', { method: 'POST', headers: auth, body: JSON.stringify({ ops: [op] }) })).json();
  const s2 = await (await fetch(base + '/api/app/sync', { method: 'POST', headers: auth, body: JSON.stringify({ ops: [op] }) })).json();
  assert.equal(s1.results[0].status, 'applied');
  assert.equal(s2.results[0].status, 'duplicate');
});

test('GDPR: erase keeps jobs, removes personal data', async () => {
  const c = tenantSvc.q('SELECT id, tenant_id FROM customers WHERE name=?').get('Ján Novák');
  const before = tenantSvc.q('SELECT COUNT(*) n FROM jobs WHERE customer_id=?').get(c.id).n;
  const r = await call('erase_customer_data', { customerId: c.id, confirmed: true });
  assert.ok(!r.isError, r.content[0].text);
  const row = tenantSvc.q('SELECT * FROM customers WHERE id=?').get(c.id);
  assert.equal(row.phone, null);
  assert.equal(tenantSvc.q('SELECT COUNT(*) n FROM jobs WHERE customer_id=?').get(c.id).n, before);
});

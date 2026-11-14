// Caree HTTP server: MCP endpoint (/mcp), OAuth 2.1, public pages, tablet API.
import express from 'express';
import { fileURLToPath } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { openDb } from './db.js';
import { Caree } from './services.js';
import { CareeOAuthProvider, SCOPES } from './auth.js';
import { buildMcpServer } from './mcp.js';
import { publicRouter } from './web/pages.js';
import { seedDemo } from './seed.js';
import { localNow } from './services.js';
import { parseIntakeText, intakeLabels, intakeStatus, INTAKE_FIELDS } from './core/intake.js';

export function createApp({ db = openDb(), baseUrl = process.env.PUBLIC_URL || 'http://localhost:3000', fetchImpl, seed = process.env.DEMO_SEED === '1' } = {}) {
  const svc = new Caree(db, { fetchImpl });
  if (seed) {
    try { seedDemo(svc); } catch (e) { console.warn(`[caree] demo account not created: ${e.message}`); }
  }
  const provider = new CareeOAuthProvider(db, svc);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((req, res, next) => { res.set({ 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }); if (!req.path.startsWith('/mcp')) res.set('x-frame-options', 'DENY'); next(); });

  const issuer = new URL(baseUrl);
  const mcpUrl = new URL('/mcp', baseUrl);
  app.use(mcpAuthRouter({ provider, issuerUrl: issuer, baseUrl: issuer, resourceServerUrl: mcpUrl, scopesSupported: SCOPES, resourceName: 'Caree', serviceDocumentationUrl: new URL('/support', baseUrl) }));
  app.post('/oauth/login', express.urlencoded({ extended: false, limit: '10kb' }), (req, res) => provider.handleLogin(req, res));

  const bearer = requireBearerAuth({ verifier: provider, requiredScopes: [], resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl) });

  // Stateless MCP: a fresh server + transport per request (scales horizontally, no sticky sessions).
  app.post('/mcp', bearer, express.json({ limit: '1mb' }), async (req, res) => {
    const server = buildMcpServer(svc, { baseUrl });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close(); server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    }
  });
  app.get('/mcp', (_q, res) => res.status(405).set('allow', 'POST').json({ error: 'Use POST' }));
  app.delete('/mcp', (_q, res) => res.status(405).set('allow', 'POST').end());

  // Tablet API (first-party client)
  app.post('/api/app/login', express.json({ limit: '10kb' }), (req, res) => {
    const c = provider.checkLogin(req.body?.email, req.body?.password);
    if (c.error) return res.status(c.status).json({ error: c.status === 429 ? 'too_many_attempts' : 'invalid_credentials' });
    res.json(provider.issue('caree-web', c.user.id, SCOPES, null));
  });
  app.get('/api/app/today', bearer, (req, res) => {
    const tid = req.auth.extra.tenantId;
    const day = localNow(svc.settings(tid).timezone).slice(0, 10);
    const jobs = svc.plan(tid, day).jobs.map((j) => {
      const full = svc.job(tid, j.ref);
      return { ref: j.ref, start: j.start, vehicle: [full.vehicle?.plate, full.vehicle?.make, full.vehicle?.model].filter(Boolean).join(' '), tasks: full.tasks.map((t) => ({ id: t.id, name: t.name, hours: t.hours, done: t.done })) };
    });
    const st = svc.settings(tid);
    res.json({ date: day, jobs, language: st.language, locale: st.locale, country: st.country,
      intake: { labels: intakeLabels(st.language), fields: INTAKE_FIELDS.map((f) => ({ key: f.key, required: f.required || false, recommended: !!f.recommended, enum: f.enum || null })) },
      openIntakes: svc.openIntakes(tid).map((r) => ({ ref: r.ref, data: r.data, missing: r.missing })) });
  });
  // Parse a dictation into intake fields (no database write) – the tablet fills its form with the result.
  app.post('/api/app/intake/parse', bearer, express.json({ limit: '32kb' }), (req, res) => {
    const st = svc.settings(req.auth.extra.tenantId);
    const r = parseIntakeText(String(req.body?.text || '').slice(0, 5000), { country: st.country });
    res.json({ fields: r.fields, status: intakeStatus({ ...(req.body?.current || {}), ...r.fields }) });
  });
  app.post('/api/app/sync', bearer, express.json({ limit: '256kb' }), (req, res) => {
    const ops = Array.isArray(req.body?.ops) ? req.body.ops.slice(0, 500) : [];
    res.json({ results: svc.applyOfflineOps(req.auth.extra.tenantId, ops) });
  });

  app.use(publicRouter(svc, { baseUrl }));
  app.use((err, _req, res, _next) => { res.status(err.status || 500).json({ error: err.expose ? err.message : 'server_error' }); });
  return { app, svc, provider };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const { app } = createApp({ db: openDb(process.env.CAREE_DB || './caree.db') });
  app.listen(port, () => console.log(`Caree listening on :${port} (${process.env.PUBLIC_URL || 'http://localhost:' + port})`));
}

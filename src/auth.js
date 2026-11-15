// OAuth 2.1 authorization server for ChatGPT (authorization code + PKCE, dynamic client registration).
// Built on the MCP SDK router; Garagee supplies storage and the login screen.
import { randomBytes, createHash } from 'node:crypto';
import { J, nowIso } from './db.js';
import { esc, page } from './web/html.js';

const CODE_TTL = 300; // s
const ACCESS_TTL = 3600; // s
const REFRESH_TTL = 60 * 86400; // s
export const SCOPES = ['workshop'];

const sha = (s) => createHash('sha256').update(s).digest('hex');
const tok = () => randomBytes(32).toString('base64url');
const nowS = () => Math.floor(Date.now() / 1000);

export class GarageeOAuthProvider {
  constructor(db, svc) {
    this.db = db; this.svc = svc;
    // Pending authorization requests and login failures live in the database, so a restart or deploy
    // in the middle of a sign-in does not break it (bug found in the ChatGPT test).
    const q = (s) => db.prepare(s);
    this._clientsStore = {
      getClient: (cid) => { const r = q('SELECT data FROM oauth_clients WHERE client_id=?').get(cid); return r ? J.parse(r.data) : undefined; },
      registerClient: (client) => { q('INSERT INTO oauth_clients VALUES (?,?,?)').run(client.client_id, J.str(client), nowIso()); return client; },
    };
  }
  get clientsStore() { return this._clientsStore; }

  async authorize(client, params, res) {
    const rid = tok();
    const p = { clientId: client.client_id, clientName: client.client_name, params: { ...params, resource: params.resource?.href || null } };
    this.db.prepare('DELETE FROM oauth_pending WHERE expires_at < ?').run(nowS());
    this.db.prepare('INSERT INTO oauth_pending VALUES (?,?,?)').run(sha(rid), J.str(p), nowS() + 1800);
    res.status(200).type('html').send(loginPage(rid, client.client_name));
  }

  /** POST /oauth/login */
  handleLogin(req, res) {
    const { rid, email = '', password = '' } = req.body || {};
    const row = this.db.prepare('SELECT * FROM oauth_pending WHERE rid=?').get(sha(String(rid || '')));
    const p = row && row.expires_at >= nowS() ? J.parse(row.data) : null;
    if (!p) return res.status(400).type('html').send(page('Garagee', '<p>This sign-in link expired. Go back to ChatGPT and connect again.</p>'));
    const check = this.checkLogin(email, password);
    if (check.error) return res.status(check.status).type('html').send(loginPage(rid, p.clientName, check.error));
    const user = check.user;
    this.db.prepare('DELETE FROM oauth_pending WHERE rid=?').run(sha(rid));
    const code = tok();
    this.db.prepare('INSERT INTO oauth_codes VALUES (?,?,?,?,?,?,?,?)').run(sha(code), p.clientId, user.id, p.params.codeChallenge, p.params.redirectUri, J.str(p.params.scopes || SCOPES), p.params.resource || null, nowS() + CODE_TTL);
    const to = new URL(p.params.redirectUri);
    to.searchParams.set('code', code);
    if (p.params.state) to.searchParams.set('state', p.params.state);
    res.redirect(302, to.href);
  }

  /** Shared by ChatGPT sign-in and the tablet app: 5 wrong attempts lock the e-mail for 10 minutes. */
  checkLogin(email, password) {
    const key = String(email || '').toLowerCase().trim();
    const f = this.db.prepare('SELECT * FROM login_failures WHERE key=?').get(key) || { n: 0, until: 0 };
    if (f.until > nowS()) return { status: 429, error: 'Too many attempts – wait 10 minutes.' };
    const user = this.svc.login(key, password);
    if (!user) {
      const n = f.n + 1;
      this.db.prepare('INSERT INTO login_failures VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET n=excluded.n, until=excluded.until').run(key, n >= 5 ? 0 : n, n >= 5 ? nowS() + 600 : 0);
      return { status: 401, error: 'Wrong e-mail or password.' };
    }
    this.db.prepare('DELETE FROM login_failures WHERE key=?').run(key);
    return { user };
  }

  async challengeForAuthorizationCode(client, code) {
    const r = this.db.prepare('SELECT * FROM oauth_codes WHERE code=? AND client_id=?').get(sha(code), client.client_id);
    if (!r || r.expires_at < nowS()) throw new Error('invalid_grant');
    return r.challenge;
  }

  async exchangeAuthorizationCode(client, code, _verifier, redirectUri) {
    const r = this.db.prepare('SELECT * FROM oauth_codes WHERE code=? AND client_id=?').get(sha(code), client.client_id);
    this.db.prepare('DELETE FROM oauth_codes WHERE code=?').run(sha(code)); // single use
    if (!r || r.expires_at < nowS()) throw new Error('invalid_grant');
    if (redirectUri && redirectUri !== r.redirect_uri) throw new Error('invalid_grant');
    return this.issue(client.client_id, r.user_id, J.parse(r.scopes, SCOPES), r.resource);
  }

  async exchangeRefreshToken(client, refreshToken) {
    const r = this.db.prepare(`SELECT * FROM oauth_tokens WHERE token=? AND kind='refresh' AND client_id=?`).get(sha(refreshToken), client.client_id);
    if (!r || r.expires_at < nowS()) throw new Error('invalid_grant');
    this.db.prepare('DELETE FROM oauth_tokens WHERE token=?').run(sha(refreshToken)); // rotation
    return this.issue(client.client_id, r.user_id, J.parse(r.scopes, SCOPES), r.resource);
  }

  issue(clientId, userId, scopes, resource) {
    const access = tok(), refresh = tok();
    const ins = this.db.prepare('INSERT INTO oauth_tokens VALUES (?,?,?,?,?,?,?)');
    ins.run(sha(access), 'access', clientId, userId, J.str(scopes), resource, nowS() + ACCESS_TTL);
    ins.run(sha(refresh), 'refresh', clientId, userId, J.str(scopes), resource, nowS() + REFRESH_TTL);
    return { access_token: access, token_type: 'bearer', expires_in: ACCESS_TTL, refresh_token: refresh, scope: scopes.join(' ') };
  }

  async verifyAccessToken(token) {
    const r = this.db.prepare(`SELECT * FROM oauth_tokens WHERE token=? AND kind='access'`).get(sha(token));
    if (!r || r.expires_at < nowS()) throw Object.assign(new Error('invalid_token'), { name: 'InvalidTokenError' });
    const user = this.svc.user(r.user_id);
    if (!user) throw new Error('invalid_token');
    return { token, clientId: r.client_id, scopes: J.parse(r.scopes, SCOPES), expiresAt: r.expires_at, resource: r.resource ? new URL(r.resource) : undefined, extra: { userId: user.id, tenantId: user.tenantId, role: user.role, email: user.email } };
  }

  async revokeToken(_client, { token }) { this.db.prepare('DELETE FROM oauth_tokens WHERE token=?').run(sha(token)); }
}

function loginPage(rid, clientName, error = '') {
  return page('Sign in to Garagee', `
  <h1>Sign in to Garagee</h1>
  <p class="muted">${esc(clientName || 'ChatGPT')} wants to access your workshop: vehicles, bookings, estimates and parts orders. You can disconnect at any time in ChatGPT settings.</p>
  ${error ? `<p class="err">${esc(error)}</p>` : ''}
  <form method="post" action="/oauth/login">
    <input type="hidden" name="rid" value="${esc(rid)}">
    <label>E-mail<input name="email" type="email" autocomplete="username" required></label>
    <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
    <button type="submit">Sign in</button>
  </form>
  <p class="muted small">Garagee is operated by housee s.r.o. <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></p>`);
}

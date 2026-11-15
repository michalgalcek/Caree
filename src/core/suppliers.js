// Parts supplier adapters. Shops choose their own suppliers and their order of preference.
// Fix for the most common competitor complaint ("parts integration has issues all the time"):
// every API call has a timeout, its health is tracked, and an order never gets lost –
// if the API fails, Garagee falls back to an e-mail order the shop can send with one click.

const TIMEOUT_MS = 8000;

export class DemoSupplier {
  constructor(cfg) { this.cfg = cfg; this.id = cfg.id; this.name = cfg.name; }
  async quote(parts) {
    // Deterministic demo prices so tests and the OpenAI review account are reproducible.
    const factor = this.cfg.priceFactor ?? 1;
    return parts.map((p, i) => ({
      code: p.code, name: p.name, supplierPartNo: `${this.id.slice(0, 3).toUpperCase()}-${p.code}`,
      brand: this.cfg.brand || 'OE-equivalent', unitCost: Math.round((p.refCost ?? 20) * factor * 100) / 100,
      available: (this.cfg.outOfStock || []).includes(p.code) ? false : true,
      eta: addHours(this.cfg.etaHours ?? (i % 2 ? 4 : 24)),
    }));
  }
  async order(items) { return { channel: 'demo', reference: `DEMO-${Date.now().toString(36).toUpperCase()}`, items }; }
}

export class EmailSupplier {
  constructor(cfg) { this.cfg = cfg; this.id = cfg.id; this.name = cfg.name; }
  async quote(parts) {
    return parts.map((p) => ({ code: p.code, name: p.name, unitCost: null, available: null, eta: null, note: 'Supplier has no price API – prices by phone/e-mail.' }));
  }
  async order(items, ctx = {}) {
    return { channel: 'email', to: this.cfg.email, subject: `Order ${ctx.shopName || ''} ${ctx.jobRef || ''}`.trim(), body: emailBody(items, ctx), status: 'ready_to_send' };
  }
}

/** Generic JSON API adapter – configure endpoints per supplier (each supplier contract differs). */
export class HttpJsonSupplier {
  constructor(cfg, fetchImpl = globalThis.fetch) { this.cfg = cfg; this.id = cfg.id; this.name = cfg.name; this.fetch = fetchImpl; }
  async call(path, body) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.cfg.timeoutMs || TIMEOUT_MS);
    try {
      const r = await this.fetch(new URL(path, this.cfg.baseUrl), {
        method: 'POST', signal: ctl.signal,
        headers: { 'content-type': 'application/json', ...(this.cfg.apiKeyHeader ? { [this.cfg.apiKeyHeader]: this.cfg.apiKey } : {}) },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } finally { clearTimeout(timer); }
  }
  async quote(parts, vehicle) { return (await this.call(this.cfg.quotePath || 'quote', { vin: vehicle?.vin, parts })).items; }
  async order(items, ctx) { return { channel: 'api', ...(await this.call(this.cfg.orderPath || 'order', { items, reference: ctx?.jobRef })) }; }
}

export function makeSupplier(cfg, fetchImpl) {
  if (cfg.kind === 'demo') return new DemoSupplier(cfg);
  if (cfg.kind === 'api') return new HttpJsonSupplier(cfg, fetchImpl);
  return new EmailSupplier(cfg);
}

/** Query all active suppliers in parallel; a failing supplier never breaks the comparison. */
export async function compareParts(supplierCfgs, parts, vehicle, { onHealth = () => {}, fetchImpl } = {}) {
  const active = supplierCfgs.filter((s) => s.active !== false).sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9));
  const results = await Promise.all(active.map(async (cfg) => {
    const sup = makeSupplier(cfg, fetchImpl);
    try {
      const items = await sup.quote(parts, vehicle);
      onHealth(cfg.id, { ok: true });
      return { supplierId: cfg.id, supplier: cfg.name, priority: cfg.priority ?? 9, ok: true, items };
    } catch (e) {
      onHealth(cfg.id, { ok: false, error: String(e.message || e) });
      return { supplierId: cfg.id, supplier: cfg.name, priority: cfg.priority ?? 9, ok: false, error: 'Supplier not reachable – try again or order by e-mail.', items: [] };
    }
  }));
  // best offer per part: available first, then shop priority, then cost, then ETA
  const best = {};
  for (const p of parts) {
    const offers = results.flatMap((r) => r.items.filter((i) => i.code === p.code).map((i) => ({ ...i, supplierId: r.supplierId, supplier: r.supplier, priority: r.priority })));
    offers.sort((a, b) => (b.available === true) - (a.available === true) || a.priority - b.priority || (a.unitCost ?? 1e9) - (b.unitCost ?? 1e9) || String(a.eta).localeCompare(String(b.eta)));
    best[p.code] = offers[0] || null;
  }
  return { suppliers: results, best };
}

/** Place an order with fallback to e-mail. Returns a record that is always persisted by the caller. */
export async function placeOrder(cfg, items, ctx, fetchImpl) {
  const sup = makeSupplier(cfg, fetchImpl);
  try {
    const res = await sup.order(items, ctx);
    return { status: res.status || 'sent', ...res };
  } catch (e) {
    if (cfg.email) {
      const fb = await new EmailSupplier(cfg).order(items, ctx);
      return { ...fb, status: 'fallback_email', error: String(e.message || e) };
    }
    return { status: 'failed', channel: cfg.kind, error: String(e.message || e) };
  }
}

function emailBody(items, ctx) {
  const lines = items.map((i) => `- ${i.qty || 1} × ${i.name} (${i.supplierPartNo || i.code})`);
  return [`Dear ${ctx.supplierName || 'supplier'},`, '', 'please deliver:', ...lines, '', ctx.vin ? `VIN: ${ctx.vin}` : '', `Reference: ${ctx.jobRef || '-'}`, '', ctx.shopName || ''].join('\n');
}

const addHours = (h) => new Date(Date.now() + h * 3600000).toISOString().slice(0, 16);

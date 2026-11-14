// Job estimate: labour time + parts + supplies + tax.
// Fixes competitor complaints ("labour guide off by 70 %", "double-counted time"):
//   * every number shows its source (licensed data / generic catalogue / this shop's real times)
//   * overlapping operations are not counted twice
//   * the estimate learns from this shop's actual clocked times (blended, never jumps on 1 sample)
import { effectiveSettings } from '../config/countries.js';

// Generic catalogue = fallback only. Real deployments plug a licensed provider (HaynesPro, Autodata…) via LabourProvider.
export const OPERATIONS = {
  OIL_SERVICE: { name: 'Oil & filter service', hours: 0.6, skill: 'general', parts: [{ code: 'OIL_5L', name: 'Engine oil 5 l', cost: 30 }, { code: 'OIL_FILTER', name: 'Oil filter', cost: 9 }] },
  INSPECTION_PREP: { name: 'Pre-inspection check (STK/MOT/HU)', hours: 0.8, skill: 'general', parts: [] },
  BRAKE_PADS_FRONT: { name: 'Front brake pads', hours: 0.8, skill: 'general', parts: [{ code: 'PADS_F', name: 'Front brake pad set', cost: 35 }] },
  BRAKE_DISCS_PADS_FRONT: { name: 'Front brake discs + pads', hours: 1.3, skill: 'general', includes: ['BRAKE_PADS_FRONT'], parts: [{ code: 'DISCS_F', name: 'Front brake discs (pair)', cost: 70 }, { code: 'PADS_F', name: 'Front brake pad set', cost: 35 }] },
  BRAKE_PADS_REAR: { name: 'Rear brake pads', hours: 0.9, skill: 'general', parts: [{ code: 'PADS_R', name: 'Rear brake pad set', cost: 30 }] },
  BRAKE_FLUID: { name: 'Brake fluid replacement', hours: 0.5, skill: 'general', parts: [{ code: 'DOT4_1L', name: 'Brake fluid DOT4 1 l', cost: 8 }] },
  TIMING_BELT: { name: 'Timing belt kit', hours: 3.2, skill: 'engine', parts: [{ code: 'TB_KIT', name: 'Timing belt kit', cost: 140 }], overlap: { WATER_PUMP: 2.0 } },
  WATER_PUMP: { name: 'Water pump', hours: 2.6, skill: 'engine', parts: [{ code: 'WP', name: 'Water pump', cost: 60 }, { code: 'COOLANT_5L', name: 'Coolant 5 l', cost: 15 }], overlap: { TIMING_BELT: 2.0 } },
  TYRE_CHANGE: { name: 'Seasonal tyre change (4 wheels, balance)', hours: 0.8, skill: 'tyres', bay: 'tyre', parts: [] },
  WHEEL_ALIGNMENT: { name: 'Wheel alignment', hours: 0.8, skill: 'alignment', bay: 'alignment', parts: [] },
  AC_SERVICE: { name: 'A/C service (refrigerant recharge)', hours: 0.8, skill: 'ac', parts: [{ code: 'REFRIG', name: 'Refrigerant charge', cost: 25 }] },
  BATTERY_12V: { name: '12 V battery replacement + coding', hours: 0.5, skill: 'electrical', parts: [{ code: 'BAT12', name: '12 V battery', cost: 110 }] },
  DIAGNOSTIC: { name: 'Diagnostic (scan + test)', hours: 1.0, skill: 'diagnostics', parts: [] },
  CLUTCH: { name: 'Clutch kit replacement', hours: 5.5, skill: 'drivetrain', mechanics: 2, parts: [{ code: 'CLUTCH_KIT', name: 'Clutch kit', cost: 260 }] },
  SHOCKS_FRONT: { name: 'Front shock absorbers', hours: 2.0, skill: 'general', parts: [{ code: 'SHOCK_F', name: 'Front shock absorbers (pair)', cost: 120 }], followUp: ['WHEEL_ALIGNMENT'] },
  EV_HV_CHECK: { name: 'EV high-voltage system check', hours: 1.0, skill: 'hv', parts: [] },
  SPARK_PLUGS: { name: 'Spark plugs (4 cyl.)', hours: 0.7, skill: 'general', parts: [{ code: 'PLUGS4', name: 'Spark plugs ×4', cost: 40 }] },
};

export function lookupOperation(code) {
  return OPERATIONS[code] ? { code, ...OPERATIONS[code] } : null;
}

export function searchOperations(text) {
  const q = String(text || '').toLowerCase();
  return Object.entries(OPERATIONS)
    .filter(([code, o]) => code.toLowerCase().includes(q) || o.name.toLowerCase().includes(q))
    .map(([code, o]) => ({ code, name: o.name, hours: o.hours }));
}

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Hours for one operation.
 * provided: hours from a licensed provider (optional). actuals: this shop's clocked hours for the op (same make preferred).
 */
export function operationHours(op, { provided = null, actuals = [] } = {}) {
  const base = provided ?? op.hours;
  const baseSource = provided != null ? 'licensed labour data' : 'generic catalogue (connect labour data for model-specific times)';
  const clean = actuals.filter((h) => h > 0 && h < base * 4); // drop obvious clock errors
  if (clean.length === 0) return { hours: round2(base), source: baseSource, base, shopMedian: null, samples: 0 };
  const m = median(clean);
  const w = clean.length / (clean.length + 5); // 5 samples = 50 % weight
  return { hours: round2(base * (1 - w) + m * w), source: `${baseSource}, blended with this shop's real times`, base, shopMedian: round2(m), samples: clean.length };
}

const round2 = (n) => Math.round(n * 100) / 100;

export function partsMarkupPct(cost, matrix) {
  for (const tier of matrix) if (cost <= tier.upTo) return tier.pct;
  return matrix[matrix.length - 1].pct;
}

/**
 * Build an estimate.
 * ops: [{ code, providedHours?, actuals?, partsOverride?[] }]
 * Returns all amounts in the shop currency with tax.
 */
export function estimate(tenant, ops, { partPrices = {} } = {}) {
  const s = effectiveSettings(tenant);
  const codes = ops.map((o) => o.code);
  const lines = [];
  const notes = [];
  // remove operations included in another selected op
  const included = new Set();
  for (const c of codes) for (const inc of OPERATIONS[c]?.includes || []) if (codes.includes(inc)) included.add(inc);
  const seenOverlap = new Set();
  let labourHours = 0;
  const partLines = [];
  const followUps = new Set();
  for (const o of ops) {
    const op = lookupOperation(o.code);
    if (!op) { notes.push(`Unknown operation ${o.code} – skipped.`); continue; }
    if (included.has(o.code)) { notes.push(`${op.name} is included in another selected operation – not charged twice.`); continue; }
    const h = operationHours(op, { provided: o.providedHours ?? null, actuals: o.actuals || [] });
    let hours = h.hours;
    for (const [other, saving] of Object.entries(op.overlap || {})) {
      const key = [o.code, other].sort().join('+');
      const otherOp = OPERATIONS[other];
      // the saving is taken from the smaller operation, so the main job keeps its full time
      const takesSaving = otherOp && (op.hours < otherOp.hours || (op.hours === otherOp.hours && o.code > other));
      if (codes.includes(other) && !included.has(other) && takesSaving && !seenOverlap.has(key)) {
        seenOverlap.add(key);
        hours = Math.max(0.1, hours - saving);
        notes.push(`${op.name} + ${OPERATIONS[other].name}: shared access, ${saving} h saved.`);
      }
    }
    for (const f of op.followUp || []) if (!codes.includes(f)) followUps.add(f);
    labourHours += hours;
    lines.push({ code: o.code, name: op.name, hours: round2(hours), mechanicsNeeded: op.mechanics || 1, skill: op.skill, timeSource: h.source, shopMedianHours: h.shopMedian, samples: h.samples });
    for (const p of o.partsOverride || op.parts) {
      if (partLines.some((x) => x.code === p.code)) continue;
      const supplierCost = partPrices[p.code];
      const cost = supplierCost ?? (s.fxFromEur != null ? p.cost * s.fxFromEur : null);
      if (cost == null) {
        partLines.push({ code: p.code, name: p.name, qty: p.qty || 1, unitCost: null, unitPrice: null, priceSource: 'price needed – check suppliers (compare_parts)' });
        continue;
      }
      const pct = partsMarkupPct(cost, s.partsMarkup);
      partLines.push({ code: p.code, name: p.name, qty: p.qty || 1, unitCost: money(cost, s.currency), unitPrice: money(cost * (1 + pct / 100), s.currency), priceSource: supplierCost != null ? 'supplier price' : 'typical reference price – confirm with supplier' });
    }
  }
  if (s.laborRate == null) notes.push('Labour rate not set – open shop settings (set_shop_settings) to price labour.');
  if (partLines.some((p) => p.unitPrice == null)) notes.push('Some parts have no price yet – totals exclude them.');
  const labour = money(labourHours * (s.laborRate || 0), s.currency);
  const parts = money(partLines.reduce((a, p) => a + (p.unitPrice || 0) * p.qty, 0), s.currency);
  const supplies = money((labour * s.shopSuppliesPct) / 100, s.currency);
  const net = money(labour + parts + supplies, s.currency);
  const tax = money((net * s.vatRate) / 100, s.currency);
  return {
    currency: s.currency, locale: s.locale, laborRate: s.laborRate, vatRate: s.vatRate, vatRateSource: s.vatVerified,
    labourHours: round2(labourHours), lines, parts: partLines,
    totals: { labour, parts, supplies, net, tax, gross: money(net + tax, s.currency) },
    complete: s.laborRate != null && partLines.every((p) => p.unitPrice != null),
    suggestedFollowUps: [...followUps].map((c) => ({ code: c, name: OPERATIONS[c].name, why: 'usually needed after the selected work' })),
    notes,
    disclaimer: 'Estimate. If more work is found the shop asks the customer before doing it.',
  };
}

const ZERO_DECIMAL = new Set(['HUF', 'JPY', 'KRW', 'CLP', 'ISK']);
export function money(n, currency) {
  const f = ZERO_DECIMAL.has(currency) ? 1 : 100;
  return Math.round(n * f) / f;
}

export function formatMoney(n, currency, locale) {
  try { return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n); } catch { return `${n} ${currency}`; }
}

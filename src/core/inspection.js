// Statutory inspection (STK, HU, MOT, ITV, APK…) and maintenance due-date engine.
import { effectiveSettings } from '../config/countries.js';

const DAY = 86400000;

export function addYears(date, years) {
  const d = new Date(date);
  const months = Math.round(years * 12);
  const r = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate()));
  return r;
}

const iso = (d) => d.toISOString().slice(0, 10);

function ruleKey(vehicle, rules) {
  const cat = vehicle.category || 'M1';
  const fuel = (vehicle.fuel || '').toUpperCase();
  if (fuel && rules[`${cat}_${fuel}`]) return `${cat}_${fuel}`;
  return rules[cat] ? cat : (rules.M1 ? 'M1' : null);
}

/** Pick the rule version valid for an inspection due on `date`. */
function versionFor(versions, date) {
  const sorted = [...versions].sort((a, b) => a.from.localeCompare(b.from));
  let pick = sorted[0];
  for (const v of sorted) if (v.from <= iso(date)) pick = v;
  return pick;
}

/**
 * Next statutory inspection.
 * vehicle: { firstRegistration: 'YYYY-MM-DD', lastInspection?: 'YYYY-MM-DD', inspectionsDone?: number, fuel?, category? }
 */
export function nextInspection(tenant, vehicle, now = new Date()) {
  const s = effectiveSettings(tenant);
  const insp = s.inspection;
  const rules = insp.rules || {};
  const key = ruleKey(vehicle, rules);
  if (!key || !vehicle.firstRegistration) {
    return {
      due: null, name: insp.name, reason: !vehicle.firstRegistration ? 'first registration date missing' : 'no national rule – regional or set by shop',
      verified: insp.verified || false, note: insp.note || null,
    };
  }
  const first = new Date(vehicle.firstRegistration);
  // Walk the schedule from first registration. If we know the last inspection, continue from it.
  let count = 0;
  let due = null;
  let v = versionFor(rules[key], now);
  due = addYears(first, v.first);
  const intervalAfter = (n, version, atDate) => {
    const ageYears = (atDate - first) / (365.25 * DAY);
    for (const ar of version.ageRules || []) if (ageYears >= ar.fromAgeYears - 0.01) return ar.every;
    return version.steps[n] ?? version.then;
  };
  const last = vehicle.lastInspection ? new Date(vehicle.lastInspection) : null;
  if (last) {
    count = vehicle.inspectionsDone ?? estimateCount(rules[key], first, last);
    v = versionFor(rules[key], last);
    due = addYears(last, intervalAfter(count - 1, v, last));
  } else {
    // No record: roll forward from registration until the due date is not in the past (assume passed on time).
    let guard = 0;
    while (due < now && guard++ < 60) {
      v = versionFor(rules[key], due);
      due = addYears(due, intervalAfter(count, v, due));
      count++;
    }
  }
  const daysLeft = Math.ceil((due - now) / DAY);
  return {
    due: iso(due), daysLeft, overdue: daysLeft < 0, name: insp.name, rule: key,
    ruleVersionFrom: v.from, assumedFromRegistration: !last,
    emissionSeparate: !!insp.emissionSeparate,
    emissionRequired: !(insp.evEmissionExempt && (vehicle.fuel || '').toUpperCase() === 'EV'),
    verified: insp.verified || false, note: insp.note || null,
  };
}

function estimateCount(versions, first, last) {
  let count = 0;
  let d = addYears(first, versions[0].first);
  while (d <= last && count < 60) {
    const v = versionFor(versions, d);
    d = addYears(d, v.steps[count] ?? v.then);
    count++;
  }
  return Math.max(1, count);
}

// ---- Maintenance (manufacturer service intervals; generic defaults until a data partner is connected)

export const GENERIC_SERVICE_ITEMS = [
  { code: 'OIL', name: 'Engine oil + filter', km: 15000, months: 12, skipFuel: ['EV'] },
  { code: 'AIRF', name: 'Air filter', km: 30000, months: 24, skipFuel: ['EV'] },
  { code: 'CABIN', name: 'Cabin filter', km: 15000, months: 12 },
  { code: 'BRAKEFLUID', name: 'Brake fluid', km: null, months: 24 },
  { code: 'SPARK', name: 'Spark plugs', km: 60000, months: 48, onlyFuel: ['PETROL', 'LPG', 'CNG', 'HYBRID'] },
  { code: 'TIMING', name: 'Timing belt (if fitted)', km: 120000, months: 72, skipFuel: ['EV'] },
  { code: 'AC', name: 'A/C service', km: null, months: 24 },
  { code: 'COOLANT_HV', name: 'HV battery coolant / thermal system check', km: null, months: 24, onlyFuel: ['EV', 'HYBRID'] },
];

/** Average km per day from mileage history [{date, km}] – falls back to 40 km/day. */
export function dailyKm(history) {
  const h = [...(history || [])].filter((x) => x.km != null).sort((a, b) => a.date.localeCompare(b.date));
  if (h.length < 2) return 40;
  const a = h[0], b = h[h.length - 1];
  const days = (new Date(b.date) - new Date(a.date)) / DAY;
  if (days < 20) return 40;
  return Math.max(1, (b.km - a.km) / days);
}

export function maintenanceDue(vehicle, lastDone = {}, history = [], now = new Date(), items = GENERIC_SERVICE_ITEMS) {
  const perDay = dailyKm(history);
  const currentKm = estimateCurrentKm(vehicle, history, now, perDay);
  const fuel = (vehicle.fuel || '').toUpperCase();
  const out = [];
  for (const it of items) {
    if (it.skipFuel && it.skipFuel.includes(fuel)) continue;
    if (it.onlyFuel && !it.onlyFuel.includes(fuel)) continue;
    const record = lastDone[it.code];
    let last, assumed = false;
    if (record?.date) last = record;
    else if (vehicle.firstRegistration && currentKm != null && currentKm < (it.km ?? Infinity) && (now - new Date(vehicle.firstRegistration)) / DAY < (it.months || 0) * 30.4) {
      last = { date: vehicle.firstRegistration, km: 0 }; // young car still in its first interval
    } else if (it.km != null && currentKm != null) {
      // no service record: assume work was done at the last multiple of the interval – flagged so nobody treats it as fact
      last = { date: null, km: Math.floor(currentKm / it.km) * it.km };
      assumed = true;
    } else {
      out.push({ code: it.code, name: it.name, due: null, daysLeft: null, trigger: null, assumed: true, note: 'no service record – check the service book', source: 'generic interval – replace with manufacturer data' });
      continue;
    }
    const byTime = it.months && last.date ? addYears(new Date(last.date), it.months / 12) : null;
    let byKm = null;
    if (it.km != null && currentKm != null) {
      const remaining = last.km + it.km - currentKm;
      byKm = new Date(now.getTime() + (remaining / perDay) * DAY);
    }
    const due = [byTime, byKm].filter(Boolean).sort((a, b) => a - b)[0];
    if (!due) continue;
    out.push({ code: it.code, name: it.name, due: iso(due), daysLeft: Math.ceil((due - now) / DAY), trigger: due === byKm ? 'km' : 'time', assumed, ...(assumed ? { note: 'no service record – estimated from mileage, check the service book' } : {}), source: 'generic interval – replace with manufacturer data' });
  }
  return { estimatedKm: currentKm == null ? null : Math.round(currentKm), kmPerDay: Math.round(perDay), items: out.sort((a, b) => (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9)) };
}

function estimateCurrentKm(vehicle, history, now, perDay) {
  const h = [...(history || [])].filter((x) => x.km != null).sort((a, b) => a.date.localeCompare(b.date));
  const lastRec = h[h.length - 1] || (vehicle.mileage != null ? { date: vehicle.mileageDate || iso(now), km: vehicle.mileage } : null);
  if (!lastRec) return null;
  return lastRec.km + ((now - new Date(lastRec.date)) / DAY) * perDay;
}

// Workshop scheduler: puts jobs on lifts/bays and mechanics, respecting skills, working hours,
// several mechanics per task (competitor gap), parts arrival and existing bookings.
// Times are shop-local wall-clock strings 'YYYY-MM-DDTHH:mm' (no timezone maths inside the planner).

export const UNIT_MIN = 15;
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export const DEFAULT_OPENING = { mon: [8, 17], tue: [8, 17], wed: [8, 17], thu: [8, 17], fri: [8, 17] };

const toUnit = (s) => Math.floor(Date.parse(s.length === 10 ? s + 'T00:00Z' : s + 'Z') / 60000 / UNIT_MIN);
const fromUnit = (u) => new Date(u * UNIT_MIN * 60000).toISOString().slice(0, 16);
const dayOf = (u) => DAYS[new Date(u * UNIT_MIN * 60000).getUTCDay()];
const hourOf = (u) => { const d = new Date(u * UNIT_MIN * 60000); return d.getUTCHours() + d.getUTCMinutes() / 60; };

function within(hours, u) {
  if (!hours) return false;
  const h = hourOf(u);
  const ranges = Array.isArray(hours[0]) ? hours : [hours];
  return ranges.some(([a, b]) => h >= a && h < b);
}

export class Workshop {
  constructor({ mechanics = [], bays = [], opening = DEFAULT_OPENING, bookings = [], closedDates = [] }) {
    this.mechanics = mechanics.filter((m) => m.active !== false);
    this.bays = bays.filter((b) => b.active !== false);
    this.opening = opening;
    this.closed = new Set(closedDates);
    this.bayBusy = new Map(this.bays.map((b) => [b.id, new Set()]));
    this.mechBusy = new Map(this.mechanics.map((m) => [m.id, new Set()]));
    for (const b of bookings) this.reserve(b);
  }

  isOpen(u) {
    const date = fromUnit(u).slice(0, 10);
    return !this.closed.has(date) && within(this.opening[dayOf(u)], u);
  }

  mechWorks(m, u) {
    if (!this.isOpen(u)) return false;
    if ((m.absences || []).includes(fromUnit(u).slice(0, 10))) return false;
    return within((m.hours || this.opening)[dayOf(u)], u);
  }

  reserve(b) {
    const s = toUnit(b.start), e = toUnit(b.end);
    if (b.bayId && this.bayBusy.has(b.bayId)) for (let u = s; u < e; u++) this.bayBusy.get(b.bayId).add(u);
    for (const a of b.assignments || []) {
      const as = toUnit(a.start), ae = toUnit(a.end);
      for (const id of a.mechanicIds) if (this.mechBusy.has(id)) for (let u = as; u < ae; u++) if (this.mechWorks(this.mechanics.find((m) => m.id === id), u)) this.mechBusy.get(id).add(u);
    }
  }

  /** Next `count` open units from u (inclusive). */
  workUnits(u, count, maxSpan = 14 * 96) {
    const out = [];
    for (let x = u; out.length < count && x < u + maxSpan; x++) if (this.isOpen(x)) out.push(x);
    return out.length === count ? out : null;
  }

  baysFor(type) {
    return this.bays.filter((b) => (type ? b.type === type || (b.capabilities || []).includes(type) : b.type === 'lift' || !b.type));
  }

  /** Try to place a job starting at unit u. Returns placement or null. */
  tryPlace(job, u) {
    const tasks = job.tasks;
    const bayType = tasks.find((t) => t.bay)?.bay || null;
    for (const bay of this.baysFor(bayType)) {
      let cursor = u;
      const assignments = [];
      let ok = true;
      for (const t of tasks) {
        const units = this.workUnits(cursor, Math.max(1, Math.ceil((t.hours * 60) / UNIT_MIN)));
        if (!units) { ok = false; break; }
        if (units.some((x) => this.bayBusy.get(bay.id).has(x))) { ok = false; break; }
        const need = t.mechanicsNeeded || 1;
        const candidates = this.mechanics
          .filter((m) => !t.skill || t.skill === 'general' || (m.skills || []).includes(t.skill))
          .filter((m) => units.every((x) => this.mechWorks(m, x) && !this.mechBusy.get(m.id).has(x)))
          .sort((a, b) => this.mechBusy.get(a.id).size - this.mechBusy.get(b.id).size);
        if (candidates.length < need) { ok = false; break; }
        const chosen = candidates.slice(0, need);
        assignments.push({ code: t.code, name: t.name, mechanicIds: chosen.map((m) => m.id), mechanicNames: chosen.map((m) => m.name), start: fromUnit(units[0]), end: fromUnit(units[units.length - 1] + 1), units });
        cursor = units[units.length - 1] + 1;
      }
      if (ok) {
        const first = assignments[0].units[0];
        const last = assignments[assignments.length - 1].units.at(-1) + 1;
        return { bayId: bay.id, bayName: bay.name, start: fromUnit(first), end: fromUnit(last), assignments, _units: [first, last] };
      }
    }
    return null;
  }

  commit(p) {
    for (let u = p._units[0]; u < p._units[1]; u++) this.bayBusy.get(p.bayId).add(u); // car stays on the lift, incl. overnight
    for (const a of p.assignments) for (const id of a.mechanicIds) for (const u of a.units) this.mechBusy.get(id).add(u);
  }

  /** Earliest start options for a job. earliest: 'YYYY-MM-DDTHH:mm'; partsEta delays start. */
  findSlots(job, { earliest, partsEta = null, count = 3, horizonDays = 21, onePerDay = true } = {}) {
    let start = toUnit(earliest);
    if (partsEta) start = Math.max(start, Math.ceil(Date.parse(partsEta + 'Z') / 60000 / UNIT_MIN));
    const end = start + horizonDays * 96;
    const out = [];
    const usedDays = new Set();
    if (!this.bays.length || !this.mechanics.length) return [];
    for (let u = start; u < end && out.length < count; u++) {
      if (!this.isOpen(u)) continue;
      const day = fromUnit(u).slice(0, 10);
      if (onePerDay && usedDays.has(day)) continue;
      const p = this.tryPlace(job, u);
      if (p) { out.push(strip(p)); usedDays.add(day); }
    }
    return out;
  }

  place(job, opts) {
    const [s] = this.findSlots(job, { ...opts, count: 1, onePerDay: false });
    if (!s) return null;
    const p = this.tryPlace(job, toUnit(s.start));
    this.commit(p);
    return strip(p);
  }

  /** Utilisation for a date: share of open time each bay / mechanic is busy. */
  utilisation(date) {
    const units = [];
    const s = toUnit(date + 'T00:00');
    for (let u = s; u < s + 96; u++) if (this.isOpen(u)) units.push(u);
    if (!units.length) return { open: false, bays: [], mechanics: [] };
    const pct = (set) => Math.round((units.filter((u) => set.has(u)).length / units.length) * 100);
    return {
      open: true, openHours: (units.length * UNIT_MIN) / 60,
      bays: this.bays.map((b) => ({ id: b.id, name: b.name, busyPct: pct(this.bayBusy.get(b.id)) })),
      mechanics: this.mechanics.map((m) => {
        const work = units.filter((u) => this.mechWorks(m, u));
        const busy = work.filter((u) => this.mechBusy.get(m.id).has(u)).length;
        return { id: m.id, name: m.name, busyPct: work.length ? Math.round((busy / work.length) * 100) : 0, freeHours: ((work.length - busy) * UNIT_MIN) / 60 };
      }),
    };
  }
}

function strip(p) {
  return { bayId: p.bayId, bayName: p.bayName, start: p.start, end: p.end, assignments: p.assignments.map(({ units, ...a }) => a) };
}

/** Order unscheduled jobs: customer waiting > promised date > parts ready > created. Prevents "customer waits while easy jobs jump the queue". */
export function prioritise(jobs) {
  return [...jobs].sort((a, b) =>
    (b.customerWaiting ? 1 : 0) - (a.customerWaiting ? 1 : 0)
    || (a.promisedBy || '9999').localeCompare(b.promisedBy || '9999')
    || (a.partsEta || '0000').localeCompare(b.partsEta || '0000')
    || (a.createdAt || '').localeCompare(b.createdAt || ''));
}

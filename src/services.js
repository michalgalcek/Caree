// Business services. All methods take tenantId first and filter by it.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { id, nowIso, J } from './db.js';
import { effectiveSettings, getCountry, COUNTRIES } from './config/countries.js';
import { decodeVin, normalizeVin } from './core/vin.js';
import { planOf, PLANS } from './config/plans.js';
import { nextInspection, maintenanceDue } from './core/inspection.js';
import { estimate, lookupOperation, OPERATIONS } from './core/estimator.js';
import { Workshop, prioritise } from './core/scheduler.js';
import { compareParts, placeOrder } from './core/suppliers.js';
import { parseIntakeText, mergeIntake, intakeStatus, intakeLabels, MAX_WEIGHT_KG } from './core/intake.js';

export class NotFound extends Error { constructor(m) { super(m); this.code = 'not_found'; } }
export class Invalid extends Error { constructor(m) { super(m); this.code = 'invalid'; } }

export function hashPassword(pw) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(pw, salt, 32).toString('hex')}`;
}
export function checkPassword(pw, stored) {
  const [, salt, hash] = String(stored).split('$');
  if (!salt) return false;
  const a = scryptSync(pw, Buffer.from(salt, 'hex'), 32);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Shop-local wall clock 'YYYY-MM-DDTHH:mm'. */
export function localNow(tz, d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

const rowTenant = (r) => r && { ...r, settings: J.parse(r.settings, {}) };

export class Garagee {
  constructor(db, { fetchImpl } = {}) { this.db = db; this.fetchImpl = fetchImpl; }
  q(sql) { return this.db.prepare(sql); }
  audit(tid, actor, action, entity, entityId) {
    this.q('INSERT INTO audit_log VALUES (?,?,?,?,?,?,?)').run(id(), tid, actor || 'system', action, entity || null, entityId || null, nowIso());
  }

  // ---------- tenants, users, resources
  createTenant({ name, country, settings = {} }) {
    if (!name || !country) throw new Invalid('name and country required');
    const t = { id: id(), name, country: country.toUpperCase(), settings: J.str(settings), public_slug: slug(name) + '-' + randomBytes(3).toString('hex'), created_at: nowIso() };
    this.q('INSERT INTO tenants (id,name,country,settings,public_slug,created_at) VALUES (?,?,?,?,?,?)').run(t.id, t.name, t.country, t.settings, t.public_slug, t.created_at);
    return this.tenant(t.id);
  }
  tenant(tid) { const r = rowTenant(this.q('SELECT * FROM tenants WHERE id=?').get(tid)); if (!r) throw new NotFound('shop not found'); return r; }
  tenantBySlug(s) { const r = rowTenant(this.q('SELECT * FROM tenants WHERE public_slug=?').get(s)); if (!r) throw new NotFound('shop not found'); return r; }
  settings(tid) { return effectiveSettings(this.tenant(tid)); }
  updateSettings(tid, patch, actor) {
    const t = this.tenant(tid);
    const allowed = ['laborRate', 'vatRate', 'currency', 'locale', 'language', 'timezone', 'distanceUnit', 'shopSuppliesPct', 'partsMarkup', 'opening', 'inspection', 'retentionYears', 'fxFromEur', 'closedDates', 'phone', 'address'];
    const next = { ...t.settings };
    for (const [k, v] of Object.entries(patch || {})) if (allowed.includes(k)) next[k] = v;
    this.q('UPDATE tenants SET settings=? WHERE id=?').run(J.str(next), tid);
    this.audit(tid, actor, 'settings.update');
    return this.settings(tid);
  }
  createUser(tid, { email, password, role = 'owner', name = null }) {
    if (!email || !password || password.length < 10) throw new Invalid('e-mail and password (≥10 chars) required');
    const u = { id: id(), email: email.toLowerCase().trim() };
    this.q('INSERT INTO users VALUES (?,?,?,?,?,?,?)').run(u.id, tid, u.email, name, role, hashPassword(password), nowIso());
    return { id: u.id, email: u.email, role, tenantId: tid };
  }
  login(email, password) {
    const u = this.q('SELECT * FROM users WHERE email=?').get(String(email || '').toLowerCase().trim());
    if (!u || !checkPassword(password, u.pass_hash)) return null;
    return { id: u.id, email: u.email, role: u.role, tenantId: u.tenant_id, name: u.name };
  }
  /** Self-service sign-up of a new shop with its owner account. */
  signup({ shopName, country, ownerName = null, email, password }) {
    const e = String(email || '').toLowerCase().trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Invalid('valid e-mail required');
    if (this.q('SELECT 1 FROM users WHERE email=?').get(e)) throw new Invalid('an account with this e-mail already exists');
    if (!shopName || String(shopName).trim().length < 2) throw new Invalid('shop name required');
    if (!COUNTRIES[String(country || '').toUpperCase()]) throw new Invalid('choose a supported country');
    if (!password || password.length < 10) throw new Invalid('password must have at least 10 characters');
    let out;
    this.db.exec('BEGIN');
    try {
      const t = this.createTenant({ name: String(shopName).trim().slice(0, 80), country });
      const u = this.createUser(t.id, { email: e, password, role: 'owner', name: ownerName ? String(ownerName).trim().slice(0, 80) : null });
      this.audit(t.id, u.id, 'account.signup');
      this.db.exec('COMMIT'); out = { tenant: t, user: u };
    } catch (err) { this.db.exec('ROLLBACK'); throw err; }
    return out;
  }
  /** Deletes a shop and everything stored for it (owner request). */
  deleteTenant(tid) {
    const users = this.q('SELECT id FROM users WHERE tenant_id=?').all(tid).map((u) => u.id);
    this.db.exec('BEGIN');
    try {
      for (const uid of users) { this.q('DELETE FROM oauth_tokens WHERE user_id=?').run(uid); this.q('DELETE FROM oauth_codes WHERE user_id=?').run(uid); }
      const tables = this.q("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
        .filter((t) => t !== 'tenants' && this.q(`PRAGMA table_info(${t})`).all().some((c) => c.name === 'tenant_id'));
      for (const t of tables.filter((t) => t !== 'users')) this.q(`DELETE FROM ${t} WHERE tenant_id=?`).run(tid);
      this.q('DELETE FROM users WHERE tenant_id=?').run(tid);
      this.q('DELETE FROM tenants WHERE id=?').run(tid);
      this.db.exec('COMMIT');
    } catch (err) { this.db.exec('ROLLBACK'); throw err; }
    return { deleted: true };
  }
  user(uid) { const u = this.q('SELECT id,email,role,tenant_id,name FROM users WHERE id=?').get(uid); return u && { id: u.id, email: u.email, role: u.role, tenantId: u.tenant_id, name: u.name }; }

  addMechanic(tid, { name, skills = ['general'], hours = null }) {
    const m = { id: id() };
    this.q('INSERT INTO mechanics (id,tenant_id,name,skills,hours) VALUES (?,?,?,?,?)').run(m.id, tid, name, J.str(skills), hours ? J.str(hours) : null);
    return { id: m.id, name, skills };
  }
  addBay(tid, { name, type = 'lift', capabilities = [], maxKg = 3500 }) {
    const b = { id: id() };
    this.q('INSERT INTO bays (id,tenant_id,name,type,capabilities,max_kg) VALUES (?,?,?,?,?,?)').run(b.id, tid, name, type, J.str(capabilities), maxKg);
    return { id: b.id, name, type, maxKg };
  }
  addSupplier(tid, { name, kind = 'email', priority = 5, ...config }) {
    const s = { id: id() };
    this.q('INSERT INTO suppliers (id,tenant_id,name,kind,config,priority) VALUES (?,?,?,?,?,?)').run(s.id, tid, name, kind, J.str(config), priority);
    return { id: s.id, name, kind, priority };
  }
  suppliers(tid) {
    return this.q('SELECT * FROM suppliers WHERE tenant_id=? ORDER BY priority').all(tid).map((r) => ({ id: r.id, name: r.name, kind: r.kind, priority: r.priority, active: !!r.active, health: { lastOkAt: r.last_ok_at, lastError: r.last_error, lastErrorAt: r.last_error_at }, ...J.parse(r.config, {}) }));
  }
  mechanics(tid) { return this.q('SELECT * FROM mechanics WHERE tenant_id=?').all(tid).map((m) => ({ id: m.id, name: m.name, skills: J.parse(m.skills, []), hours: J.parse(m.hours), absences: J.parse(m.absences, []), active: !!m.active })); }
  bays(tid) { return this.q('SELECT * FROM bays WHERE tenant_id=?').all(tid).map((b) => ({ id: b.id, name: b.name, type: b.type, capabilities: J.parse(b.capabilities, []), maxKg: b.max_kg ?? 3500, active: !!b.active })); }

  // ---------- customers & vehicles
  addCustomer(tid, { name, phone = null, email = null, language = null, marketingConsent = false }) {
    const c = { id: id() };
    this.q('INSERT INTO customers (id,tenant_id,name,phone,email,language,marketing_consent,created_at,last_activity_at) VALUES (?,?,?,?,?,?,?,?,?)').run(c.id, tid, name, phone, email, language, marketingConsent ? 1 : 0, nowIso(), nowIso());
    return this.customer(tid, c.id);
  }
  customer(tid, cid) {
    const c = this.q('SELECT * FROM customers WHERE tenant_id=? AND id=?').get(tid, cid);
    if (!c) throw new NotFound('customer not found');
    return { id: c.id, name: c.name, phone: c.phone, email: c.email, language: c.language, marketingConsent: !!c.marketing_consent, anonymized: !!c.anonymized_at };
  }
  /** Plan and vehicle usage of a shop. Archived vehicles do not count. */
  usage(tid) {
    const p = planOf(this.tenant(tid).plan);
    const used = this.q('SELECT COUNT(*) n FROM vehicles WHERE tenant_id=? AND archived=0').get(tid).n;
    return { plan: p.code, planName: p.name, vehiclesUsed: used, vehicleLimit: p.vehicles, vehiclesLeft: p.vehicles == null ? null : Math.max(0, p.vehicles - used) };
  }
  canAddVehicle(tid) { const u = this.usage(tid); return u.vehicleLimit == null || u.vehiclesUsed < u.vehicleLimit; }
  setPlan(tid, plan) { if (!PLANS[plan]) throw new Invalid('unknown plan'); this.q('UPDATE tenants SET plan=? WHERE id=?').run(plan, tid); this.audit(tid, 'admin', 'plan.change'); return this.usage(tid); }
  addVehicle(tid, { customerId = null, vin = null, plate = null, make = null, model = null, engine = null, year = null, fuel = null, category = 'M1', maxWeightKg = null, firstRegistration = null, lastInspection = null, mileage = null }) {
    category = String(category || 'M1').toUpperCase();
    if (!['M1', 'N1'].includes(category)) throw new Invalid('Garagee is for passenger cars (M1) and light commercial vehicles up to 3.5 t (N1) only.');
    if (maxWeightKg != null && Number(maxWeightKg) > MAX_WEIGHT_KG) throw new Invalid(`Vehicle weight ${maxWeightKg} kg is over 3,500 kg – Garagee is for vehicles up to 3.5 t only.`);
    let decoded = null;
    if (vin) {
      decoded = decodeVin(vin);
      if (!decoded.valid) throw new Invalid(decoded.errors.join(' '));
      vin = decoded.vin;
      make = make || decoded.make;
      year = year || decoded.modelYear;
    }
    if (!vin && !plate) throw new Invalid('VIN or licence plate required');
    if (!this.canAddVehicle(tid)) { const u = this.usage(tid); throw new Invalid(`Vehicle limit of this shop reached (${u.vehiclesUsed} of ${u.vehicleLimit} vehicles). Existing vehicles keep working. To add another one, archive or erase vehicles that are no longer serviced, or ask the shop owner.`); }
    const v = { id: id() };
    const today = nowIso().slice(0, 10);
    this.q(`INSERT INTO vehicles (id,tenant_id,customer_id,vin,plate,make,model,engine,year,fuel,category,first_registration,last_inspection,mileage,mileage_date,created_at,max_weight_kg)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(v.id, tid, customerId, vin, normPlate(plate), make, model, engine, year, fuel ? fuel.toUpperCase() : null, category, firstRegistration, lastInspection, mileage, mileage != null ? today : null, nowIso(), maxWeightKg != null ? Number(maxWeightKg) : null);
    if (mileage != null) this.q('INSERT INTO mileage VALUES (?,?,?,?,?)').run(id(), tid, v.id, today, mileage);
    return { vehicle: this.vehicle(tid, v.id), vinWarnings: decoded?.warnings || [] };
  }
  vehicle(tid, vid) {
    const v = this.q('SELECT * FROM vehicles WHERE tenant_id=? AND id=?').get(tid, vid);
    if (!v) throw new NotFound('vehicle not found');
    return mapVehicle(v);
  }
  findVehicles(tid, query) {
    const q = String(query || '').trim();
    if (q.length < 2) throw new Invalid('search needs at least 2 characters');
    const like = `%${q.toUpperCase().replace(/[\s-]/g, '')}%`;
    const rows = this.q(`SELECT v.*, c.name AS cname, c.phone AS cphone FROM vehicles v LEFT JOIN customers c ON c.id=v.customer_id AND c.tenant_id=v.tenant_id
      WHERE v.tenant_id=? AND v.archived=0 AND (REPLACE(REPLACE(UPPER(v.plate),' ',''),'-','') LIKE ? OR v.vin LIKE ? OR UPPER(c.name) LIKE ? OR REPLACE(c.phone,' ','') LIKE ?) LIMIT 20`)
      .all(tid, like, like, `%${q.toUpperCase()}%`, `%${q.replace(/\s/g, '')}%`);
    return rows.map((r) => ({ ...mapVehicle(r), customerName: r.cname || null }));
  }
  recordMileage(tid, vid, km, date = nowIso().slice(0, 10)) {
    this.vehicle(tid, vid);
    this.q('INSERT INTO mileage VALUES (?,?,?,?,?)').run(id(), tid, vid, date, km);
    this.q('UPDATE vehicles SET mileage=?, mileage_date=? WHERE id=? AND tenant_id=?').run(km, date, vid, tid);
  }
  vehicleCard(tid, vid, now = new Date()) {
    const t = this.tenant(tid);
    const v = this.vehicle(tid, vid);
    const history = this.q('SELECT date, km FROM mileage WHERE tenant_id=? AND vehicle_id=? ORDER BY date').all(tid, vid);
    const jobs = this.q('SELECT ref,status,title,start,end,invoice_total,invoice_currency FROM jobs WHERE tenant_id=? AND vehicle_id=? ORDER BY created_at DESC LIMIT 20').all(tid, vid);
    const lastDone = {};
    for (const r of this.q(`SELECT jt.code, j.end AS date FROM job_tasks jt JOIN jobs j ON j.id=jt.job_id WHERE jt.tenant_id=? AND j.vehicle_id=? AND jt.done=1`).all(tid, vid)) {
      const key = { OIL_SERVICE: 'OIL', BRAKE_FLUID: 'BRAKEFLUID', TIMING_BELT: 'TIMING', AC_SERVICE: 'AC', SPARK_PLUGS: 'SPARK' }[r.code];
      if (key && r.date) lastDone[key] = { date: r.date.slice(0, 10), km: nearestKm(history, r.date) };
    }
    const declined = this.q(`SELECT ii.item, ii.status, ii.note, ii.recommended_op, j.ref, ii.decided_at FROM inspection_items ii JOIN jobs j ON j.id=ii.job_id
      WHERE ii.tenant_id=? AND j.vehicle_id=? AND ii.remind_next_visit=1`).all(tid, vid);
    return {
      vehicle: v,
      customer: v.customerId ? this.customer(tid, v.customerId) : null,
      nextInspection: nextInspection(t, v, now),
      maintenance: maintenanceDue(v, lastDone, history, now),
      declinedWorkToRemind: declined,
      jobs,
    };
  }
  upcoming(tid, days = 60, now = new Date()) {
    const t = this.tenant(tid);
    const out = [];
    for (const r of this.q('SELECT * FROM vehicles WHERE tenant_id=? AND archived=0').all(tid)) {
      const v = mapVehicle(r);
      const insp = nextInspection(t, v, now);
      const history = this.q('SELECT date, km FROM mileage WHERE tenant_id=? AND vehicle_id=? ORDER BY date').all(tid, v.id);
      const m = maintenanceDue(v, {}, history, now).items.filter((i) => i.daysLeft <= days);
      const declined = this.q(`SELECT COUNT(*) n FROM inspection_items ii JOIN jobs j ON j.id=ii.job_id WHERE ii.tenant_id=? AND j.vehicle_id=? AND ii.remind_next_visit=1`).get(tid, v.id).n;
      const hasBooking = this.q(`SELECT COUNT(*) n FROM jobs WHERE tenant_id=? AND vehicle_id=? AND status IN ('booked','in_progress')`).get(tid, v.id).n > 0;
      if ((insp.due && insp.daysLeft <= days) || m.length || declined) {
        out.push({ vehicleId: v.id, plate: v.plate, make: v.make, model: v.model, inspection: insp.due && insp.daysLeft <= days ? { due: insp.due, daysLeft: insp.daysLeft, name: insp.name, assumed: insp.assumedFromRegistration } : null, maintenance: m.slice(0, 4), declinedItems: declined, alreadyBooked: hasBooking });
      }
    }
    return out.sort((a, b) => (a.inspection?.daysLeft ?? 999) - (b.inspection?.daysLeft ?? 999));
  }

  // ---------- estimates & scheduling
  actualsFor(tid, code, make) {
    const rows = this.q('SELECT actual_hours, make FROM job_tasks WHERE tenant_id=? AND code=? AND done=1 AND actual_hours IS NOT NULL').all(tid, code);
    const same = rows.filter((r) => make && r.make === make).map((r) => r.actual_hours);
    return same.length >= 3 ? same : rows.map((r) => r.actual_hours);
  }
  estimateFor(tid, { vehicleId = null, codes, partPrices = {} }) {
    if (!codes?.length) throw new Invalid('at least one operation code required');
    const unknown = codes.filter((c) => !OPERATIONS[c]);
    if (unknown.length) throw new Invalid(`unknown operation codes: ${unknown.join(', ')} – use list_operations`);
    const v = vehicleId ? this.vehicle(tid, vehicleId) : null;
    const ops = codes.map((code) => ({ code, actuals: this.actualsFor(tid, code, v?.make) }));
    const e = estimate(this.tenant(tid), ops, { partPrices });
    if (v?.fuel === 'EV' && codes.includes('OIL_SERVICE')) e.notes.push('Vehicle is electric – an oil service is not applicable.');
    return { vehicle: v, ...e };
  }
  workshop(tid, { excludeJobId = null } = {}) {
    const t = this.tenant(tid);
    const bookings = this.q(`SELECT * FROM jobs WHERE tenant_id=? AND status IN ('booked','in_progress') AND start IS NOT NULL`).all(tid)
      .filter((j) => j.id !== excludeJobId)
      .map((j) => ({ bayId: j.bay_id, start: j.start, end: j.end, assignments: J.parse(j.assignments, []) }));
    return new Workshop({ mechanics: this.mechanics(tid), bays: this.bays(tid), opening: t.settings.opening || undefined, bookings, closedDates: t.settings.closedDates || [] });
  }
  vehicleBusy(tid, vehicleId, excludeJobId = null) {
    if (!vehicleId) return [];
    return this.q(`SELECT id, start, end FROM jobs WHERE tenant_id=? AND vehicle_id=? AND status IN ('booked','in_progress') AND start IS NOT NULL`).all(tid, vehicleId)
      .filter((j) => j.id !== excludeJobId).map((j) => ({ start: j.start, end: j.end }));
  }
  jobSpec(tid, codes, make, vehicleKg = null) {
    return {
      vehicleKg,
      tasks: codes.map((code) => {
        const op = lookupOperation(code);
        if (!op) throw new Invalid(`unknown operation ${code}`);
        const est = this.estimateFor(tid, { codes: [code] });
        return { code, name: op.name, hours: est.labourHours || op.hours, skill: op.skill, mechanicsNeeded: op.mechanics || 1, bay: op.bay || null };
      }),
    };
  }
  freeSlots(tid, { codes, earliest = null, vehicleId = null, partsEta = null, count = 3 }) {
    const s = this.settings(tid);
    const now = localNow(s.timezone);
    const start = earliest && earliest > now ? (earliest.length === 10 ? earliest + 'T00:00' : earliest) : roundUp(now);
    const v = vehicleId ? this.vehicle(tid, vehicleId) : null;
    const ws = this.workshop(tid);
    if (!this.bays(tid).length || !this.mechanics(tid).length) throw new Invalid('Add at least one lift/bay and one mechanic first (setup_workshop).');
    return { timezone: s.timezone, slots: ws.findSlots(this.jobSpec(tid, codes, v?.make, v?.maxWeightKg), { earliest: start, partsEta, count, avoid: this.vehicleBusy(tid, vehicleId) }) };
  }
  book(tid, { vehicleId, codes, start = null, complaint = null, customerWaiting = false, promisedBy = null, source = 'staff', actor }) {
    const v = this.vehicle(tid, vehicleId);
    const spec = this.jobSpec(tid, codes, v.make, v.maxWeightKg);
    const ws = this.workshop(tid);
    const s = this.settings(tid);
    const earliest = start || roundUp(localNow(s.timezone));
    let placement;
    if (start) {
      const [p] = ws.findSlots(spec, { earliest: start, count: 1, onePerDay: false, horizonDays: 1, avoid: this.vehicleBusy(tid, v.id) });
      if (!p || p.start !== start) throw new Invalid(`${start} is no longer free – call find_free_slots again.`);
      placement = p;
    } else {
      [placement] = ws.findSlots(spec, { earliest, count: 1, onePerDay: false, avoid: this.vehicleBusy(tid, v.id) });
      if (!placement) throw new Invalid('No capacity in the next 3 weeks.');
    }
    const est = this.estimateFor(tid, { vehicleId, codes });
    const j = { id: id(), ref: jobRef(this, tid) };
    const ts = nowIso();
    this.q(`INSERT INTO jobs (id,tenant_id,ref,vehicle_id,customer_id,status,title,complaint,start,end,bay_id,assignments,estimate,customer_waiting,promised_by,source,created_at,updated_at)
      VALUES (?,?,?,?,?,'booked',?,?,?,?,?,?,?,?,?,?,?,?)`).run(j.id, tid, j.ref, v.id, v.customerId, spec.tasks.map((t) => t.name).join(', '), complaint, placement.start, placement.end, placement.bayId, J.str(placement.assignments), J.str(est), customerWaiting ? 1 : 0, promisedBy, source, ts, ts);
    for (const t of spec.tasks) {
      const a = placement.assignments.find((x) => x.code === t.code);
      this.q('INSERT INTO job_tasks (id,tenant_id,job_id,code,name,hours,skill,mechanics_needed,mechanic_ids,make) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id(), tid, j.id, t.code, t.name, t.hours, t.skill, t.mechanicsNeeded, J.str(a?.mechanicIds || []), v.make);
    }
    this.audit(tid, actor, 'job.book', 'job', j.id);
    return this.job(tid, j.ref);
  }
  jobRow(tid, ref) {
    const j = this.q('SELECT * FROM jobs WHERE tenant_id=? AND (ref=? OR id=?)').get(tid, ref, ref);
    if (!j) throw new NotFound(`job ${ref} not found`);
    return j;
  }
  job(tid, ref) {
    const j = this.jobRow(tid, ref);
    const tasks = this.q('SELECT * FROM job_tasks WHERE tenant_id=? AND job_id=?').all(tid, j.id).map((t) => ({ id: t.id, code: t.code, name: t.name, hours: t.hours, mechanicIds: J.parse(t.mechanic_ids, []), actualHours: t.actual_hours, done: !!t.done }));
    const items = this.q('SELECT * FROM inspection_items WHERE tenant_id=? AND job_id=?').all(tid, j.id).map(mapItem);
    const v = j.vehicle_id ? this.vehicle(tid, j.vehicle_id) : null;
    return { id: j.id, ref: j.ref, status: j.status, title: j.title, complaint: j.complaint, start: j.start, end: j.end, bayId: j.bay_id, assignments: J.parse(j.assignments, []), vehicle: v && { id: v.id, plate: v.plate, make: v.make, model: v.model }, tasks, inspection: items, estimate: J.parse(j.estimate), partsEta: j.parts_eta, customerWaiting: !!j.customer_waiting };
  }
  jobStatus(tid, query) {
    let j;
    try { j = this.jobRow(tid, query); } catch {
      const v = this.findVehicles(tid, query)[0];
      if (!v) throw new NotFound('no job or vehicle matches');
      j = this.q(`SELECT * FROM jobs WHERE tenant_id=? AND vehicle_id=? ORDER BY created_at DESC LIMIT 1`).get(tid, v.id);
      if (!j) throw new NotFound('vehicle has no jobs');
    }
    const job = this.job(tid, j.ref);
    const pendingApproval = job.inspection.filter((i) => i.decision === 'pending' && i.status !== 'green').length;
    return { ...job, summary: statusText(job, pendingApproval) };
  }
  reschedule(tid, ref, { earliest, actor }) {
    const j = this.jobRow(tid, ref);
    if (!['booked'].includes(j.status)) throw new Invalid(`job is ${j.status} – only booked jobs can be moved`);
    const codes = this.q('SELECT code FROM job_tasks WHERE tenant_id=? AND job_id=?').all(tid, j.id).map((r) => r.code);
    const v = this.vehicle(tid, j.vehicle_id);
    const ws = this.workshop(tid, { excludeJobId: j.id });
    const [p] = ws.findSlots(this.jobSpec(tid, codes, v.make, v.maxWeightKg), { earliest, count: 1, onePerDay: false, partsEta: j.parts_eta, avoid: this.vehicleBusy(tid, v.id, j.id) });
    if (!p) throw new Invalid('no free slot found');
    this.q('UPDATE jobs SET start=?, end=?, bay_id=?, assignments=?, updated_at=? WHERE id=?').run(p.start, p.end, p.bayId, J.str(p.assignments), nowIso(), j.id);
    this.audit(tid, actor, 'job.reschedule', 'job', j.id);
    return this.job(tid, j.ref);
  }
  cancel(tid, ref, { actor, reason = null } = {}) {
    const j = this.jobRow(tid, ref);
    if (['done', 'invoiced'].includes(j.status)) throw new Invalid('finished jobs cannot be cancelled');
    this.q(`UPDATE jobs SET status='cancelled', complaint=COALESCE(complaint,'') || ?, updated_at=? WHERE id=?`).run(reason ? ` [cancelled: ${reason}]` : '', nowIso(), j.id);
    this.audit(tid, actor, 'job.cancel', 'job', j.id);
    return { ref: j.ref, status: 'cancelled' };
  }
  clockTask(tid, taskId, { actualHours, done = true, mechanicIds = null }) {
    const t = this.q('SELECT * FROM job_tasks WHERE tenant_id=? AND id=?').get(tid, taskId);
    if (!t) throw new NotFound('task not found');
    this.q('UPDATE job_tasks SET actual_hours=?, done=?, mechanic_ids=COALESCE(?,mechanic_ids) WHERE id=?').run(actualHours, done ? 1 : 0, mechanicIds ? J.str(mechanicIds) : null, taskId);
    const open = this.q('SELECT COUNT(*) n FROM job_tasks WHERE job_id=? AND done=0').get(t.job_id).n;
    this.q(`UPDATE jobs SET status=?, updated_at=? WHERE id=?`).run(open ? 'in_progress' : 'done', nowIso(), t.job_id);
    return { taskId, done, jobDone: !open };
  }
  /** Offline tablet sync: ops carry a client id, re-sent ops are ignored (idempotent). */
  applyOfflineOps(tid, ops) {
    const results = [];
    for (const op of ops) {
      if (this.q('SELECT 1 FROM offline_ops WHERE client_op_id=?').get(op.clientOpId)) { results.push({ clientOpId: op.clientOpId, status: 'duplicate' }); continue; }
      try {
        if (op.type === 'clock') this.clockTask(tid, op.taskId, op);
        else if (op.type === 'inspection') this.recordInspection(tid, op.jobRef, op.items, { actor: 'tablet' });
        else if (op.type === 'mileage') this.recordMileage(tid, op.vehicleId, op.km, op.date);
        else if (op.type === 'intake') {
          const r = op.ref ? this.updateIntake(tid, op.ref, { text: op.text, fields: op.fields || {}, actor: 'tablet' }) : this.startIntake(tid, { text: op.text, fields: op.fields || {}, actor: 'tablet' });
          if (op.complete) this.completeIntake(tid, r.ref, { actor: 'tablet' });
        }
        else throw new Invalid('unknown op');
        this.q('INSERT INTO offline_ops VALUES (?,?,?,?)').run(id(), tid, op.clientOpId, nowIso());
        results.push({ clientOpId: op.clientOpId, status: 'applied' });
      } catch (e) { results.push({ clientOpId: op.clientOpId, status: 'error', error: e.message }); }
    }
    return results;
  }

  // ---------- digital vehicle inspection & customer approval
  recordInspection(tid, ref, items, { actor } = {}) {
    const j = this.jobRow(tid, ref);
    for (const it of items) {
      if (!['green', 'amber', 'red'].includes(it.status)) throw new Invalid('status must be green, amber or red');
      if (it.recommendedOp && !OPERATIONS[it.recommendedOp]) throw new Invalid(`unknown operation ${it.recommendedOp}`);
      this.q('INSERT INTO inspection_items (id,tenant_id,job_id,item,status,note,measurement,photo_urls,recommended_op) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(id(), tid, j.id, it.item, it.status, it.note || null, it.measurement || null, J.str(it.photoUrls || []), it.recommendedOp || null);
    }
    this.audit(tid, actor, 'inspection.record', 'job', j.id);
    return this.job(tid, j.ref).inspection;
  }
  approvalLink(tid, ref, baseUrl) {
    const j = this.jobRow(tid, ref);
    const token = j.approval_token || randomBytes(18).toString('base64url');
    if (!j.approval_token) this.q('UPDATE jobs SET approval_token=? WHERE id=?').run(token, j.id);
    const items = this.job(tid, ref).inspection.filter((i) => i.status !== 'green' && i.recommendedOp);
    return { url: `${baseUrl}/q/${token}`, itemsToApprove: items.length, note: 'Share this link with the customer by SMS/e-mail. Nothing is sent automatically.' };
  }
  quoteByToken(token) {
    const j = this.q('SELECT * FROM jobs WHERE approval_token=?').get(token);
    if (!j) throw new NotFound('link not valid');
    const t = this.tenant(j.tenant_id);
    const job = this.job(j.tenant_id, j.ref);
    const recs = job.inspection.filter((i) => i.recommendedOp);
    const est = recs.length ? estimate(t, recs.map((i) => ({ code: i.recommendedOp }))) : null;
    const lang = j.customer_id ? this.customer(j.tenant_id, j.customer_id).language : null;
    return { shop: { name: t.name, ...effectiveSettings(t) }, job, recommendations: recs.map((i) => ({ ...i, price: est ? lineGross(est, i.recommendedOp) : null })), estimate: job.estimate, language: lang };
  }
  decide(token, decisions) {
    const j = this.q('SELECT * FROM jobs WHERE approval_token=?').get(token);
    if (!j) throw new NotFound('link not valid');
    const tid = j.tenant_id;
    const added = [];
    for (const d of decisions) {
      const it = this.q('SELECT * FROM inspection_items WHERE tenant_id=? AND job_id=? AND id=?').get(tid, j.id, d.itemId);
      if (!it || it.decision !== 'pending') continue;
      const approve = d.decision === 'approved';
      this.q('UPDATE inspection_items SET decision=?, decided_at=?, remind_next_visit=? WHERE id=?').run(approve ? 'approved' : 'declined', nowIso(), approve ? 0 : 1, it.id);
      if (approve && it.recommended_op) {
        const op = lookupOperation(it.recommended_op);
        this.q('INSERT INTO job_tasks (id,tenant_id,job_id,code,name,hours,skill,mechanics_needed) VALUES (?,?,?,?,?,?,?,?)').run(id(), tid, j.id, op.code, op.name, op.hours, op.skill, op.mechanics || 1);
        added.push(op.name);
      }
    }
    this.audit(tid, 'customer', 'quote.decide', 'job', j.id);
    return { added, message: added.length ? 'Approved work added to the job.' : 'Thank you – saved.' };
  }

  // ---------- parts
  async compare(tid, ref) {
    const job = this.job(tid, ref);
    const parts = (job.estimate?.parts || []).map((p) => ({ code: p.code, name: p.name, refCost: p.unitCost ?? 20, qty: p.qty }));
    for (const it of job.inspection.filter((i) => i.decision === 'approved' && i.recommendedOp)) for (const p of OPERATIONS[it.recommendedOp].parts) if (!parts.some((x) => x.code === p.code)) parts.push({ code: p.code, name: p.name, refCost: p.cost, qty: 1 });
    if (!parts.length) return { parts: [], note: 'No parts on this job.' };
    const res = await compareParts(this.suppliers(tid), parts, job.vehicle && this.vehicle(tid, job.vehicle.id), {
      fetchImpl: this.fetchImpl,
      onHealth: (sid, h) => h.ok ? this.q('UPDATE suppliers SET last_ok_at=? WHERE id=?').run(nowIso(), sid) : this.q('UPDATE suppliers SET last_error=?, last_error_at=? WHERE id=?').run(h.error, nowIso(), sid),
    });
    return { jobRef: job.ref, parts, ...res };
  }
  async order(tid, ref, { supplierId, items, actor }) {
    const job = this.job(tid, ref);
    const cfg = this.suppliers(tid).find((s) => s.id === supplierId);
    if (!cfg) throw new NotFound('supplier not found');
    if (!items?.length) throw new Invalid('no items');
    const t = this.tenant(tid);
    const res = await placeOrder(cfg, items, { shopName: t.name, jobRef: job.ref, vin: job.vehicle && this.vehicle(tid, job.vehicle.id).vin, supplierName: cfg.name }, this.fetchImpl);
    const oid = id();
    this.q('INSERT INTO part_orders VALUES (?,?,?,?,?,?,?,?,?)').run(oid, tid, job.id, cfg.id, J.str(items), res.status, res.channel || null, J.str(res), nowIso());
    const etas = items.map((i) => i.eta).filter(Boolean).sort();
    if (etas.length) this.q('UPDATE jobs SET parts_eta=? WHERE id=?').run(etas.at(-1), job.id);
    this.audit(tid, actor, 'parts.order', 'job', job.id);
    return { orderId: oid, ...res };
  }

  // ---------- planning view
  plan(tid, date) {
    const s = this.settings(tid);
    const day = date || localNow(s.timezone).slice(0, 10);
    const ws = this.workshop(tid);
    const jobs = this.q(`SELECT ref,title,start,end,bay_id,assignments,status,customer_waiting FROM jobs WHERE tenant_id=? AND status IN ('booked','in_progress') AND substr(start,1,10)<=? AND substr(end,1,10)>=? ORDER BY start`).all(tid, day, day)
      .map((j) => ({ ref: j.ref, title: j.title, start: j.start, end: j.end, bay: this.bays(tid).find((b) => b.id === j.bay_id)?.name, mechanics: [...new Set(J.parse(j.assignments, []).flatMap((a) => a.mechanicNames || []))], status: j.status, customerWaiting: !!j.customer_waiting }));
    const waiting = this.q(`SELECT ref,title,customer_waiting,promised_by,parts_eta,created_at FROM jobs WHERE tenant_id=? AND status='requested'`).all(tid);
    return { date: day, jobs, utilisation: ws.utilisation(day), unscheduledQueue: prioritise(waiting.map((w) => ({ ref: w.ref, title: w.title, customerWaiting: !!w.customer_waiting, promisedBy: w.promised_by, partsEta: w.parts_eta, createdAt: w.created_at }))).map(({ createdAt, ...x }) => x) };
  }

  // ---------- public booking requests (no account needed for the driver)
  bookingRequest(slugOrId, payload) {
    const t = this.tenantBySlug(slugOrId);
    if (!payload?.consent) throw new Invalid('consent required');
    for (const k of ['name', 'phone', 'service']) if (!payload[k]) throw new Invalid(`${k} required`);
    const clean = { name: String(payload.name).slice(0, 120), phone: String(payload.phone).slice(0, 40), email: payload.email ? String(payload.email).slice(0, 160) : null, plate: payload.plate ? normPlate(payload.plate) : null, service: String(payload.service).slice(0, 500), date: payload.date || null, language: payload.language || null };
    const rid = id();
    this.q('INSERT INTO bookings_requests (id,tenant_id,payload,created_at) VALUES (?,?,?,?)').run(rid, t.id, J.str(clean), nowIso());
    return { id: rid, shop: t.name };
  }
  bookingRequests(tid) { return this.q(`SELECT * FROM bookings_requests WHERE tenant_id=? AND status='new' ORDER BY created_at`).all(tid).map((r) => ({ id: r.id, createdAt: r.created_at, ...J.parse(r.payload, {}) })); }

  // ---------- vehicle intake (vstupná prehliadka) – typed or dictated, step by step
  intakeRow(tid, ref) {
    const r = this.q('SELECT * FROM intakes WHERE tenant_id=? AND (ref=? OR id=?)').get(tid, ref, ref);
    if (!r) throw new NotFound(`intake ${ref} not found`);
    return r;
  }
  intakeView(tid, r) {
    const data = J.parse(r.data, {});
    const st = intakeStatus(data);
    const L = intakeLabels(this.settings(tid).language);
    const limitReached = r.status === 'draft' && !r.vehicle_id && !this.canAddVehicle(tid);
    if (limitReached) { st.errors = [...st.errors, 'Vehicle limit of this shop reached – this new vehicle cannot be saved until vehicles that are no longer serviced are archived or erased.']; st.complete = false; }
    return {
      ref: r.ref, status: r.status, data, ...st, limitReached,
      missingLabels: st.missing.map((k) => L[k]), recommendedLabels: st.recommended.map((k) => L[k]),
      labels: L, vehicleId: r.vehicle_id, customerId: r.customer_id, jobRef: r.job_id ? this.q('SELECT ref FROM jobs WHERE id=?').get(r.job_id)?.ref : null,
    };
  }
  /** Prefill from an existing vehicle/customer when the plate or VIN is already known (returning customer). */
  intakePrefill(tid, data) {
    const key = data.vin || data.plate;
    if (!key) return { data, existing: null };
    const v = this.findVehiclesSafe(tid, data.vin || data.plate).find((x) => (data.vin && x.vin === data.vin) || (data.plate && normPlate(x.plate)?.replace(/\s/g, '') === data.plate.replace(/\s/g, '')));
    if (!v) return { data, existing: null };
    let c = v.customerId ? this.customer(tid, v.customerId) : null;
    // a different person brings the car → do not copy the previous owner's contact details
    const nn = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
    if (c && data.customerName && nn(c.name) !== nn(data.customerName)) c = null;
    const pre = { plate: v.plate, vin: v.vin, make: v.make, model: v.model, year: v.year, fuel: v.fuel, category: v.category, maxWeightKg: v.maxWeightKg, firstRegistration: v.firstRegistration, lastInspection: v.lastInspection, customerName: c && !c.anonymized ? c.name : undefined, customerPhone: c?.phone || undefined, customerEmail: c?.email || undefined };
    const merged = { ...Object.fromEntries(Object.entries(pre).filter(([, x]) => x != null)), ...data };
    return { data: merged, existing: v };
  }
  findVehiclesSafe(tid, q) { try { return this.findVehicles(tid, q); } catch { return []; } }

  startIntake(tid, { text = '', fields = {}, actor = null } = {}) {
    const s = this.settings(tid);
    const parsed = parseIntakeText(text, { country: s.country });
    let { data } = mergeIntake({}, { ...parsed.fields, ...fields });
    const pre = this.intakePrefill(tid, data);
    data = pre.data;
    const r = { id: id(), ref: nextRef(this, tid, 'intakes', 'I-') };
    const ts = nowIso();
    this.q('INSERT INTO intakes (id,tenant_id,ref,status,data,transcript,vehicle_id,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(r.id, tid, r.ref, 'draft', J.str(data), '', pre.existing?.id || null, actor, ts, ts); // raw text is parsed, not stored (data minimisation)
    this.audit(tid, actor, 'intake.start', 'intake', r.id);
    return { ...this.intakeView(tid, this.intakeRow(tid, r.ref)), recognised: Object.keys(parsed.fields), knownVehicle: !!pre.existing };
  }
  updateIntake(tid, ref, { text = '', fields = {}, actor = null } = {}) {
    const r = this.intakeRow(tid, ref);
    if (r.status !== 'draft') throw new Invalid(`intake ${r.ref} is already ${r.status}`);
    const parsed = parseIntakeText(text, { country: this.settings(tid).country });
    const { data, changed } = mergeIntake(J.parse(r.data, {}), { ...parsed.fields, ...fields });
    let vehicleId = r.vehicle_id;
    let final = data;
    if (!vehicleId && (changed.includes('plate') || changed.includes('vin'))) {
      const pre = this.intakePrefill(tid, data);
      final = pre.data; vehicleId = pre.existing?.id || null;
    }
    const transcript = ''; // raw text is parsed, not stored (data minimisation)
    this.q('UPDATE intakes SET data=?, transcript=?, vehicle_id=?, updated_at=? WHERE id=?').run(J.str(final), transcript, vehicleId, nowIso(), r.id);
    this.audit(tid, actor, 'intake.update', 'intake', r.id);
    return { ...this.intakeView(tid, this.intakeRow(tid, r.ref)), changed, recognised: Object.keys(parsed.fields) };
  }
  completeIntake(tid, ref, { actor = null } = {}) {
    const r = this.intakeRow(tid, ref);
    if (r.status !== 'draft') throw new Invalid(`intake ${r.ref} is already ${r.status}`);
    const d = J.parse(r.data, {});
    const st = intakeStatus(d);
    if (!st.complete) {
      const L = intakeLabels(this.settings(tid).language);
      throw new Invalid(`Intake not complete. Missing: ${st.missing.map((k) => L[k]).join(', ') || '-'}${st.errors.length ? '. Errors: ' + st.errors.join('; ') : ''}`);
    }
    // customer: reuse the vehicle's customer if the phone matches, otherwise create
    let customerId = null;
    let vehicleId = r.vehicle_id;
    if (vehicleId) {
      const v = this.vehicle(tid, vehicleId);
      if (v.customerId) { const c = this.customer(tid, v.customerId); if (c.phone && c.phone.replace(/\s/g, '') === String(d.customerPhone).replace(/\s/g, '')) customerId = c.id; }
    }
    if (!customerId) {
      const byPhone = this.q('SELECT id FROM customers WHERE tenant_id=? AND REPLACE(phone,\' \',\'\')=? AND anonymized_at IS NULL').get(tid, String(d.customerPhone).replace(/\s/g, ''));
      customerId = byPhone?.id || this.addCustomer(tid, { name: d.customerName, phone: d.customerPhone, email: d.customerEmail || null }).id;
    }
    if (vehicleId) {
      const v = this.vehicle(tid, vehicleId);
      if (v.customerId !== customerId) this.transferVehicle(tid, vehicleId, customerId, { actor });
      this.q(`UPDATE vehicles SET vin=COALESCE(?,vin), plate=COALESCE(?,plate), make=COALESCE(?,make), model=COALESCE(?,model), year=COALESCE(?,year), fuel=COALESCE(?,fuel), category=COALESCE(?,category), max_weight_kg=COALESCE(?,max_weight_kg), first_registration=COALESCE(?,first_registration), last_inspection=COALESCE(?,last_inspection) WHERE tenant_id=? AND id=?`)
        .run(d.vin || null, d.plate ? normPlate(d.plate) : null, d.make || null, d.model || null, d.year || null, d.fuel || null, d.category || null, d.maxWeightKg || null, d.firstRegistration || null, d.lastInspection || null, tid, vehicleId);
    } else {
      vehicleId = this.addVehicle(tid, { customerId, vin: d.vin, plate: d.plate, make: d.make, model: d.model, year: d.year, fuel: d.fuel, category: d.category, maxWeightKg: d.maxWeightKg, firstRegistration: d.firstRegistration, lastInspection: d.lastInspection }).vehicle.id;
    }
    this.recordMileage(tid, vehicleId, d.mileage);
    // job waits in the planning queue; the advisor estimates and schedules it next
    const j = { id: id(), ref: jobRef(this, tid) };
    const ts = nowIso();
    const condition = ['fuelLevel', 'warningLights', 'damage', 'tyres', 'itemsInCar', 'keys'].filter((k) => d[k] != null && d[k] !== '').map((k) => `${k}: ${d[k]}`).join('; ');
    this.q(`INSERT INTO jobs (id,tenant_id,ref,vehicle_id,customer_id,status,title,complaint,customer_waiting,promised_by,source,created_at,updated_at) VALUES (?,?,?,?,?,'requested',?,?,?,?,'intake',?,?)`)
      .run(j.id, tid, j.ref, vehicleId, customerId, String(d.complaint).slice(0, 120), [d.complaint, condition && `[intake] ${condition}`, d.notes].filter(Boolean).join('\n'), d.customerWaiting ? 1 : 0, d.promisedBy || null, ts, ts);
    this.q(`UPDATE intakes SET status='completed', vehicle_id=?, customer_id=?, job_id=?, completed_at=?, updated_at=? WHERE id=?`).run(vehicleId, customerId, j.id, ts, ts, r.id);
    this.q('UPDATE customers SET last_activity_at=? WHERE id=?').run(ts, customerId);
    this.audit(tid, actor, 'intake.complete', 'intake', r.id);
    return { ...this.intakeView(tid, this.intakeRow(tid, r.ref)), jobRef: j.ref, vehicleId, customerId, next: 'Estimate the work (estimate_job) and schedule it (find_free_slots / book_appointment).' };
  }
  openIntakes(tid) { return this.q(`SELECT * FROM intakes WHERE tenant_id=? AND status='draft' ORDER BY created_at DESC LIMIT 50`).all(tid).map((r) => this.intakeView(tid, r)); }

  // ---------- GDPR
  exportCustomer(tid, cid) {
    const c = this.customer(tid, cid);
    const vehicles = this.q('SELECT * FROM vehicles WHERE tenant_id=? AND customer_id=?').all(tid, cid).map(mapVehicle);
    const jobs = this.q('SELECT ref,status,title,start,end,invoice_total,invoice_currency,created_at FROM jobs WHERE tenant_id=? AND customer_id=?').all(tid, cid);
    this.audit(tid, null, 'gdpr.export', 'customer', cid);
    return { exportedAt: nowIso(), controller: this.tenant(tid).name, processor: 'housee s.r.o. (Garagee)', customer: c, vehicles, jobs };
  }
  /** Erase personal data but KEEP jobs/invoices (accounting law) – fixes "deleting a vehicle deletes its invoices". */
  anonymizeCustomer(tid, cid, { actor } = {}) {
    this.customer(tid, cid);
    this.q(`UPDATE customers SET name='[erased]', phone=NULL, email=NULL, marketing_consent=0, anonymized_at=? WHERE tenant_id=? AND id=?`).run(nowIso(), tid, cid);
    this.q(`UPDATE vehicles SET plate=NULL WHERE tenant_id=? AND customer_id=?`).run(tid, cid);
    this.audit(tid, actor, 'gdpr.anonymize', 'customer', cid);
    return { customerId: cid, anonymized: true, keptForAccounting: 'jobs and invoice totals (no personal data)' };
  }
  /** Car sold: new owner gets technical history, never the previous owner's personal data. */
  transferVehicle(tid, vid, newCustomerId, { actor } = {}) {
    this.vehicle(tid, vid);
    this.customer(tid, newCustomerId);
    this.q('UPDATE vehicles SET customer_id=? WHERE tenant_id=? AND id=?').run(newCustomerId, tid, vid);
    this.audit(tid, actor, 'vehicle.transfer', 'vehicle', vid);
    return this.vehicle(tid, vid);
  }
  archiveVehicle(tid, vid, { actor } = {}) {
    this.vehicle(tid, vid);
    this.q('UPDATE vehicles SET archived=1 WHERE tenant_id=? AND id=?').run(tid, vid);
    this.audit(tid, actor, 'vehicle.archive', 'vehicle', vid);
    return { vehicleId: vid, archived: true, jobsKept: true };
  }
  purgeInactive(tid, now = new Date()) {
    const years = this.settings(tid).retentionYears;
    const cutoff = new Date(now.getTime() - years * 365.25 * 86400000).toISOString();
    const rows = this.q('SELECT id FROM customers WHERE tenant_id=? AND anonymized_at IS NULL AND COALESCE(last_activity_at, created_at) < ?').all(tid, cutoff);
    for (const r of rows) this.anonymizeCustomer(tid, r.id, { actor: 'retention' });
    return { anonymized: rows.length, cutoff };
  }
}

// ---------- helpers
function slug(s) { return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'shop'; }
export function normPlate(p) { return p ? String(p).toUpperCase().replace(/\s+/g, ' ').trim() : null; }
function mapVehicle(v) { return { id: v.id, customerId: v.customer_id, vin: v.vin, plate: v.plate, make: v.make, model: v.model, engine: v.engine, year: v.year, fuel: v.fuel, category: v.category, maxWeightKg: v.max_weight_kg ?? null, firstRegistration: v.first_registration, lastInspection: v.last_inspection, mileage: v.mileage, mileageDate: v.mileage_date, archived: !!v.archived }; }
function mapItem(i) { return { id: i.id, item: i.item, status: i.status, note: i.note, measurement: i.measurement, photoUrls: J.parse(i.photo_urls, []), recommendedOp: i.recommended_op, decision: i.decision }; }
function nearestKm(history, date) { const h = history.filter((x) => x.date <= date.slice(0, 10)); return h.length ? h[h.length - 1].km : 0; }
function roundUp(local) { const [d, t] = local.split('T'); const [h, m] = t.split(':').map(Number); const mm = Math.ceil((m + 1) / 15) * 15; const H = h + Math.floor(mm / 60); return H >= 24 ? `${d}T23:45` : `${d}T${String(H).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`; }
function nextRef(svc, tid, table, prefix) { const m = svc.q(`SELECT MAX(CAST(substr(ref,${prefix.length + 1}) AS INTEGER)) m FROM ${table} WHERE tenant_id=? AND ref LIKE '${prefix}%'`).get(tid).m || 0; return `${prefix}${String(m + 1).padStart(5, '0')}`; }
function jobRef(svc, tid) { const m = svc.q("SELECT MAX(CAST(substr(ref,3) AS INTEGER)) m FROM jobs WHERE tenant_id=? AND ref LIKE 'J-%'").get(tid).m || 0; return `J-${String(m + 1).padStart(5, '0')}`; }
function lineGross(est, code) {
  const l = est.lines.find((x) => x.code === code);
  if (!l) return null;
  const op = OPERATIONS[code];
  const parts = est.parts.filter((p) => op.parts.some((x) => x.code === p.code)).reduce((a, p) => a + (p.unitPrice || 0) * p.qty, 0);
  const net = l.hours * (est.laborRate || 0) + parts;
  return Math.round(net * (1 + est.vatRate / 100) * 100) / 100;
}
function statusText(job, pending) {
  if (job.status === 'booked') return `Booked for ${job.start?.replace('T', ' ')}.`;
  if (job.status === 'in_progress') return pending ? `In the workshop – waiting for customer approval of ${pending} item(s).` : (job.partsEta ? `In the workshop – waiting for parts (ETA ${job.partsEta.replace('T', ' ')}).` : 'In the workshop.');
  if (job.status === 'done') return 'Finished – ready for pick-up.';
  return `Status: ${job.status}.`;
}
export { getCountry };

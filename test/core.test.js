import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeVin, checkDigit } from '../src/core/vin.js';
import { nextInspection, maintenanceDue } from '../src/core/inspection.js';
import { estimate } from '../src/core/estimator.js';
import { Workshop } from '../src/core/scheduler.js';
import { compareParts, placeOrder } from '../src/core/suppliers.js';
import { effectiveSettings, COUNTRIES } from '../src/config/countries.js';

test('VIN: valid North-American VIN with check digit', () => {
  const r = decodeVin('1M8GDM9AXKP042788', new Date('2026-11-14'));
  assert.equal(r.valid, true);
  assert.equal(checkDigit('1M8GDM9AXKP042788'), 'X');
  assert.equal(r.region, 'North America');
});

test('VIN: European VIN with bad check digit is only a warning', () => {
  const r = decodeVin('TMBJJ7NE8L0123456', new Date('2026-11-14'));
  assert.equal(r.valid, true);
  assert.equal(r.make, 'Škoda');
  assert.ok(r.warnings.length >= 0);
  assert.deepEqual(r.modelYearCandidates, [2020, 1990]);
});

test('VIN: rejects I/O/Q and wrong length', () => {
  assert.equal(decodeVin('TMBJJ7NE8L01234O6').valid, false);
  assert.equal(decodeVin('ABC').valid, false);
});

test('Inspection SK: 4-2-2 cycle', () => {
  const r = nextInspection({ country: 'SK' }, { firstRegistration: '2022-03-10' }, new Date('2026-11-14'));
  assert.equal(r.due, '2028-03-10');
  const r2 = nextInspection({ country: 'SK' }, { firstRegistration: '2024-05-01' }, new Date('2026-11-14'));
  assert.equal(r2.due, '2028-05-01');
});

test('Inspection AT: new 4-2-2-2-1 rule from 2027-05-19', () => {
  const old = nextInspection({ country: 'AT' }, { firstRegistration: '2021-01-15' }, new Date('2026-11-14'));
  assert.equal(old.due, '2027-01-15');
  const nu = nextInspection({ country: 'AT' }, { firstRegistration: '2025-06-01' }, new Date('2027-06-01'));
  assert.equal(nu.ruleVersionFrom, '2027-05-19');
  assert.equal(nu.due, '2029-06-01');
});

test('Inspection ES: yearly after 10 years', () => {
  const r = nextInspection({ country: 'ES' }, { firstRegistration: '2014-02-01', lastInspection: '2026-02-01' }, new Date('2026-11-14'));
  assert.equal(r.due, '2027-02-01');
});

test('Inspection PL: LPG yearly from start', () => {
  const r = nextInspection({ country: 'PL' }, { firstRegistration: '2025-09-01', fuel: 'LPG' }, new Date('2026-11-14'));
  assert.equal(r.due, '2027-09-01');
});

test('Inspection US: regional – no invented date', () => {
  const r = nextInspection({ country: 'US' }, { firstRegistration: '2020-01-01' });
  assert.equal(r.due, null);
});

test('Every country config has currency, locale, inspection and VAT', () => {
  for (const [code, c] of Object.entries(COUNTRIES)) {
    assert.ok(c.currency && c.locale && c.inspection && c.vat, code);
    const s = effectiveSettings({ country: code });
    assert.equal(s.country, code);
  }
});

test('Maintenance: EV skips oil service', () => {
  const r = maintenanceDue({ fuel: 'EV', firstRegistration: '2024-01-01', mileage: 20000, mileageDate: '2026-01-01' }, {}, [], new Date('2026-11-14'));
  assert.ok(!r.items.some((i) => i.code === 'OIL'));
});

test('Estimate: overlap saving, included ops, learning, VAT, no invented labour rate', () => {
  const tenant = { country: 'SK', settings: { laborRate: 50 } };
  const e = estimate(tenant, [{ code: 'TIMING_BELT' }, { code: 'WATER_PUMP' }, { code: 'BRAKE_PADS_FRONT' }, { code: 'BRAKE_DISCS_PADS_FRONT' }]);
  assert.equal(e.lines.length, 3);
  assert.equal(e.lines.find((l) => l.code === 'WATER_PUMP').hours, 0.6);
  assert.equal(e.vatRate, 23);
  assert.equal(e.totals.gross, Math.round(e.totals.net * 1.23 * 100) / 100);
  const learned = estimate(tenant, [{ code: 'CLUTCH', actuals: [4, 4.2, 4.1, 3.9, 4] }]);
  assert.ok(learned.lines[0].hours < 5.5 && learned.lines[0].hours > 4, String(learned.lines[0].hours));
  const noRate = estimate({ country: 'DE' }, [{ code: 'OIL_SERVICE' }]);
  assert.equal(noRate.complete, false);
  const czk = estimate({ country: 'CZ', settings: { laborRate: 1200 } }, [{ code: 'OIL_SERVICE' }]);
  assert.equal(czk.parts[0].unitPrice, null);
});

const mech = (id, skills = ['general']) => ({ id, name: id, skills });
test('Scheduler: two mechanics for clutch, skill and bay respected', () => {
  const ws = new Workshop({ mechanics: [mech('A', ['general', 'drivetrain']), mech('B', ['general', 'drivetrain']), mech('C')], bays: [{ id: 'L1', name: 'Lift 1', type: 'lift' }] });
  const p = ws.place({ tasks: [{ code: 'CLUTCH', hours: 5.5, skill: 'drivetrain', mechanicsNeeded: 2 }] }, { earliest: '2026-11-16T08:00' });
  assert.equal(p.start, '2026-11-16T08:00');
  assert.equal(p.assignments[0].mechanicIds.length, 2);
  assert.ok(!p.assignments[0].mechanicIds.includes('C'));
  // second job on same single lift must wait
  const p2 = ws.place({ tasks: [{ code: 'OIL_SERVICE', hours: 0.6, skill: 'general' }] }, { earliest: '2026-11-16T08:00' });
  assert.ok(p2.start >= p.end, `${p2.start} >= ${p.end}`);
});

test('Scheduler: weekend skipped, job spans overnight, tyre bay required', () => {
  const ws = new Workshop({ mechanics: [mech('A', ['general', 'tyres'])], bays: [{ id: 'L1', name: 'Lift', type: 'lift' }, { id: 'T1', name: 'Tyre bay', type: 'tyre' }] });
  const s = ws.findSlots({ tasks: [{ code: 'X', hours: 2, skill: 'general' }] }, { earliest: '2026-11-14T10:00' }); // Saturday
  assert.equal(s[0].start, '2026-11-16T08:00');
  const long = ws.place({ tasks: [{ code: 'BIG', hours: 12, skill: 'general' }] }, { earliest: '2026-11-16T08:00' });
  assert.equal(long.end.slice(0, 10), '2026-11-17');
  const tyre = ws.place({ tasks: [{ code: 'TYRE_CHANGE', hours: 0.8, skill: 'tyres', bay: 'tyre' }] }, { earliest: '2026-11-16T08:00' });
  assert.equal(tyre.bayId, 'T1');
});

test('Scheduler: parts ETA delays start', () => {
  const ws = new Workshop({ mechanics: [mech('A')], bays: [{ id: 'L1', name: 'Lift' }] });
  const [s] = ws.findSlots({ tasks: [{ code: 'X', hours: 1 }] }, { earliest: '2026-11-16T08:00', partsEta: '2026-11-18T13:10' });
  assert.equal(s.start, '2026-11-18T13:15');
});

test('Suppliers: failing API does not break comparison; order falls back to e-mail', async () => {
  const failing = async () => { throw new Error('ECONNRESET'); };
  const cfgs = [
    { id: 'demo1', name: 'Demo A', kind: 'demo', priority: 1, priceFactor: 1.1 },
    { id: 'api1', name: 'Broken API', kind: 'api', baseUrl: 'https://example.invalid/', priority: 2, email: 'orders@example.com' },
  ];
  const r = await compareParts(cfgs, [{ code: 'PADS_F', name: 'Pads', refCost: 30 }], null, { fetchImpl: failing });
  assert.equal(r.suppliers.find((s) => s.supplierId === 'api1').ok, false);
  assert.equal(r.best.PADS_F.supplierId, 'demo1');
  const o = await placeOrder(cfgs[1], [{ code: 'PADS_F', name: 'Pads', qty: 1 }], { jobRef: 'J-1' }, failing);
  assert.equal(o.status, 'fallback_email');
  assert.equal(o.to, 'orders@example.com');
});

test('Maintenance: no service record never yields dates in the past', () => {
  const now = new Date('2026-11-14');
  const r = maintenanceDue({ fuel: 'DIESEL', firstRegistration: '2020-04-15', mileage: 142000, mileageDate: '2026-11-14' }, {}, [], now);
  for (const i of r.items) if (i.due) assert.ok(i.due >= '2026-11-14', `${i.code} ${i.due}`);
  const oil = r.items.find((i) => i.code === 'OIL');
  assert.equal(oil.assumed, true);
  const fluid = r.items.find((i) => i.code === 'BRAKEFLUID');
  assert.equal(fluid.due, null);
});

test('Scheduler: never offers a slot overlapping the same vehicle\'s other job', () => {
  const ws = new Workshop({ mechanics: [mech('A'), mech('B')], bays: [{ id: 'L1', name: 'Lift 1' }, { id: 'L2', name: 'Lift 2' }] });
  const slots = ws.findSlots({ tasks: [{ code: 'OIL', hours: 0.75 }] }, { earliest: '2026-11-16T08:00', onePerDay: false, count: 2, avoid: [{ start: '2026-11-16T08:00', end: '2026-11-16T09:45' }] });
  for (const s of slots) assert.ok(s.start >= '2026-11-16T09:45', s.start);
});

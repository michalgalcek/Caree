import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIntakeText, intakeStatus } from '../src/core/intake.js';
import { openDb } from '../src/db.js';
import { Garagee } from '../src/services.js';
import { seedDemo } from '../src/seed.js';
import { Workshop } from '../src/core/scheduler.js';

test('Dictation (SK): plate, km, fuel, category, customer, complaint, damage, keys', () => {
  const { fields: f } = parseIntakeText('EČV ZA 123AB, stav km 142 000 km, nádrž 1/4, diesel, osobné auto. Zákazník Ján Novák, telefón 0900 123 456. Závada: pískajú brzdy vpredu. Poškodenie: škrabanec na zadnom nárazníku. Dva kľúče. Zákazník čaká.', { country: 'SK' });
  assert.equal(f.plate, 'ZA 123AB'); assert.equal(f.mileage, 142000); assert.equal(f.fuel, 'DIESEL'); assert.equal(f.category, 'M1');
  assert.equal(f.customerName, 'Ján Novák'); assert.equal(f.customerPhone, '0900 123 456'); assert.equal(f.fuelLevel, '1/4');
  assert.equal(f.complaint, 'pískajú brzdy vpredu'); assert.equal(f.damage, 'škrabanec na zadnom nárazníku'); assert.equal(f.keys, 2); assert.equal(f.customerWaiting, true);
  assert.equal(f.vin, undefined, 'no false VIN from ordinary words');
});

test('Dictation: van, weight, VIN dictated in groups, thousands spoken', () => {
  const a = parseIntakeText('Úžitková dodávka, VIN WF0 XXX TTG XKA 123 45, hmotnosť 3,5 t, najazdené 98500 km').fields;
  assert.equal(a.category, 'N1'); assert.equal(a.maxWeightKg, 3500); assert.equal(a.vin, 'WF0XXXTTGXKA12345'); assert.equal(a.mileage, 98500);
  assert.equal(parseIntakeText('75 tisíc km').fields.mileage, 75000);
  assert.equal(parseIntakeText('ŠPZ 2AB 3456', { country: 'CZ' }).fields.plate, '2AB 3456');
});

test('Scope: over 3.5 t and non-M1/N1 rejected', () => {
  assert.ok(intakeStatus({ plate: 'X', category: 'N1', maxWeightKg: 4200, mileage: 1, customerName: 'A B', customerPhone: '0900111222', complaint: 'x' }).errors.some((e) => /3,500/.test(e)));
  assert.ok(intakeStatus({ category: 'N2' }).errors.length > 0);
  const svc = new Garagee(openDb(':memory:'));
  const t = svc.createTenant({ name: 'X', country: 'SK' });
  assert.throws(() => svc.addVehicle(t.id, { plate: 'BA 111AA', category: 'N2' }), /3\.5 t/);
  assert.throws(() => svc.addVehicle(t.id, { plate: 'BA 111AA', category: 'N1', maxWeightKg: 5000 }), /3,500/);
});

test('Lift capacity: 3.5 t van never goes on a 2.5 t lift', () => {
  const ws = new Workshop({ mechanics: [{ id: 'A', name: 'A', skills: ['general'] }], bays: [{ id: 'S', name: 'Small lift', maxKg: 2500 }, { id: 'B', name: 'Big lift', maxKg: 3500 }] });
  const p = ws.place({ vehicleKg: 3500, tasks: [{ code: 'X', hours: 1 }] }, { earliest: '2026-11-16T08:00' });
  assert.equal(p.bayId, 'B');
});

test('Intake flow: start → update → complete creates customer, vehicle, mileage and queued job', () => {
  const svc = new Garagee(openDb(':memory:'));
  const seeded = seedDemo(svc);
  const tid = seeded.tenantId;
  const r1 = svc.startIntake(tid, { text: 'Dodávka BA 456XY, 61 tisíc km, nádrž plná', actor: 't' });
  assert.equal(r1.status, 'draft'); assert.equal(r1.data.category, 'N1');
  assert.ok(r1.missing.includes('customerName') && r1.missing.includes('complaint'));
  assert.throws(() => svc.completeIntake(tid, r1.ref), /not complete/);
  const r2 = svc.updateIntake(tid, r1.ref, { text: 'Zákazník Peter Horváth 0911 222 333. Problém: nefunguje klimatizácia', fields: { maxWeightKg: 3500 } });
  assert.equal(r2.complete, true, JSON.stringify(r2.missing));
  const done = svc.completeIntake(tid, r1.ref);
  assert.match(done.jobRef, /^J-\d{5}$/);
  const v = svc.vehicle(tid, done.vehicleId);
  assert.equal(v.plate, 'BA 456XY'); assert.equal(v.category, 'N1'); assert.equal(v.mileage, 61000); assert.equal(v.maxWeightKg, 3500);
  assert.equal(svc.plan(tid).unscheduledQueue.some((j) => j.ref === done.jobRef), true);
  assert.throws(() => svc.updateIntake(tid, r1.ref, { text: 'x' }), /already completed/);
});

test('Intake of a known car prefills vehicle and customer', () => {
  const svc = new Garagee(openDb(':memory:'));
  const { tenantId: tid } = seedDemo(svc);
  const r = svc.startIntake(tid, { text: 'ZA 123AB, 150 000 km, závada: klepe podvozok' });
  assert.equal(r.knownVehicle, true);
  assert.equal(r.data.customerName, 'Ján Novák');
  assert.equal(r.data.make, 'Škoda');
  assert.equal(r.complete, true, JSON.stringify(r.missing));
  const done = svc.completeIntake(tid, r.ref);
  assert.equal(done.vehicleId, svc.findVehicles(tid, 'ZA 123AB')[0].id, 'no duplicate vehicle');
});

test('intake parser: make/model/year, section boundaries, "kontrolky žiadne", Škoda vs škoda', () => {
  const a = parseIntakeText('osobné auto ZA 999ZZ, Škoda Octavia 2019 diesel, 54 tisíc km, nádrž pol, kontrolky žiadne, zákazník Eva Malá 0905 123 456, závada: hučí predné koleso, poškodenie: odreté ľavé zrkadlo, dva kľúče', { country: 'SK' }).fields;
  assert.equal(a.make, 'Škoda'); assert.equal(a.model, 'Octavia'); assert.equal(a.year, 2019);
  assert.equal(a.complaint, 'hučí predné koleso'); assert.equal(a.damage, 'odreté ľavé zrkadlo');
  assert.equal(a.warningLights, 'none'); assert.equal(a.keys, 2); assert.equal(a.customerName, 'Eva Malá');
  const b = parseIntakeText('dodávka VW Transporter T6 BA 456CD 3,2 t, 210 000 km, problém: klepe podvozok vpravo, škoda na laku zadné dvere, kontrolky: ABS svieti, majiteľ Peter Horváth +421 911 222 333', { country: 'SK' }).fields;
  assert.equal(b.make, 'Volkswagen'); assert.equal(b.model, 'Transporter T6'); assert.equal(b.category, 'N1'); assert.equal(b.maxWeightKg, 3200);
  assert.equal(b.warningLights, 'ABS svieti'); assert.match(b.complaint, /^klepe podvozok vpravo/);
  const c = parseIntakeText('škoda na laku, 120000 km', { country: 'SK' }).fields;
  assert.equal(c.make, undefined); assert.equal(c.year, undefined);
});

test('Plan limit: Start plan stops at 1000 active vehicles, archived ones free a slot, intake warns early', () => {
  const svc = new Garagee(openDb(':memory:'));
  const { tenant } = svc.signup({ shopName: 'Limit Test', country: 'SK', email: 'limit@test.example', password: 'long-password-1' });
  const tid = tenant.id;
  assert.equal(svc.usage(tid).vehicleLimit, 1000);
  let last;
  for (let i = 0; i < 1000; i++) last = svc.addVehicle(tid, { plate: `ZA ${String(100 + (i % 900))}${['AA', 'AB'][Math.floor(i / 900)]}`.replace(/(\d{3})/, (m) => m) + (i >= 900 ? '' : '') }).vehicle;
  assert.deepEqual([svc.usage(tid).vehiclesUsed, svc.usage(tid).vehiclesLeft], [1000, 0]);
  assert.throws(() => svc.addVehicle(tid, { plate: 'ZA 999XX' }), /Vehicle limit of this shop reached \(1000 of 1000/);
  const draft = svc.startIntake(tid, { text: 'osobné auto ZA 998XX, 1000 km, zákazník Ján Test 0905 000 111, závada: test' });
  assert.equal(draft.limitReached, true); assert.equal(draft.complete, false);
  const known = svc.startIntake(tid, { text: `osobné auto ${last.plate}, 2000 km, zákazník Ján Test 0905 000 111, závada: test` });
  assert.equal(known.limitReached, false);
  svc.archiveVehicle(tid, last.id, { actor: 'test' });
  assert.ok(svc.addVehicle(tid, { plate: 'ZA 999XX' }).vehicle.id);
  svc.setPlan(tid, 'profi'); assert.equal(svc.usage(tid).vehicleLimit, 2000);
});

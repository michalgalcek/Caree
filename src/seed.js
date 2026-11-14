// Demo shop for development and for the OpenAI review account (fully featured, no sign-up, no 2FA).
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { Caree } from './services.js';

export function seedDemo(svc, { email = process.env.DEMO_EMAIL || 'demo@caree.test', password = process.env.DEMO_PASSWORD || 'demo-password-123', country = 'SK' } = {}) {
  if (process.env.NODE_ENV === 'production' && !process.env.DEMO_PASSWORD) throw new Error('Set DEMO_PASSWORD (≥10 chars) to seed the review account in production.');
  if (svc.db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return null;
  const t = svc.createTenant({ name: 'Demo Autoservis', country, settings: { laborRate: 48, opening: { mon: [7, 16], tue: [7, 16], wed: [7, 16], thu: [7, 16], fri: [7, 15] } } });
  svc.createUser(t.id, { email, password, role: 'owner', name: 'Demo Owner' });
  svc.addBay(t.id, { name: 'Lift 1', type: 'lift' });
  svc.addBay(t.id, { name: 'Lift 2', type: 'lift' });
  svc.addBay(t.id, { name: 'Tyre bay', type: 'tyre' });
  svc.addMechanic(t.id, { name: 'Peter', skills: ['general', 'engine', 'drivetrain', 'diagnostics'] });
  svc.addMechanic(t.id, { name: 'Marek', skills: ['general', 'drivetrain', 'tyres', 'alignment'] });
  svc.addMechanic(t.id, { name: 'Jana', skills: ['general', 'electrical', 'diagnostics', 'ac', 'hv'] });
  svc.addSupplier(t.id, { name: 'Demo Parts A', kind: 'demo', priority: 1, priceFactor: 1.0, etaHours: 4 });
  svc.addSupplier(t.id, { name: 'Demo Parts B', kind: 'demo', priority: 2, priceFactor: 0.92, etaHours: 24 });
  svc.addSupplier(t.id, { name: 'Local supplier (e-mail)', kind: 'email', priority: 3, email: 'orders@example.com' });
  const c1 = svc.addCustomer(t.id, { name: 'Ján Novák', phone: '+421900000001', language: 'sk' });
  const c2 = svc.addCustomer(t.id, { name: 'Eva Kováčová', phone: '+421900000002', language: 'sk' });
  const v1 = svc.addVehicle(t.id, { customerId: c1.id, plate: 'ZA 123AB', vin: 'TMBJJ7NE8L0123456', model: 'Octavia', fuel: 'DIESEL', firstRegistration: '2020-04-15', lastInspection: '2024-04-10', mileage: 142000 }).vehicle;
  const v2 = svc.addVehicle(t.id, { customerId: c2.id, plate: 'ZA 777EV', make: 'Hyundai', model: 'Kona Electric', fuel: 'EV', firstRegistration: '2023-01-20', mileage: 41000 }).vehicle;
  const j = svc.book(t.id, { vehicleId: v1.id, codes: ['OIL_SERVICE', 'BRAKE_PADS_FRONT'], complaint: 'Squeaking brakes', actor: 'seed' });
  svc.q(`UPDATE jobs SET status='in_progress' WHERE id=?`).run(j.id);
  svc.recordInspection(t.id, j.ref, [
    { item: 'Front brake discs', status: 'red', measurement: '21.4 mm (min 22.0 mm)', note: 'Below minimum thickness', recommendedOp: 'BRAKE_DISCS_PADS_FRONT' },
    { item: 'Brake fluid', status: 'amber', measurement: 'Water content 3 %', recommendedOp: 'BRAKE_FLUID' },
    { item: 'Tyres', status: 'green', measurement: '5 mm' },
  ], { actor: 'seed' });
  return { tenantId: t.id, email, vehicles: [v1.id, v2.id], job: j.ref };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const svc = new Caree(openDb());
  console.log(JSON.stringify(seedDemo(svc), null, 2));
}

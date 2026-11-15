// Change a shop's plan: node scripts/plan.js owner@email.example profi   (plans: start, profi, workshop, unlimited)
// On Fly: fly ssh console -C "node scripts/plan.js owner@email.example profi"
import { openDb } from '../src/db.js';
import { Garagee } from '../src/services.js';
const [email, plan] = process.argv.slice(2);
if (!email || !plan) { console.error('usage: node scripts/plan.js <owner e-mail> <start|profi|workshop|unlimited>'); process.exit(1); }
const svc = new Garagee(openDb(process.env.CAREE_DB || './caree.db'));
const u = svc.db.prepare('SELECT tenant_id FROM users WHERE email=?').get(email.toLowerCase().trim());
if (!u) { console.error('no user with that e-mail'); process.exit(1); }
console.log(svc.setPlan(u.tenant_id, plan));

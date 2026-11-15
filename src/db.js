// Storage. SQLite (built into Node ≥22.5) for a single-machine deployment with a persistent volume.
// Every business table carries tenant_id and every query filters by it – one shop can never read another's data.
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, country TEXT NOT NULL, settings TEXT NOT NULL DEFAULT '{}', public_slug TEXT UNIQUE, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), email TEXT NOT NULL UNIQUE, name TEXT, role TEXT NOT NULL, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT, phone TEXT, email TEXT, language TEXT, marketing_consent INTEGER NOT NULL DEFAULT 0, reminders_opt_out INTEGER NOT NULL DEFAULT 0, anonymized_at TEXT, created_at TEXT NOT NULL, last_activity_at TEXT);
CREATE INDEX IF NOT EXISTS ix_customers_t ON customers(tenant_id);
CREATE TABLE IF NOT EXISTS vehicles (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, customer_id TEXT, vin TEXT, plate TEXT, make TEXT, model TEXT, engine TEXT, year INTEGER, fuel TEXT, category TEXT DEFAULT 'M1', first_registration TEXT, last_inspection TEXT, mileage INTEGER, mileage_date TEXT, archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_vehicles_t ON vehicles(tenant_id, plate);
CREATE TABLE IF NOT EXISTS mileage (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, vehicle_id TEXT NOT NULL, date TEXT NOT NULL, km INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS mechanics (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, skills TEXT NOT NULL DEFAULT '[]', hours TEXT, absences TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS bays (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'lift', capabilities TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, ref TEXT NOT NULL, vehicle_id TEXT, customer_id TEXT, status TEXT NOT NULL, title TEXT, complaint TEXT,
  start TEXT, end TEXT, bay_id TEXT, assignments TEXT NOT NULL DEFAULT '[]', estimate TEXT, customer_waiting INTEGER NOT NULL DEFAULT 0, promised_by TEXT, parts_eta TEXT,
  approval_token TEXT UNIQUE, source TEXT, invoice_total REAL, invoice_currency TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_jobs_t ON jobs(tenant_id, status);
CREATE TABLE IF NOT EXISTS job_tasks (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, job_id TEXT NOT NULL, code TEXT NOT NULL, name TEXT, hours REAL, skill TEXT, mechanics_needed INTEGER NOT NULL DEFAULT 1, mechanic_ids TEXT NOT NULL DEFAULT '[]', actual_hours REAL, make TEXT, done INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS inspection_items (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, job_id TEXT NOT NULL, item TEXT NOT NULL, status TEXT NOT NULL, note TEXT, measurement TEXT, photo_urls TEXT NOT NULL DEFAULT '[]', recommended_op TEXT, decision TEXT NOT NULL DEFAULT 'pending', decided_at TEXT, remind_next_visit INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS suppliers (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, config TEXT NOT NULL DEFAULT '{}', priority INTEGER NOT NULL DEFAULT 5, active INTEGER NOT NULL DEFAULT 1, last_ok_at TEXT, last_error TEXT, last_error_at TEXT);
CREATE TABLE IF NOT EXISTS part_orders (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, job_id TEXT, supplier_id TEXT NOT NULL, items TEXT NOT NULL, status TEXT NOT NULL, channel TEXT, result TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bookings_requests (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS offline_ops (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, client_op_id TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, actor TEXT, action TEXT NOT NULL, entity TEXT, entity_id TEXT, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS intakes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, ref TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', data TEXT NOT NULL DEFAULT '{}', transcript TEXT NOT NULL DEFAULT '', vehicle_id TEXT, customer_id TEXT, job_id TEXT, created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT);
CREATE INDEX IF NOT EXISTS ix_intakes_t ON intakes(tenant_id, status);
CREATE TABLE IF NOT EXISTS oauth_pending (rid TEXT PRIMARY KEY, data TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS login_failures (key TEXT PRIMARY KEY, n INTEGER NOT NULL, until INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_clients (client_id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_codes (code TEXT PRIMARY KEY, client_id TEXT NOT NULL, user_id TEXT NOT NULL, challenge TEXT NOT NULL, redirect_uri TEXT NOT NULL, scopes TEXT, resource TEXT, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_tokens (token TEXT PRIMARY KEY, kind TEXT NOT NULL, client_id TEXT NOT NULL, user_id TEXT NOT NULL, scopes TEXT, resource TEXT, expires_at INTEGER NOT NULL);
`;

// Additive migrations for databases created by older versions (never drop or rename – data stays).
const MIGRATIONS = [
  ['vehicles', 'max_weight_kg', 'INTEGER'],
  ['bays', 'max_kg', 'INTEGER NOT NULL DEFAULT 3500'],
  ['tenants', 'plan', "TEXT NOT NULL DEFAULT 'start'"],
];

export function openDb(file = process.env.CAREE_DB || ':memory:') {
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  for (const [table, col, type] of MIGRATIONS) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
  }
  // job references must be unique per shop
  const dup = db.prepare('SELECT tenant_id, ref FROM jobs GROUP BY tenant_id, ref HAVING COUNT(*) > 1').all();
  if (!dup.length) db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_jobs_ref ON jobs(tenant_id, ref)');
  return db;
}

export const id = () => randomUUID();
export const nowIso = () => new Date().toISOString();

export const J = {
  parse: (s, d = null) => { if (s == null) return d; try { return JSON.parse(s); } catch { return d; } },
  str: (v) => JSON.stringify(v ?? null),
};

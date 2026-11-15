// MCP server (ChatGPT Apps SDK). Tool annotations are explicit on every tool, as the OpenAI review requires.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WIDGET_URI, WIDGET_HTML } from './web/widget.js';
import { decodeVin } from './core/vin.js';
import { searchOperations, OPERATIONS } from './core/estimator.js';
import { getCountry, COUNTRIES, effectiveSettings } from './config/countries.js';
import { strings, widgetStrings, localNames } from './config/i18n.js';

const RO = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const OVERWRITE = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };
const UI = { ui: { resourceUri: WIDGET_URI }, 'openai/outputTemplate': WIDGET_URI, 'openai/widgetAccessible': true };

const ROLE_RANK = { mechanic: 1, advisor: 2, manager: 3, owner: 4 };
const opCodes = z.array(z.string().min(2).max(40)).min(1).max(15).describe('Operation codes from list_operations, e.g. ["OIL_SERVICE","BRAKE_PADS_FRONT"]');
const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/).describe('Shop-local date or date-time, YYYY-MM-DD or YYYY-MM-DDTHH:mm');

export const TOOL_ANNOTATION_NOTES = {}; // filled below – used to generate the submission justification document

export function buildMcpServer(svc, { baseUrl }) {
  const server = new McpServer({ name: 'garagee', version: '1.0.0' }, { instructions: 'Garagee manages a repair shop for passenger cars (M1) and light commercial vehicles up to 3.5 t (N1): vehicles, vehicle intake (check-in), bookings, estimates, digital inspections, workshop planning and parts orders. Heavier vehicles, motorcycles, buses and trucks are out of scope. When a technician receives a car, use start_vehicle_intake with everything they said (typed or dictated), then ask only for the missing fields and call update_vehicle_intake; finish with complete_vehicle_intake. Always confirm with the user before booking, cancelling, ordering parts or erasing data. Estimates are guidance; the shop decides the final price.' });

  server.registerResource('garagee-widget', WIDGET_URI, { title: 'Garagee view', mimeType: 'text/html;profile=mcp-app' }, async () => ({
    contents: [{ uri: WIDGET_URI, mimeType: 'text/html;profile=mcp-app', text: WIDGET_HTML, _meta: { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } }, 'openai/widgetDescription': 'Shows Garagee results: free slots, estimates, workshop plan, vehicle card or job status.' } }],
  }));

  const ctx = (extra) => {
    const a = extra?.authInfo?.extra;
    if (!a?.tenantId) throw Object.assign(new Error('Not signed in to Garagee.'), { code: 'auth' });
    return a;
  };
  const need = (who, role) => { if ((ROLE_RANK[who.role] || 0) < ROLE_RANK[role]) throw Object.assign(new Error(`Your role (${who.role}) cannot do this – ask the shop owner.`), { code: 'forbidden' }); };
  const view = (tid, v, data) => {
    const s = svc.settings(tid); const L = strings(s.language); const ui = widgetStrings(s.language);
    const { titleKey, titleArg, ...rest } = data;
    const title = titleKey ? [(ui[titleKey] || L[titleKey] || titleKey).replace('{n}', titleArg ?? ''), titleKey === 'dueIn' ? '' : (titleArg ?? '')].filter(Boolean).join(' ') : rest.title;
    return { view: v, locale: s.locale, currency: s.currency, labels: { book: L.book, labor: L.labor, parts: L.parts, total: L.total, estimateNote: L.estimateNote }, ui, names: localNames(s.language), ...rest, title };
  };

  function tool(name, { title, description, input = {}, annotations, ui = false, why }, handler) {
    TOOL_ANNOTATION_NOTES[name] = { title, annotations, why };
    server.registerTool(name, { title, description, inputSchema: input, annotations, _meta: ui ? UI : {} }, async (args, extra) => {
      try {
        const out = await handler(args, extra);
        return { content: [{ type: 'text', text: out.text }], structuredContent: out.data ?? undefined };
      } catch (e) {
        return { isError: true, content: [{ type: 'text', text: e.message || 'Error' }] };
      }
    });
  }

  // ---------------- reference
  tool('list_operations', {
    title: 'List repair operations', description: 'Search the operation catalogue (codes used for estimates and bookings). Use before estimate_job or find_free_slots when the user describes work in words.',
    input: { query: z.string().max(60).optional().describe('Words like "brake", "oil", "tyre"') }, annotations: RO,
    why: 'Reads the static catalogue only.',
  }, async ({ query }) => {
    const list = query ? searchOperations(query) : Object.entries(OPERATIONS).map(([code, o]) => ({ code, name: o.name, hours: o.hours }));
    return { text: list.map((o) => `${o.code}: ${o.name} (~${o.hours} h)`).join('\n') || 'No match – try another word.', data: { operations: list } };
  });

  tool('country_rules', {
    title: 'Country rules', description: 'Show Garagee defaults for a country: inspection rules, VAT, currency, units, languages, and whether each value was verified.',
    input: { country: z.string().length(2).describe('ISO country code, e.g. SK, DE, US') }, annotations: RO,
    why: 'Reads built-in configuration only.',
  }, async ({ country }) => {
    const c = getCountry(country);
    const supported = !!COUNTRIES[c.code];
    return { text: `${c.name} (${c.code}) – ${supported ? `tier ${c.tier}` : 'not preconfigured: generic defaults, set local rules in settings'}. Inspection: ${c.inspection.name}. VAT ${c.vat.standard} %. Currency ${c.currency}.`, data: { country: c, supported } };
  });

  tool('decode_vin', {
    title: 'Decode VIN', description: 'Validate a VIN and decode manufacturer, region and model year offline. Catches common typos (I/O/Q, length, check digit).',
    input: { vin: z.string().min(5).max(25) }, annotations: RO,
    why: 'Pure computation on the given VIN; no data stored, no external call.',
  }, async ({ vin }) => {
    const r = decodeVin(vin);
    return { text: r.valid ? `${r.vin}: ${r.make || 'unknown make'}, ${r.region}, model year ${r.modelYearCandidates.join(' or ') || '?'}.${r.warnings.length ? ' Note: ' + r.warnings.join(' ') : ''}` : `Invalid VIN: ${r.errors.join(' ')}`, data: r };
  });

  // ---------------- vehicles
  tool('find_vehicle', {
    title: 'Find vehicle', description: 'Find vehicles of this shop by licence plate, VIN, customer name or phone.',
    input: { query: z.string().min(2).max(60) }, annotations: RO, why: 'Search within the signed-in shop only.',
  }, async ({ query }, extra) => {
    const a = ctx(extra);
    const list = svc.findVehicles(a.tenantId, query);
    return { text: list.length ? list.map((v) => `${v.plate || '-'} · ${[v.make, v.model, v.year].filter(Boolean).join(' ')} · ${v.customerName || ''} (id ${v.id})`).join('\n') : 'No vehicle found. You can add it with add_vehicle.', data: { vehicles: list } };
  });

  tool('get_vehicle', {
    title: 'Vehicle card', description: 'Vehicle card: next statutory inspection (STK/MOT/HU/ITV…), upcoming maintenance, work the customer declined earlier, job history.',
    input: { vehicleId: z.string() }, annotations: RO, ui: true, why: 'Reads data of the signed-in shop.',
  }, async ({ vehicleId }, extra) => {
    const a = ctx(extra);
    const card = svc.vehicleCard(a.tenantId, vehicleId);
    const v = card.vehicle;
    const ni = card.nextInspection;
    return {
      text: `${v.plate || ''} ${v.make || ''} ${v.model || ''}. ${ni.due ? `${ni.name} due ${ni.due}${ni.assumedFromRegistration ? ' (calculated from first registration – confirm in documents)' : ''}.` : `Inspection: ${ni.reason}.`} ${card.maintenance.items.slice(0, 3).map((m) => `${m.name} ~${m.due}`).join(', ')}${card.declinedWorkToRemind.length ? `. Remind: ${card.declinedWorkToRemind.map((d) => d.item).join(', ')}` : ''}`,
      data: view(a.tenantId, 'vehicle', { titleKey: 'vehicle', ...card, customer: card.customer ? { name: card.customer.name } : null }),
    };
  });

  tool('add_vehicle', {
    title: 'Add vehicle and customer', description: 'Add a passenger car (M1) or van up to 3.5 t (N1), and optionally a new customer. Requires VIN or licence plate. For a car that has just arrived at the workshop prefer start_vehicle_intake. Ask for the date of first registration – needed for inspection reminders.',
    input: {
      vin: z.string().max(25).optional(), plate: z.string().max(20).optional(), make: z.string().max(40).optional(), model: z.string().max(60).optional(),
      fuel: z.enum(['PETROL', 'DIESEL', 'LPG', 'CNG', 'HYBRID', 'EV']).optional(), firstRegistration: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      category: z.enum(['M1', 'N1']).default('M1').describe('M1 = passenger car, N1 = light commercial vehicle (van) up to 3.5 t'),
      maxWeightKg: z.number().int().min(500).max(3500).optional().describe('Max. permissible weight; Garagee only accepts vehicles up to 3,500 kg'),
      lastInspection: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), mileage: z.number().int().min(0).max(2000000).optional(),
      customerId: z.string().optional(), customerName: z.string().max(120).optional(), customerPhone: z.string().max(40).optional(), customerEmail: z.string().email().optional(),
    }, annotations: WRITE, why: 'Creates a record in the shop; nothing is deleted or sent.',
  }, async (p, extra) => {
    const a = ctx(extra); need(a, 'advisor');
    let customerId = p.customerId || null;
    if (!customerId && p.customerName) customerId = svc.addCustomer(a.tenantId, { name: p.customerName, phone: p.customerPhone, email: p.customerEmail }).id;
    const r = svc.addVehicle(a.tenantId, { ...p, customerId });
    return { text: `Vehicle added (id ${r.vehicle.id}).${r.vinWarnings.length ? ' ' + r.vinWarnings.join(' ') : ''}`, data: r };
  });

  tool('upcoming_services', {
    title: 'Upcoming services', description: 'Vehicles of the shop\'s customers that need a statutory inspection, maintenance or previously declined work soon – for proactive booking.',
    input: { days: z.number().int().min(7).max(365).default(60) }, annotations: RO, ui: true, why: 'Reads data of the signed-in shop.',
  }, async ({ days }, extra) => {
    const a = ctx(extra);
    const list = svc.upcoming(a.tenantId, days);
    const rows = list.map((x) => [x.plate || '-', [x.make, x.model].filter(Boolean).join(' '), x.inspection ? `${x.inspection.name} ${x.inspection.due}` : '', x.maintenance.map((m) => m.name).join(', '), x.alreadyBooked ? 'booked' : '']);
    return { text: list.length ? `${list.length} vehicle(s) need attention in ${days} days.` : 'Nothing due in this period.', data: view(a.tenantId, 'list', { titleKey: 'dueIn', titleArg: days, rows, items: list }) };
  });

  // ---------------- estimates & booking
  tool('estimate_job', {
    title: 'Estimate job', description: 'Estimate labour time and price for operations on a vehicle. Shows the source of every number, removes double-counted time and learns from this shop\'s real times.',
    input: { operations: opCodes, vehicleId: z.string().optional() }, annotations: RO, ui: true, why: 'Calculation only; nothing is stored.',
  }, async ({ operations, vehicleId }, extra) => {
    const a = ctx(extra);
    const e = svc.estimateFor(a.tenantId, { vehicleId, codes: operations });
    return { text: `Estimate: ${e.labourHours} h, total ${e.totals.gross} ${e.currency} incl. ${e.vatRate} % tax.${e.notes.length ? ' ' + e.notes.join(' ') : ''}${e.suggestedFollowUps.length ? ' Usually also needed: ' + e.suggestedFollowUps.map((f) => f.name).join(', ') + '.' : ''}`, data: view(a.tenantId, 'estimate', { titleKey: 'estimate', ...e }) };
  });

  tool('find_free_slots', {
    title: 'Find free slots', description: 'Find the earliest free appointments for given operations, based on real capacity: lifts/bays, mechanics with the right skills, opening hours and parts arrival.',
    input: { operations: opCodes, vehicleId: z.string().optional(), earliest: localDateTime.optional(), count: z.number().int().min(1).max(6).default(3) },
    annotations: RO, ui: true, why: 'Reads the schedule; does not reserve anything.',
  }, async ({ operations, vehicleId, earliest, count }, extra) => {
    const a = ctx(extra);
    const r = svc.freeSlots(a.tenantId, { codes: operations, vehicleId, earliest, count });
    return { text: r.slots.length ? `Free: ${r.slots.map((s) => s.start.replace('T', ' ')).join(', ')} (${r.timezone}).` : 'No free slot in the next 3 weeks.', data: view(a.tenantId, 'slots', { titleKey: 'freeSlots', ...r, vehicleId, operations }) };
  });

  tool('book_appointment', {
    title: 'Book appointment', description: 'Book a job for a vehicle. Confirm the time with the user first. If start is omitted, the earliest free slot is used.',
    input: { vehicleId: z.string(), operations: opCodes, start: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional(), complaint: z.string().max(500).optional(), customerWaiting: z.boolean().default(false) },
    annotations: WRITE, why: 'Creates a booking inside the shop; reversible with reschedule/cancel; nothing is sent to anyone.',
  }, async (p, extra) => {
    const a = ctx(extra); need(a, 'advisor');
    const j = svc.book(a.tenantId, { vehicleId: p.vehicleId, codes: p.operations, start: p.start, complaint: p.complaint, customerWaiting: p.customerWaiting, source: 'chatgpt', actor: a.email });
    return { text: `Booked ${j.ref}: ${j.start.replace('T', ' ')}–${j.end.replace('T', ' ')}.`, data: { job: j } };
  });

  tool('reschedule_appointment', {
    title: 'Reschedule appointment', description: 'Move a booked job to the earliest free time at or after the given date.',
    input: { jobRef: z.string(), earliest: localDateTime }, annotations: OVERWRITE, why: 'Replaces the booked time of an existing job (overwrite), so it is marked destructive; nothing is sent.',
  }, async ({ jobRef, earliest }, extra) => {
    const a = ctx(extra); need(a, 'advisor');
    const j = svc.reschedule(a.tenantId, jobRef, { earliest: earliest.length === 10 ? earliest + 'T00:00' : earliest, actor: a.email });
    return { text: `${j.ref} moved to ${j.start.replace('T', ' ')}.`, data: { job: j } };
  });

  tool('cancel_appointment', {
    title: 'Cancel appointment', description: 'Cancel a booked job. Ask the user to confirm first.',
    input: { jobRef: z.string(), reason: z.string().max(200).optional() }, annotations: DESTRUCTIVE, why: 'Cancellation frees the slot and cannot be undone automatically.',
  }, async ({ jobRef, reason }, extra) => {
    const a = ctx(extra); need(a, 'advisor');
    const r = svc.cancel(a.tenantId, jobRef, { actor: a.email, reason });
    return { text: `${r.ref} cancelled.`, data: r };
  });

  tool('job_status', {
    title: 'Job status', description: 'Status of a job by job reference or licence plate: booked, in the workshop, waiting for approval or parts, finished.',
    input: { query: z.string().min(2).max(40) }, annotations: RO, ui: true, why: 'Reads data of the signed-in shop.',
  }, async ({ query }, extra) => {
    const a = ctx(extra);
    const s = svc.jobStatus(a.tenantId, query);
    return { text: `${s.ref}: ${s.summary}`, data: view(a.tenantId, 'status', { title: `${s.ref} ${s.vehicle?.plate || ''}`, ...s }) };
  });

  // ---------------- inspection & approval
  tool('record_inspection', {
    title: 'Record inspection findings', description: 'Record digital vehicle inspection findings for a job (green/amber/red, measurement, note, photo URLs, recommended operation).',
    input: {
      jobRef: z.string(),
      items: z.array(z.object({ item: z.string().max(80), status: z.enum(['green', 'amber', 'red']), measurement: z.string().max(60).optional(), note: z.string().max(300).optional(), photoUrls: z.array(z.string().url()).max(6).optional(), recommendedOp: z.string().max(40).optional() })).min(1).max(40),
    }, annotations: WRITE, why: 'Adds findings to a job; nothing is sent to the customer.',
  }, async ({ jobRef, items }, extra) => {
    const a = ctx(extra); need(a, 'mechanic');
    const list = svc.recordInspection(a.tenantId, jobRef, items, { actor: a.email });
    return { text: `${items.length} finding(s) saved. ${list.filter((i) => i.status === 'red').length} red, ${list.filter((i) => i.status === 'amber').length} amber.`, data: { inspection: list } };
  });

  tool('create_approval_link', {
    title: 'Create approval link', description: 'Create a link where the customer sees findings with photos and prices and approves or declines each item. Garagee does not send it – give the link to the user to share.',
    input: { jobRef: z.string() }, annotations: WRITE, why: 'Creates a private link; nothing is sent automatically.',
  }, async ({ jobRef }, extra) => {
    const a = ctx(extra); need(a, 'advisor');
    const r = svc.approvalLink(a.tenantId, jobRef, baseUrl);
    return { text: `Approval link (${r.itemsToApprove} item(s)): ${r.url}`, data: r };
  });

  // ---------------- parts
  tool('compare_parts', {
    title: 'Compare parts prices', description: 'Ask the shop\'s chosen suppliers for price, availability and delivery time of the parts on a job. A supplier that is down is skipped, never blocking the comparison.',
    input: { jobRef: z.string() }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }, why: 'Read-only price requests to external supplier systems chosen by the shop (therefore openWorld).',
  }, async ({ jobRef }, extra) => {
    const a = ctx(extra);
    const r = await svc.compare(a.tenantId, jobRef);
    const rows = Object.entries(r.best || {}).map(([code, b]) => `${code}: ${b ? `${b.supplier} ${b.unitCost ?? '?'} ${b.available === false ? '(not in stock)' : ''} ETA ${b.eta || '?'}` : 'no offer'}`);
    return { text: rows.join('\n') || r.note, data: r };
  });

  tool('order_parts', {
    title: 'Order parts', description: 'Send a parts order to a supplier. Always show the items, supplier and total to the user and get explicit confirmation before calling. If the supplier API fails, an e-mail order is prepared instead.',
    input: { jobRef: z.string(), supplierId: z.string(), items: z.array(z.object({ code: z.string(), name: z.string().max(120), qty: z.number().int().min(1).max(50), supplierPartNo: z.string().max(60).optional(), unitCost: z.number().optional(), eta: z.string().optional() })).min(1).max(30), confirmed: z.literal(true).describe('Must be true – only after the user confirmed the order') },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }, why: 'Sends an order to an external supplier – an irreversible commercial action.',
  }, async ({ jobRef, supplierId, items }, extra) => {
    const a = ctx(extra); need(a, 'advisor');
    const r = await svc.order(a.tenantId, jobRef, { supplierId, items, actor: a.email });
    return { text: r.status === 'fallback_email' ? `Supplier API failed – e-mail order prepared for ${r.to}. Please send it.` : `Order ${r.status} (${r.channel}).`, data: r };
  });

  // ---------------- planning
  tool('plan_workshop', {
    title: 'Workshop plan', description: 'Plan for a day: jobs per lift and mechanic, utilisation, and the queue of requested jobs in priority order (waiting customers first).',
    input: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }, annotations: RO, ui: true, why: 'Reads the schedule.',
  }, async ({ date }, extra) => {
    const a = ctx(extra);
    const p = svc.plan(a.tenantId, date);
    return { text: `${p.date}: ${p.jobs.length} job(s). ${p.utilisation.open ? p.utilisation.mechanics.map((m) => `${m.name} ${m.busyPct} %`).join(', ') : 'Closed.'}`, data: view(a.tenantId, 'plan', { titleKey: 'plan', titleArg: p.date, ...p }) };
  });

  tool('booking_requests', {
    title: 'New booking requests', description: 'Booking requests drivers sent through the shop\'s public booking link.',
    input: {}, annotations: RO, why: 'Reads data of the signed-in shop.',
  }, async (_p, extra) => {
    const a = ctx(extra);
    const list = svc.bookingRequests(a.tenantId);
    const shop = svc.tenant(a.tenantId);
    return { text: `${list.length} new request(s). Public booking link: ${baseUrl}/b/${shop.public_slug}`, data: { requests: list, bookingLink: `${baseUrl}/b/${shop.public_slug}` } };
  });

  // ---------------- setup
  tool('get_shop_settings', {
    title: 'Shop settings', description: 'Effective settings of the shop (country defaults merged with the shop\'s own values), lifts, mechanics and suppliers.',
    input: {}, annotations: RO, why: 'Reads configuration.',
  }, async (_p, extra) => {
    const a = ctx(extra);
    const s = svc.settings(a.tenantId);
    const missing = [s.laborRate == null && 'labour rate', !svc.bays(a.tenantId).length && 'lifts/bays', !svc.mechanics(a.tenantId).length && 'mechanics', s.currency !== 'EUR' && s.fxFromEur == null && 'EUR exchange rate for reference part prices'].filter(Boolean);
    return { text: `${s.countryName}, ${s.currency}, tax ${s.vatRate} %, labour ${s.laborRate ?? 'NOT SET'}/h.${missing.length ? ' Missing: ' + missing.join(', ') + '.' : ''}`, data: { settings: s, bays: svc.bays(a.tenantId), mechanics: svc.mechanics(a.tenantId), suppliers: svc.suppliers(a.tenantId).map(({ apiKey, health, ...x }) => ({ ...x, status: health?.lastError ? 'last request failed' : 'ok' })), missing } };
  });

  tool('set_shop_settings', {
    title: 'Change shop settings', description: 'Change shop settings: labour rate, tax rate, currency, language, timezone, opening hours, parts markup, retention.',
    input: {
      laborRate: z.number().min(0).max(100000).optional(), vatRate: z.number().min(0).max(40).optional(), currency: z.string().length(3).optional(), language: z.string().min(2).max(5).optional(),
      timezone: z.string().max(40).optional(), shopSuppliesPct: z.number().min(0).max(20).optional(), fxFromEur: z.number().positive().optional(), retentionYears: z.number().int().min(1).max(30).optional(),
      opening: z.record(z.string(), z.array(z.number().min(0).max(24)).length(2)).optional().describe('e.g. {"mon":[8,17],"sat":[8,12]}'),
    }, annotations: OVERWRITE, why: 'Replaces existing shop settings values (overwrite), so it is marked destructive; nothing is sent.',
  }, async (p, extra) => {
    const a = ctx(extra); need(a, 'manager');
    const s = svc.updateSettings(a.tenantId, p, a.email);
    return { text: 'Settings saved.', data: { settings: s } };
  });

  tool('setup_workshop', {
    title: 'Add lifts, mechanics, suppliers', description: 'Add lifts/bays, mechanics (with skills: general, engine, drivetrain, electrical, diagnostics, ac, tyres, alignment, hv) or parts suppliers.',
    input: {
      bays: z.array(z.object({ name: z.string().max(40), type: z.enum(['lift', 'tyre', 'alignment', 'ev']).default('lift'), maxKg: z.number().int().min(1000).max(3500).default(3500).describe('Lift capacity in kg (vans up to 3.5 t need a 3.5 t lift)') })).max(30).optional(),
      mechanics: z.array(z.object({ name: z.string().max(60), skills: z.array(z.enum(['general', 'engine', 'drivetrain', 'electrical', 'diagnostics', 'ac', 'tyres', 'alignment', 'hv'])).default(['general']) })).max(50).optional(),
      suppliers: z.array(z.object({ name: z.string().max(60), email: z.string().email().optional(), priority: z.number().int().min(1).max(9).default(5) })).max(20).optional(),
    }, annotations: WRITE, why: 'Adds configuration records; nothing is deleted.',
  }, async ({ bays = [], mechanics = [], suppliers = [] }, extra) => {
    const a = ctx(extra); need(a, 'manager');
    const out = { bays: bays.map((b) => svc.addBay(a.tenantId, b)), mechanics: mechanics.map((m) => svc.addMechanic(a.tenantId, m)), suppliers: suppliers.map((s) => svc.addSupplier(a.tenantId, { ...s, kind: 'email' })) };
    return { text: `Added ${out.bays.length} bay(s), ${out.mechanics.length} mechanic(s), ${out.suppliers.length} supplier(s).`, data: out };
  });

  // ---------------- vehicle intake (vstupná prehliadka) – typed or dictated
  const intakeInput = {
    text: z.string().max(5000).optional().describe('Everything the technician typed or dictated, verbatim (any language). Garagee extracts what it can.'),
    fields: z.object({
      plate: z.string().max(20).optional(), vin: z.string().max(25).optional(), make: z.string().max(40).optional(), model: z.string().max(60).optional(),
      year: z.number().int().min(1950).max(2100).optional(), category: z.enum(['M1', 'N1']).optional().describe('M1 passenger car, N1 van ≤ 3.5 t'),
      maxWeightKg: z.number().int().min(500).max(60000).optional(), fuel: z.enum(['PETROL', 'DIESEL', 'LPG', 'CNG', 'HYBRID', 'EV']).optional(),
      firstRegistration: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), lastInspection: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      mileage: z.number().int().min(0).max(3000000).optional(), fuelLevel: z.string().max(30).optional(), warningLights: z.string().max(200).optional(),
      damage: z.string().max(500).optional(), tyres: z.string().max(200).optional(), itemsInCar: z.string().max(200).optional(), keys: z.number().int().min(0).max(10).optional(),
      customerName: z.string().max(120).optional(), customerPhone: z.string().max(40).optional(), customerEmail: z.string().email().optional(),
      complaint: z.string().max(1000).optional(), customerWaiting: z.boolean().optional(), promisedBy: z.string().max(20).optional(), notes: z.string().max(1000).optional(),
    }).optional().describe('Structured values you already understood from the conversation'),
  };
  const intakeText = (r) => `Intake ${r.ref} (${r.status}). ${r.complete ? 'All required data is filled.' : `Missing: ${r.missingLabels.join(', ')}.`}${r.recommendedLabels?.length ? ` Recommended: ${r.recommendedLabels.join(', ')}.` : ''}${r.errors?.length ? ` Problems: ${r.errors.join('; ')}.` : ''}`;

  tool('start_vehicle_intake', {
    title: 'Start vehicle intake', description: 'Start the check-in (vstupná prehliadka) of a car or van ≤ 3.5 t that has just arrived: pass everything the technician said or typed. Returns what was recognised and which required fields are still missing – then ask the technician only for those. A known plate/VIN is prefilled from the database.',
    input: intakeInput, annotations: WRITE, ui: true, why: 'Creates a draft intake record in the shop; nothing is sent or deleted.',
  }, async ({ text, fields }, extra) => {
    const a = ctx(extra); need(a, 'mechanic');
    const r = svc.startIntake(a.tenantId, { text, fields: fields || {}, actor: a.email });
    return { text: intakeText(r) + (r.knownVehicle ? ' Vehicle is already in the database – data prefilled.' : ''), data: view(a.tenantId, 'intake', { titleKey: 'intake', titleArg: r.ref, ...r }) };
  });

  tool('update_vehicle_intake', {
    title: 'Add to vehicle intake', description: 'Add more information to a draft intake (what the technician said or typed next). Values are merged; existing values are only replaced by new non-empty ones.',
    input: { ref: z.string().describe('Intake reference, e.g. I-00001'), ...intakeInput }, annotations: OVERWRITE, ui: true, why: 'Replaces field values of an unfinished intake draft (overwrite), so it is marked destructive; nothing is sent.',
  }, async ({ ref, text, fields }, extra) => {
    const a = ctx(extra); need(a, 'mechanic');
    const r = svc.updateIntake(a.tenantId, ref, { text, fields: fields || {}, actor: a.email });
    return { text: intakeText(r), data: view(a.tenantId, 'intake', { titleKey: 'intake', titleArg: r.ref, ...r }) };
  });

  tool('complete_vehicle_intake', {
    title: 'Complete vehicle intake', description: 'Finish the intake: saves the customer and vehicle in the database, records the mileage and creates a job in the planning queue. Read the summary back to the technician and get confirmation first.',
    input: { ref: z.string() }, annotations: WRITE, ui: true, why: 'Creates customer, vehicle and job records in the shop; nothing is sent or deleted.',
  }, async ({ ref }, extra) => {
    const a = ctx(extra); need(a, 'mechanic');
    const r = svc.completeIntake(a.tenantId, ref, { actor: a.email });
    return { text: `Intake ${r.ref} completed. Job ${r.jobRef} is waiting in the planning queue. Next: estimate the work and book a slot.`, data: view(a.tenantId, 'intake', { titleKey: 'intake', titleArg: r.ref, ...r }) };
  });

  tool('list_open_intakes', {
    title: 'Open intakes', description: 'Intakes started but not yet completed.', input: {}, annotations: RO, why: 'Reads data of the signed-in shop.',
  }, async (_p, extra) => {
    const a = ctx(extra);
    const list = svc.openIntakes(a.tenantId);
    return { text: list.length ? list.map((r) => `${r.ref}: ${r.data.plate || r.data.vin || '?'} – missing ${r.missingLabels.join(', ') || 'nothing'}`).join('\n') : 'No open intakes.', data: { intakes: list } };
  });

  // ---------------- GDPR
  tool('export_customer_data', {
    title: 'Export customer data', description: 'Export all data of one customer (GDPR access/portability request).',
    input: { customerId: z.string() }, annotations: RO, why: 'Reads data; the export is shown only to the signed-in shop user.',
  }, async ({ customerId }, extra) => {
    const a = ctx(extra); need(a, 'manager');
    const r = svc.exportCustomer(a.tenantId, customerId);
    return { text: `Export ready: ${r.vehicles.length} vehicle(s), ${r.jobs.length} job(s).`, data: r };
  });

  tool('erase_customer_data', {
    title: 'Erase customer personal data', description: 'Anonymise a customer (GDPR erasure). Jobs and invoice totals are kept without personal data for accounting. Ask the user to confirm first.',
    input: { customerId: z.string(), confirmed: z.literal(true) }, annotations: DESTRUCTIVE, why: 'Irreversibly removes personal data.',
  }, async ({ customerId }, extra) => {
    const a = ctx(extra); need(a, 'manager');
    const r = svc.anonymizeCustomer(a.tenantId, customerId, { actor: a.email });
    return { text: 'Customer personal data erased; accounting records kept without personal data.', data: r };
  });

  return server;
}

export { effectiveSettings };

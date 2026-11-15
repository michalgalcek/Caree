// Public legal pages required by the OpenAI app directory (live URLs, not PDFs).
// IMPORTANT: have a lawyer review before launch. Company details come from environment variables.
import { page, esc } from './html.js';

const co = () => ({
  name: process.env.COMPANY_NAME || 'housee s.r.o.',
  address: process.env.COMPANY_ADDRESS || '[registered address – set COMPANY_ADDRESS]',
  regNo: process.env.COMPANY_ID || '[company ID (IČO) – set COMPANY_ID]',
  email: process.env.SUPPORT_EMAIL || 'set-SUPPORT_EMAIL@example.invalid',
  privacyEmail: process.env.PRIVACY_EMAIL || process.env.SUPPORT_EMAIL || 'set-PRIVACY_EMAIL@example.invalid',
  updated: process.env.LEGAL_UPDATED || '2026-11-14',
});

export function privacyPage() {
  const c = co();
  return page('Garagee – Privacy policy', `
<h1>Privacy policy</h1><p class="muted">Last updated ${esc(c.updated)}</p>
<h2>Who we are</h2>
<p>Garagee is a workshop management assistant for repair shops servicing passenger cars and light commercial vehicles up to 3.5 t, available as an app in ChatGPT and on the web. It is operated by ${esc(c.name)}, ${esc(c.address)}, company ID ${esc(c.regNo)} ("we"). Contact: <a href="mailto:${esc(c.privacyEmail)}">${esc(c.privacyEmail)}</a>.</p>
<h2>Our role</h2>
<ul>
<li><b>Data of repair-shop customers</b> (drivers, their vehicles, repairs): the repair shop is the <b>controller</b>. We process this data only on the shop's instructions as a <b>processor</b> under a data processing agreement (Art. 28 GDPR, see <a href="/dpa">DPA</a>). Requests about this data should go to the repair shop; we help the shop answer them.</li>
<li><b>Data of shop staff accounts</b> (name, e-mail, login data) and of people who contact us: we are the <b>controller</b>.</li>
</ul>
<h2>What we process and why</h2>
<table><tr><th>Data</th><th>Purpose</th><th>Legal basis</th></tr>
<tr><td>Driver name, phone, e-mail, preferred language</td><td>Bookings, estimates, status updates, reminders</td><td>Contract with the shop (Art. 6(1)(b)); reminders: shop's legitimate interest with opt-out (6(1)(f)); marketing only with consent (6(1)(a))</td></tr>
<tr><td>Vehicle: VIN, licence plate, make/model, mileage, inspection dates</td><td>Service history, estimates, planning, parts identification</td><td>Contract (6(1)(b)). A VIN can be personal data when linked to a person.</td></tr>
<tr><td>Repairs, inspection findings, photos, approvals, invoices</td><td>Running the repair; accounting obligations</td><td>Contract; legal obligation (6(1)(c))</td></tr>
<tr><td>Staff account data, sign-in and security logs</td><td>Access control, security, audit</td><td>Contract / legitimate interest in security</td></tr>
</table>
<p>We do <b>not</b> collect payment card numbers, government ID numbers, passwords of other services, health data or precise location. We do not sell data, show ads, or build behavioural profiles.</p>
<h2>ChatGPT</h2>
<p>When you use Garagee inside ChatGPT, ChatGPT sends Garagee only the inputs of the tools it calls (for example a licence plate and the requested service). Garagee never asks for your chat history. Your conversation itself is handled by OpenAI under <a href="https://openai.com/policies/privacy-policy">OpenAI's privacy policy</a>.</p>
<h2>Recipients and sub-processors</h2>
<ul><li>Hosting: Fly.io, Inc. – servers in the EU (Frankfurt region).</li>
<li>Parts suppliers chosen by the shop: only the VIN and the parts ordered – never the driver's name or contact.</li>
<li>Technical data providers (e.g. labour times, VIN decoding) if the shop enables them: VIN only.</li>
<li>OpenAI, when the shop or driver uses Garagee in ChatGPT (results of the tools they call).</li></ul>
<p>Transfers outside the EEA rely on adequacy decisions or Standard Contractual Clauses.</p>
<h2>How long we keep data</h2>
<p>As long as the shop uses Garagee. Inactive drivers are anonymised automatically after the retention period set by the shop (default 10 years, to cover accounting rules). Invoices are kept for the statutory period without personal data where possible. After a shop leaves, data is exported to the shop and deleted within 90 days.</p>
<h2>Your rights</h2>
<p>Access, rectification, erasure, restriction, portability, objection and withdrawal of consent. Drivers: contact your repair shop (Garagee gives the shop one-click export and erasure). Shop owners can delete their whole shop account at any time at <a href="/account/delete">/account/delete</a>. Staff and other contacts: write to <a href="mailto:${esc(c.privacyEmail)}">${esc(c.privacyEmail)}</a>. You can complain to your data protection authority (in Slovakia: Úrad na ochranu osobných údajov SR).</p>
<h2>Security</h2>
<p>Encryption in transit (TLS), hashed passwords and tokens, strict separation of each shop's data, audit log of changes, regular backups.</p>`);
}

export function termsPage() {
  const c = co();
  return page('Garagee – Terms of service', `
<h1>Terms of service</h1><p class="muted">Last updated ${esc(c.updated)}</p>
<p>These terms govern the use of Garagee, operated by ${esc(c.name)}, ${esc(c.address)}, company ID ${esc(c.regNo)}.</p>
<h2>Plans and limits</h2>
<p>New shops start on the Start plan with up to 1,000 active (not archived) vehicles. Vehicles already stored always remain usable; when the limit is reached only adding new vehicles is paused. Other plans are agreed directly with housee s.r.o.; their limits are listed at <a href="/plans">/plans</a> and apply equally in ChatGPT, on the tablet and on the web.</p>
<h2>1. Service</h2><p>Garagee helps repair shops for passenger cars (M1) and light commercial vehicles up to 3.5 t (N1) manage vehicle intake, vehicles, bookings, estimates, inspections, planning and parts orders. Drivers can request bookings and approve or decline recommended work.</p>
<h2>2. Estimates and AI suggestions</h2><p>Time and price estimates, inspection due dates and diagnostic suggestions are <b>guidance</b>. The repair shop is responsible for the final diagnosis, price and work. Statutory inspection dates must be checked against the vehicle documents. No work is added to a job without the driver's approval through the shop.</p>
<h2>3. Accounts</h2><p>Shop accounts are for businesses. Keep sign-in details confidential. The shop is responsible for its staff's use.</p>
<h2>4. Fair terms</h2><ul><li>Monthly plans can be cancelled at any time, effective at the end of the paid month – no hidden notice periods.</li><li>The shop can export all its data at any time in open formats (JSON/CSV).</li><li>Price changes are announced at least 30 days in advance.</li></ul>
<h2>5. Payments</h2><p>Subscriptions are purchased only on our website, never inside ChatGPT.</p>
<h2>6. Acceptable use</h2><p>No unlawful use, no attempts to access other shops' data, no automated scraping.</p>
<h2>7. Liability</h2><p>We provide the service with reasonable care. Liability for indirect damage is excluded to the extent permitted by law. Nothing limits liability that cannot be limited by law, including consumer rights.</p>
<h2>8. Data protection</h2><p>See the <a href="/privacy">Privacy policy</a> and the <a href="/dpa">Data processing agreement</a>.</p>
<h2>9. Law</h2><p>Slovak law applies, without prejudice to mandatory consumer protection rules of your country.</p>
<h2>Contact</h2><p><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></p>`);
}

export function dpaPage() {
  const c = co();
  return page('Garagee – Data processing agreement', `
<h1>Data processing agreement (Art. 28 GDPR)</h1><p class="muted">Part of the terms accepted by every repair shop ("controller") when it creates a Garagee account. Processor: ${esc(c.name)}.</p>
<ol>
<li><b>Subject and duration:</b> processing of the shop's customer, vehicle and repair data for providing Garagee, for the duration of the subscription.</li>
<li><b>Categories:</b> drivers and vehicle keepers; identity and contact data, vehicle data incl. VIN and plate, repair and invoice data, photos of vehicles.</li>
<li><b>Instructions:</b> the processor acts only on documented instructions of the controller (use of the service and its settings).</li>
<li><b>Confidentiality:</b> persons with access are bound to confidentiality.</li>
<li><b>Security (Art. 32):</b> TLS, per-shop data isolation, hashed credentials, access logging, backups, least-privilege access.</li>
<li><b>Sub-processors:</b> Fly.io (hosting, EU region); data partners enabled by the controller. The controller is informed of changes in advance and may object.</li>
<li><b>Assistance:</b> export, correction and erasure functions for data-subject requests; assistance with breaches (notification without undue delay, at most 48 hours after becoming aware) and DPIAs.</li>
<li><b>End of contract:</b> export to the controller, deletion within 90 days unless law requires storage.</li>
<li><b>Audit:</b> information needed to demonstrate compliance is provided on request.</li>
</ol>`);
}

export function supportPage() {
  const c = co();
  return page('Garagee – Support', `<h1>Garagee support</h1><p>E-mail: <a href="mailto:${esc(c.email)}">${esc(c.email)}</a></p>
<p>Drivers: for questions about your car or repair, contact your repair shop directly.</p>
<p><a href="/privacy">Privacy policy</a> · <a href="/terms">Terms</a> · <a href="/dpa">DPA</a></p>`);
}

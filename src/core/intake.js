// Vehicle intake ("vstupná prehliadka"): the technician registers a newly received car while walking around it –
// by typing or by voice. Works incrementally: every call adds what was said, Garagee answers what is still missing.
import { decodeVin, normalizeVin } from './vin.js';

/** Field schema. required = must be filled before the intake can be completed. */
export const INTAKE_FIELDS = [
  { key: 'plate', group: 'vehicle', required: 'plateOrVin' },
  { key: 'vin', group: 'vehicle', required: 'plateOrVin' },
  { key: 'make', group: 'vehicle' },
  { key: 'model', group: 'vehicle' },
  { key: 'year', group: 'vehicle' },
  { key: 'category', group: 'vehicle', required: true, enum: ['M1', 'N1'] }, // passenger car / light commercial vehicle
  { key: 'maxWeightKg', group: 'vehicle' }, // permissible total weight, must be ≤ 3500 kg
  { key: 'fuel', group: 'vehicle', enum: ['PETROL', 'DIESEL', 'LPG', 'CNG', 'HYBRID', 'EV'] },
  { key: 'firstRegistration', group: 'vehicle' },
  { key: 'lastInspection', group: 'vehicle' },
  { key: 'mileage', group: 'condition', required: true },
  { key: 'fuelLevel', group: 'condition', recommended: true },
  { key: 'warningLights', group: 'condition' },
  { key: 'damage', group: 'condition', recommended: true },
  { key: 'tyres', group: 'condition' },
  { key: 'itemsInCar', group: 'condition' },
  { key: 'keys', group: 'condition' },
  { key: 'customerName', group: 'customer', required: true },
  { key: 'customerPhone', group: 'customer', required: true },
  { key: 'customerEmail', group: 'customer' },
  { key: 'complaint', group: 'job', required: true },
  { key: 'customerWaiting', group: 'job' },
  { key: 'promisedBy', group: 'job' },
  { key: 'notes', group: 'job' },
];

export const MAX_WEIGHT_KG = 3500;

export const INTAKE_LABELS = {
  en: { category: 'Vehicle type (car / van ≤ 3.5 t)', maxWeightKg: 'Max. permissible weight (kg)', plate: 'Licence plate', vin: 'VIN', make: 'Make', model: 'Model', year: 'Year', fuel: 'Fuel', firstRegistration: 'First registration', lastInspection: 'Last inspection', mileage: 'Mileage', fuelLevel: 'Fuel / charge level', warningLights: 'Warning lights', damage: 'Visible damage', tyres: 'Tyres', itemsInCar: 'Items left in car', keys: 'Keys', customerName: 'Customer name', customerPhone: 'Customer phone', customerEmail: 'Customer e-mail', complaint: 'What is the problem / what to do', customerWaiting: 'Customer waits', promisedBy: 'Promised by', notes: 'Notes' },
  sk: { category: 'Druh vozidla (osobné / úžitkové do 3,5 t)', maxWeightKg: 'Najväčšia prípustná hmotnosť (kg)', plate: 'EČV', vin: 'VIN', make: 'Značka', model: 'Model', year: 'Rok výroby', fuel: 'Palivo', firstRegistration: 'Prvá evidencia', lastInspection: 'Posledná STK', mileage: 'Stav km', fuelLevel: 'Palivo / nabitie', warningLights: 'Kontrolky', damage: 'Viditeľné poškodenie', tyres: 'Pneumatiky', itemsInCar: 'Veci vo vozidle', keys: 'Kľúče', customerName: 'Meno zákazníka', customerPhone: 'Telefón zákazníka', customerEmail: 'E-mail zákazníka', complaint: 'Problém / požiadavka zákazníka', customerWaiting: 'Zákazník čaká', promisedBy: 'Sľúbené do', notes: 'Poznámky' },
  cs: { category: 'Druh vozidla (osobní / užitkové do 3,5 t)', maxWeightKg: 'Největší povolená hmotnost (kg)', plate: 'SPZ', vin: 'VIN', make: 'Značka', model: 'Model', year: 'Rok výroby', fuel: 'Palivo', firstRegistration: 'První registrace', lastInspection: 'Poslední STK', mileage: 'Stav km', fuelLevel: 'Palivo / nabití', warningLights: 'Kontrolky', damage: 'Viditelné poškození', tyres: 'Pneumatiky', itemsInCar: 'Věci ve vozidle', keys: 'Klíče', customerName: 'Jméno zákazníka', customerPhone: 'Telefon zákazníka', customerEmail: 'E-mail zákazníka', complaint: 'Problém / požadavek zákazníka', customerWaiting: 'Zákazník čeká', promisedBy: 'Slíbeno do', notes: 'Poznámky' },
  de: { category: 'Fahrzeugart (Pkw / Transporter bis 3,5 t)', maxWeightKg: 'Zulässige Gesamtmasse (kg)', plate: 'Kennzeichen', vin: 'FIN', make: 'Marke', model: 'Modell', year: 'Baujahr', fuel: 'Kraftstoff', firstRegistration: 'Erstzulassung', lastInspection: 'Letzte HU', mileage: 'Kilometerstand', fuelLevel: 'Tank / Ladung', warningLights: 'Warnleuchten', damage: 'Sichtbare Schäden', tyres: 'Reifen', itemsInCar: 'Gegenstände im Auto', keys: 'Schlüssel', customerName: 'Kundenname', customerPhone: 'Telefon', customerEmail: 'E-Mail', complaint: 'Problem / Auftrag', customerWaiting: 'Kunde wartet', promisedBy: 'Zugesagt bis', notes: 'Notizen' },
  pl: { category: 'Rodzaj pojazdu (osobowy / dostawczy do 3,5 t)', maxWeightKg: 'DMC (kg)', plate: 'Nr rejestracyjny', vin: 'VIN', make: 'Marka', model: 'Model', year: 'Rok', fuel: 'Paliwo', firstRegistration: 'Pierwsza rejestracja', lastInspection: 'Ostatni przegląd', mileage: 'Przebieg', fuelLevel: 'Paliwo / naładowanie', warningLights: 'Kontrolki', damage: 'Widoczne uszkodzenia', tyres: 'Opony', itemsInCar: 'Rzeczy w aucie', keys: 'Klucze', customerName: 'Klient', customerPhone: 'Telefon', customerEmail: 'E-mail', complaint: 'Problem / zlecenie', customerWaiting: 'Klient czeka', promisedBy: 'Obiecane do', notes: 'Uwagi' },
  hu: { category: 'Járműtípus (személy / kishaszon 3,5 t-ig)', maxWeightKg: 'Megengedett össztömeg (kg)', plate: 'Rendszám', vin: 'Alvázszám', make: 'Márka', model: 'Modell', year: 'Évjárat', fuel: 'Üzemanyag', firstRegistration: 'Első forgalomba helyezés', lastInspection: 'Utolsó műszaki', mileage: 'Km-óra állás', fuelLevel: 'Üzemanyag / töltöttség', warningLights: 'Figyelmeztető lámpák', damage: 'Látható sérülés', tyres: 'Gumik', itemsInCar: 'Tárgyak az autóban', keys: 'Kulcsok', customerName: 'Ügyfél neve', customerPhone: 'Telefon', customerEmail: 'E-mail', complaint: 'Probléma / megrendelés', customerWaiting: 'Ügyfél vár', promisedBy: 'Ígért határidő', notes: 'Megjegyzés' },
  fr: { category: 'Type de véhicule (voiture / utilitaire ≤ 3,5 t)', maxWeightKg: 'PTAC (kg)', plate: 'Immatriculation', vin: 'VIN', make: 'Marque', model: 'Modèle', year: 'Année', fuel: 'Carburant', firstRegistration: 'Première immatriculation', lastInspection: 'Dernier contrôle technique', mileage: 'Kilométrage', fuelLevel: 'Niveau carburant / charge', warningLights: 'Voyants', damage: 'Dommages visibles', tyres: 'Pneus', itemsInCar: 'Objets dans le véhicule', keys: 'Clés', customerName: 'Nom du client', customerPhone: 'Téléphone du client', customerEmail: 'E-mail du client', complaint: 'Problème / travaux demandés', customerWaiting: 'Le client attend', promisedBy: 'Promis pour', notes: 'Notes' },
  it: { category: 'Tipo di veicolo (auto / commerciale ≤ 3,5 t)', maxWeightKg: 'Massa complessiva (kg)', plate: 'Targa', vin: 'Telaio (VIN)', make: 'Marca', model: 'Modello', year: 'Anno', fuel: 'Alimentazione', firstRegistration: 'Prima immatricolazione', lastInspection: 'Ultima revisione', mileage: 'Chilometraggio', fuelLevel: 'Livello carburante / carica', warningLights: 'Spie accese', damage: 'Danni visibili', tyres: 'Pneumatici', itemsInCar: 'Oggetti nel veicolo', keys: 'Chiavi', customerName: 'Nome cliente', customerPhone: 'Telefono cliente', customerEmail: 'E-mail cliente', complaint: 'Problema / lavori richiesti', customerWaiting: 'Il cliente attende', promisedBy: 'Promesso per', notes: 'Note' },
  es: { category: 'Tipo de vehículo (turismo / furgoneta ≤ 3,5 t)', maxWeightKg: 'MMA (kg)', plate: 'Matrícula', vin: 'Bastidor (VIN)', make: 'Marca', model: 'Modelo', year: 'Año', fuel: 'Combustible', firstRegistration: 'Primera matriculación', lastInspection: 'Última ITV', mileage: 'Kilometraje', fuelLevel: 'Nivel de combustible / carga', warningLights: 'Testigos encendidos', damage: 'Daños visibles', tyres: 'Neumáticos', itemsInCar: 'Objetos en el vehículo', keys: 'Llaves', customerName: 'Nombre del cliente', customerPhone: 'Teléfono del cliente', customerEmail: 'E-mail del cliente', complaint: 'Problema / trabajo solicitado', customerWaiting: 'El cliente espera', promisedBy: 'Prometido para', notes: 'Notas' },
  nl: { category: 'Voertuigtype (personenauto / bestelwagen ≤ 3,5 t)', maxWeightKg: 'Toegestane maximummassa (kg)', plate: 'Kenteken', vin: 'Chassisnummer (VIN)', make: 'Merk', model: 'Model', year: 'Bouwjaar', fuel: 'Brandstof', firstRegistration: 'Eerste toelating', lastInspection: 'Laatste APK', mileage: 'Kilometerstand', fuelLevel: 'Brandstof / lading', warningLights: 'Waarschuwingslampjes', damage: 'Zichtbare schade', tyres: 'Banden', itemsInCar: 'Spullen in de auto', keys: 'Sleutels', customerName: 'Naam klant', customerPhone: 'Telefoon klant', customerEmail: 'E-mail klant', complaint: 'Probleem / gevraagd werk', customerWaiting: 'Klant wacht', promisedBy: 'Beloofd voor', notes: 'Notities' },
};
export const intakeLabels = (lang) => ({ ...INTAKE_LABELS.en, ...(INTAKE_LABELS[(lang || 'en').slice(0, 2)] || {}) });

// ---------------------------------------------------------------- parsing free text / dictation
// Deterministic extraction from what the technician typed or dictated (speech-to-text output).
// The AI in ChatGPT extracts fields itself; this parser serves the tablet and is a safety net.

const NUM_WORDS = { // spoken digits in sk/cs/en/de/pl so dictated plates/km come out right
  nula: '0', jedna: '1', jeden: '1', dva: '2', dve: '2', tri: '3', štyri: '4', styri: '4', čtyři: '4', päť: '5', pät: '5', pět: '5', šesť: '6', šest: '6', sedem: '7', sedm: '7', osem: '8', osm: '8', deväť: '9', devät: '9', devět: '9',
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
  null: '0', eins: '1', zwei: '2', drei: '3', vier: '4', fünf: '5', sechs: '6', sieben: '7', acht: '8', neun: '9',
  ein: '1', eine: '1', dwa: '2', dwie: '2', trzy: '3', un: '1', une: '1', deux: '2', trois: '3', uno: '1', una: '1', due: '2', tre: '3', dos: '2', tres: '3', een: '1', twee: '2', drie: '3',
};

function norm(text) {
  return String(text || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

const FUEL_WORDS = [
  [/\b(elektr\w*|ev|electric|bev)\b/i, 'EV'], [/\b(hybrid\w*)\b/i, 'HYBRID'], [/\b(lpg)\b/i, 'LPG'], [/\b(cng)\b/i, 'CNG'],
  [/\b(diesel|nafta|naft\w*|gazole|gasolio|gas[oó]leo|tdi|hdi|cdi|dci|crdi)\b/i, 'DIESEL'], [/\b(benz[ií]n\w*|benzyn\w*|benzine|petrol|gasoline|gasolina|essence|tsi|tfsi)\b/i, 'PETROL'],
];

// Makes sold as M1/N1 in Europe and our tier-3 markets. "Škoda" needs a capital or a Škoda model (lower-case
// "škoda" is also the Slovak/Czech word for damage).
const MAKES = [
  ['Škoda', /(?<![\p{L}])(?:Škoda|Skoda|ŠKODA|SKODA|[sš]koda(?=\s+(?:octavi|fabi|superb|kodiaq|karoq|kamiq|scala|enyaq|rapid|yeti|roomster|citigo|elroq)))(?![\p{L}])/u],
  ['Volkswagen', /(?<![\p{L}])(?:volkswagen|vw)(?![\p{L}])/iu], ['Mercedes-Benz', /(?<![\p{L}])(?:mercedes(?:[- ]benz)?|merced\p{L}*)(?![\p{L}])/iu],
  ['BMW', /(?<![\p{L}])bmw(?![\p{L}])/iu], ['Audi', /(?<![\p{L}])audi(?![\p{L}])/iu], ['Opel', /(?<![\p{L}])opel(?![\p{L}])/iu], ['Vauxhall', /(?<![\p{L}])vauxhall(?![\p{L}])/iu],
  ['Ford', /(?<![\p{L}])ford(?![\p{L}])/iu], ['Renault', /(?<![\p{L}])renault(?![\p{L}])/iu], ['Peugeot', /(?<![\p{L}])peugeot(?![\p{L}])/iu],
  ['Citroën', /(?<![\p{L}])citro[eë]n(?![\p{L}])/iu], ['Dacia', /(?<![\p{L}])dacia(?![\p{L}])/iu], ['Toyota', /(?<![\p{L}])toyot\p{L}*(?![\p{L}])/iu],
  ['Hyundai', /(?<![\p{L}])hyundai(?![\p{L}])/iu], ['Kia', /(?<![\p{L}])kia(?![\p{L}])/iu], ['Fiat', /(?<![\p{L}])fiat(?![\p{L}])/iu],
  ['Seat', /(?<![\p{L}])(?:SEAT|Seat)(?![\p{L}])/u], ['Cupra', /(?<![\p{L}])cupra(?![\p{L}])/iu], ['Volvo', /(?<![\p{L}])volvo(?![\p{L}])/iu],
  ['Mazda', /(?<![\p{L}])mazda(?![\p{L}])/iu], ['Nissan', /(?<![\p{L}])nissan(?![\p{L}])/iu], ['Honda', /(?<![\p{L}])honda(?![\p{L}])/iu],
  ['Suzuki', /(?<![\p{L}])suzuki(?![\p{L}])/iu], ['Mitsubishi', /(?<![\p{L}])mitsubishi(?![\p{L}])/iu], ['Tesla', /(?<![\p{L}])tesla(?![\p{L}])/iu],
  ['Iveco', /(?<![\p{L}])iveco(?![\p{L}])/iu], ['Jeep', /(?<![\p{L}])jeep(?![\p{L}])/iu], ['Land Rover', /(?<![\p{L}])land[- ]?rover(?![\p{L}])/iu],
  ['Mini', /(?<![\p{L}])MINI|Mini(?![\p{L}])/u], ['Porsche', /(?<![\p{L}])porsche(?![\p{L}])/iu], ['Alfa Romeo', /(?<![\p{L}])alfa(?:[- ]romeo)?(?![\p{L}])/iu],
  ['Lexus', /(?<![\p{L}])lexus(?![\p{L}])/iu], ['Subaru', /(?<![\p{L}])subaru(?![\p{L}])/iu], ['MG', /(?<![\p{L}])MG(?![\p{L}])/u],
  ['BYD', /(?<![\p{L}])byd(?![\p{L}])/iu], ['DS', /(?<![\p{L}])DS(?=\s*\d)/u], ['Chevrolet', /(?<![\p{L}])chevrolet(?![\p{L}])/iu],
  ['Chrysler', /(?<![\p{L}])chrysler(?![\p{L}])/iu], ['Dodge', /(?<![\p{L}])dodge(?![\p{L}])/iu], ['RAM', /(?<![\p{L}])RAM(?=\s+\d)/u],
  ['GMC', /(?<![\p{L}])gmc(?![\p{L}])/iu], ['Holden', /(?<![\p{L}])holden(?![\p{L}])/iu], ['Isuzu', /(?<![\p{L}])isuzu(?![\p{L}])/iu],
  ['Lancia', /(?<![\p{L}])lancia(?![\p{L}])/iu], ['Smart', /(?<![\p{L}])smart(?=\s+(?:fortwo|forfour|#?\d))/iu],
];
const MODEL_STOP = /^(?:diesel|nafta|naft\p{L}*|benz\p{L}*|petrol|elektr\p{L}*|hybrid\p{L}*|lpg|cng|tdi|tsi|tfsi|hdi|cdi|dci|crdi|osobn\p{L}*|dod[aá]vk\p{L}*|[uú][zž]itkov\p{L}*|auto|vozidlo|car|van|rok|year|r|v|z|s|a|so|km|e[čc]v|spz|špz|vin|stav|n[aá]jazd|z[aá]kazn\p{L}*|kombi$)$/iu;
function findMakeModel(text) {
  for (const [make, re] of MAKES) {
    const m = text.match(re); if (!m) continue;
    const rest = text.slice(m.index + m[0].length).replace(/^[\s,:-]+/, '').split(/[\s,;.]+/).filter(Boolean);
    const model = [];
    for (const w of rest.slice(0, 3)) {
      if (MODEL_STOP.test(w) || /^(?:19|20)\d{2}$/.test(w) || /^\d{4,}$/.test(w) || /^\d+\s*km$/i.test(w)) break;
      if (model.length && !(/\d/.test(w) || /^\p{Lu}/u.test(w))) break;
      model.push(w);
      if (model.length === 2) break;
    }
    return { make, model: model.length ? model.join(' ').replace(/^\p{Ll}/u, (c) => c.toUpperCase()) : null };
  }
  return {};
}

/** Returns { fields, unparsed } – fields only contains what was recognised with confidence. */
export function parseIntakeText(raw, { country = 'SK' } = {}) {
  let text = norm(raw);
  const fields = {};
  if (!text) return { fields, unparsed: '' };
  const lower = text.toLowerCase();

  // VIN: a single 17-char token anywhere, or – right after the word VIN/FIN – dictated groups joined together
  const tokens = text.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const okVin = (v) => v.length === 17 && /[A-Z]/.test(v) && /[0-9]/.test(v) && decodeVin(v).valid;
  const single = tokens.find(okVin);
  if (single) fields.vin = single;
  else {
    const k = tokens.findIndex((t) => /^(VIN|FIN|VINKOD|ALVAZSZAM)$/.test(t));
    if (k >= 0) {
      let acc = '';
      for (let j = k + 1; j < tokens.length && j <= k + 8 && acc.length < 17; j++) acc += tokens[j];
      if (okVin(acc)) fields.vin = acc;
    }
  }

  // mileage: "142 000 km", "142000 km", "stav km 142 tisíc", "nájazd 98500"
  const km = lower.match(/(\d{1,3}(?:[ .]\d{3}|,\d{3})+|\d{1,7})\s*(?:tis\p{L}*|mille|mila|mil|duizend|tausend|thousand|k(?![\p{L}\d])|000)?\s*(km|kilometr\p{L}*|kilometer\p{L}*|m[ií]l\p{L}*)(?![\p{L}\d])/u)
    || lower.match(/(?:stav\s*km|tachometer|tachometr|n[aá]jazd|najazden\p{L}*|najeto|mileage|kilometerstand|kilom[eé]trage|chilometraggio|kilometraje|kilometerstand|przebieg)\D{0,12}(\d{1,3}(?:[ .]\d{3})+|\d{1,7})(\s*tis\p{L}*)?/u);
  if (km) {
    let n = Number(km[1].replace(/[ .,]/g, ''));
    if (/tis|mille|mila|\bmil\b|duizend|tausend|thousand/.test(km[0]) && n < 2000) n *= 1000;
    if (n > 0 && n < 3000000) fields.mileage = n;
  }

  // phone: +421 900 123 456, 0900 123 456
  const ph = text.match(/(\+\d{2,3}[\s/-]?\d{3}[\s/-]?\d{3}[\s/-]?\d{3,4}|\b0\d{3}[\s/-]?\d{3}[\s/-]?\d{3}\b)/);
  if (ph) fields.customerPhone = ph[1].replace(/[\s/-]/g, ' ').trim();

  const em = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (em) fields.customerEmail = em[0].toLowerCase();

  // licence plate – after a keyword, or SK/CZ pattern (e.g. ZA 123AB, ZA-123AB, 1AB 2345)
  const plateKw = text.match(/(?:EČV|ECV|ŠPZ|SPZ|plate|kennzeichen|rendszám|numer rej\w*|immatriculation|targa|matr[ií]cula|kenteken)[:\s]+([A-Z0-9][A-Z0-9 -]{3,10}[A-Z0-9])/i);
  const plateSk = text.toUpperCase().match(/\b([A-Z]{2})[ -]?(\d{3})[ -]?([A-Z]{2})\b/);
  const plateCz = text.toUpperCase().match(/\b(\d[A-Z]\d)[ -]?(\d{4})\b/);
  if (plateKw) fields.plate = plateKw[1].toUpperCase().replace(/-/g, ' ').trim();
  else if (country === 'SK' && plateSk) fields.plate = `${plateSk[1]} ${plateSk[2]}${plateSk[3]}`;
  else if (country === 'CZ' && plateCz) fields.plate = `${plateCz[1]} ${plateCz[2]}`;
  else if (plateSk) fields.plate = `${plateSk[1]} ${plateSk[2]}${plateSk[3]}`;

  for (const [re, f] of FUEL_WORDS) if (re.test(text)) { fields.fuel = f; break; }

  // vehicle category: van / light commercial → N1, passenger car → M1
  const B = '(?<![\\p{L}\\d])', E = '(?![\\p{L}\\d])';
  if (new RegExp(`${B}(dod[aá]vk\\p{L}*|[uú][zž]itkov\\p{L}*|van|transporter|furgon\\p{L}*|furgone|furgoneta|utilitaire|bestelwagen|bestelbus|dostawcz\\p{L}*|kisteherg\\p{L}*|pick-?up|N1)${E}`, 'iu').test(text)) fields.category = 'N1';
  else if (new RegExp(`${B}(osobn\\p{L}*|osobák|passenger car|pkw|voiture|vettura|coche|turismo|personenauto|osobow\\p{L}*|személyaut\\p{L}*|M1)${E}`, 'iu').test(text)) fields.category = 'M1';
  const wt = lower.match(/(\d{1,2}(?:[.,]\d{1,2})?)\s*(t|ton\w*)\b|(\d{3,5})\s*kg\b/);
  if (wt && /hmotnos|weight|gewicht|masa|tömeg|ton|\bt\b|kg/.test(lower)) {
    const kg = wt[3] ? Number(wt[3]) : Math.round(Number(wt[1].replace(',', '.')) * 1000);
    if (kg >= 500 && kg <= 60000) fields.maxWeightKg = kg;
  }

  // fuel level: "nádrž 1/4", "palivo pol", "fuel 50 %", "nabitie 80 %"
  const fl = lower.match(/(?:n[aá]dr[zž]\w*|palivo|paliw\w*|üzemanyag\w*|fuel|tank|nabitie|nabit[ií]|battery|charge|bat[eé]ri\w*|r[eé]servoir|carburant|serbatoio|dep[oó]sito|brandstof)\D{0,10}(\d\/\d|\d{1,3}\s*%|pln[aá]|full|voll|pe[lł]n\w*|plein|pieno|lleno|vol|pr[aá]zdn\w*|empty|leer|pust\w*|vide|vuoto|vac[ií]o|leeg|pol\w*|half|halb\w*|p[oó][lł]|moiti[eé]|met[aà]|medio|rezerv\w*|reserve|r[eé]serve|riserva)/);
  if (fl) {
    const v = fl[1];
    fields.fuelLevel = normFuelLevel(v);
  }

  const yr = lower.match(/(?:rok|year|r\.\s?v\.|baujahr|rocznik|évjárat|ann[eé]e|anno|a[nñ]o|bouwjaar)\D{0,6}((?:19|20)\d{2})/)
    || lower.match(/(?<![\d.\/-])((?:19[89]|20[0-4])\d)(?![\d.\/-])(?!\s*(?:km|tis|kg|eur|€))/u);
  if (yr) fields.year = Number(yr[1]);

  // make + model: "Škoda Octavia", "VW Transporter T6", "Mercedes-Benz Sprinter"
  const mm = findMakeModel(text);
  if (mm.make) fields.make = mm.make;
  if (mm.model) fields.model = mm.model;

  const keys = lower.match(/(\d|jeden|jedna|dva|dve|tri|one|two|three|eine?|zwei|drei|dwa|dwie|trzy|une?|deux|trois|uno|una|due|tre|dos|tres|een|twee|drie)\s*(?:k[lľ][uúi]č\w*|keys?|schlüssel|klucz\w*|kulcs\w*|cl[eé]s?|chiav[ei]|llaves?|sleutels?)/);
  if (keys) fields.keys = Number(NUM_WORDS[keys[1]] || keys[1]);

  const waits = /(z[aá]kazn[ií]k\s*(po)?[cč]ak[aá]|customer\s*(is\s*)?waiting|kunde\s*wartet|klient\s*czeka|client\s*attend|cliente\s*(aspetta|espera)|klant\s*wacht)/i.test(text);
  if (waits) fields.customerWaiting = true;

  // keyword sections: "poškodenie: ...", "kontrolky: ...", "závada: ..." – a value ends at the next section,
  // at another dictated field ("dva kľúče", "zákazník …", "54 tisíc km") or at . ; newline
  const sections = {
    damage: /(?:po[sš]koden\p{L}*|[sš]krabanc\p{L}*|damage|scratch\p{L}*|schaden|delle|uszkodz\p{L}*|sérülés|dommages?|d[eé]g[aâ]ts?|rayures?|dann[oi]|graffi\p{L}*|da[nñ]os?|ray[oó]n\p{L}*|schade|krassen?)/iu,
    warningLights: /(?:kontrolk\p{L}*|warning lights?|warnleucht\p{L}*|figyelmeztet\p{L}*|voyants?|spi[ae]|testigos?|waarschuwingslamp\p{L}*|lampjes?)/iu,
    complaint: /(?:z[aá]vad\p{L}*|probl[eéè]m\p{L}*|po[zž]iadavk\p{L}*|po[zž]adav\p{L}*|complaint|issue|auftrag|usterk\p{L}*|hiba|panne|guasto|aver[ií]a|klacht|storing)/iu,
    itemsInCar: /(?:vo vozidle|v aute|ve voze|items? in (?:the )?car|im auto|w aucie|autóban|dans la voiture|in auto|en el coche|in de auto)/iu,
    tyres: /(?:pneumatik\p{L}*|tyres?|tires?|reifen|opon\p{L}*|pneus?|pneumatici|gomme|neum[aá]ticos?|banden)/iu,
  };
  const starts = [];
  for (const [key, re] of Object.entries(sections)) {
    for (const m of text.matchAll(new RegExp('(?<![\\p{L}\\d])' + re.source + '[^:\\n]{0,20}?\\s*[:–]\\s*', 'giu'))) starts.push({ key, at: m.index, valueAt: m.index + m[0].length });
  }
  starts.sort((a, b) => a.at - b.at);
  const STOP = new RegExp('(?<![\\p{L}\\d])(?:(?:\\d|jeden|jedna|dva|dve|tri|one|two|three|eine?|zwei|drei|dwa|dwie|trzy|une?|deux|trois|uno|una|due|tre|dos|tres|een|twee|drie)\\s*(?:k[lľ][uúi]\\p{L}*|keys?|schlüssel|klucz\\p{L}*|kulcs\\p{L}*|cl[eé]s?|chiav[ei]|llaves?|sleutels?)|z[aá]kazn[ií]\\p{L}*|majite[lľ]\\p{L}*|customer|kunde|klient|client|cliente|klant|propri[eé]taire|proprietario|propietario|eigenaar|n[aá]dr[zž]\\p{L}*|tankol\\p{L}*|E[ČC]V|[SŠ]PZ|VIN|telef\\p{L}*|\\d[\\d .]*\\s*(?:tis\\p{L}*\\s*)?km)(?![\\p{L}])', 'iu');
  for (let i = 0; i < starts.length; i++) {
    const st = starts[i]; if (fields[st.key]) continue;
    let end = i + 1 < starts.length ? starts[i + 1].at : text.length;
    let v = text.slice(st.valueAt, end);
    const cut = v.search(/[.;\n]/); if (cut >= 0) v = v.slice(0, cut);
    const stop = v.search(STOP); if (stop > 0) v = v.slice(0, stop);
    v = v.replace(/[\s,–-]+$/u, '').trim();
    if (v.length >= 2) fields[st.key] = v.slice(0, 200);
  }
  const NONE = /^(?:[zž][ií]adn\p{L}*|nesviet\p{L}*|nie|none|no|off|ok|keine?|brak|nincs|aucune?|rien|nessun[ao]?|ningun[oa]?|geen|bez\b.*)$/iu;
  if (fields.warningLights && NONE.test(fields.warningLights)) fields.warningLights = 'none';
  if (fields.damage && NONE.test(fields.damage)) fields.damage = 'none';
  if (!fields.warningLights && /(bez kontrol\p{L}*|[zž][ií]adn\p{L}* kontrolk\p{L}*|kontrolk\p{L}*\s+(?:[zž][ií]adn\p{L}*|nesviet\p{L}*|nesvít\p{L}*|ok)|no warning lights)/iu.test(text)) fields.warningLights = 'none';
  if (!fields.damage && /(bez po[sš]koden\p{L}*|no (visible )?damage|keine sch[aä]den)/iu.test(text)) fields.damage = 'none';

  // customer name: "zákazník Ján Novák", "meno Jana Malá", "customer John Smith" – keyword any case, name capitalised
  const nmRe = /(?:z[aá]kazn[ií]k|z[aá]kaznic\p{L}*|majite[lľ]\p{L}*|meno|jm[eé]no|customer|owner|kunde|klient|client[ea]?|klant|propri[eé]taire|proprietario|propietario|eigenaar)[:\s]+((?:\p{Lu}[\p{L}'-]+\s?){2,3})/giu;
  for (const m of text.matchAll(nmRe)) {
    const name = m[1].trim().split(/\s+/).filter((w) => !/^(telef\p{L}*|tel|phone|čak\p{L}*|cak\p{L}*)$/iu.test(w)).join(' ');
    if (name.split(' ').length >= 2) { fields.customerName = name; break; }
  }

  return { fields, unparsed: text };
}

/** Merge new values; never overwrite a value with empty. Returns changed keys. */
/** "half tank", "plná", "voll", "50 %" … → '2/4', '4/4', '50%'; other text is kept as given. */
export function normFuelLevel(raw) {
  const v = String(raw).toLowerCase().trim();
  if (/^\d\/\d$/.test(v) || /^\d{1,3}\s*%$/.test(v)) return v.replace(/\s+/g, '');
  if (/pln|full|voll|pe[lł]n|plein|pieno|lleno|^vol\b/.test(v)) return '4/4';
  if (/pr[aá]zd|empty|leer|pust|vide|vuoto|vac[ií]|leeg|rezerv|reserve|r[eé]serve|riserva/.test(v)) return '0/4 (reserve)';
  if (/\bpol|half|halb|p[oó][lł]|moiti|met[aà]|medio|helft/.test(v)) return '2/4';
  if (/quarter|štvrt|ctvrt|čtvrt|viertel|ćwier/.test(v)) return /three|3|tri|dreiv/.test(v) ? '3/4' : '1/4';
  return String(raw).trim();
}

export function mergeIntake(current, incoming) {
  const out = { ...current };
  const changed = [];
  for (const f of INTAKE_FIELDS) {
    let v = incoming[f.key];
    if (v === undefined || v === null || v === '') continue;
    if (f.key === 'vin') v = normalizeVin(v);
    if (f.key === 'plate') v = String(v).toUpperCase().replace(/\s+/g, ' ').trim();
    if (f.key === 'fuel') v = String(v).toUpperCase();
    if (f.key === 'mileage' || f.key === 'maxWeightKg') v = Number(String(v).replace(/[^\d]/g, ''));
    if (f.key === 'category') v = String(v).toUpperCase();
    if (f.key === 'fuelLevel') v = normFuelLevel(v);
    if (out[f.key] !== v) { out[f.key] = v; changed.push(f.key); }
  }
  return { data: out, changed };
}

export function intakeStatus(data) {
  const missing = [];
  const recommended = [];
  const errors = [];
  if (!data.plate && !data.vin) missing.push('plate');
  for (const f of INTAKE_FIELDS) {
    if (f.required === true && (data[f.key] === undefined || data[f.key] === '')) missing.push(f.key);
    if (f.recommended && (data[f.key] === undefined || data[f.key] === '')) recommended.push(f.key);
  }
  if (data.category && !['M1', 'N1'].includes(data.category)) errors.push('category: Garagee is for passenger cars (M1) and light commercial vehicles up to 3.5 t (N1) only');
  if (data.maxWeightKg != null && data.maxWeightKg > MAX_WEIGHT_KG) errors.push(`maxWeightKg: ${data.maxWeightKg} kg is over 3,500 kg – Garagee is for vehicles up to 3.5 t only`);
  if (data.vin) { const d = decodeVin(data.vin); if (!d.valid) errors.push(`vin: ${d.errors.join(' ')}`); }
  if (data.mileage != null && !(data.mileage > 0 && data.mileage < 3000000)) errors.push('mileage: not a plausible value');
  if (data.fuel && !INTAKE_FIELDS.find((f) => f.key === 'fuel').enum.includes(data.fuel)) errors.push('fuel: use PETROL, DIESEL, LPG, CNG, HYBRID or EV');
  if (data.customerPhone && !/^[+\d][\d\s/-]{6,}$/.test(data.customerPhone)) errors.push('customerPhone: not a phone number');
  return { complete: missing.length === 0 && errors.length === 0, missing, recommended, errors };
}

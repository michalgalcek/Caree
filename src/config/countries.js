// Market configuration for Caree.
//
// Every legal value (inspection intervals, VAT) carries `verified`:
//   - a date + source  -> checked against a public source on that date
//   - false            -> common knowledge, MUST be confirmed by local legal review before launch
// Shops can override every value in their settings (tenant.settings), so a wrong default never blocks work.
//
// Inspection rule format:
//   { from: 'YYYY-MM-DD' (rule valid for inspections due on/after), first: years after first registration,
//     steps: [years, years, ...]  explicit next intervals, then `then`: interval for all later inspections,
//     ageRules: [{ fromAgeYears, every }] optional age-based intervals overriding `then` }

export const MARKET_TIERS = {
  1: 'Launch markets (home + largest EU aftermarkets)',
  2: 'Expansion markets',
  3: 'Supported with regional rules set by the shop',
};

const EU_ROADWORTHINESS_NOTE = 'EU Directive 2014/45/EU sets minimums; national law decides details.';

export const COUNTRIES = {
  SK: {
    name: 'Slovakia', tier: 1, currency: 'EUR', locale: 'sk-SK', languages: ['sk', 'en', 'hu'],
    distanceUnit: 'km', timezone: 'Europe/Bratislava', eu: true,
    vat: { standard: 23, verified: false, note: 'Standard rate 23 % since 1 Jan 2025 – confirm with accountant.' },
    inspection: {
      name: 'STK + EK (technická a emisná kontrola)', emissionSeparate: true, evEmissionExempt: true,
      rules: { M1: [{ from: '2000-01-01', first: 4, steps: [], then: 2 }], N1: [{ from: '2000-01-01', first: 4, steps: [], then: 2 }] },
      verified: { on: '2026-11-14', source: 'https://www.tuvsud.com/sk-sk/informacne-centrum/tuv-sud-journal/sk/stk-a-automobilovy-priemysel/nove-auto-stk-povinnosti-intervaly' },
    },
    fiscal: { receipts: 'eKasa (cash register) required for cash/card payments to consumers', eInvoicing: 'Check current SK e-invoicing obligations before launch' },
    gdprAuthority: 'Úrad na ochranu osobných údajov SR (dataprotection.gov.sk)',
  },
  CZ: {
    name: 'Czechia', tier: 1, currency: 'CZK', locale: 'cs-CZ', languages: ['cs', 'en'],
    distanceUnit: 'km', timezone: 'Europe/Prague', eu: true,
    vat: { standard: 21, verified: false },
    inspection: {
      name: 'STK + měření emisí', emissionSeparate: true, evEmissionExempt: true,
      rules: { M1: [{ from: '2000-01-01', first: 4, steps: [], then: 2 }], N1: [{ from: '2000-01-01', first: 4, steps: [], then: 2 }] },
      verified: { on: '2026-11-14', source: 'https://portal.gov.cz/informace/pravidelna-technicka-prohlidka-silnicniho-vozidla-a-mereni-emisi-INF-426' },
    },
    gdprAuthority: 'Úřad pro ochranu osobních údajů (uoou.gov.cz)',
  },
  DE: {
    name: 'Germany', tier: 1, currency: 'EUR', locale: 'de-DE', languages: ['de', 'en'],
    distanceUnit: 'km', timezone: 'Europe/Berlin', eu: true,
    vat: { standard: 19, verified: false },
    inspection: {
      name: 'Hauptuntersuchung (HU/TÜV)', emissionSeparate: false,
      rules: { M1: [{ from: '2000-01-01', first: 3, steps: [], then: 2 }] },
      verified: false,
    },
    gdprAuthority: 'Landesdatenschutzbehörde of the shop\'s federal state',
  },
  AT: {
    name: 'Austria', tier: 1, currency: 'EUR', locale: 'de-AT', languages: ['de', 'en'],
    distanceUnit: 'km', timezone: 'Europe/Vienna', eu: true,
    vat: { standard: 20, verified: false },
    inspection: {
      name: '§57a Begutachtung („Pickerl“)', emissionSeparate: false,
      rules: {
        M1: [
          { from: '2000-01-01', first: 3, steps: [2], then: 1 },
          // 42nd KFG amendment: from 19 May 2027 new 4-2-2-2-1 interval
          { from: '2027-05-19', first: 4, steps: [2, 2, 2], then: 1 },
        ],
      },
      verified: { on: '2026-11-14', source: 'https://www.oeamtc.at/thema/pickerl/laengere-pickerl-intervalle-57a-87229599' },
      note: 'Transition rules for vehicles already registered apply – confirm with ÖAMTC Pickerlrechner.',
    },
    gdprAuthority: 'Datenschutzbehörde (dsb.gv.at)',
  },
  PL: {
    name: 'Poland', tier: 1, currency: 'PLN', locale: 'pl-PL', languages: ['pl', 'en'],
    distanceUnit: 'km', timezone: 'Europe/Warsaw', eu: true,
    vat: { standard: 23, verified: false },
    inspection: {
      name: 'Badanie techniczne (SKP)', emissionSeparate: false,
      rules: {
        M1: [{ from: '2000-01-01', first: 3, steps: [2], then: 1 }],
        M1_LPG: [{ from: '2000-01-01', first: 1, steps: [], then: 1 }],
      },
      verified: { on: '2026-11-14', source: 'https://www.otomoto.pl/news/przeglad-techniczny-koszt' },
      note: 'Cars with LPG/CNG: annual from the start.',
    },
    gdprAuthority: 'UODO (uodo.gov.pl)',
  },
  HU: {
    name: 'Hungary', tier: 2, currency: 'HUF', locale: 'hu-HU', languages: ['hu', 'en'],
    distanceUnit: 'km', timezone: 'Europe/Budapest', eu: true,
    vat: { standard: 27, verified: false },
    inspection: { name: 'Műszaki vizsga', rules: { M1: [{ from: '2000-01-01', first: 4, steps: [], then: 2 }] }, verified: false },
    gdprAuthority: 'NAIH (naih.hu)',
  },
  FR: {
    name: 'France', tier: 2, currency: 'EUR', locale: 'fr-FR', languages: ['fr', 'en'],
    distanceUnit: 'km', timezone: 'Europe/Paris', eu: true,
    vat: { standard: 20, verified: false },
    inspection: { name: 'Contrôle technique', rules: { M1: [{ from: '2000-01-01', first: 4, steps: [], then: 2 }] }, verified: false },
    gdprAuthority: 'CNIL (cnil.fr)',
  },
  IT: {
    name: 'Italy', tier: 2, currency: 'EUR', locale: 'it-IT', languages: ['it', 'en'],
    distanceUnit: 'km', timezone: 'Europe/Rome', eu: true,
    vat: { standard: 22, verified: false },
    inspection: { name: 'Revisione auto', rules: { M1: [{ from: '2000-01-01', first: 4, steps: [], then: 2 }] }, verified: false },
    gdprAuthority: 'Garante per la protezione dei dati personali',
  },
  ES: {
    name: 'Spain', tier: 2, currency: 'EUR', locale: 'es-ES', languages: ['es', 'en'],
    distanceUnit: 'km', timezone: 'Europe/Madrid', eu: true,
    vat: { standard: 21, verified: false },
    inspection: {
      name: 'ITV', rules: { M1: [{ from: '2000-01-01', first: 4, steps: [], then: 2, ageRules: [{ fromAgeYears: 10, every: 1 }] }] },
      verified: { on: '2026-11-14', source: 'https://administracion.gob.es/pag_Home/en/Tu-espacio-europeo/derechos-obligaciones/ciudadanos/vehiculos/itv.html' },
    },
    gdprAuthority: 'AEPD (aepd.es)',
  },
  NL: {
    name: 'Netherlands', tier: 2, currency: 'EUR', locale: 'nl-NL', languages: ['nl', 'en'],
    distanceUnit: 'km', timezone: 'Europe/Amsterdam', eu: true,
    vat: { standard: 21, verified: false },
    inspection: {
      name: 'APK', rules: {
        M1: [{ from: '2000-01-01', first: 4, steps: [2, 2], then: 1 }],          // petrol/EV: 4, 6, 8, then yearly
        M1_DIESEL: [{ from: '2000-01-01', first: 3, steps: [], then: 1 }],      // diesel/LPG: 3, then yearly
        M1_LPG: [{ from: '2000-01-01', first: 3, steps: [], then: 1 }],
      },
      verified: false, note: 'Rules per fuel type – confirm with RDW.',
    },
    gdprAuthority: 'Autoriteit Persoonsgegevens',
  },
  BE: {
    name: 'Belgium', tier: 2, currency: 'EUR', locale: 'nl-BE', languages: ['nl', 'fr', 'de', 'en'],
    distanceUnit: 'km', timezone: 'Europe/Brussels', eu: true,
    vat: { standard: 21, verified: false },
    inspection: { name: 'Contrôle technique / Autokeuring', rules: { M1: [{ from: '2000-01-01', first: 4, steps: [], then: 1 }] }, verified: false, note: 'Regional rules (Flanders/Wallonia/Brussels) differ in details.' },
    gdprAuthority: 'Gegevensbeschermingsautoriteit / APD',
  },
  GB: {
    name: 'United Kingdom', tier: 2, currency: 'GBP', locale: 'en-GB', languages: ['en'],
    distanceUnit: 'mi', timezone: 'Europe/London', eu: false,
    vat: { standard: 20, verified: false },
    inspection: { name: 'MOT test', rules: { M1: [{ from: '2000-01-01', first: 3, steps: [], then: 1 }] }, verified: false, note: 'Northern Ireland: first test at 4 years.' },
    gdprAuthority: 'ICO (ico.org.uk) – UK GDPR',
  },
  US: {
    name: 'United States', tier: 3, currency: 'USD', locale: 'en-US', languages: ['en', 'es'],
    distanceUnit: 'mi', timezone: 'America/New_York', eu: false,
    vat: { standard: 0, verified: false, note: 'No VAT. Sales tax on parts/labor depends on state and locality – shop must set its rate.' },
    inspection: { name: 'State safety / emissions inspection', rules: {}, regional: true, verified: false, note: 'Set by each state; many states have none. Shop configures its own rule.' },
    gdprAuthority: 'State privacy laws (e.g. CCPA/CPRA in California) – GDPR does not apply unless EU residents are served.',
  },
  CA: {
    name: 'Canada', tier: 3, currency: 'CAD', locale: 'en-CA', languages: ['en', 'fr'],
    distanceUnit: 'km', timezone: 'America/Toronto', eu: false,
    vat: { standard: 5, verified: false, note: 'Federal GST 5 %; HST/PST depend on province – shop sets total rate.' },
    inspection: { name: 'Provincial safety inspection', rules: {}, regional: true, verified: false },
    gdprAuthority: 'PIPEDA / provincial privacy law',
  },
  AU: {
    name: 'Australia', tier: 3, currency: 'AUD', locale: 'en-AU', languages: ['en'],
    distanceUnit: 'km', timezone: 'Australia/Sydney', eu: false,
    vat: { standard: 10, verified: false, note: 'GST 10 %.' },
    inspection: { name: 'State roadworthy / safety check', rules: {}, regional: true, verified: false },
    gdprAuthority: 'Privacy Act 1988 (OAIC)',
  },
};

export const GENERIC = {
  name: 'Other country', tier: 3, currency: 'EUR', locale: 'en', languages: ['en'],
  distanceUnit: 'km', timezone: 'UTC', eu: false,
  vat: { standard: 0, verified: false, note: 'Set your tax rate in settings.' },
  inspection: { name: 'Periodic inspection', rules: {}, regional: true, verified: false, note: 'Configure the local rule in settings.' },
};

export function getCountry(code) {
  const c = COUNTRIES[(code || '').toUpperCase()];
  return c ? { code: code.toUpperCase(), ...c } : { code: (code || 'XX').toUpperCase(), ...GENERIC };
}

/** Merge country defaults with shop overrides (tenant.settings). Shop always wins. */
export function effectiveSettings(tenant) {
  const c = getCountry(tenant.country);
  const s = tenant.settings || {};
  return {
    country: c.code,
    countryName: c.name,
    currency: s.currency || c.currency,
    locale: s.locale || c.locale,
    language: s.language || c.languages[0],
    distanceUnit: s.distanceUnit || c.distanceUnit,
    timezone: s.timezone || c.timezone,
    vatRate: s.vatRate ?? c.vat.standard,
    vatVerified: s.vatRate != null ? 'set by shop' : c.vat.verified,
    laborRate: s.laborRate ?? null, // must be set by the shop – no invented default
    fxFromEur: s.fxFromEur ?? (c.currency === 'EUR' ? 1 : null), // for generic reference part prices (EUR)
    shopSuppliesPct: s.shopSuppliesPct ?? 3,
    partsMarkup: s.partsMarkup || [
      { upTo: 10, pct: 100 }, { upTo: 50, pct: 60 }, { upTo: 200, pct: 40 }, { upTo: 1000, pct: 30 }, { upTo: Infinity, pct: 20 },
    ],
    inspection: s.inspection || c.inspection,
    eu: c.eu,
    tier: c.tier,
    retentionYears: s.retentionYears ?? 10,
    note: EU_ROADWORTHINESS_NOTE,
  };
}

// VIN validation and offline decoding (ISO 3779 / 49 CFR 565).
// The check digit (position 9) is mandatory only for North-American vehicles; European VINs often
// don't use it, so a failed check is a WARNING outside North America, never a rejection.
// Full decoding (engine code, equipment) comes from a licensed data partner via the VinDecoder adapter.

const TRANSLIT = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789'; // 30-year cycle starting 1980 / 2010

const WMI = {
  TMB: 'Škoda', TMP: 'Škoda', WVW: 'Volkswagen', WV1: 'Volkswagen Commercial', WV2: 'Volkswagen Commercial', WVG: 'Volkswagen SUV',
  WAU: 'Audi', WUA: 'Audi Sport', TRU: 'Audi (HU)', WBA: 'BMW', WBS: 'BMW M', WBY: 'BMW i', WMW: 'MINI', WDD: 'Mercedes-Benz', W1K: 'Mercedes-Benz',
  WDB: 'Mercedes-Benz', W1N: 'Mercedes-Benz SUV', WDC: 'Mercedes-Benz SUV', W1V: 'Mercedes-Benz Van', WP0: 'Porsche', WP1: 'Porsche SUV',
  WF0: 'Ford (DE)', W0L: 'Opel', W0V: 'Opel', VF1: 'Renault', VF3: 'Peugeot', VF7: 'Citroën', VR3: 'Peugeot', VR7: 'Citroën', VR1: 'DS',
  ZFA: 'Fiat', ZAR: 'Alfa Romeo', ZFF: 'Ferrari', ZHW: 'Lamborghini', ZLA: 'Lancia', VSS: 'SEAT', VSK: 'Nissan (ES)', VS6: 'Ford (ES)',
  YV1: 'Volvo', YV4: 'Volvo SUV', LYV: 'Volvo (CN)', SAL: 'Land Rover', SAJ: 'Jaguar', SCC: 'Lotus', SCF: 'Aston Martin',
  U5Y: 'Kia (SK)', KNA: 'Kia', KNE: 'Kia', TMA: 'Hyundai (CZ)', KMH: 'Hyundai', NLH: 'Hyundai (TR)',
  JTD: 'Toyota', JTE: 'Toyota', JTN: 'Toyota', SB1: 'Toyota (UK)', NMT: 'Toyota (TR)', VNK: 'Toyota (FR)', JHM: 'Honda', SHH: 'Honda (UK)',
  JN1: 'Nissan', SJN: 'Nissan (UK)', JMZ: 'Mazda', JF1: 'Subaru', JS3: 'Suzuki', TSM: 'Suzuki (HU)', JMB: 'Mitsubishi', UU1: 'Dacia',
  '1FA': 'Ford (US)', '1FT': 'Ford Truck (US)', '1G1': 'Chevrolet (US)', '1GC': 'Chevrolet Truck (US)', '1HG': 'Honda (US)', '2HG': 'Honda (CA)',
  '4T1': 'Toyota (US)', '5YJ': 'Tesla', '7SA': 'Tesla', LRW: 'Tesla (CN)', XP7: 'Tesla (DE)', '3VW': 'Volkswagen (MX)', '1C4': 'Jeep/Chrysler (US)',
  LSV: 'SAIC Volkswagen', LFV: 'FAW Volkswagen', LBV: 'BMW Brilliance', LGX: 'BYD', LC0: 'BYD', LVS: 'Ford (CN)', L6T: 'Geely',
};

const REGION = (c) => {
  if ('ABCDEFGH'.includes(c)) return 'Africa';
  if ('JKLMNPR'.includes(c)) return 'Asia';
  if ('STUVWXYZ'.includes(c)) return 'Europe';
  if ('12345'.includes(c)) return 'North America';
  if ('67'.includes(c)) return 'Oceania';
  if ('89'.includes(c)) return 'South America';
  return 'Unknown';
};

export function normalizeVin(vin) {
  return String(vin || '').toUpperCase().replace(/[\s-]/g, '');
}

export function checkDigit(vin) {
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const ch = vin[i];
    const v = /[0-9]/.test(ch) ? Number(ch) : TRANSLIT[ch];
    if (v === undefined) return null;
    sum += v * WEIGHTS[i];
  }
  const r = sum % 11;
  return r === 10 ? 'X' : String(r);
}

/** Candidate model years for position-10 code, most recent first, never in the future (+1 model year allowed). */
export function modelYears(code, now = new Date()) {
  const idx = YEAR_CODES.indexOf(code);
  if (idx < 0) return [];
  const maxYear = now.getFullYear() + 1;
  const years = [1980 + idx, 2010 + idx, 2040 + idx].filter((y) => y <= maxYear);
  return years.reverse();
}

export function decodeVin(raw, now = new Date()) {
  const vin = normalizeVin(raw);
  const errors = [];
  const warnings = [];
  if (vin.length !== 17) errors.push(`VIN must have 17 characters (has ${vin.length}).`);
  if (/[IOQ]/.test(vin)) errors.push('VIN cannot contain the letters I, O or Q – check for 1/0 typos.');
  if (/[^A-HJ-NPR-Z0-9]/.test(vin.replace(/[IOQ]/g, ''))) errors.push('VIN contains invalid characters.');
  if (errors.length) return { vin, valid: false, errors, warnings };

  const region = REGION(vin[0]);
  const expected = checkDigit(vin);
  const checkOk = expected === vin[8];
  if (!checkOk) {
    if (region === 'North America') errors.push(`Check digit mismatch (expected ${expected}) – VIN is probably mistyped.`);
    else warnings.push('Check digit does not match; normal for many European VINs, but re-check for typos.');
  }
  const wmi = vin.slice(0, 3);
  const make = WMI[wmi] || WMI[wmi.slice(0, 2) + '9'] || null;
  const years = modelYears(vin[9], now);
  if (!make) warnings.push('Manufacturer code not in offline table – connect a VIN data partner for full decoding.');
  return {
    vin, valid: errors.length === 0, errors, warnings,
    wmi, make, region,
    modelYearCandidates: years,
    modelYear: years[0] || null,
    checkDigitValid: checkOk,
    serial: vin.slice(11),
    source: 'offline WMI table (basic). Engine/equipment require licensed data partner.',
  };
}

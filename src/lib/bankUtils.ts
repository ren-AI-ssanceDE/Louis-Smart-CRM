/**
 * Utility functions for IBAN and BIC validation and bank identification.
 */

export interface IBANValidationResult {
  isValid: boolean;
  bankName?: string;
  error?: string;
}

export interface BICValidationResult {
  isValid: boolean;
  bankName?: string;
  error?: string;
}

// Valid ISO 3166-1 alpha-2 country codes
const ISO_COUNTRY_CODES = new Set([
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ',
  'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS',
  'BT', 'BV', 'BW', 'BY', 'BZ', 'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN',
  'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ', 'EC', 'EE',
  'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FM', 'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF',
  'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY', 'HK', 'HM',
  'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT', 'JE', 'JM',
  'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC',
  'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK',
  'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA',
  'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG',
  'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW',
  'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS',
  'ST', 'SV', 'SX', 'SY', 'SZ', 'TC', 'TD', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO', 'TR',
  'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'UM', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI', 'VN',
  'VU', 'WF', 'WS', 'YE', 'YT', 'ZA', 'ZM', 'ZW'
]);

// High-fidelity local database mapping German Bankleitzahl (BLZ) to realistic Name & SWIFT BIC
export const DE_BLZ_MAP: Record<string, { name: string; bic: string }> = {
  // Commerzbank
  '12030000': { name: 'Commerzbank', bic: 'COBADEFFXXX' },
  '10040000': { name: 'Commerzbank', bic: 'COBADEFFXXX' },
  '20040000': { name: 'Commerzbank', bic: 'COBADEFFXXX' },
  '30040000': { name: 'Commerzbank', bic: 'COBADEFFXXX' },
  '40040000': { name: 'Commerzbank', bic: 'COBADEFFXXX' },
  '50040000': { name: 'Commerzbank', bic: 'COBADEFFXXX' },
  '60040000': { name: 'Commerzbank', bic: 'COBADEFFXXX' },
  '70040000': { name: 'Commerzbank', bic: 'COBADEFFXXX' },
  '80040000': { name: 'Commerzbank', bic: 'COBADEFFXXX' },

  // Deutsche Bank
  '10070000': { name: 'Deutsche Bank', bic: 'DEUTDEDFXXX' },
  '10020000': { name: 'Deutsche Bank', bic: 'DEUTDEDFXXX' },
  '20070000': { name: 'Deutsche Bank', bic: 'DEUTDEDFXXX' },
  '30070000': { name: 'Deutsche Bank', bic: 'DEUTDEDFXXX' },
  '40070000': { name: 'Deutsche Bank', bic: 'DEUTDEDFXXX' },
  '50070000': { name: 'Deutsche Bank', bic: 'DEUTDEDFXXX' },
  '60070000': { name: 'Deutsche Bank', bic: 'DEUTDEDFXXX' },
  '70070000': { name: 'Deutsche Bank', bic: 'DEUTDEDFXXX' },
  '80070000': { name: 'Deutsche Bank', bic: 'DEUTDEDFXXX' },

  // Postbank
  '10010010': { name: 'Postbank', bic: 'PBNKDED1XXX' },
  '20010020': { name: 'Postbank', bic: 'PBNKDED1XXX' },
  '30010030': { name: 'Postbank', bic: 'PBNKDED1XXX' },
  '36010043': { name: 'Postbank', bic: 'PBNKDED1XXX' },
  '40010090': { name: 'Postbank', bic: 'PBNKDED1XXX' },
  '50010060': { name: 'Postbank', bic: 'PBNKDED1XXX' },
  '60010070': { name: 'Postbank', bic: 'PBNKDED1XXX' },
  '70010080': { name: 'Postbank', bic: 'PBNKDED1XXX' },
  '30010011': { name: 'Postbank', bic: 'PBNKDED1XXX' },

  // Direct Banks & Fintechs
  '10011001': { name: 'N26 Bank', bic: 'NXXGDED1XXX' },
  '51020500': { name: 'ING-DiBa', bic: 'WDIDDED1XXX' },
  '50010517': { name: 'ING-DiBa', bic: 'WDIDDED1XXX' },
  '10030200': { name: 'Deutsche Kreditbank (DKB)', bic: 'DKBYDED1XXX' },
  '30020900': { name: 'Targobank', bic: 'SUTADED1XXX' },
  '43060967': { name: 'GLS Gemeinschaftsbank', bic: 'GENODED1GLS' },
  '10011111': { name: 'bunq', bic: 'BUNQNL2AXXX' },
  '10012222': { name: 'Revolut', bic: 'REVOLL2BXXX' },

  // Major Regional Sparkassen (Savings Banks)
  '44050199': { name: 'Sparkasse Dortmund', bic: 'DORTDE33XXX' },
  '10050000': { name: 'Berliner Sparkasse', bic: 'WELADE10XXX' },
  '20050550': { name: 'Hamburger Sparkasse (Haspa)', bic: 'HASADE21XXX' },
  '70050101': { name: 'Stadtsparkasse München', bic: 'MUNDDE66XXX' },
  '37050198': { name: 'Sparkasse KölnBonn', bic: 'KOLNDE33XXX' },
  '66050101': { name: 'Kreissparkasse Köln', bic: 'COKODE33XXX' },
  '60050101': { name: 'Frankfurter Sparkasse', bic: 'FHLDDE55XXX' },
  '39050000': { name: 'Stadtsparkasse Düsseldorf', bic: 'DUSSDE33XXX' },
  '51050015': { name: 'Nassauische Sparkasse (Naspa)', bic: 'NASADE55XXX' },
  '12050000': { name: 'Sparkasse Hannover', bic: 'HANODE2HXXX' },
  '76050101': { name: 'Sparkasse Nürnberg', bic: 'NURDDE77XXX' },
  '30050000': { name: 'Ostsächsische Sparkasse Dresden', bic: 'OSSDDE81XXX' },
  '30050115': { name: 'Mittelbrandenburgische Sparkasse', bic: 'MBSADE3PXXX' },
  '86055592': { name: 'Sparkasse Leipzig', bic: 'SPASDE81XXX' },
  '36050105': { name: 'Sparkasse Essen', bic: 'ESSNDE33XXX' },
  '35050000': { name: 'Sparkasse Duisburg', bic: 'DUISDE33XXX' },
  '43050001': { name: 'Sparkasse Bochum', bic: 'BOCHDE33XXX' },
  '42050001': { name: 'Sparkasse Gelsenkirchen', bic: 'GELSDE33XXX' },
  '40050150': { name: 'Sparkasse Münsterland Ost', bic: 'WSTFDE33XXX' },
  '50050201': { name: 'Nassauische Sparkasse (Naspa)', bic: 'NASADE55XXX' },
  '60050000': { name: 'Landesbank Hessen-Thüringen (Helaba)', bic: 'HEBADEFFXXX' },

  // Key Volksbanken & Cooperative Banks (Clearing via central DZ Bank at GENODED1XXX)
  '10090000': { name: 'Berliner Volksbank', bic: 'BEVODED1XXX' },
  '20090500': { name: 'Hamburger Volksbank', bic: 'GENODED1HH1' },
  '39060180': { name: 'Volksbank Düsseldorf Neuss', bic: 'GENODED1DUS' },
  '70169465': { name: 'Münchner Bank', bic: 'MUBADED1XXX' },
  '60011100': { name: 'Frankfurter Volksbank', bic: 'FFMBDED1XXX' },
  '60050110': { name: 'Frankfurter Volksbank', bic: 'FFMBDED1XXX' },
  '60090100': { name: 'Volksbank Stuttgart', bic: 'VOLSDE6SXXX' },
  '37069520': { name: 'Volksbank Köln Bonn', bic: 'COBADED1XXX' },
  '12090101': { name: 'Hannoversche Volksbank', bic: 'HANVDE2HXXX' },
  '44060122': { name: 'Dortmunder Volksbank', bic: 'DOVODED1XXX' },
  '36060135': { name: 'Volksbank Rhein-Ruhr', bic: 'VBRRDE33XXX' }
};

/**
 * Validates a BIC (Business Identifier Code) / SWIFT code structure.
 */
export function validateBIC(bic: string): BICValidationResult {
  const cleaned = bic.replace(/\s+/g, '').toUpperCase();
  
  if (!cleaned) {
    return { isValid: false, error: 'BIC darf nicht leer sein.' };
  }

  // Regex format check (8 or 11 characters)
  const bicRegex = /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/;
  if (!bicRegex.test(cleaned)) {
    return { 
      isValid: false, 
      error: 'Ungültiges BIC-Format. Erwartet werden 8 oder 11 Zeichen (z.B. COBADEFFXXX).' 
    };
  }

  // Extract country code (chars index 4-5)
  const countryCode = cleaned.slice(4, 6);
  if (!ISO_COUNTRY_CODES.has(countryCode)) {
    return {
      isValid: false,
      error: `Ungültiger Ländercode "${countryCode}" im BIC.`
    };
  }

  const bankName = getBankByBic(cleaned);
  return { isValid: true, bankName };
}

/**
 * Validates an IBAN (International Bank Account Number) using MOD-97 algorithm.
 */
export function validateIBAN(iban: string): IBANValidationResult {
  const cleaned = iban.replace(/\s+/g, '').toUpperCase();

  if (!cleaned) {
    return { isValid: false, error: 'IBAN darf nicht leer sein.' };
  }

  // Country code check
  const countryCode = cleaned.slice(0, 2);
  if (!ISO_COUNTRY_CODES.has(countryCode)) {
    return { isValid: false, error: `Ungültiger Ländercode "${countryCode}" am Start der IBAN.` };
  }

  // Expected length check for common European countries
  const countryLengths: Record<string, number> = {
    AD: 24, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20, 
    ES: 24, FI: 18, FR: 27, GB: 22, GR: 27, HR: 21, HU: 28, IE: 22, IS: 26, IT: 27, 
    LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MT: 31, NL: 18, NO: 15, PL: 28, PT: 25, 
    RO: 24, SE: 24, SI: 19, SK: 24, SM: 27
  };

  const expectedLength = countryLengths[countryCode];
  if (expectedLength && cleaned.length !== expectedLength) {
    return { 
      isValid: false, 
      error: `Ungültige IBAN-Länge für ${countryCode}. Erwartet werden ${expectedLength} Zeichen. Aktuell: ${cleaned.length}.` 
    };
  }

  if (cleaned.length < 15 || cleaned.length > 34) {
    return { isValid: false, error: 'IBAN hat eine unzulässige Gesamtlänge (min 15, max 34).' };
  }

  // Validate via Mod-97 algorithm.
  const rearranged = cleaned.slice(4) + cleaned.slice(0, 4);
  const numericString = rearranged
    .split('')
    .map(char => {
      const code = char.charCodeAt(0);
      if (code >= 65 && code <= 90) { // A-Z
        return String(code - 55);
      }
      return char;
    })
    .join('');

  try {
    const remainder = BigInt(numericString) % 97n;
    if (remainder !== 1n) {
      return { isValid: false, error: 'Ungültige IBAN (Prüfsummen-Verifizierung fehlgeschlagen).' };
    }
  } catch (err) {
    return { isValid: false, error: 'Fehler bei der IBAN Prüfsummenberechnung.' };
  }

  // Detect bank name
  const bankName = getBankByIbanAndBic(cleaned, '');
  return { isValid: true, bankName };
}

/**
 * Resolves bank name using BIC code prefixes.
 */
function getBankByBic(bic: string): string {
  const cleanBic = bic.toUpperCase().trim();
  if (cleanBic.startsWith('DEUTDE')) return 'Deutsche Bank';
  if (cleanBic.startsWith('COBADE')) return 'Commerzbank';
  if (cleanBic.startsWith('PBNKDE')) return 'Postbank';
  if (cleanBic.startsWith('WELADE')) return 'Berliner Sparkasse';
  if (cleanBic.startsWith('HASADE')) return 'Hamburger Sparkasse';
  if (cleanBic.startsWith('GENODE')) return 'Volksbanken Raiffeisenbanken';
  if (cleanBic.startsWith('WDIDDE')) return 'ING-DiBa';
  if (cleanBic.startsWith('DKBYDE')) return 'Deutsche Kreditbank (DKB)';
  if (cleanBic.startsWith('NXXGDE')) return 'N26 Bank';
  if (cleanBic.startsWith('HYVEDE')) return 'HypoVereinsbank (UniCredit)';
  if (cleanBic.startsWith('BUNQ')) return 'bunq';
  if (cleanBic.startsWith('REVO')) return 'Revolut';
  if (cleanBic.startsWith('HEBADE')) return 'Helaba';
  if (cleanBic.startsWith('BYLADE')) return 'BayernLB';
  if (cleanBic.startsWith('SOLADE')) return 'LBBW';
  if (cleanBic.startsWith('SUTADE')) return 'Targobank';
  if (cleanBic.startsWith('SPARDE')) return 'Sparda-Bank';
  if (cleanBic.startsWith('PBSDDE')) return 'Postbank';
  if (cleanBic.startsWith('BCITDE')) return 'Santander';
  
  // Custom smart regional Sparkassen and Volksbanken matches
  if (cleanBic.startsWith('DORTDE')) return 'Sparkasse Dortmund';
  if (cleanBic.startsWith('ESSNDE')) return 'Sparkasse Essen';
  if (cleanBic.startsWith('BOCHDE')) return 'Sparkasse Bochum';
  if (cleanBic.startsWith('KOLNDE')) return 'Sparkasse KölnBonn';
  if (cleanBic.startsWith('DUSSDE')) return 'Stadtsparkasse Düsseldorf';
  if (cleanBic.startsWith('MUNDDE')) return 'Stadtsparkasse München';
  if (cleanBic.startsWith('FHLDDE')) return 'Frankfurter Sparkasse';
  
  return 'Unbekannte Bank';
}

/**
 * Parses any IBAN to extract the BIC locally when possible (0ms delays).
 */
export function getBicByIban(iban: string): string | undefined {
  const cleanIban = iban.replace(/\s+/g, '').toUpperCase();
  if (!cleanIban.startsWith('DE') || cleanIban.length < 12) {
    return undefined;
  }
  const blz = cleanIban.slice(4, 12);

  // 1. Precise map match
  if (DE_BLZ_MAP[blz]) {
    return DE_BLZ_MAP[blz].bic;
  }

  // 2. Clear regular expression and standard rules
  if (blz.endsWith('040000')) {
    return 'COBADEFFXXX';
  }
  if (blz.endsWith('070000')) {
    return 'DEUTDEDFXXX';
  }
  if (blz.endsWith('010010') || blz.startsWith('10010010') || blz.startsWith('30010010')) {
    return 'PBNKDED1XXX';
  }

  // 3. Bank group heuristic
  const bankGroup = blz[3];

  // Volksbanken / Sparda-Banken / Raiffeisenbanken - clear via central GENODED1XXX
  if (bankGroup === '6' || bankGroup === '7' || bankGroup === '8' || bankGroup === '9') {
    return 'GENODED1XXX';
  }

  // Sparkassen (4th digit is 5) - fallback to sensible regional Landesbank or generalized savings BIC
  if (bankGroup === '5') {
    const firstDigit = blz[0];
    if (firstDigit === '1' || firstDigit === '2') {
      return 'HASADE21XXX'; // Hamburg/North
    }
    if (firstDigit === '3' || firstDigit === '4') {
      return 'DUSSDE33XXX'; // West/NRW (e.g. Düsseldorf/Bochum/etc)
    }
    if (firstDigit === '5' || firstDigit === '6') {
      return 'HEBADEFFXXX'; // Hesse/Center
    }
    if (firstDigit === '7' || firstDigit === '8') {
      return 'MUNDDE66XXX'; // Bavaria/South
    }
    return 'WELADE10XXX'; // General Berlin/Eastern fallback
  }

  return undefined;
}

/**
 * Combined resolver using both IBAN and optional BIC.
 */
export function getBankByIbanAndBic(iban: string, bic: string): string {
  const cleanIban = iban.replace(/\s+/g, '').toUpperCase();
  const cleanBic = bic.replace(/\s+/g, '').toUpperCase();

  // 1. Try BIC lookup which is international and highly accurate
  if (cleanBic) {
    const bankName = getBankByBic(cleanBic);
    if (bankName !== 'Unbekannte Bank') {
      return bankName;
    }
  }

  // 2. Try German Bankleitzahl (BLZ) from IBAN (digits 5 to 12)
  if (cleanIban.startsWith('DE') && cleanIban.length >= 12) {
    const blz = cleanIban.slice(4, 12);
    
    // Check our database first
    if (DE_BLZ_MAP[blz]) {
      return DE_BLZ_MAP[blz].name;
    }

    // Checking patterns via 4th digit of German BLZ (Institutsgruppe)
    const bankGroup = blz[3];
    if (bankGroup === '4' || bankGroup === '5') {
      return 'Sparkasse';
    }
    if (bankGroup === '7' || bankGroup === '8' || bankGroup === '9') {
      return 'Volksbank';
    }
    if (bankGroup === '6') {
      return 'Sparda- Bank / Volksbank';
    }

    // Checking prefixes
    if (blz.startsWith('5') || blz.startsWith('375') || blz.startsWith('380') || blz.startsWith('1005') || blz.startsWith('2005') || blz.startsWith('3005')) {
      return 'Sparkasse';
    }
    if (blz.startsWith('3001') || blz.startsWith('1001') || blz.startsWith('5001')) {
      return 'Postbank';
    }
  }

  return 'Unbekannte Bank';
}

/**
 * Free live lookup using openiban.org with fallback mapping.
 */
export async function fetchBankData(iban: string): Promise<{ valid: boolean; bankName?: string; bic?: string; error?: string }> {
  const cleanIban = iban.replace(/\s+/g, '').toUpperCase();
  
  if (cleanIban.length < 15) {
    return { valid: false, error: 'IBAN ist zu kurz.' };
  }

  // Pre-validate locally to check format
  const localRes = validateIBAN(cleanIban);
  if (!localRes.isValid) {
    return {
      valid: false,
      error: localRes.error || 'Ungültige IBAN.'
    };
  }

  const fallbackBic = getBicByIban(cleanIban);
  const fallbackBankName = localRes.bankName || getBankByIbanAndBic(cleanIban, fallbackBic || '');

  try {
    const response = await fetch(`https://openiban.org/api/v1/iban/${cleanIban}`);
    if (!response.ok) {
      throw new Error('API request failed');
    }
    const data = await response.json();
    if (data.valid) {
      return {
        valid: true,
        bankName: data.bankData?.name || fallbackBankName,
        bic: data.bankData?.bic || fallbackBic
      };
    } else {
      return {
        valid: false,
        error: data.messages?.[0] || 'Prüfsumme ungültig.'
      };
    }
  } catch (err) {
    // Graceful fallback to local computation if API offline / rate limited / CORS errors
    return {
      valid: true,
      bankName: fallbackBankName,
      bic: fallbackBic,
    };
  }
}

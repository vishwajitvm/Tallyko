import { chargesGst, checkGstin, gstinCheckChar, gstinState, isValidGstin, normalizeGstin } from '../gstin';

// Check characters below were produced by backend/app/core/gstin.py (check_char), so both sides agree.
const VALID: [string, string][] = [
  ['27AAPFU0939F1ZV', 'Maharashtra'],
  ['29ABCDE1234F1ZW', 'Karnataka'],
  ['07AAACR5055K1Z9', 'Delhi'],
  ['33AAACI1681G1ZW', 'Tamil Nadu'],
  ['24AAACC1206D1ZM', 'Gujarat'],
];

describe('gstinCheckChar', () => {
  it.each(VALID)('matches the server for %s', (gstin) => {
    expect(gstinCheckChar(gstin.slice(0, 14))).toBe(gstin[14]);
  });
});

describe('normalizeGstin', () => {
  it('removes spaces and dashes and upper-cases', () => {
    expect(normalizeGstin(' 27aapfu 0939-f1zv ')).toBe('27AAPFU0939F1ZV');
    expect(normalizeGstin(null)).toBe('');
    expect(normalizeGstin(undefined)).toBe('');
  });
});

describe('checkGstin', () => {
  it.each(VALID)('accepts %s (%s)', (gstin, state) => {
    expect(checkGstin(gstin)).toEqual({ ok: true, gstin, state });
  });

  it('accepts lower case with spaces', () => {
    expect(checkGstin('27 aapfu0939f1zv')).toMatchObject({ ok: true, state: 'Maharashtra' });
  });

  it('asks for a value when empty', () => {
    expect(checkGstin('  ')).toMatchObject({ ok: false, error: 'Enter your GSTIN' });
  });

  it('needs 15 characters', () => {
    expect(checkGstin('27AAPFU0939F1Z')).toMatchObject({ ok: false, error: 'A GSTIN has 15 characters' });
    expect(checkGstin('27AAPFU0939F1ZVX')).toMatchObject({ ok: false, error: 'A GSTIN has 15 characters' });
  });

  it('rejects the wrong shape', () => {
    // 14th character must be Z
    expect(checkGstin('27AAPFU0939F1AV').error).toMatch(/doesn't look like a GSTIN/);
    // entity number cannot be 0
    expect(checkGstin('27AAPFU0939F0ZV').error).toMatch(/doesn't look like a GSTIN/);
    // PAN part has letters where digits belong
    expect(checkGstin('27AAPFUABCDF1ZV').error).toMatch(/doesn't look like a GSTIN/);
  });

  it('rejects unknown state codes', () => {
    expect(checkGstin('25AAPFU0939F1ZV').error).toBe("25 isn't a valid state code");
    expect(checkGstin('00AAPFU0939F1ZV').error).toBe("00 isn't a valid state code");
  });

  it('catches a typo through the check character', () => {
    const result = checkGstin('27AAPFU0939F1ZW');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/typo/);
    // one changed PAN character also breaks the checksum
    expect(checkGstin('27AAPFU0938F1ZV').ok).toBe(false);
  });
});

describe('gstinState / isValidGstin', () => {
  it('returns the state only for valid numbers', () => {
    expect(gstinState('27AAPFU0939F1ZV')).toBe('Maharashtra');
    expect(gstinState('27AAPFU0939F1ZW')).toBeNull();
    expect(isValidGstin('')).toBe(false);
  });
});

describe('chargesGst', () => {
  it('charges GST only for regular registration with a valid GSTIN', () => {
    expect(chargesGst('regular', '27AAPFU0939F1ZV')).toBe(true);
    expect(chargesGst(null, '27AAPFU0939F1ZV')).toBe(true); // server default is regular
    expect(chargesGst('regular', '')).toBe(false);
    expect(chargesGst('regular', '27AAPFU0939F1ZW')).toBe(false);
    expect(chargesGst('composition', '27AAPFU0939F1ZV')).toBe(false);
    expect(chargesGst('unregistered', '27AAPFU0939F1ZV')).toBe(false);
  });
});

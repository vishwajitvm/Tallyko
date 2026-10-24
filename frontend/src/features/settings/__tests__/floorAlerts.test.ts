/// <reference types="jest" />
import { OPS_DEFAULTS, opsFormOf, opsValues, validateOps } from '../floorAlerts';

describe('floor alert form', () => {
  it('fills from settings with defaults for missing keys', () => {
    expect(opsFormOf({ table_amber_min: 30 })).toMatchObject({ table_amber_min: '30', table_red_min: '75', online_wait_min: '3' });
    expect(opsValues(opsFormOf(null))).toEqual(OPS_DEFAULTS);
  });

  it('checks the same rules as the server', () => {
    expect(validateOps(opsFormOf(null))).toEqual({});
    const form = { ...opsFormOf(null), table_red_min: '40', kitchen_amber_min: '0', online_wait_min: '601' };
    expect(validateOps(form)).toEqual({
      table_red_min: 'Red must come after amber',
      kitchen_amber_min: 'Enter 1 to 600 minutes',
      online_wait_min: 'Enter 1 to 600 minutes',
    });
    expect(validateOps({ ...opsFormOf(null), table_amber_min: '' }).table_amber_min).toBe('Enter 1 to 600 minutes');
  });
});

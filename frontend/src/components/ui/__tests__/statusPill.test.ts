import { STATUS_META, statusMeta } from '../statusMeta';

describe('statusMeta', () => {
  it('maps every documented status to the §4 colour family', () => {
    expect(statusMeta('pending').tone).toBe('pending');
    expect(statusMeta('preparing').tone).toBe('progress');
    expect(statusMeta('ready').tone).toBe('ready');
    expect(statusMeta('served').tone).toBe('neutral');
    expect(statusMeta('paid').tone).toBe('neutral');
    expect(statusMeta('void')).toMatchObject({ tone: 'void', struck: true });
    expect(statusMeta('cancelled')).toMatchObject({ tone: 'void', struck: true });
    expect(statusMeta('claim').tone).toBe('waiting');
    expect(Object.keys(STATUS_META)).toHaveLength(19);
  });

  it('accepts aliases and any casing', () => {
    expect(statusMeta('CANCELED').label).toBe('Cancelled');
    expect(statusMeta('in_progress').label).toBe('Preparing');
  });

  it('falls back to a neutral, readable pill', () => {
    expect(statusMeta('on_hold')).toMatchObject({ label: 'On Hold', tone: 'neutral' });
    expect(statusMeta(undefined).label).toBe('Unknown');
  });
});

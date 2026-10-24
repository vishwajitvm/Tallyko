import { initials } from '../initials';

describe('initials', () => {
  it('ignores brackets and punctuation', () => {
    expect(initials('Ramesh (Head chef)')).toBe('RH');
    expect(initials('anil.kumar@shop.in')).toBe('AK');
  });
  it('handles single names and empty values', () => {
    expect(initials('Sana')).toBe('SA');
    expect(initials('')).toBe('?');
    expect(initials(null)).toBe('?');
  });
});

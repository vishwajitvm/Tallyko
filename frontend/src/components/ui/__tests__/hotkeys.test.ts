import { compileHotkeys, findBinding, formatShortcut, isTypingTarget, matchesCombo, parseCombo } from '@/hooks/useHotkeys';

type Mods = Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean; repeat: boolean }>;
const ev = (key: string, mods: Mods = {}, target?: unknown) => ({ key, ...mods, target });
const input = { tagName: 'INPUT', type: 'text' };

describe('parseCombo / matchesCombo', () => {
  it('parses modifiers and aliases', () => {
    expect(parseCombo('Ctrl+Enter')).toEqual({ key: 'enter', ctrl: true, alt: false, shift: false, meta: false });
    expect(parseCombo('Esc').key).toBe('escape');
    expect(parseCombo('+').key).toBe('+');
    expect(parseCombo('Ctrl++')).toMatchObject({ key: '+', ctrl: true });
    expect(parseCombo('up').key).toBe('arrowup');
  });

  it('matches F-keys and modifier combos exactly', () => {
    expect(matchesCombo(parseCombo('F8'), ev('F8'))).toBe(true);
    expect(matchesCombo(parseCombo('F8'), ev('F8', { ctrlKey: true }))).toBe(false);
    expect(matchesCombo(parseCombo('Ctrl+Enter'), ev('Enter', { ctrlKey: true }))).toBe(true);
    expect(matchesCombo(parseCombo('Ctrl+Enter'), ev('Enter', { metaKey: true }))).toBe(true); // Cmd on a Mac
    expect(matchesCombo(parseCombo('Ctrl+Enter'), ev('Enter'))).toBe(false);
    expect(matchesCombo(parseCombo('Enter'), ev('Enter', { ctrlKey: true }))).toBe(false);
  });

  it('matches + with or without Shift (main row vs numpad), and - and /', () => {
    expect(matchesCombo(parseCombo('+'), ev('+', { shiftKey: true }))).toBe(true);
    expect(matchesCombo(parseCombo('+'), ev('+'))).toBe(true);
    expect(matchesCombo(parseCombo('-'), ev('-'))).toBe(true);
    expect(matchesCombo(parseCombo('/'), ev('/'))).toBe(true);
    expect(matchesCombo(parseCombo('Shift+ArrowDown'), ev('ArrowDown'))).toBe(false);
  });
});

describe('findBinding', () => {
  const noop = () => undefined;
  const bindings = compileHotkeys({
    F8: noop,
    'Ctrl+Enter': noop,
    '/': noop,
    Escape: noop,
    '+': noop,
    ArrowDown: noop,
    'F2|s': noop,
    x: { handler: noop, global: true },
    q: { handler: noop, enabled: false },
  });

  it('fires plain keys when not typing', () => {
    expect(findBinding(bindings, ev('/'))?.combo.key).toBe('/');
    expect(findBinding(bindings, ev('+', { shiftKey: true }))?.combo.key).toBe('+');
    expect(findBinding(bindings, ev('s'))?.combo.key).toBe('s');
    expect(findBinding(bindings, ev('F2'))?.combo.key).toBe('f2');
  });

  it('ignores plain keys while typing, but not global ones', () => {
    expect(findBinding(bindings, ev('/', {}, input))).toBeUndefined();
    expect(findBinding(bindings, ev('+', {}, input))).toBeUndefined();
    expect(findBinding(bindings, ev('ArrowDown', {}, input))).toBeUndefined();
    expect(findBinding(bindings, ev('F8', {}, input))?.combo.key).toBe('f8');
    expect(findBinding(bindings, ev('Escape', {}, input))?.combo.key).toBe('escape');
    expect(findBinding(bindings, ev('Enter', { ctrlKey: true }, input))?.combo.key).toBe('enter');
    expect(findBinding(bindings, ev('x', {}, input))?.combo.key).toBe('x');
  });

  it('only repeats arrows and +/- when a key is held', () => {
    expect(findBinding(bindings, ev('ArrowDown', { repeat: true }))).toBeDefined();
    expect(findBinding(bindings, ev('+', { repeat: true }))).toBeDefined();
    expect(findBinding(bindings, ev('F8', { repeat: true }))).toBeUndefined();
  });

  it('leaves Enter/Space to a focused button, but not other keys', () => {
    const b = compileHotkeys({ Enter: noop, Space: noop, F8: noop });
    const button = { tagName: 'BUTTON' };
    const roleButton = { tagName: 'DIV', getAttribute: (n: string) => (n === 'role' ? 'button' : null) };
    expect(findBinding(b, ev('Enter', {}, button))).toBeUndefined();
    expect(findBinding(b, ev(' ', {}, roleButton))).toBeUndefined();
    expect(findBinding(b, ev('F8', {}, button))?.combo.key).toBe('f8');
    expect(findBinding(b, ev('Enter', {}, { tagName: 'DIV' }))?.combo.key).toBe('enter');
  });

  it('skips disabled bindings', () => {
    expect(findBinding(bindings, ev('q'))).toBeUndefined();
  });
});

describe('isTypingTarget', () => {
  it('detects text fields but not buttons/checkboxes', () => {
    expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTypingTarget({ tagName: 'input', type: 'search' })).toBe(true);
    expect(isTypingTarget({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV' })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('formatShortcut', () => {
  it('formats for Windows/Linux and Mac', () => {
    expect(formatShortcut('F8', false)).toBe('F8');
    expect(formatShortcut('Ctrl+Enter', false)).toBe('Ctrl+↵');
    expect(formatShortcut('Ctrl+Enter', true)).toBe('⌘↵');
    expect(formatShortcut('/', false)).toBe('/');
    expect(formatShortcut('Escape', false)).toBe('Esc');
    expect(formatShortcut('F2|/', false)).toBe('F2');
  });
});

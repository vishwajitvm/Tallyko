/**
 * Two-letter avatar initials from a person's name or email.
 * Ignores brackets, digits and punctuation: "Ramesh (Head chef)" → "RH", "anil.kumar@shop.in" → "AK", "Sana" → "SA".
 */
export function initials(name: string | null | undefined): string {
  const words = (name ?? '')
    .replace(/@.*/, '')
    .split(/[^\p{L}]+/u)
    .filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

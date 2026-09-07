/** Shared utility functions */

/** Convert a number to ordinal string (1st, 2nd, 3rd, … 4th, 11th, 21st). */
export function toOrdinal(n: number): string {
  const i = Math.round(Math.abs(n));
  const v = i % 100;
  const d = i % 10;
  const suf =
    v >= 11 && v <= 13 ? 'th' : d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th';
  return `${n < 0 ? '-' : ''}${i}${suf}`;
}

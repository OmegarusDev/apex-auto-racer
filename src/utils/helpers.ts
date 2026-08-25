/** Shared utility functions */

/** Convert a number to ordinal string (1st, 2nd, 3rd, etc.) */
export function toOrdinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v % 10]}`;
}
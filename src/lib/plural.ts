// =========================================================
// Українське відмінювання іменника за числівником: 1 спроба, 2 спроби,
// 5 спроб, 21 спроба, 12 спроб. Повертає лише слово — число підставляй сам.
// =========================================================

export function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(n) % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

export const attemptsWord = (n: number) => plural(n, 'спроба', 'спроби', 'спроб');
export const timesWord = (n: number) => plural(n, 'раз', 'рази', 'разів');
export const minusWord = (n: number) => plural(n, 'мінус', 'мінуси', 'мінусів');
export const failsWord = (n: number) => plural(n, 'провал', 'провали', 'провалів');
export const winsWord = (n: number) => plural(n, 'перемога', 'перемоги', 'перемог');
export const stonesWord = (n: number) => plural(n, 'камінь', 'камені', 'каменів');
export const tripsWord = (n: number) => plural(n, 'поїздка', 'поїздки', 'поїздок');
export const tapsWord = (n: number) => plural(n, 'тиць', 'тиці', 'тиців');

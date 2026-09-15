// =========================================================
// Перевірки присутності: гравцеві показують кілька каменів, один
// підсвічено — треба тицьнути саме в нього. Людина витрачає пару секунд,
// автоклікер без людини на цьому зупиняється. Клікер під наглядом людини
// дозволено, тож мета — не бан, а неможливість грати без людини.
// =========================================================

import type { ChallengeReason, ChallengeView } from '../../src/lib/apiTypes';

export const CHALLENGE_OPTIONS = 6;

/** Перерва між спробами, після якої гра вважається «з паузою». */
export const PAUSE_MS = 30_000;

export function makeChallenge(reason: ChallengeReason, id: string, pick: (n: number) => number): ChallengeView {
  return { id, reason, options: CHALLENGE_OPTIONS, target: pick(CHALLENGE_OPTIONS) };
}

/** Номер спроби для наступної випадкової перевірки: у середньому раз на
 * `every` спроб, з розкидом ±50%, щоб момент не можна було вгадати. */
export function scheduleRandomCheck(attempts: number, every: number, unit: () => number): number | null {
  if (every <= 0) return null;
  return attempts + Math.max(1, Math.round(every * (0.5 + unit())));
}

export function sessionTooLong(activeSince: number, now: number, minutes: number): boolean {
  return minutes > 0 && now - activeSince >= minutes * 60_000;
}

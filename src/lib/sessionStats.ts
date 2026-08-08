// =========================================================
// Похідна статистика забігу — рахується ЛИШЕ з готової історії спроб
// (AttemptResult[]), нічого не знає про RATES/points/кидки. Хронологічний
// порядок (найстаріша спроба — індекс 0), як зберігає ladderEngine.
// =========================================================

import type { AttemptResult } from './types';

export interface SessionStats {
  attemptsUsed: number;
  finalLevel: number;
  peakLevel: number;
  /** Номер спроби (1-based), на якій пік було досягнуто ВПЕРШЕ. */
  peakAttempt: number;
  totalSuccesses: number;
  totalFails: number;
  /** Провали, що реально ЗНИЗИЛИ рівень (under −1, mirage/sky скид) — на
   * відміну від world, який на провалі рівень не чіпає. */
  totalDowngrades: number;
  longestSuccessStreak: number;
  longestFailStreak: number;
  biggestDrop: number;
  biggestComeback: number;
  successRate: number; // 0..1
}

export function computeSessionStats(history: AttemptResult[]): SessionStats {
  let peakLevel = 0;
  let peakAttempt = 0;
  let totalSuccesses = 0;
  let totalDowngrades = 0;
  let longestSuccessStreak = 0;
  let longestFailStreak = 0;
  let curSuccessStreak = 0;
  let curFailStreak = 0;
  let biggestDrop = 0;

  history.forEach((h, i) => {
    if (h.success) {
      totalSuccesses++;
      curSuccessStreak++;
      curFailStreak = 0;
    } else {
      curFailStreak++;
      curSuccessStreak = 0;
      if (h.after < h.before) {
        totalDowngrades++;
        biggestDrop = Math.max(biggestDrop, h.before - h.after);
      }
    }
    longestSuccessStreak = Math.max(longestSuccessStreak, curSuccessStreak);
    longestFailStreak = Math.max(longestFailStreak, curFailStreak);
    if (h.after > peakLevel) {
      peakLevel = h.after;
      peakAttempt = i + 1;
    }
  });

  let biggestComeback = 0;
  for (let i = 0; i < history.length; i++) {
    const h = history[i];
    if (h.after >= h.before) continue; // не провал-зниження
    let laterPeak = h.after;
    for (let j = i + 1; j < history.length; j++) {
      if (history[j].after > laterPeak) laterPeak = history[j].after;
    }
    biggestComeback = Math.max(biggestComeback, laterPeak - h.after);
  }

  const attemptsUsed = history.length;
  return {
    attemptsUsed,
    finalLevel: attemptsUsed > 0 ? history[attemptsUsed - 1].after : 0,
    peakLevel,
    peakAttempt,
    totalSuccesses,
    totalFails: attemptsUsed - totalSuccesses,
    totalDowngrades,
    longestSuccessStreak,
    longestFailStreak,
    biggestDrop,
    biggestComeback,
    successRate: attemptsUsed > 0 ? totalSuccesses / attemptsUsed : 0,
  };
}

// =========================================================
// Похідна статистика забігу — рахується ЛИШЕ з готової історії спроб
// (AttemptResult[]), нічого не знає про RATES/points/кидки. Хронологічний
// порядок (найстаріша спроба — індекс 0), як зберігає ladderEngine.
//
// УВАГА: поля bestStreak/worstStreak/biggestDrop/biggestComeback/
// peakAttempt/successRate дзеркально перевіряються серверним тригером
// (supabase/migrations/0005/0006) — їхні формули міняти можна ЛИШЕ разом
// із SQL, інакше чесні сабміти почнуть відхилятися як "читерські".
// Решта полів — суто клієнтські, їх можна крутити вільно.
// =========================================================

import type { StoneMethod } from '../data/refineRates';
import type { AttemptResult } from './types';

export interface StagnationInfo {
  length: number;
  level: number;
  /** Номер спроби (1-based), з якої почалось "застрягання". */
  startAttempt: number;
}

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
  // ---- клієнтські поля (НЕ валідуються сервером) ----
  /** Сумарно втрачених рівнів за всі падіння. */
  totalLevelsLost: number;
  /** Скільки разів злетів у +0 з рівня >= 1 (провал mirage/sky). */
  timesHitZero: number;
  /** Спроби платними каменями (все, крім міража). */
  paidAttempts: number;
  methodCounts: Record<StoneMethod, number>;
  /** Успіхи по кожному методу — для розбивки "по каменях" на фінальному екрані. */
  methodSuccesses: Record<StoneMethod, number>;
  /** Рівень, НА якому зроблено найбільше спроб (before), і їх кількість. */
  favoriteLevel: { level: number; attempts: number };
  longestStagnation: StagnationInfo;
}

/** Найдовший хвіст провалів ПОСПІЛЬ на одному й тому самому рівні
 * (BLOOD SACRIFICE в titles, "КРИВАВЕ ЖЕРТВОПРИНОШЕННЯ" у hallOfShame). */
export function longestSameLevelFailStreak(history: AttemptResult[]): { length: number; level: number } {
  let best = 0;
  let bestLevel = -1;
  let cur = 0;
  let curLevel = -1;
  for (const h of history) {
    if (!h.success && h.before === curLevel) {
      cur++;
    } else if (!h.success) {
      curLevel = h.before;
      cur = 1;
    } else {
      cur = 0;
      curLevel = -1;
    }
    if (cur > best) {
      best = cur;
      bestLevel = curLevel;
    }
  }
  return { length: best, level: bestLevel };
}

/** Найдовше "застрягання" — вікно спроб, де рівень не виходив за межі
 * ±band від стартового значення цього вікна. */
export function longestStagnation(history: AttemptResult[], band = 1): StagnationInfo {
  let best: StagnationInfo = { length: 0, level: 0, startAttempt: 0 };
  for (let i = 0; i < history.length; i++) {
    const base = history[i].before;
    let j = i;
    while (j < history.length && Math.abs(history[j].after - base) <= band) j++;
    const length = j - i;
    if (length > best.length) best = { length, level: base, startAttempt: i + 1 };
  }
  return best;
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
  let totalLevelsLost = 0;
  let timesHitZero = 0;
  const methodCounts: Record<StoneMethod, number> = { mirage: 0, sky: 0, under: 0, world: 0 };
  const methodSuccesses: Record<StoneMethod, number> = { mirage: 0, sky: 0, under: 0, world: 0 };
  const visits = new Map<number, number>();

  history.forEach((h, i) => {
    methodCounts[h.method]++;
    visits.set(h.before, (visits.get(h.before) ?? 0) + 1);
    if (h.success) {
      methodSuccesses[h.method]++;
      totalSuccesses++;
      curSuccessStreak++;
      curFailStreak = 0;
    } else {
      curFailStreak++;
      curSuccessStreak = 0;
      if (h.after < h.before) {
        totalDowngrades++;
        totalLevelsLost += h.before - h.after;
        biggestDrop = Math.max(biggestDrop, h.before - h.after);
        if (h.after === 0) timesHitZero++;
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

  let favoriteLevel = { level: 0, attempts: 0 };
  for (const [level, attempts] of visits) {
    if (attempts > favoriteLevel.attempts || (attempts === favoriteLevel.attempts && level < favoriteLevel.level)) {
      favoriteLevel = { level, attempts };
    }
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
    totalLevelsLost,
    timesHitZero,
    paidAttempts: attemptsUsed - methodCounts.mirage,
    methodCounts,
    methodSuccesses,
    favoriteLevel,
    longestStagnation: longestStagnation(history),
  };
}

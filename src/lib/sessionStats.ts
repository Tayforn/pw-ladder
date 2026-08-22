// =========================================================
// Похідна статистика забігу — рахується ЛИШЕ з готової історії спроб
// (AttemptResult[]), нічого не знає про RATES/points/кидки. Хронологічний
// порядок (найстаріша спроба — індекс 0), як зберігає ladderEngine.
//
// ДВА ПРЕДМЕТИ: "переможець" (winnerItem) — слот із вищим фінальним рівнем
// (при рівності — вищий пік, далі a). Статистика ПО РІВНЯХ (пік, падіння,
// камбек, застій, улюблений рівень, втрачені рівні) — по переможцю;
// статистика ПО ПОСЛІДОВНОСТІ (стріки, % успіху, поїздки в нуль, камені)
// — по всіх спробах обох предметів. Другий предмет — окремий блок `decoy`.
//
// УВАГА: поля bestStreak/worstStreak/biggestDrop/biggestComeback/
// peakAttempt/successRate дзеркально перевіряються серверним тригером
// (supabase/migrations/0008) — їхні формули (і вибір переможця) міняти
// можна ЛИШЕ разом із SQL, інакше чесні сабміти почнуть відхилятися як
// "читерські". Решта полів — суто клієнтські.
// =========================================================

import type { StoneMethod } from '../data/refineRates';
import { otherSlot, type AttemptResult, type ItemSlot } from './types';

export interface StagnationInfo {
  length: number;
  level: number;
  /** Номер спроби (1-based), з якої почалось "застрягання". */
  startAttempt: number;
}

/** Підсумок по одному предмету (для блоку "Підставна" на фінальному екрані). */
export interface ItemStats {
  attempts: number;
  successes: number;
  finalLevel: number;
  peakLevel: number;
  timesHitZero: number;
  totalLevelsLost: number;
  biggestDrop: number;
}

export interface SessionStats {
  attemptsUsed: number;
  finalLevel: number;
  peakLevel: number;
  /** Номер спроби (1-based, у ЗАГАЛЬНІЙ історії), на якій пік переможця
   * було досягнуто ВПЕРШЕ. */
  peakAttempt: number;
  totalSuccesses: number;
  totalFails: number;
  /** Провали переможця, що реально ЗНИЗИЛИ рівень. */
  totalDowngrades: number;
  longestSuccessStreak: number;
  longestFailStreak: number;
  biggestDrop: number;
  biggestComeback: number;
  successRate: number; // 0..1
  // ---- клієнтські поля (НЕ валідуються сервером) ----
  /** Сумарно втрачених рівнів переможця. */
  totalLevelsLost: number;
  /** Скільки разів БУДЬ-ЯКИЙ предмет злетів у +0 з рівня >= 1. */
  timesHitZero: number;
  /** Спроби платними каменями (все, крім міража), обидва предмети. */
  paidAttempts: number;
  methodCounts: Record<StoneMethod, number>;
  methodSuccesses: Record<StoneMethod, number>;
  /** Рівень переможця, НА якому зроблено найбільше спроб, і їх кількість. */
  favoriteLevel: { level: number; attempts: number };
  longestStagnation: StagnationInfo;
  // ---- два предмети ----
  winnerItem: ItemSlot;
  /** Другий (не-переможець) предмет. */
  decoy: ItemStats;
  /** Скільки разів основна й підставна мінялися ролями (будь-який рівень). */
  roleSwaps: number;
  /** Рокіровки, де новий основний предмет — на +3 і вище (титули; зміни
   * ролей на 0↔1 — шум, а не подія). */
  majorSwaps: number;
}

export const MAJOR_SWAP_LEVEL = 3;

/** Найдовший хвіст провалів ПОСПІЛЬ на одному й тому самому рівні
 * (очікує історію ОДНОГО предмета). */
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
 * ±band від стартового значення цього вікна (історія одного предмета;
 * startAttempt — індекс у ПЕРЕДАНОМУ масиві). */
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

function itemStats(history: AttemptResult[], item: ItemSlot): ItemStats {
  const s: ItemStats = { attempts: 0, successes: 0, finalLevel: 0, peakLevel: 0, timesHitZero: 0, totalLevelsLost: 0, biggestDrop: 0 };
  for (const h of history) {
    if (h.item !== item) continue;
    s.attempts++;
    if (h.success) s.successes++;
    else if (h.after < h.before) {
      s.totalLevelsLost += h.before - h.after;
      s.biggestDrop = Math.max(s.biggestDrop, h.before - h.after);
      if (h.after === 0) s.timesHitZero++;
    }
    s.finalLevel = h.after;
    s.peakLevel = Math.max(s.peakLevel, h.after);
  }
  return s;
}

/** Переможець — дзеркало правила з 0008: вищий фінальний рівень, при
 * рівності — вищий пік, далі — a. */
export function pickWinner(history: AttemptResult[]): ItemSlot {
  const a = itemStats(history, 'a');
  const b = itemStats(history, 'b');
  return b.finalLevel > a.finalLevel || (b.finalLevel === a.finalLevel && b.peakLevel > a.peakLevel) ? 'b' : 'a';
}

/** Історія лише предмета-переможця — для всіх рівнезалежних обчислень. */
export function winnerHistory(history: AttemptResult[]): AttemptResult[] {
  const w = pickWinner(history);
  return history.filter((h) => h.item === w);
}

export function computeSessionStats(history: AttemptResult[]): SessionStats {
  const winner = pickWinner(history);
  const main = history.filter((h) => h.item === winner);

  // ---- послідовність (обидва предмети) ----
  let totalSuccesses = 0;
  let longestSuccessStreak = 0;
  let longestFailStreak = 0;
  let curSuccessStreak = 0;
  let curFailStreak = 0;
  let timesHitZero = 0;
  const methodCounts: Record<StoneMethod, number> = { mirage: 0, sky: 0, under: 0, world: 0 };
  const methodSuccesses: Record<StoneMethod, number> = { mirage: 0, sky: 0, under: 0, world: 0 };
  for (const h of history) {
    methodCounts[h.method]++;
    if (h.success) {
      methodSuccesses[h.method]++;
      totalSuccesses++;
      curSuccessStreak++;
      curFailStreak = 0;
    } else {
      curFailStreak++;
      curSuccessStreak = 0;
      if (h.after < h.before && h.after === 0) timesHitZero++;
    }
    longestSuccessStreak = Math.max(longestSuccessStreak, curSuccessStreak);
    longestFailStreak = Math.max(longestFailStreak, curFailStreak);
  }

  // ---- переможець (рівні) ----
  let peakLevel = 0;
  let peakAttempt = 0;
  let totalDowngrades = 0;
  let biggestDrop = 0;
  let totalLevelsLost = 0;
  const visits = new Map<number, number>();
  history.forEach((h, i) => {
    if (h.item !== winner) return;
    visits.set(h.before, (visits.get(h.before) ?? 0) + 1);
    if (!h.success && h.after < h.before) {
      totalDowngrades++;
      totalLevelsLost += h.before - h.after;
      biggestDrop = Math.max(biggestDrop, h.before - h.after);
    }
    if (h.after > peakLevel) {
      peakLevel = h.after;
      peakAttempt = i + 1; // глобальний номер спроби
    }
  });

  let biggestComeback = 0;
  for (let i = 0; i < main.length; i++) {
    const h = main[i];
    if (h.after >= h.before) continue; // не провал-зниження
    let laterPeak = h.after;
    for (let j = i + 1; j < main.length; j++) {
      if (main[j].after > laterPeak) laterPeak = main[j].after;
    }
    biggestComeback = Math.max(biggestComeback, laterPeak - h.after);
  }

  let favoriteLevel = { level: 0, attempts: 0 };
  for (const [level, attempts] of visits) {
    if (attempts > favoriteLevel.attempts || (attempts === favoriteLevel.attempts && level < favoriteLevel.level)) {
      favoriteLevel = { level, attempts };
    }
  }

  // ---- рокіровки: відтворюємо липке правило ролей ----
  let roleSwaps = 0;
  let majorSwaps = 0;
  {
    const levels: Record<ItemSlot, number> = { a: 0, b: 0 };
    let mainSlot: ItemSlot = 'a';
    for (const h of history) {
      levels[h.item] = h.after;
      if (levels[otherSlot(mainSlot)] > levels[mainSlot]) {
        mainSlot = otherSlot(mainSlot);
        roleSwaps++;
        if (levels[mainSlot] >= MAJOR_SWAP_LEVEL) majorSwaps++;
      }
    }
  }

  const attemptsUsed = history.length;
  return {
    attemptsUsed,
    finalLevel: main.length > 0 ? main[main.length - 1].after : 0,
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
    longestStagnation: longestStagnation(main),
    winnerItem: winner,
    decoy: itemStats(history, otherSlot(winner)),
    roleSwaps,
    majorSwaps,
  };
}

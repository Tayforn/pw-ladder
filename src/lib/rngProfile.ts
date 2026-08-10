// =========================================================
// RNG-профіль (Luck Score) — розважальна метрика, НЕ наукова оцінка
// ймовірності: 6 незалежних вимірів 0..100 + архетип. Формули
// детерміновані й задокументовані тут — однакова історія завжди дає
// однаковий профіль.
//
// УВАГА: luck дзеркально перевіряється серверним тригером
// (supabase/migrations/0005/0006, допуск ±1) — формулу можна міняти лише
// разом із SQL. Решта вимірів — суто клієнтські.
// =========================================================

import { MAX_LEVEL } from '../data/refineRates';
import type { AttemptResult } from './types';
import type { SessionStats } from './sessionStats';

export interface RngProfile {
  peakPerformance: number;
  consistency: number;
  aggression: number;
  recovery: number;
  streakPower: number;
  luck: number;
  /** Скільки успіхів "мало бути" за шансами таблиці (сума p) — сирі,
   * без округлення; для рядка "Очікувано успіхів" на фінальному екрані. */
  expectedSuccesses: number;
  archetype: string;
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/** "Ставка" однієї спроби — скільки рівнів згорить при провалі обраного
 * методу: mirage/sky ставлять ВЕСЬ поточний рівень, under — 1, world — 0.
 * Саме тому Світобудова на +8 — це НЕ агресія (нічим не ризикуєш), а міраж
 * на +6 — дуже навіть. */
export function stakeFor(h: Pick<AttemptResult, 'method' | 'before'>): number {
  if (h.method === 'world') return 0;
  if (h.method === 'under') return Math.min(1, h.before);
  return h.before; // mirage / sky
}

export function computeRngProfile(history: AttemptResult[], stats: SessionStats): RngProfile {
  const n = Math.max(1, stats.attemptsUsed);

  // Peak Performance — наскільки близько до +12 дійшов.
  const peakPerformance = clamp(Math.round((stats.peakLevel / MAX_LEVEL) * 100));

  // Consistency — штраф за сумарну "втрачену" висоту від провалів відносно к-сті спроб.
  const consistency = clamp(Math.round(100 - (stats.totalLevelsLost / n) * 10));

  // Aggression — СЕРЕДНЯ СТАВКА на спробу (див. stakeFor); 1.5 рівня на
  // кін у середньому = 100 (каліброване симуляцією: чистий міраж ~40,
  // пуш небескою по верхах — 60+). Вимірює вибір ризику, а не висоту.
  const meanStake = history.reduce((sum, h) => sum + stakeFor(h), 0) / n;
  const aggression = clamp(Math.round((meanStake / 1.5) * 100));

  // Recovery — наскільки повністю відігрався після найгіршого падіння.
  const recovery = clamp(Math.round((stats.biggestComeback / Math.max(1, stats.biggestDrop)) * 100));

  // Streak Power — 6 перемог поспіль = максимум.
  const streakPower = clamp(Math.round((stats.longestSuccessStreak / 6) * 100));

  // Luck — факт успіхів проти очікуваних (сума шансів p кожної спроби).
  const expectedSuccesses = history.reduce((sum, h) => sum + h.p, 0);
  const luckRatio = stats.totalSuccesses / Math.max(0.0001, expectedSuccesses);
  const luck = clamp(Math.round(50 + (luckRatio - 1) * 50));

  const dims = { peakPerformance, consistency, aggression, recovery, streakPower, luck };
  return { ...dims, expectedSuccesses, archetype: pickArchetype(dims, stats) };
}

/** Порядок перевірок — від рідкісного/яскравого до буденного: поведінкові
 * архетипи (Gambler/Streaker/Survivor) мають пріоритет над "об'ємним"
 * Grinder, інакше довгий забіг завжди з'їдає цікавіший архетип.
 * Числа тримати в синку з TITLE_CONFIG (titles.ts). */
function pickArchetype(
  dims: Omit<RngProfile, 'archetype' | 'expectedSuccesses'>,
  stats: SessionStats,
): string {
  if (stats.peakLevel >= 8 && stats.attemptsUsed <= 60) return 'RNG God';
  if (dims.luck <= 20 && stats.peakLevel <= 3) return 'Cursed';
  if (dims.aggression >= 60) return 'Gambler';
  if (stats.longestSuccessStreak >= 6) return 'Streaker';
  if (dims.recovery >= 70 && stats.biggestDrop >= 4) return 'Survivor';
  if (stats.attemptsUsed >= 180) return 'Grinder';
  return 'Wild Card';
}

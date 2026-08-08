// =========================================================
// RNG-профіль (Luck Score) — розважальна метрика, НЕ наукова оцінка
// ймовірності: 6 незалежних вимірів 0..100 + архетип. Формули
// детерміновані й задокументовані тут — однакова історія завжди дає
// однаковий профіль.
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
  archetype: string;
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

export function computeRngProfile(history: AttemptResult[], stats: SessionStats): RngProfile {
  const n = Math.max(1, stats.attemptsUsed);

  // Peak Performance — наскільки близько до +12 дійшов.
  const peakPerformance = clamp(Math.round((stats.peakLevel / MAX_LEVEL) * 100));

  // Consistency — штраф за сумарну "втрачену" висоту від провалів відносно к-сті спроб.
  const totalDropAmount = history.reduce((sum, h) => (h.after < h.before ? sum + (h.before - h.after) : sum), 0);
  const consistency = clamp(Math.round(100 - (totalDropAmount / n) * 10));

  // Aggression — частка спроб на високому (небезпечному) рівні +8 і вище.
  const highRiskAttempts = history.filter((h) => h.before >= 8).length;
  const aggression = clamp(Math.round((highRiskAttempts / n) * 100));

  // Recovery — наскільки повністю відігрався після найгіршого падіння.
  const recovery = clamp(Math.round((stats.biggestComeback / Math.max(1, stats.biggestDrop)) * 100));

  // Streak Power — 6+ перемог поспіль (поріг THE STREAKER) = максимум.
  const streakPower = clamp(Math.round((stats.longestSuccessStreak / 6) * 100));

  // Luck — факт успіхів проти очікуваних (сума шансів p кожної спроби).
  const expectedSuccesses = history.reduce((sum, h) => sum + h.p, 0);
  const luckRatio = stats.totalSuccesses / Math.max(0.0001, expectedSuccesses);
  const luck = clamp(Math.round(50 + (luckRatio - 1) * 50));

  const archetype = pickArchetype({ peakPerformance, consistency, aggression, recovery, streakPower, luck }, stats);

  return { peakPerformance, consistency, aggression, recovery, streakPower, luck, archetype };
}

function pickArchetype(
  dims: Omit<RngProfile, 'archetype'>,
  stats: SessionStats,
): string {
  if (stats.peakLevel >= 12 && stats.attemptsUsed <= 40) return 'RNG God';
  if (dims.luck <= 20 && stats.peakLevel <= 3) return 'Cursed';
  if (stats.longestSuccessStreak >= 6) return 'Streaker';
  if (stats.attemptsUsed >= 180) return 'Grinder';
  if (dims.aggression >= 60) return 'Gambler';
  if (dims.recovery >= 70 && stats.biggestDrop >= 4) return 'Survivor';
  return 'Wild Card';
}

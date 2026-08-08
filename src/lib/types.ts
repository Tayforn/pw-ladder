// =========================================================
// Спільні типи для рушія (ladderEngine) і похідних презентаційних модулів
// (criticalMoments/sessionStats/rngProfile/titles/hallOfShame) — щоб не
// плодити дублікати й не створювати циклічні імпорти.
// =========================================================

import type { StoneMethod } from '../data/refineRates';

export type DramaTier = 'normal' | 'significant' | 'rare' | 'exceptional' | 'major';
export type MomentLabel = 'ONE_TAP' | 'BACK_TO_BACK' | 'CLUTCH' | 'MIRACLE' | 'DISASTER';

export interface AttemptResult {
  method: StoneMethod;
  success: boolean;
  before: number;
  after: number;
  /** Шанс успіху цієї спроби (0..1) — з таблиці RATES на момент кидка. */
  p: number;
  tier: DramaTier;
  labels: MomentLabel[];
}

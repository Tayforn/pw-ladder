// =========================================================
// Драматизація результату спроби — суто презентаційний шар, що НЕ впливає
// на сам кидок RNG (ladderEngine.ts). Приймає щойно кинутий результат +
// хронологічну історію ДО цієї спроби й повертає "наскільки це важливо"
// (tier) та контекстні мітки (label).
// =========================================================

import type { AttemptResult, DramaTier, MomentLabel } from './types';

/** +8→+9 значущий, +9→+10 рідкісний, +10→+11 винятковий, +11→+12+ подія. */
export function tierFor(before: number): DramaTier {
  if (before >= 11) return 'major';
  if (before === 10) return 'exceptional';
  if (before === 9) return 'rare';
  if (before === 8) return 'significant';
  return 'normal';
}

/** Скільки ПОСПІЛЬ (з кінця) попередніх спроб було на тому самому рівні `level`. */
function trailingAttemptsAtLevel(priorChrono: AttemptResult[], level: number): number {
  let n = 0;
  for (let i = priorChrono.length - 1; i >= 0; i--) {
    if (priorChrono[i].before !== level) break;
    n++;
  }
  return n;
}

/** Довжина хвоста провалів (з кінця) у хронологічній історії. */
function trailingFailStreak(priorChrono: AttemptResult[]): number {
  let n = 0;
  for (let i = priorChrono.length - 1; i >= 0; i--) {
    if (priorChrono[i].success) break;
    n++;
  }
  return n;
}

/** `priorChrono` — усі спроби ДО поточної, від найстарішої до найновішої
 * (без самої поточної спроби). */
export function labelsFor(
  current: { method: AttemptResult['method']; success: boolean; before: number; after: number; p: number },
  priorChrono: AttemptResult[],
): MomentLabel[] {
  const labels: MomentLabel[] = [];
  const prev = priorChrono[priorChrono.length - 1];

  if (current.success && current.before >= 8 && trailingAttemptsAtLevel(priorChrono, current.before) === 0) {
    labels.push('ONE_TAP');
  }
  if (current.success && prev?.success) {
    labels.push('BACK_TO_BACK');
  }
  if (current.success && trailingFailStreak(priorChrono) >= 4) {
    labels.push('CLUTCH');
  }
  if (current.success && current.p > 0 && current.p <= 0.05) {
    labels.push('MIRACLE');
  }
  if (!current.success && current.before - current.after >= 5) {
    labels.push('DISASTER');
  }
  return labels;
}

export const LABEL_TEXT: Record<MomentLabel, string> = {
  ONE_TAP: 'ONE TAP',
  BACK_TO_BACK: 'BACK-TO-BACK',
  CLUTCH: 'CLUTCH',
  MIRACLE: 'МІРАКЛ',
  DISASTER: 'КАТАСТРОФА',
};

export const TIER_LABEL: Record<DramaTier, string> = {
  normal: '',
  significant: 'Значуща подія',
  rare: 'Рідкісна подія',
  exceptional: 'Виняткова подія',
  major: 'Легендарна подія',
};

// =========================================================
// Тестові хелпери: детермінований будівник валідних історій (переходи
// рівнів за правилами гри, p з RATES), seeded RNG і симулятор чесних
// забігів на базі СПРАВЖНЬОГО рушія (applyAttempt) — щоб тести й
// калібрування титулів ганяли той самий код, що і прод.
// =========================================================

import { RATES, type StoneMethod } from '../../data/refineRates';
import { applyAttempt, MAX_ATTEMPTS, type LadderGameState } from '../ladderEngine';
import { tierFor, labelsFor } from '../criticalMoments';
import type { LadderSettings } from '../../data/ladder';
import type { AttemptResult } from '../types';

export const TEST_SETTINGS: LadderSettings = { pointsPerSuccess: 10, skyCost: 20, underCost: 20, worldCost: 10 };

export type Step = [method: StoneMethod, success: boolean];

/** Будує ВАЛІДНУ історію з послідовності (метод, успіх): before/after
 * ланцюжком за правилами гри, p — із RATES. Кидає, якщо крок неможливий
 * (рівень 12+ або відсутній шанс) — тест із кривим сценарієм має падати. */
export function seqHistory(steps: Step[]): AttemptResult[] {
  let level = 0;
  const out: AttemptResult[] = [];
  for (const [method, success] of steps) {
    const p = RATES[method][level + 1];
    if (!p) throw new Error(`seqHistory: немає шансу для ${method} на рівні ${level} → ${level + 1}`);
    const before = level;
    const after = success ? before + 1 : method === 'world' ? before : method === 'under' ? Math.max(0, before - 1) : 0;
    const raw = { method, success, before, after, p };
    out.push({ ...raw, tier: tierFor(before), labels: labelsFor(raw, out) });
    level = after;
  }
  return out;
}

/** Скорочення: n однакових кроків. */
export function rep(method: StoneMethod, success: boolean, n: number): Step[] {
  return Array.from({ length: n }, () => [method, success] as Step);
}

/** Детермінований LCG (Numerical Recipes) — 0..1. */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Стратегія: обирає метод за поточним станом (або null — стоп). */
export type Strategy = (s: LadderGameState) => StoneMethod | null;

export const STRATEGIES: Record<string, Strategy> = {
  /** Тільки безкоштовний міраж — базовий стиль більшості гравців. */
  mirageOnly: () => 'mirage',
  /** Обережний: до +3 міражем, вище — світобудовою (не втрачає рівень). */
  worldCamper: (s) => (s.level >= 3 && s.points >= TEST_SETTINGS.worldCost ? 'world' : 'mirage'),
  /** Агресивний: із +2 пушить небескою, поки є бали. */
  skyPusher: (s) => (s.level >= 2 && s.points >= TEST_SETTINGS.skyCost ? 'sky' : 'mirage'),
  /** Змішаний: підземка на +3..4, світобудова на +5+, решта міражем. */
  balanced: (s) => {
    if (s.level >= 5 && s.points >= TEST_SETTINGS.worldCost) return 'world';
    if (s.level >= 3 && s.points >= TEST_SETTINGS.underCost) return 'under';
    if (s.level >= 1 && s.level <= 2 && s.points >= TEST_SETTINGS.skyCost && s.attempts % 7 === 0) return 'sky';
    return 'mirage';
  },
};

/** Чесний забіг СПРАВЖНІМ рушієм applyAttempt. */
export function simulateRun(strategy: Strategy, roll: () => number, maxAttempts = MAX_ATTEMPTS): LadderGameState {
  let state: LadderGameState = { level: 0, points: 0, attempts: 0, history: [] };
  while (state.attempts < maxAttempts && state.level < 12) {
    const method = strategy(state);
    if (!method) break;
    const next = applyAttempt(state, method, TEST_SETTINGS, roll);
    if (next === state) break; // неможлива спроба (нема балів) — захист від зациклення
    state = next;
  }
  return state;
}

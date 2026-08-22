// =========================================================
// Тестові хелпери: детермінований будівник валідних історій (переходи
// рівнів за правилами гри, p з RATES, ДВА предмети з липкими ролями),
// seeded RNG і симулятор чесних забігів на базі СПРАВЖНЬОГО рушія
// (applyAttempt) — щоб тести й калібрування титулів ганяли той самий код,
// що і прод.
// =========================================================

import { RATES, type StoneMethod } from '../../data/refineRates';
import { applyAttempt, EMPTY_STATE, MAX_ATTEMPTS, type LadderGameState } from '../ladderEngine';
import { tierFor, labelsFor } from '../criticalMoments';
import type { LadderSettings } from '../../data/ladder';
import { otherSlot, type AttemptResult, type ItemSlot } from '../types';

export const TEST_SETTINGS: LadderSettings = { pointsPerSuccess: 10, decoyPointsPerSuccess: 5, skyCost: 20, underCost: 20, worldCost: 10 };

export type Step = [method: StoneMethod, success: boolean] | [method: StoneMethod, success: boolean, item: ItemSlot];

/** Будує ВАЛІДНУ історію з послідовності (метод, успіх[, слот]): before/after
 * ланцюжком за правилами гри на кожному слоті, p — із RATES, роль — за
 * липким правилом рушія. Кидає, якщо крок неможливий (рівень 12+). */
export function seqHistory(steps: Step[]): AttemptResult[] {
  const levels: Record<ItemSlot, number> = { a: 0, b: 0 };
  let mainSlot: ItemSlot = 'a';
  const out: AttemptResult[] = [];
  for (const step of steps) {
    const [method, success] = step;
    const item: ItemSlot = step[2] ?? 'a';
    const before = levels[item];
    const p = RATES[method][before + 1];
    if (!p) throw new Error(`seqHistory: немає шансу для ${method} на рівні ${before} → ${before + 1} (слот ${item})`);
    const after = success ? before + 1 : method === 'world' ? before : method === 'under' ? Math.max(0, before - 1) : 0;
    const role = item === mainSlot ? 'main' : 'decoy';
    const raw = { method, success, before, after, p };
    out.push({
      ...raw,
      item,
      role,
      tier: tierFor(before),
      labels: labelsFor(raw, out, out.filter((h) => h.item === item)),
    });
    levels[item] = after;
    if (levels[otherSlot(mainSlot)] > levels[mainSlot]) mainSlot = otherSlot(mainSlot);
  }
  return out;
}

/** Скорочення: n однакових кроків. */
export function rep(method: StoneMethod, success: boolean, n: number, item: ItemSlot = 'a'): Step[] {
  return Array.from({ length: n }, () => [method, success, item] as Step);
}

/** Детермінований LCG (Numerical Recipes) — 0..1. */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export interface Pick {
  item: ItemSlot;
  method: StoneMethod;
}
/** Стратегія: обирає предмет і метод за поточним станом (або null — стоп). */
export type Strategy = (s: LadderGameState) => Pick | null;

const mainLevel = (s: LadderGameState) => s.levels[s.mainSlot];
/** Адаптер: стратегія лише по основній. */
const onMain = (f: (s: LadderGameState) => StoneMethod): Strategy => (s) => ({ item: s.mainSlot, method: f(s) });

/** Хвіст спроб підставної з кінця історії як рядок "+-" (до першої спроби основної). */
function decoyTail(s: LadderGameState): string {
  let t = '';
  for (let i = s.history.length - 1; i >= 0; i--) {
    const h = s.history[i];
    if (h.role !== 'decoy') break;
    t = (h.success ? '+' : '-') + t;
  }
  return t;
}
const trailingMinus = (tail: string): number => tail.length - tail.replace(/-+$/, '').length;

/** Ритуальник "холодної серії": точить підставну, поки не побачить k мінусів
 * поспіль, тоді — вирішальний тиць основною. */
const coldRitualist = (k: number): Strategy => (s) => {
  if (trailingMinus(decoyTail(s)) >= k) {
    return { item: s.mainSlot, method: mainLevel(s) >= 3 && s.points >= TEST_SETTINGS.skyCost ? 'sky' : 'mirage' };
  }
  return { item: otherSlot(s.mainSlot), method: 'mirage' };
};

export const STRATEGIES: Record<string, Strategy> = {
  /** Тільки безкоштовний міраж — базовий стиль більшості гравців. */
  mirageOnly: onMain(() => 'mirage'),
  /** Обережний: до +3 міражем, вище — світобудовою (не втрачає рівень). */
  worldCamper: onMain((s) => (mainLevel(s) >= 3 && s.points >= TEST_SETTINGS.worldCost ? 'world' : 'mirage')),
  /** Агресивний: із +2 пушить небескою, поки є бали. */
  skyPusher: onMain((s) => (mainLevel(s) >= 2 && s.points >= TEST_SETTINGS.skyCost ? 'sky' : 'mirage')),
  /** Змішаний: підземка на +3..4, світобудова на +5+, решта міражем. */
  balanced: onMain((s) => {
    const lvl = mainLevel(s);
    if (lvl >= 5 && s.points >= TEST_SETTINGS.worldCost) return 'world';
    if (lvl >= 3 && s.points >= TEST_SETTINGS.underCost) return 'under';
    if (lvl >= 1 && lvl <= 2 && s.points >= TEST_SETTINGS.skyCost && s.attempts % 7 === 0) return 'sky';
    return 'mirage';
  }),
  /** Чекає 3 мінуси на підставній — тоді тиць основною. */
  coldRitualist: coldRitualist(3),
  /** Те саме, але терпляче: 6 мінусів. */
  patientRitualist: coldRitualist(6),
  /** "Гаряча рука": підставну, поки не зайде плюс — тоді основну. */
  hotRitualist: (s) => {
    const tail = decoyTail(s);
    if (tail.endsWith('+')) return { item: s.mainSlot, method: 'mirage' };
    return { item: otherSlot(s.mainSlot), method: 'mirage' };
  },
  /** Строге чергування a-b-a-b міражем. */
  metronome: (s) => ({ item: s.attempts % 2 === 0 ? 'a' : 'b', method: 'mirage' }),
  /** Точить той предмет, що нижчий — обидва ростуть, ролі часто міняються. */
  twoHands: (s) => {
    const item: ItemSlot = s.levels.a <= s.levels.b ? 'a' : 'b';
    return { item, method: s.levels[item] >= 4 && s.points >= TEST_SETTINGS.worldCost ? 'world' : 'mirage' };
  },
};

/** Чесний забіг СПРАВЖНІМ рушієм applyAttempt. */
export function simulateRun(strategy: Strategy, roll: () => number, maxAttempts = MAX_ATTEMPTS): LadderGameState {
  let state: LadderGameState = EMPTY_STATE;
  while (state.attempts < maxAttempts) {
    const pick = strategy(state);
    if (!pick) break;
    const next = applyAttempt(state, pick.item, pick.method, TEST_SETTINGS, roll);
    if (next === state) break; // неможлива спроба (макс. рівень / нема балів) — захист від зациклення
    state = next;
  }
  return state;
}

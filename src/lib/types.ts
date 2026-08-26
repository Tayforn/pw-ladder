// =========================================================
// Спільні типи для рушія (ladderEngine) і похідних презентаційних модулів
// (criticalMoments/sessionStats/rngProfile/titles/hallOfShame/ritual) —
// щоб не плодити дублікати й не створювати циклічні імпорти.
// =========================================================

import type { StoneMethod } from '../data/refineRates';

export type DramaTier = 'normal' | 'significant' | 'rare' | 'exceptional' | 'major';
export type MomentLabel = 'ONE_TAP' | 'BACK_TO_BACK' | 'CLUTCH' | 'MIRACLE' | 'DISASTER';

/** Фізичний слот предмета: 'a' — стартова основна, 'b'..'f' — до 5
 * підставних (скільки реально доступно — вирішує адмінка, decoyCount). */
export type ItemSlot = 'a' | 'b' | 'c' | 'd' | 'e' | 'f';
export const ALL_SLOTS: ItemSlot[] = ['a', 'b', 'c', 'd', 'e', 'f'];
export const MAX_DECOYS = 5;

/** Роль предмета на момент спроби: "основна" = найвищий рівень (роль липка —
 * міняється лише коли інший слот СТРОГО вищий), решта — "підставні". */
export type ItemRole = 'main' | 'decoy';

export interface AttemptResult {
  method: StoneMethod;
  success: boolean;
  before: number;
  after: number;
  /** Шанс успіху цієї спроби (0..1) — з таблиці RATES на момент кидка. */
  p: number;
  tier: DramaTier;
  labels: MomentLabel[];
  /** Слот предмета. Серверний тригер (0009) веде окремий ланцюжок рівнів
   * на кожен слот; старі історії без поля трактуються як 'a'. */
  item: ItemSlot;
  /** Роль на момент спроби — клієнтське поле для ритуал-аналізу й UI
   * (сервер ігнорує). Детерміновано відтворюється з історії. */
  role: ItemRole;
}

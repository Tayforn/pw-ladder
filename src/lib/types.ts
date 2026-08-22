// =========================================================
// Спільні типи для рушія (ladderEngine) і похідних презентаційних модулів
// (criticalMoments/sessionStats/rngProfile/titles/hallOfShame/ritual) —
// щоб не плодити дублікати й не створювати циклічні імпорти.
// =========================================================

import type { StoneMethod } from '../data/refineRates';

export type DramaTier = 'normal' | 'significant' | 'rare' | 'exceptional' | 'major';
export type MomentLabel = 'ONE_TAP' | 'BACK_TO_BACK' | 'CLUTCH' | 'MIRACLE' | 'DISASTER';

/** Фізичний слот предмета в забігу. */
export type ItemSlot = 'a' | 'b';
/** Роль предмета на момент спроби: "основна" = вищий рівень (при рівності
 * роль липка — лишається попередня), "підставна" — другий предмет. */
export type ItemRole = 'main' | 'decoy';

export const otherSlot = (slot: ItemSlot): ItemSlot => (slot === 'a' ? 'b' : 'a');

export interface AttemptResult {
  method: StoneMethod;
  success: boolean;
  before: number;
  after: number;
  /** Шанс успіху цієї спроби (0..1) — з таблиці RATES на момент кидка. */
  p: number;
  tier: DramaTier;
  labels: MomentLabel[];
  /** Слот предмета. Серверний тригер (0008) веде окремий ланцюжок рівнів
   * на кожен слот; старі історії без поля трактуються як 'a'. */
  item: ItemSlot;
  /** Роль на момент спроби — клієнтське поле для ритуал-аналізу й UI
   * (сервер ігнорує). Детерміновано відтворюється з історії. */
  role: ItemRole;
}

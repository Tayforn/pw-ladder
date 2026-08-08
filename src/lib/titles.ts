// =========================================================
// 15 детермінованих титулів — оцінюються з готової історії забігу
// (AttemptResult[]) + похідної статистики/RNG-профілю. Нічого тут не
// впливає на сам кидок RNG, лише читає готовий результат.
//
// Усі порогові значення — в TITLE_CONFIG, щоб їх можна було підкрутити
// пізніше, подивившись на реальні забіги гравців.
// =========================================================

import type { AttemptResult } from './types';
import type { SessionStats } from './sessionStats';
import type { RngProfile } from './rngProfile';

export const TITLE_CONFIG = {
  rngGod: { minPeak: 12, maxAttempts: 40 },
  gambler: { minAggression: 60 },
  cursed: { maxPeak: 3, minFailStreak: 8 },
  grinder: { minAttempts: 180, minPeak: 6 },
  streaker: { minStreak: 6 },
  bloodSacrifice: { minSameLevelFailStreak: 5 },
  unbreakable: { floor: 8, minLength: 15 },
  blessed: { minLuck: 80 },
  demolitionExpert: { minDowngrades: 15, minTotalDropSum: 40 },
  slowAndSteady: { minConsistency: 75, minPeak: 5, maxDrop: 2 },
  wildCard: { minDrop: 5, minStreak: 4 },
  victimOfRng: { minAttempts: 180, maxPeak: 3 },
  clutchMaster: { minFailStreakBeforeClutch: 5 },
  dragon: { minPeak: 10, minSetbacksFrom9: 3, minFinish: 10 },
};

export interface TitleResult {
  id: string;
  name: string;
  evidence: string;
}

/** Найдовший хвіст провалів ПОСПІЛЬ на одному й тому самому рівні (для
 * BLOOD SACRIFICE) — повертає {length, level}. */
function longestSameLevelFailStreak(history: AttemptResult[]): { length: number; level: number } {
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

/** Найдовший безперервний відрізок спроб на рівні >= floor (успіх чи провал —
 * байдуже, важливо, що "перебував нагорі"). */
function longestAtOrAbove(history: AttemptResult[], floor: number): number {
  let best = 0;
  let cur = 0;
  for (const h of history) {
    if (h.before >= floor) cur++;
    else cur = 0;
    best = Math.max(best, cur);
  }
  return best;
}

/** Чи була бодай одна перемога одразу після хвоста провалів довжиною >= n. */
function hasClutchMoment(history: AttemptResult[], failStreakNeeded: number): { found: boolean; streak: number } {
  let curFail = 0;
  let best = 0;
  for (const h of history) {
    if (h.success) {
      if (curFail >= failStreakNeeded) {
        best = Math.max(best, curFail);
      }
      curFail = 0;
    } else {
      curFail++;
    }
  }
  return { found: best >= failStreakNeeded, streak: best };
}

/** Кількість "просідань" з рівня 9+ (before>=9 і фактичне зниження). */
function setbacksFrom(history: AttemptResult[], floor: number): number {
  return history.filter((h) => h.before >= floor && h.after < h.before).length;
}

export function evaluateTitles(
  history: AttemptResult[],
  stats: SessionStats,
  profile: RngProfile,
  currentRecordLevel: number | null,
  cfg: typeof TITLE_CONFIG = TITLE_CONFIG,
): { qualified: TitleResult[]; primary: TitleResult | null } {
  const qualified: TitleResult[] = [];
  const add = (id: string, name: string, evidence: string) => qualified.push({ id, name, evidence });

  if (stats.peakLevel >= cfg.rngGod.minPeak && stats.peakAttempt > 0 && stats.peakAttempt <= cfg.rngGod.maxAttempts) {
    add('RNG_GOD', 'RNG GOD', `Дійшов до +${stats.peakLevel} усього за ${stats.peakAttempt} спроб.`);
  }

  if (currentRecordLevel !== null && stats.peakLevel >= currentRecordLevel && stats.peakLevel > 0) {
    add('THE_CHOSEN_ONE', 'ОБРАНИЙ', `Досяг +${stats.peakLevel} — це рекорд ладдера.`);
  }

  const dragonSetbacks = setbacksFrom(history, 9);
  if (
    stats.peakLevel >= cfg.dragon.minPeak &&
    dragonSetbacks >= cfg.dragon.minSetbacksFrom9 &&
    stats.finalLevel >= cfg.dragon.minFinish
  ) {
    add('THE_DRAGON', 'ДРАКОН', `Досяг +${stats.peakLevel}, пережив ${dragonSetbacks} просідань з +9 і вище, фінішував на +${stats.finalLevel}.`);
  }

  const clutch = hasClutchMoment(history, cfg.clutchMaster.minFailStreakBeforeClutch);
  if (clutch.found) {
    add('CLUTCH_MASTER', 'МАЙСТЕР КЛАТЧУ', `Виграв одразу після ${clutch.streak} провалів поспіль.`);
  }

  const sameLevelFails = longestSameLevelFailStreak(history);
  if (sameLevelFails.length >= cfg.bloodSacrifice.minSameLevelFailStreak) {
    add('BLOOD_SACRIFICE', 'КРИВАВА ЖЕРТВА', `${sameLevelFails.length} провалів поспіль на +${sameLevelFails.level}.`);
  }

  if (stats.peakLevel <= cfg.cursed.maxPeak && stats.longestFailStreak >= cfg.cursed.minFailStreak) {
    add('THE_CURSED', 'ПРОКЛЯТИЙ', `Пік лише +${stats.peakLevel}, а найдовший хвіст провалів — ${stats.longestFailStreak}.`);
  }

  if (stats.attemptsUsed >= cfg.victimOfRng.minAttempts && stats.peakLevel <= cfg.victimOfRng.maxPeak) {
    add('VICTIM_OF_RNG', 'ЖЕРТВА RNG', `${stats.attemptsUsed} спроб — і пік усього +${stats.peakLevel}.`);
  }

  const dropSum = history.reduce((s, h) => (h.after < h.before ? s + (h.before - h.after) : s), 0);
  if (stats.totalDowngrades >= cfg.demolitionExpert.minDowngrades || dropSum >= cfg.demolitionExpert.minTotalDropSum) {
    add('DEMOLITION_EXPERT', 'ПІДРИВНИК', `${stats.totalDowngrades} відкатів, сумарно втрачено ${dropSum} рівнів.`);
  }

  const wildVolatile = stats.biggestDrop >= cfg.wildCard.minDrop && stats.longestSuccessStreak >= cfg.wildCard.minStreak;
  if (wildVolatile) {
    add('WILD_CARD', 'ДИКА КАРТА', `Найбільше падіння −${stats.biggestDrop} і стрік із ${stats.longestSuccessStreak} перемог — усе в одному забігу.`);
  }

  if (stats.longestSuccessStreak >= cfg.streaker.minStreak) {
    add('THE_STREAKER', 'СТРІКЕР', `${stats.longestSuccessStreak} перемог поспіль.`);
  }

  if (stats.attemptsUsed >= cfg.grinder.minAttempts && stats.peakLevel >= cfg.grinder.minPeak) {
    add('THE_GRINDER', 'ГРАЙНДЕР', `Викатав ${stats.attemptsUsed} із 200 спроб і дійшов до +${stats.peakLevel}.`);
  }

  if (profile.aggression >= cfg.gambler.minAggression) {
    add('THE_GAMBLER', 'ГЕМБЛЕР', `${profile.aggression}% спроб — на рівнях +8 і вище.`);
  }

  const unbreakableLen = longestAtOrAbove(history, cfg.unbreakable.floor);
  if (unbreakableLen >= cfg.unbreakable.minLength) {
    add('THE_UNBREAKABLE', 'НЕЗЛАМНИЙ', `${unbreakableLen} спроб поспіль на +${cfg.unbreakable.floor} і вище.`);
  }

  if (profile.luck >= cfg.blessed.minLuck) {
    add('BLESSED', 'БЛАГОСЛОВЕННИЙ', `Luck Score ${profile.luck}/100 — успіхів значно більше, ніж мало бути.`);
  }

  if (
    profile.consistency >= cfg.slowAndSteady.minConsistency &&
    stats.peakLevel >= cfg.slowAndSteady.minPeak &&
    stats.biggestDrop <= cfg.slowAndSteady.maxDrop
  ) {
    add('SLOW_AND_STEADY', 'ТИХОХІД', `Дійшов до +${stats.peakLevel} без жодного падіння більше −${cfg.slowAndSteady.maxDrop}.`);
  }

  // Пріоритет для ПЕРВИННОГО титулу — рідкісні/подієві напочатку.
  const priority = [
    'THE_CHOSEN_ONE', 'RNG_GOD', 'THE_DRAGON', 'CLUTCH_MASTER', 'BLOOD_SACRIFICE',
    'THE_CURSED', 'VICTIM_OF_RNG', 'WILD_CARD', 'DEMOLITION_EXPERT', 'THE_GAMBLER',
    'THE_UNBREAKABLE', 'BLESSED', 'THE_STREAKER', 'THE_GRINDER', 'SLOW_AND_STEADY',
  ];
  const byId = new Map(qualified.map((t) => [t.id, t]));
  const primary = priority.map((id) => byId.get(id)).find((t): t is TitleResult => !!t) ?? null;

  return { qualified, primary };
}

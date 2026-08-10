// =========================================================
// 33 детерміновані титули — оцінюються з готової історії забігу
// (AttemptResult[]) + похідної статистики/RNG-профілю. Нічого тут не
// впливає на сам кидок RNG, лише читає готовий результат.
//
// Усі порогові значення — в TITLE_CONFIG. Пороги відкалібровані симуляцією
// (src/lib/__tests__/calibration.test.ts): кожен титул реально досяжний за
// 200 спроб чесної гри — попередні значення на кшталт "пік +12 за 40
// спроб" мали ймовірність ~1e-8 і були мертвим кодом.
// =========================================================

import { STONE_LABEL } from '../data/refineRates';
import type { AttemptResult } from './types';
import type { SessionStats } from './sessionStats';
import type { RngProfile } from './rngProfile';

export const TITLE_CONFIG = {
  rngGod: { minPeak: 8, maxAttempts: 60 },
  gambler: { minAggression: 60 },
  cursed: { maxPeak: 3, minFailStreak: 8, maxStreakProb: 0.05 },
  grinder: { minAttempts: 180, minPeak: 5 },
  streaker: { minStreak: 6 },
  bloodSacrifice: { minSameLevelFailStreak: 8, maxStreakProb: 0.05 },
  unbreakable: { floor: 5, minLength: 12 },
  blessed: { minLuck: 65, minAttempts: 20 },
  demolitionExpert: { minDowngrades: 35, minTotalDropSum: 90 },
  slowAndSteady: { minConsistency: 75, minPeak: 5, maxDrop: 2 },
  wildCard: { minDrop: 5, minStreak: 4 },
  victimOfRng: { minAttempts: 180, maxPeak: 3 },
  clutchMaster: { minFailStreakBeforeClutch: 8, maxStreakProb: 0.05 },
  dragon: { minPeak: 7, setbackFloor: 5, minSetbacks: 2, minFinish: 6 },
  stoneCollector: {},
  edgeDancer: { minPeak: 5, minAtPeak: 8 },
  fatalSymmetry: { minAttempts: 20 },
  // ---- нові ----
  pacifist: { minAttempts: 100 },
  sisyphus: { minLevel: 4, minClimbs: 4 },
  allIn: { minLevel: 6 },
  photoFinish: { minAttempts: 100, lastWindow: 10, minPeak: 4 },
  hotStart: { minOpeningStreak: 4 },
  lotteryTicket: { maxP: 0.05 },
  phoenix: { minDrop: 4 },
  // ---- економіка / дисципліна / драма ----
  stratosphere: { minPeak: 9 },
  icarus: { minHeight: 6 },
  darkStar: { maxLuck: 40, minAttempts: 50 },
  doubleBottom: { minDrop: 5, minCount: 2 },
  greed: { minPeak: 6, minDropFromPeak: 5 },
  coolHead: { minPeak: 5 },
  alchemist: { minLevel: 3, minCount: 3 },
  marketingVictim: {},
};

export interface TitleResult {
  id: string;
  name: string;
  evidence: string;
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

// ---------------------------------------------------------
// "Образливі" хвости провалів. Сама ДОВЖИНА серії нічого не каже про
// невдачу: світобудова на +4 фейлить 96% спроб, тож 10 провалів поспіль —
// очікувана вартість найбезпечнішого каменя, а не прокляття. Тому серія
// рахується лише якщо її ймовірність ∏(1−p) <= maxStreakProb — тобто RNG
// СПРАВДІ вдарив (5 провалів міражем на старті ≈ 3%), а не гравець сам
// обрав камінь із шансом 0.2%.
// ---------------------------------------------------------

interface FailRun {
  length: number;
  /** ∏(1−p) усіх провалів серії — наскільки взагалі ймовірним був хвіст. */
  prob: number;
  /** Рівень першого провалу серії (для same-level — спільний для всіх). */
  level: number;
}

/** Максимальні серії провалів ПОСПІЛЬ; sameLevel=true розриває серію при
 * зміні рівня (КРИВАВА ЖЕРТВА — страждання на одному й тому ж місці). */
function collectFailRuns(history: AttemptResult[], sameLevel: boolean): FailRun[] {
  const runs: FailRun[] = [];
  let cur: FailRun | null = null;
  for (const h of history) {
    if (!h.success && cur && (!sameLevel || h.before === cur.level)) {
      cur.length++;
      cur.prob *= 1 - h.p;
    } else if (!h.success) {
      if (cur) runs.push(cur);
      cur = { length: 1, prob: 1 - h.p, level: h.before };
    } else {
      if (cur) runs.push(cur);
      cur = null;
    }
  }
  if (cur) runs.push(cur);
  return runs;
}

/** Найменш імовірна серія серед досить довгих і досить образливих;
 * null — усе в межах очікуваного для обраних каменів. */
function mostUnluckyRun(runs: FailRun[], minLength: number, maxProb: number): FailRun | null {
  let best: FailRun | null = null;
  for (const r of runs) {
    if (r.length >= minLength && r.prob <= maxProb && (!best || r.prob < best.prob)) best = r;
  }
  return best;
}

/** Клатч: успіх ОДРАЗУ після образливої серії провалів. */
function unluckyClutch(history: AttemptResult[], minLength: number, maxProb: number): FailRun | null {
  let best: FailRun | null = null;
  let tailLen = 0;
  let tailProb = 1;
  let tailLevel = 0;
  for (const h of history) {
    if (h.success) {
      if (tailLen >= minLength && tailProb <= maxProb && (!best || tailProb < best.prob)) {
        best = { length: tailLen, prob: tailProb, level: tailLevel };
      }
      tailLen = 0;
      tailProb = 1;
    } else {
      if (tailLen === 0) tailLevel = h.before;
      tailLen++;
      tailProb *= 1 - h.p;
    }
  }
  return best;
}

const fmtProb = (prob: number): string => (prob * 100).toFixed(prob < 0.001 ? 2 : 1) + '%';

/** Кількість реальних знижень рівня з висоти >= floor. */
function setbacksFrom(history: AttemptResult[], floor: number): number {
  return history.filter((h) => h.before >= floor && h.after < h.before).length;
}

/** СІЗІФ: скільки разів піднявся НА той самий рівень L (успіх із L-1 на L),
 * максимум по всіх L >= minLevel. Щоб піднятись на L k разів, між підйомами
 * неминуче падав нижче — камінь щоразу котився вниз. */
function sisyphusClimbs(history: AttemptResult[], minLevel: number): { climbs: number; level: number } {
  const counts = new Map<number, number>();
  for (const h of history) {
    if (h.success && h.after >= minLevel) counts.set(h.after, (counts.get(h.after) ?? 0) + 1);
  }
  let best = { climbs: 0, level: 0 };
  for (const [level, climbs] of counts) {
    if (climbs > best.climbs) best = { climbs, level };
  }
  return best;
}

/** ФЕНІКС: згорів у +0 з рівня >= minDrop, а ПІЗНІШЕ піднявся ще вище, ніж
 * був до падіння. Повертає найкращий такий випадок. */
function phoenixRise(history: AttemptResult[], minDrop: number): { from: number; to: number } | null {
  let best: { from: number; to: number } | null = null;
  for (let i = 0; i < history.length; i++) {
    const h = history[i];
    if (h.success || h.after !== 0 || h.before < minDrop) continue;
    let laterPeak = 0;
    for (let j = i + 1; j < history.length; j++) {
      laterPeak = Math.max(laterPeak, history[j].after);
    }
    if (laterPeak > h.before && (!best || laterPeak > best.to)) {
      best = { from: h.before, to: laterPeak };
    }
  }
  return best;
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

  const dragonSetbacks = setbacksFrom(history, cfg.dragon.setbackFloor);
  if (
    stats.peakLevel >= cfg.dragon.minPeak &&
    dragonSetbacks >= cfg.dragon.minSetbacks &&
    stats.finalLevel >= cfg.dragon.minFinish
  ) {
    add('THE_DRAGON', 'ДРАКОН', `Досяг +${stats.peakLevel}, пережив ${dragonSetbacks} падінь із +${cfg.dragon.setbackFloor} і вище — і все одно фінішував на +${stats.finalLevel}.`);
  }

  const rise = phoenixRise(history, cfg.phoenix.minDrop);
  if (rise) {
    add('PHOENIX', 'ФЕНІКС', `Згорів із +${rise.from} у нуль — і піднявся до +${rise.to}.`);
  }

  const lottery = history.find((h) => h.success && h.p > 0 && h.p <= cfg.lotteryTicket.maxP);
  if (lottery) {
    add('LOTTERY_TICKET', 'ЛОТЕРЕЙНИЙ КВИТОК', `Успіх зі шансом ${(lottery.p * 100).toFixed(2)}% (${STONE_LABEL[lottery.method]} на +${lottery.before}).`);
  }

  const clutch = unluckyClutch(history, cfg.clutchMaster.minFailStreakBeforeClutch, cfg.clutchMaster.maxStreakProb);
  if (clutch) {
    add('CLUTCH_MASTER', 'МАЙСТЕР КЛАТЧУ', `Виграв одразу після ${clutch.length} провалів поспіль — шанс такої серії ${fmtProb(clutch.prob)}.`);
  }

  const opening = cfg.hotStart.minOpeningStreak;
  if (history.length >= opening && history.slice(0, opening).every((h) => h.success)) {
    add('HOT_START', "З МІСЦЯ В КАР'ЄР", `Перші ${opening} спроби — всі успішні.`);
  }

  if (
    stats.attemptsUsed >= cfg.photoFinish.minAttempts &&
    stats.peakLevel >= cfg.photoFinish.minPeak &&
    stats.peakAttempt > stats.attemptsUsed - cfg.photoFinish.lastWindow
  ) {
    add('PHOTO_FINISH', 'НА ФЛАЖКУ', `Пік +${stats.peakLevel} — аж на спробі №${stats.peakAttempt} із ${stats.attemptsUsed}. Драматург.`);
  }

  const sacrifice = mostUnluckyRun(
    collectFailRuns(history, true),
    cfg.bloodSacrifice.minSameLevelFailStreak,
    cfg.bloodSacrifice.maxStreakProb,
  );
  if (sacrifice) {
    add('BLOOD_SACRIFICE', 'КРИВАВА ЖЕРТВА', `${sacrifice.length} провалів поспіль на +${sacrifice.level} — шанс такого хвоста ${fmtProb(sacrifice.prob)}.`);
  }

  const cursedRun = stats.peakLevel <= cfg.cursed.maxPeak
    ? mostUnluckyRun(collectFailRuns(history, false), cfg.cursed.minFailStreak, cfg.cursed.maxStreakProb)
    : null;
  if (cursedRun) {
    add('THE_CURSED', 'ПРОКЛЯТИЙ', `Пік лише +${stats.peakLevel}, хвіст із ${cursedRun.length} провалів — шанс ${fmtProb(cursedRun.prob)}.`);
  }

  if (stats.attemptsUsed >= cfg.victimOfRng.minAttempts && stats.peakLevel <= cfg.victimOfRng.maxPeak) {
    add('VICTIM_OF_RNG', 'ЖЕРТВА RNG', `${stats.attemptsUsed} спроб — і пік усього +${stats.peakLevel}.`);
  }

  const sisyphus = sisyphusClimbs(history, cfg.sisyphus.minLevel);
  if (sisyphus.climbs >= cfg.sisyphus.minClimbs) {
    add('SISYPHUS', 'СІЗІФ', `${sisyphus.climbs} разів викочував камінь на +${sisyphus.level} — і він щоразу котився вниз.`);
  }

  const wildVolatile = stats.biggestDrop >= cfg.wildCard.minDrop && stats.longestSuccessStreak >= cfg.wildCard.minStreak;
  if (wildVolatile) {
    add('WILD_CARD', 'ДИКА КАРТА', `Найбільше падіння −${stats.biggestDrop} і стрік із ${stats.longestSuccessStreak} перемог — усе в одному забігу.`);
  }

  const allIn = history.find((h) => h.method === 'mirage' && h.before >= cfg.allIn.minLevel);
  if (allIn) {
    add('ALL_IN', 'ВА-БАНК', allIn.success
      ? `Міраж на +${allIn.before} — і він зайшов. Казино в програші.`
      : `Міраж на +${allIn.before} — і все згоріло. Але красиво.`);
  }

  if (stats.totalDowngrades >= cfg.demolitionExpert.minDowngrades && stats.totalLevelsLost >= cfg.demolitionExpert.minTotalDropSum) {
    add('DEMOLITION_EXPERT', 'ПІДРИВНИК', `${stats.totalDowngrades} відкатів, сумарно втрачено ${stats.totalLevelsLost} рівнів.`);
  }

  if (profile.aggression >= cfg.gambler.minAggression) {
    add('THE_GAMBLER', 'ГЕМБЛЕР', `Агресія ${profile.aggression}/100 — у середньому ставив на кін ${((profile.aggression * 1.5) / 100).toFixed(1)} рівня за спробу.`);
  }

  const unbreakableLen = longestAtOrAbove(history, cfg.unbreakable.floor);
  if (unbreakableLen >= cfg.unbreakable.minLength) {
    add('THE_UNBREAKABLE', 'НЕЗЛАМНИЙ', `${unbreakableLen} спроб поспіль на +${cfg.unbreakable.floor} і вище.`);
  }

  if (profile.luck >= cfg.blessed.minLuck && stats.attemptsUsed >= cfg.blessed.minAttempts) {
    add('BLESSED', 'БЛАГОСЛОВЕННИЙ', `Luck Score ${profile.luck}/100 — успіхів значно більше, ніж мало бути.`);
  }

  if (stats.longestSuccessStreak >= cfg.streaker.minStreak) {
    add('THE_STREAKER', 'СТРІКЕР', `${stats.longestSuccessStreak} перемог поспіль.`);
  }

  if (stats.attemptsUsed >= cfg.pacifist.minAttempts && stats.paidAttempts === 0) {
    add('PACIFIST', 'ПАЦИФІСТ', `${stats.attemptsUsed} спроб — і жодного платного каменя. Чистий міраж, чиста віра.`);
  }

  if (stats.attemptsUsed >= cfg.grinder.minAttempts && stats.peakLevel >= cfg.grinder.minPeak) {
    add('THE_GRINDER', 'ГРАЙНДЕР', `Викатав ${stats.attemptsUsed} із 200 спроб і дійшов до +${stats.peakLevel}.`);
  }

  if (
    profile.consistency >= cfg.slowAndSteady.minConsistency &&
    stats.peakLevel >= cfg.slowAndSteady.minPeak &&
    stats.biggestDrop <= cfg.slowAndSteady.maxDrop
  ) {
    add('SLOW_AND_STEADY', 'ТИХОХІД', `Дійшов до +${stats.peakLevel} без жодного падіння більше −${cfg.slowAndSteady.maxDrop}.`);
  }

  const atPeak = history.filter((h) => h.before === stats.peakLevel).length;
  if (stats.peakLevel >= cfg.edgeDancer.minPeak && atPeak >= cfg.edgeDancer.minAtPeak) {
    add('EDGE_DANCER', 'ТАНЦЮРИСТ НА МЕЖІ', `${atPeak} спроб на власному піку +${stats.peakLevel} — крок від рекорду, крок від прірви.`);
  }

  const methodsUsed = new Set(history.map((h) => h.method));
  if (methodsUsed.size === 4) {
    add('STONE_COLLECTOR', 'КОЛЕКЦІОНЕР КАМІННЯ', 'Використав усі 4 методи заточки за один забіг — міраж, небеска, підземка й світобудова.');
  }

  if (stats.attemptsUsed >= cfg.fatalSymmetry.minAttempts && stats.totalSuccesses === stats.totalFails) {
    add('FATAL_SYMMETRY', 'ФАТАЛЬНА СИМЕТРІЯ', `Точно ${stats.totalSuccesses} успіхів і ${stats.totalFails} провалів — ідеальний баланс всесвіту.`);
  }

  if (stats.peakLevel >= cfg.stratosphere.minPeak) {
    add('STRATOSPHERE', 'СТРАТОСФЕРА', `Побував на +${stats.peakLevel} — там, куди більшість навіть не зазирає.`);
  }

  // ІКАР: встановив НОВИЙ пік забігу — і наступною ж спробою згорів у нуль.
  // Вимога "новий пік" принципова: без неї будь-який провал після чергового
  // підйому на вже бачену висоту робив би Ікаром 80%+ міражистів.
  let icarusLevel = 0;
  let runningPeak = 0;
  for (let i = 0; i < history.length - 1 && !icarusLevel; i++) {
    const h = history[i];
    const next = history[i + 1];
    if (h.success && h.after > runningPeak && h.after >= cfg.icarus.minHeight && !next.success && next.after === 0) {
      icarusLevel = h.after;
    }
    runningPeak = Math.max(runningPeak, h.after);
  }
  if (icarusLevel) {
    add('ICARUS', 'ІКАР', `Злетів на новий пік +${icarusLevel} — і наступною ж спробою згорів у нуль.`);
  }

  if (profile.luck <= cfg.darkStar.maxLuck && stats.attemptsUsed >= cfg.darkStar.minAttempts) {
    add('DARK_STAR', 'ПІД ЧОРНОЮ ЗІРКОЮ', `Luck ${profile.luck}/100 за ${stats.attemptsUsed} спроб — всесвіт був не на твоєму боці.`);
  }

  const hugeDrops = history.filter((h) => h.before - h.after >= cfg.doubleBottom.minDrop).length;
  if (hugeDrops >= cfg.doubleBottom.minCount) {
    add('DOUBLE_BOTTOM', 'ПОДВІЙНЕ ДНО', `${hugeDrops} падінь на ${cfg.doubleBottom.minDrop}+ рівнів за один забіг.`);
  }

  // Зупинився рівно на піку vs грав далі й усе злив — взаємовиключні.
  if (stats.peakLevel >= cfg.coolHead.minPeak && stats.finalLevel === stats.peakLevel) {
    add('COOL_HEAD', 'ХОЛОДНА ГОЛОВА', `Зупинився рівно на піку +${stats.peakLevel}. Рідкісна дисципліна.`);
  }
  if (stats.peakLevel >= cfg.greed.minPeak && stats.peakLevel - stats.finalLevel >= cfg.greed.minDropFromPeak) {
    add('GREED', 'ЩЕ ОДНУ І ВСЕ', `Мав +${stats.peakLevel}, не зупинився — фінішував на +${stats.finalLevel}.`);
  }

  const worldWins = history.filter((h) => h.success && h.method === 'world' && h.before >= cfg.alchemist.minLevel).length;
  if (worldWins >= cfg.alchemist.minCount) {
    add('ALCHEMIST', 'АЛХІМІК', `${worldWins} успіхи світобудови на +${cfg.alchemist.minLevel} і вище — кожен із шансом ≤ 4%.`);
  }

  // Небеска/підземка на +0: провал і так лишає в нулі, міраж робить те саме
  // безкоштовно — класична пастка для новачка.
  const badBuy = history.find((h) => (h.method === 'sky' || h.method === 'under') && h.before === 0);
  if (badBuy) {
    add('MARKETING_VICTIM', 'ЖЕРТВА МАРКЕТИНГУ', `Купив «${STONE_LABEL[badBuy.method]}» на +0, де міраж робить те саме безкоштовно.`);
  }

  // Пріоритет для ПЕРВИННОГО титулу — рідкісні/подієві напочатку.
  const priority = [
    'THE_CHOSEN_ONE', 'RNG_GOD', 'STRATOSPHERE', 'THE_DRAGON', 'PHOENIX',
    'ICARUS', 'LOTTERY_TICKET', 'ALCHEMIST', 'CLUTCH_MASTER', 'HOT_START',
    'PHOTO_FINISH', 'BLOOD_SACRIFICE', 'THE_CURSED', 'DARK_STAR',
    'VICTIM_OF_RNG', 'DOUBLE_BOTTOM', 'SISYPHUS', 'WILD_CARD', 'ALL_IN',
    'GREED', 'COOL_HEAD', 'DEMOLITION_EXPERT', 'THE_GAMBLER',
    'THE_UNBREAKABLE', 'BLESSED', 'THE_STREAKER', 'PACIFIST', 'THE_GRINDER',
    'SLOW_AND_STEADY', 'EDGE_DANCER', 'MARKETING_VICTIM', 'STONE_COLLECTOR',
    'FATAL_SYMMETRY',
  ];
  const byId = new Map(qualified.map((t) => [t.id, t]));
  const primary = priority.map((id) => byId.get(id)).find((t): t is TitleResult => !!t) ?? null;

  return { qualified, primary };
}

// =========================================================
// Детерміновані титули — оцінюються з готової історії забігу
// (AttemptResult[]) + похідної статистики/RNG-профілю/ритуал-аналізу.
// Нічого тут не впливає на сам кидок RNG, лише читає готовий результат.
//
// ДВА ПРЕДМЕТИ: титули про РІВНІ (пік, падіння, серії на одному рівні,
// камп на висоті) читають історію предмета-переможця (`main`); титули про
// ГВЧ (стріки, клатч, удача) — всю послідовність; ритуальні — RitualStats.
//
// Усі порогові значення — в TITLE_CONFIG. Пороги відкалібровані симуляцією
// (src/lib/__tests__/calibration.test.ts): кожен титул реально досяжний за
// 200 спроб чесної гри. Частина ритуальних титулів має ДИНАМІЧНУ назву —
// з особистою сигнатурою гравця (наприклад "КУЛЬТ ‹−−+›").
// =========================================================

import { STONE_LABEL } from '../data/refineRates';
import { otherSlot, type AttemptResult, type ItemSlot } from './types';
import { MAJOR_SWAP_LEVEL, winnerHistory, type SessionStats } from './sessionStats';
import type { RngProfile } from './rngProfile';
import { formatPreamble, type RitualStats } from './ritual';
import { tapsWord, timesWord, stonesWord, attemptsWord } from './plural';

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
  pacifist: { minAttempts: 100 },
  sisyphus: { minLevel: 4, minClimbs: 4 },
  allIn: { minLevel: 6 },
  photoFinish: { minAttempts: 100, lastWindow: 10, minPeak: 4 },
  hotStart: { minOpeningStreak: 4 },
  lotteryTicket: { maxP: 0.05 },
  phoenix: { minDrop: 4 },
  stratosphere: { minPeak: 9 },
  icarus: { minHeight: 6 },
  darkStar: { maxLuck: 40, minAttempts: 50 },
  doubleBottom: { minDrop: 5, minCount: 2 },
  greed: { minPeak: 6, minDropFromPeak: 5 },
  coolHead: { minPeak: 5 },
  alchemist: { minLevel: 3, minCount: 3 },
  marketingVictim: {},
  // ---- ритуал "підставної шмотки" ----
  shaman: { minSwitches: 10 },
  cult: { minSwitches: 8, minOrthodoxy: 80 },
  eclectic: { minDistinct: 8 },
  faith: { minSamples: 10, minDelta: 20 },
  placebo: { minSamples: 15, maxDelta: 5 },
  schoolAdept: { minSwitches: 8 },
  metronome: { minAlternation: 20 },
  patientShaman: { minColdStreak: 6 },
  impatient: { minSwitches: 8 },
  combinator: { minLength: 4 },
  twoChairs: { minItemSwitches: 50 },
  overheat: { minRitualFailRun: 10 },
  whisperer: { minSwitches: 20, minRitualLuck: 65 },
  skeptic: { minAttempts: 150 },
  boughtAndForgot: { minAttempts: 150, maxDecoyAttempts: 2 },
  sacrificialLamb: { minDecoyHitZero: 60 },
  castlingCarousel: { minMajorSwaps: 3 },
  doubleAgent: { minPeak: 5 },
  decoyPricier: { minDecoyPaid: 5 },
  whiteIron: { minDecoyAttempts: 30, maxDecoyPeak: 1 },
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
 * максимум по всіх L >= minLevel. */
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

/** ФЕНІКС: згорів у +0 з рівня >= minDrop, а ПІЗНІШЕ піднявся ще вище. */
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

/** ПРОМОУШН: після першої ЗНАЧУЩОЇ рокіровки (новий основний на +3 і
 * вище) він же встановив новий ЗАГАЛЬНИЙ пік забігу. */
function promotionAfterSwap(history: AttemptResult[]): { level: number } | null {
  const levels: Record<ItemSlot, number> = { a: 0, b: 0 };
  let mainSlot: ItemSlot = 'a';
  let swapped = false;
  let overallPeak = 0;
  for (const h of history) {
    levels[h.item] = h.after;
    if (swapped && h.item === mainSlot && h.after > overallPeak) return { level: h.after };
    overallPeak = Math.max(overallPeak, h.after);
    if (levels[otherSlot(mainSlot)] > levels[mainSlot]) {
      mainSlot = otherSlot(mainSlot);
      if (levels[mainSlot] >= MAJOR_SWAP_LEVEL) swapped = true;
    }
  }
  return null;
}

export function evaluateTitles(
  history: AttemptResult[],
  stats: SessionStats,
  profile: RngProfile,
  currentRecordLevel: number | null,
  ritual: RitualStats,
  cfg: typeof TITLE_CONFIG = TITLE_CONFIG,
): { qualified: TitleResult[]; primary: TitleResult | null } {
  const qualified: TitleResult[] = [];
  const add = (id: string, name: string, evidence: string) => qualified.push({ id, name, evidence });
  /** Історія предмета-переможця — для всього, що читає рівні. */
  const main = winnerHistory(history);

  if (stats.peakLevel >= cfg.rngGod.minPeak && stats.peakAttempt > 0 && stats.peakAttempt <= cfg.rngGod.maxAttempts) {
    add('RNG_GOD', 'RNG GOD', `Дійшов до +${stats.peakLevel} усього за ${stats.peakAttempt} спроб.`);
  }

  if (currentRecordLevel !== null && stats.peakLevel >= currentRecordLevel && stats.peakLevel > 0) {
    add('THE_CHOSEN_ONE', 'ОБРАНИЙ', `Досяг +${stats.peakLevel} — це рекорд ладдера.`);
  }

  const dragonSetbacks = setbacksFrom(main, cfg.dragon.setbackFloor);
  if (
    stats.peakLevel >= cfg.dragon.minPeak &&
    dragonSetbacks >= cfg.dragon.minSetbacks &&
    stats.finalLevel >= cfg.dragon.minFinish
  ) {
    add('THE_DRAGON', 'ДРАКОН', `Досяг +${stats.peakLevel}, пережив ${dragonSetbacks} падінь із +${cfg.dragon.setbackFloor} і вище — і все одно фінішував на +${stats.finalLevel}.`);
  }

  const rise = phoenixRise(main, cfg.phoenix.minDrop);
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
    collectFailRuns(main, true),
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

  const sisyphus = sisyphusClimbs(main, cfg.sisyphus.minLevel);
  if (sisyphus.climbs >= cfg.sisyphus.minClimbs) {
    add('SISYPHUS', 'СІЗІФ', `${sisyphus.climbs} разів викочував камінь на +${sisyphus.level} — і він щоразу котився вниз.`);
  }

  const wildVolatile = stats.biggestDrop >= cfg.wildCard.minDrop && stats.longestSuccessStreak >= cfg.wildCard.minStreak;
  if (wildVolatile) {
    add('WILD_CARD', 'ДИКА КАРТА', `Найбільше падіння −${stats.biggestDrop} і стрік із ${stats.longestSuccessStreak} перемог — усе в одному забігу.`);
  }

  const allIn = main.find((h) => h.method === 'mirage' && h.before >= cfg.allIn.minLevel);
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

  const unbreakableLen = longestAtOrAbove(main, cfg.unbreakable.floor);
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

  const atPeak = main.filter((h) => h.before === stats.peakLevel).length;
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

  // ІКАР: встановив НОВИЙ пік предмета — і наступною ж спробою НА НЬОМУ
  // згорів у нуль.
  let icarusLevel = 0;
  let runningPeak = 0;
  for (let i = 0; i < main.length - 1 && !icarusLevel; i++) {
    const h = main[i];
    const next = main[i + 1];
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

  const badBuy = history.find((h) => (h.method === 'sky' || h.method === 'under') && h.before === 0);
  if (badBuy) {
    add('MARKETING_VICTIM', 'ЖЕРТВА МАРКЕТИНГУ', `Купив «${STONE_LABEL[badBuy.method]}» на +0, де міраж робить те саме безкоштовно.`);
  }

  // =========================================================
  // Ритуал "підставної шмотки"
  // =========================================================
  const r = ritual;
  const sig = r.signature ? formatPreamble(r.signature) : null;
  // Контрольна група — тиці без ритуалу; у чистого ритуаліста її немає,
  // тоді порівнюємо з очікуванням (luck і так нормований до 50).
  const hasControl = r.plain.n >= cfg.faith.minSamples && r.plain.luck !== null;
  const baseline = hasControl ? r.plain.luck! : 50;
  const baselineText = hasControl ? `${baseline} без нього` : 'очікуваних 50';
  const delta = r.ritual.luck !== null ? r.ritual.luck - baseline : null;
  const enoughSamples = r.ritual.n >= cfg.faith.minSamples;

  if (r.switches >= cfg.shaman.minSwitches) {
    add('SHAMAN', 'ШАМАН', `${r.switches} ${tapsWord(r.switches)} з ритуалом і ${r.decoyAttempts} ${attemptsWord(r.decoyAttempts)} спалено на підставну заради віри.`);
  }

  // КУЛЬТ — за СУФІКСНОЮ сигнатурою: "чекаю три мінуси" в даних виглядає як
  // "усі преамбули закінчуються на −−−" (префікс щоразу інший).
  if (r.suffixSignature && r.switches >= cfg.cult.minSwitches && r.suffixShare >= cfg.cult.minOrthodoxy) {
    const suf = formatPreamble(r.suffixSignature);
    add('CULT', `КУЛЬТ ‹${suf}›`, `${r.suffixShare}% тиців — після ‹${suf}› на підставній. Висічено в камені.`);
  }

  if (r.distinctPreambles >= cfg.eclectic.minDistinct && !r.suffixSignature) {
    add('ECLECTIC', 'ЕКЛЕКТИК', `${r.distinctPreambles} різних ритуалів і жодного сталого. Пробував усе — нічого не працює однаково.`);
  }

  if (enoughSamples && delta !== null) {
    if (delta >= cfg.faith.minDelta) {
      add('FAITH_WORKS', 'ВІРА ПРАЦЮЄ', `Удача з ритуалом ${r.ritual.luck} проти ${baselineText}. Статистика каже «збіг». Ти кажеш, що статистика не точила.`);
    } else if (delta <= -cfg.faith.minDelta) {
      add('SCIENCE_WINS', 'НАУКА ПЕРЕМОГЛА', `Удача з ритуалом ${r.ritual.luck} проти ${baselineText}. ГВЧ побачив ритуал і зробив навпаки.`);
    } else if (Math.abs(delta) <= cfg.placebo.maxDelta && r.ritual.n >= cfg.placebo.minSamples) {
      add('PLACEBO', 'ПЛАЦЕБО', `Удача з ритуалом ${r.ritual.luck} проти ${baselineText}. Працює рівно так само, як і нічого, — зате з душею.`);
    }
  }

  if (r.switches >= cfg.schoolAdept.minSwitches && r.school === 'cold') {
    add('COLD_ADEPT', 'АДЕПТ ХОЛОДНОЇ СЕРІЇ', `Тиць основною — тільки після мінусів на підставній${sig ? ` (улюблене ‹${sig}›)` : ''}. «Ну зараз точно прокне».`);
  }
  if (r.switches >= cfg.schoolAdept.minSwitches && r.school === 'hot') {
    add('HOT_ADEPT', 'АДЕПТ ГАРЯЧОЇ РУКИ', `Тиць основною — одразу після плюса на підставній${sig ? ` (улюблене ‹${sig}›)` : ''}. «Рука гаряча, заходимо».`);
  }

  if (r.maxAlternation >= cfg.metronome.minAlternation) {
    add('METRONOME', 'МЕТРОНОМ', `${r.maxAlternation} спроб строгого чергування предметів. Тік-так, тік-так.`);
  }

  if (r.maxColdStreakWaited >= cfg.patientShaman.minColdStreak) {
    add('PATIENT_SHAMAN', 'ТЕРПЛЯЧИЙ ШАМАН', `Дочекався ${r.maxColdStreakWaited} мінусів поспіль на підставній, перш ніж тицьнути основну.`);
  }

  if (sig && sig.length === 1 && r.switches >= cfg.impatient.minSwitches) {
    add('IMPATIENT', 'НЕТЕРПЛЯЧКА', `Улюблений ритуал — один-єдиний ‹${sig}›. Один тиць на підставній — і вже «пора».`);
  }

  // Лише за СТАБІЛЬНИМ суфіксом і з >= 2 змінами знаку: "+---" — це "чекаю
  // три мінуси" з граничним плюсом, а не комбінація; "-+-+" чи "--+-" — так.
  const combo = r.suffixSignature;
  const signChanges = combo ? [...combo].filter((c, i) => i > 0 && c !== combo[i - 1]).length : 0;
  if (combo && combo.length >= cfg.combinator.minLength && signChanges >= 2 && r.switches >= cfg.cult.minSwitches) {
    add('COMBINATOR', `КОМБІНАТОР ‹${formatPreamble(combo)}›`, `Чекав саме ‹${formatPreamble(combo)}› перед тицем. Це вже не ритуал, це нотний стан.`);
  }

  if (r.itemSwitches >= cfg.twoChairs.minItemSwitches) {
    add('TWO_CHAIRS', 'ДВА СТІЛЬЦІ', `${r.itemSwitches} ${timesWord(r.itemSwitches)} перестрибував між предметами за забіг. Визначся вже.`);
  }

  if (r.betrayals > 0) {
    add('RITUAL_BETRAYAL', 'ЗРАДА РИТУАЛУ', `${r.betrayals} ${timesWord(r.betrayals)} після прогріву підставної основна злетіла в нуль з +5 і вище. ГВЧ бачив твій ритуал. ГВЧ не вразило.`);
  }

  if (r.maxRitualFailRun >= cfg.overheat.minRitualFailRun) {
    add('OVERHEAT', 'ПЕРЕГРІВ', `${r.maxRitualFailRun} ${tapsWord(r.maxRitualFailRun)} з ритуалом поспіль — і всі в мінус. ГВЧ інструкцію не читав.`);
  }

  if (r.switches >= cfg.whisperer.minSwitches && r.ritual.luck !== null && r.ritual.luck >= cfg.whisperer.minRitualLuck) {
    add('RNG_WHISPERER', 'ГВЧ-ШЕПОТУН', `${r.switches} ${tapsWord(r.switches)} з ритуалом і удача ${r.ritual.luck}/100. Він тебе чує.`);
  }

  if (stats.attemptsUsed >= cfg.skeptic.minAttempts && r.decoyAttempts === 0) {
    add('SKEPTIC', 'СКЕПТИК', `${stats.attemptsUsed} спроб — і жодної на підставній. Слухав статистику. Нудно, але чесно.`);
  }

  if (stats.attemptsUsed >= cfg.boughtAndForgot.minAttempts && r.decoyAttempts >= 1 && r.decoyAttempts <= cfg.boughtAndForgot.maxDecoyAttempts) {
    add('BOUGHT_AND_FORGOT', 'КУПИВ І ЗАБУВ', `Підставну торкнув ${r.decoyAttempts} ${timesWord(r.decoyAttempts)} за ${stats.attemptsUsed} ${attemptsWord(stats.attemptsUsed)}. Лежить у сумці для спокою.`);
  }

  if (stats.majorSwaps >= cfg.castlingCarousel.minMajorSwaps) {
    add('CASTLING_CAROUSEL', 'КАРУСЕЛЬ РОКІРОВОК', `Основна й підставна мінялись ролями на +${MAJOR_SWAP_LEVEL} і вище ${stats.majorSwaps} рази. Хто тут взагалі основна?`);
  } else if (stats.majorSwaps >= 1) {
    add('CASTLING', 'РОКІРОВКА', `Підставна перевищила основну на +${MAJOR_SWAP_LEVEL} і вище й зайняла її місце. Стажер очолив відділ.`);
  }

  const promo = promotionAfterSwap(history);
  if (promo) {
    add('PROMOTION', 'ПРОМОУШН', `Колишня підставна після рокіровки встановила новий пік забігу +${promo.level}.`);
  }

  if (r.decoyHitZero >= cfg.sacrificialLamb.minDecoyHitZero) {
    add('SACRIFICIAL_LAMB', 'ЖЕРТОВНЕ ЯГНЯ', `Підставна ${r.decoyHitZero} ${timesWord(r.decoyHitZero)} з'їхала в нуль. Вона нічого не зробила, щоб це заслужити.`);
  }

  if (stats.peakLevel >= cfg.doubleAgent.minPeak && stats.decoy.peakLevel >= cfg.doubleAgent.minPeak) {
    add('DOUBLE_AGENT', 'ПОДВІЙНИЙ АГЕНТ', `Обидва предмети побували на +${cfg.doubleAgent.minPeak} і вище (+${stats.peakLevel} і +${stats.decoy.peakLevel}).`);
  }

  if (r.decoyPaid >= cfg.decoyPricier.minDecoyPaid && r.decoyPaid > r.mainPaid) {
    add('DECOY_PRICIER', 'ПІДСТАВНА ДОРОЖЧА', `${r.decoyPaid} ${stonesWord(r.decoyPaid)} на підставну проти ${r.mainPaid} на основну. Хтось плутає пріоритети.`);
  }

  if (r.decoyAttempts >= cfg.whiteIron.minDecoyAttempts && r.decoyPeak <= cfg.whiteIron.maxDecoyPeak) {
    add('WHITE_IRON', 'БІЛЕ ЗАЛІЗО', `${r.decoyAttempts} спроб на підставній — і пік +${r.decoyPeak}. Біла зброя від коваля, як і задумано.`);
  }

  // Пріоритет для ПЕРВИННОГО титулу — рідкісні/подієві напочатку.
  const priority = [
    'THE_CHOSEN_ONE', 'RNG_GOD', 'STRATOSPHERE', 'THE_DRAGON', 'PROMOTION', 'PHOENIX',
    'ICARUS', 'LOTTERY_TICKET', 'ALCHEMIST', 'FAITH_WORKS', 'SCIENCE_WINS',
    'RNG_WHISPERER', 'CLUTCH_MASTER', 'RITUAL_BETRAYAL', 'HOT_START',
    'PHOTO_FINISH', 'BLOOD_SACRIFICE', 'THE_CURSED', 'DARK_STAR',
    'VICTIM_OF_RNG', 'CASTLING_CAROUSEL', 'CASTLING', 'DOUBLE_BOTTOM',
    'OVERHEAT', 'COMBINATOR', 'CULT', 'SISYPHUS', 'WILD_CARD', 'ALL_IN',
    'GREED', 'COOL_HEAD', 'DOUBLE_AGENT', 'DEMOLITION_EXPERT', 'THE_GAMBLER',
    'THE_UNBREAKABLE', 'BLESSED', 'THE_STREAKER', 'PATIENT_SHAMAN',
    'PLACEBO', 'METRONOME', 'SACRIFICIAL_LAMB', 'SHAMAN', 'COLD_ADEPT',
    'HOT_ADEPT', 'ECLECTIC', 'IMPATIENT', 'TWO_CHAIRS', 'DECOY_PRICIER',
    'WHITE_IRON', 'PACIFIST', 'SKEPTIC', 'BOUGHT_AND_FORGOT', 'THE_GRINDER',
    'SLOW_AND_STEADY', 'EDGE_DANCER', 'MARKETING_VICTIM', 'STONE_COLLECTOR',
    'FATAL_SYMMETRY',
  ];
  const byId = new Map(qualified.map((t) => [t.id, t]));
  const primary = priority.map((id) => byId.get(id)).find((t): t is TitleResult => !!t) ?? null;

  return { qualified, primary };
}

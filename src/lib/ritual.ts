// =========================================================
// Ритуал-аналіз "підставної шмотки" — як саме гравець підставляє другий
// предмет перед вирішальним тицем на основному.
//
// Одиниця аналізу — ПРЕАМБУЛА: для кожної спроби в ролі основної беремо
// рядок результатів ПІДСТАВНОЇ від попередньої спроби основної
// ("--", "---", "+-", "+---+-", порожня). Комбінації не задаються списком —
// сигнатура (найчастіша преамбула) виявляється з даних, тож будь-який
// патерн гравця ("-+-+---", "++-") стане його особистим ритуалом.
//
// Ключова метрика — РИТУАЛЬНА УДАЧА: luck (успіхи / Σp, як у rngProfile)
// тиців ПІСЛЯ ритуалу проти тиців БЕЗ ритуалу. Порівняння чесне, бо p
// враховує рівень; гра нічого не стверджує — показує дві цифри.
//
// Роль береться з AttemptResult.role (зафіксована рушієм на момент
// спроби), тож після рокіровки "основна" — уже інший слот, і це правильно:
// ритуал завжди про той предмет, на який ставиш зараз.
// =========================================================

import type { AttemptResult } from './types';
import { tapsWord } from './plural';

export type RitualSchool = 'cold' | 'hot' | 'mixed';

export interface LuckSample {
  n: number;
  successes: number;
  expected: number;
  /** 0..100 як у rngProfile.luck; null, якщо вибірка порожня. */
  luck: number | null;
}

export interface RitualStats {
  /** Спроб у ролі підставної — "ціна віри" (спалений бюджет із 200). */
  decoyAttempts: number;
  /** Ритуальних тиців: спроб основної з непорожньою преамбулою. */
  switches: number;
  /** Усі преамбули з частотами, найчастіша перша (лише непорожні). */
  preambles: Array<{ pattern: string; count: number }>;
  /** Найчастіша ТОЧНА преамбула (>= 3 повтори), інакше null. */
  signature: string | null;
  signatureCount: number;
  /** % ритуальних тиців, що збігаються з точною сигнатурою (0..100). */
  orthodoxy: number;
  /** СУФІКСНА сигнатура: найдовше закінчення (>= 2 символи), яким
   * завершуються >= 60% преамбул — "чекаю три мінуси" в даних виглядає саме
   * так (префікс щоразу інший, суфікс "---" завжди). null — нема такого. */
  suffixSignature: string | null;
  /** % преамбул із цим суфіксом (0..100). */
  suffixShare: number;
  /** "Холодна серія" — преамбули закінчуються мінусом; "гаряча рука" —
   * плюсом (>= 70% в один бік), інакше mixed. null — ритуалу не було. */
  school: RitualSchool | null;
  avgPreamble: number;
  maxPreamble: number;
  /** Найдовший хвіст мінусів підставної, який гравець дочекався перед тицем. */
  maxColdStreakWaited: number;
  distinctPreambles: number;
  ritual: LuckSample;
  plain: LuckSample;
  /** Тиць після 3+ мінусів підставної → основна злетіла в нуль з 5+. */
  betrayals: number;
  /** Найдовша серія ритуальних тиців поспіль, що провалились. */
  maxRitualFailRun: number;
  /** Найдовша серія строгого чергування предметів (a-b-a-b...). */
  maxAlternation: number;
  /** Скільки разів поспіль міняли предмет між сусідніми спробами. */
  itemSwitches: number;
  /** Підставна (за роллю): поїздок у нуль, пік, платних каменів. */
  decoyHitZero: number;
  decoyPeak: number;
  decoyPaid: number;
  mainPaid: number;
}

/** ЗРАДА РИТУАЛУ: з якої висоти падіння в нуль після 3+ мінусів підставної
 * рахується зрадою (нижче — буденність міража). */
const BETRAYAL_MIN_HEIGHT = 5;

const luckOf = (successes: number, expected: number): number =>
  Math.max(0, Math.min(100, Math.round(50 + (successes / Math.max(0.0001, expected) - 1) * 50)));

function sample(n: number, successes: number, expected: number): LuckSample {
  return { n, successes, expected, luck: n > 0 ? luckOf(successes, expected) : null };
}

/** Преамбула у вигляді "−−+" для показу. */
export const formatPreamble = (pattern: string): string => pattern.replace(/-/g, '−');

export function computeRitualStats(history: AttemptResult[]): RitualStats {
  const counts = new Map<string, number>();
  let pre = '';
  let coldTail = 0; // хвіст мінусів підставної перед поточним тицем
  let decoyAttempts = 0;
  let switches = 0;
  let sumPre = 0;
  let maxPre = 0;
  let maxColdStreakWaited = 0;
  let rN = 0, rS = 0, rE = 0;
  let pN = 0, pS = 0, pE = 0;
  let betrayals = 0;
  let ritualFailRun = 0;
  let maxRitualFailRun = 0;
  let decoyHitZero = 0;
  let decoyPeak = 0;
  let decoyPaid = 0;
  let mainPaid = 0;
  let alternation = 1;
  let maxAlternation = history.length > 0 ? 1 : 0;
  let itemSwitches = 0;
  let coldEndings = 0;
  let hotEndings = 0;

  for (let i = 0; i < history.length; i++) {
    const h = history[i];
    if (i > 0) {
      if (h.item !== history[i - 1].item) {
        itemSwitches++;
        alternation++;
      } else {
        alternation = 1;
      }
      maxAlternation = Math.max(maxAlternation, alternation);
    }

    if (h.role === 'decoy') {
      decoyAttempts++;
      if (h.method !== 'mirage') decoyPaid++;
      decoyPeak = Math.max(decoyPeak, h.after);
      if (!h.success && h.after === 0 && h.before >= 1) decoyHitZero++;
      pre += h.success ? '+' : '-';
      coldTail = h.success ? 0 : coldTail + 1;
      continue;
    }

    // Спроба основної
    if (h.method !== 'mirage') mainPaid++;
    if (pre.length > 0) {
      switches++;
      counts.set(pre, (counts.get(pre) ?? 0) + 1);
      sumPre += pre.length;
      maxPre = Math.max(maxPre, pre.length);
      maxColdStreakWaited = Math.max(maxColdStreakWaited, coldTail);
      if (pre.endsWith('-')) coldEndings++;
      else hotEndings++;
      rN++;
      rE += h.p;
      if (h.success) {
        rS++;
        ritualFailRun = 0;
      } else {
        ritualFailRun++;
        maxRitualFailRun = Math.max(maxRitualFailRun, ritualFailRun);
        if (coldTail >= 3 && h.after === 0 && h.before >= BETRAYAL_MIN_HEIGHT) betrayals++;
      }
    } else {
      pN++;
      pE += h.p;
      if (h.success) pS++;
    }
    pre = '';
    coldTail = 0;
  }

  const preambles = [...counts.entries()]
    .map(([pattern, count]) => ({ pattern, count }))
    .sort((x, y) => y.count - x.count || x.pattern.length - y.pattern.length);
  const top = preambles[0];
  const signature = top && top.count >= 3 ? top.pattern : null;
  const signatureCount = signature ? top.count : 0;

  // Суфіксна сигнатура: від k=2 вгору шукаємо найпоширеніше закінчення
  // довжини k (>= 60% тиців) і ПОДОВЖУЄМО, лише поки частка майже не падає
  // (>= 95% від попередньої). Справжній патерн при подовженні тримає частку
  // сталою (кожна преамбула з "---" також має "--"), а "граничний" символ її
  // роняє: перед хвостом мінусів майже завжди "+" просто тому, що інакше
  // хвіст був би довшим — це не частина ритуалу, а ‹+−−−› — не комбінація.
  let suffixSignature: string | null = null;
  let suffixShare = 0;
  if (switches >= 3) {
    let prevShare = 0;
    for (let k = 2; k <= 6; k++) {
      const sufCounts = new Map<string, number>();
      for (const { pattern, count } of preambles) {
        if (pattern.length < k) continue;
        const suf = pattern.slice(-k);
        sufCounts.set(suf, (sufCounts.get(suf) ?? 0) + count);
      }
      let best: [string, number] | null = null;
      for (const e of sufCounts) if (!best || e[1] > best[1]) best = e;
      const share = best ? best[1] / switches : 0;
      if (!best || share < 0.6 || (prevShare > 0 && share < prevShare * 0.95)) break;
      suffixSignature = best[0];
      suffixShare = Math.round(share * 100);
      prevShare = share;
    }
  }

  let school: RitualSchool | null = null;
  if (switches > 0) {
    if (coldEndings / switches >= 0.7) school = 'cold';
    else if (hotEndings / switches >= 0.7) school = 'hot';
    else school = 'mixed';
  }

  return {
    decoyAttempts,
    switches,
    preambles,
    signature,
    signatureCount,
    orthodoxy: switches > 0 ? Math.round((signatureCount / switches) * 100) : 0,
    suffixSignature,
    suffixShare,
    school,
    avgPreamble: switches > 0 ? sumPre / switches : 0,
    maxPreamble: maxPre,
    maxColdStreakWaited,
    distinctPreambles: preambles.length,
    ritual: sample(rN, rS, rE),
    plain: sample(pN, pS, pE),
    betrayals,
    maxRitualFailRun,
    maxAlternation,
    itemSwitches,
    decoyHitZero,
    decoyPeak,
    decoyPaid,
    mainPaid,
  };
}

export const SCHOOL_LABEL: Record<RitualSchool, string> = {
  cold: 'холодна серія',
  hot: 'гаряча рука',
  mixed: 'еклектика',
};

/** Що показувати як "твій ритуал": суфіксний патерн (якщо він довший за
 * символ і стабільний), інакше точна сигнатура. Уже у форматі ‹−−+›. */
export function displaySignature(r: RitualStats): string | null {
  if (r.suffixSignature && (!r.signature || r.suffixSignature.length >= r.signature.length)) return formatPreamble(r.suffixSignature);
  return r.signature ? formatPreamble(r.signature) : null;
}

/** Один рядок-вердикт про ритуал за цифрами — для фінального екрана.
 * Порівняння — з тицями без ритуалу, а коли їх замало (чистий ритуаліст) —
 * з очікуванням (luck 50). Градація: помітно / трохи / однаково. */
export function ritualVerdict(r: RitualStats): string {
  if (r.switches === 0) return 'Ритуалу не було: тиснув основну без прогріву на підставній. Скептик — або просто нетерплячий.';
  const sig = displaySignature(r);
  const after = sig ? `Після ‹${sig}›` : 'Після ритуалу';
  if (r.ritual.n < 5) {
    return `Замала вибірка: ${r.ritual.n} ${tapsWord(r.ritual.n)} з ритуалом. ГВЧ ще навіть не помітив, що ти чогось від нього хочеш.`;
  }
  const hasControl = r.plain.n >= 5 && r.plain.luck !== null;
  const a = r.ritual.luck ?? 50;
  const b = hasControl ? r.plain.luck! : 50;
  const nums = hasControl ? `(${a} проти ${b} без ритуалу)` : `(${a} при очікуваних 50)`;
  const delta = a - b;
  if (delta >= 20) return `${after} прокало помітно частіше ${nums}. Статистика каже «збіг». Ти кажеш, що статистика не точила.`;
  if (delta >= 8) return `${after} прокало трохи частіше ${nums} — у межах шуму, але віра тримається.`;
  if (delta <= -20) return `${after} прокало гірше, ніж без нього ${nums}. ГВЧ побачив ритуал і зробив навпаки.`;
  if (delta <= -8) return `${after} прокало трохи гірше ${nums} — у межах шуму, але осад лишився.`;
  return `${after} і без нього — одне й те саме ${nums}. Ритуал нічого не міняє, але тиснути з ним приємніше.`;
}

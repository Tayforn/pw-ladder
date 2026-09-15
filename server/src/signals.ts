// =========================================================
// Сигнали детекції автоклікера по забігу. Це підказка адміну, а НЕ бан:
// кожен сигнал окремо буває і в людини. Високий бал підозри лише частіше
// вмикає перевірки присутності й позначає забіг в адмінці.
//
// Усе рахується з СЕРВЕРНИХ інтервалів приходу спроб (годинник браузера
// підробний) і точок кліку. Клікер під наглядом людини проходить перевірки
// присутності й тому дозволений — сигнали ловлять переважно гру без людини.
// =========================================================

import { PAUSE_MS } from './challenges';

export interface AttemptTiming {
  /** Серверний час приходу спроби, мс. */
  atMs: number;
  /** Інтервал від попереднього кліку за годинником браузера (може бути підробленим). */
  clientDt: number | null;
  clickX: number | null;
  clickY: number | null;
  /** Рівень предмета перед спробою. */
  before: number;
}

export interface RunSignals {
  attempts: number;
  /** Медіана серверних інтервалів між спробами (без пауз), мс. */
  medianIntervalMs: number | null;
  /** Коефіцієнт варіації інтервалів: людина 0.3–0.6, клікер із фіксованим кроком <0.05. */
  intervalCv: number | null;
  /** Частка інтервалів, що лягають на кратні 50 мс (±4 мс) — ознака таймера. */
  quantizedShare: number | null;
  /** Частка кліків у радіусі 0.015 від найгустішої точки: AHK б'є в один піксель. */
  pixelSameShare: number | null;
  /** Медіана інтервалу на +10..+12 / на +0..+3: людина вагається вгорі (>1.3), клікеру байдуже (~1). */
  hesitationRatio: number | null;
  /** Найдовша серія спроб поспіль без паузи >30 с — у хвилинах. */
  longestNoPauseMinutes: number;
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** Коефіцієнт варіації (σ/μ) списку інтервалів; null якщо замало точок або μ=0. */
export function intervalCv(intervals: number[]): number | null {
  if (intervals.length < 8) return null;
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  if (mean <= 0) return null;
  const variance = intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length;
  return Math.sqrt(variance) / mean;
}

export function computeSignals(timings: AttemptTiming[]): RunSignals {
  const n = timings.length;
  const intervals: number[] = [];
  const byLevel: { high: number[]; low: number[] } = { high: [], low: [] };
  let noPauseStart = 0;
  let longestNoPauseMs = 0;

  for (let i = 1; i < n; i++) {
    const dt = timings[i].atMs - timings[i - 1].atMs;
    if (dt > PAUSE_MS || dt < 0) {
      noPauseStart = i; // пауза розриває серію
      continue;
    }
    longestNoPauseMs = Math.max(longestNoPauseMs, timings[i].atMs - timings[noPauseStart].atMs);
    intervals.push(dt);
    const before = timings[i].before;
    if (before >= 10) byLevel.high.push(dt);
    else if (before <= 3) byLevel.low.push(dt);
  }

  // Квантування: інтервали на кратних 50 мс (±4 мс).
  let quantized = 0;
  for (const dt of intervals) {
    const rem = dt % 50;
    if (Math.min(rem, 50 - rem) <= 4) quantized++;
  }

  // Той самий піксель: частка кліків у радіусі 0.015 від найгустішої точки.
  const clicks = timings.filter((t) => t.clickX != null && t.clickY != null) as Array<{ clickX: number; clickY: number }>;
  let pixelSameShare: number | null = null;
  if (clicks.length >= 10) {
    let best = 0;
    for (const c of clicks) {
      let near = 0;
      for (const o of clicks) {
        if (Math.hypot(o.clickX - c.clickX, o.clickY - c.clickY) <= 0.015) near++;
      }
      best = Math.max(best, near);
    }
    pixelSameShare = best / clicks.length;
  }

  const hiMed = median(byLevel.high);
  const loMed = median(byLevel.low);
  const hesitationRatio =
    hiMed != null && loMed != null && byLevel.high.length >= 5 && byLevel.low.length >= 5 && loMed > 0
      ? hiMed / loMed
      : null;

  return {
    attempts: n,
    medianIntervalMs: median(intervals),
    intervalCv: intervalCv(intervals),
    quantizedShare: intervals.length >= 8 ? quantized / intervals.length : null,
    pixelSameShare,
    hesitationRatio,
    longestNoPauseMinutes: Math.round((longestNoPauseMs / 60_000) * 10) / 10,
  };
}

/** Бал підозри 0..100 — зважена сума сигналів. Лише орієнтир для адміна й
 * для частоти перевірок присутності, не підстава для автобану. */
export function suspicionScore(s: RunSignals): number {
  let score = 0;
  if (s.intervalCv != null && s.attempts >= 30) {
    if (s.intervalCv < 0.05) score += 45;
    else if (s.intervalCv < 0.1) score += 25;
    else if (s.intervalCv < 0.15) score += 10;
  }
  if (s.quantizedShare != null && s.quantizedShare > 0.6) score += 20;
  if (s.pixelSameShare != null && s.pixelSameShare > 0.9) score += 20;
  if (s.hesitationRatio != null && s.hesitationRatio < 1.05) score += 15;
  if (s.longestNoPauseMinutes > 45) score += 15;
  else if (s.longestNoPauseMinutes > 30) score += 8;
  return Math.max(0, Math.min(100, score));
}

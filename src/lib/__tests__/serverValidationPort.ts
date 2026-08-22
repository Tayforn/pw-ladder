// =========================================================
// TS-порт функції ladder_entries_validate() з міграції 0008 — рядок у
// рядок повторює серверну логіку: ДВА ланцюжки рівнів (item a/b), вибір
// переможця, перерахунок статистики, luck ±1, клемп балів, обчислювані
// поля спецнагород. Використовується property-тестом "чесний забіг НІКОЛИ
// не відхиляється" (serverParity.test.ts): якщо хтось змінить клієнтські
// формули, правило переможця або RATES без синхронного апдейту SQL — цей
// тест впаде першим, ДО того, як чесні гравці почнуть отримувати екран
// "спіймано на гарячому".
// =========================================================

import { RATES } from '../../data/refineRates';
import type { AttemptResult, ItemSlot } from '../types';

export interface SubmittedEntry {
  nickname: string;
  level: number;
  attempts: number;
  points: number;
  best_streak: number;
  worst_streak: number;
  biggest_drop: number;
  biggest_comeback: number;
  success_rate: number;
  peak_attempt: number;
  luck_score: number;
  history: AttemptResult[];
}

interface ItemAgg {
  level: number;
  peak: number;
  peakAttempt: number;
  drop: number;
  afters: number[];
}

/** Кидає Error із тим самим текстом-префіксом, що й SQL-тригер; повертає
 * points ПІСЛЯ серверного клемпа і поля спецнагород, які сервер обчислює з
 * history сам. `existing` — рядок, який оновлюється (undefined = insert).
 * Адмін-байпас тут навмисно не портовано. */
export function validateLikeServer(
  entry: SubmittedEntry,
  pointsPerSuccess: number | null,
  existing?: { level: number; attempts: number },
): { points: number; aggression: number; timesHitZero: number; paidAttempts: number } {
  if (existing) {
    if (!(entry.level > existing.level || (entry.level === existing.level && entry.attempts < existing.attempts))) {
      throw new Error(`ladder_result_not_better: наявний результат (+${existing.level} за ${existing.attempts} спроб) не гірший за надісланий`);
    }
  }

  const n = entry.history.length;
  if (n !== entry.attempts) {
    throw new Error(`ladder_entries: довжина history (${n}) не дорівнює attempts (${entry.attempts})`);
  }
  if (entry.attempts > 200) {
    throw new Error(`ladder_entries: attempts (${entry.attempts}) перевищує ліміт 200`);
  }

  let curStreak = 0;
  let failStreak = 0;
  let successes = 0;
  let calcBestStreak = 0;
  let calcWorstStreak = 0;
  let expectedSuccesses = 0;
  let stakeSum = 0;
  let calcHitZero = 0;
  let calcPaid = 0;
  const items: Record<ItemSlot, ItemAgg> = {
    a: { level: 0, peak: 0, peakAttempt: 0, drop: 0, afters: [] },
    b: { level: 0, peak: 0, peakAttempt: 0, drop: 0, afters: [] },
  };

  for (let idx = 0; idx < n; idx++) {
    const elem = entry.history[idx] as Partial<AttemptResult>;
    const { method, success, before, after } = elem;
    const item = (elem.item ?? 'a') as string;

    if (method == null || success == null || before == null || after == null) {
      throw new Error(`ladder_entries: history[${idx}] має відсутні/невалідні поля`);
    }
    if (!['mirage', 'sky', 'under', 'world'].includes(method)) {
      throw new Error(`ladder_entries: невідомий метод "${method}" у history[${idx}]`);
    }
    if (item !== 'a' && item !== 'b') {
      throw new Error(`ladder_entries: невідомий предмет "${item}" у history[${idx}]`);
    }
    const agg = items[item];
    if (before !== agg.level) {
      throw new Error(`ladder_entries: history[${idx}] before (${before}) не збігається з рівнем предмета ${item} після попередньої спроби (${agg.level})`);
    }

    const expectedP = RATES[method][before + 1];
    if (!expectedP) {
      throw new Error(`ladder_entries: history[${idx}] — немає шансу для ${method}/рівень ${before}+1 (рівень поза межами атаки)`);
    }
    expectedSuccesses += expectedP;

    let expectedAfter: number;
    if (success) expectedAfter = before + 1;
    else if (method === 'world') expectedAfter = before;
    else if (method === 'under') expectedAfter = Math.max(0, before - 1);
    else expectedAfter = 0;
    if (after !== expectedAfter) {
      throw new Error(`ladder_entries: history[${idx}] перехід ${before}→${after} неможливий для ${method} / ${success ? 'успіх' : 'провал'}`);
    }

    if (success) {
      successes++;
      curStreak++;
      failStreak = 0;
      calcBestStreak = Math.max(calcBestStreak, curStreak);
    } else {
      failStreak++;
      curStreak = 0;
      calcWorstStreak = Math.max(calcWorstStreak, failStreak);
      if (after === 0 && before >= 1) calcHitZero++;
    }

    if (method === 'mirage' || method === 'sky') stakeSum += before;
    else if (method === 'under') stakeSum += Math.min(1, before);
    if (method !== 'mirage') calcPaid++;

    if (!success && after < before) agg.drop = Math.max(agg.drop, before - after);
    if (after > agg.peak) {
      agg.peak = after;
      agg.peakAttempt = idx + 1;
    }
    agg.afters.push(after);
    agg.level = after;
  }

  const finalLevel = Math.max(items.a.level, items.b.level);
  if (finalLevel !== entry.level) {
    throw new Error(`ladder_entries: фінальний рівень історії (${finalLevel}) не збігається з level (${entry.level})`);
  }

  const w = items.b.level > items.a.level || (items.b.level === items.a.level && items.b.peak > items.a.peak) ? items.b : items.a;

  let calcBiggestComeback = 0;
  const m = w.afters.length;
  for (let idx = 1; idx <= m; idx++) {
    const beforeI = idx === 1 ? 0 : w.afters[idx - 2];
    const afterI = w.afters[idx - 1];
    if (afterI < beforeI) {
      let laterPeak = afterI;
      for (let j = idx + 1; j <= m; j++) {
        if (w.afters[j - 1] > laterPeak) laterPeak = w.afters[j - 1];
      }
      calcBiggestComeback = Math.max(calcBiggestComeback, laterPeak - afterI);
    }
  }

  if (entry.attempts > 0 && Math.abs(entry.success_rate - successes / entry.attempts) > 0.0001) {
    throw new Error(`ladder_entries: success_rate (${entry.success_rate}) не відповідає історії (успіхів ${successes} із ${entry.attempts})`);
  }
  if (entry.attempts === 0 && entry.success_rate !== 0) {
    throw new Error('ladder_entries: success_rate має бути 0 при attempts=0');
  }

  if (
    entry.best_streak !== calcBestStreak || entry.worst_streak !== calcWorstStreak ||
    entry.biggest_drop !== w.drop || entry.biggest_comeback !== calcBiggestComeback ||
    entry.peak_attempt !== w.peakAttempt
  ) {
    throw new Error('ladder_entries: подана статистика (стріки/дроп/камбек/пік) не відповідає наданій історії');
  }

  let calcLuck = Math.round(50 + (successes / Math.max(expectedSuccesses, 0.0001) - 1) * 50);
  calcLuck = Math.max(0, Math.min(100, calcLuck));
  if (Math.abs(entry.luck_score - calcLuck) > 1) {
    throw new Error(`ladder_entries: luck_score (${entry.luck_score}) не збігається з очікуваним (${calcLuck}) на основі RATES`);
  }

  let points = entry.points;
  if (pointsPerSuccess !== null) {
    points = Math.min(points, successes * pointsPerSuccess);
  }

  const aggression = Math.max(0, Math.min(100, Math.round((stakeSum / Math.max(n, 1) / 1.5) * 100)));
  return { points, aggression, timesHitZero: calcHitZero, paidAttempts: calcPaid };
}

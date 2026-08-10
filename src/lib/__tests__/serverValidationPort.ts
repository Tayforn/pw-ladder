// =========================================================
// TS-порт функції ladder_entries_validate() з міграції 0006 — рядок у
// рядок повторює серверну логіку (перевірка переходів, перерахунок
// статистики, luck ±1, клемп балів). Використовується property-тестом
// "чесний забіг НІКОЛИ не відхиляється" (serverParity.test.ts): якщо
// хтось змінить клієнтські формули або RATES без синхронного апдейту
// SQL — цей тест впаде першим, ДО того, як чесні гравці почнуть
// отримувати екран "спіймано на гарячому".
// =========================================================

import { RATES } from '../../data/refineRates';
import type { AttemptResult } from '../types';

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

/** Кидає Error із тим самим текстом-префіксом, що й SQL-тригер; повертає
 * points ПІСЛЯ серверного клемпа і поля спецнагород, які сервер (0007)
 * обчислює з history сам. `existing` — рядок, який оновлюється
 * (undefined = insert). Адмін-байпас тут навмисно не портовано — тести
 * ганяють шлях звичайного гравця. */
export function validateLikeServer(
  entry: SubmittedEntry,
  pointsPerSuccess: number | null,
  existing?: { level: number; attempts: number },
): { points: number; aggression: number; timesHitZero: number; paidAttempts: number } {
  // Не-адмін оновлює запис лише строго кращим результатом.
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

  let curLevel = 0;
  let curStreak = 0;
  let failStreak = 0;
  let successes = 0;
  let calcBestStreak = 0;
  let calcWorstStreak = 0;
  let calcBiggestDrop = 0;
  let calcPeakLevel = 0;
  let calcPeakAttempt = 0;
  let expectedSuccesses = 0;
  let stakeSum = 0;
  let calcHitZero = 0;
  let calcPaid = 0;
  const afters: number[] = [];

  for (let idx = 0; idx < n; idx++) {
    const elem = entry.history[idx];
    const { method, success, before, after } = elem;

    if (method == null || success == null || before == null || after == null) {
      throw new Error(`ladder_entries: history[${idx}] має відсутні/невалідні поля`);
    }
    if (!['mirage', 'sky', 'under', 'world'].includes(method)) {
      throw new Error(`ladder_entries: невідомий метод "${method}" у history[${idx}]`);
    }
    if (before !== curLevel) {
      throw new Error(`ladder_entries: history[${idx}] before (${before}) не збігається з рівнем після попередньої спроби (${curLevel})`);
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
      if (after < before) calcBiggestDrop = Math.max(calcBiggestDrop, before - after);
      if (after === 0 && before >= 1) calcHitZero++;
    }

    // Дзеркало 0007: ставка спроби + платні камені.
    if (method === 'mirage' || method === 'sky') stakeSum += before;
    else if (method === 'under') stakeSum += Math.min(1, before);
    if (method !== 'mirage') calcPaid++;

    if (after > calcPeakLevel) {
      calcPeakLevel = after;
      calcPeakAttempt = idx + 1;
    }

    afters.push(after);
    curLevel = after;
  }

  if (curLevel !== entry.level) {
    throw new Error(`ladder_entries: фінальний рівень історії (${curLevel}) не збігається з level (${entry.level})`);
  }

  // Прохід 2: biggestComeback — 1-based індекси, як у SQL.
  let calcBiggestComeback = 0;
  for (let idx = 1; idx <= n; idx++) {
    const beforeI = idx === 1 ? 0 : afters[idx - 2];
    const afterI = afters[idx - 1];
    if (afterI < beforeI) {
      let laterPeak = afterI;
      for (let j = idx + 1; j <= n; j++) {
        if (afters[j - 1] > laterPeak) laterPeak = afters[j - 1];
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
    entry.biggest_drop !== calcBiggestDrop || entry.biggest_comeback !== calcBiggestComeback ||
    entry.peak_attempt !== calcPeakAttempt
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

  // 0007: поля спецнагород сервер обчислює і перезаписує сам.
  const aggression = Math.max(0, Math.min(100, Math.round((stakeSum / Math.max(n, 1) / 1.5) * 100)));
  return { points, aggression, timesHitZero: calcHitZero, paidAttempts: calcPaid };
}

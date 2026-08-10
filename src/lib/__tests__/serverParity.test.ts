// =========================================================
// Парність клієнт ↔ сервер — найдорожча потенційна помилка проєкту:
// розсинхрон RATES/формул між TS і SQL означає, що ВСІ чесні сабміти
// відхиляються з обвинуваченням у читерстві.
//
// 1) RATES у src/data/refineRates.ts == таблиця refine_rates у 0005 SQL
//    (парсимо міграцію текстово).
// 2) Property-тест: сотні чесних забігів справжнім рушієм (applyAttempt)
//    проходять TS-порт серверного тригера (0006) БЕЗ відхилень і БЕЗ
//    клемпа балів.
// 3) Підроблені сабміти (підміна рівня/спроб/статистики/luck) — відхиляються.
// =========================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RATES, type StoneMethod } from '../../data/refineRates';
import { computeSessionStats } from '../sessionStats';
import { computeRngProfile } from '../rngProfile';
import { validateLikeServer, type SubmittedEntry } from './serverValidationPort';
import { lcg, simulateRun, STRATEGIES, TEST_SETTINGS, seqHistory, rep } from './helpers';
import type { LadderGameState } from '../ladderEngine';

describe('RATES: TS ↔ SQL (0005) парність', () => {
  it('усі 48 значень збігаються', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase', 'migrations', '0005_history_validation.sql'), 'utf8');
    const re = /\('(mirage|sky|under|world)',\s*(\d+),\s*([\d.]+)\)/g;
    const fromSql = new Map<string, number>();
    for (const m of sql.matchAll(re)) {
      fromSql.set(`${m[1]}/${m[2]}`, Number(m[3]));
    }
    expect(fromSql.size).toBe(48);
    for (const method of ['mirage', 'sky', 'under', 'world'] as StoneMethod[]) {
      for (let level = 1; level <= 12; level++) {
        expect(fromSql.get(`${method}/${level}`), `${method} рівень ${level}`).toBe(RATES[method][level]);
      }
    }
  });
});

function toSubmission(state: LadderGameState, nickname = 'tester'): SubmittedEntry {
  const stats = computeSessionStats(state.history);
  const profile = computeRngProfile(state.history, stats);
  return {
    nickname,
    level: state.level,
    attempts: state.attempts,
    points: state.points,
    best_streak: stats.longestSuccessStreak,
    worst_streak: stats.longestFailStreak,
    biggest_drop: stats.biggestDrop,
    biggest_comeback: stats.biggestComeback,
    success_rate: stats.successRate,
    peak_attempt: stats.peakAttempt,
    luck_score: profile.luck,
    history: state.history,
  };
}

describe('чесний забіг НІКОЛИ не відхиляється сервером', () => {
  const names = Object.keys(STRATEGIES);
  for (const name of names) {
    it(`стратегія ${name}: 150 сідованих забігів проходять валідацію`, () => {
      for (let seed = 1; seed <= 150; seed++) {
        const roll = lcg(seed * 7919 + names.indexOf(name));
        const state = simulateRun(STRATEGIES[name], roll);
        const entry = toSubmission(state);
        const server = validateLikeServer(entry, TEST_SETTINGS.pointsPerSuccess);
        // Клемп балів не повинен чіпати чесний результат
        expect(server.points, `seed ${seed}`).toBe(state.points);
        // Поля спецнагород (0007) сервер рахує сам — вони мусять збігатися
        // з клієнтськими формулами (rngProfile/sessionStats), інакше
        // фінальний екран і лідерборд показуватимуть різні числа.
        const stats = computeSessionStats(state.history);
        const profile = computeRngProfile(state.history, stats);
        expect(Math.abs(server.aggression - profile.aggression), `seed ${seed} aggression`).toBeLessThanOrEqual(1);
        expect(server.timesHitZero, `seed ${seed} timesHitZero`).toBe(stats.timesHitZero);
        expect(server.paidAttempts, `seed ${seed} paidAttempts`).toBe(stats.paidAttempts);
      }
    });
  }

  it('порожній забіг (0 спроб) теж валідний', () => {
    const entry = toSubmission({ level: 0, points: 0, attempts: 0, history: [] });
    expect(() => validateLikeServer(entry, 10)).not.toThrow();
  });
});

describe('підроблені сабміти відхиляються', () => {
  const honest = () => toSubmission(simulateRun(STRATEGIES.mirageOnly, lcg(42)));

  it('завищений level (без правки історії)', () => {
    const e = { ...honest(), level: 12 };
    expect(() => validateLikeServer(e, 10)).toThrow(/фінальний рівень/);
  });

  it('занижені attempts (обрізана заявка при повній історії)', () => {
    const e = honest();
    e.attempts = Math.max(0, e.attempts - 5);
    expect(() => validateLikeServer(e, 10)).toThrow(/довжина history/);
  });

  it('фейковий luck_score', () => {
    const e = { ...honest(), luck_score: 100 };
    expect(() => validateLikeServer(e, 10)).toThrow(/luck_score/);
  });

  it('фейковий best_streak', () => {
    const e = honest();
    e.best_streak = e.best_streak + 3;
    expect(() => validateLikeServer(e, 10)).toThrow(/статистика/);
  });

  it('неможливий перехід рівня в історії', () => {
    const h = seqHistory([...rep('mirage', true, 3)]);
    // Підробка: третій успіх "перестрибнув" на 6
    const hacked = h.map((x, i) => (i === 2 ? { ...x, after: 6 } : x));
    const state: LadderGameState = { level: 6, points: 30, attempts: 3, history: hacked };
    const stats = computeSessionStats(hacked);
    const profile = computeRngProfile(hacked, stats);
    const e: SubmittedEntry = {
      nickname: 'hacker', level: 6, attempts: 3, points: 30,
      best_streak: stats.longestSuccessStreak, worst_streak: stats.longestFailStreak,
      biggest_drop: stats.biggestDrop, biggest_comeback: stats.biggestComeback,
      success_rate: stats.successRate, peak_attempt: stats.peakAttempt,
      luck_score: profile.luck, history: state.history,
    };
    expect(() => validateLikeServer(e, 10)).toThrow(/неможливий/);
  });

  it('накручені бали клемпляться до successes * pps', () => {
    const e = { ...honest(), points: 999999 };
    const successes = e.history.filter((h) => h.success).length;
    const { points } = validateLikeServer(e, 10);
    expect(points).toBe(successes * 10);
  });

  it('не-кращий UPDATE відхиляється з ladder_result_not_better', () => {
    const e = honest();
    expect(() => validateLikeServer(e, 10, { level: e.level + 1, attempts: 1 }))
      .toThrow(/ladder_result_not_better/);
    // Рівний результат — теж не кращий (захист від перейменування чужого запису)
    expect(() => validateLikeServer(e, 10, { level: e.level, attempts: e.attempts }))
      .toThrow(/ladder_result_not_better/);
    // Строго кращий — проходить
    expect(() => validateLikeServer(e, 10, { level: Math.max(0, e.level - 1), attempts: e.attempts + 1 }))
      .not.toThrow();
  });
});

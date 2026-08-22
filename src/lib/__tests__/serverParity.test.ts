// =========================================================
// Парність клієнт ↔ сервер — найдорожча потенційна помилка проєкту:
// розсинхрон RATES/формул/правила переможця між TS і SQL означає, що ВСІ
// чесні сабміти відхиляються з обвинуваченням у читерстві.
//
// 1) RATES у src/data/refineRates.ts == таблиця refine_rates у 0005 SQL.
// 2) Property-тест: сотні чесних забігів справжнім рушієм (applyAttempt,
//    у т.ч. ритуальні стратегії з двома предметами) проходять TS-порт
//    серверного тригера (0008) БЕЗ відхилень і БЕЗ клемпа балів, а
//    обчислювані сервером поля збігаються з клієнтськими.
// 3) Підроблені сабміти відхиляються.
// =========================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RATES, type StoneMethod } from '../../data/refineRates';
import { computeSessionStats } from '../sessionStats';
import { computeRngProfile } from '../rngProfile';
import { validateLikeServer, type SubmittedEntry } from './serverValidationPort';
import { lcg, simulateRun, STRATEGIES, TEST_SETTINGS, seqHistory, rep } from './helpers';
import { ladderLevel, type LadderGameState } from '../ladderEngine';
import type { AttemptResult } from '../types';

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

function submissionFor(history: AttemptResult[], level: number, points: number, nickname = 'tester'): SubmittedEntry {
  const stats = computeSessionStats(history);
  const profile = computeRngProfile(history, stats);
  return {
    nickname,
    level,
    attempts: history.length,
    points,
    best_streak: stats.longestSuccessStreak,
    worst_streak: stats.longestFailStreak,
    biggest_drop: stats.biggestDrop,
    biggest_comeback: stats.biggestComeback,
    success_rate: stats.successRate,
    peak_attempt: stats.peakAttempt,
    luck_score: profile.luck,
    history,
  };
}
const toSubmission = (state: LadderGameState) => submissionFor(state.history, ladderLevel(state), state.points);

describe('чесний забіг НІКОЛИ не відхиляється сервером', () => {
  const names = Object.keys(STRATEGIES);
  for (const name of names) {
    it(`стратегія ${name}: 120 сідованих забігів проходять валідацію`, () => {
      for (let seed = 1; seed <= 120; seed++) {
        const roll = lcg(seed * 7919 + names.indexOf(name));
        const state = simulateRun(STRATEGIES[name], roll);
        const entry = toSubmission(state);
        const server = validateLikeServer(entry, TEST_SETTINGS.pointsPerSuccess);
        // Клемп балів не повинен чіпати чесний результат
        expect(server.points, `seed ${seed}`).toBe(state.points);
        // Поля спецнагород сервер рахує сам — мусять збігатися з клієнтом
        const stats = computeSessionStats(state.history);
        const profile = computeRngProfile(state.history, stats);
        expect(Math.abs(server.aggression - profile.aggression), `seed ${seed} aggression`).toBeLessThanOrEqual(1);
        expect(server.timesHitZero, `seed ${seed} timesHitZero`).toBe(stats.timesHitZero);
        expect(server.paidAttempts, `seed ${seed} paidAttempts`).toBe(stats.paidAttempts);
      }
    });
  }

  it('порожній забіг (0 спроб) теж валідний', () => {
    expect(() => validateLikeServer(submissionFor([], 0, 0), 10)).not.toThrow();
  });

  it('стара історія без item/role (до 0008) валідна як один предмет', () => {
    const h = seqHistory([...rep('mirage', true, 3), ['mirage', false]]);
    const legacy = h.map(({ item: _i, role: _r, ...rest }) => rest) as unknown as AttemptResult[];
    // Клієнтські формули рахуються на нормалізованій історії (item='a'),
    // сервер — на сирій (item відсутній → 'a'): мусять зійтись.
    const entry = submissionFor(h, 0, 30);
    entry.history = legacy;
    expect(() => validateLikeServer(entry, 10)).not.toThrow();
  });

  it('перемежована історія двох предметів: рівень = max, стати по переможцю', () => {
    const h = seqHistory([
      ['mirage', true, 'a'], ['mirage', false, 'b'], ['mirage', true, 'a'], ['mirage', true, 'b'],
      ['mirage', true, 'b'], ['mirage', true, 'b'], // b = 3 > a = 2 → переможець b
      ['mirage', false, 'a'],
    ]);
    const entry = submissionFor(h, 3, 40);
    expect(() => validateLikeServer(entry, 10)).not.toThrow();
    // level не max → відхилено
    expect(() => validateLikeServer(submissionFor(h, 2, 40), 10)).toThrow(/фінальний рівень/);
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
    const hacked = h.map((x, i) => (i === 2 ? { ...x, after: 6 } : x));
    const e = submissionFor(hacked, 6, 30);
    expect(() => validateLikeServer(e, 10)).toThrow(/неможливий/);
  });

  it('ланцюжок іншого предмета: підставна "пам\'ятає" рівень основної', () => {
    const h = seqHistory([['mirage', true, 'a'], ['mirage', true, 'a']]);
    // Спроба на b із before=2 (рівень a) — чужий ланцюжок
    const forged = [...h, { ...h[1], item: 'b' as const, before: 2, after: 3 }];
    const e = submissionFor(forged, 3, 30);
    expect(() => validateLikeServer(e, 10)).toThrow(/рівнем предмета b/);
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
    expect(() => validateLikeServer(e, 10, { level: e.level, attempts: e.attempts }))
      .toThrow(/ladder_result_not_better/);
    expect(() => validateLikeServer(e, 10, { level: Math.max(0, e.level - 1), attempts: e.attempts + 1 }))
      .not.toThrow();
  });
});

// =========================================================
// Парність клієнт ↔ сервер — найдорожча потенційна помилка проєкту:
// розсинхрон RATES/формул/правила переможця між TS і SQL означає, що ВСІ
// чесні сабміти відхиляються з обвинуваченням у читерстві.
//
// 1) RATES у src/data/refineRates.ts == таблиця refine_rates у 0005 SQL.
// 2) Property-тест: сотні чесних забігів справжнім рушієм (applyAttempt з
//    лімітами ресурсів, у т.ч. ритуальні стратегії) проходять TS-порт
//    серверного тригера (0009) БЕЗ відхилень, а обчислювані сервером поля
//    збігаються з клієнтськими.
// 3) Підроблені сабміти (у т.ч. перевитрата ресурсів понад ×1.5)
//    відхиляються.
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

function submissionFor(history: AttemptResult[], level: number, nickname = 'tester'): SubmittedEntry {
  const stats = computeSessionStats(history);
  const profile = computeRngProfile(history, stats);
  return {
    nickname,
    level,
    attempts: history.length,
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
const toSubmission = (state: LadderGameState) => submissionFor(state.history, ladderLevel(state));

describe('чесний забіг НІКОЛИ не відхиляється сервером', () => {
  const names = Object.keys(STRATEGIES);
  for (const name of names) {
    it(`стратегія ${name}: 120 сідованих забігів проходять валідацію`, () => {
      for (let seed = 1; seed <= 120; seed++) {
        const roll = lcg(seed * 7919 + names.indexOf(name));
        const state = simulateRun(STRATEGIES[name], roll);
        const entry = toSubmission(state);
        const server = validateLikeServer(entry, TEST_SETTINGS);
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
    expect(() => validateLikeServer(submissionFor([], 0), TEST_SETTINGS)).not.toThrow();
  });

  it('стара історія без item/role (до 0008) валідна як один предмет', () => {
    const h = seqHistory([...rep('mirage', true, 3), ['mirage', false]]);
    const legacy = h.map(({ item: _i, role: _r, ...rest }) => rest) as unknown as AttemptResult[];
    const entry = submissionFor(h, 0);
    entry.history = legacy;
    expect(() => validateLikeServer(entry, TEST_SETTINGS)).not.toThrow();
  });

  it('перемежована історія кількох предметів: рівень = max, стати по переможцю', () => {
    const h = seqHistory([
      ['mirage', true, 'a'], ['mirage', false, 'b'], ['mirage', true, 'a'], ['mirage', true, 'b'],
      ['mirage', true, 'b'], ['mirage', true, 'b'], // b = 3 > a = 2 → переможець b
      ['mirage', false, 'a'],
    ]);
    expect(() => validateLikeServer(submissionFor(h, 3), TEST_SETTINGS)).not.toThrow();
    expect(() => validateLikeServer(submissionFor(h, 2), TEST_SETTINGS)).toThrow(/фінальний рівень/);
  });
});

describe('підроблені сабміти відхиляються', () => {
  const honest = () => toSubmission(simulateRun(STRATEGIES.mirageOnly, lcg(42)));

  it('завищений level (без правки історії)', () => {
    const e = { ...honest(), level: 12 };
    expect(() => validateLikeServer(e, TEST_SETTINGS)).toThrow(/фінальний рівень/);
  });

  it('занижені attempts (обрізана заявка при повній історії)', () => {
    const e = honest();
    e.attempts = Math.max(0, e.attempts - 5);
    expect(() => validateLikeServer(e, TEST_SETTINGS)).toThrow(/довжина history/);
  });

  it('фейковий luck_score', () => {
    const e = { ...honest(), luck_score: 100 };
    expect(() => validateLikeServer(e, TEST_SETTINGS)).toThrow(/luck_score/);
  });

  it('фейковий best_streak', () => {
    const e = honest();
    e.best_streak = e.best_streak + 3;
    expect(() => validateLikeServer(e, TEST_SETTINGS)).toThrow(/статистика/);
  });

  it('неможливий перехід рівня в історії', () => {
    const h = seqHistory([...rep('mirage', true, 3)]);
    const hacked = h.map((x, i) => (i === 2 ? { ...x, after: 6 } : x));
    expect(() => validateLikeServer(submissionFor(hacked, 6), TEST_SETTINGS)).toThrow(/неможливий/);
  });

  it("ланцюжок іншого предмета: підставна 'пам'ятає' рівень основної", () => {
    const h = seqHistory([['mirage', true, 'a'], ['mirage', true, 'a']]);
    const forged = [...h, { ...h[1], item: 'b' as const, before: 2, after: 3 }];
    expect(() => validateLikeServer(submissionFor(forged, 3), TEST_SETTINGS)).toThrow(/рівнем предмета b/);
  });

  it('перевитрата ресурсів понад ×1.5 відхиляється, у межах запасу — ні', () => {
    // 23 небески при ліміті 15 (кап 23) — проходить; 24 — вже ні.
    const okSteps = [...rep('mirage', true, 1), ...rep('sky', false, 23)];
    const ok = seqHistory(okSteps);
    expect(() => validateLikeServer(submissionFor(ok, 0), TEST_SETTINGS)).not.toThrow();
    const over = seqHistory([...okSteps, ['sky', false]]);
    expect(() => validateLikeServer(submissionFor(over, 0), TEST_SETTINGS)).toThrow(/небесок/);
    // Понад 1.5× міражів (300+ спроб при ліміті 200)
    const grind: typeof okSteps = [];
    for (let i = 0; i < 151; i++) grind.push(['mirage', true, 'a'], ['mirage', false, 'a']);
    expect(() => validateLikeServer(submissionFor(seqHistory(grind), 0), TEST_SETTINGS)).toThrow(/міражів/);
  });

  it('предметів понад ліміт (decoyCount=1 → кап 3 слоти)', () => {
    const h = seqHistory([
      ['mirage', false, 'a'], ['mirage', false, 'b'], ['mirage', false, 'c'],
      ['mirage', false, 'd'],
    ]);
    expect(() => validateLikeServer(submissionFor(h, 0), TEST_SETTINGS)).toThrow(/предметів/);
  });

  it('не-кращий UPDATE відхиляється з ladder_result_not_better', () => {
    const e = honest();
    expect(() => validateLikeServer(e, TEST_SETTINGS, { level: e.level + 1, attempts: 1 }))
      .toThrow(/ladder_result_not_better/);
    expect(() => validateLikeServer(e, TEST_SETTINGS, { level: e.level, attempts: e.attempts }))
      .toThrow(/ladder_result_not_better/);
    expect(() => validateLikeServer(e, TEST_SETTINGS, { level: Math.max(0, e.level - 1), attempts: e.attempts + 1 }))
      .not.toThrow();
  });
});

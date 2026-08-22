import { describe, it, expect } from 'vitest';
import { computeSessionStats, longestSameLevelFailStreak, longestStagnation } from '../sessionStats';
import { seqHistory, rep } from './helpers';

describe('computeSessionStats', () => {
  it('порожня історія — все по нулях', () => {
    const s = computeSessionStats([]);
    expect(s.attemptsUsed).toBe(0);
    expect(s.finalLevel).toBe(0);
    expect(s.peakLevel).toBe(0);
    expect(s.peakAttempt).toBe(0);
    expect(s.successRate).toBe(0);
    expect(s.favoriteLevel).toEqual({ level: 0, attempts: 0 });
    expect(s.longestStagnation.length).toBe(0);
  });

  it('рахує стріки, пік і % успіху', () => {
    // 0→1→2→3 (3 успіхи), провал mirage (3→0), 0→1, провал (1→0)
    const h = seqHistory([
      ['mirage', true], ['mirage', true], ['mirage', true],
      ['mirage', false],
      ['mirage', true],
      ['mirage', false],
    ]);
    const s = computeSessionStats(h);
    expect(s.attemptsUsed).toBe(6);
    expect(s.totalSuccesses).toBe(4);
    expect(s.totalFails).toBe(2);
    expect(s.longestSuccessStreak).toBe(3);
    expect(s.longestFailStreak).toBe(1);
    expect(s.peakLevel).toBe(3);
    expect(s.peakAttempt).toBe(3);
    expect(s.finalLevel).toBe(0);
    expect(s.successRate).toBeCloseTo(4 / 6);
  });

  it('падіння: biggestDrop / totalLevelsLost / timesHitZero / totalDowngrades', () => {
    // Підйом до 4, скид mirage у 0 (−4), підйом до 2, підземка-провал (−1)
    const h = seqHistory([
      ...rep('mirage', true, 4),
      ['mirage', false],           // 4→0: drop 4, у нуль
      ...rep('mirage', true, 2),
      ['under', false],            // 2→1: drop 1
    ]);
    const s = computeSessionStats(h);
    expect(s.biggestDrop).toBe(4);
    expect(s.totalLevelsLost).toBe(5);
    expect(s.timesHitZero).toBe(1);
    expect(s.totalDowngrades).toBe(2);
  });

  it('провал world не є downgrade і не псує стріки рівня', () => {
    const h = seqHistory([
      ['mirage', true],
      ['world', false], ['world', false], // рівень стоїть на 1
    ]);
    const s = computeSessionStats(h);
    expect(s.totalDowngrades).toBe(0);
    expect(s.totalLevelsLost).toBe(0);
    expect(s.finalLevel).toBe(1);
  });

  it('biggestComeback: від дна після падіння до пізнішого піку', () => {
    // До 3, скид у 0, потім до 5: камбек = 5
    const h = seqHistory([
      ...rep('mirage', true, 3),
      ['mirage', false],
      ...rep('mirage', true, 5),
    ]);
    const s = computeSessionStats(h);
    expect(s.biggestComeback).toBe(5);
  });

  it('methodCounts / paidAttempts / favoriteLevel', () => {
    const h = seqHistory([
      ['mirage', true],   // before 0
      ['sky', true],      // before 1
      ['world', false],   // before 2
      ['world', false],   // before 2
      ['under', false],   // before 2 → 1
    ]);
    const s = computeSessionStats(h);
    expect(s.methodCounts).toEqual({ mirage: 1, sky: 1, under: 1, world: 2 });
    expect(s.methodSuccesses).toEqual({ mirage: 1, sky: 1, under: 0, world: 0 });
    expect(s.paidAttempts).toBe(4);
    expect(s.favoriteLevel).toEqual({ level: 2, attempts: 3 });
  });
});

describe('два предмети', () => {
  it('переможець — вищий фінальний рівень; статистика по рівнях — по ньому', () => {
    const h = seqHistory([
      ...rep('mirage', true, 2, 'a'), ['mirage', false, 'a'], // a: пік 2, впав у 0
      ...rep('mirage', true, 3, 'b'),                         // b: 3 → переможець
    ]);
    const s = computeSessionStats(h);
    expect(s.winnerItem).toBe('b');
    expect(s.finalLevel).toBe(3);
    expect(s.peakLevel).toBe(3);
    expect(s.peakAttempt).toBe(6); // глобальний номер спроби
    expect(s.biggestDrop).toBe(0); // падіння було на a, не на переможці
    expect(s.timesHitZero).toBe(1); // а поїздки в нуль — по всіх
    expect(s.attemptsUsed).toBe(6);
    expect(s.decoy.attempts).toBe(3);
    expect(s.decoy.peakLevel).toBe(2);
    expect(s.decoy.timesHitZero).toBe(1);
    expect(s.roleSwaps).toBe(1);
    expect(s.majorSwaps).toBe(0); // рокіровка сталась, коли b=1 > a=0 — шум, не подія
  });

  it('рівність фіналів: переможець — вищий пік, далі a', () => {
    const tie = seqHistory([['mirage', true, 'a'], ['mirage', true, 'b']]);
    expect(computeSessionStats(tie).winnerItem).toBe('a');
    const peakB = seqHistory([['mirage', true, 'a'], ...rep('mirage', true, 2, 'b'), ['under', false, 'b']]); // b: пік 2, фінал 1
    expect(computeSessionStats(peakB).winnerItem).toBe('b');
  });
});

describe('longestSameLevelFailStreak', () => {
  it('рахує лише ПОСПІЛЬ на одному рівні', () => {
    // 3 провали world на 1, успіх, 2 провали world на 2
    const h = seqHistory([
      ['mirage', true],
      ['world', false], ['world', false], ['world', false],
      ['mirage', true],
      ['world', false], ['world', false],
    ]);
    expect(longestSameLevelFailStreak(h)).toEqual({ length: 3, level: 1 });
  });

  it('провали на різних рівнях НЕ зливаються в один хвіст', () => {
    // fail на 2 (mirage → 0), fail на 0... рівні різні
    const h = seqHistory([
      ...rep('mirage', true, 2),
      ['mirage', false], // before 2
      ['mirage', false], // before 0
      ['mirage', false], // before 0
    ]);
    expect(longestSameLevelFailStreak(h)).toEqual({ length: 2, level: 0 });
  });
});

describe('longestStagnation', () => {
  it('вікно, де рівень тримається в межах ±1 від старту', () => {
    const h = seqHistory([
      ['mirage', true],  // 0→1
      ['world', false], ['world', false], ['world', false], // на 1
      ['mirage', true],  // 1→2 (в межах +1 від 1)
      ['mirage', true],  // 2→3 — вихід за межу для вікна від рівня 1
    ]);
    // Найдовше вікно: спроби №1..4 (рівень 0→1, далі стоїть на 1) або
    // №2..5 (1 → ... → 2) — обидва по 4; спроба №6 (after 3) виходить за ±1.
    const s = longestStagnation(h);
    expect(s.length).toBe(4);
  });
});

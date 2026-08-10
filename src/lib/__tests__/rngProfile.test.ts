import { describe, it, expect } from 'vitest';
import { computeSessionStats } from '../sessionStats';
import { computeRngProfile, stakeFor } from '../rngProfile';
import { seqHistory, rep, type Step } from './helpers';

const profileOf = (steps: Step[]) => {
  const h = seqHistory(steps);
  return computeRngProfile(h, computeSessionStats(h));
};

describe('stakeFor — ставка спроби', () => {
  it('mirage/sky ставлять весь рівень, under — 1, world — нічого', () => {
    expect(stakeFor({ method: 'mirage', before: 6 })).toBe(6);
    expect(stakeFor({ method: 'sky', before: 6 })).toBe(6);
    expect(stakeFor({ method: 'under', before: 6 })).toBe(1);
    expect(stakeFor({ method: 'under', before: 0 })).toBe(0);
    expect(stakeFor({ method: 'world', before: 6 })).toBe(0);
    expect(stakeFor({ method: 'mirage', before: 0 })).toBe(0);
  });
});

describe('aggression — міряє вибір ризику, а не висоту', () => {
  it('world-кемпер на високому рівні має НИЗЬКУ агресію', () => {
    // Колишня формула давала б тут максимум (усі спроби на 5+)
    const p = profileOf([
      ...rep('mirage', true, 5),
      ...rep('world', false, 20),
    ]);
    expect(p.aggression).toBeLessThan(30);
  });

  it('міраж-пила по верхах дає ВИСОКУ агресію', () => {
    const steps: Step[] = [];
    for (let i = 0; i < 6; i++) steps.push(...rep('mirage', true, 4), ['mirage', false]);
    const p = profileOf(steps);
    expect(p.aggression).toBeGreaterThanOrEqual(60);
  });

  it('порожня історія — нуль без ділення на 0', () => {
    const p = computeRngProfile([], computeSessionStats([]));
    expect(p.aggression).toBe(0);
    expect(p.luck).toBe(0); // 0 успіхів / 0.0001 очікуваних → ratio 0 → 0
  });
});

describe('luck / expectedSuccesses', () => {
  it('luck рахується від суми p, а не від % успіху', () => {
    // world 0→1 (p=1.0), mirage-провал на 1 (p=0.3) ×2:
    // очікувано 1+0.3+1+0.3 = 2.6; успіхів 2 → ratio 0.769 → luck 38
    const p = profileOf([['world', true], ['mirage', false], ['world', true], ['mirage', false]]);
    expect(p.expectedSuccesses).toBeCloseTo(2.6);
    expect(p.luck).toBe(38);
  });

  it('luck обрізається в 0..100', () => {
    const lucky = profileOf([
      ...rep('mirage', true, 2), ['world', true], ['mirage', false],
      ...rep('mirage', true, 2), ['world', true], ['mirage', false],
    ]);
    expect(lucky.luck).toBeLessThanOrEqual(100);
    expect(lucky.luck).toBeGreaterThanOrEqual(0);
  });
});

describe('archetype — порядок перевірок', () => {
  it('агресивна гра дає Gambler, а не Grinder, навіть на довгому забігу', () => {
    const steps: Step[] = [];
    for (let i = 0; i < 36; i++) steps.push(...rep('mirage', true, 4), ['mirage', false]);
    const p = profileOf(steps); // 180 спроб, агресія 100
    expect(p.archetype).toBe('Gambler');
  });

  it('RNG God: пік 8+ швидко', () => {
    const p = profileOf(rep('mirage', true, 8));
    expect(p.archetype).toBe('RNG God');
  });
});

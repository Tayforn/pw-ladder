import { describe, it, expect } from 'vitest';
import { computeRitualStats, displaySignature, formatPreamble } from '../ritual';
import { seqHistory, rep, type Step } from './helpers';

describe('computeRitualStats — преамбули', () => {
  it('преамбула = результати підставної від попереднього тицю основної', () => {
    // a: основна (рівень 0, tie → липко a). b: підставна.
    const h = seqHistory([
      ['mirage', false, 'b'], ['mirage', false, 'b'], ['mirage', true, 'a'],   // "--"
      ['mirage', true, 'b'], ['mirage', false, 'b'], ['mirage', false, 'a'],   // "+-"
      ['mirage', false, 'a'],                                                   // без преамбули
    ]);
    const r = computeRitualStats(h);
    expect(r.decoyAttempts).toBe(4);
    expect(r.switches).toBe(2);
    expect(r.preambles.map((p) => p.pattern).sort()).toEqual(['+-', '--']);
    expect(r.ritual.n).toBe(2);
    expect(r.plain.n).toBe(1);
    expect(r.signature).toBeNull(); // < 3 повторів
  });

  it('сигнатура, ортодоксальність, школа холодної серії', () => {
    const steps: Step[] = [];
    for (let i = 0; i < 5; i++) steps.push(...rep('mirage', false, 3, 'b'), ['mirage', i % 2 === 0, 'a']);
    const r = computeRitualStats(seqHistory(steps));
    expect(r.signature).toBe('---');
    expect(r.signatureCount).toBe(5);
    expect(r.orthodoxy).toBe(100);
    expect(r.school).toBe('cold');
    expect(r.maxColdStreakWaited).toBe(3);
    expect(formatPreamble(r.signature!)).toBe('−−−');
  });

  it('суфіксна сигнатура ловить "чекаю два мінуси" з різними префіксами', () => {
    // a тримаємо на 1 (world-провали), b нижче — роль не міняється.
    const steps: Step[] = [['mirage', true, 'a']];
    const prefixes: Step[][] = [
      [],
      [['mirage', true, 'b']],                         // "+--"
      [['mirage', true, 'b'], ['mirage', false, 'b']],  // "+---"? ні: +, -, потім -- → "+---"
      [],
      [['mirage', true, 'b']],
    ];
    for (const pre of prefixes) steps.push(...pre, ...rep('mirage', false, 2, 'b'), ['world', false, 'a']);
    const r = computeRitualStats(seqHistory(steps));
    expect(r.suffixSignature).toBe('--');
    expect(r.suffixShare).toBe(100);
    expect(displaySignature(r)).toBe('−−');
  });

  it('суфікс не подовжується "граничним" символом: чекаю три мінуси ≠ ‹+−−−›', () => {
    // Холодний ритуаліст: преамбули "---", "+---", "-+---", "++---" — усі
    // закінчуються на "---"; символ перед хвостом — завжди "+", але це не ритуал.
    // a тримаємо на +3 (world-провали), щоб b з префіксом "++" (рівень 2) не стала основною.
    const steps: Step[] = [...rep('mirage', true, 3, 'a')];
    const prefixes = ['', '+', '-+', '++', '+', '-+', '', '+'];
    for (const pre of prefixes) {
      for (const ch of pre) steps.push(['mirage', ch === '+', 'b']);
      steps.push(...rep('mirage', false, 3, 'b'), ['world', false, 'a']);
    }
    const r = computeRitualStats(seqHistory(steps));
    expect(r.suffixSignature).toBe('---');
  });

  it('гаряча рука: преамбули закінчуються плюсом', () => {
    const steps: Step[] = [['mirage', true, 'a']]; // a = 1
    for (let i = 0; i < 6; i++) steps.push(['mirage', false, 'b'], ['mirage', true, 'b'], ['world', false, 'a'], ['mirage', false, 'b']);
    // b: 0 → F(0) → T(1); a world-провал (лишається 1); далі b F (1→0) — без тицю основної між ними
    const r = computeRitualStats(seqHistory(steps));
    expect(r.school).toBe('hot');
  });

  it('ритуальна vs безритуальна удача рахуються окремо', () => {
    // Ритуал: [b F, a T] — успіхи; без ритуалу: a F
    const steps: Step[] = [];
    for (let i = 0; i < 3; i++) steps.push(['mirage', false, 'b'], ['mirage', true, 'a']); // a → 3
    steps.push(['mirage', false, 'a']); // 3 → 0 без преамбули
    const r = computeRitualStats(seqHistory(steps));
    expect(r.ritual.successes).toBe(3);
    expect(r.ritual.luck).toBe(100);
    expect(r.plain.successes).toBe(0);
    expect(r.plain.luck).toBe(0);
  });

  it('зрада ритуалу, перегрів, метроном, перемикання', () => {
    const h = seqHistory([
      ...rep('mirage', true, 5, 'a'),                    // a = 5
      ...rep('mirage', false, 3, 'b'), ['mirage', false, 'a'], // зрада: 5 → 0 після "---"
      ...rep('mirage', false, 3, 'b'), ['mirage', false, 'a'],
      ...rep('mirage', false, 3, 'b'), ['mirage', false, 'a'],
    ]);
    const r = computeRitualStats(h);
    expect(r.betrayals).toBe(1);
    expect(r.maxRitualFailRun).toBe(3);

    const m = computeRitualStats(seqHistory([
      ['mirage', false, 'a'], ['mirage', false, 'b'], ['mirage', false, 'a'], ['mirage', false, 'b'], ['mirage', false, 'a'],
    ]));
    expect(m.maxAlternation).toBe(5);
    expect(m.itemSwitches).toBe(4);
  });

  it('без підставної — порожній ритуал', () => {
    const r = computeRitualStats(seqHistory(rep('mirage', true, 5)));
    expect(r.decoyAttempts).toBe(0);
    expect(r.switches).toBe(0);
    expect(r.school).toBeNull();
    expect(r.ritual.luck).toBeNull();
  });
});

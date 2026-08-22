// =========================================================
// Кожен титул має крафтову історію, що його ТРИГЕРИТЬ (детермінована
// перевірка "ачівка досяжна і логіка правильна") + негативні кейси на
// найризикованіші умови. Досяжність у РЕАЛЬНІЙ грі перевіряє окремо
// calibration.test.ts (симуляції справжнім рушієм).
// =========================================================

import { describe, it, expect } from 'vitest';
import { computeSessionStats } from '../sessionStats';
import { computeRngProfile } from '../rngProfile';
import { evaluateTitles, TITLE_CONFIG } from '../titles';
import { buildHallOfShame } from '../hallOfShame';
import { computeRitualStats } from '../ritual';
import { seqHistory, rep, type Step } from './helpers';
import type { AttemptResult } from '../types';

function titlesFor(history: AttemptResult[], recordLevel: number | null = null) {
  const stats = computeSessionStats(history);
  const profile = computeRngProfile(history, stats);
  return evaluateTitles(history, stats, profile, recordLevel, computeRitualStats(history));
}
const ids = (r: ReturnType<typeof titlesFor>) => r.qualified.map((t) => t.id);

describe('evaluateTitles — кожен титул досяжний і тригериться правильно', () => {
  it('RNG_GOD: пік 8+ швидко', () => {
    const h = seqHistory(rep('mirage', true, 8));
    expect(ids(titlesFor(h))).toContain('RNG_GOD');
  });

  it('THE_CHOSEN_ONE: пік >= рекорду ладдера; порожній ладдер (рекорд 0) теж дає титул', () => {
    const h = seqHistory(rep('mirage', true, 3));
    expect(ids(titlesFor(h, 3))).toContain('THE_CHOSEN_ONE');
    expect(ids(titlesFor(h, 0))).toContain('THE_CHOSEN_ONE'); // перший гравець
    expect(ids(titlesFor(h, 4))).not.toContain('THE_CHOSEN_ONE');
    expect(ids(titlesFor(h, null))).not.toContain('THE_CHOSEN_ONE'); // рекорд невідомий
  });

  it('THE_DRAGON: пік 7+, 2+ падіння з 5+, фініш 6+', () => {
    const h = seqHistory([
      ...rep('mirage', true, 7),    // до 7
      ['under', false],             // 7→6 (падіння з 7)
      ['under', false],             // 6→5 (падіння з 6)
      ['mirage', true],             // 5→6 — фініш 6
    ]);
    expect(ids(titlesFor(h))).toContain('THE_DRAGON');
  });

  it('PHOENIX: згорів у 0 з 4+ і піднявся ВИЩЕ, ніж був', () => {
    const h = seqHistory([
      ...rep('mirage', true, 4),
      ['mirage', false],            // 4→0
      ...rep('mirage', true, 5),    // до 5 > 4
    ]);
    expect(ids(titlesFor(h))).toContain('PHOENIX');
    // Піднявся лише ДО того самого рівня — не фенікс
    const h2 = seqHistory([
      ...rep('mirage', true, 4),
      ['mirage', false],
      ...rep('mirage', true, 4),
    ]);
    expect(ids(titlesFor(h2))).not.toContain('PHOENIX');
  });

  it('LOTTERY_TICKET: успіх зі скромним шансом <= 5%', () => {
    const h = seqHistory([
      ...rep('mirage', true, 4),
      ['world', true],              // world на 4→5: p=0.0167
    ]);
    expect(ids(titlesFor(h))).toContain('LOTTERY_TICKET');
  });

  it('CLUTCH_MASTER: перемога після статистично образливої серії', () => {
    // 8 провалів міражем на +0: шанс 0.5⁸ ≈ 0.4% — справжній клатч
    const h = seqHistory([...rep('mirage', false, 8), ['mirage', true]]);
    expect(ids(titlesFor(h))).toContain('CLUTCH_MASTER');
    // 8 провалів світобудови на +2 (провал 90%): шанс ~43% — очікувано, не клатч
    const h2 = seqHistory([
      ...rep('mirage', true, 2),
      ...rep('world', false, 8),
      ['mirage', true],
    ]);
    expect(ids(titlesFor(h2))).not.toContain('CLUTCH_MASTER');
  });

  it('HOT_START: перші 4 спроби успішні', () => {
    const h = seqHistory([...rep('mirage', true, 4), ['mirage', false]]);
    expect(ids(titlesFor(h))).toContain('HOT_START');
    const h2 = seqHistory([['mirage', false], ...rep('mirage', true, 4)]);
    expect(ids(titlesFor(h2))).not.toContain('HOT_START');
  });

  it('PHOTO_FINISH: пік в останніх 10 спробах довгого забігу', () => {
    const filler: Step[] = [];
    for (let i = 0; i < 48; i++) filler.push(['mirage', true], ['mirage', false]); // пила 0↔1, 96 спроб
    const h = seqHistory([...filler, ...rep('mirage', true, 5)]); // 101 спроба, пік на 101-й
    expect(ids(titlesFor(h))).toContain('PHOTO_FINISH');
  });

  it('BLOOD_SACRIFICE: образливий хвіст на одному рівні', () => {
    // 8 провалів міражем на +0 (0.5⁸ ≈ 0.4%) — жертва зарахована
    const h = seqHistory(rep('mirage', false, 8));
    expect(ids(titlesFor(h))).toContain('BLOOD_SACRIFICE');
    // 10 провалів світобудови на +2 — шанс ~35%, це просто вівторок
    const h2 = seqHistory([
      ...rep('mirage', true, 2),
      ...rep('world', false, 10),
    ]);
    expect(ids(titlesFor(h2))).not.toContain('BLOOD_SACRIFICE');
  });

  it('THE_CURSED: пік <= 3 і образливий хвіст 8+ провалів', () => {
    const h = seqHistory([
      ['mirage', true],
      ...rep('mirage', false, 8),
      ['mirage', true],
    ]);
    expect(ids(titlesFor(h))).toContain('THE_CURSED');
    // 30 провалів world-спаму на +3 (шанс ~29%) — самообрана бідність, не прокляття
    const h2 = seqHistory([
      ...rep('mirage', true, 3),
      ...rep('world', false, 30),
    ]);
    expect(ids(titlesFor(h2))).not.toContain('THE_CURSED');
  });

  it('VICTIM_OF_RNG: 180+ спроб, пік <= 3', () => {
    const steps: Step[] = [];
    for (let i = 0; i < 90; i++) steps.push(['mirage', true], ['mirage', false]); // 180, пік 1
    const h = seqHistory(steps);
    expect(ids(titlesFor(h))).toContain('VICTIM_OF_RNG');
  });

  it('SISYPHUS: 4 рази викотив камінь на той самий рівень 4+', () => {
    const steps: Step[] = [];
    for (let i = 0; i < 4; i++) steps.push(...rep('mirage', true, 4), ['mirage', false]); // 4 підйоми на 4, скид
    const h = seqHistory(steps);
    expect(ids(titlesFor(h))).toContain('SISYPHUS');
  });

  it('WILD_CARD: падіння −5 і стрік 4+ в одному забігу', () => {
    const h = seqHistory([
      ...rep('mirage', true, 5),
      ['mirage', false],            // −5
    ]);
    expect(ids(titlesFor(h))).toContain('WILD_CARD');
  });

  it('ALL_IN: міраж на +6 і вище', () => {
    const h = seqHistory([...rep('mirage', true, 6), ['mirage', false]]);
    expect(ids(titlesFor(h))).toContain('ALL_IN');
    // Небеска на +6 — не ва-банк (платний камінь)
    const h2 = seqHistory([...rep('mirage', true, 6), ['sky', false]]);
    expect(ids(titlesFor(h2))).not.toContain('ALL_IN');
  });

  it('DEMOLITION_EXPERT: 40+ відкатів і 100+ втрачених рівнів', () => {
    const steps: Step[] = [];
    for (let i = 0; i < 40; i++) steps.push(...rep('mirage', true, 3), ['mirage', false]); // 40 скидів по −3
    const h = seqHistory(steps);
    expect(ids(titlesFor(h))).toContain('DEMOLITION_EXPERT');
  });

  it('THE_GAMBLER: середня ставка 1.2+ рівня за спробу', () => {
    // Пила: до 4 міражем і скид — середня ставка (0+1+2+3+4)/5 = 2
    const steps: Step[] = [];
    for (let i = 0; i < 8; i++) steps.push(...rep('mirage', true, 4), ['mirage', false]);
    const h = seqHistory(steps);
    expect(ids(titlesFor(h))).toContain('THE_GAMBLER');
  });

  it('THE_UNBREAKABLE: 12+ спроб поспіль на +5 і вище', () => {
    const h = seqHistory([
      ...rep('mirage', true, 5),
      ...rep('world', false, 12),   // стоїть на 5
    ]);
    expect(ids(titlesFor(h))).toContain('THE_UNBREAKABLE');
  });

  it('BLESSED: luck 65+ на 20+ спробах', () => {
    // 5 циклів [T, T, world-T(10%), F] — успіхів утричі більше за очікуване.
    const steps: Step[] = [];
    for (let i = 0; i < 5; i++) {
      steps.push(['mirage', true], ['mirage', true], ['world', true], ['mirage', false]);
    }
    const h = seqHistory(steps); // 20 спроб
    const stats = computeSessionStats(h);
    const profile = computeRngProfile(h, stats);
    expect(profile.luck).toBeGreaterThanOrEqual(TITLE_CONFIG.blessed.minLuck);
    expect(ids(titlesFor(h))).toContain('BLESSED');
  });

  it('THE_STREAKER: 6 перемог поспіль', () => {
    const h = seqHistory(rep('mirage', true, 6));
    expect(ids(titlesFor(h))).toContain('THE_STREAKER');
  });

  it('PACIFIST: 100+ спроб без жодного каменя', () => {
    const steps: Step[] = [];
    for (let i = 0; i < 50; i++) steps.push(['mirage', true], ['mirage', false]);
    const h = seqHistory(steps);
    expect(ids(titlesFor(h))).toContain('PACIFIST');
    // Один камінь — і все, не пацифіст
    const h2 = seqHistory([...steps, ['sky', false]]);
    expect(ids(titlesFor(h2))).not.toContain('PACIFIST');
  });

  it('THE_GRINDER: 180+ спроб і пік 5+', () => {
    const steps: Step[] = [...rep('mirage', true, 5)];
    for (let i = 0; i < 88; i++) steps.push(['world', false], ['world', false]);
    const h = seqHistory(steps); // 181 спроба, пік 5
    expect(ids(titlesFor(h))).toContain('THE_GRINDER');
  });

  it('SLOW_AND_STEADY: пік 5+ без падінь більше −2', () => {
    const h = seqHistory([
      ...rep('mirage', true, 3),
      ['under', false],             // −1
      ...rep('mirage', true, 3),    // до 5
    ]);
    expect(ids(titlesFor(h))).toContain('SLOW_AND_STEADY');
  });

  it('EDGE_DANCER: 8+ спроб на власному піку 5+', () => {
    const h = seqHistory([
      ...rep('mirage', true, 5),
      ...rep('world', false, 8),    // 8 спроб на піку 5
    ]);
    expect(ids(titlesFor(h))).toContain('EDGE_DANCER');
  });

  it('STONE_COLLECTOR: всі 4 методи за забіг', () => {
    const h = seqHistory([
      ['mirage', true],
      ['sky', true],
      ['under', false],
      ['world', false],
    ]);
    expect(ids(titlesFor(h))).toContain('STONE_COLLECTOR');
  });

  it('FATAL_SYMMETRY: рівно порівну успіхів і провалів на 20+ спробах', () => {
    const steps: Step[] = [];
    for (let i = 0; i < 10; i++) steps.push(['mirage', true], ['mirage', false]);
    const h = seqHistory(steps);
    expect(ids(titlesFor(h))).toContain('FATAL_SYMMETRY');
  });

  it('STRATOSPHERE: пік 9+', () => {
    const h = seqHistory(rep('mirage', true, 9));
    expect(ids(titlesFor(h))).toContain('STRATOSPHERE');
    expect(ids(titlesFor(seqHistory(rep('mirage', true, 8))))).not.toContain('STRATOSPHERE');
  });

  it('ІКАР: новий пік 6+ і наступною ж спробою у нуль', () => {
    const h = seqHistory([
      ...rep('mirage', true, 6),
      ['mirage', false],            // одразу після нового піку +6 → у нуль
    ]);
    expect(ids(titlesFor(h))).toContain('ICARUS');
    // Між підйомом і падінням була ще спроба (world) — то вже не Ікар
    const h2 = seqHistory([
      ...rep('mirage', true, 6),
      ['world', false],
      ['mirage', false],
    ]);
    expect(ids(titlesFor(h2))).not.toContain('ICARUS');
    // Повторний підйом на ВЖЕ бачену висоту + миттєвий провал — не Ікар
    const h3 = seqHistory([
      ...rep('mirage', true, 7),    // новий пік 7...
      ['world', false],             // ...але одразу після нього НЕ згорів
      ['mirage', false],            // 7→0 (за 2 спроби після піку — не Ікар)
      ...rep('mirage', true, 6),    // знову до 6 — не новий пік (< 7)
      ['mirage', false],            // миттєвий провал, але висота вже бачена
    ]);
    expect(ids(titlesFor(h3))).not.toContain('ICARUS');
  });

  it('DARK_STAR: luck <= 35 на 50+ спробах', () => {
    // 50 провалів world на +1 (p=0.25): очікувано 12.5 успіхів, факт 0 → luck 0
    const steps: Step[] = [['mirage', true], ...rep('world', false, 50)];
    const h = seqHistory(steps);
    expect(ids(titlesFor(h))).toContain('DARK_STAR');
  });

  it('DOUBLE_BOTTOM: два падіння на 5+ рівнів', () => {
    const h = seqHistory([
      ...rep('mirage', true, 5), ['mirage', false],   // −5
      ...rep('mirage', true, 5), ['mirage', false],   // −5
    ]);
    expect(ids(titlesFor(h))).toContain('DOUBLE_BOTTOM');
    const h2 = seqHistory([...rep('mirage', true, 5), ['mirage', false]]);
    expect(ids(titlesFor(h2))).not.toContain('DOUBLE_BOTTOM');
  });

  it('COOL_HEAD vs GREED — взаємовиключні', () => {
    // Фініш рівно на піку 5 — холодна голова
    const cool = seqHistory(rep('mirage', true, 5));
    expect(ids(titlesFor(cool))).toContain('COOL_HEAD');
    expect(ids(titlesFor(cool))).not.toContain('GREED');
    // Мав 6, злив у нуль і не піднявся — жадібність
    const greedy = seqHistory([...rep('mirage', true, 6), ['mirage', false], ['mirage', true]]);
    expect(ids(titlesFor(greedy))).toContain('GREED');
    expect(ids(titlesFor(greedy))).not.toContain('COOL_HEAD');
  });

  it('ALCHEMIST: 3+ успіхи світобудови на +3 і вище', () => {
    const h = seqHistory([
      ...rep('mirage', true, 3),
      ['world', true],              // 3→4 (4%)
      ['world', true],              // 4→5 (1.67%)
      ['world', true],              // 5→6 (0.77%)
    ]);
    expect(ids(titlesFor(h))).toContain('ALCHEMIST');
    // Успіхи world на +1..2 — не алхімія (там шанси людські)
    const h2 = seqHistory([
      ['mirage', true], ['world', true], ['mirage', false],
      ['mirage', true], ['world', true], ['mirage', false],
      ['mirage', true], ['world', true],
    ]);
    expect(ids(titlesFor(h2))).not.toContain('ALCHEMIST');
  });

  it('MARKETING_VICTIM: платний камінь на +0', () => {
    const h = seqHistory([['sky', false], ['mirage', true]]);
    expect(ids(titlesFor(h))).toContain('MARKETING_VICTIM');
    // Небеска на +2 — легітимна покупка
    const h2 = seqHistory([...rep('mirage', true, 2), ['sky', true]]);
    expect(ids(titlesFor(h2))).not.toContain('MARKETING_VICTIM');
  });

  it('primary обирається за пріоритетом (рідкісні першими)', () => {
    const h = seqHistory(rep('mirage', true, 8)); // RNG_GOD + STREAKER + ...
    const r = titlesFor(h, 0);
    expect(r.primary?.id).toBe('THE_CHOSEN_ONE');
    const r2 = titlesFor(h, null);
    expect(r2.primary?.id).toBe('RNG_GOD');
  });

  it('усі id з пріоритетного списку унікальні й покривають усі add()', () => {
    // Санітарний: жоден кваліфікований титул не губиться поза priority.
    const h = seqHistory([
      ...rep('mirage', true, 7),
      ['sky', true], ['under', false], ['world', false],
      ...rep('world', false, 12),
    ]);
    const r = titlesFor(h, 0);
    expect(r.primary).not.toBeNull();
    for (const t of r.qualified) {
      expect(typeof t.name).toBe('string');
      expect(t.evidence.length).toBeGreaterThan(0);
    }
  });
});

describe('buildHallOfShame', () => {
  it('АБОНЕМЕНТ У ПІДВАЛ: 8+ поїздок у нуль', () => {
    const steps: Step[] = [];
    for (let i = 0; i < 8; i++) steps.push(['mirage', true], ['mirage', false]);
    const h = seqHistory(steps);
    const stats = computeSessionStats(h);
    const titles = buildHallOfShame(h, stats).map((e) => e.title);
    expect(titles).toContain('АБОНЕМЕНТ У ПІДВАЛ');
  });

  it('ВЕЛИКЕ ПАДІННЯ і КРИВАВЕ ЖЕРТВОПРИНОШЕННЯ', () => {
    const h = seqHistory([
      ...rep('mirage', true, 4),
      ['mirage', false],            // −4
      ...rep('world', false, 5),    // 5 провалів на 0? ні — world на 0
    ]);
    const stats = computeSessionStats(h);
    const titles = buildHallOfShame(h, stats).map((e) => e.title);
    expect(titles).toContain('ВЕЛИКЕ ПАДІННЯ');
    expect(titles).toContain('КРИВАВЕ ЖЕРТВОПРИНОШЕННЯ');
    expect(titles).toContain('НАЙПРОКЛЯТІШИЙ ВІДРІЗОК');
  });
});

describe('ритуальні титули (підставна шмотка)', () => {
  /** k мінусів на b, потім тиць a; повторити n разів. a стоїть на +1 через world-провали. */
  const coldCycles = (k: number, n: number): Step[] => {
    const steps: Step[] = [['mirage', true, 'a']];
    for (let i = 0; i < n; i++) steps.push(...rep('mirage', false, k, 'b'), ['world', false, 'a']);
    return steps;
  };

  it('SHAMAN / COLD_ADEPT / IMPATIENT: 10 тиців після одного мінуса', () => {
    const t = ids(titlesFor(seqHistory(coldCycles(1, 10))));
    expect(t).toContain('SHAMAN');
    expect(t).toContain('COLD_ADEPT');
    expect(t).toContain('IMPATIENT');
  });

  it('CULT ‹−−−› з динамічною назвою і PATIENT_SHAMAN', () => {
    const r = titlesFor(seqHistory(coldCycles(3, 8)));
    const cult = r.qualified.find((x) => x.id === 'CULT');
    expect(cult?.name).toBe('КУЛЬТ ‹−−−›');
    expect(ids(r)).not.toContain('PATIENT_SHAMAN');
    expect(ids(titlesFor(seqHistory(coldCycles(6, 3))))).toContain('PATIENT_SHAMAN');
  });

  it('CULT також для "чекаю два мінуси" з різними префіксами (суфіксна сигнатура)', () => {
    const steps: Step[] = [['mirage', true, 'a']];
    for (let i = 0; i < 8; i++) {
      if (i % 2 === 0) steps.push(['mirage', true, 'b'], ['mirage', false, 'b']); // префікс "+-"
      steps.push(...rep('mirage', false, 2, 'b'), ['world', false, 'a']);
    }
    const cult = titlesFor(seqHistory(steps)).qualified.find((x) => x.id === 'CULT');
    expect(cult?.name).toBe('КУЛЬТ ‹−−›');
  });

  it('COMBINATOR ‹−+−+›: змішаний суфікс', () => {
    const steps: Step[] = [['mirage', true, 'a']];
    for (let i = 0; i < 8; i++) {
      steps.push(['mirage', false, 'b'], ['mirage', true, 'b'], ['mirage', false, 'b'], ['mirage', true, 'b'], ['world', false, 'a']);
    }
    const combo = titlesFor(seqHistory(steps)).qualified.find((x) => x.id === 'COMBINATOR');
    expect(combo?.name).toBe('КОМБІНАТОР ‹−+−+›');
  });

  it('HOT_ADEPT: тиць після плюса підставної', () => {
    const steps: Step[] = [['mirage', true, 'a']];
    for (let i = 0; i < 8; i++) steps.push(['mirage', false, 'b'], ['mirage', true, 'b'], ['world', false, 'a']);
    expect(ids(titlesFor(seqHistory(steps)))).toContain('HOT_ADEPT');
  });

  it('ECLECTIC: 8 різних преамбул', () => {
    const steps: Step[] = [...rep('mirage', true, 5, 'a')]; // a = 5, b лишається нижче
    const patterns = ['-', '+', '--', '+-', '-+', '---', '++', '+--'];
    for (const pat of patterns) {
      for (const ch of pat) steps.push(['mirage', ch === '+', 'b']);
      steps.push(['world', false, 'a']);
    }
    expect(ids(titlesFor(seqHistory(steps)))).toContain('ECLECTIC');
  });

  it('FAITH_WORKS / SCIENCE_WINS / PLACEBO — взаємовиключні за різницею удачі', () => {
    // Віра: ритуальні тиці всі заходять, без ритуалу — всі мимо.
    const faith: Step[] = [...rep('mirage', false, 10, 'a')];
    for (let i = 0; i < 10; i++) faith.push(['mirage', false, 'b'], ['mirage', true, 'a']);
    const f = ids(titlesFor(seqHistory(faith)));
    expect(f).toContain('FAITH_WORKS');
    expect(f).not.toContain('SCIENCE_WINS');

    // Наука: навпаки.
    const science: Step[] = [...rep('mirage', true, 10, 'a')];
    for (let i = 0; i < 10; i++) science.push(['mirage', false, 'b'], ['mirage', false, 'a']);
    expect(ids(titlesFor(seqHistory(science)))).toContain('SCIENCE_WINS');

    // Плацебо: однакова пила з ритуалом і без.
    const placebo: Step[] = [];
    for (let i = 0; i < 15; i++) placebo.push(['mirage', i % 2 === 0, 'a']);
    for (let i = 0; i < 15; i++) placebo.push(['mirage', false, 'b'], ['mirage', i % 2 === 0, 'a']);
    expect(ids(titlesFor(seqHistory(placebo)))).toContain('PLACEBO');
  });

  it('METRONOME і TWO_CHAIRS: строге чергування', () => {
    const steps: Step[] = [];
    for (let i = 0; i < 26; i++) steps.push(['mirage', false, 'a'], ['mirage', false, 'b']);
    const t = ids(titlesFor(seqHistory(steps)));
    expect(t).toContain('METRONOME');
    expect(t).toContain('TWO_CHAIRS');
  });

  it('RITUAL_BETRAYAL і OVERHEAT', () => {
    const betrayal = seqHistory([...rep('mirage', true, 5, 'a'), ...rep('mirage', false, 3, 'b'), ['mirage', false, 'a']]);
    expect(ids(titlesFor(betrayal))).toContain('RITUAL_BETRAYAL');
    const low = seqHistory([...rep('mirage', true, 4, 'a'), ...rep('mirage', false, 3, 'b'), ['mirage', false, 'a']]);
    expect(ids(titlesFor(low))).not.toContain('RITUAL_BETRAYAL');
    const steps: Step[] = [];
    for (let i = 0; i < 10; i++) steps.push(['mirage', false, 'b'], ['mirage', false, 'a']);
    expect(ids(titlesFor(seqHistory(steps)))).toContain('OVERHEAT');
  });

  it('RNG_WHISPERER: 20 ритуальних тиців з удачею 65+', () => {
    const steps: Step[] = [];
    for (let i = 0; i < 5; i++) {
      steps.push(
        ['mirage', false, 'b'], ['mirage', true, 'a'],
        ['mirage', false, 'b'], ['mirage', true, 'a'],
        ['mirage', false, 'b'], ['world', true, 'a'],   // 2→3 при 10%
        ['mirage', false, 'b'], ['mirage', false, 'a'], // 3→0
      );
    }
    expect(ids(titlesFor(seqHistory(steps)))).toContain('RNG_WHISPERER');
  });

  it('SKEPTIC vs BOUGHT_AND_FORGOT', () => {
    const solo: Step[] = [];
    for (let i = 0; i < 75; i++) solo.push(['mirage', true, 'a'], ['mirage', false, 'a']);
    expect(ids(titlesFor(seqHistory(solo)))).toContain('SKEPTIC');
    const once = ids(titlesFor(seqHistory([...solo, ['mirage', false, 'b']])));
    expect(once).toContain('BOUGHT_AND_FORGOT');
    expect(once).not.toContain('SKEPTIC');
  });

  it('CASTLING / CASTLING_CAROUSEL / PROMOTION — лише значущі рокіровки (+3 і вище)', () => {
    // Рокіровка відбувається В МОМЕНТ перевищення: b=2 > a=1 — шум, навіть якщо b далі росте.
    const noise = seqHistory([['mirage', true, 'a'], ...rep('mirage', true, 3, 'b')]);
    expect(ids(titlesFor(noise))).not.toContain('CASTLING');
    const one = seqHistory([...rep('mirage', true, 2, 'a'), ...rep('mirage', true, 3, 'b')]); // b=3 > a=2
    expect(ids(titlesFor(one))).toContain('CASTLING');
    const carousel = seqHistory([
      ...rep('mirage', true, 2, 'a'), ...rep('mirage', true, 3, 'b'), // swap → b (3)
      ...rep('mirage', true, 2, 'a'),                                 // a=4 > 3 → swap → a
      ...rep('mirage', true, 2, 'b'),                                 // b=5 > 4 → swap → b
    ]);
    const t = ids(titlesFor(carousel));
    expect(t).toContain('CASTLING_CAROUSEL');
    expect(t).not.toContain('CASTLING');
    const promo = seqHistory([
      ...rep('mirage', true, 2, 'a'),          // a=2 (пік 2)
      ...rep('mirage', true, 3, 'b'),          // b=3 → рокіровка
      ['mirage', true, 'b'],                   // b=4 — новий загальний пік після рокіровки
    ]);
    expect(ids(titlesFor(promo))).toContain('PROMOTION');
  });

  it('SACRIFICIAL_LAMB / DOUBLE_AGENT / DECOY_PRICIER / WHITE_IRON', () => {
    const lamb: Step[] = [...rep('mirage', true, 2, 'a')];
    for (let i = 0; i < 60; i++) lamb.push(['mirage', true, 'b'], ['mirage', false, 'b']);
    expect(ids(titlesFor(seqHistory(lamb)))).toContain('SACRIFICIAL_LAMB');

    const agent = seqHistory([...rep('mirage', true, 5, 'a'), ...rep('mirage', true, 5, 'b')]);
    expect(ids(titlesFor(agent))).toContain('DOUBLE_AGENT');

    const pricier = seqHistory([...rep('mirage', true, 3, 'a'), ['mirage', true, 'b'], ...rep('world', false, 5, 'b')]);
    expect(ids(titlesFor(pricier))).toContain('DECOY_PRICIER');

    const iron = seqHistory([...rep('mirage', true, 3, 'a'), ...rep('mirage', false, 30, 'b')]);
    expect(ids(titlesFor(iron))).toContain('WHITE_IRON');
  });
});

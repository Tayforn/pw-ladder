// =========================================================
// Калібрування титулів симуляцією ЧЕСНОЇ гри справжнім рушієм: 4 стилі
// гри × 400 сідованих забігів по 200 спроб. Друкує таблицю рідкості
// (корисно при підкрутці TITLE_CONFIG) і перевіряє:
//  - жоден титул не мертвий: усе, що заявлено в TITLE_CONFIG, реально
//    трапляється хоч в одному стилі гри (крім свідомо подієвих винятків);
//  - "буденні" титули не видаються кожному підряд.
// =========================================================

import { describe, it, expect } from 'vitest';
import { computeSessionStats } from '../sessionStats';
import { computeRngProfile } from '../rngProfile';
import { evaluateTitles } from '../titles';
import { lcg, simulateRun, STRATEGIES } from './helpers';

const RUNS_PER_STRATEGY = 400;

// THE_CHOSEN_ONE залежить від рекорду ладдера (контекст, не історія) —
// у симуляції рекорд узято за 6, щоб перевіряти і його.
const RECORD_LEVEL = 6;

function collectRates() {
  const counts = new Map<string, Map<string, number>>(); // title -> strategy -> hits
  const strategyNames = Object.keys(STRATEGIES);

  for (const name of strategyNames) {
    for (let seed = 1; seed <= RUNS_PER_STRATEGY; seed++) {
      const roll = lcg(seed * 104729 + strategyNames.indexOf(name) * 31);
      const state = simulateRun(STRATEGIES[name], roll);
      const stats = computeSessionStats(state.history);
      const profile = computeRngProfile(state.history, stats);
      const { qualified } = evaluateTitles(state.history, stats, profile, RECORD_LEVEL);
      for (const t of qualified) {
        if (!counts.has(t.id)) counts.set(t.id, new Map());
        const m = counts.get(t.id)!;
        m.set(name, (m.get(name) ?? 0) + 1);
      }
    }
  }
  return { counts, strategyNames };
}

describe('калібрування титулів (симуляція чесної гри)', () => {
  const { counts, strategyNames } = collectRates();

  it('друк таблиці рідкості (інформаційно)', () => {
    const rows = [...counts.entries()]
      .map(([id, m]) => ({
        title: id,
        ...Object.fromEntries(strategyNames.map((s) => [s, `${(((m.get(s) ?? 0) / RUNS_PER_STRATEGY) * 100).toFixed(1)}%`])),
      }))
      .sort((a, b) => a.title.localeCompare(b.title));
    // eslint-disable-next-line no-console
    console.table(rows);
    expect(rows.length).toBeGreaterThan(0);
  });

  // Титули, які МАЮТЬ регулярно траплятись у відповідному стилі гри.
  // Поза списком свідомо: RNG_GOD/THE_DRAGON/STRATOSPHERE (легендарні —
  // досяжність доводять крафтові історії) і MARKETING_VICTIM (тригериться
  // ПОМИЛКОЮ гравця, яку жодна розумна стратегія не робить).
  const mustBeReachable = [
    'CLUTCH_MASTER', 'BLOOD_SACRIFICE', 'THE_CURSED', 'VICTIM_OF_RNG',
    'DEMOLITION_EXPERT', 'THE_GAMBLER', 'THE_STREAKER', 'PACIFIST',
    'THE_GRINDER', 'SISYPHUS', 'PHOENIX', 'WILD_CARD', 'ALL_IN',
    'LOTTERY_TICKET', 'HOT_START', 'FATAL_SYMMETRY', 'BLESSED',
    'THE_UNBREAKABLE', 'EDGE_DANCER', 'PHOTO_FINISH', 'STONE_COLLECTOR',
    'THE_CHOSEN_ONE', 'SLOW_AND_STEADY',
    'ICARUS', 'DARK_STAR', 'DOUBLE_BOTTOM', 'GREED', 'COOL_HEAD', 'ALCHEMIST',
  ];
  for (const id of mustBeReachable) {
    it(`${id} досяжний у чесній грі`, () => {
      const m = counts.get(id);
      const total = m ? [...m.values()].reduce((a, b) => a + b, 0) : 0;
      expect(total, `${id}: 0 із ${RUNS_PER_STRATEGY * strategyNames.length} забігів`).toBeGreaterThan(0);
    });
  }

  // Рідкісні (RNG_GOD, THE_DRAGON) можуть не випасти навіть за 1600 забігів —
  // їхню ДОСЯЖНІСТЬ доводять крафтові історії в titles.test.ts; тут лише
  // перевіряємо, що вони не стали буденними.
  it('RNG_GOD/THE_DRAGON лишаються рідкісними (< 5% у кожному стилі)', () => {
    for (const id of ['RNG_GOD', 'THE_DRAGON']) {
      const m = counts.get(id);
      if (!m) continue;
      for (const s of strategyNames) {
        expect((m.get(s) ?? 0) / RUNS_PER_STRATEGY, `${id} у ${s}`).toBeLessThan(0.05);
      }
    }
  });

  it('жоден титул не видається 100% забігів у ВСІХ стилях одночасно', () => {
    for (const [id, m] of counts) {
      const everywhere = strategyNames.every((s) => (m.get(s) ?? 0) === RUNS_PER_STRATEGY);
      expect(everywhere, `${id} видається всім і завжди`).toBe(false);
    }
  });
});

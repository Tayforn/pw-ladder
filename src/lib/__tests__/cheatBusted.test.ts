import { describe, it, expect } from 'vitest';
import { bustedJokeFor, isLimitsRejection, isValidationRejection } from '../cheatBusted';

describe('класифікація відхилень сервера', () => {
  it('ліміти ресурсів — НЕ читерство (нейтральний шлях)', () => {
    const limitMsgs = [
      'ladder_entries: спроб/міражів (501) понад ліміт 200 (з запасом)',
      'ladder_entries: небесок (24) понад ліміт 15 (з запасом)',
      'ladder_entries: підземок (30) понад ліміт 15 (з запасом)',
      'ladder_entries: світобудов (60) понад ліміт 30 (з запасом)',
      'ladder_entries: предметів (4) понад ліміт 2 (з запасом)',
      'ladder_entries: спроб/міражів (3100) понад ліміт 3000 (з запасом)',
    ];
    for (const m of limitMsgs) {
      expect(isLimitsRejection(m), m).toBe(true);
      expect(isValidationRejection(m), m).toBe(true); // тригерна, але не "читерська"
    }
  });

  it('справжні розбіжності — читерський шлях із жартом', () => {
    const cheats: Array<[string, string]> = [
      ['ladder_entries: history[3] перехід 2→7 неможливий для mirage / успіх', 'МАЙБУТНЬОГО'],
      ['ladder_entries: luck_score (100) не збігається з очікуваним (52) на основі RATES', 'ЩАСЛИВИЙ'],
      ['ladder_entries: success_rate (0.9) не відповідає історії (успіхів 3 із 10)', 'МАТЕМАТИКА'],
      ['ladder_entries: довжина history (5) не дорівнює attempts (10)', 'ОБРІЗАНА'],
      ['ladder_entries: history[7] before (3) не збігається з рівнем предмета b після попередньої спроби (0)', 'ЛАНЦЮЖКИ'],
      ['ladder_entries: подана статистика (стріки/дроп/камбек/пік) не відповідає наданій історії', 'ФЕЙКОВА'],
      ['ladder_entries: фінальний рівень історії (2) не збігається з level (9)', 'ФІНАЛ'],
    ];
    for (const [msg, expectInTitle] of cheats) {
      expect(isLimitsRejection(msg), msg).toBe(false);
      expect(bustedJokeFor(msg).title, msg).toContain(expectInTitle);
    }
  });
});

// =========================================================
// Hall of Shame — гумористичні записи з ОДНОГО забігу гравця, породжені
// з реальної історії спроб. Кожен запис — конкретна подія з числами, не
// абстрактна статистика. Гумор — про RNG/ситуацію, не про людину.
// =========================================================

import type { AttemptResult } from './types';
import { longestSameLevelFailStreak, winnerHistory, type SessionStats } from './sessionStats';

export interface ShameEntry {
  title: string;
  line: string;
}

const CONFIG = {
  mostCursedFailStreak: 5,
  bigFall: 4,
  sameLevelFailStreak: 5,
  slowMilestoneLevel: 4,
  slowMilestoneAttempts: 20,
  unmovableLength: 15,
  basementTrips: 8,
  decoyWasteAttempts: 40,
};

export function buildHallOfShame(history: AttemptResult[], stats: SessionStats): ShameEntry[] {
  const entries: ShameEntry[] = [];
  // Усе, що читає рівні, — по предмету-переможцю.
  const main = winnerHistory(history);

  if (stats.longestFailStreak >= CONFIG.mostCursedFailStreak) {
    entries.push({
      title: 'НАЙПРОКЛЯТІШИЙ ВІДРІЗОК',
      line: `${stats.longestFailStreak} провалів поспіль. Камінці вже сміялися в обличчя.`,
    });
  }

  if (stats.biggestDrop >= CONFIG.bigFall) {
    const dropAttempt = main.find((h) => h.before - h.after === stats.biggestDrop);
    if (dropAttempt) {
      entries.push({
        title: 'ВЕЛИКЕ ПАДІННЯ',
        line: `+${dropAttempt.before} → +${dropAttempt.after} за одну спробу. Гравітація не пробачає.`,
      });
    }
  }

  const sameLevel = longestSameLevelFailStreak(main);
  if (sameLevel.length >= CONFIG.sameLevelFailStreak) {
    entries.push({
      title: 'КРИВАВЕ ЖЕРТВОПРИНОШЕННЯ',
      line: `${sameLevel.length} провалів поспіль саме на +${sameLevel.level}. Це вже особисте.`,
    });
  }

  const milestoneAttempt = main.findIndex((h) => h.after >= CONFIG.slowMilestoneLevel);
  if (milestoneAttempt >= CONFIG.slowMilestoneAttempts) {
    entries.push({
      title: 'ЗАЩО',
      line: `${milestoneAttempt + 1} спроб, щоб уперше дійти до +${CONFIG.slowMilestoneLevel}. Черепахи б заздрили.`,
    });
  }

  if (stats.longestStagnation.length >= CONFIG.unmovableLength) {
    const s = stats.longestStagnation;
    entries.push({
      title: 'НЕЗРУШНИЙ',
      line: `${s.length} спроб навколо +${s.level} без реального прогресу, починаючи зі спроби №${s.startAttempt}.`,
    });
  }

  if (stats.decoy.attempts >= CONFIG.decoyWasteAttempts && stats.decoy.peakLevel <= 1) {
    entries.push({
      title: 'ЦІНА ВІРИ',
      line: `${stats.decoy.attempts} спроб спалено на підставній, яка так і не побачила +2. Бюджет 200 це пам'ятає.`,
    });
  }

  if (stats.timesHitZero >= CONFIG.basementTrips) {
    entries.push({
      title: 'АБОНЕМЕНТ У ПІДВАЛ',
      line: `${stats.timesHitZero} разів з'їхав у +0. Ліфт униз працює бездоганно.`,
    });
  }

  return entries;
}

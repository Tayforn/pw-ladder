// =========================================================
// Hall of Shame — гумористичні записи з ОДНОГО забігу гравця, породжені
// з реальної історії спроб. Кожен запис — конкретна подія з числами, не
// абстрактна статистика. Гумор — про RNG/ситуацію, не про людину.
// =========================================================

import type { AttemptResult } from './types';
import type { SessionStats } from './sessionStats';

export interface ShameEntry {
  title: string;
  line: string;
}

const CONFIG = {
  mostCursedFailStreak: 5,
  bigFall: 4,
  slowMilestoneLevel: 4,
  slowMilestoneAttempts: 20,
  unmovableBand: 1,
  unmovableLength: 15,
};

function longestSameLevelFailStreak(history: AttemptResult[]): { length: number; level: number } {
  let best = 0;
  let bestLevel = -1;
  let cur = 0;
  let curLevel = -1;
  for (const h of history) {
    if (!h.success && h.before === curLevel) cur++;
    else if (!h.success) {
      curLevel = h.before;
      cur = 1;
    } else {
      cur = 0;
      curLevel = -1;
    }
    if (cur > best) {
      best = cur;
      bestLevel = curLevel;
    }
  }
  return { length: best, level: bestLevel };
}

/** Найдовше "застрягання" — вікно спроб, де рівень не виходив за межі
 * ±unmovableBand від стартового значення цього вікна. */
function longestStagnation(history: AttemptResult[]): { length: number; level: number; startAttempt: number } {
  let best = { length: 0, level: 0, startAttempt: 0 };
  for (let i = 0; i < history.length; i++) {
    const base = history[i].before;
    let j = i;
    while (j < history.length && Math.abs(history[j].after - base) <= CONFIG.unmovableBand) j++;
    const length = j - i;
    if (length > best.length) best = { length, level: base, startAttempt: i + 1 };
  }
  return best;
}

export function buildHallOfShame(history: AttemptResult[], stats: SessionStats): ShameEntry[] {
  const entries: ShameEntry[] = [];

  if (stats.longestFailStreak >= CONFIG.mostCursedFailStreak) {
    entries.push({
      title: 'НАЙПРОКЛЯТІШИЙ ВІДРІЗОК',
      line: `${stats.longestFailStreak} провалів поспіль. Камінці вже сміялися в обличчя.`,
    });
  }

  if (stats.biggestDrop >= CONFIG.bigFall) {
    const dropAttempt = history.find((h) => h.before - h.after === stats.biggestDrop);
    if (dropAttempt) {
      entries.push({
        title: 'ВЕЛИКЕ ПАДІННЯ',
        line: `+${dropAttempt.before} → +${dropAttempt.after} за одну спробу. Гравітація не пробачає.`,
      });
    }
  }

  const sameLevel = longestSameLevelFailStreak(history);
  if (sameLevel.length >= 5) {
    entries.push({
      title: 'КРИВАВЕ ЖЕРТВОПРИНОШЕННЯ',
      line: `${sameLevel.length} провалів поспіль саме на +${sameLevel.level}. Це вже особисте.`,
    });
  }

  const milestoneAttempt = history.findIndex((h) => h.after >= CONFIG.slowMilestoneLevel);
  if (milestoneAttempt >= CONFIG.slowMilestoneAttempts) {
    entries.push({
      title: 'ЗАЩО',
      line: `${milestoneAttempt + 1} спроб, щоб уперше дійти до +${CONFIG.slowMilestoneLevel}. Черепахи б заздрили.`,
    });
  }

  const stagnation = longestStagnation(history);
  if (stagnation.length >= CONFIG.unmovableLength) {
    entries.push({
      title: 'НЕЗРУШНИЙ',
      line: `${stagnation.length} спроб навколо +${stagnation.level} без реального прогресу, починаючи зі спроби №${stagnation.startAttempt}.`,
    });
  }

  return entries;
}

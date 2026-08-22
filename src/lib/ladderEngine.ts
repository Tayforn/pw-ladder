// =========================================================
// Ігровий рушій ладдера — спрощена версія attempt() з pw-calc
// (src/lib/refineSim.ts): та сама таблиця шансів і поведінка при
// провалі, але без itemType/цілі/авто-прогону — тут кожна спроба це
// клік по одній з 4 кнопок, а "валюта" не золото, а бали.
//
// ДВА ПРЕДМЕТИ (механіка "підставної шмотки"): слоти a/b, кожен зі своїм
// рівнем. "Основна" — той, у кого рівень вищий (липко: при рівності роль
// не міняється), другий — "підставна". Успіх основної дає
// pointsPerSuccess, підставної — decoyPointsPerSuccess. Підставна
// перевищила основну → міняються ролями (рокіровка). Бали і ліміт спроб
// спільні — ритуал на підставній коштує бюджету 200 так само.
//
// Провал: world — рівень лишається; under — рівень -1; mirage/sky — рівень
// скидається на 0.
//
// Історія зберігається ХРОНОЛОГІЧНО (найстаріша спроба — перша), ОДНА на
// обидва предмети (поле item), і НЕ обрізається: природний ліміт —
// MAX_ATTEMPTS. Похідні модулі (sessionStats/rngProfile/titles/
// hallOfShame/ritual) рахують усе інше з неї, не чіпаючи сам кидок RNG.
// =========================================================

import { useCallback, useEffect, useState } from 'react';
import { MAX_LEVEL, RATES, type StoneMethod } from '../data/refineRates';
import type { LadderSettings } from '../data/ladder';
import { labelsFor, tierFor } from './criticalMoments';
import { otherSlot, type AttemptResult, type ItemSlot } from './types';

export const MAX_ATTEMPTS = 200;
/** "Скинути прогрес" розблоковується лише після стількох спроб — щоб не
 * можна було дешево перекидати невдалий старт забігу. */
export const MIN_ATTEMPTS_FOR_RESET = 150;

export type { AttemptResult };

export interface LadderGameState {
  levels: Record<ItemSlot, number>;
  /** Слот, що зараз "основна". Липке правило — міняється лише коли інший
   * слот СТРОГО вищий. */
  mainSlot: ItemSlot;
  points: number;
  attempts: number;
  history: AttemptResult[];
}

export const EMPTY_STATE: LadderGameState = { levels: { a: 0, b: 0 }, mainSlot: 'a', points: 0, attempts: 0, history: [] };
/** Поточний забіг переживає перезавантаження сторінки — інакше "скинути
 * прогрес можна лише після 150 спроб" обходиться банальним F5. */
const PROGRESS_KEY = 'ladder-progress';

/** Старі історії (до механіки двох предметів) не мають item/role —
 * заповнюємо дефолтами: усе було на слоті a в ролі основної. */
export function normalizeHistory(history: unknown[]): AttemptResult[] {
  return history.map((raw) => {
    const h = raw as Partial<AttemptResult>;
    return {
      ...(h as AttemptResult),
      item: h.item === 'b' ? 'b' : 'a',
      role: h.role === 'decoy' ? 'decoy' : 'main',
      labels: Array.isArray(h.labels) ? h.labels : [],
      tier: h.tier ?? 'normal',
    };
  });
}

function loadProgress(): LadderGameState {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return EMPTY_STATE;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.points !== 'number' || typeof parsed?.attempts !== 'number' || !Array.isArray(parsed?.history)) {
      return EMPTY_STATE;
    }
    const history = normalizeHistory(parsed.history);
    // Новий формат
    if (parsed.levels && typeof parsed.levels.a === 'number' && typeof parsed.levels.b === 'number') {
      return {
        levels: { a: parsed.levels.a, b: parsed.levels.b },
        mainSlot: parsed.mainSlot === 'b' ? 'b' : 'a',
        points: parsed.points,
        attempts: parsed.attempts,
        history,
      };
    }
    // Старий формат { level, ... } — один предмет у слоті a
    if (typeof parsed.level === 'number') {
      return { levels: { a: parsed.level, b: 0 }, mainSlot: 'a', points: parsed.points, attempts: parsed.attempts, history };
    }
  } catch {
    /* ignore — пошкоджені/старі дані, починаємо заново */
  }
  return EMPTY_STATE;
}

export function costFor(method: StoneMethod, settings: LadderSettings): number {
  if (method === 'mirage') return 0;
  if (method === 'sky') return settings.skyCost;
  if (method === 'under') return settings.underCost;
  return settings.worldCost;
}

export const mainLevel = (s: LadderGameState): number => s.levels[s.mainSlot];
export const decoyLevel = (s: LadderGameState): number => s.levels[otherSlot(s.mainSlot)];
/** Рівень, що піде в ладдер, — вищий із двох. */
export const ladderLevel = (s: LadderGameState): number => Math.max(s.levels.a, s.levels.b);

/** Чистий крок гри — ВСЯ ігрова логіка однієї спроби на предметі `item`.
 * `roll` ін'єктується: Math.random у проді, seeded RNG у тестах/симуляціях.
 * Повертає той самий стан, якщо спроба неможлива (ліміт, макс. рівень
 * цього предмета, нема балів). */
export function applyAttempt(
  s: LadderGameState,
  item: ItemSlot,
  method: StoneMethod,
  settings: LadderSettings,
  roll: () => number = Math.random,
): LadderGameState {
  const before = s.levels[item];
  if (before >= MAX_LEVEL || s.attempts >= MAX_ATTEMPTS) return s;
  const cost = costFor(method, settings);
  if (s.points < cost) return s;
  const p = RATES[method][before + 1];
  if (!p) return s;

  const role = item === s.mainSlot ? 'main' : 'decoy';
  const success = roll() < p;
  let level = before;
  let points = s.points - cost;

  if (success) {
    level = before + 1;
    points += role === 'main' ? settings.pointsPerSuccess : settings.decoyPointsPerSuccess;
  } else if (method === 'world') {
    /* рівень лишається */
  } else if (method === 'under') {
    level = Math.max(0, before - 1);
  } else {
    level = 0; // mirage / sky
  }

  const levels = { ...s.levels, [item]: level };
  // Рокіровка: другий слот СТРОГО вищий за поточну основну.
  const mainSlot = levels[otherSlot(s.mainSlot)] > levels[s.mainSlot] ? otherSlot(s.mainSlot) : s.mainSlot;

  const raw = { method, success, before, after: level, p };
  const record: AttemptResult = {
    ...raw,
    item,
    role,
    tier: tierFor(before),
    labels: labelsFor(raw, s.history, s.history.filter((h) => h.item === item)),
  };
  return { levels, mainSlot, points, attempts: s.attempts + 1, history: [...s.history, record] };
}

export function useLadderGame(settings: LadderSettings) {
  const [state, setState] = useState<LadderGameState>(loadProgress);

  useEffect(() => {
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state]);

  const canUse = useCallback(
    (item: ItemSlot, method: StoneMethod) =>
      state.levels[item] < MAX_LEVEL && state.attempts < MAX_ATTEMPTS && state.points >= costFor(method, settings),
    [state.levels, state.attempts, state.points, settings],
  );

  const attempt = useCallback(
    (item: ItemSlot, method: StoneMethod) => setState((s) => applyAttempt(s, item, method, settings)),
    [settings],
  );

  const reset = useCallback(() => setState(EMPTY_STATE), []);

  return { state, attempt, canUse, reset };
}

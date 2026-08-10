// =========================================================
// Ігровий рушій ладдера — спрощена версія attempt() з pw-calc
// (src/lib/refineSim.ts): та сама таблиця шансів і поведінка при
// провалі, але без itemType/цілі/авто-прогону — тут кожна спроба це
// клік по одній з 4 кнопок, а "валюта" не золото, а бали.
//
// Провал: world — рівень лишається; under — рівень -1; mirage/sky — рівень
// скидається на 0. Успіх завжди дає +pointsPerSuccess (і, крім mirage,
// коштує балів наперед — списується незалежно від результату).
//
// MAX_ATTEMPTS — ліміт на "забіг" (усі 4 кнопки разом): після 200-ї спроби
// подальші клікі блокуються, App.tsx сам вносить поточний результат у
// ладдер і скидає прогрес (див. useEffect там).
//
// Історія зберігається ХРОНОЛОГІЧНО (найстаріша спроба — перша) і НЕ
// обрізається: природний ліміт — MAX_ATTEMPTS, тож масив ніколи не
// перевищує 200 записів. Це та сама "complete immutable attempt history",
// з якої похідні модулі (sessionStats/rngProfile/titles/hallOfShame)
// рахують усе інше, не чіпаючи сам кидок RNG.
// =========================================================

import { useCallback, useEffect, useState } from 'react';
import { MAX_LEVEL, RATES, type StoneMethod } from '../data/refineRates';
import type { LadderSettings } from '../data/ladder';
import { labelsFor, tierFor } from './criticalMoments';
import type { AttemptResult } from './types';

export const MAX_ATTEMPTS = 200;

export type { AttemptResult };

export interface LadderGameState {
  level: number;
  points: number;
  attempts: number;
  history: AttemptResult[];
}

const EMPTY_STATE: LadderGameState = { level: 0, points: 0, attempts: 0, history: [] };
/** Поточний забіг переживає перезавантаження сторінки — інакше "скинути
 * прогрес можна лише після 150 спроб" обходиться банальним F5. */
const PROGRESS_KEY = 'ladder-progress';

function loadProgress(): LadderGameState {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return EMPTY_STATE;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.level === 'number' && typeof parsed?.points === 'number' &&
      typeof parsed?.attempts === 'number' && Array.isArray(parsed?.history)
    ) {
      return parsed as LadderGameState;
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

/** Чистий крок гри — ВСЯ ігрова логіка однієї спроби. `roll` ін'єктується:
 * Math.random у проді, seeded RNG у тестах/симуляціях (щоб калібрування
 * титулів і property-тести були відтворюваними). Повертає той самий стан,
 * якщо спроба неможлива (ліміт, макс. рівень, нема балів). */
export function applyAttempt(
  s: LadderGameState,
  method: StoneMethod,
  settings: LadderSettings,
  roll: () => number = Math.random,
): LadderGameState {
  if (s.level >= MAX_LEVEL || s.attempts >= MAX_ATTEMPTS) return s;
  const cost = costFor(method, settings);
  if (s.points < cost) return s;
  const p = RATES[method][s.level + 1];
  if (!p) return s;

  const success = roll() < p;
  const before = s.level;
  let level = before;
  let points = s.points - cost;

  if (success) {
    level = before + 1;
    points += settings.pointsPerSuccess;
  } else if (method === 'world') {
    /* рівень лишається */
  } else if (method === 'under') {
    level = Math.max(0, before - 1);
  } else {
    level = 0; // mirage / sky
  }

  const raw = { method, success, before, after: level, p };
  const record: AttemptResult = { ...raw, tier: tierFor(before), labels: labelsFor(raw, s.history) };
  return { level, points, attempts: s.attempts + 1, history: [...s.history, record] };
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
    (method: StoneMethod) => state.level < MAX_LEVEL && state.attempts < MAX_ATTEMPTS && state.points >= costFor(method, settings),
    [state.level, state.attempts, state.points, settings],
  );

  const attempt = useCallback(
    (method: StoneMethod) => setState((s) => applyAttempt(s, method, settings)),
    [settings],
  );

  const reset = useCallback(() => setState(EMPTY_STATE), []);

  return { state, attempt, canUse, reset };
}

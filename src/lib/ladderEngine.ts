// =========================================================
// Ігровий рушій ладдера — спрощена версія attempt() з pw-calc
// (src/lib/refineSim.ts): та сама таблиця шансів і поведінка при
// провалі, але без itemType/цілі/авто-прогону — тут кожна спроба це
// клік по одній з 4 кнопок, а "валюта" не золото, а бали.
//
// Провал: world — рівень лишається; under — рівень -1; mirage/sky — рівень
// скидається на 0. Успіх завжди дає +pointsPerSuccess (і, крім mirage,
// коштує балів наперед — списується незалежно від результату).
// =========================================================

import { useCallback, useState } from 'react';
import { MAX_LEVEL, RATES, type StoneMethod } from '../data/refineRates';
import type { LadderSettings } from '../data/ladder';

export interface AttemptResult {
  method: StoneMethod;
  success: boolean;
  before: number;
  after: number;
}

export interface LadderGameState {
  level: number;
  points: number;
  attempts: number;
  history: AttemptResult[];
}

const HISTORY_MAX = 50;

export function costFor(method: StoneMethod, settings: LadderSettings): number {
  if (method === 'mirage') return 0;
  if (method === 'sky') return settings.skyCost;
  if (method === 'under') return settings.underCost;
  return settings.worldCost;
}

export function useLadderGame(settings: LadderSettings) {
  const [state, setState] = useState<LadderGameState>({ level: 0, points: 0, attempts: 0, history: [] });

  const canUse = useCallback(
    (method: StoneMethod) => state.level < MAX_LEVEL && state.points >= costFor(method, settings),
    [state.level, state.points, settings],
  );

  const attempt = useCallback(
    (method: StoneMethod) => {
      setState((s) => {
        if (s.level >= MAX_LEVEL) return s;
        const cost = costFor(method, settings);
        if (s.points < cost) return s;
        const p = RATES[method][s.level + 1];
        if (!p) return s;

        const success = Math.random() < p;
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

        const record: AttemptResult = { method, success, before, after: level };
        return { level, points, attempts: s.attempts + 1, history: [record, ...s.history].slice(0, HISTORY_MAX) };
      });
    },
    [settings],
  );

  const reset = useCallback(() => setState({ level: 0, points: 0, attempts: 0, history: [] }), []);

  return { state, attempt, canUse, reset };
}

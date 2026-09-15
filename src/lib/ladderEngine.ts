// =========================================================
// Ігровий рушій ладдера на клієнті. Самі правила спроби живуть у
// engineCore.ts (спільні з сервером); тут — стан з історією для UI,
// збереження в localStorage і React-хук.
//
// Історія зберігається ХРОНОЛОГІЧНО (найстаріша спроба — перша), ОДНА на
// всі предмети (поле item), і НЕ обрізається. Похідні модулі (sessionStats/
// rngProfile/titles/hallOfShame/ritual) рахують усе з неї, не чіпаючи RNG.
// =========================================================

import { useCallback, useEffect, useState } from 'react';
import type { StoneMethod } from '../data/refineRates';
import type { LadderSettings } from '../data/ladder';
import {
  EMPTY_CORE, ZERO_LEVELS, ZERO_USED, allowedSlots, decorate, maxLevel, remainingFor, transition, type EngineCore,
} from './engineCore';
import { ALL_SLOTS, type AttemptResult, type ItemSlot } from './types';

export type { AttemptResult };
export { remainingFor };

export interface LadderGameState extends EngineCore {
  history: AttemptResult[];
}

export const EMPTY_STATE: LadderGameState = { ...EMPTY_CORE, levels: { ...ZERO_LEVELS }, used: { ...ZERO_USED }, history: [] };

/** Поточний забіг переживає перезавантаження сторінки — інакше замок
 * "скинути прогрес лише після половини міражів" обходиться банальним F5. */
const PROGRESS_KEY = 'ladder-progress';

/** Поріг розблокування "Скинути прогрес" — окреме поле адмінки (0012). */
export const resetUnlockAt = (settings: LadderSettings): number => Math.max(0, settings.resetUnlockAttempts);

/** Слоти, доступні в поточних налаштуваннях: 'a' + decoyCount підставних.
 * Слоти, на яких УЖЕ є історія (адмін зменшив ліміт посеред забігу),
 * лишаються видимими. */
export function activeSlots(s: LadderGameState, settings: LadderSettings): ItemSlot[] {
  const allowed = allowedSlots(settings);
  const inPlay = ALL_SLOTS.filter((slot) => s.levels[slot] > 0 || s.history.some((h) => h.item === slot));
  return ALL_SLOTS.filter((slot) => allowed.includes(slot) || inPlay.includes(slot));
}

/** Старі історії не мають item/role — заповнюємо дефолтами (слот a, основна). */
export function normalizeHistory(history: unknown[]): AttemptResult[] {
  return history.map((raw) => {
    const h = raw as Partial<AttemptResult>;
    return {
      ...(h as AttemptResult),
      item: h.item && ALL_SLOTS.includes(h.item) ? h.item : 'a',
      role: h.role === 'decoy' ? 'decoy' : 'main',
      labels: Array.isArray(h.labels) ? h.labels : [],
      tier: h.tier ?? 'normal',
    };
  });
}

function usedFrom(history: AttemptResult[]): Record<StoneMethod, number> {
  const used = { ...ZERO_USED };
  for (const h of history) used[h.method]++;
  return used;
}

function loadProgress(): LadderGameState {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return EMPTY_STATE;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.attempts !== 'number' || !Array.isArray(parsed?.history)) return EMPTY_STATE;
    const history = normalizeHistory(parsed.history);
    const levels = { ...ZERO_LEVELS };
    if (parsed.levels && typeof parsed.levels === 'object') {
      for (const slot of ALL_SLOTS) {
        if (typeof parsed.levels[slot] === 'number') levels[slot] = parsed.levels[slot];
      }
    } else if (typeof parsed.level === 'number') {
      levels.a = parsed.level; // найстаріший формат (один предмет)
    }
    return {
      levels,
      mainSlot: ALL_SLOTS.includes(parsed.mainSlot) ? parsed.mainSlot : 'a',
      used: usedFrom(history),
      attempts: parsed.attempts,
      history,
    };
  } catch {
    /* ignore — пошкоджені/старі дані, починаємо заново */
  }
  return EMPTY_STATE;
}

export const mainLevel = (s: LadderGameState): number => s.levels[s.mainSlot];
/** Рівень, що піде в ладдер, — найвищий серед усіх предметів. */
export const ladderLevel = (s: LadderGameState): number => maxLevel(s.levels);

/** Одна спроба на предметі `item` з додаванням у історію. `roll`
 * ін'єктується: Math.random у проді, seeded RNG у тестах/симуляціях.
 * Повертає той самий стан, якщо спроба неможлива. */
export function applyAttempt(
  s: LadderGameState,
  item: ItemSlot,
  method: StoneMethod,
  settings: LadderSettings,
  roll: () => number = Math.random,
): LadderGameState {
  const next = transition(s, item, method, settings, roll);
  if (!next) return s;
  return { ...next.core, history: [...s.history, decorate(next.attempt, s.history)] };
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
    (item: ItemSlot, method: StoneMethod) => transition(state, item, method, settings, () => 1) !== null,
    [state, settings],
  );

  const attempt = useCallback(
    (item: ItemSlot, method: StoneMethod) => setState((s) => applyAttempt(s, item, method, settings)),
    [settings],
  );

  const reset = useCallback(() => setState(EMPTY_STATE), []);

  return { state, attempt, canUse, reset };
}

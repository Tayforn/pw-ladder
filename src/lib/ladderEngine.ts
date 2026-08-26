// =========================================================
// Ігровий рушій ладдера — економіка РЕСУРСІВ (з 0009):
//
//  * МІРАЖ = СПРОБА. Кожна спроба будь-яким методом споживає 1 міраж;
//    спроба каменем додатково споживає 1 одиницю відповідного каменя.
//    Тож attempts == спожиті міражі, а лишок міражів = mirageCount - attempts.
//  * Ліміти (mirageCount / skyCount / underCount / worldCount / decoyCount)
//    видає адмінка через ladder_settings.
//  * Балів немає. Успіх — це просто +1 рівень.
//  * Предмети: слот 'a' + до decoyCount підставних ('b'..'f'), кожен зі
//    своїм рівнем. "Основна" — найвищий рівень (роль липка: міняється лише
//    коли інший слот СТРОГО вищий); рокіровка міняє їх місцями в UI.
//
// Провал: world — рівень лишається; under — рівень -1; mirage/sky — рівень
// скидається на 0.
//
// Історія зберігається ХРОНОЛОГІЧНО (найстаріша спроба — перша), ОДНА на
// всі предмети (поле item), і НЕ обрізається. Похідні модулі (sessionStats/
// rngProfile/titles/hallOfShame/ritual) рахують усе з неї, не чіпаючи RNG.
// =========================================================

import { useCallback, useEffect, useState } from 'react';
import { MAX_LEVEL, RATES, type StoneMethod } from '../data/refineRates';
import type { LadderSettings } from '../data/ladder';
import { labelsFor, tierFor } from './criticalMoments';
import { ALL_SLOTS, type AttemptResult, type ItemSlot } from './types';

export type { AttemptResult };

export interface LadderGameState {
  levels: Record<ItemSlot, number>;
  /** Слот, що зараз "основна". Липке правило — міняється лише коли інший
   * слот СТРОГО вищий (при кількох рівних вищих — менша літера). */
  mainSlot: ItemSlot;
  /** Скільки спроб зроблено КОЖНИМ методом (used.mirage — спроби саме
   * міражем; спожиті міражі як ресурс — це attempts, бо міраж = спроба). */
  used: Record<StoneMethod, number>;
  attempts: number;
  history: AttemptResult[];
}

const ZERO_LEVELS: Record<ItemSlot, number> = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 };
const ZERO_USED: Record<StoneMethod, number> = { mirage: 0, sky: 0, under: 0, world: 0 };
export const EMPTY_STATE: LadderGameState = {
  levels: { ...ZERO_LEVELS },
  mainSlot: 'a',
  used: { ...ZERO_USED },
  attempts: 0,
  history: [],
};

/** Поточний забіг переживає перезавантаження сторінки — інакше замок
 * "скинути прогрес лише після половини міражів" обходиться банальним F5. */
const PROGRESS_KEY = 'ladder-progress';

/** Скільки одиниць ресурсу лишилось. Для mirage — це лишок СПРОБ. */
export function remainingFor(method: StoneMethod, s: LadderGameState, settings: LadderSettings): number {
  if (method === 'mirage') return Math.max(0, settings.mirageCount - s.attempts);
  const limit = method === 'sky' ? settings.skyCount : method === 'under' ? settings.underCount : settings.worldCount;
  return Math.max(0, limit - s.used[method]);
}

/** Поріг розблокування "Скинути прогрес" — половина міражів. */
export const resetUnlockAt = (settings: LadderSettings): number => Math.ceil(settings.mirageCount / 2);

/** Слоти, доступні в поточних налаштуваннях: 'a' + decoyCount підставних.
 * Слоти, на яких УЖЕ є історія (адмін зменшив ліміт посеред забігу),
 * лишаються видимими. */
export function activeSlots(s: LadderGameState, settings: LadderSettings): ItemSlot[] {
  const allowed = ALL_SLOTS.slice(0, Math.min(6, 1 + Math.max(0, settings.decoyCount)));
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
export const ladderLevel = (s: LadderGameState): number => Math.max(...ALL_SLOTS.map((slot) => s.levels[slot]));

/** Чистий крок гри — ВСЯ ігрова логіка однієї спроби на предметі `item`.
 * `roll` ін'єктується: Math.random у проді, seeded RNG у тестах/симуляціях.
 * Повертає той самий стан, якщо спроба неможлива (нема міражів, нема цього
 * каменя, макс. рівень предмета). */
export function applyAttempt(
  s: LadderGameState,
  item: ItemSlot,
  method: StoneMethod,
  settings: LadderSettings,
  roll: () => number = Math.random,
): LadderGameState {
  const before = s.levels[item];
  if (before >= MAX_LEVEL) return s;
  if (remainingFor('mirage', s, settings) <= 0) return s;
  if (method !== 'mirage' && remainingFor(method, s, settings) <= 0) return s;
  const p = RATES[method][before + 1];
  if (!p) return s;

  const role = item === s.mainSlot ? 'main' : 'decoy';
  const success = roll() < p;
  let level = before;

  if (success) {
    level = before + 1;
  } else if (method === 'world') {
    /* рівень лишається */
  } else if (method === 'under') {
    level = Math.max(0, before - 1);
  } else {
    level = 0; // mirage / sky
  }

  const levels = { ...s.levels, [item]: level };
  // Рокіровка: основною стає слот зі СТРОГО вищим рівнем (липко).
  let mainSlot = s.mainSlot;
  for (const slot of ALL_SLOTS) {
    if (levels[slot] > levels[mainSlot]) mainSlot = slot;
  }

  const raw = { method, success, before, after: level, p };
  const record: AttemptResult = {
    ...raw,
    item,
    role,
    tier: tierFor(before),
    labels: labelsFor(raw, s.history, s.history.filter((h) => h.item === item)),
  };
  return {
    levels,
    mainSlot,
    used: { ...s.used, [method]: s.used[method] + 1 },
    attempts: s.attempts + 1,
    history: [...s.history, record],
  };
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
      state.levels[item] < MAX_LEVEL &&
      remainingFor('mirage', state, settings) > 0 &&
      (method === 'mirage' || remainingFor(method, state, settings) > 0),
    [state, settings],
  );

  const attempt = useCallback(
    (item: ItemSlot, method: StoneMethod) => setState((s) => applyAttempt(s, item, method, settings)),
    [settings],
  );

  const reset = useCallback(() => setState(EMPTY_STATE), []);

  return { state, attempt, canUse, reset };
}

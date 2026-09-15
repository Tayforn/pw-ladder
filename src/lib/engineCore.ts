// =========================================================
// Чисте ядро правил заточки: одна спроба = один перехід стану. Без React,
// без Supabase і без історії — тому його імпортують і клієнт
// (ladderEngine.ts), і сервер (server/), і правила існують в одному місці.
//
//  * Кожна спроба будь-яким методом споживає 1 міраж; спроба каменем —
//    додатково 1 одиницю цього каменя.
//  * Провал: world — рівень лишається; under — рівень -1; mirage/sky — 0.
//  * Основна — слот зі СТРОГО найвищим рівнем (роль липка).
// =========================================================

import { MAX_LEVEL, RATES, type StoneMethod } from '../data/refineRates';
import { labelsFor, tierFor } from './criticalMoments';
import { ALL_SLOTS, type AttemptResult, type ItemRole, type ItemSlot } from './types';

/** Ліміти ресурсів забігу — підмножина налаштувань адмінки. */
export interface ResourceLimits {
  mirageCount: number;
  skyCount: number;
  underCount: number;
  worldCount: number;
  decoyCount: number;
}

export interface EngineCore {
  levels: Record<ItemSlot, number>;
  mainSlot: ItemSlot;
  /** Скільки спроб зроблено КОЖНИМ методом. */
  used: Record<StoneMethod, number>;
  attempts: number;
}

/** Спроба без презентаційних полів (tier/labels) — те, що зберігає сервер. */
export interface RawAttempt {
  method: StoneMethod;
  success: boolean;
  before: number;
  after: number;
  p: number;
  item: ItemSlot;
  role: ItemRole;
}

export const ZERO_LEVELS: Record<ItemSlot, number> = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 };
export const ZERO_USED: Record<StoneMethod, number> = { mirage: 0, sky: 0, under: 0, world: 0 };
export const EMPTY_CORE: EngineCore = { levels: { ...ZERO_LEVELS }, mainSlot: 'a', used: { ...ZERO_USED }, attempts: 0 };

/** Скільки одиниць ресурсу лишилось. Для mirage — це лишок СПРОБ. */
export function remainingFor(method: StoneMethod, s: EngineCore, limits: ResourceLimits): number {
  if (method === 'mirage') return Math.max(0, limits.mirageCount - s.attempts);
  const limit = method === 'sky' ? limits.skyCount : method === 'under' ? limits.underCount : limits.worldCount;
  return Math.max(0, limit - s.used[method]);
}

/** Слоти, дозволені налаштуваннями: 'a' + decoyCount підставних. */
export function allowedSlots(limits: Pick<ResourceLimits, 'decoyCount'>): ItemSlot[] {
  return ALL_SLOTS.slice(0, Math.min(ALL_SLOTS.length, 1 + Math.max(0, limits.decoyCount)));
}

export const maxLevel = (levels: Record<ItemSlot, number>): number => Math.max(...ALL_SLOTS.map((slot) => levels[slot]));

/** Один крок гри. `roll` — число в [0, 1): Math.random у тестах клієнта,
 * криптографічний генератор на сервері. null — спроба неможлива (нема
 * міражів чи цього каменя, предмет на максимумі). */
export function transition(
  s: EngineCore,
  item: ItemSlot,
  method: StoneMethod,
  limits: ResourceLimits,
  roll: () => number,
): { core: EngineCore; attempt: RawAttempt } | null {
  const before = s.levels[item];
  if (before >= MAX_LEVEL) return null;
  if (remainingFor('mirage', s, limits) <= 0) return null;
  if (method !== 'mirage' && remainingFor(method, s, limits) <= 0) return null;
  const p = RATES[method][before + 1];
  if (!p) return null;

  const role: ItemRole = item === s.mainSlot ? 'main' : 'decoy';
  const success = roll() < p;
  let after = before;
  if (success) after = before + 1;
  else if (method === 'under') after = Math.max(0, before - 1);
  else if (method !== 'world') after = 0;

  const levels = { ...s.levels, [item]: after };
  let mainSlot = s.mainSlot;
  for (const slot of ALL_SLOTS) {
    if (levels[slot] > levels[mainSlot]) mainSlot = slot;
  }

  return {
    core: { levels, mainSlot, used: { ...s.used, [method]: s.used[method] + 1 }, attempts: s.attempts + 1 },
    attempt: { method, success, before, after, p, item, role },
  };
}

/** Додає презентаційні поля до сирої спроби; `prior` — уся історія ДО неї. */
export function decorate(raw: RawAttempt, prior: AttemptResult[]): AttemptResult {
  return {
    ...raw,
    tier: tierFor(raw.before),
    labels: labelsFor(raw, prior, prior.filter((h) => h.item === raw.item)),
  };
}

export function decorateHistory(raws: RawAttempt[]): AttemptResult[] {
  const out: AttemptResult[] = [];
  for (const raw of raws) out.push(decorate(raw, out));
  return out;
}

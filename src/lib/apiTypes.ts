// =========================================================
// Контракт між фронтендом і бекендом (server/). Лише типи й константи —
// без залежностей від React, Supabase чи Node, тож файл імпортують обидві
// сторони.
// =========================================================

import type { StoneMethod } from '../data/refineRates';
import type { RawAttempt } from './engineCore';
import type { ItemSlot } from './types';

/** Налаштування, з якими грається конкретний забіг. Сервер фіксує їх на
 * старті забігу: зміни в адмінці діють лише на наступні забіги. */
export interface RunSettings {
  mirageCount: number;
  skyCount: number;
  underCount: number;
  worldCount: number;
  decoyCount: number;
  resetUnlockAttempts: number;
  /** Темп: у середньому не частіше однієї спроби за стільки мілісекунд. */
  minAttemptMs: number;
  /** Скільки спроб поспіль можна зробити швидше за minAttemptMs. */
  burstAttempts: number;
  /** Випадкова перевірка присутності в середньому раз на стільки спроб; 0 — вимкнено. */
  challengeEveryAttempts: number;
  /** Перевірка після стількох хвилин гри без пауз; 0 — вимкнено. */
  sessionChallengeMinutes: number;
  /** «Талан»: найкращий рівень за перші стільки забігів. */
  talanRuns: number;
}

export const DEFAULT_RUN_SETTINGS: RunSettings = {
  mirageCount: 200,
  skyCount: 15,
  underCount: 15,
  worldCount: 30,
  decoyCount: 1,
  resetUnlockAttempts: 100,
  minAttemptMs: 150,
  burstAttempts: 5,
  challengeEveryAttempts: 300,
  sessionChallengeMinutes: 60,
  talanRuns: 10,
};

export interface Me {
  playerId: string;
  nickname: string;
  avatarUrl: string | null;
  runsCount: number;
}

export type ChallengeReason = 'random' | 'session' | 'rhythm' | 'record';

/** Перевірка присутності: показати `options` каменів, підсвітити `target`. */
export interface ChallengeView {
  id: string;
  reason: ChallengeReason;
  options: number;
  target: number;
}

export interface RunState {
  id: string;
  runIndex: number;
  settings: RunSettings;
  levels: Record<ItemSlot, number>;
  mainSlot: ItemSlot;
  used: Record<StoneMethod, number>;
  attempts: number;
  challenge: ChallengeView | null;
}

export interface RunView extends RunState {
  history: RawAttempt[];
}

export type FinishStatus = 'submitted' | 'finished' | 'reset';

export interface FinishView {
  runId: string;
  status: FinishStatus;
  runIndex: number;
  level: number;
  attempts: number;
  /** Рівень вищий за попередній запис гравця в ладдері. */
  newRecord: boolean;
  boardUpdated: boolean;
  talanUpdated: boolean;
  runsCount: number;
  settings: RunSettings;
  history: RawAttempt[];
}

export interface AttemptRequest {
  item: ItemSlot;
  method: StoneMethod;
  /** Точка кліку всередині кнопки, 0..1 по кожній осі. */
  clickX?: number | null;
  clickY?: number | null;
  /** Мілісекунд від попереднього прийнятого кліку за годинником браузера. */
  clientDt?: number | null;
  pointer?: string | null;
}

export interface AttemptResponse {
  attempt: RawAttempt;
  /** null — забіг завершився цією спробою (див. finished). */
  run: RunState | null;
  finished: FinishView | null;
}

export interface ChallengeAnswer {
  id: string;
  choice: number;
}

export interface ChallengeResponse {
  passed: boolean;
  run: RunState | null;
  finished: FinishView | null;
}

export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'no_active_run'
  | 'challenge_required'
  | 'too_fast'
  | 'invalid_attempt'
  | 'reset_locked'
  | 'bad_request'
  | 'bad_origin'
  | 'rate_limited'
  | 'internal';

export interface ApiErrorBody {
  error: ApiErrorCode;
  message: string;
  retryAfterMs?: number;
  challenge?: ChallengeView;
}

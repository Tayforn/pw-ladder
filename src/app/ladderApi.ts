// =========================================================
// Клієнт бекенда ладдера (Hetzner). Усі виклики йдуть на той самий домен
// під /api (Caddy проксить на бекенд), cookie сесії їде автоматично.
// У режимі розробки Vite проксить /api на localhost:3001 (vite.config.ts),
// тож база завжди '/api' і CORS не потрібен.
// =========================================================

import type {
  AttemptRequest, AttemptResponse, ChallengeAnswer, ChallengeResponse, FinishView,
  LadderView, Me, RunSettings, RunView,
} from '../lib/apiTypes';
import type { ApiErrorBody, ApiErrorCode } from '../lib/apiTypes';
import type { AttemptResult } from '../lib/types';

const API_BASE = (import.meta.env.VITE_API_BASE ?? '/api').replace(/\/+$/, '');

/** Помилка з кодом контракту — UI розрізняє challenge_required, too_fast тощо. */
export class ApiClientError extends Error {
  readonly code: ApiErrorCode | 'network';
  readonly status: number;
  readonly body?: ApiErrorBody;
  constructor(status: number, body?: ApiErrorBody) {
    super(body?.message ?? `HTTP ${status}`);
    this.status = status;
    this.code = body?.error ?? 'network';
    this.body = body;
  }
}

async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      credentials: 'include',
      ...rest,
      headers: {
        ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...rest.headers,
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiClientError(0);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new ApiClientError(res.status, data as ApiErrorBody);
  return data as T;
}

const post = <T>(path: string, json?: unknown) => api<T>(path, { method: 'POST', json });

/** Повна адреса для переходу на вхід через Discord (навігація, не fetch). */
export const loginUrl = (): string => API_BASE + '/auth/login';

export const fetchMe = (): Promise<Me> => api<Me>('/me');
export const logout = (): Promise<void> => post<void>('/auth/logout');

export const fetchSettings = (): Promise<RunSettings> => api<RunSettings>('/settings');
export const fetchLadder = (): Promise<LadderView> => api<LadderView>('/ladder');
export const fetchRunHistory = (playerId: string): Promise<AttemptResult[]> =>
  api<{ history: AttemptResult[] }>(`/run-history/${encodeURIComponent(playerId)}`).then((r) => r.history);

export const fetchActiveRun = (): Promise<RunView | null> => api<RunView | null>('/run');
export const startRun = (): Promise<RunView> => post<RunView>('/run/start');
export const sendAttempt = (req: AttemptRequest): Promise<AttemptResponse> => post<AttemptResponse>('/run/attempt', req);
export const answerChallenge = (answer: ChallengeAnswer): Promise<ChallengeResponse> => post<ChallengeResponse>('/run/challenge', answer);
export const submitRun = (): Promise<FinishView> => post<FinishView>('/run/submit');
export const resetRun = (): Promise<FinishView> => post<FinishView>('/run/reset');

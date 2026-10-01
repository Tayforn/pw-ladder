// =========================================================
// Помилки бекенда з кодом із контракту apiTypes. Роут перетворює ApiError
// на JSON-відповідь із відповідним HTTP-статусом; усе інше — 500 internal.
// =========================================================

import type { ApiErrorCode, ChallengeView } from '../../src/lib/apiTypes';

const STATUS: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  no_active_run: 409,
  challenge_required: 428,
  too_fast: 429,
  invalid_attempt: 422,
  reset_locked: 409,
  bad_request: 400,
  bad_origin: 403,
  rate_limited: 429,
  conflict: 409,
  registration_closed: 409,
  duplicate_nickname: 409,
  already_registered: 409,
  internal: 500,
  upstream: 502,
  not_configured: 503,
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly retryAfterMs?: number;
  readonly challenge?: ChallengeView;

  constructor(code: ApiErrorCode, message: string, extra?: { retryAfterMs?: number; challenge?: ChallengeView }) {
    super(message);
    this.code = code;
    this.status = STATUS[code];
    this.retryAfterMs = extra?.retryAfterMs;
    this.challenge = extra?.challenge;
  }
}

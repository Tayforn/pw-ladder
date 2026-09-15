// =========================================================
// Темп спроб — token bucket: запас `burst` спроб, поповнюється на одну
// кожні `minIntervalMs`. У середньому не частіше однієї спроби за
// minIntervalMs, але кілька швидких кліків поспіль проходять.
// =========================================================

export interface Bucket {
  tokens: number;
  /** Мілісекунди, коли tokens було пораховано востаннє. */
  at: number;
}

export type TakeResult = { ok: true; bucket: Bucket } | { ok: false; retryAfterMs: number };

export function takeToken(bucket: Bucket, now: number, minIntervalMs: number, burst: number): TakeResult {
  const capacity = Math.max(1, burst);
  if (minIntervalMs <= 0) return { ok: true, bucket: { tokens: capacity, at: now } };
  // Годинник міг піти назад (перезапуск, синхронізація часу) — не караємо.
  const elapsed = Math.max(0, now - bucket.at);
  const tokens = Math.min(capacity, bucket.tokens + elapsed / minIntervalMs);
  if (tokens < 1) return { ok: false, retryAfterMs: Math.ceil((1 - tokens) * minIntervalMs) };
  return { ok: true, bucket: { tokens: tokens - 1, at: now } };
}

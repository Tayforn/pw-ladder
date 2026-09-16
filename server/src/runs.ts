// =========================================================
// Серверне ядро забігів — авторитетний стан гри. Кубик кидає сервер,
// стан живе в БД, темп і перевірки присутності перевіряються тут. Клієнт
// лише малює. Правила спроби спільні з фронтендом (src/lib/engineCore).
//
// Кожен публічний метод виконується в ОДНІЙ транзакції з `select ... for
// update` на рядку забігу, тож два одночасні кліки не обійдуть ні темп, ні
// ліміти. Один активний забіг на гравця (частковий унікальний індекс 0014).
// =========================================================

import { randomBytes } from 'node:crypto';
import type { Db, Queryable } from './db';
import { ApiError } from './errors';
import { makeChallenge, scheduleRandomCheck, sessionTooLong } from './challenges';
import { computeSignals, intervalCv, suspicionScore, type AttemptTiming } from './signals';
import { takeToken } from './pacing';
import type { StoneMethod } from '../../src/data/refineRates';
import { decorateHistory, maxLevel, transition, ZERO_USED, type RawAttempt, type ResourceLimits } from '../../src/lib/engineCore';
import { computeSessionStats } from '../../src/lib/sessionStats';
import { computeRngProfile } from '../../src/lib/rngProfile';
import { ALL_SLOTS, type ItemSlot } from '../../src/lib/types';
import {
  DEFAULT_RUN_SETTINGS,
  type AttemptRequest, type AttemptResponse, type ChallengeAnswer, type ChallengeResponse,
  type ChallengeReason, type ChallengeView, type FinishStatus, type FinishView,
  type RunSettings, type RunState, type RunView,
} from '../../src/lib/apiTypes';

export type Rng = () => number;

/** Криптографічно стійке число в [0, 1) — бойовий генератор кидків. */
export function cryptoRandom(): number {
  return randomBytes(6).readUIntBE(0, 6) / 2 ** 48;
}

const pickInt = (rng: Rng) => (n: number) => Math.floor(rng() * n);
const newId = () => randomBytes(9).toString('base64url');

/** Перевірку «новий рекорд» показуємо лише на значущих рівнях (+8 і вище —
 * та сама межа, що «значуща подія» в criticalMoments). Нижче нема що
 * захищати, а початківцям не варто ловити перевірку на першому ж успіху. */
const RECORD_CHALLENGE_MIN_LEVEL = 8;

const levelsRecord = (arr: number[]): Record<ItemSlot, number> => {
  const out: Record<ItemSlot, number> = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 };
  ALL_SLOTS.forEach((slot, i) => { out[slot] = arr[i] ?? 0; });
  return out;
};
const levelsArray = (rec: Record<ItemSlot, number>): number[] => ALL_SLOTS.map((slot) => rec[slot]);

interface RunRow {
  id: string;
  player_id: string;
  run_index: number;
  status: string;
  settings: RunSettings;
  levels: number[];
  main_slot: ItemSlot;
  used: Record<StoneMethod, number>;
  attempts: number;
  bucket_tokens: number;
  bucket_at_ms: number;
  active_since_ms: number | null;
  next_random_check: number | null;
  checked_at_attempt: number | null;
  challenge: ChallengeView | null;
  challenges_passed: number;
  challenges_failed: number;
  record_cleared: boolean;
}

const RUN_COLUMNS = `
  id, player_id, run_index, status, settings, levels, main_slot, used, attempts,
  bucket_tokens, extract(epoch from bucket_at) * 1000 as bucket_at_ms,
  extract(epoch from active_since) * 1000 as active_since_ms,
  next_random_check, checked_at_attempt, challenge, challenges_passed, challenges_failed, record_cleared`;

function normalizeRow(r: RunRow): RunRow {
  return {
    ...r,
    settings: typeof r.settings === 'string' ? JSON.parse(r.settings) : r.settings,
    used: typeof r.used === 'string' ? JSON.parse(r.used) : (r.used ?? { ...ZERO_USED }),
    challenge: r.challenge ? (typeof r.challenge === 'string' ? JSON.parse(r.challenge as unknown as string) : r.challenge) : null,
    bucket_at_ms: Number(r.bucket_at_ms),
    active_since_ms: r.active_since_ms == null ? null : Number(r.active_since_ms),
    levels: (r.levels ?? [0, 0, 0, 0, 0, 0]).map(Number),
  };
}

const limitsOf = (s: RunSettings): ResourceLimits => s;

function toRunState(r: RunRow): RunState {
  return {
    id: r.id,
    runIndex: r.run_index,
    settings: r.settings,
    levels: levelsRecord(r.levels),
    mainSlot: r.main_slot,
    used: r.used,
    attempts: r.attempts,
    challenge: r.challenge,
  };
}

/** Поточні налаштування адмінки → знімок для нового забігу. */
export async function loadRunSettings(q: Queryable): Promise<RunSettings> {
  const { rows } = await q.query<Record<string, number>>(
    `select mirage_count, sky_count, under_count, world_count, decoy_count, reset_unlock_attempts,
            min_attempt_ms, burst_attempts, challenge_every_attempts, session_challenge_minutes, talan_runs
       from ladder_settings where id = 1`,
  );
  const r = rows[0];
  if (!r) return { ...DEFAULT_RUN_SETTINGS };
  return {
    mirageCount: r.mirage_count, skyCount: r.sky_count, underCount: r.under_count,
    worldCount: r.world_count, decoyCount: r.decoy_count, resetUnlockAttempts: r.reset_unlock_attempts,
    minAttemptMs: r.min_attempt_ms, burstAttempts: r.burst_attempts,
    challengeEveryAttempts: r.challenge_every_attempts, sessionChallengeMinutes: r.session_challenge_minutes,
    talanRuns: r.talan_runs,
  };
}

async function loadActiveRow(q: Queryable, playerId: string, lock: boolean): Promise<RunRow | null> {
  const { rows } = await q.query<RunRow>(
    `select ${RUN_COLUMNS} from ladder_runs where player_id = $1 and status = 'active'${lock ? ' for update' : ''}`,
    [playerId],
  );
  return rows[0] ? normalizeRow(rows[0]) : null;
}

async function loadRawHistory(q: Queryable, runId: string): Promise<RawAttempt[]> {
  const { rows } = await q.query<{ item: ItemSlot; method: StoneMethod; success: boolean; before: number; after: number; p: number; role: 'main' | 'decoy' }>(
    'select item, method, success, before, after, p, role from ladder_run_attempts where run_id = $1 order by seq',
    [runId],
  );
  return rows.map((h) => ({ ...h, before: Number(h.before), after: Number(h.after), p: Number(h.p) }));
}

/** Активний забіг гравця з історією — для першого завантаження/ресинку. */
export async function getActiveRun(db: Db, playerId: string): Promise<RunView | null> {
  return db.tx(async (q) => {
    const row = await loadActiveRow(q, playerId, false);
    if (!row) return null;
    return { ...toRunState(row), history: await loadRawHistory(q, row.id) };
  });
}

/** Активний забіг або новий: повторний виклик під час забігу повертає той
 * самий (не губимо прогрес при перезавантаженні), новий створюється лише
 * коли активного немає. */
export async function startRun(db: Db, playerId: string, now: number, rng: Rng = cryptoRandom): Promise<RunView> {
  return db.tx(async (q) => {
    const existing = await loadActiveRow(q, playerId, true);
    if (existing) return { ...toRunState(existing), history: await loadRawHistory(q, existing.id) };

    // Сезон читаємо FOR SHARE: ladder_new_season() (0018) бере цей рядок на
    // запис, тож новий забіг або закриється разом із сезоном, або стартує вже в новому.
    const { rows: seasonRows } = await q.query<{ season: number }>('select season from ladder_settings where id = 1 for share');
    const season = seasonRows[0]?.season ?? 1;
    const settings = await loadRunSettings(q);
    const nextRandom = scheduleRandomCheck(0, settings.challengeEveryAttempts, rng);
    const { rows } = await q.query<RunRow>(
      `insert into ladder_runs
         (player_id, season, run_index, settings, bucket_tokens, bucket_at, next_random_check)
       values ($1, $6,
               (select coalesce(max(run_index), 0) + 1 from ladder_runs where player_id = $1 and season = $6),
               $2::jsonb, $3, to_timestamp($4 / 1000.0), $5)
       returning ${RUN_COLUMNS}`,
      [playerId, JSON.stringify(settings), settings.burstAttempts, now, nextRandom, season],
    );
    return { ...toRunState(normalizeRow(rows[0])), history: [] };
  });
}

/** Яку перевірку присутності підняти після цієї спроби (одну, за пріоритетом). */
async function decideChallenge(
  q: Queryable, row: RunRow, core: { levels: Record<ItemSlot, number>; attempts: number },
  playerId: string, now: number, rng: Rng,
): Promise<{ reason: ChallengeReason; nextRandom?: number } | null> {
  const s = row.settings;
  const level = maxLevel(core.levels);
  const sinceCheck = core.attempts - (row.checked_at_attempt ?? 0);

  // Новий особистий рекорд на значущому рівні — раз на забіг.
  if (!row.record_cleared && level >= RECORD_CHALLENGE_MIN_LEVEL) {
    const { rows } = await q.query<{ level: number }>('select level from ladder_board where player_id = $1', [playerId]);
    const boardLevel = rows[0]?.level ?? 0;
    if (level > boardLevel) return { reason: 'record' };
  }
  // Довга сесія без пауз.
  if (row.active_since_ms != null && sessionTooLong(row.active_since_ms, now, s.sessionChallengeMinutes) && sinceCheck >= 50) {
    return { reason: 'session' };
  }
  // Ритм: дуже рівний темп на останніх спробах.
  if (core.attempts >= 30 && core.attempts % 30 === 0 && sinceCheck >= 30) {
    const { rows } = await q.query<{ at_ms: number }>(
      'select extract(epoch from at) * 1000 as at_ms from ladder_run_attempts where run_id = $1 order by seq desc limit 31',
      [row.id],
    );
    const times = rows.map((r) => Number(r.at_ms)).reverse();
    const intervals: number[] = [];
    for (let i = 1; i < times.length; i++) { const dt = times[i] - times[i - 1]; if (dt >= 0 && dt <= 30_000) intervals.push(dt); }
    const cv = intervalCv(intervals);
    if (cv != null && cv < 0.06) return { reason: 'rhythm' };
  }
  // Випадкова перевірка за розкладом.
  if (row.next_random_check != null && core.attempts >= row.next_random_check) {
    return { reason: 'random', nextRandom: scheduleRandomCheck(core.attempts, s.challengeEveryAttempts, rng) ?? undefined };
  }
  return null;
}

export async function doAttempt(
  db: Db, playerId: string, req: AttemptRequest, now: number, rng: Rng = cryptoRandom,
): Promise<AttemptResponse> {
  return db.tx(async (q) => {
    const row = await loadActiveRow(q, playerId, true);
    if (!row) throw new ApiError('no_active_run', 'Немає активного забігу — почни новий.');
    if (row.challenge) throw new ApiError('challenge_required', 'Спершу пройди перевірку.', { challenge: row.challenge });

    if (!ALL_SLOTS.includes(req.item)) throw new ApiError('bad_request', 'Невідомий предмет.');
    if (!['mirage', 'sky', 'under', 'world'].includes(req.method)) throw new ApiError('bad_request', 'Невідомий метод.');

    const s = row.settings;
    const take = takeToken({ tokens: row.bucket_tokens, at: row.bucket_at_ms }, now, s.minAttemptMs, s.burstAttempts);
    if (!take.ok) throw new ApiError('too_fast', 'Занадто швидко.', { retryAfterMs: take.retryAfterMs });

    const core = { levels: levelsRecord(row.levels), mainSlot: row.main_slot, used: row.used, attempts: row.attempts };
    const result = transition(core, req.item, req.method, limitsOf(s), rng);
    if (!result) throw new ApiError('invalid_attempt', 'Ця спроба зараз неможлива (немає ресурсу або максимум).');
    const { core: next, attempt } = result;
    const seq = next.attempts;

    await q.query(
      `insert into ladder_run_attempts (run_id, seq, item, method, success, before, after, p, role, at, client_dt, click_x, click_y, pointer)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9, to_timestamp($10 / 1000.0), $11, $12, $13, $14)`,
      [row.id, seq, attempt.item, attempt.method, attempt.success, attempt.before, attempt.after, attempt.p, attempt.role,
       now, req.clientDt ?? null, req.clickX ?? null, req.clickY ?? null, (req.pointer ?? null)?.toString().slice(0, 32) ?? null],
    );

    const activeSince = row.active_since_ms ?? now;
    await q.query(
      `update ladder_runs set levels = $2::int[], main_slot = $3, used = $4::jsonb, attempts = $5,
              bucket_tokens = $6, bucket_at = to_timestamp($7 / 1000.0),
              last_attempt_at = to_timestamp($7 / 1000.0),
              active_since = coalesce(active_since, to_timestamp($8 / 1000.0))
        where id = $1`,
      [row.id, levelsArray(next.levels), next.mainSlot, JSON.stringify(next.used), next.attempts,
       take.bucket.tokens, now, activeSince],
    );

    // Міражі скінчились — автозавершення.
    if (next.attempts >= s.mirageCount) {
      const finished = await finalize(q, { ...row, ...rowCore(next) }, 'finished', now);
      return { attempt, run: null, finished };
    }

    // Підняти перевірку присутності для НАСТУПНОЇ спроби (одну).
    const decided = await decideChallenge(q, { ...row, active_since_ms: activeSince }, next, playerId, now, rng);
    let challenge: ChallengeView | null = null;
    if (decided) {
      challenge = makeChallenge(decided.reason, newId(), pickInt(rng));
      await q.query(
        `update ladder_runs set challenge = $2::jsonb, checked_at_attempt = $3,
                record_cleared = record_cleared or $4, next_random_check = coalesce($5, next_random_check)
          where id = $1`,
        [row.id, JSON.stringify(challenge), next.attempts, decided.reason === 'record', decided.nextRandom ?? null],
      );
    }

    const fresh = await loadActiveRow(q, playerId, false);
    return { attempt, run: fresh ? toRunState(fresh) : null, finished: null };
  });
}

export async function answerChallenge(
  db: Db, playerId: string, answer: ChallengeAnswer, now: number, rng: Rng = cryptoRandom,
): Promise<ChallengeResponse> {
  return db.tx(async (q) => {
    const row = await loadActiveRow(q, playerId, true);
    if (!row) throw new ApiError('no_active_run', 'Немає активного забігу.');
    if (!row.challenge) return { passed: true, run: toRunState(row), finished: null };
    if (answer.id !== row.challenge.id) throw new ApiError('bad_request', 'Перевірку прострочено — оновлюю.');

    if (answer.choice === row.challenge.target) {
      await q.query('update ladder_runs set challenge = null, challenges_passed = challenges_passed + 1 where id = $1', [row.id]);
      const fresh = await loadActiveRow(q, playerId, false);
      return { passed: true, run: fresh ? toRunState(fresh) : null, finished: null };
    }
    // Не вгадав — нова перевірка тієї ж причини, треба пройти.
    const next = makeChallenge(row.challenge.reason, newId(), pickInt(rng));
    await q.query('update ladder_runs set challenge = $2::jsonb, challenges_failed = challenges_failed + 1 where id = $1', [row.id, JSON.stringify(next)]);
    const fresh = await loadActiveRow(q, playerId, false);
    return { passed: false, run: fresh ? toRunState(fresh) : null, finished: null };
  });
}

/** Ручне «Внести в ладдер». */
export async function submitRun(db: Db, playerId: string, now: number): Promise<FinishView> {
  return db.tx(async (q) => {
    const row = await loadActiveRow(q, playerId, true);
    if (!row) throw new ApiError('no_active_run', 'Немає активного забігу.');
    return finalize(q, row, 'submitted', now);
  });
}

/** «Скинути прогрес» — доступно лише після resetUnlockAttempts спроб. */
export async function resetRun(db: Db, playerId: string, now: number): Promise<FinishView> {
  return db.tx(async (q) => {
    const row = await loadActiveRow(q, playerId, true);
    if (!row) throw new ApiError('no_active_run', 'Немає активного забігу.');
    if (row.attempts < row.settings.resetUnlockAttempts) {
      throw new ApiError('reset_locked', `Скидання доступне після ${row.settings.resetUnlockAttempts} спроб.`);
    }
    return finalize(q, row, 'reset', now);
  });
}

const rowCore = (c: { levels: Record<ItemSlot, number>; mainSlot: ItemSlot; used: Record<StoneMethod, number>; attempts: number }) => ({
  levels: levelsArray(c.levels), main_slot: c.mainSlot, used: c.used, attempts: c.attempts,
});

/** Завершити забіг: порахувати статистику, оновити ладдер і «Талан» (якщо
 * рівень кращий), збільшити лічильник забігів, закрити рядок. */
async function finalize(q: Queryable, row: RunRow, status: FinishStatus, now: number): Promise<FinishView> {
  const raws = await loadRawHistory(q, row.id);
  const history = decorateHistory(raws);
  const stats = computeSessionStats(history);
  const profile = computeRngProfile(history, stats);
  const level = raws.length > 0 ? maxLevel(levelsRecord(row.levels)) : 0;

  const timings: AttemptTiming[] = (
    await q.query<{ at_ms: number; client_dt: number | null; click_x: number | null; click_y: number | null; before: number }>(
      'select extract(epoch from at) * 1000 as at_ms, client_dt, click_x, click_y, before from ladder_run_attempts where run_id = $1 order by seq',
      [row.id],
    )
  ).rows.map((r) => ({ atMs: Number(r.at_ms), clientDt: r.client_dt, clickX: r.click_x, clickY: r.click_y, before: Number(r.before) }));
  const signals = computeSignals(timings);
  const suspicion = suspicionScore(signals);

  let boardUpdated = false;
  let talanUpdated = false;
  let newRecord = false;

  // Ладдер: замінюємо лише коли рівень СТРОГО вищий (перший забіг, у якому
  // рівень досягнуто, виграє тайбрейк run_index).
  if (level >= 1 && (status === 'submitted' || status === 'finished')) {
    const { rows: exist } = await q.query<{ level: number }>('select level from ladder_board where player_id = $1', [row.player_id]);
    const prev = exist[0]?.level ?? 0;
    newRecord = level > prev;
    if (newRecord) {
      boardUpdated = true;
      await q.query(
        `insert into ladder_board
           (player_id, nickname, level, run_index, attempts, paid_attempts, best_streak, worst_streak,
            biggest_drop, biggest_comeback, success_rate, peak_attempt, luck_score, aggression, times_hit_zero, history, run_id)
         values ($1, (select nickname from ladder_players where id = $1), $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16)
         on conflict (player_id) do update set
           level = excluded.level, run_index = excluded.run_index, attempts = excluded.attempts,
           paid_attempts = excluded.paid_attempts, best_streak = excluded.best_streak, worst_streak = excluded.worst_streak,
           biggest_drop = excluded.biggest_drop, biggest_comeback = excluded.biggest_comeback,
           success_rate = excluded.success_rate, peak_attempt = excluded.peak_attempt, luck_score = excluded.luck_score,
           aggression = excluded.aggression, times_hit_zero = excluded.times_hit_zero, history = excluded.history,
           run_id = excluded.run_id, achieved_at = now()`,
        [row.player_id, level, row.run_index, stats.attemptsUsed, stats.paidAttempts, stats.longestSuccessStreak,
         stats.longestFailStreak, stats.biggestDrop, stats.biggestComeback, stats.successRate, stats.peakAttempt,
         profile.luck, profile.aggression, stats.timesHitZero, JSON.stringify(history), row.id],
      );
    }
    // «Талан» — лише перші talanRuns забігів, той самий критерій.
    if (row.run_index <= row.settings.talanRuns) {
      const { rows: t } = await q.query<{ level: number }>('select level from ladder_talan where player_id = $1', [row.player_id]);
      if (level > (t[0]?.level ?? 0)) {
        talanUpdated = true;
        await q.query(
          `insert into ladder_talan (player_id, nickname, level, run_index, attempts, run_id)
           values ($1, (select nickname from ladder_players where id = $1), $2, $3, $4, $5)
           on conflict (player_id) do update set
             level = excluded.level, run_index = excluded.run_index, attempts = excluded.attempts,
             run_id = excluded.run_id, achieved_at = now()`,
          [row.player_id, level, row.run_index, stats.attemptsUsed, row.id],
        );
      }
    }
  }

  await q.query(
    `update ladder_runs set status = $2, final_level = $3, signals = $4::jsonb, suspicion = $5,
            ended_at = to_timestamp($6 / 1000.0), challenge = null where id = $1`,
    [row.id, status, level, JSON.stringify(signals), suspicion, now],
  );
  const { rows: pr } = await q.query<{ runs_count: number }>(
    'update ladder_players set runs_count = runs_count + 1 where id = $1 returning runs_count',
    [row.player_id],
  );

  return {
    runId: row.id, status, runIndex: row.run_index, level, attempts: stats.attemptsUsed,
    newRecord, boardUpdated, talanUpdated, runsCount: pr[0]?.runs_count ?? 0,
    settings: row.settings, history: raws,
  };
}

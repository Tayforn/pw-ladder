import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPgliteDb } from '../src/pglite';
import type { Db } from '../src/db';
import { answerChallenge, doAttempt, getActiveRun, resetRun, startRun, submitRun } from '../src/runs';
import { ApiError } from '../src/errors';
import type { AttemptRequest } from '../../src/lib/apiTypes';
import { SCHEMA_SQL, TEST_SETTINGS } from './schema';

let db: Db;
let playerId: string;
/** Керований генератор: 0 → успіх завжди, 0.999 → провал (для p ≤ 0.6). */
let roll = 0;
const rng = () => roll;

async function setSettings(patch: Partial<typeof TEST_SETTINGS> = {}) {
  const s = { ...TEST_SETTINGS, ...patch };
  const cols = Object.keys(s);
  await db.query(
    `insert into ladder_settings (id, ${cols.join(', ')}) values (1, ${cols.map((_, i) => `$${i + 1}`).join(', ')})
     on conflict (id) do update set ${cols.map((c) => `${c} = excluded.${c}`).join(', ')}`,
    Object.values(s),
  );
}

const mirage = (over: Partial<AttemptRequest> = {}): AttemptRequest => ({ item: 'a', method: 'mirage', ...over });
/** Зробити спробу основною міражем у момент now (мс). */
const tap = (now: number, over: Partial<AttemptRequest> = {}) => doAttempt(db, playerId, mirage(over), now, rng);

async function expectApi(code: string, fn: () => Promise<unknown>): Promise<ApiError> {
  try {
    await fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).code).toBe(code);
    return e as ApiError;
  }
  throw new Error(`очікував ApiError ${code}, але виклик не кинув`);
}

beforeEach(async () => {
  db = await createPgliteDb(SCHEMA_SQL);
  await setSettings();
  const { rows } = await db.query<{ id: string }>(
    "insert into ladder_players (discord_id, nickname) values ('d1', 'Tester') returning id",
  );
  playerId = rows[0].id;
  roll = 0;
});
afterEach(() => db.close());

describe('startRun', () => {
  it('створює забіг, повторний виклик повертає той самий (resume)', async () => {
    const a = await startRun(db, playerId, 1000, rng);
    expect(a.runIndex).toBe(1);
    expect(a.attempts).toBe(0);
    roll = 0;
    await tap(2000);
    const b = await startRun(db, playerId, 3000, rng);
    expect(b.id).toBe(a.id);
    expect(b.attempts).toBe(1); // не новий забіг
    expect(b.runIndex).toBe(1);
  });
});

describe('темп (token bucket)', () => {
  it('дозволяє сплеск у межах burst і відбиває надто швидкі', async () => {
    await startRun(db, playerId, 0, rng);
    roll = 0.999; // провали, щоб не впертись у максимум рівня
    for (let i = 0; i < TEST_SETTINGS.burst_attempts; i++) {
      await tap(1000); // усі в один момент — витрачають запас
    }
    const err = await expectApi('too_fast', () => tap(1000));
    expect(err.retryAfterMs).toBeGreaterThan(0);
    // Через minAttemptMs токен відновлюється.
    await tap(1000 + TEST_SETTINGS.min_attempt_ms);
    const run = await getActiveRun(db, playerId);
    expect(run?.attempts).toBe(TEST_SETTINGS.burst_attempts + 1);
  });
});

describe('спроба', () => {
  it('успіх піднімає рівень, історія росте', async () => {
    await startRun(db, playerId, 0, rng);
    roll = 0;
    const r1 = await tap(1000);
    expect(r1.attempt.success).toBe(true);
    expect(r1.attempt.after).toBe(1);
    expect(r1.run?.levels.a).toBe(1);
    const r2 = await tap(1200);
    expect(r2.attempt.before).toBe(1);
    expect(r2.attempt.after).toBe(2);
  });

  it('відхиляє неможливу спробу (немає такого каменя)', async () => {
    await setSettings({ sky_count: 0 });
    await startRun(db, playerId, 0, rng);
    await expectApi('invalid_attempt', () => doAttempt(db, playerId, { item: 'a', method: 'sky' }, 1000, rng));
  });

  it('без активного забігу — no_active_run', async () => {
    await expectApi('no_active_run', () => tap(1000));
  });
});

describe('автозавершення на вичерпанні міражів', () => {
  it('останній міраж завершує забіг і рахує його', async () => {
    await setSettings({ mirage_count: 3 });
    await startRun(db, playerId, 0, rng);
    roll = 0.999; // усі провали → фінальний рівень 0, у ладдер не йде
    await tap(1000);
    await tap(2000);
    const last = await tap(3000);
    expect(last.run).toBeNull();
    expect(last.finished).not.toBeNull();
    expect(last.finished!.status).toBe('finished');
    expect(last.finished!.level).toBe(0);
    expect(last.finished!.boardUpdated).toBe(false);
    expect(last.finished!.runsCount).toBe(1);
    expect(await getActiveRun(db, playerId)).toBeNull();
  });
});

describe('внесення в ладдер і «Талан»', () => {
  it('submitRun пише в ладдер лише коли рівень строго вищий', async () => {
    // Забіг 1: +3.
    await startRun(db, playerId, 0, rng);
    roll = 0;
    await tap(1000); await tap(2000); await tap(3000);
    const f1 = await submitRun(db, playerId, 4000);
    expect(f1.level).toBe(3);
    expect(f1.status).toBe('submitted');
    expect(f1.newRecord).toBe(true);
    expect(f1.boardUpdated).toBe(true);
    expect(f1.talanUpdated).toBe(true);
    expect(f1.runIndex).toBe(1);

    // Забіг 2: +2 — не кращий, ладдер не чіпається.
    await startRun(db, playerId, 5000, rng);
    roll = 0;
    await tap(6000); await tap(7000);
    const f2 = await submitRun(db, playerId, 8000);
    expect(f2.level).toBe(2);
    expect(f2.newRecord).toBe(false);
    expect(f2.boardUpdated).toBe(false);

    const { rows } = await db.query<{ level: number; run_index: number }>('select level, run_index from ladder_board where player_id = $1', [playerId]);
    expect(rows[0].level).toBe(3);
    expect(rows[0].run_index).toBe(1);
  });

  it('«Талан» рахує лише перші talan_runs забігів', async () => {
    await setSettings({ talan_runs: 2 });
    // Забіги 1 і 2 — низькі; забіг 3 — високий, у «Талан» не потрапляє.
    for (let run = 1; run <= 2; run++) {
      await startRun(db, playerId, run * 10_000, rng);
      roll = 0;
      await tap(run * 10_000 + 1000); // +1
      await submitRun(db, playerId, run * 10_000 + 2000);
    }
    await startRun(db, playerId, 40_000, rng);
    roll = 0;
    await tap(41_000); await tap(42_000); await tap(43_000); await tap(44_000); // +4
    const f3 = await submitRun(db, playerId, 45_000);
    expect(f3.runIndex).toBe(3);
    expect(f3.boardUpdated).toBe(true); // ладдер оновлюється завжди
    expect(f3.talanUpdated).toBe(false); // а «Талан» — ні, забіг поза перших 2

    const { rows } = await db.query<{ level: number }>('select level from ladder_talan where player_id = $1', [playerId]);
    expect(rows[0].level).toBe(1); // найкращий серед перших двох
  });
});

describe('скидання', () => {
  it('заблоковане до resetUnlockAttempts, потім завершує забіг', async () => {
    await setSettings({ reset_unlock_attempts: 3 });
    await startRun(db, playerId, 0, rng);
    roll = 0.999;
    await tap(1000); await tap(2000);
    await expectApi('reset_locked', () => resetRun(db, playerId, 3000));
    await tap(3000);
    const f = await resetRun(db, playerId, 4000);
    expect(f.status).toBe('reset');
    expect(f.runsCount).toBe(1);
    expect(await getActiveRun(db, playerId)).toBeNull();
    // Наступний забіг — новий індекс.
    const next = await startRun(db, playerId, 5000, rng);
    expect(next.runIndex).toBe(2);
  });
});

describe('перевірка присутності', () => {
  it('новий рекорд на +8 піднімає перевірку "record"', async () => {
    await setSettings({ mirage_count: 50 });
    await startRun(db, playerId, 0, rng);
    roll = 0;
    let t = 1000;
    let challenge = null;
    for (let i = 0; i < 8; i++) { // 8 успіхів → +8
      const r = await tap(t);
      t += 1000;
      if (r.run?.challenge) { challenge = r.run.challenge; break; }
    }
    expect(challenge).not.toBeNull();
    expect(challenge!.reason).toBe('record');
    // Пройшли — і забіг триває без повторної рекордної перевірки на +9.
    await answerChallenge(db, playerId, { id: challenge!.id, choice: challenge!.target }, t, rng);
    const r9 = await tap(t + 1000);
    expect(r9.attempt.after).toBe(9);
    expect(r9.run?.challenge ?? null).toBeNull();
  });


  it('випадкова перевірка блокує наступну спробу, поки не пройдена', async () => {
    await setSettings({ challenge_every_attempts: 2 });
    await startRun(db, playerId, 0, rng);
    roll = 0.999;
    let t = 1000;
    let challenge = null;
    // Робимо спроби, поки не з'явиться перевірка.
    for (let i = 0; i < 10 && !challenge; i++) {
      const r = await tap(t);
      t += 1000;
      challenge = r.run?.challenge ?? null;
    }
    expect(challenge).not.toBeNull();
    // Наступна спроба відхиляється, поки перевірку не пройдено.
    const err = await expectApi('challenge_required', () => tap(t));
    expect(err.challenge?.id).toBe(challenge!.id);

    // Невірна відповідь — нова перевірка, не пройдено.
    const wrong = (challenge!.target + 1) % challenge!.options;
    const bad = await answerChallenge(db, playerId, { id: challenge!.id, choice: wrong }, t, rng);
    expect(bad.passed).toBe(false);
    expect(bad.run?.challenge).not.toBeNull();

    // Вірна відповідь — знято, гра триває.
    const cur = bad.run!.challenge!;
    const good = await answerChallenge(db, playerId, { id: cur.id, choice: cur.target }, t, rng);
    expect(good.passed).toBe(true);
    expect(good.run?.challenge).toBeNull();
    await tap(t + 1000); // тепер спроба проходить
  });
});

describe('новий сезон (міграція 0018)', () => {
  /** Свіжа БД зі справжнім SQL міграції; is_ladder_admin — заглушка, grant/revoke
   * прибрано (у PGlite немає ролей Supabase). */
  async function applySeasonMigration(isAdmin = true) {
    const sql = readFileSync(new URL('../../supabase/migrations/0018_seasons.sql', import.meta.url), 'utf8')
      .split(/\r?\n/)
      .filter((l) => !/^\s*(grant|revoke)\b/i.test(l))
      .join('\n');
    await db.close();
    db = await createPgliteDb(
      `${SCHEMA_SQL};\ncreate function is_ladder_admin() returns boolean language sql as 'select ${isAdmin}';\n${sql}`,
    );
    await setSettings();
    const { rows } = await db.query<{ id: string }>(
      "insert into ladder_players (discord_id, nickname) values ('d1', 'Tester') returning id",
    );
    playerId = rows[0].id;
  }

  it('закриває активний забіг без запису в ладдер, обнуляє лічильник і нумерацію', async () => {
    await applySeasonMigration();
    // Сезон 1: завершений забіг у ладдері + ще один активний.
    await startRun(db, playerId, 1000, rng);
    roll = 0;
    await tap(2000);
    await submitRun(db, playerId, 3000);
    const active = await startRun(db, playerId, 4000, rng);
    expect(active.runIndex).toBe(2);
    await tap(5000);

    const { rows } = await db.query<{ s: number }>('select ladder_new_season() as s');
    expect(rows[0].s).toBe(2);

    await expectApi('no_active_run', () => tap(6000));
    expect(await getActiveRun(db, playerId)).toBeNull();
    const closed = await db.query<{ status: string }>('select status from ladder_runs where id = $1', [active.id]);
    expect(closed.rows[0].status).toBe('closed');
    const board = await db.query('select 1 from ladder_board');
    expect(board.rows).toHaveLength(0);
    const p = await db.query<{ runs_count: number }>('select runs_count from ladder_players where id = $1', [playerId]);
    expect(p.rows[0].runs_count).toBe(0);

    // Сезон 2: нумерація з 1, історія сезону 1 лишилась.
    const fresh = await startRun(db, playerId, 7000, rng);
    expect(fresh.runIndex).toBe(1);
    const all = await db.query<{ season: number }>('select season from ladder_runs where player_id = $1 order by started_at', [playerId]);
    expect(all.rows.map((r) => r.season)).toEqual([1, 1, 2]);
  });

  it('відмовляє не-адміну', async () => {
    await applySeasonMigration(false);
    await expect(db.query('select ladder_new_season()')).rejects.toThrow(/адмін/);
  });
});

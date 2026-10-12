// =========================================================
// Ставки в юанях сайту турнірів: маршрути /api/pvp/bets (база турнірів — заглушка
// PvpBetsStore), клієнт PostgREST і справжня міграція pw-pvp 0036_bets.sql на
// PGlite (усі міграції сайту по черзі, Supabase-ролі й auth.uid() — заглушки).
// =========================================================

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { Config } from '../src/config';
import type { DiscordClient, DiscordMember } from '../src/discord';
import { SESSION_COOKIE, STATE_COOKIE } from '../src/sessions';
import { createPgliteDb } from '../src/pglite';
import type { Db } from '../src/db';
import { createPvpRest, playerTag } from '../src/pvpRegister';
import { createPvpBetsStore, parseBetBody, type PlaceBetArgs, type PvpBetRow, type PvpBetsStore } from '../src/pvpBets';
import { PvpDbError } from '../src/pvpRegister';
import { SCHEMA_SQL } from './schema';

const ORIGIN = 'http://localhost';
const CONFIG: Config = {
  host: '127.0.0.1', port: 0, publicOrigin: ORIGIN, cookieSecure: false,
  allowedOrigins: [ORIGIN], cookieDomain: null, supabaseUrl: null, supabaseServiceKey: null, pvpSupabaseUrl: null, pvpSupabaseServiceKey: null,
  databaseUrl: '', databaseSsl: 'disable', databaseCaFile: null,
  discordClientId: 'cid', discordClientSecret: 'secret', discordGuildId: 'g1',
  discordAllowedRoleIds: ['R1'], sessionTtlDays: 7,
};
const T_ID = '7d0c2a8e-3c55-4a43-9d7e-0a4b8f5b1c11';
const M_ID = '5a1b2c3d-1111-4111-8111-111111111111';
const PICK = '9e8d7c6b-2222-4222-8222-222222222222';
const SIGN_KEY = 'bets-sign-key';
const NOW = Date.parse('2026-10-12T12:00:00Z');

const member = (userId: string, nick: string): DiscordMember => ({
  userId, username: nick, globalName: nick, nick, roles: ['R1'], avatarUrl: null,
});

const row = (over: Partial<PvpBetRow> = {}): PvpBetRow => ({
  id: 'b0000000-0000-4000-8000-000000000001', tournament_id: T_ID, market: 'match', match_id: M_ID, pick_id: PICK,
  pick_name: 'Alpha', stake: 10_000_000, game_nick: null, status: 'pending', created_at: '2026-10-12T12:00:00Z',
  paid_at: null, payout_at: null, payout_amount: null, ...over,
});

class FakeBets implements PvpBetsStore {
  placed: PlaceBetArgs[] = [];
  placeError: PvpDbError | null = null;
  rows: Array<PvpBetRow & { player_id: string }> = [];
  async placeBet(a: PlaceBetArgs) {
    if (this.placeError) throw this.placeError;
    this.placed.push(a);
    const r = { ...row({ id: `b0000000-0000-4000-8000-00000000000${this.placed.length}`, stake: a.stake, pick_id: a.pickId, match_id: a.matchId, market: a.matchId ? 'match' : 'tournament', game_nick: a.gameNick }), player_id: a.playerId };
    this.rows.push(r);
    return r;
  }
  async myBets(playerId: string, tournamentId: string | null) {
    return this.rows.filter((r) => r.player_id === playerId && (!tournamentId || r.tournament_id === tournamentId));
  }
  async cancelBet(id: string, playerId: string) {
    const r = this.rows.find((x) => x.id === id && x.player_id === playerId && x.status === 'pending');
    if (!r) return null;
    r.status = 'cancelled';
    return r;
  }
}

let db: Db;
let clock = NOW;
let current: DiscordMember = member('u1', 'Tester');
let bets: FakeBets;

function stubDiscord(): DiscordClient {
  return {
    authorizeUrl: (state) => `https://discord.test/authorize?state=${state}`,
    exchangeCode: async () => 'access-token',
    fetchMember: async () => current,
  };
}

type App = ReturnType<typeof buildApp>;
async function makeApp(deps: { pvpBetsStore?: PvpBetsStore | null } = { pvpBetsStore: bets }): Promise<App> {
  const app = buildApp({ config: CONFIG, db, discord: stubDiscord(), now: () => clock, rng: () => 0, log: { level: 'silent' }, pvpSignKey: SIGN_KEY, ...deps });
  await app.ready();
  return app;
}

async function login(app: App, who: DiscordMember): Promise<string> {
  current = who;
  const start = await app.inject({ method: 'GET', url: '/api/auth/login' });
  const state = start.cookies.find((c) => c.name === STATE_COOKIE)!.value;
  const cb = await app.inject({
    method: 'GET', url: `/api/auth/callback?code=abc&state=${encodeURIComponent(state)}`,
    cookies: { [STATE_COOKIE]: state },
  });
  return cb.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
}

async function call(app: App, session: string | null, method: 'GET' | 'POST', url: string, payload?: unknown, origin = ORIGIN) {
  clock += 10_000;
  return app.inject({
    method, url, payload: payload as object | undefined,
    headers: origin ? { origin } : {},
    cookies: session ? { [SESSION_COOKIE]: session } : {},
  });
}
const betBody = (over: Record<string, unknown> = {}) => ({ tournamentId: T_ID, matchId: M_ID, pickId: PICK, stake: 10_000_000, ...over });

beforeEach(async () => {
  db = await createPgliteDb(SCHEMA_SQL);
  current = member('u1', 'Tester');
  clock = NOW;
  bets = new FakeBets();
});
afterEach(() => db.close());

describe('POST /api/pvp/bets', () => {
  it('без конфігу — 503 not_configured', async () => {
    const app = await makeApp({});
    const s = await login(app, member('u1', 'Tester'));
    const res = await call(app, s, 'POST', '/api/pvp/bets', betBody());
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('not_configured');
    await app.close();
  });

  it('гість (без Discord-сесії) ставити не може — 401', async () => {
    const app = await makeApp();
    const res = await call(app, null, 'POST', '/api/pvp/bets', betBody());
    expect(res.statusCode).toBe(401);
    expect(bets.placed).toHaveLength(0);
    await app.close();
  });

  it('чужий origin — 403 bad_origin', async () => {
    const app = await makeApp();
    const s = await login(app, member('u1', 'Tester'));
    const res = await call(app, s, 'POST', '/api/pvp/bets', betBody(), 'https://evil.example');
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('ставка: гравець і нік — із сесії, мітка акаунта — HMAC(турнір, гравець), як у заявці', async () => {
    const app = await makeApp();
    const s = await login(app, member('u1', 'Tayforn'));
    const res = await call(app, s, 'POST', '/api/pvp/bets', betBody({ stake: '20000000', gameNick: '  Тайфорн  ', playerId: 'spoof' }));
    expect(res.statusCode).toBe(200);
    const [a] = bets.placed;
    const { rows } = await db.query<{ id: string }>('select id from ladder_players where discord_id = $1', ['u1']);
    expect(a).toEqual({
      tournamentId: T_ID, matchId: M_ID, pickId: PICK, stake: 20_000_000, gameNick: 'Тайфорн',
      playerId: rows[0].id, playerNick: 'Tayforn', accountTag: playerTag(SIGN_KEY, T_ID, rows[0].id),
    });
    expect(res.json().bet).toMatchObject({ tournamentId: T_ID, matchId: M_ID, pickId: PICK, stake: 20_000_000, status: 'pending', gameNick: 'Тайфорн' });
    await app.close();
  });

  it('правило бази (P0001 з place_bet) — 409 з текстом бази як є', async () => {
    const app = await makeApp();
    const s = await login(app, member('u1', 'Tester'));
    bets.placeError = new PvpDbError(400, 'P0001', 'Це твій матч — ставити можна лише на свою перемогу.');
    const res = await call(app, s, 'POST', '/api/pvp/bets', betBody());
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'conflict', message: 'Це твій матч — ставити можна лише на свою перемогу.' });
    await app.close();
  });

  it('міграцію 0036 не виконано (PGRST202) — 503; збій бази — 502 upstream', async () => {
    const app = await makeApp();
    const s = await login(app, member('u1', 'Tester'));
    bets.placeError = new PvpDbError(404, 'PGRST202', 'Could not find the function public.place_bet');
    expect((await call(app, s, 'POST', '/api/pvp/bets', betBody())).statusCode).toBe(503);
    bets.placeError = new PvpDbError(0, null, 'мережа: ECONNREFUSED');
    const res = await call(app, s, 'POST', '/api/pvp/bets', betBody());
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('upstream');
    await app.close();
  });

  it('темп: 5 ставок поспіль, шоста одразу — 429', async () => {
    const app = await makeApp();
    const s = await login(app, member('u1', 'Tester'));
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({ method: 'POST', url: '/api/pvp/bets', payload: betBody(), headers: { origin: ORIGIN }, cookies: { [SESSION_COOKIE]: s } });
      expect(r.statusCode).toBe(200);
    }
    const r = await app.inject({ method: 'POST', url: '/api/pvp/bets', payload: betBody(), headers: { origin: ORIGIN }, cookies: { [SESSION_COOKIE]: s } });
    expect(r.statusCode).toBe(429);
    await app.close();
  });
});

describe('parseBetBody', () => {
  it('приймає ставку на турнір (matchId null) і суму рядком', () => {
    expect(parseBetBody({ tournamentId: T_ID, matchId: null, pickId: PICK, stake: '1000000' })).toEqual({
      tournamentId: T_ID, matchId: null, pickId: PICK, stake: 1_000_000, gameNick: null,
    });
  });
  it.each([
    [{ tournamentId: 'x', pickId: PICK, stake: 1 }, 'Некоректний турнір.'],
    [{ tournamentId: T_ID, matchId: 'x', pickId: PICK, stake: 1 }, 'Некоректний матч.'],
    [{ tournamentId: T_ID, pickId: null, stake: 1 }, 'Обери, на кого ставиш.'],
    [{ tournamentId: T_ID, pickId: PICK, stake: 1.5 }, 'Вкажи суму ставки цілим числом юанів.'],
    [{ tournamentId: T_ID, pickId: PICK, stake: -5 }, 'Вкажи суму ставки цілим числом юанів.'],
    [{ tournamentId: T_ID, pickId: PICK, stake: '1e7' }, 'Вкажи суму ставки цілим числом юанів.'],
    [{ tournamentId: T_ID, pickId: PICK, stake: 200_000_000_000 }, 'Завелика сума ставки.'],
    [{ tournamentId: T_ID, pickId: PICK, stake: 1, gameNick: 'x'.repeat(41) }, 'Нік персонажа — до 40 символів.'],
  ])('відмовляє: %j', (body, message) => {
    expect(() => parseBetBody(body)).toThrow(message);
  });
});

describe('GET /api/pvp/bets/mine і скасування', () => {
  it('лише свої ставки; скасувати можна лише свою неоплачену', async () => {
    const app = await makeApp();
    const a = await login(app, member('u1', 'Alpha'));
    const b = await login(app, member('u2', 'Beta'));
    const placed = (await call(app, a, 'POST', '/api/pvp/bets', betBody())).json().bet;
    expect((await call(app, a, 'GET', `/api/pvp/bets/mine?tournamentId=${T_ID}`)).json().bets).toHaveLength(1);
    expect((await call(app, b, 'GET', '/api/pvp/bets/mine')).json().bets).toHaveLength(0);
    expect((await call(app, null, 'GET', '/api/pvp/bets/mine')).statusCode).toBe(401);
    expect((await call(app, a, 'GET', '/api/pvp/bets/mine?tournamentId=bad')).statusCode).toBe(400);

    // чужу — ні
    expect((await call(app, b, 'POST', `/api/pvp/bets/${placed.id}/cancel`)).statusCode).toBe(409);
    const ok = await call(app, a, 'POST', `/api/pvp/bets/${placed.id}/cancel`);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().bet.status).toBe('cancelled');
    // оплачену (чи вже скасовану) — ні
    expect((await call(app, a, 'POST', `/api/pvp/bets/${placed.id}/cancel`)).statusCode).toBe(409);
    await app.close();
  });
});

describe('createPvpBetsStore (PostgREST)', () => {
  function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const impl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const r = responses.shift() ?? { status: 200, body: [] };
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    return { calls, impl };
  }

  it('rpc/place_bet з параметрами p_*, вибірка своїх, PATCH скасування лише pending', async () => {
    const f = fakeFetch([
      { status: 200, body: row() },
      { status: 200, body: [row()] },
      { status: 200, body: [] },
      { status: 400, body: { code: 'P0001', message: 'Прийом ставок на цей матч закрито.' } },
    ]);
    const s = createPvpBetsStore(createPvpRest('https://pvp.example.supabase.co/', 'KEY', f.impl));
    await s.placeBet({ tournamentId: T_ID, matchId: null, pickId: PICK, stake: 5, playerId: 'p1', playerNick: 'N', gameNick: null, accountTag: 'TAG' });
    expect(f.calls[0].url).toBe('https://pvp.example.supabase.co/rest/v1/rpc/place_bet');
    expect(f.calls[0].init.method).toBe('POST');
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({
      p_tournament_id: T_ID, p_match_id: null, p_pick_id: PICK, p_stake: 5, p_player_id: 'p1', p_player_nick: 'N', p_game_nick: null, p_account_tag: 'TAG',
    });
    expect(await s.myBets('p1', T_ID)).toHaveLength(1);
    expect(f.calls[1].url).toContain(`bets?player_id=eq.p1&tournament_id=eq.${T_ID}&select=`);
    expect(await s.cancelBet('b1', 'p1')).toBeNull();
    expect(f.calls[2].url).toContain('bets?id=eq.b1&player_id=eq.p1&status=eq.pending');
    expect(f.calls[2].init.method).toBe('PATCH');
    const err = await s.placeBet({ tournamentId: T_ID, matchId: M_ID, pickId: PICK, stake: 5, playerId: 'p1', playerNick: 'N', gameNick: null, accountTag: 'TAG' }).catch((e) => e);
    expect(err).toMatchObject({ status: 400, code: 'P0001', message: 'Прийом ставок на цей матч закрито.' });
  });
});

// ── Міграція pw-pvp 0036: схема й правила ставок у самій базі ──
// Усі міграції сайту по черзі в PGlite. Supabase-середовище — заглушки: ролі anon /
// authenticated / service_role, auth.uid() з налаштування test.uid, cron, публікація realtime.
describe('pw-pvp 0036_bets.sql (place_bet, пули, закриття прийому)', () => {
  const dir = fileURLToPath(new URL('../../../pw-pvp/supabase/migrations/', import.meta.url));
  let base: string;
  let pg: PGlite;
  const T = '11111111-1111-4111-8111-111111111111';
  const GM = '22222222-2222-4222-8222-222222222222';
  const SA = '33333333-3333-4333-8333-333333333333';
  let A: string, B: string, C: string, D: string, M1: string, M2: string, MF: string;

  beforeAll(() => {
    base = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
      .map((f) => readFileSync(dir + f, 'utf8').replace(/create extension if not exists pg_cron;/g, ''))
      .join('\n');
  });

  beforeEach(async () => {
    pg = new PGlite();
    await pg.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin;
      create schema auth;
      create table auth.users (id uuid primary key, email text);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
      create schema cron;
      create function cron.schedule(a text, b text, c text) returns bigint language sql as $$ select 1::bigint $$;
      create publication supabase_realtime;
    `);
    await pg.exec(base);
    await pg.query(`insert into tournaments (id, name, event_date, status, bets_enabled, bet_min_stake, bet_max_stake)
                    values ($1, 'Cup', current_date, 'registration_closed', true, 1000000, 500000000)`, [T]);
    const reg = async (nick: string, tag: string | null = null) =>
      (await pg.query<{ id: string }>(`insert into registrations (tournament_id, nickname, rules_ack, status, account_tag) values ($1, $2, true, 'confirmed', $3) returning id`, [T, nick, tag])).rows[0].id;
    A = await reg('Alpha', 'tag-alpha-0000'); B = await reg('Beta'); C = await reg('Gamma'); D = await reg('Delta');
    const match = async (round: number, slot: number, p1: string | null, p2: string | null) =>
      (await pg.query<{ id: string }>(`insert into bracket_matches (tournament_id, round, slot, participant1_id, participant2_id) values ($1, $2, $3, $4, $5) returning id`, [T, round, slot, p1, p2])).rows[0].id;
    M1 = await match(1, 0, A, B); M2 = await match(1, 1, C, D); MF = await match(2, 0, null, null);
    await pg.query(`insert into auth.users values ($1, 'gm@x'), ($2, 'sa@x')`, [GM, SA]);
    await pg.query(`insert into admins (user_id, email, role) values ($1, 'gm@x', 'gm'), ($2, 'sa@x', 'superadmin')`, [GM, SA]);
  });
  afterEach(() => pg.close());

  async function bet(match: string | null, pick: string, stake: number, player: string, nick: string, tag: string | null = null): Promise<string> {
    try {
      await pg.query('select * from place_bet($1, $2, $3, $4, $5, $6, null, $7)', [T, match, pick, stake, player, nick, tag]);
      return 'ok';
    } catch (e) {
      return (e as Error).message;
    }
  }
  const pools = async () =>
    (await pg.query<{ match_id: string | null; pick_id: string; total: string; bets: number }>('select match_id, pick_id, total::text, bets from bet_pools order by total, pick_id')).rows;

  it('межі суми, учасник матчу, неготовий матч', async () => {
    expect(await bet(M1, A, 10_000_000, 'p1', 'Viewer')).toBe('ok');
    expect(await bet(M1, A, 5, 'p1', 'Viewer')).toMatch(/менша за мінімальну/);
    expect(await bet(M1, A, 900_000_000, 'p1', 'Viewer')).toMatch(/більша за максимальну/);
    expect(await bet(M1, C, 10_000_000, 'p1', 'Viewer')).toMatch(/лише на учасника цього матчу/);
    expect(await bet(MF, A, 10_000_000, 'p1', 'Viewer')).toMatch(/ще не визначені/);
  });

  it('учасник (за міткою акаунта чи ніком) у своєму матчі — лише на свою перемогу; на чужі матчі — будь-як', async () => {
    expect(await bet(M1, B, 10_000_000, 'pa', 'Інший нік', 'tag-alpha-0000')).toMatch(/твій матч/);
    expect(await bet(M1, A, 10_000_000, 'pa', 'Інший нік', 'tag-alpha-0000')).toBe('ok');
    expect(await bet(M1, A, 10_000_000, 'pb', 'BETA')).toMatch(/твій матч/);
    expect(await bet(M1, B, 10_000_000, 'pb', 'beta')).toBe('ok');
    expect(await bet(M2, D, 10_000_000, 'pb', 'beta')).toBe('ok');
    // переможець турніру: учасник сітки — лише на себе
    expect(await bet(null, C, 10_000_000, 'pb', 'beta')).toMatch(/граєш у цьому турнірі/);
    expect(await bet(null, B, 10_000_000, 'pb', 'beta')).toBe('ok');
    expect(await bet(null, C, 10_000_000, 'p1', 'Viewer')).toBe('ok');
  });

  it('ставки поза сіткою / вимкнені / unlisted — відмова', async () => {
    const X = (await pg.query<{ id: string }>(`insert into registrations (tournament_id, nickname, rules_ack, status) values ($1, 'Reserve', true, 'confirmed') returning id`, [T])).rows[0].id;
    expect(await bet(null, X, 10_000_000, 'p1', 'Viewer')).toMatch(/немає в сітці/);
    await pg.query(`update tournaments set visibility = 'unlisted' where id = $1`, [T]);
    expect(await bet(M1, A, 10_000_000, 'p1', 'Viewer')).toMatch(/не приймаються/);
    await pg.query(`update tournaments set visibility = 'public', bets_enabled = false where id = $1`, [T]);
    expect(await bet(M1, A, 10_000_000, 'p1', 'Viewer')).toMatch(/не приймаються/);
  });

  it('у пул ідуть лише оплачені ставки; оплату й виплату штампує база; ставку не змінити', async () => {
    await bet(M1, A, 10_000_000, 'p1', 'Viewer');
    await bet(M1, B, 30_000_000, 'p2', 'Other');
    await bet(null, C, 20_000_000, 'p1', 'Viewer');
    expect(await pools()).toEqual([]);
    await pg.query(`update bets set status = 'paid'`);
    expect(await pools()).toEqual([
      { match_id: M1, pick_id: A, total: '10000000', bets: 1 },
      { match_id: null, pick_id: C, total: '20000000', bets: 1 },
      { match_id: M1, pick_id: B, total: '30000000', bets: 1 },
    ]);
    await pg.query(`select set_config('test.uid', $1, false)`, [SA]);
    await pg.query(`update bets set payout_amount = 38000000 where player_id = 'p2'`);
    const r = (await pg.query<{ paid_by: string; payout_by: string; ok: boolean }>(`select paid_by, payout_by, paid_at is not null and payout_at is not null as ok from bets where player_id = 'p2'`)).rows[0];
    expect(r).toMatchObject({ payout_by: SA, ok: true });
    await expect(pg.query(`update bets set stake = 1 where player_id = 'p2'`)).rejects.toThrow(/змінювати не можна/);
    // повернули в «очікує оплати» — з пулу зникла
    await pg.query(`update bets set status = 'rejected' where player_id = 'p2'`);
    expect((await pools()).map((p) => p.total)).toEqual(['10000000', '20000000']);
  });

  it('не більше 5 живих ставок гравця на ринок', async () => {
    for (let i = 0; i < 5; i++) expect(await bet(M2, D, 1_000_000, 'p9', 'Nine')).toBe('ok');
    expect(await bet(M2, D, 1_000_000, 'p9', 'Nine')).toMatch(/5 ставок/);
    expect(await bet(M2, C, 1_000_000, 'p9', 'Nine')).toMatch(/5 ставок/);
    await pg.query(`update bets set status = 'cancelled' where id = (select id from bets limit 1)`);
    expect(await bet(M2, D, 1_000_000, 'p9', 'Nine')).toBe('ok');
  });

  it('рахунок чи переможець закривають прийом на матч, а справжній матч — і на турнір; bye — ні', async () => {
    // bye: переможець із одним учасником
    const bye = (await pg.query<{ id: string }>(`insert into bracket_matches (tournament_id, round, slot, participant1_id) values ($1, 1, 2, $2) returning id`, [T, D])).rows[0].id;
    await pg.query(`update bracket_matches set winner_id = $1 where id = $2`, [D, bye]);
    expect(await bet(null, C, 10_000_000, 'p1', 'Viewer')).toBe('ok');
    await pg.query(`update bracket_matches set score = '1-0' where id = $1`, [M1]);
    expect(await bet(M1, A, 10_000_000, 'p1', 'Viewer')).toMatch(/закрито/);
    expect(await bet(null, C, 10_000_000, 'p1', 'Viewer')).toMatch(/закрито/);
    expect(await bet(M2, C, 10_000_000, 'p1', 'Viewer')).toBe('ok');
    // кнопка «Бій почався» — bets_closed_at
    await pg.query(`update bracket_matches set bets_closed_at = now() where id = $1`, [M2]);
    expect(await bet(M2, C, 10_000_000, 'p1', 'Viewer')).toMatch(/закрито/);
  });

  it('налаштування ставок міняє лише суперадмін; ГМ-власник виставляє результат (вкладене закриття ринку турніру)', async () => {
    await pg.query(`select set_config('test.uid', $1, false)`, [GM]);
    await expect(pg.query(`update tournaments set bet_commission_pct = 5 where id = $1`, [T])).rejects.toThrow(/лише суперадмін/);
    await pg.query(`update tournaments set name = 'Cup 2' where id = $1`, [T]);
    await pg.query(`update bracket_matches set winner_id = $1 where id = $2`, [C, M2]);
    await pg.query(`select set_config('test.uid', $1, false)`, [SA]);
    await pg.query(`update tournaments set bet_commission_pct = 5 where id = $1`, [T]);
    await pg.query(`select set_config('test.uid', '', false)`);
    const t = (await pg.query<{ c: string; closed: boolean }>(`select bet_commission_pct::text c, outright_bets_closed_at is not null closed from tournaments where id = $1`, [T])).rows[0];
    expect(t).toEqual({ c: '5.00', closed: true });
  });

  it('перегенерована сітка: ставки на матч лишаються без матчу, їхні пули зникають; видалення турніру — каскадом', async () => {
    await bet(M1, A, 10_000_000, 'p1', 'Viewer');
    await bet(null, C, 20_000_000, 'p1', 'Viewer');
    await pg.query(`update bets set status = 'paid'`);
    await pg.query(`delete from bracket_matches where tournament_id = $1`, [T]);
    expect((await pg.query(`select market, match_id from bets order by market`)).rows).toEqual([
      { market: 'match', match_id: null }, { market: 'tournament', match_id: null },
    ]);
    expect(await pools()).toEqual([{ match_id: null, pick_id: C, total: '20000000', bets: 1 }]);
    await pg.query(`delete from tournaments where id = $1`, [T]);
    expect((await pg.query(`select * from bets`)).rows).toEqual([]);
  });

  it('anon: place_bet не викликати, bets не видно (RLS), пули — видно', async () => {
    await bet(M1, A, 10_000_000, 'p1', 'Viewer');
    await pg.query(`update bets set status = 'paid'`);
    await pg.exec('grant usage on schema auth to anon; grant select on bets, bet_pools, admins to anon;');
    await pg.exec('set role anon');
    try {
      await expect(pg.query('select place_bet($1, $2, $3, 1000000, $4, $5)', [T, M1, A, 'x', 'x'])).rejects.toThrow(/permission denied/);
      expect((await pg.query('select * from bets')).rows).toEqual([]);
      expect((await pg.query('select * from bet_pools')).rows).toHaveLength(1);
    } finally {
      await pg.exec('reset role');
    }
  });
});

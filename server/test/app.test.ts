import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { Config } from '../src/config';
import type { DiscordClient, DiscordMember } from '../src/discord';
import { SESSION_COOKIE, STATE_COOKIE } from '../src/sessions';
import { createPgliteDb } from '../src/pglite';
import type { Db } from '../src/db';
import { SCHEMA_SQL, TEST_SETTINGS } from './schema';

const CONFIG: Config = {
  host: '127.0.0.1', port: 0, publicOrigin: 'http://localhost', cookieSecure: false,
  databaseUrl: '', databaseSsl: 'disable', databaseCaFile: null,
  discordClientId: 'cid', discordClientSecret: 'secret', discordGuildId: 'g1',
  discordAllowedRoleIds: ['R1'], sessionTtlDays: 7,
};

const MEMBER: DiscordMember = {
  userId: 'u1', username: 'tester', globalName: 'Tester', nick: 'ClanTester', roles: ['R1'], avatarUrl: null,
};

function stubDiscord(member: DiscordMember | null): DiscordClient {
  return {
    authorizeUrl: (state) => `https://discord.test/authorize?state=${state}`,
    exchangeCode: async () => 'access-token',
    fetchMember: async () => member,
  };
}

let db: Db;
const cookieVal = (res: { cookies: Array<{ name: string; value: string }> }, name: string) =>
  res.cookies.find((c) => c.name === name)?.value;

async function makeApp(member: DiscordMember | null = MEMBER) {
  const app = buildApp({ config: CONFIG, db, discord: stubDiscord(member), now: () => 1_000_000, rng: () => 0 });
  await app.ready();
  return app;
}

/** Проходить логін через стаб Discord і повертає cookie сесії. */
async function login(app: Awaited<ReturnType<typeof makeApp>>): Promise<string> {
  const start = await app.inject({ method: 'GET', url: '/api/auth/login' });
  const state = cookieVal(start, STATE_COOKIE)!;
  const cb = await app.inject({
    method: 'GET',
    url: `/api/auth/callback?code=abc&state=${encodeURIComponent(state)}`,
    cookies: { [STATE_COOKIE]: state },
  });
  expect(cb.statusCode).toBe(302);
  expect(cb.headers.location).toBe('http://localhost/');
  return cookieVal(cb, SESSION_COOKIE)!;
}

beforeEach(async () => {
  db = await createPgliteDb(SCHEMA_SQL);
  const cols = Object.keys(TEST_SETTINGS);
  await db.query(
    `insert into ladder_settings (id, ${cols.join(', ')}) values (1, ${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
    Object.values(TEST_SETTINGS),
  );
});
afterEach(() => db.close());

describe('автентифікація', () => {
  it('без сесії /api/me → 401', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('unauthorized');
    await app.close();
  });

  it('логін через Discord створює гравця й сесію, нік — із сервера клану', async () => {
    const app = await makeApp();
    const session = await login(app);
    const me = await app.inject({ method: 'GET', url: '/api/me', cookies: { [SESSION_COOKIE]: session } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ nickname: 'ClanTester', runsCount: 0 });
    await app.close();
  });

  it('немає на сервері клану → редірект denied, без сесії', async () => {
    const app = await makeApp(null);
    const start = await app.inject({ method: 'GET', url: '/api/auth/login' });
    const state = cookieVal(start, STATE_COOKIE)!;
    const cb = await app.inject({
      method: 'GET', url: `/api/auth/callback?code=abc&state=${encodeURIComponent(state)}`,
      cookies: { [STATE_COOKIE]: state },
    });
    expect(cb.headers.location).toBe('http://localhost/?login=denied');
    expect(cookieVal(cb, SESSION_COOKIE)).toBeUndefined();
    await app.close();
  });

  it('роль не дозволена → denied', async () => {
    const app = await makeApp({ ...MEMBER, roles: ['OTHER'] });
    const start = await app.inject({ method: 'GET', url: '/api/auth/login' });
    const state = cookieVal(start, STATE_COOKIE)!;
    const cb = await app.inject({
      method: 'GET', url: `/api/auth/callback?code=abc&state=${encodeURIComponent(state)}`,
      cookies: { [STATE_COOKIE]: state },
    });
    expect(cb.headers.location).toBe('http://localhost/?login=denied');
    await app.close();
  });

  it('підроблений state → error, без сесії', async () => {
    const app = await makeApp();
    const cb = await app.inject({
      method: 'GET', url: '/api/auth/callback?code=abc&state=zzz', cookies: { [STATE_COOKIE]: 'real' },
    });
    expect(cb.headers.location).toBe('http://localhost/?login=error');
    await app.close();
  });
});

describe('ігровий потік через HTTP', () => {
  it('старт → спроба → сабміт → ладдер', async () => {
    const app = await makeApp();
    const session = await login(app);
    const auth = { [SESSION_COOKIE]: session };
    const origin = { origin: 'http://localhost' };

    const start = await app.inject({ method: 'POST', url: '/api/run/start', cookies: auth, headers: origin });
    expect(start.statusCode).toBe(200);
    expect(start.json().attempts).toBe(0);

    const att = await app.inject({
      method: 'POST', url: '/api/run/attempt', cookies: auth, headers: origin,
      payload: { item: 'a', method: 'mirage' },
    });
    expect(att.json().attempt.success).toBe(true);
    expect(att.json().attempt.after).toBe(1);

    const sub = await app.inject({ method: 'POST', url: '/api/run/submit', cookies: auth, headers: origin });
    expect(sub.json()).toMatchObject({ status: 'submitted', level: 1, boardUpdated: true });

    const ladder = await app.inject({ method: 'GET', url: '/api/ladder' });
    const view = ladder.json();
    expect(view.board).toHaveLength(1);
    expect(view.board[0]).toMatchObject({ nickname: 'ClanTester', level: 1, runIndex: 1, runsCount: 1 });
    expect(view.talan[0]).toMatchObject({ level: 1 });

    const hist = await app.inject({ method: 'GET', url: `/api/run-history/${view.board[0].playerId}` });
    expect(hist.json().history).toHaveLength(1);
    await app.close();
  });

  it('POST без свого Origin → bad_origin', async () => {
    const app = await makeApp();
    const session = await login(app);
    const res = await app.inject({
      method: 'POST', url: '/api/run/start', cookies: { [SESSION_COOKIE]: session },
      headers: { origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('bad_origin');
    await app.close();
  });

  it('гра вимагає входу', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/run/start', headers: { origin: 'http://localhost' } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

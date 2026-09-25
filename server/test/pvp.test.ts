import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { Config } from '../src/config';
import type { DiscordClient, DiscordMember } from '../src/discord';
import { SESSION_COOKIE, STATE_COOKIE } from '../src/sessions';
import { createPgliteDb } from '../src/pglite';
import type { Db } from '../src/db';
import { MAX_CHARACTERS, checkCharacterDoc } from '../src/pvp';
import { SCHEMA_SQL } from './schema';

const ORIGIN = 'http://localhost';
const CONFIG: Config = {
  host: '127.0.0.1', port: 0, publicOrigin: ORIGIN, cookieSecure: false,
  allowedOrigins: [ORIGIN], cookieDomain: null, supabaseUrl: null, supabaseServiceKey: null,
  databaseUrl: '', databaseSsl: 'disable', databaseCaFile: null,
  discordClientId: 'cid', discordClientSecret: 'secret', discordGuildId: 'g1',
  discordAllowedRoleIds: ['R1'], sessionTtlDays: 7,
};

const member = (userId: string, nick: string): DiscordMember => ({
  userId, username: nick, globalName: nick, nick, roles: ['R1'], avatarUrl: null,
});

let db: Db;
let clock = 1_000_000;
let current: DiscordMember = member('u1', 'Tester');

function stubDiscord(): DiscordClient {
  return {
    authorizeUrl: (state) => `https://discord.test/authorize?state=${state}`,
    exchangeCode: async () => 'access-token',
    fetchMember: async () => current,
  };
}

type App = ReturnType<typeof buildApp>;
async function makeApp(): Promise<App> {
  const app = buildApp({ config: CONFIG, db, discord: stubDiscord(), now: () => clock, rng: () => 0 });
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

const doc = (over: Record<string, unknown> = {}) => ({
  v: 2, name: 'Лучник', cls: 'rl', gender: 'm', level: 105,
  attrs: { str: 5, dex: 400, vit: 5, mag: 5 }, nextIid: 2,
  items: [{ i: '1', cat: 'ta', id: 42, r: 10, g: [0, 0] }],
  main: { ta: '1' }, sets: [], ...over,
});

/** Запит від імені сесії, з нашого origin; кожен наступний — через 2 с (обмеження частоти). */
async function call(app: App, session: string | null, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) {
  clock += 2000;
  return app.inject({
    method, url, payload: payload as object | undefined,
    headers: { origin: ORIGIN },
    cookies: session ? { [SESSION_COOKIE]: session } : {},
  });
}

beforeEach(async () => {
  db = await createPgliteDb(SCHEMA_SQL);
  current = member('u1', 'Tester');
});
afterEach(() => db.close());

describe('персонажі pvp', () => {
  it('без входу — 401 на список і запис', async () => {
    const app = await makeApp();
    expect((await call(app, null, 'GET', '/api/pvp/characters')).statusCode).toBe(401);
    expect((await call(app, null, 'POST', '/api/pvp/characters', { doc: doc() })).statusCode).toBe(401);
    await app.close();
  });

  it('створення, список, читання, збереження з ревізією, архів', async () => {
    const app = await makeApp();
    const s = await login(app, member('u1', 'Tester'));
    const created = await call(app, s, 'POST', '/api/pvp/characters', { doc: doc({ name: '  Лучник  ' }) });
    expect(created.statusCode).toBe(200);
    const c = created.json();
    expect(c).toMatchObject({ name: 'Лучник', cls: 'rl', level: 105, revision: 1 });
    expect(c.doc.name).toBe('Лучник');

    const list = (await call(app, s, 'GET', '/api/pvp/characters')).json();
    expect(list.max).toBe(MAX_CHARACTERS);
    expect(list.characters).toEqual([expect.objectContaining({ id: c.id, name: 'Лучник', items: 1, sets: 0 })]);

    const upd = await call(app, s, 'PUT', `/api/pvp/characters/${c.id}`, { doc: doc({ level: 104 }), baseRevision: 1 });
    expect(upd.statusCode).toBe(200);
    expect(upd.json()).toMatchObject({ level: 104, revision: 2 });

    // стара ревізія — конфлікт, дані не змінились
    const stale = await call(app, s, 'PUT', `/api/pvp/characters/${c.id}`, { doc: doc({ level: 1 }), baseRevision: 1 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe('conflict');
    expect((await call(app, s, 'GET', `/api/pvp/characters/${c.id}`)).json()).toMatchObject({ level: 104, revision: 2 });

    expect((await call(app, s, 'DELETE', `/api/pvp/characters/${c.id}`)).statusCode).toBe(200);
    expect((await call(app, s, 'GET', `/api/pvp/characters/${c.id}`)).statusCode).toBe(404);
    expect((await call(app, s, 'GET', '/api/pvp/characters')).json().characters).toEqual([]);
    await app.close();
  });

  it('чужого персонажа не видно й не змінити', async () => {
    const app = await makeApp();
    const a = await login(app, member('u1', 'Alice'));
    const b = await login(app, member('u2', 'Bob'));
    const c = (await call(app, a, 'POST', '/api/pvp/characters', { doc: doc() })).json();
    expect((await call(app, b, 'GET', `/api/pvp/characters/${c.id}`)).statusCode).toBe(404);
    expect((await call(app, b, 'PUT', `/api/pvp/characters/${c.id}`, { doc: doc(), baseRevision: 1 })).statusCode).toBe(404);
    expect((await call(app, b, 'DELETE', `/api/pvp/characters/${c.id}`)).statusCode).toBe(404);
    expect((await call(app, b, 'GET', '/api/pvp/characters')).json().characters).toEqual([]);
    await app.close();
  });

  it('імʼя унікальне без регістру; після архіву — вільне', async () => {
    const app = await makeApp();
    const s = await login(app, member('u1', 'Tester'));
    const c = (await call(app, s, 'POST', '/api/pvp/characters', { doc: doc({ name: 'Сін' }) })).json();
    const dup = await call(app, s, 'POST', '/api/pvp/characters', { doc: doc({ name: 'сін' }) });
    expect(dup.statusCode).toBe(409);
    await call(app, s, 'DELETE', `/api/pvp/characters/${c.id}`);
    expect((await call(app, s, 'POST', '/api/pvp/characters', { doc: doc({ name: 'сін' }) })).statusCode).toBe(200);
    await app.close();
  });

  it(`ліміт ${MAX_CHARACTERS} персонажів`, async () => {
    const app = await makeApp();
    const s = await login(app, member('u1', 'Tester'));
    for (let i = 0; i < MAX_CHARACTERS; i++) {
      expect((await call(app, s, 'POST', '/api/pvp/characters', { doc: doc({ name: 'P' + i }) })).statusCode).toBe(200);
    }
    const over = await call(app, s, 'POST', '/api/pvp/characters', { doc: doc({ name: 'Зайвий' }) });
    expect(over.statusCode).toBe(409);
    await app.close();
  });

  it('запис без свого origin — 403; частіше разу на секунду — 429', async () => {
    const app = await makeApp();
    const s = await login(app, member('u1', 'Tester'));
    const noOrigin = await app.inject({
      method: 'POST', url: '/api/pvp/characters', payload: { doc: doc() }, cookies: { [SESSION_COOKIE]: s },
    });
    expect(noOrigin.statusCode).toBe(403);
    clock += 5000;
    const first = await app.inject({
      method: 'POST', url: '/api/pvp/characters', payload: { doc: doc({ name: 'A' }) },
      headers: { origin: ORIGIN }, cookies: { [SESSION_COOKIE]: s },
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: 'POST', url: '/api/pvp/characters', payload: { doc: doc({ name: 'B' }) },
      headers: { origin: ORIGIN }, cookies: { [SESSION_COOKIE]: s },
    });
    expect(second.statusCode).toBe(429);
    expect(second.json().retryAfterMs).toBeGreaterThan(0);
    await app.close();
  });

  it('некоректний id — 404, без ревізії — 400', async () => {
    const app = await makeApp();
    const s = await login(app, member('u1', 'Tester'));
    expect((await call(app, s, 'GET', '/api/pvp/characters/not-a-uuid')).statusCode).toBe(404);
    const c = (await call(app, s, 'POST', '/api/pvp/characters', { doc: doc() })).json();
    expect((await call(app, s, 'PUT', `/api/pvp/characters/${c.id}`, { doc: doc() })).statusCode).toBe(400);
    await app.close();
  });
});

describe('checkCharacterDoc', () => {
  const rejects = (d: unknown) => expect(() => checkCharacterDoc(d)).toThrow();
  it('приймає нормальний документ', () => {
    expect(checkCharacterDoc(doc())).toEqual({ name: 'Лучник', cls: 'rl', level: 105 });
  });
  it('відкидає зламане', () => {
    rejects(null);
    rejects([]);
    rejects(doc({ v: 1 }));
    rejects(doc({ name: '' }));
    rejects(doc({ name: 'x'.repeat(33) }));
    rejects(doc({ cls: 'paladin' }));
    rejects(doc({ level: 106 }));
    rejects(doc({ level: 10.5 }));
    rejects(doc({ items: new Array(101).fill({ i: '1' }) }));
    rejects(doc({ sets: new Array(6).fill({}) }));
    rejects(doc({ main: [] }));
    rejects(doc({ note: 'x'.repeat(65) }));
    rejects(doc({ name: 'bad\u0000name' }));
    rejects(doc({ x: { a: { b: { c: { d: { e: { f: { g: { h: 1 } } } } } } } } }));
    rejects(JSON.parse('{"v":2,"name":"A","cls":"rl","level":1,"items":[],"main":{},"sets":[],"__proto__":{"x":1}}'));
  });
  it('відкидає завеликий документ', () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ i: String(i), cat: 'ta', id: i, x: Array.from({ length: 24 }, () => ({ t: "ad", v: 12345.67 })) }));
    rejects(doc({ items }));
  });
});

// =========================================================
// POST /api/pvp/registrations — заявка на фул-рандом, скор рахує сервер.
// База ладдера — PGlite (персонажі), база сайту турнірів — заглушка PvpStore,
// скорер — справжній ../pw-pvp/src/server/scorer.ts на справжньому знімку
// ляльки з заявки (фікстура pw-pvp). Наприкінці — RLS міграції pw-pvp 0034.
// =========================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { Config } from '../src/config';
import type { DiscordClient, DiscordMember } from '../src/discord';
import { SESSION_COOKIE, STATE_COOKIE } from '../src/sessions';
import { createPgliteDb } from '../src/pglite';
import type { Db } from '../src/db';
import { PvpDbError, SCORER_ID, createPvpSupabaseStore, parseRegistrationBody, type PvpRules, type PvpStore, type PvpTournament, registrationSig } from '../src/pvpRegister';
import { SCHEMA_SQL } from './schema';
import snapshot from '../../../pw-pvp/src/server/__tests__/fixtures/regSnapshot.json';
import rulesV122 from '../../../pw-pvp/src/server/__tests__/fixtures/rulesV122.json';

const ORIGIN = 'http://localhost';
const CONFIG: Config = {
  host: '127.0.0.1', port: 0, publicOrigin: ORIGIN, cookieSecure: false,
  allowedOrigins: [ORIGIN], cookieDomain: null, supabaseUrl: null, supabaseServiceKey: null, pvpSupabaseUrl: null, pvpSupabaseServiceKey: null,
  databaseUrl: '', databaseSsl: 'disable', databaseCaFile: null,
  discordClientId: 'cid', discordClientSecret: 'secret', discordGuildId: 'g1',
  discordAllowedRoleIds: ['R1'], sessionTtlDays: 7,
};
const T_ID = '7d0c2a8e-3c55-4a43-9d7e-0a4b8f5b1c11';
const NOW = Date.parse('2026-10-01T12:00:00Z');

const member = (userId: string, nick: string): DiscordMember => ({
  userId, username: nick, globalName: nick, nick, roles: ['R1'], avatarUrl: null,
});

/** Заглушка бази сайту турнірів: один турнір, версії шкали, записані рядки й черга помилок insert. */
class FakeStore implements PvpStore {
  tournamentRow: PvpTournament | null = {
    id: T_ID, name: 'Фул-рандом', status: 'registration_open', event_date: '2026-10-05',
    team_mode: 'balanced_random', team_size: 3, balance_rules_version: null,
  };
  versions: PvpRules[] = [{ version: rulesV122.version, rules: rulesV122.rules }];
  inserts: Array<Record<string, unknown>> = [];
  insertErrors: PvpDbError[] = [];
  rulesCalls: Array<string | null> = [];
  existingStatus: string | null = null;
  failTournament = false;
  failCharacterLookup = false;

  async tournament(id: string) {
    if (this.failTournament) throw new PvpDbError(0, null, 'мережа: ECONNREFUSED');
    return this.tournamentRow && this.tournamentRow.id === id ? this.tournamentRow : null;
  }
  /** Як PostgREST: живі (не відхилені) заявки персонажа серед записаних — від найстарішої, з підписом. */
  async characterRegistrations(tournamentId: string, characterId: string) {
    if (this.failCharacterLookup) throw new PvpDbError(503, null, 'upstream connect error');
    return this.inserts
      .filter((r) => r.tournament_id === tournamentId && r.character_id === characterId && r.status !== 'rejected')
      .map((r) => {
        const sig = (r.item_breakdown as { sig?: unknown } | null | undefined)?.sig;
        return { nickname: String(r.nickname), status: String(r.status), sig: typeof sig === 'string' ? sig : null };
      });
  }
  async rules(version: string | null) {
    this.rulesCalls.push(version);
    if (version == null) return this.versions[0] ?? null;
    return this.versions.find((v) => v.version === version) ?? null;
  }
  async registrationStatus() {
    return this.existingStatus;
  }
  async insertRegistration(row: Record<string, unknown>) {
    const err = this.insertErrors.shift();
    if (err) throw err;
    this.inserts.push(row);
    return { id: 'a3f1c2d4-0000-4000-8000-00000000000' + this.inserts.length };
  }
}

let db: Db;
let clock = NOW;
let current: DiscordMember = member('u1', 'Tester');
let store: FakeStore;
/** Лог Fastify (JSON-рядки pino) — збирається тут, а не в stdout тестів. */
let logLines: string[] = [];
const logSink = { write: (line: string) => void logLines.push(line) };
const logged = () => logLines.map((l) => JSON.parse(l) as Record<string, unknown>);

function stubDiscord(): DiscordClient {
  return {
    authorizeUrl: (state) => `https://discord.test/authorize?state=${state}`,
    exchangeCode: async () => 'access-token',
    fetchMember: async () => current,
  };
}

type App = ReturnType<typeof buildApp>;
/** Без pvpStore у deps бекенд бере базу турнірів із конфігу (у CONFIG її немає). */
async function makeApp(deps: { pvpStore?: PvpStore | null } = { pvpStore: store }, setup?: (app: App) => void): Promise<App> {
  const app = buildApp({ config: CONFIG, db, discord: stubDiscord(), now: () => clock, rng: () => 0, log: { stream: logSink }, ...deps });
  setup?.(app);
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

/** Запит із нашого origin; кожен наступний — через 10 с (темп заявок не заважає). */
async function call(app: App, session: string | null, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown) {
  clock += 10_000;
  return app.inject({
    method, url, payload: payload as object | undefined,
    headers: { origin: ORIGIN },
    cookies: session ? { [SESSION_COOKIE]: session } : {},
  });
}
const register = (app: App, session: string | null, body: Record<string, unknown>) => call(app, session, 'POST', '/api/pvp/registrations', body);
const guestBody = (over: Record<string, unknown> = {}) => ({ tournamentId: T_ID, nickname: 'Tayforn', rulesAck: true, doc: snapshot, ...over });

/** Свій персонаж у базі ладдера (через API персонажів). */
async function saveCharacter(app: App, session: string, name = 'Tayforn'): Promise<{ id: string; revision: number }> {
  const res = await call(app, session, 'POST', '/api/pvp/characters', { doc: { ...snapshot, name } });
  expect(res.statusCode).toBe(200);
  return res.json();
}

beforeEach(async () => {
  db = await createPgliteDb(SCHEMA_SQL);
  current = member('u1', 'Tester');
  clock = NOW;
  store = new FakeStore();
  logLines = [];
});
afterEach(() => db.close());

describe('POST /api/pvp/registrations', () => {
  it('без конфігу (PVP_SUPABASE_URL / PVP_SUPABASE_SERVICE_KEY) — 503 not_configured', async () => {
    const app = await makeApp({});
    const res = await register(app, null, guestBody());
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('not_configured');
    // явний null — так само
    const app2 = await makeApp({ pvpStore: null });
    expect((await register(app2, null, guestBody())).json().error).toBe('not_configured');
    await app.close();
    await app2.close();
  });

  it('свій персонаж: сервер рахує скор і пише рядок заявки з усіма колонками', async () => {
    const app = await makeApp();
    const s = await login(app, member('u1', 'Tayforn'));
    const c = await saveCharacter(app, s);
    const res = await register(app, s, { tournamentId: T_ID, nickname: '  Tayforn  ', rulesAck: true, characterId: c.id });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // той самий itemPoints, що в браузері й у тесті скорера pw-pvp (знімок × balance-v1.22)
    expect(body).toEqual({ id: expect.any(String), itemPoints: 293.68, score: 319, rulesVersion: 'balance-v1.22', warn: [] });
    expect(store.inserts).toHaveLength(1);
    const row = store.inserts[0];
    expect(row).toMatchObject({
      tournament_id: T_ID, nickname: 'Tayforn', rules_ack: true, member_nicknames: null, kind: 'player', status: 'pending',
      character_id: c.id, character_rev: c.revision, item_points: 293.68,
      char_class: 'archer', char_level: 'l104', weapon_grade: 'r9r2', genie: 'g100',
    });
    expect(row.item_breakdown).toMatchObject({ v: 1, ver: 'balance-v1.22', checked: true, server: true, scorer: SCORER_ID });
    expect(row.doll_power).toMatchObject({ off: expect.any(Number), def: expect.any(Number) });
    expect((row.character_snapshot as { name: string }).name).toBe('Tayforn');
    expect(row.doll_confirmed_at).toBe(new Date(clock).toISOString());
    // усі legacy-колонки анкети (CHECK «усі або жодна») на місці
    for (const k of ['weapon_refine', 'weapon_pz', 'armor_set', 'armor_refine', 'gems', 'special_sets', 'special_set_gems', 'tract', 'build', 'ring1', 'ring2', 'shg', 'voznes', 'attack_level', 'defense_level']) {
      expect(row, k).toHaveProperty(k);
    }
    expect(JSON.stringify(row)).not.toMatch(/NaN|Infinity/);
    await app.close();
  });

  it('свій персонаж — одна жива заявка на турнір: друга (й з іншим ніком) — 409 already_registered; після відхилення — можна', async () => {
    const app = await makeApp();
    const s = await login(app, member('u1', 'Tayforn'));
    const c = await saveCharacter(app, s);
    const body = (nickname: string) => ({ tournamentId: T_ID, nickname, rulesAck: true, characterId: c.id });
    expect((await register(app, s, body('Tayforn'))).statusCode).toBe(200);

    const again = await register(app, s, body('Tayforn2'));
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({
      error: 'already_registered',
      message: 'Цим персонажем уже подано заявку на цей турнір (нікнейм «Tayforn», на розгляді) — друга заявка тим самим персонажем не приймається.',
    });
    store.inserts[0].status = 'confirmed';
    expect((await register(app, s, body('Tayforn3'))).json().message).toMatch(/«Tayforn», підтверджена/);
    expect(store.inserts).toHaveLength(1);

    // інший персонаж того самого гравця й гість — не обмежені цим правилом
    const other = await saveCharacter(app, s, 'Twink');
    expect((await register(app, s, { ...body('Twink'), characterId: other.id })).statusCode).toBe(200);
    expect((await register(app, null, guestBody({ nickname: 'Гість' }))).statusCode).toBe(200);

    // відхилену заявку персонажа не рахуємо — подати знову можна
    store.inserts[0].status = 'rejected';
    const retry = await register(app, s, body('Tayforn'));
    expect(retry.statusCode).toBe(200);
    expect(store.inserts.at(-1)).toMatchObject({ character_id: c.id, nickname: 'Tayforn', status: 'pending' });
    expect(store.inserts).toHaveLength(4);
    await app.close();
  });

  it('підкинутий напряму рядок із чужим character_id (без підпису бекенда) не блокує власника', async () => {
    const app = await makeApp();
    const s = await login(app, member('u1', 'Tayforn'));
    const c = await saveCharacter(app, s);
    // до 0034 анонімний ключ міг вставити такий рядок: без sig і з підробленим sig
    store.inserts.push(
      { tournament_id: T_ID, character_id: c.id, nickname: 'x', status: 'pending', item_breakdown: { v: 1 } },
      { tournament_id: T_ID, character_id: c.id, nickname: 'y', status: 'pending', item_breakdown: { v: 1, sig: 'A'.repeat(32) } },
    );
    const res = await register(app, s, { tournamentId: T_ID, nickname: 'Tayforn', rulesAck: true, characterId: c.id });
    expect(res.statusCode).toBe(200);
    const row = store.inserts.at(-1)!;
    expect((row.item_breakdown as { sig?: string }).sig).toBe(registrationSig(CONFIG.pvpSupabaseServiceKey ?? 'pvp-dev-sign-key', T_ID, c.id));
    // а справжній (підписаний бекендом) рядок — блокує
    const again = await register(app, s, { tournamentId: T_ID, nickname: 'Tayforn2', rulesAck: true, characterId: c.id });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('already_registered');
    await app.close();
  });

  it('мітка спроби (nonce): іде в item_breakdown.nonce; некоректна — 400; гість без підпису', async () => {
    const app = await makeApp();
    const nonce = 'b7f0c2d4-1e2f-4a5b-8c9d-0e1f2a3b4c5d';
    expect((await register(app, null, guestBody({ nonce }))).statusCode).toBe(200);
    const bd = store.inserts.at(-1)!.item_breakdown as Record<string, unknown>;
    expect(bd).toMatchObject({ nonce, server: true, checked: true });
    expect(bd.sig).toBeUndefined();
    expect(JSON.stringify(bd).length).toBeLessThanOrEqual(2048);
    for (const bad of ['short', 'з пробілом і кирилицею', 'x'.repeat(65), 42]) {
      const r = await register(app, null, guestBody({ nickname: 'N' + String(bad).length, nonce: bad }));
      expect(r.statusCode).toBe(400);
      expect(r.json().message).toMatch(/мітка заявки/);
    }
    await app.close();
  });

  it('413 (завеликий запит) і 415 (не JSON) — помилка клієнта з тим самим статусом, без запису в журнал', async () => {
    const app = await makeApp();
    const big = await app.inject({
      method: 'POST', url: '/api/pvp/registrations', headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: JSON.stringify({ pad: 'x'.repeat(70 * 1024) }),
    });
    expect(big.statusCode).toBe(413);
    expect(big.json()).toEqual({ error: 'bad_request', message: 'Запит завеликий.' });
    const xml = await app.inject({
      method: 'POST', url: '/api/pvp/registrations', headers: { origin: ORIGIN, 'content-type': 'application/xml' }, payload: '<a/>',
    });
    expect(xml.statusCode).toBe(415);
    expect(xml.json().error).toBe('bad_request');
    expect(logLines).toEqual([]);
    await app.close();
  });

  it('гість: чернетка в тілі, без персонажа; порожнє імʼя чернетки — стає ніком', async () => {
    const app = await makeApp();
    const res = await register(app, null, guestBody({ nickname: 'Гість', doc: { ...snapshot, name: '' } }));
    expect(res.statusCode).toBe(200);
    expect(res.json().itemPoints).toBe(293.68);
    const row = store.inserts[0];
    expect(row).toMatchObject({ nickname: 'Гість', character_id: null, character_rev: null, status: 'pending', kind: 'player' });
    expect((row.character_snapshot as { name: string }).name).toBe('Гість');
    await app.close();
  });

  it('валідація тіла — 400 з поясненням, у базу нічого не йде', async () => {
    const app = await makeApp();
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ ...guestBody(), tournamentId: 'nope' }, /турнір/i],
      [guestBody({ nickname: '   ' }), /нікнейм/i],
      [guestBody({ nickname: 'x'.repeat(41) }), /40/],
      [guestBody({ nickname: 'bad\u0000nick' }), /символи/],
      [guestBody({ rulesAck: false }), /правилами/],
      [guestBody({ rulesAck: 'true' }), /правилами/],
      [guestBody({ memberNicknames: ['A', 'B'] }), /склад/],
      [guestBody({ characterId: '0b1e7a4c-1111-4111-8111-111111111111' }), /або/],
      [guestBody({ doc: { v: 1 } }), /версія/],
      [guestBody({ doc: [] }), /документ/i],
    ];
    for (const [body, msg] of cases) {
      const res = await register(app, null, body);
      expect(res.statusCode, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(res.json().error).toBe('bad_request');
      expect(res.json().message).toMatch(msg);
    }
    expect(store.inserts).toEqual([]);
    expect(() => parseRegistrationBody(null)).toThrow(/тіло/);
    await app.close();
  });

  it('гість без doc і без персонажа — 400; characterId без входу — 401', async () => {
    const app = await makeApp();
    const noDoc = await register(app, null, { tournamentId: T_ID, nickname: 'Tayforn', rulesAck: true });
    expect(noDoc.statusCode).toBe(400);
    expect(noDoc.json().message).toMatch(/characterId|чернетка/);
    const anon = await register(app, null, { tournamentId: T_ID, nickname: 'Tayforn', rulesAck: true, characterId: '0b1e7a4c-1111-4111-8111-111111111111' });
    expect(anon.statusCode).toBe(401);
    expect(store.inserts).toEqual([]);
    await app.close();
  });

  it('чужий персонаж — 404, як і неіснуючий; некоректний id — 400', async () => {
    const app = await makeApp();
    const alice = await login(app, member('u1', 'Alice'));
    const bob = await login(app, member('u2', 'Bob'));
    const c = await saveCharacter(app, alice);
    const res = await register(app, bob, { tournamentId: T_ID, nickname: 'Bob', rulesAck: true, characterId: c.id });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('not_found');
    const missing = await register(app, bob, { tournamentId: T_ID, nickname: 'Bob', rulesAck: true, characterId: '0b1e7a4c-1111-4111-8111-111111111111' });
    expect(missing.statusCode).toBe(404);
    const badId = await register(app, bob, { tournamentId: T_ID, nickname: 'Bob', rulesAck: true, characterId: 'x' });
    expect(badId.statusCode).toBe(400);
    // свій, але видалений (архів) — теж 404
    expect((await call(app, alice, 'DELETE', `/api/pvp/characters/${c.id}`)).statusCode).toBe(200);
    expect((await register(app, alice, { tournamentId: T_ID, nickname: 'Alice', rulesAck: true, characterId: c.id })).statusCode).toBe(404);
    expect(store.inserts).toEqual([]);
    await app.close();
  });

  it('закритий турнір, минула дата — 409 registration_closed; немає турніру — 404; не фул-рандом — 400', async () => {
    const app = await makeApp();
    store.tournamentRow = { ...store.tournamentRow!, status: 'registration_closed' };
    const closed = await register(app, null, guestBody());
    expect(closed.statusCode).toBe(409);
    expect(closed.json()).toMatchObject({ error: 'registration_closed', message: expect.stringMatching(/закрита/) });

    store.tournamentRow = { ...store.tournamentRow!, status: 'registration_open', event_date: '2026-09-30' };
    expect((await register(app, null, guestBody())).json().error).toBe('registration_closed');
    // сьогодні (UTC) — ще можна
    store.tournamentRow = { ...store.tournamentRow!, event_date: new Date(clock + 10_000).toISOString().slice(0, 10) };
    expect((await register(app, null, guestBody())).statusCode).toBe(200);

    store.tournamentRow = null;
    expect((await register(app, null, guestBody({ nickname: 'Інший' }))).statusCode).toBe(404);

    store.tournamentRow = { id: T_ID, name: 'Команди', status: 'registration_open', event_date: '2026-10-05', team_mode: 'fixed', team_size: 3, balance_rules_version: null };
    const fixed = await register(app, null, guestBody({ nickname: 'Інший' }));
    expect(fixed.statusCode).toBe(400);
    expect(fixed.json().message).toMatch(/фул-рандом/);
    expect(store.inserts).toHaveLength(1);
    await app.close();
  });

  it('персонаж без зброї — 400 з тим самим текстом, що в браузері', async () => {
    const app = await makeApp();
    const main = { ...(snapshot.main as Record<string, string>) };
    delete main.ta;
    const sets = (snapshot.sets as Array<{ slots: Record<string, string> }>).map((s) => {
      const slots = { ...s.slots };
      delete slots.ta;
      return { ...s, slots };
    });
    const res = await register(app, null, guestBody({ doc: { ...snapshot, main, sets } }));
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('Заявку не подати: у персонажа немає зброї (ні в Головному, ні в сеті).');
    expect(store.inserts).toEqual([]);
    await app.close();
  });

  it('дубль ніку — 409 duplicate_nickname зрозумілим текстом; відхилена заявка — про видалення адміном', async () => {
    const app = await makeApp();
    const dup = new PvpDbError(409, '23505', 'duplicate key value violates unique constraint "registrations_tournament_nickname_uidx"');
    store.insertErrors.push(dup);
    const res = await register(app, null, guestBody());
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'duplicate_nickname', message: 'Нікнейм «Tayforn» уже зареєстровано на цей турнір.' });
    store.insertErrors.push(dup);
    store.existingStatus = 'rejected';
    const rej = await register(app, null, guestBody());
    expect(rej.json().error).toBe('duplicate_nickname');
    expect(rej.json().message).toMatch(/відхилено.*адмін має видалити/);
    await app.close();
  });

  it('до міграції 0032 (немає item_points) — повтор без колонок скору v2', async () => {
    const app = await makeApp();
    store.insertErrors.push(new PvpDbError(400, 'PGRST204', "Could not find the 'item_points' column of 'registrations' in the schema cache"));
    const res = await register(app, null, guestBody());
    expect(res.statusCode).toBe(200);
    expect(store.inserts).toHaveLength(1);
    expect(store.inserts[0]).not.toHaveProperty('item_points');
    expect(store.inserts[0]).not.toHaveProperty('item_breakdown');
    expect(store.inserts[0]).toHaveProperty('char_class', 'archer');
    // у журнал — попередження, що міграції 0032 ще немає
    expect(logged()).toContainEqual(expect.objectContaining({ level: 40, msg: expect.stringMatching(/колонок 0032/) }));
    await app.close();
  });

  it('база турнірів не відповідає — 502 upstream і рядок у лозі; інша помилка insert — теж 502', async () => {
    const app = await makeApp();
    store.failTournament = true;
    const res = await register(app, null, guestBody());
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('upstream');
    store.failTournament = false;
    store.insertErrors.push(new PvpDbError(401, null, 'Invalid API key'));
    expect((await register(app, null, guestBody())).statusCode).toBe(502);
    // Обидві відмови видно в журналі (warn): що робили, статус, код, текст — і жодного дубля ключа msg.
    const warns = logged().filter((l) => l.level === 40);
    expect(warns).toEqual([
      expect.objectContaining({ what: 'турнір', status: 0, code: null, detail: 'мережа: ECONNREFUSED', msg: expect.stringMatching(/502 upstream/) }),
      expect.objectContaining({ what: 'заявка', status: 401, code: null, detail: 'Invalid API key' }),
    ]);
    expect(logLines.every((l) => (l.match(/"msg":/g) ?? []).length === 1)).toBe(true);
    // пошук живої заявки персонажа — так само 502
    const s = await login(app, member('u1', 'Tayforn'));
    const c = await saveCharacter(app, s);
    store.failCharacterLookup = true;
    const own = await register(app, s, { tournamentId: T_ID, nickname: 'Tayforn', rulesAck: true, characterId: c.id });
    expect(own.statusCode).toBe(502);
    expect(logged().at(-1)).toMatchObject({ level: 40, what: 'заявка персонажа', status: 503 });
    expect(store.inserts).toEqual([]);
    await app.close();
  });

  it('у журнал (warn/error) — 502 від PostgREST і 500 з маршрутом, без service-ключа, cookie й query', async () => {
    const KEY = 'service-key-SECRET-0123456789';
    // Справжній PostgREST-клієнт на підробленому fetch: читання проходять, insert — відмова з 401.
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const rows = url.includes('/tournaments?')
        ? [store.tournamentRow]
        : url.includes('/balance_rules?') ? [{ version: rulesV122.version, rules: rulesV122.rules }] : [];
      const denied = init.method === 'POST';
      return new Response(JSON.stringify(denied ? { code: 'PGRST301', message: 'JWT expired' } : rows), {
        status: denied ? 401 : 200, headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    const app = await makeApp({ pvpStore: createPvpSupabaseStore('https://pvp.example.supabase.co', KEY, fetchImpl) }, (a) => {
      // маршрут, що падає не ApiError, — як збій скорера чи бази
      a.get('/api/test-boom', async () => {
        throw new Error('скорер упав');
      });
    });
    const s = await login(app, member('u1', 'Tayforn'));
    const res = await register(app, s, guestBody());
    expect(res.statusCode).toBe(502);
    const boom = await app.inject({ method: 'GET', url: '/api/test-boom?code=oauth-code-xyz', cookies: { [SESSION_COOKIE]: s } });
    expect(boom.statusCode).toBe(500);
    expect(boom.json()).toEqual({ error: 'internal', message: 'Внутрішня помилка.' });

    expect(logged()).toEqual([
      expect.objectContaining({ level: 40, what: 'заявка', status: 401, code: 'PGRST301', detail: 'JWT expired' }),
      expect.objectContaining({ level: 50, route: 'GET /api/test-boom', err: expect.objectContaining({ message: 'скорер упав', stack: expect.any(String) }) }),
    ]);
    const all = logLines.join('\n');
    expect(all).not.toContain(KEY);
    expect(all).not.toContain(s);
    expect(all).not.toContain('oauth-code-xyz');
    expect(all).not.toMatch(/"(apikey|authorization|cookie|headers)"\s*:/i);
    await app.close();
  });

  it('версія шкали — як у браузері: закріплена за турніром, вбудована без запиту, невідома чи порожня — найновіша', async () => {
    const app = await makeApp();
    store.tournamentRow = { ...store.tournamentRow!, balance_rules_version: 'balance-v1.0' };
    const builtin = await register(app, null, guestBody({ nickname: 'A' }));
    expect(builtin.json().rulesVersion).toBe('balance-v1.0');
    expect(store.rulesCalls).toEqual([]);

    store.tournamentRow = { ...store.tournamentRow!, balance_rules_version: 'balance-v9.9' };
    const unknown = await register(app, null, guestBody({ nickname: 'B' }));
    expect(unknown.json().rulesVersion).toBe('balance-v1.22');
    expect(store.rulesCalls).toEqual(['balance-v9.9', null]);

    store.tournamentRow = { ...store.tournamentRow!, balance_rules_version: 'balance-v1.22' };
    store.rulesCalls.length = 0;
    expect((await register(app, null, guestBody({ nickname: 'C' }))).json().rulesVersion).toBe('balance-v1.22');
    expect((await register(app, null, guestBody({ nickname: 'D' }))).json().rulesVersion).toBe('balance-v1.22');
    expect(store.rulesCalls).toEqual(['balance-v1.22']); // друга заявка — з кешу

    store.versions = [];
    store.tournamentRow = { ...store.tournamentRow!, balance_rules_version: null };
    expect((await register(app, null, guestBody({ nickname: 'E' }))).json().rulesVersion).toBe('balance-v1.0');
    await app.close();
  });

  it('без свого origin — 403; частіше запасу (3 поспіль) — 429 з retryAfterMs', async () => {
    const app = await makeApp();
    const noOrigin = await app.inject({ method: 'POST', url: '/api/pvp/registrations', payload: guestBody() });
    expect(noOrigin.statusCode).toBe(403);
    clock += 60_000;
    const quick = async (nick: string) =>
      app.inject({ method: 'POST', url: '/api/pvp/registrations', payload: guestBody({ nickname: nick }), headers: { origin: ORIGIN } });
    expect((await quick('A')).statusCode).toBe(200);
    expect((await quick('B')).statusCode).toBe(200);
    expect((await quick('C')).statusCode).toBe(200);
    const limited = await quick('D');
    expect(limited.statusCode).toBe(429);
    expect(limited.json().retryAfterMs).toBeGreaterThan(0);
    await app.close();
  });
});

describe('createPvpSupabaseStore (PostgREST)', () => {
  type Req = { url: string; init: RequestInit };
  function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
    const calls: Req[] = [];
    const impl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const r = responses.shift() ?? { status: 200, body: [] };
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    return { calls, impl };
  }
  const KEY = 'service-key-for-test';

  it('читання турніру й шкали, insert із return=representation; ключ — у заголовках, не в URL', async () => {
    const C_ID = '0b1e7a4c-1111-4111-8111-111111111111';
    const f = fakeFetch([
      { status: 200, body: [{ id: T_ID, status: 'registration_open' }] },
      { status: 200, body: [{ version: 'balance-v1.22', rules: { a: 1 } }] },
      { status: 200, body: [] },
      { status: 201, body: [{ id: 'r1' }] },
      // registrationStatus('Dark_Lord'): живої немає → є відхилена
      { status: 200, body: [] },
      { status: 200, body: [{ status: 'rejected' }] },
      // registrationStatus('Nick'): жива є — друга (про відхилену) не потрібна
      { status: 200, body: [{ status: 'pending' }] },
      // registrationStatus('Nobody'): нічого
      { status: 200, body: [] },
      { status: 200, body: [] },
      // characterRegistrations: дві живі (одна без підпису), потім жодної
      { status: 200, body: [{ nickname: 'Tayforn', status: 'confirmed', sig: 'S1' }, { nickname: 'x', status: 'pending', sig: null }] },
      { status: 200, body: [] },
    ]);
    const s = createPvpSupabaseStore('https://pvp.example.supabase.co/', KEY, f.impl);
    expect(await s.tournament(T_ID)).toMatchObject({ id: T_ID });
    expect(await s.rules('balance-v1.22')).toEqual({ version: 'balance-v1.22', rules: { a: 1 } });
    expect(await s.rules(null)).toBeNull();
    expect(await s.insertRegistration({ nickname: 'X' })).toEqual({ id: 'r1' });
    expect(await s.registrationStatus(T_ID, 'Dark_Lord')).toBe('rejected');
    expect(await s.registrationStatus(T_ID, 'Nick')).toBe('pending');
    expect(await s.registrationStatus(T_ID, 'Nobody')).toBeNull();
    expect(await s.characterRegistrations(T_ID, C_ID)).toEqual([
      { nickname: 'Tayforn', status: 'confirmed', sig: 'S1' },
      { nickname: 'x', status: 'pending', sig: null },
    ]);
    expect(await s.characterRegistrations(T_ID, C_ID)).toEqual([]);

    expect(f.calls[0].url).toBe(`https://pvp.example.supabase.co/rest/v1/tournaments?id=eq.${T_ID}&select=id,name,status,event_date,team_mode,team_size,balance_rules_version&limit=1`);
    expect(f.calls[2].url).toContain('balance_rules?select=version,rules&order=created_at.desc&limit=1');
    expect(f.calls[3].init.method).toBe('POST');
    expect((f.calls[3].init.headers as Record<string, string>).Prefer).toBe('return=representation');
    expect(JSON.parse(String(f.calls[3].init.body))).toEqual({ nickname: 'X' });
    const url = (i: number) => decodeURIComponent(f.calls[i].url);
    // спершу жива заявка (детерміновано — найстаріша), лише потім відхилена
    expect(url(4)).toContain('nickname=ilike.Dark\\_Lord');
    expect(url(4)).toMatch(/&status=neq\.rejected&order=created_at\.asc&limit=1$/);
    expect(url(5)).toContain('nickname=ilike.Dark\\_Lord');
    expect(url(5)).toMatch(/&status=eq\.rejected&limit=1$/);
    expect(url(6)).toContain('nickname=ilike.Nick&');
    expect(url(7)).toContain('nickname=ilike.Nobody&'); // для 'Nick' другого запиту не було
    expect(url(9)).toBe(
      `https://pvp.example.supabase.co/rest/v1/registrations?tournament_id=eq.${T_ID}&kind=eq.player` +
        `&character_id=eq.${C_ID}&status=neq.rejected&select=nickname,status,sig:item_breakdown->>sig&order=created_at.asc&limit=20`,
    );
    expect(f.calls).toHaveLength(11);
    for (const c of f.calls) {
      expect(c.url).not.toContain(KEY);
      expect((c.init.headers as Record<string, string>).apikey).toBe(KEY);
    }
  });

  it('дубль ніку через PostgREST: нік тримає жива заявка — «уже зареєстровано», навіть коли є й відхилена', async () => {
    let live: Array<{ status: string }> = [{ status: 'pending' }];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const u = decodeURIComponent(url);
      let status = 200;
      let body: unknown = [];
      if (init.method === 'POST') {
        status = 409;
        body = { code: '23505', message: 'duplicate key value violates unique constraint "registrations_tournament_nickname_uidx"' };
      } else if (u.includes('/tournaments?')) body = [store.tournamentRow];
      else if (u.includes('/balance_rules?')) body = [{ version: rulesV122.version, rules: rulesV122.rules }];
      else if (u.includes('status=neq.rejected')) body = live;
      else if (u.includes('status=eq.rejected')) body = [{ status: 'rejected' }]; // відхилена є завжди
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const app = await makeApp({ pvpStore: createPvpSupabaseStore('https://pvp.example.supabase.co', KEY, fetchImpl) });
    const res = await register(app, null, guestBody());
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'duplicate_nickname', message: 'Нікнейм «Tayforn» уже зареєстровано на цей турнір.' });
    // живої немає (до 0033 відхилена сама тримає нік) — тоді про видалення відхиленої
    live = [];
    const rej = await register(app, null, guestBody());
    expect(rej.json().message).toMatch(/уже відхилено.*адмін має видалити/);
    await app.close();
  });

  it('помилка PostgREST → PvpDbError з кодом; мережа → статус 0', async () => {
    const f = fakeFetch([{ status: 409, body: { code: '23505', message: 'duplicate key value violates unique constraint "registrations_tournament_nickname_uidx"' } }]);
    const s = createPvpSupabaseStore('https://pvp.example.supabase.co', KEY, f.impl);
    const err = await s.insertRegistration({}).catch((e) => e);
    expect(err).toBeInstanceOf(PvpDbError);
    expect(err).toMatchObject({ status: 409, code: '23505' });
    const down = createPvpSupabaseStore('https://pvp.example.supabase.co', KEY, (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch);
    expect(await down.tournament(T_ID).catch((e) => e)).toMatchObject({ status: 0 });
  });
});

// ── Міграція pw-pvp 0034: хто може вставити заявку в обхід бекенда ──
// Справжній файл міграції на мінімальній схемі в PGlite: роль anon — як анонімний
// ключ сайту (RLS діє), власник бази — як service_role бекенда (RLS минає).
describe('pw-pvp 0034_server_registrations.sql (RLS публічного insert)', () => {
  const SQL = readFileSync(fileURLToPath(new URL('../../../pw-pvp/supabase/migrations/0034_server_registrations.sql', import.meta.url)), 'utf8');
  const FIXED = '11111111-1111-4111-8111-111111111111';
  const RANDOM = '22222222-2222-4222-8222-222222222222';
  const CHAR = '33333333-3333-4333-8333-333333333333';
  let pg: PGlite;

  beforeEach(async () => {
    pg = new PGlite();
    await pg.exec(`
      create table tournaments (
        id uuid primary key, status text not null, event_date date not null,
        team_mode text not null default 'fixed'
      );
      create table registrations (
        id uuid primary key default gen_random_uuid(),
        tournament_id uuid not null references tournaments(id),
        nickname text not null, kind text not null default 'player', team_registration_id uuid,
        status text not null default 'pending', rules_ack boolean not null default false,
        character_id uuid, char_class text, character_snapshot jsonb
      );
      alter table registrations enable row level security;
      create role anon nologin;
      grant select on tournaments to anon;
      grant insert on registrations to anon;
      insert into tournaments values
        ('${FIXED}', 'registration_open', current_date, 'fixed'),
        ('${RANDOM}', 'registration_open', current_date, 'balanced_random');
    `);
    await pg.exec(SQL);
  });
  afterEach(() => pg.close());

  /** insert від імені anon; повертає код помилки або 'ok'. */
  async function anonInsert(tournamentId: string, characterId: string | null): Promise<string> {
    await pg.exec('set role anon');
    try {
      await pg.query(
        `insert into registrations (tournament_id, nickname, rules_ack, character_id, char_class, character_snapshot)
         values ($1, 'Nick', true, $2, 'archer', '{}'::jsonb)`,
        [tournamentId, characterId],
      );
      return 'ok';
    } catch (e) {
      return (e as { code?: string }).code ?? String(e);
    } finally {
      await pg.exec('reset role');
    }
  }

  it('звичайний турнір без персонажа — можна; з character_id чи на фул-рандом — лише бекенд (42501)', async () => {
    expect(await anonInsert(FIXED, null)).toBe('ok');
    expect(await anonInsert(FIXED, CHAR)).toBe('42501');
    expect(await anonInsert(RANDOM, null)).toBe('42501');
    expect(await anonInsert(RANDOM, CHAR)).toBe('42501');
    // service_role (тут — власник бази) RLS минає: заявку персонажем пише бекенд
    await pg.query(`insert into registrations (tournament_id, nickname, rules_ack, character_id) values ($1, 'Tayforn', true, $2)`, [RANDOM, CHAR]);
    expect((await pg.query<{ n: number }>('select count(*)::int as n from registrations')).rows[0].n).toBe(2);
  });

  it('SQL відкату з шапки — валідний: прямий insert на фул-рандом повертається, чужий character_id — ні', async () => {
    const lines = SQL.split('\n');
    const from = lines.findIndex((l) => l.startsWith('-- Відкат'));
    expect(from).toBeGreaterThan(0);
    const rollback = lines.slice(from).filter((l) => l.startsWith('--   ')).map((l) => l.slice(5)).join('\n');
    expect(rollback).toMatch(/^drop policy if exists registrations_insert_public/);
    await pg.exec(rollback);
    expect(await anonInsert(RANDOM, null)).toBe('ok');
    expect(await anonInsert(FIXED, null)).toBe('ok');
    expect(await anonInsert(RANDOM, CHAR)).toBe('42501');
    // без заявленого рядка «and character_id is null» — рівно політика 0032 (для старого сайту)
    await pg.exec(rollback.replace(/^\s*and character_id is null\n/m, ''));
    expect(await anonInsert(RANDOM, CHAR)).toBe('ok');
  });
});

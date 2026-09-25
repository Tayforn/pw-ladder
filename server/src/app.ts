// =========================================================
// HTTP-шар (Fastify): вхід через Discord, сесії в HttpOnly-cookie, ігрові
// роути (проксі до runs.ts) і публічний ладдер. buildApp приймає залежності
// (БД, Discord, конфіг), тож у тестах підставляється PGlite і стаб Discord.
// Усе під /api — Caddy віддає статику фронтенду на / і проксить /api сюди.
// =========================================================

import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import type { Config } from './config';
import type { Db } from './db';
import type { DiscordClient } from './discord';
import { hasAllowedRole } from './discord';
import { ApiError } from './errors';
import {
  createSession, deleteSession, findSessionPlayer, newToken, SESSION_COOKIE, STATE_COOKIE, safeEqual, upsertPlayer,
  type PlayerRow,
} from './sessions';
import { registerPvpRoutes } from './pvp';
import { answerChallenge, cryptoRandom, doAttempt, getActiveRun, loadRunSettings, resetRun, startRun, submitRun, type Rng } from './runs';
import type {
  ApiErrorBody, AttemptRequest, BoardEntry, ChallengeAnswer, LadderView, Me, TalanEntry,
} from '../../src/lib/apiTypes';
import type { AttemptResult } from '../../src/lib/types';

export interface AppDeps {
  config: Config;
  db: Db;
  discord: DiscordClient;
  now?: () => number;
  rng?: Rng;
}

const STATE_TTL_S = 600;

/** Таблиці гільдії, які можна читати через гейтоване проксі. */
const GUILD_TABLES = new Set([
  'players', 'player_activity_checks', 'player_bonuses', 'newbies',
  'activity_checks', 'activities', 'classes', 'point_awards',
  'gear_items', 'gear_item_components', 'loot_items',
]);

export function buildApp(deps: AppDeps): FastifyInstance {
  const { config, db, discord } = deps;
  const now = deps.now ?? Date.now;
  const rng = deps.rng ?? cryptoRandom;
  const app = Fastify({ trustProxy: true, bodyLimit: 64 * 1024 });

  app.register(cookie);

  // domain='.thunderpw.fun' → одна сесія на всі піддомени (ладдер, guild, pvp).
  const cookieBase = {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax' as const,
    path: '/',
    ...(config.cookieDomain ? { domain: config.cookieDomain } : {}),
  };
  const clearOpts = { path: '/', ...(config.cookieDomain ? { domain: config.cookieDomain } : {}) };
  const setSessionCookie = (reply: FastifyReply, token: string) =>
    reply.setCookie(SESSION_COOKIE, token, { ...cookieBase, maxAge: config.sessionTtlDays * 86_400 });

  /** Origin сайту, з якого прийшов запит (ладдер/guild/pvp) — лише зі списку
   * дозволених; використовується для redirect_uri і повернення після входу. */
  function siteOrigin(req: FastifyRequest): string {
    const fromHeader = req.headers.origin;
    if (fromHeader && config.allowedOrigins.includes(fromHeader)) return fromHeader;
    const host = req.headers.host;
    if (host) {
      const candidate = `${req.protocol}://${host}`;
      if (config.allowedOrigins.includes(candidate)) return candidate;
    }
    return config.publicOrigin;
  }

  /** Гравець за cookie сесії; кидає, якщо не залогінений або забанений. */
  async function requirePlayer(req: FastifyRequest): Promise<PlayerRow> {
    const player = await findSessionPlayer(db, req.cookies[SESSION_COOKIE]);
    if (!player) throw new ApiError('unauthorized', 'Потрібен вхід через Discord.');
    if (player.banned) throw new ApiError('forbidden', 'Доступ до ладдера закрито.');
    return player;
  }

  /** Захист від CSRF: змінювальні запити лише зі свого origin. SameSite=Lax
   * уже блокує міжсайтовий POST із cookie — це друга лінія. */
  function assertOrigin(req: FastifyRequest): void {
    const origin = req.headers.origin;
    if (origin && config.allowedOrigins.includes(origin)) return;
    const referer = req.headers.referer;
    if (!origin && referer && config.allowedOrigins.some((o) => referer.startsWith(o + '/'))) return;
    throw new ApiError('bad_origin', 'Некоректне джерело запиту.');
  }

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ApiError) {
      const body: ApiErrorBody = { error: err.code, message: err.message };
      if (err.retryAfterMs != null) body.retryAfterMs = err.retryAfterMs;
      if (err.challenge) body.challenge = err.challenge;
      return reply.status(err.status).send(body);
    }
    if ((err as { statusCode?: number }).statusCode === 400) {
      return reply.status(400).send({ error: 'bad_request', message: 'Некоректний запит.' } satisfies ApiErrorBody);
    }
    app.log.error(err);
    return reply.status(500).send({ error: 'internal', message: 'Внутрішня помилка.' } satisfies ApiErrorBody);
  });

  app.get('/api/health', async () => ({ ok: true }));

  // ---- Автентифікація через Discord ----
  app.get('/api/auth/login', async (req, reply) => {
    const state = newToken();
    reply.setCookie(STATE_COOKIE, state, { ...cookieBase, maxAge: STATE_TTL_S });
    return reply.redirect(discord.authorizeUrl(state, siteOrigin(req) + '/api/auth/callback'));
  });

  app.get('/api/auth/callback', async (req, reply) => {
    const { code, state } = req.query as { code?: string; state?: string };
    const cookieState = req.cookies[STATE_COOKIE];
    reply.clearCookie(STATE_COOKIE, clearOpts);
    const site = siteOrigin(req);
    const home = site + '/';
    if (!code || !state || !cookieState || !safeEqual(state, cookieState)) {
      return reply.redirect(home + '?login=error');
    }
    try {
      const token = await discord.exchangeCode(code, site + '/api/auth/callback');
      const member = await discord.fetchMember(token);
      if (!member || !hasAllowedRole(member, config.discordAllowedRoleIds)) {
        return reply.redirect(home + '?login=denied');
      }
      const player = await db.tx((q) => upsertPlayer(q, member));
      if (player.banned) return reply.redirect(home + '?login=denied');
      const sessionToken = await createSession(db, player.id, config.sessionTtlDays);
      setSessionCookie(reply, sessionToken);
      return reply.redirect(home);
    } catch (e) {
      app.log.error(e);
      return reply.redirect(home + '?login=error');
    }
  });

  app.post('/api/auth/logout', async (req, reply) => {
    assertOrigin(req);
    await deleteSession(db, req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, clearOpts);
    return { ok: true };
  });

  app.get('/api/me', async (req): Promise<Me> => {
    const p = await requirePlayer(req);
    return { playerId: p.id, nickname: p.nickname, avatarUrl: p.avatar_url, runsCount: p.runs_count };
  });

  // ---- Забіг (усе вимагає входу) ----
  app.get('/api/run', async (req) => {
    const p = await requirePlayer(req);
    return getActiveRun(db, p.id);
  });
  app.post('/api/run/start', async (req) => {
    assertOrigin(req);
    const p = await requirePlayer(req);
    return startRun(db, p.id, now(), rng);
  });
  app.post('/api/run/attempt', async (req) => {
    assertOrigin(req);
    const p = await requirePlayer(req);
    return doAttempt(db, p.id, req.body as AttemptRequest, now(), rng);
  });
  app.post('/api/run/challenge', async (req) => {
    assertOrigin(req);
    const p = await requirePlayer(req);
    return answerChallenge(db, p.id, req.body as ChallengeAnswer, now(), rng);
  });
  app.post('/api/run/submit', async (req) => {
    assertOrigin(req);
    const p = await requirePlayer(req);
    return submitRun(db, p.id, now());
  });
  app.post('/api/run/reset', async (req) => {
    assertOrigin(req);
    const p = await requirePlayer(req);
    return resetRun(db, p.id, now());
  });

  // ---- Публічні налаштування (числа правил для тренування й підказок) ----
  app.get('/api/settings', () => loadRunSettings(db));

  // ---- Публічний ладдер ----
  app.get('/api/ladder', async (): Promise<LadderView> => {
    const board = await db.query<BoardEntry>(
      `select b.player_id as "playerId", b.nickname, b.level, b.run_index as "runIndex", b.attempts,
              b.paid_attempts as "paidAttempts", b.best_streak as "bestStreak", b.worst_streak as "worstStreak",
              b.biggest_drop as "biggestDrop", b.biggest_comeback as "biggestComeback", b.success_rate as "successRate",
              b.peak_attempt as "peakAttempt", b.luck_score as "luckScore", b.aggression, b.times_hit_zero as "timesHitZero",
              p.runs_count as "runsCount"
         from ladder_board b join ladder_players p on p.id = b.player_id
        order by b.level desc, b.run_index asc, b.attempts asc, b.paid_attempts asc`,
    );
    const talan = await db.query<TalanEntry>(
      `select player_id as "playerId", nickname, level, run_index as "runIndex", attempts
         from ladder_talan order by level desc, run_index asc, attempts asc`,
    );
    return { board: board.rows, talan: talan.rows };
  });

  app.get('/api/run-history/:playerId', async (req) => {
    const { playerId } = req.params as { playerId: string };
    const { rows } = await db.query<{ history: AttemptResult[] }>('select history from ladder_board where player_id = $1', [playerId]);
    return { history: rows[0]?.history ?? [] };
  });

  // ---- Персонажі pvp.thunderpw.fun (лялька) ----
  registerPvpRoutes(app, { db, now, requirePlayer, assertOrigin });

  // ---- Гейтоване читання даних гільдії (guild.thunderpw.fun) ----
  // Проксі до Supabase REST лише для GET і лише з валідною Discord-сесією
  // (а сесія існує, тільки якщо при вході підтвердились сервер клану + роль).
  // Ключ service_role лишається на сервері; клієнт своїх прав не має.
  app.get('/api/sb/rest/v1/:table', async (req, reply) => {
    await requirePlayer(req);
    const { table } = req.params as { table: string };
    if (!GUILD_TABLES.has(table)) throw new ApiError('forbidden', 'Ця таблиця недоступна.');
    if (!config.supabaseUrl || !config.supabaseServiceKey) {
      throw new ApiError('internal', 'Проксі Supabase не налаштовано.');
    }

    const qs = (req.raw.url ?? '').split('?')[1] ?? '';
    const headers: Record<string, string> = {
      apikey: config.supabaseServiceKey,
      Authorization: `Bearer ${config.supabaseServiceKey}`,
      Accept: String(req.headers.accept ?? 'application/json'),
    };
    for (const h of ['prefer', 'range', 'accept-profile'] as const) {
      const v = req.headers[h];
      if (v) headers[h] = String(v);
    }
    const res = await fetch(`${config.supabaseUrl}/rest/v1/${table}${qs ? '?' + qs : ''}`, { headers });
    const body = await res.text();
    reply.status(res.status);
    for (const h of ['content-type', 'content-range'] as const) {
      const v = res.headers.get(h);
      if (v) reply.header(h, v);
    }
    return reply.send(body);
  });

  return app;
}

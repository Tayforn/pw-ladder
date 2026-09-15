// =========================================================
// Гравці й сесії. Токен сесії — 32 випадкові байти в HttpOnly-cookie; у
// базі лежить лише його SHA-256.
// =========================================================

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Queryable } from './db';
import { nicknameOf, type DiscordMember } from './discord';

export const SESSION_COOKIE = 'ladder_session';
export const STATE_COOKIE = 'ladder_oauth_state';

export const newToken = (): string => randomBytes(32).toString('base64url');
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export interface PlayerRow {
  id: string;
  discord_id: string;
  nickname: string;
  avatar_url: string | null;
  runs_count: number;
  banned: boolean;
}

const PLAYER_COLUMNS = 'id, discord_id, nickname, avatar_url, runs_count, banned';

/** Створює або оновлює гравця за Discord-акаунтом. Нік синхронізується з
 * сервером клану при кожному вході — разом із ладдером і «Таланом». */
export async function upsertPlayer(q: Queryable, member: DiscordMember): Promise<PlayerRow> {
  const nickname = nicknameOf(member);
  const { rows } = await q.query<PlayerRow>(
    `insert into ladder_players (discord_id, nickname, avatar_url)
     values ($1, $2, $3)
     on conflict (discord_id) do update
       set nickname = excluded.nickname, avatar_url = excluded.avatar_url, last_login_at = now()
     returning ${PLAYER_COLUMNS}`,
    [member.userId, nickname, member.avatarUrl],
  );
  const player = rows[0];
  await q.query('update ladder_board set nickname = $2 where player_id = $1 and nickname <> $2', [player.id, nickname]);
  await q.query('update ladder_talan set nickname = $2 where player_id = $1 and nickname <> $2', [player.id, nickname]);
  return player;
}

export async function createSession(q: Queryable, playerId: string, ttlDays: number): Promise<string> {
  const token = newToken();
  await q.query(
    `insert into ladder_sessions (token_hash, player_id, expires_at)
     values ($1, $2, now() + make_interval(days => $3::int))`,
    [hashToken(token), playerId, ttlDays],
  );
  return token;
}

export async function findSessionPlayer(q: Queryable, token: string | undefined): Promise<PlayerRow | null> {
  if (!token || token.length > 128) return null;
  const { rows } = await q.query<PlayerRow>(
    `select p.id, p.discord_id, p.nickname, p.avatar_url, p.runs_count, p.banned
       from ladder_sessions s
       join ladder_players p on p.id = s.player_id
      where s.token_hash = $1 and s.expires_at > now()`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
}

export async function deleteSession(q: Queryable, token: string | undefined): Promise<void> {
  if (!token || token.length > 128) return;
  await q.query('delete from ladder_sessions where token_hash = $1', [hashToken(token)]);
}

export async function purgeExpiredSessions(q: Queryable): Promise<void> {
  await q.query('delete from ladder_sessions where expires_at <= now()');
}

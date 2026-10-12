// =========================================================
// Ставки в юанях на сайті турнірів (pvp.thunderpw.fun): тоталізатор на переможця
// матчу чи турніру. Юані — ігрова валюта: сайт їх не списує, ставка — запис, який
// суперадмін позначає оплаченим, коли гравець передав юані скарбнику в грі (схема,
// пули й правила — міграція pw-pvp 0036_bets.sql).
//
// Тут — лише те, що знає тільки бекенд: хто ставить (Discord-сесія; гість ставити не
// може) і його мітка акаунта в турнірі (playerTag, та сама, що в заявці, — за нею
// place_bet впізнає учасника, який ставить проти себе). Усі правила ринку (відкритий,
// учасник матчу, мін/макс, ліміт ставок) перевіряє функція бази place_bet в одній
// транзакції, а її текст помилки гравцю показуємо як є.
//
//   POST /api/pvp/bets              { tournamentId, matchId | null, pickId, stake, gameNick? }
//   GET  /api/pvp/bets/mine         ?tournamentId= — свої ставки (усі або одного турніру)
//   POST /api/pvp/bets/:id/cancel   — скасувати свою неоплачену ставку
//
// Без PVP_SUPABASE_URL / PVP_SUPABASE_SERVICE_KEY — 503 not_configured.
// =========================================================

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApiError } from './errors';
import { takeToken, type Bucket } from './pacing';
import { BAD_CHARS_RE, UUID_RE } from './pvp';
import { PvpDbError, playerTag, type PvpRestCall } from './pvpRegister';
import type { PlayerRow } from './sessions';

/** Межі суми — як CHECK у bets (0036); мін/макс турніру перевіряє place_bet. */
export const STAKE_MAX = 100_000_000_000;
const GAME_NICK_MAX = 40;
const MINE_LIMIT = 200;
/** Темп ставок гравця: запас 5, далі одна за 2 с. */
const BET_INTERVAL_MS = 2_000;
const BET_BURST = 5;
const MAX_BUCKETS = 5_000;

/** Рядок bets, як його повертає PostgREST. */
export interface PvpBetRow {
  id: string;
  tournament_id: string;
  market: 'match' | 'tournament';
  match_id: string | null;
  pick_id: string | null;
  pick_name: string;
  stake: number | string;
  game_nick: string | null;
  status: 'pending' | 'paid' | 'rejected' | 'cancelled';
  created_at: string;
  paid_at: string | null;
  payout_at: string | null;
  payout_amount: number | string | null;
}

/** Ставка у відповіді (контракт src/data/betsApi.ts у pw-pvp). */
export interface PvpBet {
  id: string;
  tournamentId: string;
  market: 'match' | 'tournament';
  matchId: string | null;
  pickId: string | null;
  pickName: string;
  stake: number;
  gameNick: string | null;
  status: PvpBetRow['status'];
  createdAt: string;
  paidAt: string | null;
  payoutAt: string | null;
  payoutAmount: number | null;
}

export interface PlaceBetArgs {
  tournamentId: string;
  matchId: string | null;
  pickId: string;
  stake: number;
  playerId: string;
  playerNick: string;
  gameNick: string | null;
  accountTag: string;
}

/** Доступ до ставок у базі турнірів — у тестах заглушка. */
export interface PvpBetsStore {
  placeBet(a: PlaceBetArgs): Promise<PvpBetRow>;
  myBets(playerId: string, tournamentId: string | null): Promise<PvpBetRow[]>;
  /** Скасовує лише неоплачену (pending) ставку цього гравця; null — такої немає. */
  cancelBet(id: string, playerId: string): Promise<PvpBetRow | null>;
}

const BET_COLUMNS = 'id,tournament_id,market,match_id,pick_id,pick_name,stake,game_nick,status,created_at,paid_at,payout_at,payout_amount';

export function createPvpBetsStore(call: PvpRestCall): PvpBetsStore {
  return {
    async placeBet(a) {
      return call<PvpBetRow>('rpc/place_bet', {
        method: 'POST',
        body: {
          p_tournament_id: a.tournamentId,
          p_match_id: a.matchId,
          p_pick_id: a.pickId,
          p_stake: a.stake,
          p_player_id: a.playerId,
          p_player_nick: a.playerNick,
          p_game_nick: a.gameNick,
          p_account_tag: a.accountTag,
        },
      });
    },
    async myBets(playerId, tournamentId) {
      const q =
        `bets?player_id=eq.${encodeURIComponent(playerId)}` +
        (tournamentId ? `&tournament_id=eq.${encodeURIComponent(tournamentId)}` : '') +
        `&select=${BET_COLUMNS}&order=created_at.desc&limit=${MINE_LIMIT}`;
      const rows = await call<PvpBetRow[]>(q);
      return Array.isArray(rows) ? rows : [];
    },
    async cancelBet(id, playerId) {
      const q = `bets?id=eq.${encodeURIComponent(id)}&player_id=eq.${encodeURIComponent(playerId)}&status=eq.pending&select=${BET_COLUMNS}`;
      const rows = await call<PvpBetRow[]>(q, { method: 'PATCH', body: { status: 'cancelled' }, prefer: 'return=representation' });
      return Array.isArray(rows) && rows.length ? rows[0] : null;
    },
  };
}

const num = (v: number | string | null): number | null => (v == null ? null : Number(v));

export function betFromRow(r: PvpBetRow): PvpBet {
  return {
    id: r.id,
    tournamentId: r.tournament_id,
    market: r.market,
    matchId: r.match_id,
    pickId: r.pick_id,
    pickName: r.pick_name,
    stake: Number(r.stake),
    gameNick: r.game_nick,
    status: r.status,
    createdAt: r.created_at,
    paidAt: r.paid_at,
    payoutAt: r.payout_at,
    payoutAmount: num(r.payout_amount),
  };
}

interface ParsedBet {
  tournamentId: string;
  matchId: string | null;
  pickId: string;
  stake: number;
  gameNick: string | null;
}

const bad = (message: string): never => {
  throw new ApiError('bad_request', message);
};

/** Перевірка тіла: { tournamentId, matchId: uuid | null, pickId, stake: ціле > 0, gameNick?: рядок }. */
export function parseBetBody(raw: unknown): ParsedBet {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) bad('Потрібне тіло ставки.');
  const b = raw as Record<string, unknown>;
  if (typeof b.tournamentId !== 'string' || !UUID_RE.test(b.tournamentId)) bad('Некоректний турнір.');
  if (b.matchId != null && (typeof b.matchId !== 'string' || !UUID_RE.test(b.matchId))) bad('Некоректний матч.');
  if (typeof b.pickId !== 'string' || !UUID_RE.test(b.pickId)) bad('Обери, на кого ставиш.');
  const stake = typeof b.stake === 'string' && /^\d{1,12}$/.test(b.stake) ? Number(b.stake) : b.stake;
  if (typeof stake !== 'number' || !Number.isSafeInteger(stake) || stake <= 0) bad('Вкажи суму ставки цілим числом юанів.');
  if ((stake as number) > STAKE_MAX) bad('Завелика сума ставки.');
  let gameNick: string | null = null;
  if (b.gameNick != null) {
    if (typeof b.gameNick !== 'string') bad('Некоректний нік персонажа.');
    gameNick = (b.gameNick as string).trim() || null;
    if (gameNick && gameNick.length > GAME_NICK_MAX) bad(`Нік персонажа — до ${GAME_NICK_MAX} символів.`);
    if (gameNick && BAD_CHARS_RE.test(gameNick)) bad('Нік персонажа містить недопустимі символи.');
  }
  return {
    tournamentId: b.tournamentId as string,
    matchId: (b.matchId as string | null | undefined) ?? null,
    pickId: b.pickId as string,
    stake: stake as number,
    gameNick,
  };
}

export interface PvpBetsDeps {
  now: () => number;
  /** null — ставки не налаштовано (503). */
  store: PvpBetsStore | null;
  requirePlayer: (req: FastifyRequest) => Promise<PlayerRow>;
  assertOrigin: (req: FastifyRequest) => void;
  /** Той самий секрет, що й для міток заявок (playerTag). */
  signKey: string;
}

export function registerPvpBetRoutes(app: FastifyInstance, deps: PvpBetsDeps): void {
  const { now, store, requirePlayer, assertOrigin, signKey } = deps;
  const buckets = new Map<string, Bucket>();

  function limit(key: string): void {
    const t = now();
    const r = takeToken(buckets.get(key) ?? { tokens: BET_BURST, at: t }, t, BET_INTERVAL_MS, BET_BURST);
    if (!r.ok) throw new ApiError('rate_limited', 'Забагато спроб поспіль — зачекай кілька секунд.', { retryAfterMs: r.retryAfterMs });
    buckets.set(key, r.bucket);
    if (buckets.size > MAX_BUCKETS) {
      for (const [k, b] of buckets) if (t - b.at >= BET_BURST * BET_INTERVAL_MS) buckets.delete(k);
    }
  }

  function configured(): PvpBetsStore {
    if (!store) throw new ApiError('not_configured', 'Ставки на сервері не налаштовано.');
    return store;
  }

  /** Помилка бази: правило ставки (P0001 з place_bet) — 409 з текстом бази; функції ще немає
   * (міграцію 0036 не виконано) — 503; решта — 502 upstream. */
  async function upstream<T>(what: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ApiError) throw e;
      const err = e as Partial<PvpDbError> | null;
      if (e instanceof PvpDbError && e.code === 'P0001') throw new ApiError('conflict', e.message);
      if (e instanceof PvpDbError && (e.code === 'PGRST202' || e.code === 'PGRST205' || e.code === '42P01')) {
        throw new ApiError('not_configured', 'Ставки ще не ввімкнено в базі турнірів.');
      }
      app.log.warn(
        { what, status: err?.status ?? null, code: err?.code ?? null, detail: String(err?.message ?? e).slice(0, 300) },
        'pvp: база турнірів не відповіла (ставки) — 502 upstream',
      );
      throw new ApiError('upstream', 'База турнірів зараз не відповідає — спробуй трохи пізніше.');
    }
  }

  app.post('/api/pvp/bets', async (req): Promise<{ bet: PvpBet }> => {
    assertOrigin(req);
    const s = configured();
    const player = await requirePlayer(req);
    limit('p:' + player.id);
    const body = parseBetBody(req.body);
    const row = await upstream('ставка', () =>
      s.placeBet({
        ...body,
        playerId: player.id,
        playerNick: player.nickname,
        accountTag: playerTag(signKey, body.tournamentId, player.id),
      }),
    );
    return { bet: betFromRow(row) };
  });

  app.get('/api/pvp/bets/mine', async (req): Promise<{ bets: PvpBet[] }> => {
    const s = configured();
    const player = await requirePlayer(req);
    const { tournamentId } = (req.query ?? {}) as { tournamentId?: unknown };
    if (tournamentId != null && (typeof tournamentId !== 'string' || !UUID_RE.test(tournamentId))) bad('Некоректний турнір.');
    const rows = await upstream('мої ставки', () => s.myBets(player.id, (tournamentId as string | undefined) ?? null));
    return { bets: rows.map(betFromRow) };
  });

  app.post('/api/pvp/bets/:id/cancel', async (req): Promise<{ bet: PvpBet }> => {
    assertOrigin(req);
    const s = configured();
    const player = await requirePlayer(req);
    limit('p:' + player.id);
    const { id } = req.params as { id: string };
    if (!UUID_RE.test(id)) throw new ApiError('not_found', 'Ставку не знайдено.');
    const row = await upstream('скасування ставки', () => s.cancelBet(id, player.id));
    if (!row) throw new ApiError('conflict', 'Скасувати можна лише свою неоплачену ставку — оплачену повертає адмін.');
    return { bet: betFromRow(row) };
  });
}

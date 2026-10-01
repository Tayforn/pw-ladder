// =========================================================
// Заявки на фул-рандом сайту турнірів (pvp.thunderpw.fun): POST
// /api/pvp/registrations. Скор заявки рахує й записує сервер, а не браузер
// гравця: документ персонажа береться з нашої бази (свій персонаж, вхід через
// Discord) або з тіла запиту (гість — чернетка браузера), турнір і версія
// шкали — з Supabase сайту турнірів (PostgREST, service-ключ), скор —
// scoreRegistration із ../pw-pvp/src/server/scorer.ts (та сама модель ляльки,
// що в браузері; esbuild вбудовує її разом із каталогами в index.mjs — див.
// server/tools/build.mjs). Рядок заявки вставляється service-ключем, тож RLS
// його не перевіряє — усе, що перевіряє політика registrations_insert_public
// (турнір відкритий, дата не минула, правила підтверджено, kind/status), тут
// перевіряється явно. Понад це: character_id — лише свого неархівованого
// персонажа (після 0034 рядки з character_id пише тільки бекенд), і один такий
// персонаж — одна жива заявка на турнір.
//
// Без PVP_SUPABASE_URL / PVP_SUPABASE_SERVICE_KEY ендпоінт відповідає 503
// not_configured — сайт турнірів тоді подає заявку напряму в Supabase, як раніше.
// =========================================================

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from './db';
import { ApiError } from './errors';
import { takeToken, type Bucket } from './pacing';
import { BAD_CHARS_RE, UUID_RE, checkCharacterDoc } from './pvp';
import type { PlayerRow } from './sessions';
import type * as Scorer from '../../../pw-pvp/src/server/scorer';

/** Коміт pw-pvp, з яким зібрано бекенд (esbuild --define у server/tools/build.mjs);
 * у tsx/vitest без збірки — 'pw-pvp@dev'. Іде в item_breakdown.scorer. */
declare const __PVP_SCORER__: string | undefined;
export const SCORER_ID = typeof __PVP_SCORER__ === 'string' ? __PVP_SCORER__ : 'pw-pvp@dev';

/** Нік у заявці: 1..40 символів після trim (CHECK у registrations, 0001). */
const NICK_MAX = 40;
/** Темп заявок: запас 3, далі одна за 5 с — на гравця (свій персонаж) чи на IP (гість). */
const REG_INTERVAL_MS = 5_000;
const REG_BURST = 3;
const MAX_BUCKETS = 5_000;
const UPSTREAM_TIMEOUT_MS = 10_000;

// ── Supabase сайту турнірів ─────────────────────────────────────────────

export interface PvpTournament {
  id: string;
  name: string;
  status: string;
  event_date: string;
  team_mode: string | null;
  team_size: number | null;
  balance_rules_version: string | null;
}

export interface PvpRules {
  version: string;
  rules: unknown;
}

/** Помилка PostgREST: HTTP-статус і код Postgres/PostgREST (23505, PGRST204…). */
export class PvpDbError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
  }
}

/** Доступ до бази сайту турнірів — у тестах заглушка. */
export interface PvpStore {
  tournament(id: string): Promise<PvpTournament | null>;
  /** Версія шкали за назвою; null — найновіша (поточна для нових турнірів). */
  rules(version: string | null): Promise<PvpRules | null>;
  /** Статус наявної заявки гравця з таким ніком (без урахування регістру) — для тексту про
   * дубль. Спершу жива (не відхилена) заявка — саме вона тримає нік; 'rejected' — лише
   * коли живої немає (після 0033 на один нік бувають відхилена й повторна). null — жодної. */
  registrationStatus(tournamentId: string, nickname: string): Promise<string | null>;
  /** Живі (не відхилені) заявки цього збереженого персонажа на турнір — від найстарішої, до
   * CHARACTER_ROWS_MAX; sig — підпис бекенда з item_breakdown (null — рядок записав не бекенд). */
  characterRegistrations(tournamentId: string, characterId: string): Promise<CharacterRegistrationRow[]>;
  /** Жива (не відхилена) заявка з міткою акаунта (колонка account_tag, міграція 0035 у pw-pvp) —
   * найстаріша; null — немає. */
  playerRegistration(tournamentId: string, tag: string): Promise<{ nickname: string; status: string } | null>;
  insertRegistration(row: Record<string, unknown>): Promise<{ id: string }>;
}

/** Жива заявка персонажа (characterRegistrations). */
export interface CharacterRegistrationRow {
  nickname: string;
  status: string;
  sig: string | null;
}

/** Скільки живих заявок персонажа читаємо — більше на один турнір не буває в здоровій базі. */
const CHARACTER_ROWS_MAX = 20;

/** Літерал для ilike у PostgREST: «%», «_», «\» і «*» — символи, а не шаблон (як likePattern у pw-pvp). */
const likeLiteral = (s: string): string => s.replace(/[\\%_*]/g, (c) => '\\' + c);

export function createPvpSupabaseStore(baseUrl: string, serviceKey: string, fetchImpl: typeof fetch = fetch): PvpStore {
  const rest = `${baseUrl.replace(/\/+$/, '')}/rest/v1`;
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: 'application/json' };

  async function call<T>(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(`${rest}/${path}`, {
        method: init.method ?? 'GET',
        headers: {
          ...headers,
          ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(init.prefer ? { Prefer: init.prefer } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch (e) {
      throw new PvpDbError(0, null, `мережа: ${(e as Error)?.message ?? e}`);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* не JSON — лишаємо null */
    }
    if (!res.ok) {
      const err = (json && typeof json === 'object' ? json : {}) as { code?: unknown; message?: unknown };
      throw new PvpDbError(res.status, typeof err.code === 'string' ? err.code : null, typeof err.message === 'string' ? err.message : `HTTP ${res.status}`);
    }
    return json as T;
  }
  const first = <T>(rows: T[] | null): T | null => (Array.isArray(rows) && rows.length ? rows[0] : null);

  return {
    async tournament(id) {
      const cols = 'id,name,status,event_date,team_mode,team_size,balance_rules_version';
      return first(await call<PvpTournament[]>(`tournaments?id=eq.${encodeURIComponent(id)}&select=${cols}&limit=1`));
    },
    async rules(version) {
      const q = version
        ? `balance_rules?version=eq.${encodeURIComponent(version)}&select=version,rules&limit=1`
        : 'balance_rules?select=version,rules&order=created_at.desc&limit=1';
      return first(await call<PvpRules[]>(q));
    },
    async registrationStatus(tournamentId, nickname) {
      const base =
        `registrations?tournament_id=eq.${encodeURIComponent(tournamentId)}&kind=eq.player` +
        `&nickname=ilike.${encodeURIComponent(likeLiteral(nickname))}&select=status`;
      // Нік тримає жива заявка (частковий індекс 0033) — її статус і кажемо; відхилену
      // називаємо, лише коли живої немає (до 0033 відхилена теж блокує нік).
      const live = first(await call<Array<{ status: string }>>(`${base}&status=neq.rejected&order=created_at.asc&limit=1`));
      if (live) return live.status;
      return first(await call<Array<{ status: string }>>(`${base}&status=eq.rejected&limit=1`)) ? 'rejected' : null;
    },
    async characterRegistrations(tournamentId, characterId) {
      const q =
        `registrations?tournament_id=eq.${encodeURIComponent(tournamentId)}&kind=eq.player` +
        `&character_id=eq.${encodeURIComponent(characterId)}&status=neq.rejected` +
        `&select=nickname,status,sig:item_breakdown->>sig&order=created_at.asc&limit=${CHARACTER_ROWS_MAX}`;
      const rows = await call<Array<{ nickname: string; status: string; sig?: string | null }>>(q);
      return (Array.isArray(rows) ? rows : []).map((r) => ({ nickname: r.nickname, status: r.status, sig: typeof r.sig === 'string' ? r.sig : null }));
    },
    async playerRegistration(tournamentId, tag) {
      const q =
        `registrations?tournament_id=eq.${encodeURIComponent(tournamentId)}&kind=eq.player&status=neq.rejected` +
        `&account_tag=eq.${encodeURIComponent(tag)}&select=nickname,status&order=created_at.asc&limit=1`;
      return first(await call<Array<{ nickname: string; status: string }>>(q));
    },
    async insertRegistration(row) {
      const rows = await call<Array<{ id: string }>>('registrations?select=id', { method: 'POST', body: row, prefer: 'return=representation' });
      const created = first(rows);
      if (!created?.id) throw new PvpDbError(500, null, 'insert не повернув id заявки');
      return created;
    },
  };
}

// ── Ендпоінт ─────────────────────────────────────────────────────────

/** Відповідь на успішну заявку. */
export interface PvpRegistrationResult {
  /** id рядка registrations. */
  id: string;
  /** Бали за речі (item_points). */
  itemPoints: number;
  /** Скор заявки, як його порахує жеребка (без корекції адміна). */
  score: number;
  /** Якою версією шкали рахували. */
  rulesVersion: string;
  /** Жовті примітки скору (нерозпізнані речі тощо); порожньо — усе гаразд. */
  warn: string[];
}

interface ParsedBody {
  tournamentId: string;
  nickname: string;
  characterId: string | null;
  doc: unknown;
  /** Мітка спроби подачі з браузера (необовʼязкова) — іде в item_breakdown.nonce. */
  nonce: string | null;
}

/** Мітка спроби: випадковий рядок браузера (crypto.randomUUID чи подібне). */
const NONCE_RE = /^[A-Za-z0-9_-]{8,64}$/;

const bad = (message: string): never => {
  throw new ApiError('bad_request', message);
};

/** Перевірка тіла: { tournamentId, nickname, rulesAck: true, characterId? | doc?, memberNicknames?, nonce? }. */
export function parseRegistrationBody(raw: unknown): ParsedBody {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) bad('Потрібне тіло заявки.');
  const b = raw as Record<string, unknown>;
  if (typeof b.tournamentId !== 'string' || !UUID_RE.test(b.tournamentId)) bad('Некоректний турнір.');
  const nickname = typeof b.nickname === 'string' ? b.nickname.trim() : '';
  if (!nickname) bad('Вкажи нікнейм.');
  if (nickname.length > NICK_MAX) bad(`Нікнейм — до ${NICK_MAX} символів.`);
  if (BAD_CHARS_RE.test(nickname)) bad('Нікнейм містить недопустимі символи.');
  if (b.rulesAck !== true) bad('Підтвердь, що ознайомився з правилами турніру.');
  const members = b.memberNicknames;
  if (members != null && (!Array.isArray(members) || members.length > 0)) {
    bad('У фул-рандомі команди складає жеребка — склад команди не подається.');
  }
  const hasChar = b.characterId != null;
  const hasDoc = b.doc != null;
  if (hasChar === hasDoc) bad('Потрібен або збережений персонаж (characterId), або чернетка персонажа (doc).');
  if (hasChar && (typeof b.characterId !== 'string' || !UUID_RE.test(b.characterId))) bad('Некоректний персонаж.');
  if (b.nonce != null && (typeof b.nonce !== 'string' || !NONCE_RE.test(b.nonce))) bad('Некоректна мітка заявки — онови сторінку.');
  return {
    tournamentId: b.tournamentId as string,
    nickname,
    characterId: hasChar ? (b.characterId as string) : null,
    doc: hasDoc ? b.doc : null,
    nonce: typeof b.nonce === 'string' ? b.nonce : null,
  };
}

/** Чернетка гостя без імені (на заявку йде нік із форми) — імʼям стає нік, щоб
 * перевірка документа не відмовила через порожнє поле, яке гравець і не бачить. */
function withName(doc: unknown, nickname: string): unknown {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return doc;
  const name = (doc as { name?: unknown }).name;
  if (typeof name === 'string' && name.trim()) return doc;
  return { ...(doc as object), name: nickname.slice(0, 32) };
}

/** Статус живої заявки — для тексту гравцю (CHECK у registrations: pending/confirmed/rejected). */
const STATUS_TEXT: Record<string, string> = { pending: 'на розгляді', confirmed: 'підтверджена' };

/** 409: з цього Discord-акаунта вже є жива заявка на турнір (mine — її нік і статус, якщо знайшлась). */
function accountTaken(mine: { nickname: string; status: string } | null): ApiError {
  const which = mine ? ` (нікнейм «${mine.nickname}», ${STATUS_TEXT[mine.status] ?? mine.status})` : '';
  return new ApiError(
    'already_registered',
    `З цього Discord-акаунта вже подано заявку на цей турнір${which} — одна заявка з акаунта. Щоб змінити персонажа чи нік, напиши адміну: він відхилить попередню.`,
  );
}

export interface PvpRegisterDeps {
  db: Db;
  now: () => number;
  /** null — прийом заявок не налаштовано (503). */
  store: PvpStore | null;
  requirePlayer: (req: FastifyRequest) => Promise<PlayerRow>;
  /** Гравець за сесією Discord, якщо вона є (null — гість без входу). Забанений теж: у pvp він
   * подається як гість, але заявка рахується на його акаунт. */
  sessionPlayer: (req: FastifyRequest) => Promise<PlayerRow | null>;
  assertOrigin: (req: FastifyRequest) => void;
  /** Секрет підпису заявок (HMAC) — у проді service-ключ бази турнірів; назовні не виходить. */
  signKey: string;
}

/** Підпис бекенда для заявки збереженим персонажем: HMAC(турнір, персонаж). Рядок із таким
 * підписом міг записати лише бекенд — анонімний ключ його не підробить. */
export function registrationSig(key: string, tournamentId: string, characterId: string): string {
  return createHmac('sha256', key).update(`pvp-reg-v1|${tournamentId}|${characterId}`).digest('base64url').slice(0, 32);
}

/** Мітка Discord-акаунта в заявці (колонка account_tag): HMAC(турнір, гравець ладдера).
 * Лише бекенд може її поставити, з неї не видно, хто це, і між турнірами вона різна. Ключ —
 * той самий секрет, що й для sig: заміна PVP_SUPABASE_SERVICE_KEY міняє всі мітки, тож на
 * відкритих турнірах кожен акаунт зможе подати ще раз — ключ міняти, коли їх немає. */
export function playerTag(key: string, tournamentId: string, playerId: string): string {
  return createHmac('sha256', key).update(`pvp-player-v1|${tournamentId}|${playerId}`).digest('base64url').slice(0, 32);
}

function sigMatches(got: string | null, want: string): boolean {
  if (!got || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

// Скорер із каталогами (кілька МБ JSON) вантажиться при першій заявці, а не при старті
// (esbuild без splitting лишає його в тому ж бандлі, але ініціалізує ліниво).
let scorerPromise: Promise<typeof Scorer> | null = null;
const loadScorer = (): Promise<typeof Scorer> => (scorerPromise ??= import('../../../pw-pvp/src/server/scorer'));

export function registerPvpRegistrationRoutes(app: FastifyInstance, deps: PvpRegisterDeps): void {
  const { db, now, store, requirePlayer, sessionPlayer, assertOrigin, signKey } = deps;

  // Заявки одного гравця — строго по черзі (бекенд — один процес): дві одночасні не
  // проскочать повз перевірку «одна заявка з акаунта» до того, як перша запишеться.
  const queues = new Map<string, Promise<void>>();
  async function onePerPlayer<T>(playerId: string | null, fn: () => Promise<T>): Promise<T> {
    if (!playerId) return fn();
    const prev = queues.get(playerId) ?? Promise.resolve();
    let release!: () => void;
    const done = new Promise<void>((r) => (release = r));
    const tail = prev.then(() => done);
    queues.set(playerId, tail);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (queues.get(playerId) === tail) queues.delete(playerId);
    }
  }
  const buckets = new Map<string, Bucket>();
  const rulesCache = new Map<string, PvpRules>();

  function limit(key: string): void {
    const t = now();
    const r = takeToken(buckets.get(key) ?? { tokens: REG_BURST, at: t }, t, REG_INTERVAL_MS, REG_BURST);
    if (!r.ok) throw new ApiError('rate_limited', 'Забагато спроб поспіль — зачекай кілька секунд.', { retryAfterMs: r.retryAfterMs });
    buckets.set(key, r.bucket);
    if (buckets.size > MAX_BUCKETS) {
      // Повний запас — однаково що й нового ключа немає: такі прибираємо.
      for (const [k, b] of buckets) if (t - b.at >= REG_BURST * REG_INTERVAL_MS) buckets.delete(k);
    }
  }

  /** Запит до бази турнірів: збій мережі чи відмова — 502 upstream. У лог (warn → stdout →
   * journalctl, логер Fastify — app.ts) лише що робили, HTTP-статус, код і текст PostgREST:
   * ключ живе в заголовках запиту, а не в помилці, тож туди не потрапляє. */
  async function upstream<T>(what: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ApiError) throw e;
      const err = e as Partial<PvpDbError> | null;
      app.log.warn(
        { what, status: err?.status ?? null, code: err?.code ?? null, detail: String(err?.message ?? e).slice(0, 300) },
        'pvp: база турнірів не відповіла — 502 upstream',
      );
      throw new ApiError('upstream', 'База турнірів зараз не відповідає — спробуй трохи пізніше.');
    }
  }

  async function rulesNamed(s: PvpStore, version: string): Promise<PvpRules | null> {
    const hit = rulesCache.get(version);
    if (hit) return hit;
    const row = await s.rules(version);
    if (row) rulesCache.set(row.version, row); // версії шкали незмінні — кешуємо
    return row;
  }

  /** Версія шкали — як у браузері (rulesVersionFor + hasRulesVersion): закріплена за
   * турніром, якщо вона є в базі (вбудована — без запиту); інакше найновіша; база
   * порожня — вбудована (rulesRaw: null). */
  async function rulesFor(s: PvpStore, version: string | null, builtin: string): Promise<{ rulesRaw: unknown; rulesVersion: string }> {
    if (version === builtin) return { rulesRaw: null, rulesVersion: builtin };
    if (version) {
      const row = await rulesNamed(s, version);
      if (row) return { rulesRaw: row.rules, rulesVersion: row.version };
    }
    const latest = await s.rules(null);
    return latest ? { rulesRaw: latest.rules, rulesVersion: latest.version } : { rulesRaw: null, rulesVersion: builtin };
  }

  async function insert(s: PvpStore, row: Record<string, unknown>, nickname: string, tournamentId: string, tag: string | null): Promise<string> {
    try {
      return (await s.insertRegistration(row)).id;
    } catch (e) {
      if (e instanceof PvpDbError && e.code === '23505') {
        // Друга жива заявка з того самого акаунта (індекс 0035): запит, що проскочив повз
        // перевірку (інший процес, insert, завершений уже після тайм-ауту).
        if (tag && /registrations_tournament_account_uidx/.test(e.message)) {
          throw accountTaken(await s.playerRegistration(tournamentId, tag).catch(() => null));
        }
        // Дубль ніку (registrations_tournament_nickname_uidx; після 0033 відхилена нік не тримає).
        // registrationStatus спершу шукає живу заявку — «відхилено» лише коли живої немає.
        const status = await s.registrationStatus(tournamentId, nickname).catch(() => null);
        throw new ApiError(
          'duplicate_nickname',
          status === 'rejected'
            ? `Заявку з нікнеймом «${nickname}» на цей турнір уже відхилено — щоб подати знову з цим ніком, адмін має видалити відхилену заявку.`
            : `Нікнейм «${nickname}» уже зареєстровано на цей турнір.`,
        );
      }
      if (e instanceof PvpDbError && e.code === '23514') {
        const m = /constraint "([^"]+)"/.exec(e.message);
        throw new ApiError('bad_request', `База турнірів не прийняла заявку${m ? ` (перевірка ${m[1]})` : ''}.`);
      }
      throw e;
    }
  }

  app.post('/api/pvp/registrations', async (req): Promise<PvpRegistrationResult> => {
    assertOrigin(req);
    if (!store) throw new ApiError('not_configured', 'Прийом заявок бекендом не налаштовано.');
    const body = parseRegistrationBody(req.body);

    // Документ: свій збережений персонаж (вхід через Discord) або чернетка з тіла. Є сесія
    // Discord (навіть із чернеткою) — заявка рахується на цей акаунт; без сесії — гість.
    let doc: unknown;
    let characterId: string | null = null;
    let characterRev: number | null = null;
    let player: PlayerRow | null;
    if (body.characterId) {
      const p = await requirePlayer(req);
      player = p;
      limit('p:' + p.id);
      const { rows } = await db.query<{ doc: unknown; revision: number }>(
        'select doc, revision from pvp_characters where id = $1 and player_id = $2 and archived_at is null',
        [body.characterId, p.id],
      );
      if (!rows[0]) throw new ApiError('not_found', 'Персонажа не знайдено.');
      doc = rows[0].doc;
      characterId = body.characterId;
      characterRev = rows[0].revision;
    } else {
      // Спершу ліміт за IP (без звернення до бази), потім сесія — лише щоб зарахувати заявку
      // на акаунт (і ліміт гравця): без сесії — гість.
      limit('ip:' + req.ip);
      player = await sessionPlayer(req);
      if (player) limit('p:' + player.id);
      doc = withName(body.doc, body.nickname);
      checkCharacterDoc(doc); // розмір, глибина, рядки — як при збереженні персонажа
    }

    // Турнір: відкритий, дата не минула (current_date бази — UTC), балансний фул-рандом.
    const t = await upstream('турнір', () => store.tournament(body.tournamentId));
    if (!t) throw new ApiError('not_found', 'Турнір не знайдено.');
    const today = new Date(now()).toISOString().slice(0, 10);
    if (t.status !== 'registration_open' || t.event_date < today) {
      throw new ApiError('registration_closed', 'Реєстрація на цей турнір закрита або турнір уже пройшов.');
    }
    if (t.team_mode !== 'balanced_random' || !t.team_size) {
      throw new ApiError('bad_request', 'Через бекенд подаються лише заявки на фул-рандом — онови сторінку.');
    }

    // Одна жива заявка з Discord-акаунта на турнір — будь-яким персонажем, чернеткою чи ніком.
    // Мітка акаунта — колонка account_tag (0035): її пише лише бекенд, перерахунок адміна її не
    // чіпає, а частковий унікальний індекс тримає правило в самій базі. Тут — швидка перевірка
    // з зрозумілим текстом і черга запитів гравця. Відхилена не рахується: після відхилення
    // можна подати знову. Гість без входу акаунта не має — його дублі звіряє адмін.
    const tag = player ? playerTag(signKey, t.id, player.id) : null;
    return onePerPlayer(player?.id ?? null, async () => {
      if (tag) {
        const mine = await upstream('заявка акаунта', () => store.playerRegistration(t.id, tag));
        if (mine) throw accountTaken(mine);
      }

      // Один збережений персонаж — одна жива заявка на турнір (з іншим ніком теж). Відхилена
      // не рахується: після відхилення можна подати знову. Рахуються лише рядки з підписом
      // бекенда: до міграції 0034 анонімний ключ може вставити рядок із чужим character_id —
      // такий рядок справжнього власника не блокує. Гість (doc у тілі) персонажа в профілі
      // не має — його дублі, як і раніше, звіряє адмін.
      const ownCharacter = characterId;
      const sig = ownCharacter ? registrationSig(signKey, t.id, ownCharacter) : null;
      if (ownCharacter && sig) {
        const rows = await upstream('заявка персонажа', () => store.characterRegistrations(t.id, ownCharacter));
        const live = rows.find((r) => sigMatches(r.sig, sig));
        if (live) {
          throw new ApiError(
            'already_registered',
            `Цим персонажем уже подано заявку на цей турнір (нікнейм «${live.nickname}», ${STATUS_TEXT[live.status] ?? live.status}) — друга заявка тим самим персонажем не приймається.`,
          );
        }
      }

      const scorer = await loadScorer();
      const { rulesRaw, rulesVersion } = await upstream('шкала', () => rulesFor(store, t.balance_rules_version, scorer.BUILTIN_RULES_VERSION));
      const res = scorer.scoreRegistration({
        doc, rulesRaw, rulesVersion, teamSize: t.team_size,
        tournament: { teamMode: t.team_mode, teamSize: t.team_size },
        scorer: SCORER_ID,
        tags: { ...(body.nonce ? { nonce: body.nonce } : {}), ...(sig ? { sig } : {}) },
      });
      if (!res.ok) throw new ApiError('bad_request', res.blockReason);

      const row: Record<string, unknown> = {
        tournament_id: t.id,
        nickname: body.nickname,
        rules_ack: true,
        member_nicknames: null,
        kind: 'player',
        status: 'pending',
        ...res.columns,
        character_id: characterId,
        character_rev: characterRev,
        character_snapshot: res.doc,
        ...(tag ? { account_tag: tag } : {}),
        doll_confirmed_at: new Date(now()).toISOString(),
      };
      const id = await upstream('заявка', () => insert(store, row, body.nickname, t.id, tag));
      return { id, itemPoints: res.itemPoints, score: res.score, rulesVersion: res.rulesVersion, warn: res.warn };
    });
  });
}

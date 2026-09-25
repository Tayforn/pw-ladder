// =========================================================
// Персонажі pvp.thunderpw.fun (лялька): CRUD /api/pvp/characters. Документ
// будує й повністю перевіряє редактор у pw-pvp (src/doll/model/doc.ts —
// цілісність посилань, ліміти, коди ролів); сервер каталогу речей не має і
// перевіряє лише те, що захищає базу й інших людей: власника, розмір,
// форму верхнього рівня, клас/рівень/ім'я і «сміття» в рядках. Базових
// статів у документі немає (лише id речей і додані роли), тож підробити
// річ, підмінивши JSON, не вийде.
//
// Конфлікти: PUT несе baseRevision — ревізію, яку редактор відкрив. Якщо
// з іншого пристрою вже зберегли новішу, запис не проходить (409), і
// редактор пропонує завантажити серверну чи перезаписати свідомо.
// =========================================================

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from './db';
import { ApiError } from './errors';
import type { PlayerRow } from './sessions';

/** Класи сервера гільдії (ключі ляльки); 11–14 з Хелпера на сервері немає. */
export const PVP_CLASSES = ['by', 'ga', 'ya', 'rl', 'ij', 'js', 'fx', 'sj', 'ej', 'rg'] as const;
export const MAX_CHARACTERS = 8;
/** Межа сирого JSON документа. Редактор тримає ≤ 32 КБ у форматі jsonb —
 * тут запас на різницю форматів; колонка має CHECK 48 КБ. */
export const MAX_DOC_BYTES = 40 * 1024;
const MAX_NAME = 32;
/** Жоден рядок документа не довший: імена ≤ 32, id речей/сетів і коди ролів — кілька символів. */
const MAX_STRING = 64;
const MAX_DEPTH = 8;
/** Не частіше одного запису на гравця за цей час — збереження явне, кнопкою. */
const WRITE_GAP_MS = 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Керівні символи й одинокі сурогати ламають показ і пошук; редактор їх вирізає (cleanText).
// eslint-disable-next-line no-control-regex
const BAD_CHARS_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export interface CharacterSummary {
  id: string;
  name: string;
  cls: string;
  level: number;
  revision: number;
  updatedAt: string;
  items: number;
  sets: number;
}

export interface CharacterRecord {
  id: string;
  name: string;
  cls: string;
  level: number;
  revision: number;
  updatedAt: string;
  doc: unknown;
}

interface DocHead {
  name: string;
  cls: string;
  level: number;
}

const bad = (message: string): never => {
  throw new ApiError('bad_request', message);
};

/** Обхід усього документа: глибина, скінченні числа, короткі чисті рядки, без «небезпечних» ключів. */
function walk(v: unknown, depth: number): void {
  if (depth > MAX_DEPTH) bad('Документ персонажа занадто глибокий.');
  if (v === null || typeof v === 'boolean') return;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) bad('У документі персонажа є некоректне число.');
    return;
  }
  if (typeof v === 'string') {
    if (v.length > MAX_STRING || BAD_CHARS_RE.test(v)) bad('У документі персонажа є задовгий або некоректний рядок.');
    return;
  }
  if (Array.isArray(v)) {
    for (const x of v) walk(x, depth + 1);
    return;
  }
  if (typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(k) || k.length > MAX_STRING) bad('У документі персонажа є некоректний ключ.');
      walk(x, depth + 1);
    }
    return;
  }
  bad('У документі персонажа є некоректне значення.');
}

/** Перевірка документа перед записом; повертає поля для колонок. */
export function checkCharacterDoc(raw: unknown): DocHead {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) bad('Потрібен документ персонажа.');
  const doc = raw as Record<string, unknown>;
  if (doc.v !== 2) bad('Непідтримувана версія документа персонажа — онови сторінку.');
  const bytes = Buffer.byteLength(JSON.stringify(doc), 'utf8');
  if (bytes > MAX_DOC_BYTES) bad(`Персонаж завеликий (${Math.ceil(bytes / 1024)} КБ, можна до ${MAX_DOC_BYTES / 1024}).`);
  walk(doc, 0);

  const name = typeof doc.name === 'string' ? doc.name.trim() : '';
  if (!name) bad('Дай персонажу імʼя.');
  if (name.length > MAX_NAME) bad(`Імʼя персонажа — до ${MAX_NAME} символів.`);
  const cls = doc.cls;
  if (typeof cls !== 'string' || !(PVP_CLASSES as readonly string[]).includes(cls)) bad('Невідомий клас персонажа.');
  const level = doc.level;
  if (typeof level !== 'number' || !Number.isInteger(level) || level < 1 || level > 105) bad('Рівень персонажа — від 1 до 105.');
  if (!Array.isArray(doc.items) || doc.items.length > 100) bad('Речей у персонажа — до 100.');
  if (!doc.main || typeof doc.main !== 'object' || Array.isArray(doc.main)) bad('У персонажа немає Головного комплекту.');
  if (!Array.isArray(doc.sets) || doc.sets.length > 5) bad('Сетів у персонажа — до 5.');
  return { name, cls: cls as string, level: level as number };
}

const SUMMARY_COLS = `id, name, cls, level, revision, updated_at as "updatedAt",
  jsonb_array_length(doc->'items')::int as items, jsonb_array_length(doc->'sets')::int as sets`;
const RECORD_COLS = `id, name, cls, level, revision, updated_at as "updatedAt", doc`;

function isUniqueViolation(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { code?: string }).code === '23505';
}
const nameTaken = () => new ApiError('conflict', 'Персонаж із таким імʼям уже є — дай інше.');

export interface PvpDeps {
  db: Db;
  now: () => number;
  requirePlayer: (req: FastifyRequest) => Promise<PlayerRow>;
  assertOrigin: (req: FastifyRequest) => void;
}

export function registerPvpRoutes(app: FastifyInstance, deps: PvpDeps): void {
  const { db, now, requirePlayer, assertOrigin } = deps;
  const lastWrite = new Map<string, number>();

  /** Змінювальний запит: свій origin, вхід і не частіше WRITE_GAP_MS. */
  async function writer(req: FastifyRequest): Promise<PlayerRow> {
    assertOrigin(req);
    const p = await requirePlayer(req);
    const t = now();
    const prev = lastWrite.get(p.id);
    if (prev != null && t - prev < WRITE_GAP_MS) {
      throw new ApiError('rate_limited', 'Зачекай секунду й спробуй ще раз.', { retryAfterMs: WRITE_GAP_MS - (t - prev) });
    }
    lastWrite.set(p.id, t);
    return p;
  }

  const charId = (req: FastifyRequest): string => {
    const { id } = req.params as { id: string };
    if (!UUID_RE.test(id)) throw new ApiError('not_found', 'Персонажа не знайдено.');
    return id;
  };

  app.get('/api/pvp/characters', async (req): Promise<{ characters: CharacterSummary[]; max: number }> => {
    const p = await requirePlayer(req);
    const { rows } = await db.query<CharacterSummary>(
      `select ${SUMMARY_COLS} from pvp_characters where player_id = $1 and archived_at is null order by updated_at desc`,
      [p.id],
    );
    return { characters: rows, max: MAX_CHARACTERS };
  });

  app.get('/api/pvp/characters/:id', async (req): Promise<CharacterRecord> => {
    const p = await requirePlayer(req);
    const id = charId(req);
    const { rows } = await db.query<CharacterRecord>(
      `select ${RECORD_COLS} from pvp_characters where id = $1 and player_id = $2 and archived_at is null`,
      [id, p.id],
    );
    if (!rows[0]) throw new ApiError('not_found', 'Персонажа не знайдено.');
    return rows[0];
  });

  app.post('/api/pvp/characters', async (req): Promise<CharacterRecord> => {
    const p = await writer(req);
    const { doc } = (req.body ?? {}) as { doc?: unknown };
    const head = checkCharacterDoc(doc);
    try {
      return await db.tx(async (q) => {
        // Лічимо під блокуванням рядка гравця: дві одночасні вкладки не проскочать ліміт.
        await q.query('select 1 from ladder_players where id = $1 for update', [p.id]);
        const { rows: cnt } = await q.query<{ n: number }>(
          'select count(*)::int as n from pvp_characters where player_id = $1 and archived_at is null',
          [p.id],
        );
        if ((cnt[0]?.n ?? 0) >= MAX_CHARACTERS) {
          throw new ApiError('conflict', `Можна мати до ${MAX_CHARACTERS} персонажів — видали непотрібного.`);
        }
        const { rows } = await q.query<CharacterRecord>(
          `insert into pvp_characters (player_id, name, cls, level, doc) values ($1, $2, $3, $4, $5)
           returning ${RECORD_COLS}`,
          [p.id, head.name, head.cls, head.level, JSON.stringify({ ...(doc as object), name: head.name })],
        );
        return rows[0];
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw nameTaken();
      throw e;
    }
  });

  app.put('/api/pvp/characters/:id', async (req): Promise<CharacterRecord> => {
    const p = await writer(req);
    const id = charId(req);
    const { doc, baseRevision } = (req.body ?? {}) as { doc?: unknown; baseRevision?: unknown };
    if (typeof baseRevision !== 'number' || !Number.isInteger(baseRevision)) bad('Немає ревізії персонажа — онови сторінку.');
    const head = checkCharacterDoc(doc);
    let rows: CharacterRecord[];
    try {
      ({ rows } = await db.query<CharacterRecord>(
        `update pvp_characters
            set name = $3, cls = $4, level = $5, doc = $6, revision = revision + 1, updated_at = now()
          where id = $1 and player_id = $2 and archived_at is null and revision = $7
          returning ${RECORD_COLS}`,
        [id, p.id, head.name, head.cls, head.level, JSON.stringify({ ...(doc as object), name: head.name }), baseRevision],
      ));
    } catch (e) {
      if (isUniqueViolation(e)) throw nameTaken();
      throw e;
    }
    if (rows[0]) return rows[0];
    const { rows: cur } = await db.query<{ revision: number }>(
      'select revision from pvp_characters where id = $1 and player_id = $2 and archived_at is null',
      [id, p.id],
    );
    if (!cur[0]) throw new ApiError('not_found', 'Персонажа не знайдено.');
    throw new ApiError('conflict', 'Персонажа вже змінено в іншій вкладці чи на іншому пристрої.');
  });

  app.delete('/api/pvp/characters/:id', async (req) => {
    const p = await writer(req);
    const id = charId(req);
    const { rows } = await db.query<{ id: string }>(
      'update pvp_characters set archived_at = now() where id = $1 and player_id = $2 and archived_at is null returning id',
      [id, p.id],
    );
    if (!rows[0]) throw new ApiError('not_found', 'Персонажа не знайдено.');
    return { ok: true };
  });
}

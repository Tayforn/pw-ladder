// =========================================================
// Доступ до Postgres. Сервіси працюють через мінімальний інтерфейс Db,
// тож у тестах і локальній розробці замість Supabase підставляється
// PGlite (Postgres у WASM) — див. pglite.ts.
// =========================================================

import { readFileSync } from 'node:fs';
import pg from 'pg';
import type { DatabaseSsl } from './config';

export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Db extends Queryable {
  /** Усе всередині fn — одна транзакція; виняток відкочує її. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function createPgDb(opts: { url: string; ssl: DatabaseSsl; caFile: string | null; max?: number }): Db {
  // sslmode у рядку підключення перекрив би налаштування ssl нижче.
  const url = new URL(opts.url);
  url.searchParams.delete('sslmode');

  const ssl =
    opts.ssl === 'disable'
      ? false
      : opts.ssl === 'no-verify'
        ? { rejectUnauthorized: false }
        : { rejectUnauthorized: true, ca: opts.caFile ? readFileSync(opts.caFile, 'utf8') : undefined };

  const pool = new pg.Pool({
    connectionString: url.toString(),
    ssl,
    max: opts.max ?? 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on('error', (err) => console.error('[db] помилка простою з\'єднання', err));

  const run = <T>(client: pg.Pool | pg.PoolClient, text: string, params?: unknown[]) =>
    client.query(text, params) as unknown as Promise<{ rows: T[] }>;

  return {
    query: (text, params) => run(pool, text, params),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await fn({ query: (text, params) => run(client, text, params) });
        await client.query('commit');
        return result;
      } catch (err) {
        await client.query('rollback').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

// =========================================================
// Адаптер Db поверх PGlite (Postgres у WASM) — для тестів і локальної
// розробки без Supabase. Бекенд працює як власник БД і минає RLS, тож
// логіку забігів можна ганяти на чистому Postgres у пам'яті.
// =========================================================

import { PGlite } from '@electric-sql/pglite';
import type { Db, Queryable } from './db';

export async function createPgliteDb(schemaSql?: string): Promise<Db> {
  const pg = new PGlite();
  if (schemaSql) await pg.exec(schemaSql);

  const query = async <T>(text: string, params?: unknown[]) => {
    const res = await pg.query<T>(text, params as unknown[] | undefined);
    return { rows: res.rows };
  };

  return {
    query,
    async tx(fn) {
      // PGlite виконує запити послідовно; проста емуляція транзакції.
      await pg.exec('begin');
      try {
        const result = await fn({ query } as Queryable);
        await pg.exec('commit');
        return result;
      } catch (err) {
        await pg.exec('rollback').catch(() => undefined);
        throw err;
      }
    },
    close: () => pg.close(),
  };
}

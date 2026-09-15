// Одноразовий раннер SQL проти БД бекенда: читає DATABASE_URL з оточення
// (--env-file=/etc/ladder-api/env на сервері), виконує SQL-файл із argv[2].
import { readFileSync } from 'node:fs';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('немає DATABASE_URL'); process.exit(1); }
const sql = readFileSync(process.argv[2], 'utf8');

const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
const client = await pool.connect();
try {
  await client.query(sql);
  console.log('SQL OK');
} catch (e) {
  console.error('SQL FAIL:', e instanceof Error ? e.message : e);
  process.exitCode = 2;
} finally {
  client.release();
  await pool.end();
}

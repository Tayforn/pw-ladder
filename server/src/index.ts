// =========================================================
// Точка входу бекенда: читає конфіг зі змінних середовища, піднімає БД і
// Discord-клієнт, запускає Fastify. Періодично чистить протухлі сесії.
// =========================================================

import { buildApp } from './app';
import { loadConfig } from './config';
import { createPgDb } from './db';
import { createDiscordClient } from './discord';
import { purgeExpiredSessions } from './sessions';

async function main() {
  const config = loadConfig();
  const db = createPgDb({ url: config.databaseUrl, ssl: config.databaseSsl, caFile: config.databaseCaFile, max: 8 });
  const discord = createDiscordClient({
    clientId: config.discordClientId,
    clientSecret: config.discordClientSecret,
    guildId: config.discordGuildId,
    redirectUri: `${config.publicOrigin}/api/auth/callback`,
  });

  const app = buildApp({ config, db, discord });

  const purge = setInterval(() => {
    purgeExpiredSessions(db).catch((e) => app.log.error(e));
  }, 6 * 60 * 60 * 1000);
  purge.unref?.();

  const shutdown = async (signal: string) => {
    app.log.info(`отримано ${signal}, зупиняюсь`);
    clearInterval(purge);
    await app.close().catch(() => undefined);
    await db.close().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: config.host, port: config.port });
  app.log.info(`ладдер-бекенд слухає ${config.host}:${config.port}`);
}

main().catch((err) => {
  console.error('Не вдалося запустити бекенд:', err);
  process.exit(1);
});

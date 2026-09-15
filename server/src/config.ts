// =========================================================
// Конфігурація бекенда зі змінних середовища. На сервері вони лежать у
// /etc/ladder-api/env (читає лише root і користувач сервісу); секрети
// (DISCORD_CLIENT_SECRET, пароль у DATABASE_URL) у репозиторій не
// потрапляють.
// =========================================================

export type DatabaseSsl = 'verify' | 'no-verify' | 'disable';

export interface Config {
  host: string;
  port: number;
  /** Звідки відкривається сайт, напр. https://ladder.thunderpw.fun. */
  publicOrigin: string;
  cookieSecure: boolean;
  databaseUrl: string;
  databaseSsl: DatabaseSsl;
  databaseCaFile: string | null;
  discordClientId: string;
  discordClientSecret: string;
  discordGuildId: string;
  /** Порожньо — пускати будь-кого з сервера клану. */
  discordAllowedRoleIds: string[];
  sessionTtlDays: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const missing: string[] = [];
  const required = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) missing.push(name);
    return value ?? '';
  };

  const publicOrigin = required('PUBLIC_ORIGIN').replace(/\/+$/, '');
  const databaseUrl = required('DATABASE_URL');
  const discordClientId = required('DISCORD_CLIENT_ID');
  const discordClientSecret = required('DISCORD_CLIENT_SECRET');
  const discordGuildId = required('DISCORD_GUILD_ID');
  if (missing.length > 0) {
    throw new Error(`Не задано змінні середовища: ${missing.join(', ')}`);
  }

  let origin: URL;
  try {
    origin = new URL(publicOrigin);
  } catch {
    throw new Error(`PUBLIC_ORIGIN має бути повною адресою, отримано «${publicOrigin}»`);
  }

  const ssl = (env.DATABASE_SSL?.trim() || 'verify') as DatabaseSsl;
  if (!['verify', 'no-verify', 'disable'].includes(ssl)) {
    throw new Error(`DATABASE_SSL має бути verify, no-verify або disable, отримано «${ssl}»`);
  }

  const port = Number(env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Некоректний PORT: ${env.PORT}`);

  const ttl = Number(env.SESSION_TTL_DAYS ?? 7);
  if (!Number.isFinite(ttl) || ttl < 1 || ttl > 90) throw new Error(`SESSION_TTL_DAYS має бути від 1 до 90, отримано ${env.SESSION_TTL_DAYS}`);

  return {
    host: env.HOST?.trim() || '127.0.0.1',
    port,
    publicOrigin: origin.origin,
    cookieSecure: origin.protocol === 'https:',
    databaseUrl,
    databaseSsl: ssl,
    databaseCaFile: env.DATABASE_CA_FILE?.trim() || null,
    discordClientId,
    discordClientSecret,
    discordGuildId,
    discordAllowedRoleIds: (env.DISCORD_ALLOWED_ROLE_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    sessionTtlDays: ttl,
  };
}

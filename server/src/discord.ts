// =========================================================
// Discord OAuth2: авторизація, обмін коду на токен і перевірка членства
// на сервері клану. Токен Discord використовується один раз при вході й
// ніде не зберігається.
// =========================================================

const API = 'https://discord.com/api/v10';

export interface DiscordMember {
  userId: string;
  username: string;
  globalName: string | null;
  /** Нік на сервері клану. */
  nick: string | null;
  roles: string[];
  avatarUrl: string | null;
}

export interface DiscordClient {
  authorizeUrl(state: string): string;
  exchangeCode(code: string): Promise<string>;
  /** null — людини немає на сервері клану. */
  fetchMember(accessToken: string): Promise<DiscordMember | null>;
}

export class DiscordError extends Error {}

interface RawMember {
  nick?: string | null;
  avatar?: string | null;
  roles?: string[];
  user?: { id: string; username: string; global_name?: string | null; avatar?: string | null };
}

export function toMember(raw: RawMember, guildId: string): DiscordMember {
  const user = raw.user;
  if (!user?.id || !user.username) throw new DiscordError('Discord не повернув користувача в даних учасника');
  const avatarUrl = raw.avatar
    ? `https://cdn.discordapp.com/guilds/${guildId}/users/${user.id}/avatars/${raw.avatar}.png?size=64`
    : user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
      : null;
  return {
    userId: user.id,
    username: user.username,
    globalName: user.global_name ?? null,
    nick: raw.nick ?? null,
    roles: Array.isArray(raw.roles) ? raw.roles : [],
    avatarUrl,
  };
}

/** Нік у ладдері: нік на сервері клану, інакше відображуване ім'я, інакше логін. */
export function nicknameOf(m: DiscordMember): string {
  const name = (m.nick ?? m.globalName ?? m.username).trim().slice(0, 64);
  return name || m.username;
}

export function hasAllowedRole(m: DiscordMember, allowedRoleIds: string[]): boolean {
  return allowedRoleIds.length === 0 || m.roles.some((role) => allowedRoleIds.includes(role));
}

export function createDiscordClient(
  cfg: { clientId: string; clientSecret: string; guildId: string; redirectUri: string },
  fetchImpl: typeof fetch = fetch,
): DiscordClient {
  return {
    authorizeUrl(state) {
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: cfg.clientId,
        scope: 'identify guilds.members.read',
        redirect_uri: cfg.redirectUri,
        state,
        prompt: 'none',
      });
      return `https://discord.com/oauth2/authorize?${params}`;
    },

    async exchangeCode(code) {
      const res = await fetchImpl(`${API}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: cfg.redirectUri,
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
        }),
      });
      if (!res.ok) throw new DiscordError(`Discord відхилив обмін коду: HTTP ${res.status}`);
      const json = (await res.json()) as { access_token?: string };
      if (!json.access_token) throw new DiscordError('Discord не повернув access_token');
      return json.access_token;
    },

    async fetchMember(accessToken) {
      const res = await fetchImpl(`${API}/users/@me/guilds/${cfg.guildId}/member`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new DiscordError(`Не вдалося перевірити членство: HTTP ${res.status}`);
      return toMember((await res.json()) as RawMember, cfg.guildId);
    },
  };
}

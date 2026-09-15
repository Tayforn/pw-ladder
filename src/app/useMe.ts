// =========================================================
// Сесія гравця через бекенд (вхід Discord). null — не залогінений.
// 401 з /api/me — це не помилка, а «гість»: показуємо екран входу.
// =========================================================

import { useCallback, useEffect, useState } from 'react';
import { ApiClientError, fetchMe, loginUrl, logout as apiLogout } from './ladderApi';
import type { Me } from '../lib/apiTypes';

interface MeState {
  me: Me | null;
  loading: boolean;
  /** true, якщо бекенд недосяжний (мережа) — на відміну від «просто гість». */
  offline: boolean;
  login: () => void;
  logout: () => Promise<void>;
  refresh: () => void;
  /** Оновити локально (напр. лічильник забігів після фінішу). */
  patch: (m: Partial<Me>) => void;
}

export function useMe(): MeState {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    fetchMe()
      .then((m) => { setMe(m); setOffline(false); })
      .catch((e) => {
        setMe(null);
        // 401 — гість; будь-що інше — бекенд недоступний.
        setOffline(!(e instanceof ApiClientError && e.status === 401));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(refresh, [refresh]);

  const logout = useCallback(async () => {
    await apiLogout().catch(() => undefined);
    setMe(null);
  }, []);

  const patch = useCallback((m: Partial<Me>) => setMe((cur) => (cur ? { ...cur, ...m } : cur)), []);

  return { me, loading, offline, login: () => { window.location.href = loginUrl(); }, logout, refresh, patch };
}

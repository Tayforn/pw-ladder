// =========================================================
// Дані ладдера з бекенда: борд (/api/ladder) і числа правил
// (/api/settings). Оновлюємо на монтуванні, при поверненні фокусу на
// вкладку, раз на 30 с і вручну (reload) — напр. після власного фінішу.
// =========================================================

import { useCallback, useEffect, useState } from 'react';
import { fetchLadder, fetchSettings } from './ladderApi';
import { DEFAULT_RUN_SETTINGS, type BoardEntry, type RunSettings, type TalanEntry } from '../lib/apiTypes';

const REFRESH_MS = 30_000;

export function useLadderData() {
  const [board, setBoard] = useState<BoardEntry[]>([]);
  const [settings, setSettings] = useState<RunSettings>(DEFAULT_RUN_SETTINGS);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    fetchLadder()
      .then((v) => setBoard(v.board))
      .catch((e) => console.error('[ladder] не вдалося оновити ладдер', e))
      .finally(() => setLoading(false));
  }, []);

  const reloadSettings = useCallback(() => {
    fetchSettings().then(setSettings).catch((e) => console.error('[ladder] налаштування', e));
  }, []);

  useEffect(() => {
    reload();
    reloadSettings();
    const onFocus = () => { if (document.visibilityState === 'visible') reload(); };
    document.addEventListener('visibilitychange', onFocus);
    const timer = setInterval(reload, REFRESH_MS);
    return () => {
      document.removeEventListener('visibilitychange', onFocus);
      clearInterval(timer);
    };
  }, [reload, reloadSettings]);

  return { board, settings, loading, reload, reloadSettings };
}

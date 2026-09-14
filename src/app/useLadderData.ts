// =========================================================
// Єдине джерело даних ладдера для всієї сторінки: ОДИН фетч повного списку
// (без history — див. ladder.ts) + ОДИН realtime-канал з дебаунсом.
// Раніше App і AwardsSection фетчили незалежно й тримали по своєму каналу —
// кожна зміна в БД давала два повні рефетчі.
//
// Помилки фонових рефетчів НЕ показуються alert'ом (офлайн давав би серію
// модалок) — лише console.error; alert лишається для дій користувача.
// =========================================================

import { useCallback, useEffect, useState } from 'react';
import {
  bumpRunCount, fetchLadder, fetchRunCounts, fetchSettings, subscribeLadderChanges,
  type LadderEntry, type LadderSettings,
} from '../data/ladder';
import { reportError } from './errorMessage';

export const DEFAULT_SETTINGS: LadderSettings = { mirageCount: 200, skyCount: 15, underCount: 15, worldCount: 30, decoyCount: 1, resetUnlockAttempts: 100 };

const RELOAD_DEBOUNCE_MS = 400;

export function useLadderData() {
  const [settings, setSettings] = useState<LadderSettings>(DEFAULT_SETTINGS);
  const [entries, setEntries] = useState<LadderEntry[]>([]);
  /** Завершених забігів на нік (0013) — включно зі скинутими. */
  const [runCounts, setRunCounts] = useState<Record<string, number>>({});

  const reload = useCallback(() => {
    fetchLadder().then(setEntries).catch((e) => console.error('[ladder] не вдалося оновити ладдер', e));
    // Лічильники ранів не в realtime-публікації (скинуті забіги не чіпають
    // ladder_entries), тож підтягуємо їх разом із кожним рефетчем ладдера.
    fetchRunCounts().then(setRunCounts).catch((e) => console.error('[ladder] run counts', e));
  }, []);
  /** Для адмінки (після зміни налаштувань) — з alert'ом, бо це дія користувача. */
  const reloadSettings = useCallback(
    () => fetchSettings().then(setSettings).catch(reportError),
    [],
  );

  /** Зафіксувати завершений забіг ніка: оптимістично +1 локально, RPC у фоні. */
  const countRun = useCallback((nick: string) => {
    if (!nick) return;
    setRunCounts((prev) => ({ ...prev, [nick]: (prev[nick] ?? 0) + 1 }));
    bumpRunCount(nick).then((n) => {
      if (n !== null) setRunCounts((prev) => ({ ...prev, [nick]: n }));
    });
  }, []);

  useEffect(() => {
    fetchSettings()
      .then(setSettings)
      .catch((e) => console.error('[ladder] не вдалося завантажити налаштування — використовую типові', e));
    reload();

    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeLadderChanges(() => {
      clearTimeout(timer);
      timer = setTimeout(reload, RELOAD_DEBOUNCE_MS);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [reload]);

  return { settings, entries, runCounts, reload, reloadSettings, countRun };
}

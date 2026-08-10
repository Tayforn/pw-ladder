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
  fetchLadder, fetchSettings, subscribeLadderChanges,
  type LadderEntry, type LadderSettings,
} from '../data/ladder';
import { reportError } from './errorMessage';

export const DEFAULT_SETTINGS: LadderSettings = { pointsPerSuccess: 10, skyCost: 20, underCost: 20, worldCost: 10 };

const RELOAD_DEBOUNCE_MS = 400;

export function useLadderData() {
  const [settings, setSettings] = useState<LadderSettings>(DEFAULT_SETTINGS);
  const [entries, setEntries] = useState<LadderEntry[]>([]);

  const reload = useCallback(
    () => fetchLadder().then(setEntries).catch((e) => console.error('[ladder] не вдалося оновити ладдер', e)),
    [],
  );
  /** Для адмінки (після зміни налаштувань) — з alert'ом, бо це дія користувача. */
  const reloadSettings = useCallback(
    () => fetchSettings().then(setSettings).catch(reportError),
    [],
  );

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

  return { settings, entries, reload, reloadSettings };
}

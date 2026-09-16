// =========================================================
// Заліковий забіг через бекенд: кубик кидає сервер, стан приходить із
// відповідей. Форма state сумісна з локальним рушієм (levels/mainSlot/
// attempts/history), тож SimulatorCard рендерить і тренування, і залік.
// Кнопки блокуються, поки триває запит або висить перевірка присутності.
// =========================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiClientError, answerChallenge as apiAnswer, fetchActiveRun, resetRun as apiReset,
  sendAttempt, startRun as apiStart, submitRun as apiSubmit,
} from './ladderApi';
import { decorateHistory, transition, type EngineCore } from '../lib/engineCore';
import type { StoneMethod } from '../data/refineRates';
import type { AttemptResult, ItemSlot } from '../lib/types';
import type { ChallengeView, FinishView, RunView } from '../lib/apiTypes';

export interface AttemptMeta {
  clickX?: number;
  clickY?: number;
}

export interface ServerGameState {
  levels: Record<ItemSlot, number>;
  mainSlot: ItemSlot;
  used: Record<StoneMethod, number>;
  attempts: number;
  history: AttemptResult[];
}

const EMPTY: ServerGameState = {
  levels: { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 },
  mainSlot: 'a',
  used: { mirage: 0, sky: 0, under: 0, world: 0 },
  attempts: 0,
  history: [],
};

const coreOf = (run: RunView): EngineCore => ({ levels: run.levels, mainSlot: run.mainSlot, used: run.used, attempts: run.attempts });

/** onRunLost — сервер каже, що активного забігу вже немає (напр. адмін почав
 * новий сезон): варто перечитати профіль, бо лічильник забігів міг змінитись. */
export function useServerGame(onFinished?: (f: FinishView) => void, onRunLost?: () => void) {
  const [run, setRun] = useState<RunView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [finish, setFinish] = useState<FinishView | null>(null);
  const [tooFast, setTooFast] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastTapMs = useRef<number | null>(null);
  const finishedCb = useRef(onFinished);
  finishedCb.current = onFinished;
  const lostCb = useRef(onRunLost);
  lostCb.current = onRunLost;
  const runLost = useCallback(() => {
    setRun(null);
    lostCb.current?.();
  }, []);

  useEffect(() => {
    let alive = true;
    fetchActiveRun()
      .then((r) => { if (alive) setRun(r); })
      .catch(() => { if (alive) setRun(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const challenge: ChallengeView | null = run?.challenge ?? null;

  const applyFinish = useCallback((f: FinishView) => {
    setRun(null);
    setFinish(f);
    finishedCb.current?.(f);
  }, []);

  const start = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setFinish(null);
      lastTapMs.current = null;
      setRun(await apiStart());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося почати забіг.');
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const attempt = useCallback(async (item: ItemSlot, method: StoneMethod, meta?: AttemptMeta) => {
    if (busy || challenge || !run) return;
    setBusy(true);
    setTooFast(false);
    try {
      const nowMs = performance.now();
      const dt = lastTapMs.current != null ? Math.round(nowMs - lastTapMs.current) : null;
      const res = await sendAttempt({ item, method, clickX: meta?.clickX ?? null, clickY: meta?.clickY ?? null, clientDt: dt });
      lastTapMs.current = nowMs;
      if (res.finished) applyFinish(res.finished);
      else if (res.run) setRun((prev) => ({ ...res.run!, history: [...(prev?.history ?? []), res.attempt] }));
    } catch (e) {
      if (e instanceof ApiClientError) {
        if (e.code === 'too_fast') setTooFast(true);
        else if (e.code === 'challenge_required' && e.body?.challenge) {
          const ch = e.body.challenge;
          setRun((prev) => (prev ? { ...prev, challenge: ch } : prev));
        } else if (e.code === 'no_active_run') runLost();
        else setError(e.message);
      } else setError('Помилка мережі.');
    } finally {
      setBusy(false);
    }
  }, [busy, challenge, run, applyFinish, runLost]);

  const solveChallenge = useCallback(async (choice: number) => {
    if (busy || !challenge) return;
    setBusy(true);
    try {
      const res = await apiAnswer({ id: challenge.id, choice });
      setRun((prev) => (prev && res.run ? { ...res.run, history: prev.history } : prev));
    } catch (e) {
      if (e instanceof ApiClientError && e.code === 'no_active_run') runLost();
      else setError(e instanceof Error ? e.message : 'Помилка перевірки.');
    } finally {
      setBusy(false);
    }
  }, [busy, challenge, runLost]);

  const submit = useCallback(async () => {
    if (busy || !run) return;
    setBusy(true);
    try {
      applyFinish(await apiSubmit());
    } catch (e) {
      if (e instanceof ApiClientError && e.code === 'no_active_run') runLost();
      else setError(e instanceof Error ? e.message : 'Не вдалося внести результат.');
    } finally {
      setBusy(false);
    }
  }, [busy, run, applyFinish, runLost]);

  const reset = useCallback(async (): Promise<boolean> => {
    if (busy || !run) return false;
    setBusy(true);
    try {
      applyFinish(await apiReset());
      return true;
    } catch (e) {
      if (e instanceof ApiClientError && e.code === 'no_active_run') runLost();
      else if (e instanceof ApiClientError && e.code === 'reset_locked') setError(e.message);
      else setError(e instanceof Error ? e.message : 'Не вдалося скинути.');
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy, run, applyFinish, runLost]);

  const canUse = useCallback(
    (item: ItemSlot, method: StoneMethod): boolean => {
      if (busy || challenge || !run) return false;
      return transition(coreOf(run), item, method, run.settings, () => 1) !== null;
    },
    [busy, challenge, run],
  );

  const state: ServerGameState = useMemo(() => {
    if (!run) return EMPTY;
    return { levels: run.levels, mainSlot: run.mainSlot, used: run.used, attempts: run.attempts, history: decorateHistory(run.history) };
  }, [run]);

  return {
    state,
    run,
    settings: run?.settings ?? null,
    challenge,
    loading,
    busy,
    tooFast,
    finish,
    error,
    hasActiveRun: !!run,
    start,
    attempt,
    solveChallenge,
    submit,
    reset,
    canUse,
    clearFinish: () => setFinish(null),
    clearError: () => setError(null),
  };
}

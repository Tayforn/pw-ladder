// =========================================================
// Картка симулятора — спільна для тренування (локальний рушій) і заліку
// (серверний забіг). Дані й дії приходять пропами; правила однакові, тож
// доступність кнопок рахуємо локально через engineCore (сервер лишається
// авторитетним). У заліку кнопки блокуються, поки триває запит (busy).
// =========================================================

import { useState } from 'react';
import { activeSlots, ladderLevel, resetUnlockAt } from '../lib/ladderEngine';
import { remainingFor, transition } from '../lib/engineCore';
import { MAX_LEVEL, RATES, STONE_LABEL, type StoneMethod } from '../data/refineRates';
import { LABEL_TEXT, TIER_LABEL } from '../lib/criticalMoments';
import type { RunSettings } from '../lib/apiTypes';
import type { AttemptResult, ItemSlot } from '../lib/types';
import { attemptsWord, minusWord } from '../lib/plural';
import AttemptHistoryList from './AttemptHistoryList';

/** Стан, що його рендерить картка (спільна форма локального й серверного). */
export interface SimState {
  levels: Record<ItemSlot, number>;
  mainSlot: ItemSlot;
  used: Record<StoneMethod, number>;
  attempts: number;
  history: AttemptResult[];
}

export interface AttemptMeta { clickX?: number; clickY?: number }

const RITUAL_HINT_STREAK = 3;

const STONES: Array<{ method: Exclude<StoneMethod, 'mirage'>; label: string; cls: string; failNote: string }> = [
  { method: 'sky', label: 'Небеска', cls: 'sky', failNote: 'провал → рівень 0' },
  { method: 'under', label: 'Підземка', cls: 'under', failNote: 'провал → −1' },
  { method: 'world', label: 'Світобудова', cls: 'world', failNote: 'провал → без змін' },
];

const clickMeta = (e: React.MouseEvent<HTMLButtonElement>): AttemptMeta => {
  const r = e.currentTarget.getBoundingClientRect();
  return r.width && r.height
    ? { clickX: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), clickY: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) }
    : {};
};

export default function SimulatorCard({
  mode,
  state,
  settings,
  busy = false,
  submitting = false,
  tooFast = false,
  onAttempt,
  onSubmit,
  onReset,
}: {
  mode: 'ranked' | 'training';
  state: SimState;
  settings: RunSettings;
  busy?: boolean;
  submitting?: boolean;
  tooFast?: boolean;
  onAttempt: (item: ItemSlot, method: StoneMethod, meta?: AttemptMeta) => void;
  onSubmit?: () => void;
  onReset: () => void;
}) {
  const { levels, mainSlot, attempts, history } = state;
  const [active, setActive] = useState<ItemSlot>(mainSlot);
  const slots = activeSlots(state, settings);
  const activeSlot = slots.includes(active) ? active : mainSlot;
  const level = levels[activeSlot];
  const activeRole = activeSlot === mainSlot ? 'main' : 'decoy';
  const nextLevel = level + 1;
  const atMax = level >= MAX_LEVEL;
  const miragesLeft = remainingFor('mirage', state, settings);
  const mirageRate = atMax ? null : RATES.mirage[nextLevel];
  const lastAttempt = history[history.length - 1];
  const submitLevel = ladderLevel(state);
  const resetAt = mode === 'ranked' ? resetUnlockAt(settings) : 0;

  const canUse = (item: ItemSlot, method: StoneMethod): boolean =>
    !busy && transition(state, item, method, settings, () => 1) !== null;

  let decoyColdTail = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h.role !== 'decoy' || h.success) break;
    decoyColdTail++;
  }

  const decoyIndex = (slot: ItemSlot) => slots.filter((x) => x !== mainSlot).indexOf(slot) + 1;
  const manyDecoys = slots.length > 2;

  const itemCard = (slot: ItemSlot) => {
    const role = slot === mainSlot ? 'main' : 'decoy';
    const isActive = slot === activeSlot;
    const lastOnItem = [...history].reverse().find((h) => h.item === slot);
    const roleLabel = role === 'main' ? 'Основна' : manyDecoys ? `Підставна ${decoyIndex(slot)}` : 'Підставна';
    return (
      <button
        key={slot}
        type="button"
        className={'sim-item' + (isActive ? ' sim-item-active' : '') + (role === 'main' ? ' sim-item-main' : ' sim-item-decoy')}
        onClick={() => setActive(slot)}
        title={role === 'main' ? 'Основна — найвищий рівень, іде в ладдер' : 'Підставна — для ритуалів; переросте основну — міняються ролями'}
      >
        <span className="sim-item-role">{roleLabel}</span>
        <span className="sim-level-value">+{levels[slot]}</span>
        <span className="sim-item-meta">
          {isActive ? '● активна' : 'натисни, щоб точити'}
          {lastOnItem && <> · ост.: {lastOnItem.success ? '✓' : '✗'}</>}
        </span>
      </button>
    );
  };

  return (
    <div className="card calc-card">
      <div className="sim-items" style={manyDecoys ? { gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' } : undefined}>
        {itemCard(mainSlot)}
        {slots.filter((slot) => slot !== mainSlot).map(itemCard)}
      </div>

      <div className="sim-display sim-display-compact">
        <div className="sim-target-info">
          <span className="sim-level-target" title="Кожна спроба будь-чим споживає 1 міраж">
            Міражів: <b>{miragesLeft}</b> / {settings.mirageCount}
          </span>
          {STONES.map((st) => (
            <span key={st.method} className="sim-level-target">
              {st.label}: <b>{remainingFor(st.method, state, settings)}</b>
            </span>
          ))}
          <span className="sim-level-target">Точиш: <b>{activeRole === 'main' ? 'основну' : 'підставну'}</b> (+{level})</span>
        </div>
        <div className="sim-last">
          {!lastAttempt ? (
            'Обери предмет і тисни «Заточити».'
          ) : (
            <>
              Останнє: <span className={'item-badge ' + lastAttempt.role}>{lastAttempt.role === 'main' ? 'О' : 'П'}</span>{' '}
              <span className={'badge ' + lastAttempt.method}>{STONE_LABEL[lastAttempt.method]}</span>{' '}
              {lastAttempt.success ? <span className="succ">✓ успіх</span> : <span className="fail">✗ провал</span>}
              {' · +'}{lastAttempt.before} → +{lastAttempt.after}
              {lastAttempt.tier !== 'normal' && (
                <span className={'drama-tag drama-' + lastAttempt.tier}>{TIER_LABEL[lastAttempt.tier]}</span>
              )}
              {lastAttempt.labels.map((l) => (
                <span key={l} className="moment-tag">{LABEL_TEXT[l]}</span>
              ))}
            </>
          )}
        </div>
      </div>

      <button
        type="button"
        className="btn btn-primary btn-lg sim-mirage-btn"
        disabled={!canUse(activeSlot, 'mirage')}
        onClick={(e) => onAttempt(activeSlot, 'mirage', clickMeta(e))}
      >
        ⚒ Заточити {activeRole === 'main' ? 'основну' : 'підставну'} (міраж)
        <span className="sim-mirage-rate">{mirageRate ? (mirageRate * 100).toFixed(2) + '%' : '—'}</span>
      </button>

      {/* Слот банера зарезервований завжди (фіксована висота) — поява/зникнення
          підказки не рухає кнопки. Показуємо або темп («занадто швидко»), або ритуал. */}
      <div className={'sim-ritual-banner' + (tooFast || decoyColdTail >= RITUAL_HINT_STREAK ? ' visible' : '')} aria-live="polite">
        {tooFast ? (
          <>⏳ Занадто швидко — на сервері між спробами мінімальна пауза. Тисни трохи повільніше.</>
        ) : decoyColdTail >= RITUAL_HINT_STREAK ? (
          <>
            🔥 ГВЧ прогрітий? <b>{decoyColdTail}</b> {minusWord(decoyColdTail)} поспіль на підставній.
            Вирішальний тиць — за тобою. <span className="muted">(Шанси, звісно, ті самі.)</span>
          </>
        ) : null}
      </div>

      <div className="sim-stones-row">
        <div className="sim-stones">
          {STONES.map((st) => {
            const left = remainingFor(st.method, state, settings);
            const rate = atMax ? null : RATES[st.method][nextLevel];
            return (
              <button
                key={st.method}
                type="button"
                className="stone-btn stone-btn-sm"
                disabled={!canUse(activeSlot, st.method)}
                onClick={(e) => onAttempt(activeSlot, st.method, clickMeta(e))}
                title="Спроба каменем споживає 1 міраж + 1 такий камінь"
              >
                <span className={'badge ' + st.cls}>{st.label}</span>
                <span className="stone-rate">{rate ? (rate * 100).toFixed(2) + '%' : '—'}</span>
                <span className="stone-price">лишилось ×{left}</span>
                <span className="stone-meta">{st.failNote}</span>
              </button>
            );
          })}
        </div>
      </div>

      {atMax && <div className="banner" style={{ marginTop: 14 }}><b>+{MAX_LEVEL}</b> — максимальний рівень досягнуто!</div>}

      <div className="sim-actions">
        {mode === 'ranked' && onSubmit && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={submitting || busy || attempts <= 0}
            onClick={() => { if (confirm(`Внести результат (+${submitLevel}, ${attempts} спроб) у ладдер? Забіг завершиться.`)) onSubmit(); }}
          >
            Внести в ладдер (+{submitLevel})
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy || attempts < resetAt || attempts <= 0}
          onClick={() => {
            const msg = mode === 'ranked'
              ? 'Скинути прогрес без внесення в ладдер? Забіг зарахується як зіграний, результат втратиться.'
              : 'Почати тренування спочатку?';
            if (confirm(msg)) onReset();
          }}
        >
          {mode === 'ranked' && attempts < resetAt
            ? (() => { const l = resetAt - attempts; return `↺ до можливості скидання ${l} ${attemptsWord(l)}`; })()
            : '↺ Скинути прогрес'}
        </button>
      </div>

      {history.length > 0 && (
        <div className="sim-history">
          <div className="sim-history-head">
            <h3 style={{ margin: 0 }}>Історія спроб</h3>
            <span className="hint" style={{ margin: 0 }}>О — основна, П — підставна</span>
          </div>
          <AttemptHistoryList history={history} />
        </div>
      )}
    </div>
  );
}

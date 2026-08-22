// =========================================================
// Картка симулятора: ДВА предмети (основна/підставна — ролі за рівнем,
// міняються місцями при рокіровці), активний обирається кліком; міраж і
// платні камені діють на активний. Спільні бали/спроби, історія обох.
// "ГВЧ прогрітий?" — іронічний індикатор хвоста мінусів підставної: гра
// ритуал не підсилює, лише чесно показує, що гравець його виконує.
// confirm перед внесенням показує, чи результат КРАЩИЙ за твій наявний
// запис (сервер усе одно вирішує сам, це лише чесне попередження).
// =========================================================

import { useState } from 'react';
import { costFor, ladderLevel, MAX_ATTEMPTS, useLadderGame } from '../lib/ladderEngine';
import { MAX_LEVEL, RATES, STONE_LABEL, type StoneMethod } from '../data/refineRates';
import { LABEL_TEXT, TIER_LABEL } from '../lib/criticalMoments';
import { isBetterResult, type LadderEntry, type LadderSettings } from '../data/ladder';
import { otherSlot, type ItemSlot } from '../lib/types';
import AttemptHistoryList from './AttemptHistoryList';

type Game = ReturnType<typeof useLadderGame>;

/** "Скинути прогрес" розблоковується лише після 150 спроб — щоб не можна
 * було дешево перекидати невдалий старт забігу. (Внесення в ладдер більше
 * НЕ скидає лічильники, якщо результат не зараховано — тож і через нього
 * дешевого ре-роллу немає, див. doSubmit в App.tsx.) */
const MIN_ATTEMPTS_FOR_RESET = 150;
/** Від скількох мінусів поспіль на підставній показуємо "ГВЧ прогрітий?". */
const RITUAL_HINT_STREAK = 3;

/** Українське відмінювання "спроба/спроби/спроб" за числівником n. */
function attemptsWord(n: number): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return 'спроб';
  if (mod10 === 1) return 'спроба';
  if (mod10 >= 2 && mod10 <= 4) return 'спроби';
  return 'спроб';
}

const STONES: Array<{ method: Exclude<StoneMethod, 'mirage'>; label: string; cls: string; failNote: string }> = [
  { method: 'sky', label: 'Небеска', cls: 'sky', failNote: 'провал → рівень 0' },
  { method: 'under', label: 'Підземка', cls: 'under', failNote: 'провал → −1' },
  { method: 'world', label: 'Світобудова', cls: 'world', failNote: 'провал → без змін' },
];

export default function SimulatorCard({
  game,
  settings,
  nickname,
  submitting,
  myEntry,
  onSubmit,
}: {
  game: Game;
  settings: LadderSettings;
  nickname: string;
  submitting: boolean;
  myEntry: LadderEntry | undefined;
  onSubmit: () => void;
}) {
  const { levels, mainSlot, points, attempts, history } = game.state;
  const [active, setActive] = useState<ItemSlot>(mainSlot);
  const decoySlot = otherSlot(mainSlot);
  const level = levels[active];
  const activeRole = active === mainSlot ? 'main' : 'decoy';
  const nextLevel = level + 1;
  const atMax = level >= MAX_LEVEL;
  const attemptsExhausted = attempts >= MAX_ATTEMPTS;
  const mirageRate = atMax ? null : RATES.mirage[nextLevel];
  const mirageDisabled = atMax || attemptsExhausted || !mirageRate;
  const lastAttempt = history[history.length - 1];
  const submitLevel = ladderLevel(game.state);

  // Хвіст мінусів підставної з кінця історії (до першої спроби основної).
  let decoyColdTail = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h.role !== 'decoy') break;
    if (h.success) break;
    decoyColdTail++;
  }

  const confirmSubmit = () => {
    const better = !myEntry || isBetterResult(submitLevel, attempts, myEntry);
    const msg = !myEntry
      ? `Внести перший результат (+${submitLevel}, ${attempts} спроб) у ладдер? Після внесення лічильники скинуться.`
      : better
        ? `Результат (+${submitLevel}, ${attempts} спроб) кращий за твій попередній (+${myEntry.level}, ${myEntry.attempts} спроб) — внести? Лічильники скинуться.`
        : `Твій наявний результат (+${myEntry.level}, ${myEntry.attempts} спроб) кращий — цей забіг зараховано НЕ буде, прогрес продовжиться. Все одно надіслати?`;
    if (confirm(msg)) onSubmit();
  };

  const itemCard = (slot: ItemSlot) => {
    const role = slot === mainSlot ? 'main' : 'decoy';
    const isActive = slot === active;
    const lastOnItem = [...history].reverse().find((h) => h.item === slot);
    return (
      <button
        key={slot}
        type="button"
        className={'sim-item' + (isActive ? ' sim-item-active' : '') + (role === 'main' ? ' sim-item-main' : ' sim-item-decoy')}
        onClick={() => setActive(slot)}
        title={role === 'main' ? 'Основна — вищий рівень, іде в ладдер' : 'Підставна — для ритуалів і балів за півціни'}
      >
        <span className="sim-item-role">{role === 'main' ? 'Основна' : 'Підставна'}</span>
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
      <div className="sim-items">
        {itemCard(mainSlot)}
        {itemCard(decoySlot)}
      </div>

      <div className="sim-display sim-display-compact">
        <div className="sim-target-info">
          <span className="sim-level-target">Балів: {points}</span>
          <span className="sim-level-target">Спроб: {attempts} / {MAX_ATTEMPTS}</span>
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

      {decoyColdTail >= RITUAL_HINT_STREAK && (
        <div className="sim-ritual-banner">
          🔥 ГВЧ прогрітий? <b>{decoyColdTail}</b> {decoyColdTail === 1 ? 'мінус' : 'мінуси'} поспіль на підставній.
          Вирішальний тиць — за тобою. <span className="muted">(Шанси, звісно, ті самі.)</span>
        </div>
      )}

      <button
        type="button"
        className="btn btn-primary btn-lg sim-mirage-btn"
        disabled={mirageDisabled}
        onClick={() => game.attempt(active, 'mirage')}
      >
        ⚒ Заточити {activeRole === 'main' ? 'основну' : 'підставну'} (міраж)
        <span className="sim-mirage-rate">{mirageRate ? (mirageRate * 100).toFixed(2) + '%' : '—'}</span>
      </button>

      <div className="sim-stones-row">
        <div className="sim-stones">
          {STONES.map((st) => {
            const cost = costFor(st.method, settings);
            const rate = atMax ? null : RATES[st.method][nextLevel];
            const disabled = atMax || !rate || !game.canUse(active, st.method);
            return (
              <button
                key={st.method}
                type="button"
                className="stone-btn stone-btn-sm"
                disabled={disabled}
                onClick={() => game.attempt(active, st.method)}
              >
                <span className={'badge ' + st.cls}>{st.label}</span>
                <span className="stone-rate">{rate ? (rate * 100).toFixed(2) + '%' : '—'}</span>
                <span className="stone-price">{cost} балів</span>
                <span className="stone-meta">{st.failNote}</span>
              </button>
            );
          })}
        </div>
      </div>

      {atMax && <div className="banner" style={{ marginTop: 14 }}><b>+{MAX_LEVEL}</b> — максимальний рівень досягнуто!</div>}

      <div className="sim-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={submitting || !nickname || attempts <= 0}
          onClick={confirmSubmit}
        >
          Внести в ладдер (+{submitLevel})
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={attempts < MIN_ATTEMPTS_FOR_RESET}
          onClick={() => {
            if (confirm('Скинути прогрес без внесення в ладдер? Поточний результат буде втрачено назавжди.')) game.reset();
          }}
        >
          {attempts < MIN_ATTEMPTS_FOR_RESET
            ? (() => {
                const left = MIN_ATTEMPTS_FOR_RESET - attempts;
                return `↺ до можливості скидання ${left} ${attemptsWord(left)}`;
              })()
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

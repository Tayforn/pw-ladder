// =========================================================
// Картка симулятора: дисплей рівня/балів/спроб, кнопка міража, три платні
// камені, кнопки "Внести в ладдер"/"Скинути прогрес", історія спроб.
// Винесено з App.tsx один в один; нове тут — confirm перед внесенням
// показує, чи результат КРАЩИЙ за твій наявний запис (сервер все одно
// вирішує сам, це лише чесне попередження).
// =========================================================

import { costFor, MAX_ATTEMPTS, useLadderGame } from '../lib/ladderEngine';
import { MAX_LEVEL, RATES, STONE_LABEL, type StoneMethod } from '../data/refineRates';
import { LABEL_TEXT, TIER_LABEL } from '../lib/criticalMoments';
import { isBetterResult, type LadderEntry, type LadderSettings } from '../data/ladder';
import AttemptHistoryList from './AttemptHistoryList';

type Game = ReturnType<typeof useLadderGame>;

/** "Скинути прогрес" розблоковується лише після 150 спроб — щоб не можна
 * було дешево перекидати невдалий старт забігу. (Внесення в ладдер більше
 * НЕ скидає лічильники, якщо результат не зараховано — тож і через нього
 * дешевого ре-роллу немає, див. doSubmit в App.tsx.) */
const MIN_ATTEMPTS_FOR_RESET = 150;

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
  const { level, points, attempts, history } = game.state;
  const nextLevel = level + 1;
  const atMax = level >= MAX_LEVEL;
  const attemptsExhausted = attempts >= MAX_ATTEMPTS;
  const mirageRate = atMax ? null : RATES.mirage[nextLevel];
  const mirageDisabled = atMax || attemptsExhausted || !mirageRate;
  const lastAttempt = history[history.length - 1];

  const confirmSubmit = () => {
    const better = !myEntry || isBetterResult(level, attempts, myEntry);
    const msg = !myEntry
      ? `Внести перший результат (+${level}, ${attempts} спроб) у ладдер? Після внесення лічильники скинуться.`
      : better
        ? `Результат (+${level}, ${attempts} спроб) кращий за твій попередній (+${myEntry.level}, ${myEntry.attempts} спроб) — внести? Лічильники скинуться.`
        : `Твій наявний результат (+${myEntry.level}, ${myEntry.attempts} спроб) кращий — цей забіг зараховано НЕ буде, прогрес продовжиться. Все одно надіслати?`;
    if (confirm(msg)) onSubmit();
  };

  return (
    <div className="card calc-card">
      <div className="sim-display">
        <div className="sim-level">
          <span className="sim-level-label">Поточний рівень</span>
          <span className="sim-level-value">+{level}</span>
        </div>
        <div className="sim-target-info">
          <span className="sim-level-target">Балів: {points}</span>
          <span className="sim-level-target">Спроб: {attempts} / {MAX_ATTEMPTS}</span>
        </div>
        <div className="sim-last">
          {!lastAttempt ? (
            'Тисни «Заточити», щоб зробити спробу.'
          ) : (
            <>
              Останнє: <span className={'badge ' + lastAttempt.method}>{STONE_LABEL[lastAttempt.method]}</span>{' '}
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
        disabled={mirageDisabled}
        onClick={() => game.attempt('mirage')}
      >
        ⚒ Заточити (міраж)
        <span className="sim-mirage-rate">{mirageRate ? (mirageRate * 100).toFixed(2) + '%' : '—'}</span>
      </button>

      <div className="sim-stones-row">
        <div className="sim-stones">
          {STONES.map((st) => {
            const cost = costFor(st.method, settings);
            const rate = atMax ? null : RATES[st.method][nextLevel];
            const disabled = atMax || !rate || !game.canUse(st.method);
            return (
              <button
                key={st.method}
                type="button"
                className="stone-btn stone-btn-sm"
                disabled={disabled}
                onClick={() => game.attempt(st.method)}
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
          Внести в ладдер
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
          </div>
          <AttemptHistoryList history={history} />
        </div>
      )}
    </div>
  );
}

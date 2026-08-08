// =========================================================
// Ладдер страждання — уся гра на одній сторінці: попап з правилами/ніком,
// симулятор заточки міражами (+ 3 платних камені), таблиця лідерів,
// внесення результату, адмін-панель (за логіном).
// =========================================================

import { useEffect, useState } from 'react';
import Header from './components/Header';
import Footer from './components/Footer';
import InfoPopup from './components/InfoPopup';
import LadderTable from './components/LadderTable';
import AdminGate from './components/AdminGate';
import AdminPanel from './components/AdminPanel';
import { reportError } from './app/errorMessage';
import {
  fetchLadder, fetchSettings, submitIfBetter, subscribeLadderChanges,
  type LadderEntry, type LadderSettings,
} from './data/ladder';
import { useLadderGame, costFor } from './lib/ladderEngine';
import { MAX_LEVEL, RATES, STONE_LABEL, type StoneMethod } from './data/refineRates';

const NICK_KEY = 'ladder-nickname';
const DEFAULT_SETTINGS: LadderSettings = { pointsPerSuccess: 10, skyCost: 20, underCost: 20, worldCost: 10 };

const STONES: Array<{ method: StoneMethod; label: string; cls: string; failNote: string; free: boolean }> = [
  { method: 'mirage', label: 'Заточити міражем', cls: 'mirage', failNote: 'провал → рівень 0', free: true },
  { method: 'sky', label: 'Юзнути Небеску', cls: 'sky', failNote: 'провал → рівень 0', free: false },
  { method: 'under', label: 'Юзнути Підземку', cls: 'under', failNote: 'провал → −1', free: false },
  { method: 'world', label: 'Юзнути Світобудову', cls: 'world', failNote: 'провал → без змін', free: false },
];

export default function App() {
  const [nickname, setNickname] = useState(() => {
    try {
      return localStorage.getItem(NICK_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [showInfo, setShowInfo] = useState(true);
  const [settings, setSettings] = useState<LadderSettings>(DEFAULT_SETTINGS);
  const [ladder, setLadder] = useState<LadderEntry[]>([]);
  const [adminOpen, setAdminOpen] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const game = useLadderGame(settings);

  useEffect(() => {
    fetchSettings().then(setSettings).catch(reportError);
  }, []);

  useEffect(() => {
    const reload = () => fetchLadder().then(setLadder).catch(reportError);
    reload();
    return subscribeLadderChanges(reload);
  }, []);

  const startGame = (nick: string) => {
    try {
      localStorage.setItem(NICK_KEY, nick);
    } catch {
      /* ignore */
    }
    setNickname(nick);
    setShowInfo(false);
  };

  const submit = async () => {
    if (!nickname || game.state.points <= 0) return;
    setSubmitting(true);
    setSubmitMsg(null);
    try {
      const { submitted } = await submitIfBetter(nickname, game.state.level, game.state.points);
      if (submitted) {
        game.reset();
        setSubmitMsg('Результат внесено в ладдер! Лічильники скинуто — можна починати заново.');
      } else {
        setSubmitMsg('Твій попередній результат у ладдері був кращий — цей не зараховано.');
      }
    } catch (e) {
      reportError(e);
    } finally {
      setSubmitting(false);
    }
  };

  const nextLevel = game.state.level + 1;
  const atMax = game.state.level >= MAX_LEVEL;

  return (
    <>
      <Header onShowInfo={() => setShowInfo(true)} />
      <div className="app-shell container">
        <main style={{ width: '100%' }}>
          <header className="section-head">
            <span className="eyebrow">Заточка міражами</span>
            <h2>Ладдер страждання</h2>
            <p>Гравець: <b>{nickname || '—'}</b></p>
          </header>

          <div className="card calc-card">
            <div className="sim-display">
              <div className="sim-level">
                <span className="sim-level-label">Поточний рівень</span>
                <span className="sim-level-value">+{game.state.level}</span>
              </div>
              <div className="sim-target-info">
                <span className="sim-level-target">Балів: {game.state.points}</span>
              </div>
              <div className="sim-last">
                {game.state.history.length === 0 ? (
                  'Тисни на камінець, щоб зробити спробу.'
                ) : (
                  (() => {
                    const h = game.state.history[0];
                    return (
                      <>
                        Останнє: <span className={'badge ' + h.method}>{STONE_LABEL[h.method]}</span>{' '}
                        {h.success ? <span className="succ">✓ успіх</span> : <span className="fail">✗ провал</span>}
                        {' · +'}{h.before} → +{h.after}
                      </>
                    );
                  })()
                )}
              </div>
            </div>

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
                      className="stone-btn"
                      disabled={disabled}
                      onClick={() => game.attempt(st.method)}
                    >
                      <span className={'badge ' + st.cls}>{st.label}</span>
                      <span className="stone-rate">{rate ? (rate * 100).toFixed(2) + '%' : '—'}</span>
                      <span className="stone-price">{st.free ? 'безкоштовно' : cost + ' балів'}</span>
                      <span className="stone-meta">{st.failNote}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {atMax && <div className="banner" style={{ marginTop: 14 }}><b>+{MAX_LEVEL}</b> — максимальний рівень досягнуто!</div>}

            <div className="sim-actions">
              <button type="button" className="btn btn-primary" disabled={submitting || !nickname || game.state.points <= 0} onClick={submit}>
                Внести в ладдер
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => game.reset()}>↺ Скинути прогрес</button>
            </div>
            {submitMsg && <p className="hint" style={{ marginTop: 10 }}>{submitMsg}</p>}

            {game.state.history.length > 0 && (
              <div className="sim-history">
                <div className="sim-history-head">
                  <h3 style={{ margin: 0 }}>Історія спроб</h3>
                </div>
                <div className="sim-history-list">
                  {game.state.history.map((h, i) => (
                    <div key={i} className={'hist-row ' + (h.success ? 'succ' : 'fail')}>
                      <span className={'badge ' + h.method}>{STONE_LABEL[h.method]}</span>
                      <span className="hist-mid">+{h.before} → +{h.after}</span>
                      <span className={'hist-mark ' + (h.success ? 'succ' : 'fail')}>{h.success ? '✓' : '✗'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <h3 style={{ marginTop: 28 }}>Ладдер</h3>
          <div className="card">
            <LadderTable entries={ladder} nickname={nickname} />
          </div>

          <div style={{ marginTop: 24 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdminOpen((v) => !v)}>
              {adminOpen ? 'Сховати адмінку' : 'Адмін'}
            </button>
            {adminOpen && (
              <AdminGate>
                {() => (
                  <AdminPanel
                    settings={settings}
                    onSettingsChanged={() => fetchSettings().then(setSettings).catch(reportError)}
                    onLadderReset={() => fetchLadder().then(setLadder).catch(reportError)}
                  />
                )}
              </AdminGate>
            )}
          </div>
        </main>
      </div>
      <Footer />
      {showInfo && <InfoPopup nickname={nickname} onStart={startGame} />}
    </>
  );
}

// =========================================================
// Ладдер страждання — уся гра на одній сторінці: попап з правилами/ніком,
// симулятор заточки міражами (+ 3 платних камені), таблиця лідерів,
// внесення результату.
//
// Адмінка — ОКРЕМИЙ вигляд цієї ж сторінки, доступний лише прямим заходом
// на /admin (ніякого видимого лінка з головної) — просто client-side
// перевірка шляху, без роутера: сайт як був однопторінковим, так і лишився.
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

const STONES: Array<{ method: Exclude<StoneMethod, 'mirage'>; label: string; cls: string; failNote: string }> = [
  { method: 'sky', label: 'Небеска', cls: 'sky', failNote: 'провал → рівень 0' },
  { method: 'under', label: 'Підземка', cls: 'under', failNote: 'провал → −1' },
  { method: 'world', label: 'Світобудова', cls: 'world', failNote: 'провал → без змін' },
];

function isAdminPath(): boolean {
  const base = import.meta.env.BASE_URL;
  const path = window.location.pathname.replace(/\/+$/, '');
  return path === (base + 'admin').replace(/\/+$/, '');
}

export default function App() {
  const [adminRoute] = useState(isAdminPath);
  const [nickname, setNickname] = useState(() => {
    try {
      return localStorage.getItem(NICK_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [showInfo, setShowInfo] = useState(!adminRoute);
  const [settings, setSettings] = useState<LadderSettings>(DEFAULT_SETTINGS);
  const [ladder, setLadder] = useState<LadderEntry[]>([]);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const game = useLadderGame(settings);

  useEffect(() => {
    fetchSettings().then(setSettings).catch(reportError);
  }, []);

  const reloadLadder = () => fetchLadder().then(setLadder).catch(reportError);
  useEffect(() => {
    reloadLadder();
    return subscribeLadderChanges(reloadLadder);
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
    if (!nickname || game.state.attempts <= 0) return;
    setSubmitting(true);
    setSubmitMsg(null);
    try {
      const { submitted } = await submitIfBetter(nickname, game.state.level, game.state.attempts, game.state.points);
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
  const mirageRate = atMax ? null : RATES.mirage[nextLevel];
  const mirageDisabled = atMax || !mirageRate;

  if (adminRoute) {
    return (
      <>
        <Header onShowInfo={() => {}} />
        <div className="app-shell container">
          <main style={{ width: '100%' }}>
            <header className="section-head">
              <span className="eyebrow">Ладдер страждання</span>
              <h2>Адмін-панель</h2>
            </header>
            <AdminGate>
              {() => (
                <AdminPanel
                  settings={settings}
                  entries={ladder}
                  onSettingsChanged={() => fetchSettings().then(setSettings).catch(reportError)}
                  onLadderChanged={reloadLadder}
                />
              )}
            </AdminGate>
            <h3 style={{ marginTop: 28 }}>Ладдер (поточний стан)</h3>
            <div className="card">
              <LadderTable entries={ladder} nickname="" />
            </div>
          </main>
        </div>
        <Footer />
      </>
    );
  }

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
                <span className="sim-level-target">Спроб: {game.state.attempts}</span>
              </div>
              <div className="sim-last">
                {game.state.history.length === 0 ? (
                  'Тисни «Заточити міражем», щоб зробити спробу.'
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

            <button
              type="button"
              className="btn btn-primary btn-lg sim-mirage-btn"
              disabled={mirageDisabled}
              onClick={() => game.attempt('mirage')}
            >
              ⚒ Заточити міражем
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
              <button type="button" className="btn btn-primary" disabled={submitting || !nickname || game.state.attempts <= 0} onClick={submit}>
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
        </main>
      </div>
      <Footer />
      {showInfo && <InfoPopup nickname={nickname} onStart={startGame} />}
    </>
  );
}

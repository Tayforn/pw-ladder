// =========================================================
// Ладдер страждання — уся гра на одній сторінці: попап з правилами/ніком,
// симулятор заточки міражами (+ 3 платних камені), таблиця лідерів,
// внесення результату, фінальний екран забігу (титули/статистика/графік).
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
import AwardsSection from './components/AwardsSection';
import AdminGate from './components/AdminGate';
import AdminPanel from './components/AdminPanel';
import FinalResultScreen from './components/FinalResultScreen';
import { reportError } from './app/errorMessage';
import {
  fetchLadder, fetchSettings, submitIfBetter, subscribeLadderChanges,
  type LadderEntry, type LadderSettings, type LadderStats,
} from './data/ladder';
import { useLadderGame, costFor, MAX_ATTEMPTS, type AttemptResult } from './lib/ladderEngine';
import { MAX_LEVEL, RATES, STONE_LABEL, type StoneMethod } from './data/refineRates';
import { LABEL_TEXT, TIER_LABEL } from './lib/criticalMoments';
import { computeSessionStats, type SessionStats } from './lib/sessionStats';
import { computeRngProfile, type RngProfile } from './lib/rngProfile';
import { evaluateTitles, type TitleResult } from './lib/titles';
import { buildHallOfShame, type ShameEntry } from './lib/hallOfShame';

const NICK_KEY = 'ladder-nickname';
const INFO_SEEN_KEY = 'ladder-info-seen';
const LADDER_SECTION_ID = 'ladder-section';
/** "Скинути прогрес" розблоковується лише після 150 спроб — щоб не можна
 * було дешево перекидати невдалий старт забігу. */
const MIN_ATTEMPTS_FOR_RESET = 150;
const DEFAULT_SETTINGS: LadderSettings = { pointsPerSuccess: 10, skyCost: 20, underCost: 20, worldCost: 10 };

const STONES: Array<{ method: Exclude<StoneMethod, 'mirage'>; label: string; cls: string; failNote: string }> = [
  { method: 'sky', label: 'Небеска', cls: 'sky', failNote: 'провал → рівень 0' },
  { method: 'under', label: 'Підземка', cls: 'under', failNote: 'провал → −1' },
  { method: 'world', label: 'Світобудова', cls: 'world', failNote: 'провал → без змін' },
];

interface FinalResult {
  history: AttemptResult[];
  stats: SessionStats;
  profile: RngProfile;
  titles: { qualified: TitleResult[]; primary: TitleResult | null };
  shame: ShameEntry[];
  submitMsg: string;
}

function isAdminPath(): boolean {
  const base = import.meta.env.BASE_URL;
  const path = window.location.pathname.replace(/\/+$/, '');
  return path === (base + 'admin').replace(/\/+$/, '');
}

function statsToLadderStats(stats: SessionStats, profile: RngProfile): LadderStats {
  return {
    bestStreak: stats.longestSuccessStreak,
    worstStreak: stats.longestFailStreak,
    biggestDrop: stats.biggestDrop,
    biggestComeback: stats.biggestComeback,
    successRate: stats.successRate,
    peakAttempt: stats.peakAttempt,
    luckScore: profile.luck,
  };
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
  const [showInfo, setShowInfo] = useState(() => {
    if (adminRoute) return false;
    try {
      return !localStorage.getItem(INFO_SEEN_KEY);
    } catch {
      return true;
    }
  });
  const [settings, setSettings] = useState<LadderSettings>(DEFAULT_SETTINGS);
  const [ladder, setLadder] = useState<LadderEntry[]>([]);
  const [finalResult, setFinalResult] = useState<FinalResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const game = useLadderGame(settings);

  useEffect(() => {
    fetchSettings().then(setSettings).catch(reportError);
  }, []);

  const reloadLadder = () => fetchLadder(adminRoute ? undefined : 10).then(setLadder).catch(reportError);
  useEffect(() => {
    reloadLadder();
    return subscribeLadderChanges(reloadLadder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startGame = (nick: string) => {
    try {
      localStorage.setItem(NICK_KEY, nick);
      localStorage.setItem(INFO_SEEN_KEY, '1');
    } catch {
      /* ignore */
    }
    setNickname(nick);
    setShowInfo(false);
  };

  const doSubmit = async (auto: boolean) => {
    if (!nickname) return;
    // Знімок ДО скидання — фінальний екран показує саме цей забіг.
    const history = game.state.history;
    const stats = computeSessionStats(history);
    const profile = computeRngProfile(history, stats);
    const currentRecordLevel = ladder[0]?.level ?? null;
    const titles = evaluateTitles(history, stats, profile, currentRecordLevel);
    const shame = buildHallOfShame(history, stats);

    setSubmitting(true);
    try {
      const { submitted } = await submitIfBetter(
        nickname, game.state.level, game.state.attempts, game.state.points,
        statsToLadderStats(stats, profile),
      );
      game.reset();
      const submitMsg = auto
        ? submitted
          ? `Ліміт спроб (${MAX_ATTEMPTS}) вичерпано — результат внесено в ладдер автоматично.`
          : `Ліміт спроб (${MAX_ATTEMPTS}) вичерпано — попередній результат у ладдері був кращий, цей не зараховано.`
        : submitted
          ? 'Результат внесено в ладдер!'
          : 'Твій попередній результат у ладдері був кращий — цей не зараховано.';
      setFinalResult({ history, stats, profile, titles, shame, submitMsg });
    } catch (e) {
      if (auto) {
        // Ліміт спроб вичерпано — скидаємо прогрес НАВІТЬ якщо внесення в
        // ладдер не вдалося (напр. мережева помилка): застрягти назавжди
        // на 200/200 (кнопки задизейблені) гірше, ніж втратити результат.
        game.reset();
        setFinalResult({
          history, stats, profile, titles, shame,
          submitMsg: `Ліміт спроб (${MAX_ATTEMPTS}) вичерпано, але внести результат у ладдер не вдалося. Лічильники все одно скинуто.`,
        });
      } else {
        reportError(e);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Ліміт "забігу" вичерпано (200 спроб) — вносимо поточний результат
  // (якщо кращий за наявний) і скидаємо прогрес автоматично, без участі
  // гравця. attempts не змінюється під час await (game.reset() робить це
  // лише після), тож ефект не спрацює вдруге поки триває цей виклик.
  useEffect(() => {
    if (!adminRoute && nickname && game.state.attempts >= MAX_ATTEMPTS) {
      doSubmit(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.state.attempts]);

  const submit = () => doSubmit(false);

  const nextLevel = game.state.level + 1;
  const atMax = game.state.level >= MAX_LEVEL;
  const attemptsExhausted = game.state.attempts >= MAX_ATTEMPTS;
  const mirageRate = atMax ? null : RATES.mirage[nextLevel];
  const mirageDisabled = atMax || attemptsExhausted || !mirageRate;
  const lastAttempt = game.state.history[game.state.history.length - 1];

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
                <span className="sim-level-target">Спроб: {game.state.attempts} / {MAX_ATTEMPTS}</span>
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
              <button type="button" className="btn btn-primary" disabled={submitting || !nickname || game.state.attempts <= 0} onClick={submit}>
                Внести в ладдер
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={game.state.attempts < MIN_ATTEMPTS_FOR_RESET}
                title={
                  game.state.attempts < MIN_ATTEMPTS_FOR_RESET
                    ? `Доступно після ${MIN_ATTEMPTS_FOR_RESET} спроб (лишилось ${MIN_ATTEMPTS_FOR_RESET - game.state.attempts})`
                    : undefined
                }
                onClick={() => game.reset()}
              >
                ↺ Скинути прогрес
              </button>
            </div>

            {game.state.history.length > 0 && (
              <div className="sim-history">
                <div className="sim-history-head">
                  <h3 style={{ margin: 0 }}>Історія спроб</h3>
                </div>
                <div className="sim-history-list">
                  {[...game.state.history].reverse().map((h, i) => (
                    <div key={game.state.history.length - i} className={'hist-row ' + (h.success ? 'succ' : 'fail')}>
                      <span className={'badge ' + h.method}>{STONE_LABEL[h.method]}</span>
                      <span className="hist-mid">+{h.before} → +{h.after}</span>
                      <span className={'hist-mark ' + (h.success ? 'succ' : 'fail')}>{h.success ? '✓' : '✗'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <h3 id={LADDER_SECTION_ID} style={{ marginTop: 28 }}>Ладдер · Топ 10</h3>
          <div className="card">
            <LadderTable entries={ladder} nickname={nickname} />
          </div>

          <AwardsSection />
        </main>
      </div>
      <Footer />
      {showInfo && <InfoPopup nickname={nickname} onStart={startGame} />}
      {finalResult && (
        <FinalResultScreen
          nickname={nickname}
          history={finalResult.history}
          stats={finalResult.stats}
          profile={finalResult.profile}
          titles={finalResult.titles}
          shame={finalResult.shame}
          submitMsg={finalResult.submitMsg}
          onTryAgain={() => setFinalResult(null)}
          onViewLeaderboard={() => {
            setFinalResult(null);
            document.getElementById(LADDER_SECTION_ID)?.scrollIntoView({ behavior: 'smooth' });
          }}
        />
      )}
    </>
  );
}

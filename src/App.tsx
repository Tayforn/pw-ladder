// =========================================================
// Ладдер страждання — оркестратор сторінки: роутинг (/ vs /admin, без
// роутера — сайт однопторінковий), стан ніка/попапів і логіка внесення
// результату в ладдер. Увесь UI розкладено по компонентах:
// SimulatorCard (сама гра), AdminView (адмінка), InfoPopup/PrizeTable/
// FinalResultScreen (модалки), AwardsSection (спецнагороди).
// Дані ладдера — з useLadderData: один фетч + один realtime-канал.
// =========================================================

import { useEffect, useState } from 'react';
import Header from './components/Header';
import Footer from './components/Footer';
import InfoPopup from './components/InfoPopup';
import LadderTable from './components/LadderTable';
import PrizeTable from './components/PrizeTable';
import AwardsSection from './components/AwardsSection';
import AdminView from './components/AdminView';
import SimulatorCard from './components/SimulatorCard';
import FinalResultScreen from './components/FinalResultScreen';
import { reportError, errorMessage } from './app/errorMessage';
import { useLadderData } from './app/useLadderData';
import { submitIfBetter, type LadderStats } from './data/ladder';
import { useLadderGame, costFor, ladderLevel, MAX_ATTEMPTS, type AttemptResult } from './lib/ladderEngine';
import { computeRitualStats, type RitualStats } from './lib/ritual';
import { computeSessionStats, type SessionStats } from './lib/sessionStats';
import { computeRngProfile, type RngProfile } from './lib/rngProfile';
import { evaluateTitles, type TitleResult } from './lib/titles';
import { buildHallOfShame, type ShameEntry } from './lib/hallOfShame';
import { isValidationRejection, bustedJokeFor, type BustedJoke } from './lib/cheatBusted';

const NICK_KEY = 'ladder-nickname';
const INFO_SEEN_KEY = 'ladder-info-seen';
const LADDER_SECTION_ID = 'ladder-section';
const TOP_N = 10;

interface FinalResult {
  history: AttemptResult[];
  stats: SessionStats;
  profile: RngProfile;
  titles: { qualified: TitleResult[]; primary: TitleResult | null };
  shame: ShameEntry[];
  ritual: RitualStats;
  submitMsg: string;
  /** Результат НЕ зараховано (попередній кращий) і прогрес НЕ скинуто. */
  runContinues: boolean;
  /** Витрачено балів на камені (за поточними цінами) і залишок на кінець. */
  pointsSpent: number;
  pointsLeft: number;
  /** Заповнено лише якщо сервер відхилив сабміт як несумісний із чесною
   * грою (0005/0006) — у чесній грі це не спрацьовує. */
  busted?: BustedJoke;
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
  const [showPrizes, setShowPrizes] = useState(false);
  const [finalResult, setFinalResult] = useState<FinalResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { settings, entries, reload, reloadSettings } = useLadderData();
  const game = useLadderGame(settings);
  const myEntry = entries.find((e) => e.nickname === nickname);

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
    // Порожній (завантажений) ладдер — рекорд 0: перший гравець теж ОБРАНИЙ.
    const currentRecordLevel = entries.length > 0 ? entries[0].level : 0;
    const ritual = computeRitualStats(history);
    const titles = evaluateTitles(history, stats, profile, currentRecordLevel, ritual);
    const shame = buildHallOfShame(history, stats);
    const pointsSpent = history.reduce((sum, h) => sum + costFor(h.method, settings), 0);
    const base = { history, stats, profile, titles, shame, ritual, pointsSpent, pointsLeft: game.state.points };

    setSubmitting(true);
    try {
      const { submitted } = await submitIfBetter(
        nickname, ladderLevel(game.state), game.state.attempts, game.state.points,
        statsToLadderStats(stats, profile), history,
      );
      // Прогрес скидається, лише якщо результат ЗАРАХОВАНО (або вичерпано
      // ліміт спроб) — інакше "Внести в ладдер" був би безкоштовним
      // обходом правила "скидання лише після 150 спроб".
      const runContinues = !auto && !submitted;
      if (!runContinues) game.reset();
      const submitMsg = auto
        ? submitted
          ? `Ліміт спроб (${MAX_ATTEMPTS}) вичерпано — результат внесено в ладдер автоматично.`
          : `Ліміт спроб (${MAX_ATTEMPTS}) вичерпано — попередній результат у ладдері був кращий, цей не зараховано.`
        : submitted
          ? 'Результат внесено в ладдер! Лічильники скинуто — можна починати новий забіг.'
          : 'Твій попередній результат у ладдері кращий — цей не зараховано. Прогрес НЕ скинуто, забіг триває.';
      setFinalResult({ ...base, submitMsg, runContinues });
      if (submitted) reload();
    } catch (e) {
      const msg = errorMessage(e, '');
      const busted = isValidationRejection(msg) ? bustedJokeFor(msg) : undefined;
      if (auto) {
        // Ліміт спроб вичерпано — скидаємо прогрес НАВІТЬ якщо внесення в
        // ладдер не вдалося (напр. мережева помилка): застрягти назавжди
        // на 200/200 (кнопки задизейблені) гірше, ніж втратити результат.
        game.reset();
        setFinalResult({
          ...base,
          submitMsg: busted
            ? `Ліміт спроб (${MAX_ATTEMPTS}) вичерпано, але сервер відхилив результат як несумісний із чесною грою.`
            : `Ліміт спроб (${MAX_ATTEMPTS}) вичерпано, але внести результат у ладдер не вдалося. Лічильники все одно скинуто.`,
          runContinues: false,
          busted,
        });
      } else if (busted) {
        setFinalResult({
          ...base,
          submitMsg: 'Результат НЕ внесено в ладдер — сервер відхилив дані як несумісні з чесною грою.',
          runContinues: true,
          busted,
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
  const attempts = game.state.attempts;
  useEffect(() => {
    if (!adminRoute && nickname && attempts >= MAX_ATTEMPTS) {
      doSubmit(true);
    }
    // doSubmit навмисно поза deps: ефект має реагувати лише на attempts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempts]);

  if (adminRoute) {
    return <AdminView settings={settings} entries={entries} reloadSettings={reloadSettings} reload={reload} />;
  }

  const top10 = entries.slice(0, TOP_N);

  return (
    <>
      <Header onShowInfo={() => { setShowPrizes(false); setShowInfo(true); }} />
      <div className="app-shell container">
        <main style={{ width: '100%' }}>
          <header className="section-head">
            <span className="eyebrow">Заточка міражами</span>
            <div className="title-row">
              <h2>Ладдер страждання</h2>
              <button type="button" className="btn btn-ghost" onClick={() => { setShowInfo(false); setShowPrizes(true); }}>🏆 Таблиця нагород</button>
            </div>
            <p>Гравець: <b>{nickname || '—'}</b></p>
          </header>

          <SimulatorCard
            game={game}
            settings={settings}
            nickname={nickname}
            submitting={submitting}
            myEntry={myEntry}
            onSubmit={() => doSubmit(false)}
          />

          <h3 id={LADDER_SECTION_ID} style={{ marginTop: 28 }}>Ладдер · Топ 10</h3>
          <div className="card">
            <LadderTable entries={top10} nickname={nickname} />
          </div>

          <AwardsSection entries={entries} />
        </main>
      </div>
      <Footer />
      {showInfo && (
        <InfoPopup
          nickname={nickname}
          nickLocked={!!nickname && game.state.attempts > 0}
          settings={settings}
          onStart={startGame}
          onClose={nickname ? () => setShowInfo(false) : undefined}
        />
      )}
      {showPrizes && <PrizeTable entries={top10} nickname={nickname} onClose={() => setShowPrizes(false)} />}
      {finalResult && (
        <FinalResultScreen
          nickname={nickname}
          history={finalResult.history}
          stats={finalResult.stats}
          profile={finalResult.profile}
          titles={finalResult.titles}
          shame={finalResult.shame}
          ritual={finalResult.ritual}
          submitMsg={finalResult.submitMsg}
          busted={finalResult.busted}
          runContinues={finalResult.runContinues}
          pointsSpent={finalResult.pointsSpent}
          pointsLeft={finalResult.pointsLeft}
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

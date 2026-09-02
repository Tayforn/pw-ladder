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
import { fetchEntryHistory, submitIfBetter, type LadderStats } from './data/ladder';
import { useLadderGame, ladderLevel, normalizeHistory, type AttemptResult } from './lib/ladderEngine';
import { computeRitualStats, type RitualStats } from './lib/ritual';
import { computeSessionStats, type SessionStats } from './lib/sessionStats';
import { computeRngProfile, type RngProfile } from './lib/rngProfile';
import { evaluateTitles, type TitleResult } from './lib/titles';
import { buildHallOfShame, type ShameEntry } from './lib/hallOfShame';
import { isLimitsRejection, isValidationRejection, bustedJokeFor, type BustedJoke } from './lib/cheatBusted';

const NICK_KEY = 'ladder-nickname';
const INFO_SEEN_KEY = 'ladder-info-seen';
const LADDER_SECTION_ID = 'ladder-section';
const TOP_N = 10;

/** Усе, що фінальний екран рахує з історії, — спільне для щойно зіграного
 * забігу і для перегляду збереженого запису з ладдера. */
interface RunReport {
  history: AttemptResult[];
  stats: SessionStats;
  profile: RngProfile;
  titles: { qualified: TitleResult[]; primary: TitleResult | null };
  shame: ShameEntry[];
  ritual: RitualStats;
}

interface FinalResult extends RunReport {
  submitMsg: string;
  /** Результат НЕ зараховано (попередній кращий) і прогрес НЕ скинуто. */
  runContinues: boolean;
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
  /** Перегляд збереженого забігу учасника ладдера (клік по рядку/нагороді). */
  const [viewRun, setViewRun] = useState<(RunReport & { nickname: string }) | null>(null);
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

  /** Уся похідна аналітика забігу з його історії — для фінального екрана
   * і для попапа перегляду запису ладдера. */
  const deriveRun = (history: AttemptResult[]): RunReport => {
    const stats = computeSessionStats(history);
    const profile = computeRngProfile(history, stats);
    // Порожній (завантажений) ладдер — рекорд 0: перший гравець теж ОБРАНИЙ.
    const currentRecordLevel = entries.length > 0 ? entries[0].level : 0;
    const ritual = computeRitualStats(history);
    const titles = evaluateTitles(history, stats, profile, currentRecordLevel, ritual);
    const shame = buildHallOfShame(history, stats);
    return { history, stats, profile, titles, shame, ritual };
  };

  const openEntry = async (nick: string) => {
    try {
      const raw = await fetchEntryHistory(nick);
      if (raw.length === 0) {
        alert(`Історія забігу «${nick}» не збереглась — запис створено до появи журналювання.`);
        return;
      }
      setViewRun({ nickname: nick, ...deriveRun(normalizeHistory(raw)) });
    } catch (e) {
      reportError(e);
    }
  };

  const doSubmit = async (auto: boolean) => {
    if (!nickname) return;
    // Знімок ДО скидання — фінальний екран показує саме цей забіг.
    const history = game.state.history;
    const base = deriveRun(history);
    const stats = base.stats;
    const profile = base.profile;

    setSubmitting(true);
    try {
      const { submitted } = await submitIfBetter(
        nickname, ladderLevel(game.state), game.state.attempts,
        statsToLadderStats(stats, profile), history,
      );
      // Прогрес скидається, лише якщо результат ЗАРАХОВАНО (або вичерпано
      // ліміт спроб) — інакше "Внести в ладдер" був би безкоштовним
      // обходом правила "скидання лише після 150 спроб".
      const runContinues = !auto && !submitted;
      if (!runContinues) game.reset();
      const submitMsg = auto
        ? submitted
          ? `Міражі скінчились (${settings.mirageCount}) — результат внесено в ладдер автоматично.`
          : `Міражі скінчились (${settings.mirageCount}) — попередній результат у ладдері був кращий, цей не зараховано.`
        : submitted
          ? 'Результат внесено в ладдер! Лічильники скинуто — можна починати новий забіг.'
          : 'Твій попередній результат у ладдері кращий — цей не зараховано. Прогрес НЕ скинуто, забіг триває.';
      setFinalResult({ ...base, submitMsg, runContinues });
      if (submitted) reload();
    } catch (e) {
      const msg = errorMessage(e, '');
      // Ліміти ресурсів — не читерство: адмін міг змінити правила посеред
      // забігу. Нейтральне пояснення замість "спіймано на гарячому".
      const limitsChanged = isLimitsRejection(msg);
      const busted = !limitsChanged && isValidationRejection(msg) ? bustedJokeFor(msg) : undefined;
      if (limitsChanged) {
        if (auto) game.reset();
        setFinalResult({
          ...base,
          submitMsg: auto
            ? 'Сервер не прийняв забіг: ліміти ресурсів змінилися під час гри (адмін оновив правила — це НЕ звинувачення в читерстві). Лічильники скинуто, новий забіг піде за новими лімітами.'
            : 'Сервер не прийняв забіг: ліміти ресурсів змінилися під час гри — цей забіг зіграно за старими правилами (це НЕ звинувачення в читерстві). Прогрес не скинуто.',
          runContinues: !auto,
        });
      } else if (auto) {
        // Ліміт спроб вичерпано — скидаємо прогрес НАВІТЬ якщо внесення в
        // ладдер не вдалося (напр. мережева помилка): застрягти назавжди
        // на 200/200 (кнопки задизейблені) гірше, ніж втратити результат.
        game.reset();
        setFinalResult({
          ...base,
          submitMsg: busted
            ? `Міражі скінчились (${settings.mirageCount}), але сервер відхилив результат як несумісний із чесною грою.`
            : `Міражі скінчились (${settings.mirageCount}), але внести результат у ладдер не вдалося. Лічильники все одно скинуто.`,
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
    if (!adminRoute && nickname && attempts > 0 && attempts >= settings.mirageCount) {
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
          <p className="hint" style={{ margin: '4px 0 10px' }}>Клікни по учаснику — відкриється його найкращий забіг з титулами й статистикою.</p>
          <div className="card">
            <LadderTable entries={top10} nickname={nickname} onSelect={openEntry} />
          </div>

          <AwardsSection entries={entries} onSelect={openEntry} />
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
          settings={settings}
          onTryAgain={() => setFinalResult(null)}
          onViewLeaderboard={() => {
            setFinalResult(null);
            document.getElementById(LADDER_SECTION_ID)?.scrollIntoView({ behavior: 'smooth' });
          }}
        />
      )}
      {viewRun && !finalResult && (
        <FinalResultScreen
          nickname={viewRun.nickname}
          history={viewRun.history}
          stats={viewRun.stats}
          profile={viewRun.profile}
          titles={viewRun.titles}
          shame={viewRun.shame}
          ritual={viewRun.ritual}
          submitMsg={null}
          runContinues={false}
          settings={settings}
          viewOnly
          title={`Найкращий забіг: ${viewRun.nickname}`}
          onTryAgain={() => setViewRun(null)}
          onViewLeaderboard={() => setViewRun(null)}
        />
      )}
    </>
  );
}

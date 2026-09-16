// =========================================================
// Оркестратор сторінки. Грати можна лише після входу через Discord. Два
// режими: «Залік» (серверний забіг → ладдер) і «Тренування» (локальний
// рушій, без заліку). Дані ладдера й налаштувань — з бекенда.
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
import ChallengeModal from './components/ChallengeModal';
import LoginScreen from './components/LoginScreen';
import { reportError } from './app/errorMessage';
import { fetchRunHistory } from './app/ladderApi';
import { useMe } from './app/useMe';
import { useLadderData } from './app/useLadderData';
import { useServerGame } from './app/useServerGame';
import { useLadderGame, type AttemptResult } from './lib/ladderEngine';
import { decorateHistory } from './lib/engineCore';
import { computeRitualStats, type RitualStats } from './lib/ritual';
import { computeSessionStats, type SessionStats } from './lib/sessionStats';
import { computeRngProfile, type RngProfile } from './lib/rngProfile';
import { evaluateTitles, type TitleResult } from './lib/titles';
import { buildHallOfShame, type ShameEntry } from './lib/hallOfShame';
import type { FinishView } from './lib/apiTypes';

const INFO_SEEN_KEY = 'ladder-info-seen';
const LADDER_SECTION_ID = 'ladder-section';
const TOP_N = 10;

interface RunReport {
  history: AttemptResult[];
  stats: SessionStats;
  profile: RngProfile;
  titles: { qualified: TitleResult[]; primary: TitleResult | null };
  shame: ShameEntry[];
  ritual: RitualStats;
}

function isAdminPath(): boolean {
  const base = import.meta.env.BASE_URL;
  const path = window.location.pathname.replace(/\/+$/, '');
  return path === (base + 'admin').replace(/\/+$/, '');
}

function finishMessage(f: FinishView): string {
  if (f.status === 'reset') return 'Забіг скинуто — він зарахований як зіграний. Можна починати новий.';
  const out = f.status === 'finished' ? `Міражі скінчились (${f.settings.mirageCount}). ` : '';
  if (f.boardUpdated) return out + 'Новий рекорд ладдера!';
  return out + 'Забіг завершено. Твій попередній результат у ладдері кращий.';
}

export default function App() {
  const [adminRoute] = useState(isAdminPath);
  const me = useMe();
  const ladder = useLadderData();

  const [mode, setMode] = useState<'ranked' | 'training'>('ranked');
  const [showInfo, setShowInfo] = useState(false);
  const [showPrizes, setShowPrizes] = useState(false);
  const [viewRun, setViewRun] = useState<(RunReport & { nickname: string }) | null>(null);

  const training = useLadderGame(ladder.settings);
  const server = useServerGame((f: FinishView) => {
    ladder.reload();
    me.patch({ runsCount: f.runsCount });
  });

  const recordLevel = ladder.board.length > 0 ? ladder.board[0].level : 0;
  const deriveRun = (history: AttemptResult[]): RunReport => {
    const stats = computeSessionStats(history);
    const profile = computeRngProfile(history, stats);
    const ritual = computeRitualStats(history);
    const titles = evaluateTitles(history, stats, profile, recordLevel, ritual);
    const shame = buildHallOfShame(history, stats);
    return { history, stats, profile, titles, shame, ritual };
  };

  const openEntry = async (playerId: string) => {
    try {
      const raw = await fetchRunHistory(playerId);
      if (raw.length === 0) { alert('Історія цього забігу не збереглась.'); return; }
      const nick = ladder.board.find((b) => b.playerId === playerId)?.nickname ?? '—';
      setViewRun({ nickname: nick, ...deriveRun(raw) });
    } catch (e) {
      reportError(e);
    }
  };

  // Показуємо правила один раз новому залогіненому гравцю.
  useEffect(() => {
    if (!me.me || adminRoute) return;
    try {
      if (!localStorage.getItem(INFO_SEEN_KEY)) { setShowInfo(true); localStorage.setItem(INFO_SEEN_KEY, '1'); }
    } catch { /* ignore */ }
  }, [me.me, adminRoute]);

  if (adminRoute) {
    return <AdminView settings={ladder.settings} board={ladder.board} reload={ladder.reload} reloadSettings={ladder.reloadSettings} />;
  }

  const top = ladder.board.slice(0, TOP_N);
  const finish = server.finish;

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
            {me.me && (
              <p>
                Гравець: <b>{me.me.nickname}</b> · забігів: {me.me.runsCount}
                {' · '}
                <button type="button" className="linklike" onClick={() => me.logout()}>вийти</button>
              </p>
            )}
          </header>

          {me.loading ? (
            <p className="hint">Перевірка входу…</p>
          ) : !me.me ? (
            <LoginScreen onLogin={me.login} offline={me.offline} />
          ) : (
            <>
              <div className="mode-switch" role="tablist" style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                <button type="button" className={'btn btn-sm ' + (mode === 'ranked' ? 'btn-primary' : 'btn-ghost')} onClick={() => setMode('ranked')}>Залік</button>
                <button type="button" className={'btn btn-sm ' + (mode === 'training' ? 'btn-primary' : 'btn-ghost')} onClick={() => setMode('training')}>Тренування</button>
                <span className="hint" style={{ margin: 0, alignSelf: 'center' }}>
                  {mode === 'ranked' ? 'Іде в ладдер. Кубик кидає сервер.' : 'Без заліку — пробуй скільки хочеш.'}
                </span>
              </div>

              {mode === 'ranked' ? (
                server.loading ? (
                  <p className="hint">Завантаження забігу…</p>
                ) : server.hasActiveRun ? (
                  <SimulatorCard
                    mode="ranked"
                    state={server.state}
                    settings={server.settings ?? ladder.settings}
                    busy={server.busy}
                    submitting={server.busy}
                    tooFast={server.tooFast}
                    onAttempt={server.attempt}
                    onSubmit={server.submit}
                    onReset={server.reset}
                  />
                ) : (
                  <div className="card calc-card" style={{ textAlign: 'center', padding: '28px 20px' }}>
                    <p className="hint" style={{ marginTop: 0 }}>Готовий заліковий забіг. Результат піде в ладдер.</p>
                    <button type="button" className="btn btn-primary btn-lg" disabled={server.busy} onClick={server.start}>
                      Почати заліковий забіг
                    </button>
                    {server.error && <p className="form-err" style={{ marginBottom: 0 }}>{server.error}</p>}
                  </div>
                )
              ) : (
                <SimulatorCard
                  mode="training"
                  state={training.state}
                  settings={ladder.settings}
                  onAttempt={(item, method) => training.attempt(item, method)}
                  onReset={training.reset}
                />
              )}

              <h3 id={LADDER_SECTION_ID} style={{ marginTop: 28 }}>Ладдер · Топ 10</h3>
              <p className="hint" style={{ margin: '4px 0 10px' }}>Клікни по учаснику — відкриється його найкращий забіг з титулами й статистикою.</p>
              <div className="card"><LadderTable board={top} meNickname={me.me.nickname} onSelect={openEntry} /></div>

              <AwardsSection board={ladder.board} onSelect={openEntry} />
            </>
          )}
        </main>
      </div>
      <Footer />

      {showInfo && (
        <InfoPopup settings={ladder.settings} onClose={() => setShowInfo(false)} />
      )}
      {showPrizes && <PrizeTable entries={top} nickname={me.me?.nickname ?? ''} onClose={() => setShowPrizes(false)} />}

      {mode === 'ranked' && server.challenge && (
        <ChallengeModal challenge={server.challenge} busy={server.busy} onAnswer={server.solveChallenge} />
      )}

      {finish && (() => {
        const report = deriveRun(decorateHistory(finish.history));
        return (
          <FinalResultScreen
            nickname={me.me?.nickname ?? ''}
            history={report.history}
            stats={report.stats}
            profile={report.profile}
            titles={report.titles}
            shame={report.shame}
            ritual={report.ritual}
            submitMsg={finishMessage(finish)}
            runContinues={false}
            settings={finish.settings}
            runCount={finish.runsCount}
            onTryAgain={server.clearFinish}
            onViewLeaderboard={() => {
              server.clearFinish();
              document.getElementById(LADDER_SECTION_ID)?.scrollIntoView({ behavior: 'smooth' });
            }}
          />
        );
      })()}

      {viewRun && !finish && (
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
          settings={ladder.settings}
          viewOnly
          title={`Найкращий забіг: ${viewRun.nickname}`}
          onTryAgain={() => setViewRun(null)}
          onViewLeaderboard={() => setViewRun(null)}
        />
      )}
    </>
  );
}

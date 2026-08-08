// =========================================================
// Фінальний екран забігу (200 спроб або ручне "Внести в ладдер") —
// підсумкова картка (можна скріншотити в Дискорд): титул, статистика,
// RNG-профіль, графік подорожі, Hall of Shame, повна історія спроб.
// =========================================================

import { useState } from 'react';
import { STONE_LABEL } from '../data/refineRates';
import { MAX_ATTEMPTS } from '../lib/ladderEngine';
import type { AttemptResult } from '../lib/types';
import type { SessionStats } from '../lib/sessionStats';
import type { RngProfile } from '../lib/rngProfile';
import type { TitleResult } from '../lib/titles';
import type { ShameEntry } from '../lib/hallOfShame';
import HistoryGraph from './HistoryGraph';

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="result-stat">
      <span className="result-stat-label">{label}</span>
      <span className="result-stat-value">{value}</span>
    </div>
  );
}

const PROFILE_LABELS: Record<keyof Omit<RngProfile, 'archetype'>, string> = {
  peakPerformance: 'Пік',
  consistency: 'Стабільність',
  aggression: 'Агресія',
  recovery: 'Відновлення',
  streakPower: 'Сила стріків',
  luck: 'Удача',
};

export default function FinalResultScreen({
  nickname,
  history,
  stats,
  profile,
  titles,
  shame,
  submitMsg,
  onTryAgain,
  onViewLeaderboard,
}: {
  nickname: string;
  history: AttemptResult[];
  stats: SessionStats;
  profile: RngProfile;
  titles: { qualified: TitleResult[]; primary: TitleResult | null };
  shame: ShameEntry[];
  submitMsg: string | null;
  onTryAgain: () => void;
  onViewLeaderboard: () => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const secondary = titles.qualified.filter((t) => t.id !== titles.primary?.id);

  return (
    <div className="modal-overlay">
      <div className="modal result-modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>Результат забігу</h3>
        </div>
        <div className="modal-body">
          <div className="result-card">
            <div className="result-card-head">
              <span className="result-nick">{nickname}</span>
              {titles.primary && (
                <span className="result-primary-title" title={titles.primary.evidence}>
                  {titles.primary.name}
                </span>
              )}
            </div>

            <div className="result-level-row">
              <span className="result-level">+{stats.finalLevel}</span>
              <span className="hint" style={{ margin: 0 }}>
                пік +{stats.peakLevel}{stats.peakAttempt > 0 && <> (спроба №{stats.peakAttempt})</>} · архетип «{profile.archetype}»
              </span>
            </div>

            {submitMsg && <p className="hint" style={{ margin: 0 }}>{submitMsg}</p>}
            {stats.attemptsUsed < MAX_ATTEMPTS && (
              <p className="hint" style={{ margin: 0 }}>Спроб лишалось: {MAX_ATTEMPTS - stats.attemptsUsed} — забіг завершено вручну.</p>
            )}

            <div className="result-stats-grid">
              <Stat label="Спроб" value={stats.attemptsUsed} />
              <Stat label="Успіхів" value={stats.totalSuccesses} />
              <Stat label="% успіху" value={(stats.successRate * 100).toFixed(1) + '%'} />
              <Stat label="Найкращий стрік" value={stats.longestSuccessStreak} />
              <Stat label="Найгірший стрік" value={stats.longestFailStreak} />
              <Stat label="Найб. падіння" value={'−' + stats.biggestDrop} />
              <Stat label="Найб. відкат" value={'+' + stats.biggestComeback} />
              <Stat label="Відкатів" value={stats.totalDowngrades} />
            </div>

            {secondary.length > 0 && (
              <div className="result-secondary-titles">
                {secondary.map((t) => (
                  <span key={t.id} className="badge mute" title={t.evidence}>{t.name}</span>
                ))}
              </div>
            )}

            <div className="rng-profile-grid">
              {(Object.keys(PROFILE_LABELS) as Array<keyof typeof PROFILE_LABELS>).map((key) => (
                <div key={key} className="rng-profile-row">
                  <span className="rng-profile-label">{PROFILE_LABELS[key]}</span>
                  <div className="rng-profile-bar">
                    <div className="rng-profile-bar-fill" style={{ width: profile[key] + '%' }} />
                  </div>
                  <span className="rng-profile-value">{profile[key]}</span>
                </div>
              ))}
            </div>

            <HistoryGraph history={history} />
          </div>

          {shame.length > 0 && (
            <div className="shame-section">
              <h4 style={{ margin: '0 0 10px' }}>Hall of Shame</h4>
              {shame.map((s, i) => (
                <div key={i} className="shame-entry">
                  <b>{s.title}</b> — {s.line}
                </div>
              ))}
            </div>
          )}

          <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 14 }} onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? 'Сховати історію' : `Переглянути історію (${history.length})`}
          </button>
          {showHistory && (
            <div className="sim-history-list" style={{ marginTop: 10 }}>
              {[...history].reverse().map((h, i) => (
                <div key={history.length - i} className={'hist-row ' + (h.success ? 'succ' : 'fail')}>
                  <span className={'badge ' + h.method}>{STONE_LABEL[h.method]}</span>
                  <span className="hist-mid">+{h.before} → +{h.after}</span>
                  <span className={'hist-mark ' + (h.success ? 'succ' : 'fail')}>{h.success ? '✓' : '✗'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onViewLeaderboard}>Перейти до ладдера</button>
          <button type="button" className="btn btn-primary" onClick={onTryAgain}>Спробувати ще раз</button>
        </div>
      </div>
    </div>
  );
}

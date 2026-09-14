// =========================================================
// Фінальний екран забігу (200 спроб або ручне "Внести в ладдер") —
// підсумкова картка (можна скріншотити в Дискорд): титул, статистика,
// RNG-профіль, графік подорожі, Hall of Shame, повна історія спроб.
// runContinues=true — результат не зараховано (попередній кращий) і забіг
// ТРИВАЄ: прогрес не скинуто, кнопка стає "Продовжити забіг".
// =========================================================

import { useState } from 'react';
import Modal from './Modal';
import { STONE_LABEL, type StoneMethod } from '../data/refineRates';
import type { LadderSettings } from '../data/ladder';
import type { AttemptResult } from '../lib/types';
import type { SessionStats } from '../lib/sessionStats';
import type { RngProfile } from '../lib/rngProfile';
import type { TitleResult } from '../lib/titles';
import type { ShameEntry } from '../lib/hallOfShame';
import type { BustedJoke } from '../lib/cheatBusted';
import { displaySignature, ritualVerdict, SCHOOL_LABEL, type RitualStats } from '../lib/ritual';
import HistoryGraph from './HistoryGraph';
import AttemptHistoryList from './AttemptHistoryList';

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="result-stat">
      <span className="result-stat-label">{label}</span>
      <span className="result-stat-value">{value}</span>
    </div>
  );
}

const PROFILE_LABELS: Record<keyof Omit<RngProfile, 'archetype' | 'expectedSuccesses'>, string> = {
  peakPerformance: 'Пік',
  consistency: 'Стабільність',
  aggression: 'Агресія',
  recovery: 'Відновлення',
  streakPower: 'Сила стріків',
  luck: 'Удача',
};

/** Пояснення кожного виміру RNG-профілю — підказка при наведенні. */
const PROFILE_HINTS: Record<keyof typeof PROFILE_LABELS, string> = {
  peakPerformance: 'Наскільки близько до +12 дійшов пік основного предмета.',
  consistency: 'Штраф за сумарно втрачені рівні відносно кількості спроб: менше падінь — вище.',
  aggression: 'Середня ставка на спробу — скільки рівнів згоріло б при провалі: міраж/небеска ставлять увесь рівень, підземка — 1, світобудова — 0. 1.5 рівня в середньому = 100.',
  recovery: 'Наскільки повно відігрався після найбільшого падіння.',
  streakPower: 'Найдовша серія успіхів поспіль; 6 і більше = 100.',
  luck: 'Факт успіхів проти очікуваних за шансами (сума p кожної спроби): 50 — рівно як мало бути, вище — щастило.',
};

export default function FinalResultScreen({
  nickname,
  history,
  stats,
  profile,
  titles,
  shame,
  ritual,
  submitMsg,
  busted,
  runContinues,
  settings,
  runCount,
  viewOnly = false,
  title = 'Результат забігу',
  onTryAgain,
  onViewLeaderboard,
}: {
  nickname: string;
  history: AttemptResult[];
  stats: SessionStats;
  profile: RngProfile;
  titles: { qualified: TitleResult[]; primary: TitleResult | null };
  shame: ShameEntry[];
  ritual: RitualStats;
  submitMsg: string | null;
  busted?: BustedJoke;
  runContinues: boolean;
  /** Ліміти ресурсів — для рядків "використано X із Y". */
  settings: LadderSettings;
  /** Скільки завершених забігів зіграв цей нік (0013); undefined — нема даних. */
  runCount?: number;
  /** Режим ПЕРЕГЛЯДУ чужого (чи свого) збереженого забігу з ладдера:
   * без рядків про сабміт/ліміти поточного забігу, з однією кнопкою
   * "Закрити" і без лімітів у розбивці ресурсів (забіг міг бути зіграний
   * за інших налаштувань). */
  viewOnly?: boolean;
  /** Заголовок модалки (за замовчуванням "Результат забігу"). */
  title?: string;
  onTryAgain: () => void;
  onViewLeaderboard: () => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const secondary = titles.qualified.filter((t) => t.id !== titles.primary?.id);

  return (
    <Modal className="result-modal" onClose={onTryAgain}>
      <div className="modal-head">
        <h3>{title}</h3>
      </div>
      <div className="modal-body">
        {busted && (
          <div className="banner banner-bad" style={{ marginBottom: 16 }}>
            <b>{busted.title}</b>
            <br />
            {busted.line} Результат у ладдер не потрапив.
          </div>
        )}
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
              {runCount !== undefined && runCount > 0 && <> · забігів зіграно: <b>{runCount}</b></>}
            </span>
          </div>

          {submitMsg && <p className="hint" style={{ margin: 0 }}>{submitMsg}</p>}
          {!viewOnly && (runContinues ? (
            <p className="hint" style={{ margin: 0 }}>Забіг триває: використано {stats.attemptsUsed} із {settings.mirageCount} міражів.</p>
          ) : (
            stats.attemptsUsed < settings.mirageCount && (
              <p className="hint" style={{ margin: 0 }}>Міражів лишалось: {settings.mirageCount - stats.attemptsUsed} — забіг завершено вручну.</p>
            )
          ))}

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

          <div className="result-stats-grid" style={{ marginTop: 8 }}>
            <Stat label="Очікувано успіхів" value={profile.expectedSuccesses.toFixed(1)} />
            <Stat label="Каменів витрачено" value={stats.paidAttempts} />
            <Stat label="Втрачено рівнів" value={stats.totalLevelsLost} />
            <Stat label="Поїздок у нуль" value={stats.timesHitZero} />
            <Stat
              label="Улюблений рівень"
              value={stats.favoriteLevel.attempts > 0 ? `+${stats.favoriteLevel.level} (${stats.favoriteLevel.attempts} сп.)` : '—'}
            />
            <Stat
              label="Найдовший застій"
              value={stats.longestStagnation.length > 0 ? `${stats.longestStagnation.length} сп. на ~+${stats.longestStagnation.level}` : '—'}
            />
            <Stat label="Рокіровок" value={stats.roleSwaps} />
            <Stat label="Ціна віри" value={`${ritual.decoyAttempts} сп.`} />
          </div>

          <div className="result-stats-grid" style={{ marginTop: 8 }}>
            {(Object.keys(STONE_LABEL) as StoneMethod[]).map((m) => {
              const limit = m === 'mirage' ? settings.mirageCount
                : m === 'sky' ? settings.skyCount
                : m === 'under' ? settings.underCount
                : settings.worldCount;
              const used = m === 'mirage' ? stats.attemptsUsed : stats.methodCounts[m];
              // У перегляді збереженого забігу поточні ліміти не показуємо —
              // він міг бути зіграний за інших налаштувань.
              const value = viewOnly
                ? (used > 0 ? `${used} · ${stats.methodSuccesses[m]}✓` : '—')
                : (used > 0 ? `${used}/${limit} · ${stats.methodSuccesses[m]}✓` : `0/${limit}`);
              return (
                <Stat key={m} label={m === 'mirage' ? 'Міражі (спроби)' : STONE_LABEL[m]} value={value} />
              );
            })}
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
                <span className="rng-profile-label" title={PROFILE_HINTS[key]}>{PROFILE_LABELS[key]}</span>
                <div className="rng-profile-bar">
                  <div className="rng-profile-bar-fill" style={{ width: profile[key] + '%' }} />
                </div>
                <span className="rng-profile-value">{profile[key]}</span>
              </div>
            ))}
          </div>

          <HistoryGraph history={history} />

          {stats.decoy.attempts > 0 && (
            <>
              <h4 style={{ margin: '4px 0 0' }}>Підставні (разом)</h4>
              <div className="result-stats-grid">
                <Stat label="Спроб" value={stats.decoy.attempts} />
                <Stat label="Успіхів" value={stats.decoy.successes} />
                <Stat label="Пік" value={'+' + stats.decoy.peakLevel} />
                <Stat label="Найкращий фініш" value={'+' + stats.decoy.finalLevel} />
                <Stat label="Поїздок у нуль" value={stats.decoy.timesHitZero} />
                <Stat label="Втрачено рівнів" value={stats.decoy.totalLevelsLost} />
              </div>
            </>
          )}

          {ritual.switches > 0 && (
            <>
              <h4 style={{ margin: '4px 0 0' }}>Ритуал</h4>
              <div className="result-stats-grid">
                <Stat label="Твій ритуал" value={displaySignature(ritual) ? `‹${displaySignature(ritual)}›` : '—'} />
                <Stat label="Школа" value={ritual.school ? SCHOOL_LABEL[ritual.school] : '—'} />
                <Stat label="Ритуальних тиців" value={ritual.switches} />
                <Stat label="Ортодоксальність" value={ritual.signature ? ritual.orthodoxy + '%' : '—'} />
                <Stat label="Сер. преамбула" value={ritual.avgPreamble.toFixed(1)} />
                <Stat label="Макс. преамбула" value={ritual.maxPreamble} />
                <Stat label="Різних ритуалів" value={ritual.distinctPreambles} />
                <Stat label="Перемикань" value={ritual.itemSwitches} />
              </div>
              <div className="rng-profile-grid">
                <div className="rng-profile-row">
                  <span className="rng-profile-label" title={`${ritual.ritual.successes} із ${ritual.ritual.n}, очікувано ${ritual.ritual.expected.toFixed(1)}`}>З ритуалом</span>
                  <div className="rng-profile-bar"><div className="rng-profile-bar-fill ritual" style={{ width: (ritual.ritual.luck ?? 0) + '%' }} /></div>
                  <span className="rng-profile-value">{ritual.ritual.luck ?? '—'}</span>
                </div>
                <div className="rng-profile-row">
                  <span className="rng-profile-label" title={`${ritual.plain.successes} із ${ritual.plain.n}, очікувано ${ritual.plain.expected.toFixed(1)}`}>Без ритуалу</span>
                  <div className="rng-profile-bar"><div className="rng-profile-bar-fill" style={{ width: (ritual.plain.luck ?? 0) + '%' }} /></div>
                  <span className="rng-profile-value">{ritual.plain.luck ?? '—'}</span>
                </div>
              </div>
              <p className="hint" style={{ margin: 0 }}>{ritualVerdict(ritual)}</p>
            </>
          )}
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
        {showHistory && <AttemptHistoryList history={history} style={{ marginTop: 10 }} />}
      </div>
      <div className="modal-foot">
        {viewOnly ? (
          <button type="button" className="btn btn-primary" onClick={onTryAgain}>Закрити</button>
        ) : (
          <>
            <button type="button" className="btn btn-ghost" onClick={onViewLeaderboard}>Перейти до ладдера</button>
            <button type="button" className="btn btn-primary" onClick={onTryAgain}>
              {runContinues ? 'Продовжити забіг' : 'Спробувати ще раз'}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

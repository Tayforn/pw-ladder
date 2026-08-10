// =========================================================
// Спецнагороди ладдера — рахуються з ПОВНОГО списку записів (не лише
// топ-10, які показує основна таблиця), щоб не втрачати, напр., "Найбільш
// прокляту" людину, яка не потрапила в топ за рівнем.
// Дані приходять пропом з App (єдиний фетч/realtime-канал у useLadderData) —
// раніше секція фетчила й підписувалась окремо, дублюючи трафік.
// =========================================================

import type { LadderEntry } from '../data/ladder';

interface Award {
  label: string;
  entry: LadderEntry;
  value: string;
}

function bestBy(entries: LadderEntry[], key: keyof LadderEntry, positiveOnly = false): LadderEntry | null {
  const pool = positiveOnly ? entries.filter((e) => (e[key] as number) > 0) : entries;
  if (pool.length === 0) return null;
  return pool.reduce((a, b) => ((b[key] as number) > (a[key] as number) ? b : a));
}

function fastestPeak(entries: LadderEntry[]): LadderEntry | null {
  const pool = entries.filter((e) => e.peakAttempt > 0);
  if (pool.length === 0) return null;
  return pool.reduce((a, b) => (b.peakAttempt < a.peakAttempt ? b : a));
}

export default function AwardsSection({ entries }: { entries: LadderEntry[] }) {
  if (entries.length === 0) return null;

  const luckiest = bestBy(entries, 'luckScore', true);
  const streaker = bestBy(entries, 'bestStreak', true);
  const comeback = bestBy(entries, 'biggestComeback', true);
  const cursed = bestBy(entries, 'worstStreak', true);
  const fall = bestBy(entries, 'biggestDrop', true);
  const fastest = fastestPeak(entries);
  // Поля нижче обчислює сервер із history (0007); у legacy-записів там 0 —
  // positiveOnly просто виключає їх із змагання.
  const gambler = bestBy(entries, 'aggression', true);
  const basement = bestBy(entries, 'timesHitZero', true);
  const sponsor = bestBy(entries, 'paidAttempts', true);

  const awards: Award[] = [
    { label: 'Найвищий рівень', entry: entries[0], value: `+${entries[0].level}` },
    ...(fastest ? [{ label: 'Найшвидший вихід на пік', entry: fastest, value: `спроба №${fastest.peakAttempt}` }] : []),
    ...(luckiest ? [{ label: 'Найудачливіший забіг', entry: luckiest, value: `Luck ${luckiest.luckScore}/100` }] : []),
    ...(streaker ? [{ label: 'Найкращий стрік', entry: streaker, value: `${streaker.bestStreak} перемог поспіль` }] : []),
    ...(comeback ? [{ label: 'Найбільший відкат', entry: comeback, value: `+${comeback.biggestComeback}` }] : []),
    ...(fall ? [{ label: 'Найболючіше падіння', entry: fall, value: `−${fall.biggestDrop} за раз` }] : []),
    ...(cursed ? [{ label: 'Найпроклятіший забіг', entry: cursed, value: `${cursed.worstStreak} провалів поспіль` }] : []),
    ...(gambler ? [{ label: 'Найагресивніший забіг', entry: gambler, value: `Агресія ${gambler.aggression}/100` }] : []),
    ...(basement ? [{ label: 'Абонемент у підвал', entry: basement, value: `${basement.timesHitZero} поїздок у +0` }] : []),
    ...(sponsor ? [{ label: 'Спонсор каменярні', entry: sponsor, value: `${sponsor.paidAttempts} каменів куплено` }] : []),
  ];

  return (
    <>
      <h3 style={{ marginTop: 28 }}>Спецнагороди</h3>
      <div className="awards-grid">
        {awards.map((a) => (
          <div key={a.label} className="award-chip">
            <span className="award-label">{a.label}</span>
            <span className="award-nick">{a.entry.nickname}</span>
            <span className="award-value">{a.value}</span>
          </div>
        ))}
      </div>
    </>
  );
}

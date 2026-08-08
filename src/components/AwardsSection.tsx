// =========================================================
// Спецнагороди ладдера — рахуються з ПОВНОГО списку записів (не лише
// топ-10, які показує основна таблиця), щоб не втрачати, напр., "Найбільш
// прокляту" людину, яка не потрапила в топ за рівнем.
// =========================================================

import { useEffect, useState } from 'react';
import { fetchLadder, subscribeLadderChanges, type LadderEntry } from '../data/ladder';

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

export default function AwardsSection() {
  const [entries, setEntries] = useState<LadderEntry[]>([]);

  useEffect(() => {
    const reload = () => fetchLadder().then(setEntries).catch(() => {});
    reload();
    return subscribeLadderChanges(reload);
  }, []);

  if (entries.length === 0) return null;

  const luckiest = bestBy(entries, 'luckScore', true);
  const streaker = bestBy(entries, 'bestStreak', true);
  const comeback = bestBy(entries, 'biggestComeback', true);
  const cursed = bestBy(entries, 'worstStreak', true);
  const fastest = fastestPeak(entries);

  const awards: Award[] = [
    { label: 'Найвищий рівень', entry: entries[0], value: `+${entries[0].level}` },
    ...(fastest ? [{ label: 'Найшвидший вихід на пік', entry: fastest, value: `спроба №${fastest.peakAttempt}` }] : []),
    ...(luckiest ? [{ label: 'Найудачливіший забіг', entry: luckiest, value: `Luck ${luckiest.luckScore}/100` }] : []),
    ...(streaker ? [{ label: 'Найкращий стрік', entry: streaker, value: `${streaker.bestStreak} перемог поспіль` }] : []),
    ...(comeback ? [{ label: 'Найбільший відкат', entry: comeback, value: `+${comeback.biggestComeback}` }] : []),
    ...(cursed ? [{ label: 'Найпроклятіший забіг', entry: cursed, value: `${cursed.worstStreak} провалів поспіль` }] : []),
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

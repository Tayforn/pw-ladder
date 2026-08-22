// =========================================================
// Спецнагороди ладдера — рахуються з ПОВНОГО списку записів (не лише
// топ-10, які показує основна таблиця), щоб не втрачати, напр., "Найбільш
// прокляту" людину, яка не потрапила в топ за рівнем.
// Дані приходять пропом з App (єдиний фетч/realtime-канал у useLadderData) —
// раніше секція фетчила й підписувалась окремо, дублюючи трафік.
// =========================================================

import type { LadderEntry } from '../data/ladder';
import { failsWord, stonesWord, tripsWord, winsWord } from '../lib/plural';

interface Award {
  label: string;
  entry: LadderEntry;
  value: string;
  /** Пояснення нагороди — підказка при наведенні. */
  hint: string;
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
    { label: 'Найвищий рівень', entry: entries[0], value: `+${entries[0].level}`, hint: 'Перше місце ладдера: найвищий рівень, за рівних — менше спроб.' },
    ...(fastest ? [{ label: 'Найшвидший вихід на пік', entry: fastest, value: `спроба №${fastest.peakAttempt}`, hint: 'На якій за ліком спробі забігу гравець уперше досяг свого піку.' }] : []),
    ...(luckiest ? [{ label: 'Найудачливіший забіг', entry: luckiest, value: `Luck ${luckiest.luckScore}/100`, hint: 'Успіхи проти очікуваних за шансами: 50 — як мало бути, вище — щастило.' }] : []),
    ...(streaker ? [{ label: 'Найкращий стрік', entry: streaker, value: `${streaker.bestStreak} ${winsWord(streaker.bestStreak)} поспіль`, hint: 'Найдовша серія успішних спроб поспіль (обидва предмети).' }] : []),
    ...(comeback ? [{ label: 'Найбільший відкат', entry: comeback, value: `+${comeback.biggestComeback}`, hint: 'Скільки рівнів відіграв після падіння — від дна до пізнішого піку.' }] : []),
    ...(fall ? [{ label: 'Найболючіше падіння', entry: fall, value: `−${fall.biggestDrop} за раз`, hint: 'Найбільша втрата рівнів за одну спробу.' }] : []),
    ...(cursed ? [{ label: 'Найпроклятіший забіг', entry: cursed, value: `${cursed.worstStreak} ${failsWord(cursed.worstStreak)} поспіль`, hint: 'Найдовша серія провалів поспіль.' }] : []),
    ...(gambler ? [{ label: 'Найагресивніший забіг', entry: gambler, value: `Агресія ${gambler.aggression}/100`, hint: 'Середня ставка на спробу: скільки рівнів згоріло б при провалі. Світобудова — 0, міраж на +6 — 6.' }] : []),
    ...(basement ? [{ label: 'Абонемент у підвал', entry: basement, value: `${basement.timesHitZero} ${tripsWord(basement.timesHitZero)} у +0`, hint: 'Скільки разів предмет злітав у +0 з рівня +1 і вище.' }] : []),
    ...(sponsor ? [{ label: 'Спонсор каменярні', entry: sponsor, value: `${sponsor.paidAttempts} ${stonesWord(sponsor.paidAttempts)} куплено`, hint: 'Кількість спроб платними каменями (усе, крім міража).' }] : []),
  ];

  return (
    <>
      <h3 style={{ marginTop: 28 }}>Спецнагороди</h3>
      <div className="awards-grid">
        {awards.map((a) => (
          <div key={a.label} className="award-chip" title={a.hint}>
            <span className="award-label">{a.label}</span>
            <span className="award-nick">{a.entry.nickname}</span>
            <span className="award-value">{a.value}</span>
          </div>
        ))}
      </div>
    </>
  );
}

// =========================================================
// Спецнагороди — рахуються з ПОВНОГО борду (не лише топ-10). Значення
// обчислює сервер із history забігу, підробити не можна. Клік по нагороді
// відкриває забіг її власника.
// =========================================================

import type { BoardEntry } from '../lib/apiTypes';
import { failsWord, plural, stonesWord, tripsWord, winsWord } from '../lib/plural';

const runsWord = (n: number) => plural(n, 'забіг', 'забіги', 'забігів');

interface Award {
  label: string;
  entry: BoardEntry;
  value: string;
  hint: string;
}

function bestBy(board: BoardEntry[], key: keyof BoardEntry, positiveOnly = false): BoardEntry | null {
  const pool = positiveOnly ? board.filter((e) => (e[key] as number) > 0) : board;
  if (pool.length === 0) return null;
  return pool.reduce((a, b) => ((b[key] as number) > (a[key] as number) ? b : a));
}

function fastestPeak(board: BoardEntry[]): BoardEntry | null {
  const pool = board.filter((e) => e.peakAttempt > 0);
  if (pool.length === 0) return null;
  return pool.reduce((a, b) => (b.peakAttempt < a.peakAttempt ? b : a));
}

export default function AwardsSection({
  board,
  onSelect,
}: {
  board: BoardEntry[];
  onSelect?: (playerId: string) => void;
}) {
  if (board.length === 0) return null;

  const grinder = bestBy(board, 'runsCount', true);
  const luckiest = bestBy(board, 'luckScore', true);
  const streaker = bestBy(board, 'bestStreak', true);
  const comeback = bestBy(board, 'biggestComeback', true);
  const cursed = bestBy(board, 'worstStreak', true);
  const fall = bestBy(board, 'biggestDrop', true);
  const fastest = fastestPeak(board);
  const gambler = bestBy(board, 'aggression', true);
  const basement = bestBy(board, 'timesHitZero', true);
  const sponsor = bestBy(board, 'paidAttempts', true);

  const awards: Award[] = [
    { label: 'Найвищий рівень', entry: board[0], value: `+${board[0].level}`, hint: 'Перше місце ладдера: найвищий рівень, за рівних — раніший забіг і менше спроб.' },
    ...(fastest ? [{ label: 'Найшвидший вихід на пік', entry: fastest, value: `спроба №${fastest.peakAttempt}`, hint: 'На якій за ліком спробі забігу гравець уперше досяг свого піку.' }] : []),
    ...(luckiest ? [{ label: 'Найудачливіший забіг', entry: luckiest, value: `Luck ${luckiest.luckScore}/100`, hint: 'Успіхи проти очікуваних за шансами: 50 — як мало бути, вище — щастило.' }] : []),
    ...(streaker ? [{ label: 'Найкращий стрік', entry: streaker, value: `${streaker.bestStreak} ${winsWord(streaker.bestStreak)} поспіль`, hint: 'Найдовша серія успішних спроб поспіль.' }] : []),
    ...(comeback ? [{ label: 'Найбільший відкат', entry: comeback, value: `+${comeback.biggestComeback}`, hint: 'Скільки рівнів відіграв після падіння — від дна до пізнішого піку.' }] : []),
    ...(fall ? [{ label: 'Найболючіше падіння', entry: fall, value: `−${fall.biggestDrop} за раз`, hint: 'Найбільша втрата рівнів за одну спробу.' }] : []),
    ...(cursed ? [{ label: 'Найпроклятіший забіг', entry: cursed, value: `${cursed.worstStreak} ${failsWord(cursed.worstStreak)} поспіль`, hint: 'Найдовша серія провалів поспіль.' }] : []),
    ...(gambler ? [{ label: 'Найагресивніший забіг', entry: gambler, value: `Агресія ${gambler.aggression}/100`, hint: 'Середня ставка на спробу: скільки рівнів згоріло б при провалі.' }] : []),
    ...(basement ? [{ label: 'Абонемент у підвал', entry: basement, value: `${basement.timesHitZero} ${tripsWord(basement.timesHitZero)} у +0`, hint: 'Скільки разів предмет злітав у +0 з рівня +1 і вище.' }] : []),
    ...(sponsor ? [{ label: 'Спонсор каменярні', entry: sponsor, value: `${sponsor.paidAttempts} ${stonesWord(sponsor.paidAttempts)} куплено`, hint: 'Кількість спроб платними каменями (усе, крім міража).' }] : []),
    ...(grinder && grinder.runsCount >= 2 ? [{ label: 'Найзавзятіший гравець', entry: grinder, value: `${grinder.runsCount} ${runsWord(grinder.runsCount)}`, hint: 'Скільки завершених забігів зіграно (включно зі скинутими).' }] : []),
  ];

  return (
    <>
      <h3 style={{ marginTop: 28 }}>Спецнагороди</h3>
      <div className="awards-grid">
        {awards.map((a) => (
          <div
            key={a.label}
            className={'award-chip' + (onSelect ? ' row-clickable' : '')}
            title={a.hint + (onSelect ? ` Клік — забіг «${a.entry.nickname}».` : '')}
            onClick={onSelect ? () => onSelect(a.entry.playerId) : undefined}
          >
            <span className="award-label">{a.label}</span>
            <span className="award-nick">{a.entry.nickname}</span>
            <span className="award-value">{a.value}</span>
          </div>
        ))}
      </div>
    </>
  );
}

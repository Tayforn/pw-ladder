// =========================================================
// Публічна таблиця лідерів — рядок поточного гравця підсвічується.
// onSelect (опційно) робить рядки клікабельними: App відкриває попап
// перегляду збереженого забігу гравця (той самий фінальний екран).
// =========================================================

import type { LadderEntry } from '../data/ladder';

export default function LadderTable({
  entries,
  nickname,
  runCounts,
  onSelect,
}: {
  entries: LadderEntry[];
  nickname: string;
  /** Завершених забігів на нік (0013) — для тултипа рядка. */
  runCounts?: Record<string, number>;
  onSelect?: (nickname: string) => void;
}) {
  if (entries.length === 0) {
    return <p className="hint">Ладдер поки порожній — стань першим!</p>;
  }
  // Колонку "Ранів" показуємо лише коли лічильники передано (публічна
  // таблиця); в адмінці, яка runCounts не передає, її нема.
  const showRuns = runCounts !== undefined;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Нік</th>
            <th className="num">Рівень</th>
            <th className="num">Спроб</th>
            <th className="num" title="Платних каменів використано — третій критерій рейтингу (менше = краще)">Камені</th>
            {showRuns && <th className="num" title="Скільки завершених забігів зіграно (включно зі скинутими)">Ранів</th>}
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <tr
              key={e.nickname}
              className={(e.nickname === nickname ? 'winner ' : '') + (onSelect ? 'row-clickable' : '') || undefined}
              title={onSelect ? `Переглянути найкращий забіг «${e.nickname}»` : undefined}
              onClick={onSelect ? () => onSelect(e.nickname) : undefined}
            >
              <td>{i + 1}</td>
              <td>{e.nickname}</td>
              <td className="num">+{e.level}</td>
              <td className="num">{e.attempts}</td>
              <td className="num"><span className="muted">{e.paidAttempts}</span></td>
              {showRuns && <td className="num"><span className="muted">{runCounts[e.nickname] ?? '—'}</span></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

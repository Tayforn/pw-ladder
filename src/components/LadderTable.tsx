// =========================================================
// Публічна таблиця лідерів — рядок поточного гравця підсвічується.
// =========================================================

import type { LadderEntry } from '../data/ladder';

export default function LadderTable({ entries, nickname }: { entries: LadderEntry[]; nickname: string }) {
  if (entries.length === 0) {
    return <p className="hint">Ладдер поки порожній — стань першим!</p>;
  }
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Нік</th>
            <th className="num">Рівень</th>
            <th className="num">Бали</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={e.nickname} className={e.nickname === nickname ? 'winner' : undefined}>
              <td>{i + 1}</td>
              <td>{e.nickname}</td>
              <td className="num">+{e.level}</td>
              <td className="num">{e.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

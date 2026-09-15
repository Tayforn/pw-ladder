// =========================================================
// Публічний ладдер. Рейтинг (рахує сервер): рівень ↓, номер забігу, у якому
// рівень досягнуто вперше ↑, спроби ↑, платні камені ↑. Клік по рядку
// відкриває найкращий забіг гравця (той самий фінальний екран).
// =========================================================

import type { BoardEntry } from '../lib/apiTypes';

export default function LadderTable({
  board,
  meNickname,
  onSelect,
}: {
  board: BoardEntry[];
  meNickname?: string;
  onSelect?: (playerId: string) => void;
}) {
  if (board.length === 0) {
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
            <th className="num" title="У якому за ліком забігу гравець уперше досяг цього рівня — другий критерій рейтингу (менше = краще)">Забіг №</th>
            <th className="num">Спроб</th>
            <th className="num" title="Платних каменів використано — критерій рейтингу після спроб">Камені</th>
            <th className="num" title="Скільки завершених забігів зіграно (включно зі скинутими)">Ранів</th>
          </tr>
        </thead>
        <tbody>
          {board.map((e, i) => (
            <tr
              key={e.playerId}
              className={(e.nickname === meNickname ? 'winner ' : '') + (onSelect ? 'row-clickable' : '') || undefined}
              title={onSelect ? `Переглянути найкращий забіг «${e.nickname}»` : undefined}
              onClick={onSelect ? () => onSelect(e.playerId) : undefined}
            >
              <td>{i + 1}</td>
              <td>{e.nickname}</td>
              <td className="num">+{e.level}</td>
              <td className="num"><span className="muted">{e.runIndex}</span></td>
              <td className="num">{e.attempts}</td>
              <td className="num"><span className="muted">{e.paidAttempts}</span></td>
              <td className="num"><span className="muted">{e.runsCount}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

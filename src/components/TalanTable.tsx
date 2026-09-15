// =========================================================
// «Талан» — окремий ладдер для тих, хто не «вміє точитись»: найкращий
// рівень за перші talanRuns забігів гравця. Об'єм тут не допомагає —
// рахуються лише перші забіги, тож новачок, якому пощастило рано, стоїть
// нагорі. Рейтинг: рівень ↓, номер забігу ↑, спроби ↑.
// =========================================================

import type { TalanEntry } from '../lib/apiTypes';

export default function TalanTable({
  talan,
  meNickname,
  onSelect,
}: {
  talan: TalanEntry[];
  meNickname?: string;
  onSelect?: (playerId: string) => void;
}) {
  if (talan.length === 0) {
    return <p className="hint">Поки порожньо — зіграй перші забіги.</p>;
  }
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Нік</th>
            <th className="num">Рівень</th>
            <th className="num" title="У якому з перших забігів досягнуто цей рівень">Забіг №</th>
            <th className="num">Спроб</th>
          </tr>
        </thead>
        <tbody>
          {talan.map((e, i) => (
            <tr
              key={e.playerId}
              className={(e.nickname === meNickname ? 'winner ' : '') + (onSelect ? 'row-clickable' : '') || undefined}
              title={onSelect ? `Переглянути забіг «${e.nickname}»` : undefined}
              onClick={onSelect ? () => onSelect(e.playerId) : undefined}
            >
              <td>{i + 1}</td>
              <td>{e.nickname}</td>
              <td className="num">+{e.level}</td>
              <td className="num"><span className="muted">{e.runIndex}</span></td>
              <td className="num">{e.attempts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

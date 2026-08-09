// =========================================================
// Попап "Таблиця нагород" — статичний розподіл 1000 скринь між топ-10
// місцями ладдера. Підсвічує рядок поточного гравця, якщо його нік є
// серед переданих (топ-10) записів.
// =========================================================

interface PrizeRow {
  place: string;
  chests: number;
  share: string;
}

const ROWS: PrizeRow[] = [
  { place: '🥇 1', chests: 200, share: '20%' },
  { place: '🥈 2', chests: 160, share: '16%' },
  { place: '🥉 3', chests: 125, share: '12.5%' },
  { place: '4', chests: 100, share: '10%' },
  { place: '5', chests: 90, share: '9%' },
  { place: '6', chests: 80, share: '8%' },
  { place: '7', chests: 70, share: '7%' },
  { place: '8', chests: 65, share: '6.5%' },
  { place: '9', chests: 60, share: '6%' },
  { place: '10', chests: 50, share: '5%' },
];

export default function PrizeTable({
  entries,
  nickname,
  onClose,
}: {
  entries: { nickname: string }[];
  nickname: string;
  onClose: () => void;
}) {
  const myPlace = entries.findIndex((e) => e.nickname === nickname) + 1; // 0, якщо не в топ-10

  return (
    <div className="modal-overlay">
      <div className="modal" role="dialog" aria-modal="true" style={{ width: 'min(560px, 100%)' }}>
        <div className="modal-head">
          <h3>Таблиця нагород</h3>
        </div>
        <div className="modal-body">
          <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
            Фонд — 1000 скринь, розподілений між топ-10 місцями ладдера.
          </p>
          <div className="table-wrap">
            <table className="data-table prize-table">
              <thead>
                <tr>
                  <th>Місце</th>
                  <th className="num">🏆 Сундуки</th>
                  <th className="num share-col">Частка фонду</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r, i) => (
                  <tr key={r.place} className={i + 1 === myPlace ? 'winner' : undefined}>
                    <td>{r.place}</td>
                    <td className="num"><b>{r.chests}</b></td>
                    <td className="num share-col">{r.share}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: '2px solid var(--line-2)' }}>
                  <td><b>Разом</b></td>
                  <td className="num"><b>1000</b></td>
                  <td className="num share-col"><b>100%</b></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Закрити</button>
        </div>
      </div>
    </div>
  );
}

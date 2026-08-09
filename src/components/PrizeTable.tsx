// =========================================================
// Призовий фонд — статичний розподіл 100 скринь між топ-10 місцями
// ладдера. Суто інформаційний блок, жодних даних із Supabase.
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

export default function PrizeTable() {
  return (
    <>
      <h3 style={{ marginTop: 28 }}>Призовий фонд</h3>
      <p className="hint" style={{ marginTop: -6, marginBottom: 12 }}>
        Фонд — 100 скринь, розподілений між топ-10 місцями ладдера.
      </p>
      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Місце</th>
                <th className="num">🏆 Сундуки</th>
                <th className="num">Частка фонду</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.place}>
                  <td>{r.place}</td>
                  <td className="num"><b>{r.chests}</b></td>
                  <td className="num">{r.share}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid var(--line-2)' }}>
                <td><b>Разом</b></td>
                <td className="num"><b>1000</b></td>
                <td className="num"><b>100%</b></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

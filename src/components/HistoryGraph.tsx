// =========================================================
// "Подорож" забігу — SVG-графік рівня по всіх спробах. Точний, без
// згладжування (кожна спроба — точка); підказка при наведенні показує
// деталі конкретної спроби. Позначки: пік, перший +7, перший +10.
// =========================================================

import { MAX_LEVEL, STONE_LABEL } from '../data/refineRates';
import type { AttemptResult } from '../lib/types';

const W = 700;
const H = 200;
const PAD = 22;

export default function HistoryGraph({ history }: { history: AttemptResult[] }) {
  if (history.length === 0) return null;

  const xFor = (i: number) => PAD + (history.length <= 1 ? 0 : (i / (history.length - 1)) * (W - PAD * 2));
  const yFor = (lv: number) => H - PAD - (lv / MAX_LEVEL) * (H - PAD * 2);

  const points = history.map((h, i) => ({ x: xFor(i), y: yFor(h.after), h, idx: i + 1 }));
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  let peakIdx = 0;
  history.forEach((h, i) => {
    if (h.after > history[peakIdx].after) peakIdx = i;
  });
  const first7 = history.findIndex((h) => h.after >= 7);
  const first10 = history.findIndex((h) => h.after >= 10);

  const gridLevels = [0, 3, 6, 9, 12];

  return (
    <div className="history-graph">
      <svg viewBox={`0 0 ${W} ${H}`} className="history-graph-svg" role="img" aria-label="Графік рівня по спробах">
        {gridLevels.map((lv) => (
          <g key={lv}>
            <line x1={PAD} x2={W - PAD} y1={yFor(lv)} y2={yFor(lv)} className="history-grid-line" />
            <text x={2} y={yFor(lv) + 4} className="history-grid-label">+{lv}</text>
          </g>
        ))}

        <path d={pathD} className="history-graph-path" fill="none" />

        {points.map((p) => {
          const isDrop = p.h.after < p.h.before;
          return (
            <circle
              key={p.idx}
              cx={p.x}
              cy={p.y}
              r={isDrop ? 3 : 2}
              className={'history-point ' + (p.h.success ? 'succ' : isDrop ? 'drop' : 'fail')}
            >
              <title>
                {`#${p.idx}: ${STONE_LABEL[p.h.method]} · +${p.h.before} → +${p.h.after} · ${p.h.success ? 'успіх' : 'провал'}`}
              </title>
            </circle>
          );
        })}

        {history[peakIdx] && (
          <circle cx={points[peakIdx].x} cy={points[peakIdx].y} r={5} className="history-marker">
            <title>{`Пік: +${history[peakIdx].after} (спроба №${peakIdx + 1})`}</title>
          </circle>
        )}
        {first7 >= 0 && first7 !== peakIdx && (
          <circle cx={points[first7].x} cy={points[first7].y} r={4} className="history-marker history-marker-sub">
            <title>{`Перший +7 (спроба №${first7 + 1})`}</title>
          </circle>
        )}
        {first10 >= 0 && first10 !== peakIdx && (
          <circle cx={points[first10].x} cy={points[first10].y} r={4} className="history-marker history-marker-sub">
            <title>{`Перший +10 (спроба №${first10 + 1})`}</title>
          </circle>
        )}
      </svg>
    </div>
  );
}

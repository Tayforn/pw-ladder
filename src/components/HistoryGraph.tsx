// =========================================================
// "Подорож" забігу — SVG-графік рівня по всіх спробах. Дві лінії: предмет-
// переможець яскравий, другий — приглушений; x — глобальний номер спроби.
// Точний, без згладжування (кожна спроба — точка); підказка при наведенні
// показує деталі. Позначки: пік переможця, моменти рокіровки.
// =========================================================

import { MAX_LEVEL, STONE_LABEL } from '../data/refineRates';
import { MAJOR_SWAP_LEVEL, pickWinner } from '../lib/sessionStats';
import { otherSlot, type AttemptResult, type ItemSlot } from '../lib/types';

const W = 700;
const H = 200;
const PAD = 22;

export default function HistoryGraph({ history }: { history: AttemptResult[] }) {
  if (history.length === 0) return null;

  const winner = pickWinner(history);
  const xFor = (i: number) => PAD + (history.length <= 1 ? 0 : (i / (history.length - 1)) * (W - PAD * 2));
  const yFor = (lv: number) => H - PAD - (lv / MAX_LEVEL) * (H - PAD * 2);

  const series = (item: ItemSlot) =>
    history
      .map((h, i) => ({ x: xFor(i), y: yFor(h.after), h, idx: i + 1 }))
      .filter((p) => p.h.item === item);
  const pathOf = (pts: ReturnType<typeof series>) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  const main = series(winner);
  const other = series(otherSlot(winner));

  let peak = main[0];
  for (const p of main) if (p.h.after > peak.h.after) peak = p;

  // Значущі рокіровки (новий основний на +3 і вище): відтворюємо липке
  // правило ролей; зміни ролей на 0↔1 — шум, на графіку не потрібні.
  const swaps: number[] = [];
  {
    const levels: Record<ItemSlot, number> = { a: 0, b: 0 };
    let mainSlot: ItemSlot = 'a';
    history.forEach((h, i) => {
      levels[h.item] = h.after;
      if (levels[otherSlot(mainSlot)] > levels[mainSlot]) {
        mainSlot = otherSlot(mainSlot);
        if (levels[mainSlot] >= MAJOR_SWAP_LEVEL) swaps.push(i);
      }
    });
  }

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

        {swaps.map((i) => (
          <line key={'swap' + i} x1={xFor(i)} x2={xFor(i)} y1={PAD - 6} y2={H - PAD} className="history-swap-line">
            <title>{`Рокіровка на спробі №${i + 1}`}</title>
          </line>
        ))}

        {other.length > 0 && <path d={pathOf(other)} className="history-graph-path history-graph-path-dim" fill="none" />}
        {main.length > 0 && <path d={pathOf(main)} className="history-graph-path" fill="none" />}

        {[...other, ...main].map((p) => {
          const isDrop = p.h.after < p.h.before;
          const dim = p.h.item !== winner;
          return (
            <circle
              key={p.idx}
              cx={p.x}
              cy={p.y}
              r={isDrop ? 3 : 2}
              className={'history-point ' + (p.h.success ? 'succ' : isDrop ? 'drop' : 'fail') + (dim ? ' dim' : '')}
            >
              <title>
                {`#${p.idx} (${p.h.role === 'main' ? 'основна' : 'підставна'}): ${STONE_LABEL[p.h.method]} · +${p.h.before} → +${p.h.after} · ${p.h.success ? 'успіх' : 'провал'}`}
              </title>
            </circle>
          );
        })}

        {peak && (
          <circle cx={peak.x} cy={peak.y} r={5} className="history-marker">
            <title>{`Пік: +${peak.h.after} (спроба №${peak.idx})`}</title>
          </circle>
        )}
      </svg>
    </div>
  );
}

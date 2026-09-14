// =========================================================
// "Подорож" забігу — інтерактивний SVG-графік рівня по всіх спробах.
// Лінії: предмет-переможець яскравий, підставні — приглушені пунктири;
// x — глобальний номер спроби. Позначки: пік переможця, значущі рокіровки.
//
// Інтерактив: наведення на графік підсвічує найближчу спробу (приціл +
// збільшений вузол + підсвітка лінії її предмета) і показує деталі в
// панелі під графіком; кнопка ⛶ розгортає графік на весь екран (Esc /
// клік поза вікном — закрити). Легенда з поясненнями — під графіком.
// =========================================================

import { useMemo, useRef, useState } from 'react';
import { MAX_LEVEL, STONE_LABEL } from '../data/refineRates';
import { MAJOR_SWAP_LEVEL, pickWinner } from '../lib/sessionStats';
import { LABEL_TEXT, TIER_LABEL } from '../lib/criticalMoments';
import { ALL_SLOTS, type AttemptResult, type ItemSlot } from '../lib/types';
import Modal from './Modal';

const W = 700;
const H = 200;
const PAD = 22;

interface Pt {
  x: number;
  y: number;
  h: AttemptResult;
  idx: number; // 1-based глобальний номер спроби
}

export default function HistoryGraph({ history }: { history: AttemptResult[] }) {
  const [expanded, setExpanded] = useState(false);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const data = useMemo(() => {
    if (history.length === 0) return null;
    const winner = pickWinner(history);
    const xFor = (i: number) => PAD + (history.length <= 1 ? 0 : (i / (history.length - 1)) * (W - PAD * 2));
    const yFor = (lv: number) => H - PAD - (lv / MAX_LEVEL) * (H - PAD * 2);
    const all: Pt[] = history.map((h, i) => ({ x: xFor(i), y: yFor(h.after), h, idx: i + 1 }));
    const series = new Map<ItemSlot, Pt[]>();
    for (const slot of ALL_SLOTS) {
      const pts = all.filter((p) => p.h.item === slot);
      if (pts.length > 0) series.set(slot, pts);
    }
    let peak = all[0];
    for (const p of all) {
      if (p.h.item === winner && p.h.after > peak.h.after) peak = p;
    }
    // Значущі рокіровки (новий основний на +3 і вище) — липке правило ролей.
    const swaps: number[] = [];
    {
      const levels: Record<ItemSlot, number> = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 };
      let mainSlot: ItemSlot = 'a';
      history.forEach((h, i) => {
        levels[h.item] = h.after;
        let next: ItemSlot = mainSlot;
        for (const slot of ALL_SLOTS) {
          if (levels[slot] > levels[next]) next = slot;
        }
        if (next !== mainSlot) {
          mainSlot = next;
          if (levels[mainSlot] >= MAJOR_SWAP_LEVEL) swaps.push(i);
        }
      });
    }
    // Позначки осі X: ~6 круглих значень.
    const step = Math.max(1, Math.ceil(history.length / 6 / 10) * 10);
    const xTicks: number[] = [];
    for (let n = step; n <= history.length; n += step) xTicks.push(n);

    // Ключові моменти — для аналізу забігу (свого чи чужого в попапі).
    // Кожен момент прив'язаний до номера спроби; наведення підсвічує його
    // на графіку.
    const moments: Array<{ idx: number; text: string }> = [];
    moments.push({ idx: peak.idx, text: `Пік +${peak.h.after} — спроба №${peak.idx}` });
    {
      let drop: Pt | null = null;
      for (const p of all) {
        if (p.h.after < p.h.before && (!drop || p.h.before - p.h.after > drop.h.before - drop.h.after)) drop = p;
      }
      if (drop && drop.h.before - drop.h.after >= 2) {
        moments.push({ idx: drop.idx, text: `Найбільше падіння +${drop.h.before} → +${drop.h.after} — спроба №${drop.idx}` });
      }
    }
    {
      const bestRun = (want: boolean) => {
        let best = { len: 0, from: 0 };
        let cur = 0;
        history.forEach((h, i) => {
          cur = h.success === want ? cur + 1 : 0;
          if (cur > best.len) best = { len: cur, from: i - cur + 2 };
        });
        return best;
      };
      const wins = bestRun(true);
      if (wins.len >= 3) moments.push({ idx: wins.from + wins.len - 1, text: `Найдовша серія успіхів (${wins.len}) — спроби №${wins.from}–${wins.from + wins.len - 1}` });
      const fails = bestRun(false);
      if (fails.len >= 4) moments.push({ idx: fails.from + fails.len - 1, text: `Найдовша серія провалів (${fails.len}) — спроби №${fails.from}–${fails.from + fails.len - 1}` });
    }
    {
      let miracle: Pt | null = null;
      for (const p of all) {
        if (p.h.success && (!miracle || p.h.p < miracle.h.p)) miracle = p;
      }
      if (miracle && miracle.h.p <= 0.1) {
        moments.push({ idx: miracle.idx, text: `Найдивніший успіх — №${miracle.idx} (шанс ${(miracle.h.p * 100).toFixed(2)}%)` });
      }
    }
    for (const i of swaps) moments.push({ idx: i + 1, text: `Рокіровка — спроба №${i + 1}` });

    return { winner, all, series, peak, swaps, xTicks, moments, xFor, yFor };
  }, [history]);

  if (!data) return null;
  const { winner, all, series, peak, swaps, xTicks, moments, xFor } = data;
  const hovered = hoverIdx !== null ? all[hoverIdx] : null;

  const pathOf = (pts: Pt[]) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  const infoLine = hovered ? (
    <>
      <b>#{hovered.idx}</b> · <span className={'item-badge ' + hovered.h.role}>{hovered.h.role === 'main' ? 'О' : 'П'}</span>{' '}
      {hovered.h.role === 'main' ? 'Основна' : 'Підставна'} · <span className={'badge ' + hovered.h.method}>{STONE_LABEL[hovered.h.method]}</span>{' '}
      · +{hovered.h.before} → +{hovered.h.after} ·{' '}
      {hovered.h.success ? <span className="succ">✓ успіх</span> : <span className="fail">✗ провал</span>}
      {' '}(шанс {(hovered.h.p * 100).toFixed(2)}%)
      {hovered.h.tier !== 'normal' && <span className={'drama-tag drama-' + hovered.h.tier}>{TIER_LABEL[hovered.h.tier]}</span>}
      {hovered.h.labels.map((l) => (
        <span key={l} className="moment-tag">{LABEL_TEXT[l]}</span>
      ))}
    </>
  ) : (
    <span className="muted">Наведи курсор на графік — тут з'являться деталі спроби.</span>
  );

  const legend = (
    <div className="graph-legend">
      <span><i className="lg-line lg-main" /> предмет-переможець (іде в ладдер)</span>
      <span><i className="lg-line lg-decoy" /> інші предмети (підставні)</span>
      <span><i className="lg-dot lg-succ" /> успіх (+1 рівень)</span>
      <span><i className="lg-dot lg-fail" /> провал без втрати рівня</span>
      <span><i className="lg-dot lg-drop" /> падіння рівня</span>
      <span><i className="lg-line lg-swap" /> рокіровка — підставна стала основною</span>
      <span><i className="lg-dot lg-peak" /> пік забігу</span>
    </div>
  );

  const svg = (cls: string) => (
    <GraphSvg
      className={cls}
      all={all}
      series={series}
      winner={winner}
      peak={peak}
      swaps={swaps}
      xTicks={xTicks}
      xFor={xFor}
      yFor={data.yFor}
      hovered={hovered}
      hoveredSlot={hovered?.h.item ?? null}
      pathOf={pathOf}
      onHover={setHoverIdx}
    />
  );

  const body = (cls: string) => (
    <>
      {svg(cls)}
      <div className="graph-info">{infoLine}</div>
      {moments.length > 0 && (
        <div className="graph-moments">
          <span className="graph-moments-title">Ключові моменти (наведи — підсвітиться):</span>
          {moments.map((m) => (
            <span
              key={m.text}
              className={'graph-moment' + (hoverIdx === m.idx - 1 ? ' active' : '')}
              onMouseEnter={() => setHoverIdx(m.idx - 1)}
              onMouseLeave={() => setHoverIdx(null)}
            >
              {m.text}
            </span>
          ))}
        </div>
      )}
      {legend}
    </>
  );

  return (
    <div className="history-graph">
      <div className="graph-head">
        <span className="hint" style={{ margin: 0 }}>Подорож забігу · рівень по спробах</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setExpanded(true)} title="Розгорнути графік на весь екран">
          ⛶ Розгорнути
        </button>
      </div>
      {body('history-graph-svg')}
      {expanded && (
        <Modal className="modal-graph" onClose={() => setExpanded(false)}>
          <div className="modal-head">
            <h3>Подорож забігу · {history.length} спроб</h3>
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setExpanded(false)}>✕ Закрити</button>
          </div>
          <div className="modal-body">
            {body('history-graph-svg history-graph-svg-full')}
          </div>
        </Modal>
      )}
    </div>
  );
}

function GraphSvg({
  className,
  all,
  series,
  winner,
  peak,
  swaps,
  xTicks,
  xFor,
  yFor,
  hovered,
  hoveredSlot,
  pathOf,
  onHover,
}: {
  className: string;
  all: Pt[];
  series: Map<ItemSlot, Pt[]>;
  winner: ItemSlot;
  peak: Pt;
  swaps: number[];
  xTicks: number[];
  xFor: (i: number) => number;
  yFor: (lv: number) => number;
  hovered: Pt | null;
  hoveredSlot: ItemSlot | null;
  pathOf: (pts: Pt[]) => string;
  onHover: (idx: number | null) => void;
}) {
  const ref = useRef<SVGSVGElement>(null);

  // Позиція миші → найближча спроба (точне перетворення екранних координат
  // у координати viewBox через CTM — працює і з letterbox-масштабуванням).
  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = ref.current;
    if (!svg) return;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < all.length; i++) {
      const d = Math.abs(all[i].x - pt.x);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    onHover(best);
  };

  const gridLevels = [0, 3, 6, 9, 12];

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      role="img"
      aria-label="Графік рівня по спробах"
      onMouseMove={handleMove}
      onMouseLeave={() => onHover(null)}
    >
      {gridLevels.map((lv) => (
        <g key={lv}>
          <line x1={PAD} x2={W - PAD} y1={yFor(lv)} y2={yFor(lv)} className="history-grid-line" />
          <text x={2} y={yFor(lv) + 4} className="history-grid-label">+{lv}</text>
        </g>
      ))}
      {xTicks.map((n) => (
        <text key={n} x={xFor(n - 1)} y={H - 6} className="history-grid-label" textAnchor="middle">{n}</text>
      ))}

      {swaps.map((i) => (
        <line key={'swap' + i} x1={xFor(i)} x2={xFor(i)} y1={PAD - 6} y2={H - PAD} className="history-swap-line">
          <title>{`Рокіровка на спробі №${i + 1}`}</title>
        </line>
      ))}

      {[...series.entries()]
        .sort(([a], [b]) => (a === winner ? 1 : 0) - (b === winner ? 1 : 0)) // переможець малюється зверху
        .map(([slot, pts]) => (
          <path
            key={slot}
            d={pathOf(pts)}
            className={
              'history-graph-path' +
              (slot === winner ? '' : ' history-graph-path-dim') +
              (hoveredSlot === slot ? ' active' : '')
            }
            fill="none"
          />
        ))}

      {all.map((p) => {
        const isDrop = p.h.after < p.h.before;
        const dim = p.h.item !== winner;
        return (
          <circle
            key={p.idx}
            cx={p.x}
            cy={p.y}
            r={isDrop ? 3 : 2}
            className={'history-point ' + (p.h.success ? 'succ' : isDrop ? 'drop' : 'fail') + (dim ? ' dim' : '')}
          />
        );
      })}

      <circle cx={peak.x} cy={peak.y} r={5} className="history-marker">
        <title>{`Пік: +${peak.h.after} (спроба №${peak.idx})`}</title>
      </circle>

      {hovered && (
        <g className="history-hover">
          <line x1={hovered.x} x2={hovered.x} y1={PAD - 6} y2={H - PAD} className="history-crosshair" />
          <circle cx={hovered.x} cy={hovered.y} r={5.5} className="history-point-active" />
        </g>
      )}
    </svg>
  );
}

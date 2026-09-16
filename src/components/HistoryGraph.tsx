// =========================================================
// "Подорож" забігу — інтерактивний SVG-графік рівня по всіх спробах.
// Лінії: предмет-переможець яскравий, підставні — приглушені пунктири;
// x — глобальний номер спроби. Позначки: пік переможця, значущі рокіровки.
//
// Інтерактив: наведення підсвічує найближчу спробу (приціл + панель
// деталей ФІКСОВАНОЇ висоти — верстка не смикається); кнопка ⛶ розгортає
// графік на весь екран.
//
// Зум у розгорнутому вигляді — ВІКОННИЙ, а не масштабування картинки:
// колесо змінює, СКІЛЬКИ спроб влазить у вікно (крок по горизонталі), а
// viewBox лишається сталим. Тому точки й лінії завжди однакового розміру,
// і зумом можна реально розбирати окремі спроби, а не розглядати
// роздуті кружечки. Перетягування зсуває вікно, подвійний клік — увесь забіг.
// =========================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_LEVEL, STONE_LABEL } from '../data/refineRates';
import { MAJOR_SWAP_LEVEL, pickWinner } from '../lib/sessionStats';
import { LABEL_TEXT, TIER_LABEL } from '../lib/criticalMoments';
import { ALL_SLOTS, type AttemptResult, type ItemSlot } from '../lib/types';
import Modal from './Modal';

const W = 700;
const H = 200;
const PAD = 22;
/** Менше за стільки спроб у вікні не показуємо — далі вже нема що розбирати. */
const MIN_VISIBLE = 8;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

interface Win {
  /** 0-based номер першої видимої спроби. */
  start: number;
  /** Скільки спроб видно. */
  count: number;
}

export default function HistoryGraph({ history }: { history: AttemptResult[] }) {
  const [expanded, setExpanded] = useState(false);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const data = useMemo(() => {
    if (history.length === 0) return null;
    const winner = pickWinner(history);

    // Пік переможця (перше досягнення максимуму).
    let peakIdx = 0;
    let peakLevel = -1;
    history.forEach((h, i) => {
      if (h.item === winner && h.after > peakLevel) {
        peakLevel = h.after;
        peakIdx = i;
      }
    });

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

    // Ключові моменти — для аналізу забігу (свого чи чужого в попапі).
    const moments: Array<{ idx: number; text: string }> = [];
    moments.push({ idx: peakIdx + 1, text: `Пік +${peakLevel} — спроба №${peakIdx + 1}` });
    {
      let drop = -1;
      let dropSize = 0;
      history.forEach((h, i) => {
        const d = h.before - h.after;
        if (h.after < h.before && d > dropSize) {
          dropSize = d;
          drop = i;
        }
      });
      if (drop >= 0 && dropSize >= 2) {
        const h = history[drop];
        moments.push({ idx: drop + 1, text: `Найбільше падіння +${h.before} → +${h.after} — спроба №${drop + 1}` });
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
      let miracle = -1;
      history.forEach((h, i) => {
        if (h.success && (miracle < 0 || h.p < history[miracle].p)) miracle = i;
      });
      if (miracle >= 0 && history[miracle].p <= 0.1) {
        moments.push({ idx: miracle + 1, text: `Найдивніший успіх — №${miracle + 1} (шанс ${(history[miracle].p * 100).toFixed(2)}%)` });
      }
    }
    for (const i of swaps) moments.push({ idx: i + 1, text: `Рокіровка — спроба №${i + 1}` });

    return { winner, peakIdx, peakLevel, swaps, moments };
  }, [history]);

  if (!data) return null;
  const { winner, peakIdx, swaps, moments } = data;
  const hovered = hoverIdx !== null ? history[hoverIdx] ?? null : null;

  const infoLine = hovered && hoverIdx !== null ? (
    <>
      <b>#{hoverIdx + 1}</b> · <span className={'item-badge ' + hovered.role}>{hovered.role === 'main' ? 'О' : 'П'}</span>{' '}
      {hovered.role === 'main' ? 'Основна' : 'Підставна'} · <span className={'badge ' + hovered.method}>{STONE_LABEL[hovered.method]}</span>{' '}
      · +{hovered.before} → +{hovered.after} ·{' '}
      {hovered.success ? <span className="succ">✓ успіх</span> : <span className="fail">✗ провал</span>}
      {' '}(шанс {(hovered.p * 100).toFixed(2)}%)
      {hovered.tier !== 'normal' && <span className={'drama-tag drama-' + hovered.tier}>{TIER_LABEL[hovered.tier]}</span>}
      {hovered.labels.map((l) => (
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

  const body = (cls: string, zoomable: boolean) => (
    <>
      <GraphSvg
        className={cls}
        zoomable={zoomable}
        history={history}
        winner={winner}
        peakIdx={peakIdx}
        swaps={swaps}
        hoverIdx={hoverIdx}
        onHover={setHoverIdx}
      />
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
      {body('history-graph-svg', false)}
      {expanded && (
        <Modal className="modal-graph" onClose={() => setExpanded(false)}>
          <div className="modal-head">
            <h3>Подорож забігу · {history.length} спроб</h3>
            <span className="hint graph-zoom-hint">🖱 колесо — скільки спроб у вікні · перетягни — рух · подвійний клік — увесь забіг</span>
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setExpanded(false)}>✕ Закрити</button>
          </div>
          <div className="modal-body">
            {body('history-graph-svg history-graph-svg-full', true)}
          </div>
        </Modal>
      )}
    </div>
  );
}

function GraphSvg({
  className,
  zoomable,
  history,
  winner,
  peakIdx,
  swaps,
  hoverIdx,
  onHover,
}: {
  className: string;
  zoomable: boolean;
  history: AttemptResult[];
  winner: ItemSlot;
  peakIdx: number;
  swaps: number[];
  hoverIdx: number | null;
  onHover: (idx: number | null) => void;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const n = history.length;
  const [win, setWin] = useState<Win>({ start: 0, count: n });
  const drag = useRef<{ clientX: number; start: number } | null>(null);

  // Забіг змінився (інший гравець у попапі) — показуємо його цілком.
  useEffect(() => setWin({ start: 0, count: n }), [n]);

  const count = clamp(win.count, Math.min(MIN_VISIBLE, n), n);
  const start = clamp(win.start, 0, Math.max(0, n - count));
  const zoomed = count < n;
  const span = Math.max(1, count - 1);
  const plot = W - PAD * 2;

  const xFor = (i: number) => PAD + ((i - start) / span) * plot;
  const yFor = (lv: number) => H - PAD - (lv / MAX_LEVEL) * (H - PAD * 2);

  /** Номер спроби під курсором (0-based), з урахуванням вікна. */
  const idxAtClientX = (clientX: number): number | null => {
    const svg = ref.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const s = Math.min(rect.width / W, rect.height / H);
    const drawnW = W * s;
    const offX = rect.left + (rect.width - drawnW) / 2;
    const userX = (clientX - offX) / s;
    const f = (userX - PAD) / plot;
    return clamp(Math.round(start + f * span), start, start + count - 1);
  };

  // Колесо змінює РОЗМІР ВІКНА (скільки спроб видно), тримаючи під курсором
  // ту саму спробу. Нативний слухач — щоб preventDefault зупинив скрол модалки.
  useEffect(() => {
    if (!zoomable) return;
    const svg = ref.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const anchor = idxAtClientX(e.clientX);
      if (anchor === null) return;
      setWin((v) => {
        const curCount = clamp(v.count, Math.min(MIN_VISIBLE, n), n);
        const curStart = clamp(v.start, 0, Math.max(0, n - curCount));
        const f = curCount <= 1 ? 0 : (anchor - curStart) / (curCount - 1);
        const next = clamp(Math.round(curCount * (e.deltaY < 0 ? 1 / 1.3 : 1.3)), Math.min(MIN_VISIBLE, n), n);
        if (next === curCount) return v;
        return { count: next, start: clamp(Math.round(anchor - f * (next - 1)), 0, n - next) };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [zoomable, n, start, count]);

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    // Захоплюємо drag локально: колбек setWin може виконатись уже після mouseup.
    const d = drag.current;
    if (zoomable && d) {
      const svg = ref.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const s = Math.min(rect.width / W, rect.height / H);
      const dxUser = (e.clientX - d.clientX) / s;
      const dIdx = Math.round((dxUser / plot) * span);
      setWin((v) => ({ ...v, start: clamp(d.start - dIdx, 0, Math.max(0, n - count)) }));
      return;
    }
    const idx = idxAtClientX(e.clientX);
    if (idx !== null) onHover(idx);
  };

  const gridLevels = [0, 3, 6, 9, 12];

  // Видимий зріз: малюємо лише те, що у вікні — і швидше, і чистіше.
  const from = start;
  const to = start + count; // виключно
  const visible: Array<{ i: number; x: number; y: number; h: AttemptResult }> = [];
  for (let i = from; i < to; i++) visible.push({ i, x: xFor(i), y: yFor(history[i].after), h: history[i] });

  const series = new Map<ItemSlot, typeof visible>();
  for (const p of visible) {
    const arr = series.get(p.h.item);
    if (arr) arr.push(p);
    else series.set(p.h.item, [p]);
  }
  const pathOf = (pts: typeof visible) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  // Підписи осі X: ~6 круглих значень у межах вікна.
  const rawStep = Math.max(1, Math.ceil(count / 6));
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const tickStep = Math.ceil(rawStep / mag) * mag;
  const xTicks: number[] = [];
  for (let numAttempt = Math.ceil((from + 1) / tickStep) * tickStep; numAttempt <= to; numAttempt += tickStep) {
    xTicks.push(numAttempt);
  }

  const hoveredPt = hoverIdx !== null && hoverIdx >= from && hoverIdx < to
    ? { x: xFor(hoverIdx), y: yFor(history[hoverIdx].after), slot: history[hoverIdx].item }
    : null;

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${W} ${H}`}
      className={className + (zoomable && zoomed ? ' zoomed' : '')}
      role="img"
      aria-label="Графік рівня по спробах"
      onMouseMove={handleMove}
      onMouseLeave={() => {
        drag.current = null;
        onHover(null);
      }}
      onMouseDown={(e) => {
        if (zoomable && e.button === 0) drag.current = { clientX: e.clientX, start };
      }}
      onMouseUp={() => {
        drag.current = null;
      }}
      onDoubleClick={() => zoomable && setWin({ start: 0, count: n })}
    >
      {gridLevels.map((lv) => (
        <g key={lv}>
          <line x1={PAD} x2={W - PAD} y1={yFor(lv)} y2={yFor(lv)} className="history-grid-line" vectorEffect="non-scaling-stroke" />
          <text x={2} y={yFor(lv) + 4} className="history-grid-label" fontSize={8}>+{lv}</text>
        </g>
      ))}
      {xTicks.map((numAttempt) => (
        <text key={numAttempt} x={xFor(numAttempt - 1)} y={H - 6} className="history-grid-label" fontSize={8} textAnchor="middle">{numAttempt}</text>
      ))}

      {swaps.filter((i) => i >= from && i < to).map((i) => (
        <line key={'swap' + i} x1={xFor(i)} x2={xFor(i)} y1={PAD - 6} y2={H - PAD} className="history-swap-line" vectorEffect="non-scaling-stroke">
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
              (hoveredPt?.slot === slot ? ' active' : '')
            }
            fill="none"
            vectorEffect="non-scaling-stroke"
          />
        ))}

      {visible.map((p) => {
        const isDrop = p.h.after < p.h.before;
        const dim = p.h.item !== winner;
        return (
          <circle
            key={p.i}
            cx={p.x}
            cy={p.y}
            r={isDrop ? 3 : 2}
            className={'history-point ' + (p.h.success ? 'succ' : isDrop ? 'drop' : 'fail') + (dim ? ' dim' : '')}
          />
        );
      })}

      {peakIdx >= from && peakIdx < to && (
        <circle cx={xFor(peakIdx)} cy={yFor(history[peakIdx].after)} r={5} className="history-marker">
          <title>{`Пік: +${history[peakIdx].after} (спроба №${peakIdx + 1})`}</title>
        </circle>
      )}

      {hoveredPt && (
        <g className="history-hover">
          <line x1={hoveredPt.x} x2={hoveredPt.x} y1={0} y2={H} className="history-crosshair" vectorEffect="non-scaling-stroke" />
          <circle cx={hoveredPt.x} cy={hoveredPt.y} r={5.5} className="history-point-active" vectorEffect="non-scaling-stroke" />
        </g>
      )}
    </svg>
  );
}

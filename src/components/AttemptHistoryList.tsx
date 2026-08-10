// =========================================================
// Список історії спроб (найновіша зверху) — спільний для картки симулятора
// і фінального екрана забігу (раніше розмітка дублювалась байт-у-байт).
// =========================================================

import type { CSSProperties } from 'react';
import { STONE_LABEL } from '../data/refineRates';
import type { AttemptResult } from '../lib/types';

export default function AttemptHistoryList({ history, style }: { history: AttemptResult[]; style?: CSSProperties }) {
  return (
    <div className="sim-history-list" style={style}>
      {[...history].reverse().map((h, i) => (
        <div key={history.length - i} className={'hist-row ' + (h.success ? 'succ' : 'fail')}>
          <span className={'badge ' + h.method}>{STONE_LABEL[h.method]}</span>
          <span className="hist-mid">+{h.before} → +{h.after}</span>
          <span className={'hist-mark ' + (h.success ? 'succ' : 'fail')}>{h.success ? '✓' : '✗'}</span>
        </div>
      ))}
    </div>
  );
}

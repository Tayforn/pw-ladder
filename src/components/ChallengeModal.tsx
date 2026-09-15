// =========================================================
// Перевірка присутності: показуємо кілька каменів у ВИПАДКОВИХ місцях, один
// підсвічено — треба тицьнути саме в нього. Позиції залежать від id
// перевірки, тож сліпий автоклікер (б'є в одну точку) промахується, а
// людина витрачає пару секунд. Клікер під наглядом людини дозволено — мета
// не бан, а неможливість грати зовсім без людини.
// =========================================================

import { useMemo } from 'react';
import Modal from './Modal';
import type { ChallengeView } from '../lib/apiTypes';

const REASON_TEXT: Record<ChallengeView['reason'], string> = {
  record: 'Новий рекорд! Підтвердь, що це ти.',
  session: 'Довгенько граєш — швидка перевірка.',
  rhythm: 'Коротка перевірка ритму.',
  random: 'Коротка перевірка.',
};

/** Детермінований PRNG із рядка — щоб позиції були стабільні в межах однієї
 * перевірки (не стрибали при ре-рендері), але різні для кожної нової. */
function seeded(id: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default function ChallengeModal({
  challenge,
  busy,
  onAnswer,
}: {
  challenge: ChallengeView;
  busy: boolean;
  onAnswer: (choice: number) => void;
}) {
  // Позиції каменів у сітці зі зсувом, порядок слотів перемішано за id.
  const cells = useMemo(() => {
    const rng = seeded(challenge.id);
    const cols = 3;
    const rows = Math.ceil(challenge.options / cols);
    const slots = Array.from({ length: challenge.options }, (_, i) => i);
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    return Array.from({ length: challenge.options }, (_, value) => {
      const slot = slots[value];
      const col = slot % cols;
      const row = Math.floor(slot / cols);
      const left = ((col + 0.5) / cols) * 100 + (rng() - 0.5) * 12;
      const top = ((row + 0.5) / rows) * 100 + (rng() - 0.5) * 12;
      return { value, left: Math.max(8, Math.min(92, left)), top: Math.max(10, Math.min(90, top)) };
    });
  }, [challenge.id, challenge.options]);

  return (
    <Modal width={440} className="challenge-modal">
      <div className="modal-head">
        <h3 style={{ margin: 0 }}>Перевірка присутності</h3>
      </div>
      <div className="modal-body">
        <p className="hint" style={{ marginTop: 0 }}>
          {REASON_TEXT[challenge.reason]} Натисни на <b>підсвічений</b> камінь.
        </p>
        <div
          className="challenge-field"
          style={{ position: 'relative', height: 240, margin: '4px 0', opacity: busy ? 0.5 : 1, pointerEvents: busy ? 'none' : 'auto' }}
        >
          {cells.map((c) => {
            const highlighted = c.value === challenge.target;
            return (
              <button
                key={c.value}
                type="button"
                aria-label={highlighted ? 'Підсвічений камінь' : 'Камінь'}
                className={'challenge-stone' + (highlighted ? ' challenge-stone-target' : '')}
                onClick={() => onAnswer(c.value)}
                style={{
                  position: 'absolute',
                  left: `${c.left}%`,
                  top: `${c.top}%`,
                  transform: 'translate(-50%, -50%)',
                  width: 52,
                  height: 52,
                  borderRadius: '50%',
                  cursor: 'pointer',
                  border: highlighted ? '2px solid var(--accent, #d81f1f)' : '1px solid var(--line, #444)',
                  background: highlighted ? 'var(--accent, #d81f1f)' : 'var(--card, #222)',
                  boxShadow: highlighted ? '0 0 18px 4px rgba(216,31,31,0.6)' : 'none',
                  color: '#fff',
                  fontSize: 22,
                }}
              >
                {highlighted ? '⚒' : '◆'}
              </button>
            );
          })}
        </div>
        <p className="hint" style={{ margin: 0, fontSize: 12 }}>
          Це захист від автоклікерів. Граєш сам — натискаєш за пару секунд.
        </p>
      </div>
    </Modal>
  );
}

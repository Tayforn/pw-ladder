// =========================================================
// Попап-привітання: правила гри + поле нікнейма (localStorage) + "Почати".
// Відкривається при заході на сайт і за кнопкою "Правила" в хедері.
// =========================================================

import { useState } from 'react';

export default function InfoPopup({
  nickname,
  onStart,
}: {
  nickname: string;
  onStart: (nickname: string) => void;
}) {
  const [value, setValue] = useState(nickname);
  const trimmed = value.trim();

  return (
    <div className="modal-overlay">
      <div className="modal" role="dialog" aria-modal="true" style={{ width: 'min(520px, 100%)' }}>
        <div className="modal-head">
          <h3>🔥 Ладдер страждання</h3>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <img
            src={import.meta.env.BASE_URL + 'assets/thunder-hero.gif'}
            alt=""
            style={{ width: '100%', maxHeight: 160, objectFit: 'cover', borderRadius: 'var(--radius-lg)' }}
          />
          <p style={{ margin: 0 }}>
            Заточуй міражем безкоштовно — кожен успіх дає бали. Не вистачає нервів чекати?
            Витрать зароблені бали на камінь-помічник: <b>Небеска</b> й <b>Підземка</b> коштують
            однаково, <b>Світобудова</b> — вдвічі дешевше (але й шанс на високих рівнях мізерний).
          </p>
          <p style={{ margin: 0 }}>
            Провал по-різному відкидає назад: міраж і небесний скидають рівень у +0,
            підземний — лише -1, а світобудови взагалі не чіпає поточний рівень.
          </p>
          <p style={{ margin: 0 }}>
            Коли набридне страждати — тисни «Внести в ладдер»: результат (якщо він кращий
            за попередній) потрапляє в публічний рейтинг, а лічильники скидаються — можна
            починати заново.
          </p>
          <label className="field">
            <span>Нікнейм</span>
            <input
              type="text"
              autoFocus
              maxLength={40}
              placeholder="Твій нік для ладдера"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && trimmed && onStart(trimmed)}
            />
          </label>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-primary btn-lg" disabled={!trimmed} onClick={() => onStart(trimmed)}>
            Почати
          </button>
        </div>
      </div>
    </div>
  );
}

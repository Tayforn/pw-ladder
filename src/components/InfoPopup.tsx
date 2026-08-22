// =========================================================
// Попап-привітання: правила гри + поле нікнейма (localStorage) + "Почати".
// Відкривається при заході на сайт і за кнопкою "Правила" в хедері.
// Під час активного забігу (є спроби) нік заблоковано — зміна ніка посеред
// забігу розщепила б результат гравця на два записи ладдера.
// =========================================================

import { useState } from 'react';
import Modal from './Modal';

export default function InfoPopup({
  nickname,
  nickLocked,
  onStart,
  onClose,
}: {
  nickname: string;
  /** Активний забіг: нік міняти не можна. */
  nickLocked: boolean;
  onStart: (nickname: string) => void;
  /** Не передано (перший вхід без ніка) — попап закривається лише "Почати". */
  onClose?: () => void;
}) {
  const [value, setValue] = useState(nickname);
  const trimmed = value.trim();
  /** Повертається сюди пізніше (напр. за кнопкою "Правила" в хедері), а не
   * зайшов уперше — у нього вже є збережений нік. */
  const isReturning = !!nickname;
  const buttonLabel = !isReturning ? 'Почати' : trimmed === nickname ? 'Закрити' : 'Зберегти нік';

  return (
    <Modal width={520} onClose={onClose}>
      <div className="modal-head">
        <img
          src={import.meta.env.BASE_URL + 'assets/thunder-hero.gif'}
          alt=""
          style={{ width: 40, height: 'auto', flex: '0 0 auto', borderRadius: 'var(--radius)', filter: 'drop-shadow(0 4px 12px rgba(216, 31, 31, 0.5))' }}
        />
        <h3 style={{ margin: 0 }}>Ладдер страждання</h3>
      </div>
      <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
          У забігу <b>два предмети</b>: основна (вищий рівень — саме вона йде в ладдер) і
          підставна. Успіх підставної дає половину балів; переросте основну — міняються ролями.
          Хочеш ловити лузстріки на підставній перед вирішальним тицем — лови: у фіналі гра
          покаже, чи воно працювало. Спроби на підставній теж ідуть у ліміт.
        </p>
        <p style={{ margin: 0 }}>
          На один забіг — максимум <b>200 спроб</b> (усі кнопки разом). Вичерпав ліміт —
          результат сам іде в ладдер, а лічильники скидаються автоматично.
        </p>
        <p style={{ margin: 0 }}>
          У рейтингу (топ-10) головне — <b>найвищий рівень</b>; за однакового рівня перемагає
          той, хто дійшов до нього за <b>меншу кількість спроб</b>, а якщо рівні й спроби —
          перемагають <b>більші бали</b>. Тисни «Внести в ладдер» коли завгодно: якщо результат
          кращий за твій попередній — він зарахується, і лічильники скинуться. Якщо ні — забіг
          просто продовжиться, нічого не втратиш. «Скинути прогрес» без внесення можна лише
          після <b>150 спроб</b> — щоб не перекидати невдалий старт.
        </p>
        <label className="field">
          <span>Нікнейм</span>
          <input
            type="text"
            autoFocus={!nickLocked}
            maxLength={40}
            placeholder="Твій нік для ладдера"
            value={value}
            disabled={nickLocked}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && trimmed && onStart(trimmed)}
          />
          {nickLocked && (
            <span className="hint" style={{ margin: '4px 0 0' }}>
              Нік заблоковано до кінця поточного забігу — внеси результат або скинь прогрес, щоб змінити.
            </span>
          )}
        </label>
      </div>
      <div className="modal-foot">
        <button
          type="button"
          className="btn btn-primary btn-lg"
          style={{ width: '100%' }}
          disabled={!trimmed}
          onClick={() => onStart(trimmed)}
        >
          {buttonLabel}
        </button>
      </div>
    </Modal>
  );
}

// =========================================================
// Попап-правила. Вхід через Discord, нік беремо з сервера клану — поля
// нікнейма більше немає. Усі числа — з налаштувань (не розходяться з грою).
// =========================================================

import Modal from './Modal';
import { resetUnlockAt } from '../lib/ladderEngine';
import type { RunSettings } from '../lib/apiTypes';

export default function InfoPopup({ settings, onClose }: { settings: RunSettings; onClose: () => void }) {
  const s = settings;
  return (
    <Modal width={600} onClose={onClose}>
      <div className="modal-head">
        <img
          src={import.meta.env.BASE_URL + 'assets/thunder-hero.gif'}
          alt=""
          style={{ width: 40, height: 'auto', flex: '0 0 auto', borderRadius: 'var(--radius)', filter: 'drop-shadow(0 4px 12px rgba(216, 31, 31, 0.5))' }}
        />
        <h3 style={{ margin: 0 }}>Ладдер страждання</h3>
      </div>
      <div className="modal-body rules">
        <section>
          <h4>Суть</h4>
          <p>
            На забіг видається запас: <b>{s.mirageCount} міражів</b> і трохи каменів-помічників.
            <b> Міраж = спроба</b>: будь-яка спроба споживає 1 міраж; спроба каменем — додатково 1 такий камінь.
            Провал міража скидає рівень у <b>+0</b>. Мета — якнайвищий рівень, поки не скінчились міражі.
          </p>
        </section>

        <section>
          <h4>Залік і тренування</h4>
          <ul>
            <li><b>Залік</b> — кубик кидає сервер, результат іде в ладдер. Між спробами мінімальна пауза, тож
              автоклікер тут нічого не виграє проти людини.</li>
            <li><b>Тренування</b> — грай скільки завгодно, обкатуй стратегії; у ладдер не йде.</li>
            <li>Іноді з'явиться <b>перевірка присутності</b> (тицьни підсвічений камінь) — щоб не грали ботом без людини.</li>
          </ul>
        </section>

        <section>
          <h4>Предмети</h4>
          <ul>
            <li><b>Основна</b> — та, що зараз найвища за рівнем. Саме її рівень іде в ладдер.</li>
            <li><b>Підставн{s.decoyCount === 1 ? 'а' : 'і'}</b> — {s.decoyCount === 1 ? 'ще один предмет' : `ще ${s.decoyCount} предметів`} зі своїми рівнями, точаться тими ж ресурсами.</li>
            <li>Підставна переросла основну — <b>міняються ролями</b>. При рівних рівнях ролі не міняються.</li>
          </ul>
        </section>

        <section>
          <h4>Камені ({s.skyCount} / {s.underCount} / {s.worldCount} на забіг)</h4>
          <ul>
            <li><b>Небеска</b> ({s.skyCount} шт.) — кращий шанс; провал → <b>+0</b>.</li>
            <li><b>Підземка</b> ({s.underCount} шт.) — провал → лише <b>−1</b>.</li>
            <li><b>Світобудова</b> ({s.worldCount} шт.) — провал <b>не чіпає</b> рівень, але шанс угорі мізерний.</li>
          </ul>
        </section>

        <section>
          <h4>Забіг</h4>
          <ul>
            <li>Скінчились міражі — результат сам іде в ладдер, забіг завершується.</li>
            <li><b>«Внести в ладдер»</b> — коли завгодно; забіг завершується. Кращий за твій рекорд → зараховано.</li>
            <li><b>«Скинути прогрес»</b> — лише після <b>{resetUnlockAt(s)} спроб</b>; скинутий забіг теж рахується як зіграний.</li>
          </ul>
        </section>

        <section>
          <h4>Рейтинг</h4>
          <p>
            Спершу <b>найвищий рівень</b>; за однакового — хто досяг його <b>раніше</b> (у якому за ліком забігу);
            далі — менше спроб і менше платних каменів.
          </p>
        </section>
      </div>
      <div className="modal-foot">
        <button type="button" className="btn btn-primary btn-lg" style={{ width: '100%' }} onClick={onClose}>
          Зрозуміло
        </button>
      </div>
    </Modal>
  );
}

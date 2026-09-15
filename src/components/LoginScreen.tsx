// =========================================================
// Екран входу: грати можна лише учаснику сервера клану в Discord. Читає
// ?login=denied / ?login=error з адреси, щоб пояснити невдалий вхід.
// =========================================================

import { useEffect, useState } from 'react';

function readLoginError(): string | null {
  const p = new URLSearchParams(window.location.search);
  const v = p.get('login');
  if (!v) return null;
  // Прибрати параметр із адреси, щоб не висів після оновлення.
  p.delete('login');
  const qs = p.toString();
  window.history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : '') + window.location.hash);
  if (v === 'denied') return 'Тебе немає на сервері клану або немає потрібної ролі. Ладдер — лише для клану.';
  if (v === 'error') return 'Вхід не вдався. Спробуй ще раз.';
  return null;
}

export default function LoginScreen({ onLogin, offline }: { onLogin: () => void; offline: boolean }) {
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setErr(readLoginError()); }, []);

  return (
    <div className="card calc-card" style={{ textAlign: 'center', padding: '32px 20px' }}>
      <video
        src={import.meta.env.BASE_URL + 'assets/thunder.mp4'}
        poster={import.meta.env.BASE_URL + 'assets/thunder-poster.png'}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        aria-hidden="true"
        style={{ width: 'min(260px, 72%)', height: 'auto', display: 'block', margin: '0 auto 8px', borderRadius: 'var(--radius)', filter: 'drop-shadow(0 6px 20px rgba(216,31,31,0.5))' }}
      />
      <h2 style={{ margin: '14px 0 6px' }}>Ладдер страждання</h2>
      <p className="hint" style={{ maxWidth: 440, margin: '0 auto 18px' }}>
        Щоб грати й потрапити в ладдер, увійди через Discord. Доступ — лише учасникам сервера клану:
        нік у ладдері беремо з сервера, тож ніхто не зможе зайняти чужий.
      </p>
      {err && <p className="form-err" style={{ maxWidth: 440, margin: '0 auto 16px' }}>{err}</p>}
      {offline && (
        <p className="form-err" style={{ maxWidth: 440, margin: '0 auto 16px' }}>
          Сервер зараз недоступний. Спробуй за хвилину.
        </p>
      )}
      <button type="button" className="btn btn-primary btn-lg" onClick={onLogin} disabled={offline}>
        Увійти через Discord
      </button>
    </div>
  );
}

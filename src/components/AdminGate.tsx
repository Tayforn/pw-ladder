// =========================================================
// Гейт адмінських прав — той самий allow-list/логін, що в thunder-info
// (спільний Supabase-проєкт). Рендериться інлайн на сторінці за кнопкою
// "Адмін", а не окремим роутом — сайт однопторінковий.
// =========================================================

import { useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../app/supabaseClient';
import { useAuth } from '../app/useAuth';

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setErr(error.message);
    setBusy(false);
  };

  return (
    <div className="card" style={{ maxWidth: 380, margin: '20px auto' }}>
      <div className="section-head" style={{ marginBottom: 16 }}>
        <span className="eyebrow">Адмінка</span>
        <h2>Вхід</h2>
      </div>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label className="field">
          <span>Email</span>
          <input type="email" value={email} required onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Пароль</span>
          <input type="password" value={password} required onChange={(e) => setPassword(e.target.value)} />
        </label>
        {err && <p className="form-err">{err}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Вхід…' : 'Увійти'}</button>
      </form>
    </div>
  );
}

export default function AdminGate({ children }: { children: (session: Session) => ReactNode }) {
  const { session, isAdmin, loading } = useAuth();

  if (loading) return <p className="hint">Перевірка сесії…</p>;
  if (!session) return <LoginForm />;
  if (!isAdmin) {
    return (
      <div className="card">
        <p>Цей акаунт не має прав адміністратора.</p>
        <button type="button" className="btn btn-ghost" onClick={() => supabase.auth.signOut()}>Вийти</button>
      </div>
    );
  }

  return <>{children(session)}</>;
}

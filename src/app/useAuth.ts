// =========================================================
// Стан авторизації адміна: сесія Supabase Auth + перевірка allow-list
// таблиці `admins` (той самий проєкт/allow-list, що thunder-info — RLS-
// функція is_admin() уже існує в БД, тут лише читаємо результат для UI).
//
// loading перемикається лише при ПЕРШОМУ визначенні сесії — повторні
// onAuthStateChange (напр. рефреш токена при поверненні фокусу на вкладку)
// не повинні на мить розмонтовувати сторінку й губити локальний ігровий стан.
// =========================================================

import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';

interface AuthState {
  session: Session | null;
  isAdmin: boolean;
  loading: boolean;
}

export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let initialized = false;

    async function checkAdmin(s: Session | null) {
      if (!s) {
        if (!cancelled) setIsAdmin(false);
        return;
      }
      const { data } = await supabase.from('admins').select('user_id').eq('user_id', s.user.id).maybeSingle();
      if (!cancelled) setIsAdmin(!!data);
    }

    const finishLoading = () => {
      if (cancelled) return;
      initialized = true;
      setLoading(false);
    };

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      checkAdmin(data.session).finally(finishLoading);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!initialized) setLoading(true);
      checkAdmin(s).finally(finishLoading);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { session, isAdmin, loading };
}

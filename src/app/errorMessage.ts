// =========================================================
// Supabase-помилки (PostgrestError, деякі AuthError) не завжди є
// інстансами нативного Error — `e instanceof Error` тоді хибно `false`,
// і реальний текст помилки губиться за загальним фолбеком. Ця функція
// дістає `.message` з БУДЬ-ЯКОГО об'єкта помилки, а не лише з Error.
// =========================================================

export function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  return fallback;
}

/** Для "fire-and-forget" кнопок (.then(reload) без catch) — інакше помилка
 * (напр. RLS відхилив зміну) губиться взагалі без сліду. */
export function reportError(e: unknown): void {
  alert(errorMessage(e, 'Щось пішло не так. Спробуй ще раз.'));
}

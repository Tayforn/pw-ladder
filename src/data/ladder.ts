// =========================================================
// Шар даних Supabase для ладдера — той самий проєкт/allow-list, що
// thunder-info (лише нові таблиці ladder_settings/ladder_entries,
// див. supabase/migrations/0001..0006).
// =========================================================

import { supabase } from '../app/supabaseClient';
import { errorMessage } from '../app/errorMessage';
import type { AttemptResult } from '../lib/types';

/** Економіка ресурсів (0009): міраж = спроба, камені — штучні ліміти на
 * забіг, підставні — кількість додаткових слотів. Балів немає. */
export interface LadderSettings {
  /** Кількість міражів = ліміт спроб на забіг (кожна спроба споживає 1). */
  mirageCount: number;
  skyCount: number;
  underCount: number;
  worldCount: number;
  /** Кількість підставних шмоток (слотів 'b'..'f'), 0..5. */
  decoyCount: number;
  /** Після скількох спроб розблоковується «Скинути прогрес» (0012). */
  resetUnlockAttempts: number;
}

/** Розширена статистика ОДНОГО (найкращого) забігу гравця — потрібна для
 * спецнагород лідерборду (Best Streak, Luckiest Run тощо) і не впливає на
 * основне ранжування (рівень → спроби). */
export interface LadderStats {
  bestStreak: number;
  worstStreak: number;
  biggestDrop: number;
  biggestComeback: number;
  successRate: number;
  peakAttempt: number;
  luckScore: number;
}

/** Запис ладдера БЕЗ history: повна історія спроб (до 200 записів на
 * гравця) потрібна лише серверному тригеру при ЗАПИСІ та merge в адмінці —
 * тягнути її в кожен список/реалтайм-рефетч було б марними кілобайтами. */
export interface LadderEntry extends LadderStats {
  nickname: string;
  level: number;
  attempts: number;
  points: number;
  updatedAt: string;
  /** Три поля нижче ОБЧИСЛЮЄ сервер із history при записі (0007) —
   * клієнт їх не надсилає, лише читає для спецнагород. */
  aggression: number;
  timesHitZero: number;
  paidAttempts: number;
}

interface SettingsRow {
  mirage_count: number;
  sky_count: number;
  under_count: number;
  world_count: number;
  decoy_count: number;
  reset_unlock_attempts: number;
}
interface EntryRow {
  nickname: string;
  level: number;
  attempts: number;
  points: number;
  updated_at: string;
  best_streak: number;
  worst_streak: number;
  biggest_drop: number;
  biggest_comeback: number;
  success_rate: number;
  peak_attempt: number;
  luck_score: number;
  aggression: number;
  times_hit_zero: number;
  paid_attempts: number;
  /** Приходить лише коли явно вибрано '*' (merge). */
  history?: AttemptResult[];
}

const ENTRY_COLUMNS =
  'nickname, level, attempts, points, updated_at, best_streak, worst_streak, ' +
  'biggest_drop, biggest_comeback, success_rate, peak_attempt, luck_score, ' +
  'aggression, times_hit_zero, paid_attempts';

const settingsFromRow = (r: SettingsRow): LadderSettings => ({
  // `??` — толерантність до БД, де 0009 ще не прогнано.
  mirageCount: r.mirage_count ?? 200,
  skyCount: r.sky_count ?? 15,
  underCount: r.under_count ?? 15,
  worldCount: r.world_count ?? 30,
  decoyCount: r.decoy_count ?? 1,
  // До прогону 0012 колонки немає — відтворюємо стару поведінку
  // «половина міражів», щоб поріг не стрибав.
  resetUnlockAttempts: r.reset_unlock_attempts ?? Math.ceil((r.mirage_count ?? 200) / 2),
});
const entryFromRow = (r: EntryRow): LadderEntry => ({
  nickname: r.nickname,
  level: r.level,
  attempts: r.attempts,
  points: r.points,
  updatedAt: r.updated_at,
  bestStreak: r.best_streak,
  worstStreak: r.worst_streak,
  biggestDrop: r.biggest_drop,
  biggestComeback: r.biggest_comeback,
  successRate: r.success_rate,
  peakAttempt: r.peak_attempt,
  luckScore: r.luck_score,
  aggression: r.aggression ?? 0,
  timesHitZero: r.times_hit_zero ?? 0,
  paidAttempts: r.paid_attempts ?? 0,
});
const statsToRow = (s: LadderStats) => ({
  best_streak: s.bestStreak,
  worst_streak: s.worstStreak,
  biggest_drop: s.biggestDrop,
  biggest_comeback: s.biggestComeback,
  success_rate: s.successRate,
  peak_attempt: s.peakAttempt,
  luck_score: s.luckScore,
});

/** "Кращий" за критерієм рейтингу: вищий рівень; за однакового — менше спроб. */
export const isBetterResult = (level: number, attempts: number, than: { level: number; attempts: number }): boolean =>
  level > than.level || (level === than.level && attempts < than.attempts);

export async function fetchSettings(): Promise<LadderSettings> {
  const { data, error } = await supabase.from('ladder_settings').select('*').eq('id', 1).single();
  if (error) throw error;
  return settingsFromRow(data as SettingsRow);
}

/** Запис усіх налаштувань бекенд-ери (ресурси + темп/перевірки)
 * через Supabase (адмін, RLS is_ladder_admin). Ключі RunSettings → колонки. */
export async function updateGuardSettings(patch: Partial<import('../lib/apiTypes').RunSettings>): Promise<void> {
  const cols: Record<string, string> = {
    mirageCount: 'mirage_count', skyCount: 'sky_count', underCount: 'under_count', worldCount: 'world_count',
    decoyCount: 'decoy_count', resetUnlockAttempts: 'reset_unlock_attempts', minAttemptMs: 'min_attempt_ms',
    burstAttempts: 'burst_attempts', challengeEveryAttempts: 'challenge_every_attempts',
    sessionChallengeMinutes: 'session_challenge_minutes', talanRuns: 'talan_runs',
  };
  const row: Record<string, number> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined && cols[k]) row[cols[k]] = v as number;
  }
  if (Object.keys(row).length === 0) return;
  const { error } = await supabase.from('ladder_settings').update(row).eq('id', 1);
  if (error) throw error;
}

/** Обнулення борду (новий сезон). Таблицю «Талан» на сайті прибрано, але
 * бекенд її ще веде — чистимо разом, щоб дані не розходились. Забіги гравців у
 * ladder_runs лишаються як історія. */
/** Новий сезон (RPC з міграції 0018): чистить ладдер, закриває активні забіги
 * всіх гравців без запису, обнуляє лічильники й нумерацію забігів. Історія
 * забігів лишається в базі. Повертає номер нового сезону. */
export async function resetBoard(): Promise<number> {
  const { data, error } = await supabase.rpc('ladder_new_season');
  if (error) throw error;
  return data as number;
}

export async function updateSettings(patch: Partial<LadderSettings>): Promise<void> {
  const row: Partial<SettingsRow> = {};
  if (patch.mirageCount !== undefined) row.mirage_count = patch.mirageCount;
  if (patch.skyCount !== undefined) row.sky_count = patch.skyCount;
  if (patch.underCount !== undefined) row.under_count = patch.underCount;
  if (patch.worldCount !== undefined) row.world_count = patch.worldCount;
  if (patch.decoyCount !== undefined) row.decoy_count = patch.decoyCount;
  if (patch.resetUnlockAttempts !== undefined) row.reset_unlock_attempts = patch.resetUnlockAttempts;
  const { error } = await supabase.from('ladder_settings').update(row).eq('id', 1);
  if (error) throw error;
}

/** Рейтинг: перш за все за рівнем заточки (головне досягнення), серед
 * однакових рівнів — за НАЙМЕНШОЮ кількістю спроб (= спожитих міражів),
 * а серед рівних і за спробами — за МЕНШОЮ кількістю платних каменів
 * (paid_attempts рахує сервер із history, підробити не можна).
 * Завжди повний список (він легкий — history не вибирається): App ділить
 * його на топ-10 для таблиці і повний — для адмінки/спецнагород. */
export async function fetchLadder(): Promise<LadderEntry[]> {
  const { data, error } = await supabase
    .from('ladder_entries')
    .select(ENTRY_COLUMNS)
    .order('level', { ascending: false })
    .order('attempts', { ascending: true })
    .order('paid_attempts', { ascending: true });
  if (error) throw error;
  return (data as unknown as EntryRow[]).map(entryFromRow);
}

/** Вносить результат, лише якщо він кращий за наявний запис цього ніка.
 * Перевірка "кращий" тут — лише швидкий UX-шлях: авторитетна перевірка
 * живе в серверному тригері (0006), який відхиляє не-кращі UPDATE помилкою
 * 'ladder_result_not_better' — її мапимо на submitted:false, а не кидаємо.
 * history — повна історія спроб забігу; сервер перераховує з неї всю
 * статистику і відхиляє upsert, якщо надіслані числа їй не відповідають. */
export async function submitIfBetter(
  nickname: string,
  level: number,
  attempts: number,
  stats: LadderStats,
  history: AttemptResult[],
): Promise<{ submitted: boolean }> {
  const { data: existing, error: selErr } = await supabase
    .from('ladder_entries')
    .select('level, attempts')
    .eq('nickname', nickname)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing && !isBetterResult(level, attempts, existing as { level: number; attempts: number })) {
    return { submitted: false };
  }

  const { error } = await supabase
    .from('ladder_entries')
    .upsert(
      // points: 0 — бали більше не грають (0009), колонка лишилась not null.
      { nickname, level, attempts, points: 0, history, updated_at: new Date().toISOString(), ...statsToRow(stats) },
      { onConflict: 'nickname' },
    );
  if (error) {
    // Гонка: хтось встиг внести кращий результат між select і upsert.
    if (errorMessage(error, '').includes('ladder_result_not_better')) return { submitted: false };
    throw error;
  }
  return { submitted: true };
}

/** Повна історія найкращого забігу гравця — для попапа перегляду по кліку
 * на рядок ладдера. Єдине місце, де history читається з БД (списки її не
 * тягнуть). Порожній масив — запис створено до 0005 (історії немає). */
export async function fetchEntryHistory(nickname: string): Promise<AttemptResult[]> {
  const { data, error } = await supabase
    .from('ladder_entries')
    .select('history')
    .eq('nickname', nickname)
    .maybeSingle();
  if (error) throw error;
  return ((data as { history?: AttemptResult[] } | null)?.history ?? []);
}

/** +1 до лічильника завершених забігів ніка (RPC bump_run_count, 0013).
 * Повертає нове значення або null при помилці/старій БД без RPC. */
export async function bumpRunCount(nickname: string): Promise<number | null> {
  const { data, error } = await supabase.rpc('bump_run_count', { nick: nickname });
  if (error) {
    console.error('[ladder] bump_run_count', error);
    return null;
  }
  return typeof data === 'number' ? data : null;
}

/** Кількість завершених забігів по всіх ніках → Map<nick, runs>.
 * Порожня Map, якщо таблиці ще нема (0013 не прогнано). */
export async function fetchRunCounts(): Promise<Record<string, number>> {
  const { data, error } = await supabase.from('ladder_run_counts').select('nickname, runs');
  if (error) {
    console.error('[ladder] fetchRunCounts', error);
    return {};
  }
  const out: Record<string, number> = {};
  for (const r of (data as Array<{ nickname: string; runs: number }>)) out[r.nickname] = r.runs;
  return out;
}

export async function resetLadder(): Promise<void> {
  const { error } = await supabase.from('ladder_entries').delete().neq('nickname', '');
  if (error) throw error;
}

/** Видаляє ОДНОГО учасника з ладдера (стирає його результат/статистику
 * повністю) — напр. фейковий/тестовий нік чи прохання гравця. */
export async function deleteLadderEntry(nickname: string): Promise<void> {
  const { error } = await supabase.from('ladder_entries').delete().eq('nickname', nickname);
  if (error) throw error;
}

/** Об'єднує 2+ записи ладдера в один (напр. гравець змінив нік у грі) —
 * лишається найкращий результат серед вибраних (той самий критерій, що й
 * рейтинг), решта видаляється. Адмін-операція: серверний тригер пропускає
 * її без валідації history (записи до 0005 history не мають). */
export async function mergeLadderEntries(nicknames: string[], targetNickname: string): Promise<void> {
  if (nicknames.length < 2) throw new Error('Потрібно обрати щонайменше 2 записи для об’єднання.');
  const { data, error } = await supabase.from('ladder_entries').select('*').in('nickname', nicknames);
  if (error) throw error;
  const rows = data as EntryRow[];
  if (rows.length === 0) return;

  const best = rows.reduce((a, b) => (isBetterResult(b.level, b.attempts, a) ? b : a));
  const target = targetNickname.trim() || best.nickname;

  const { nickname: _bestNick, ...bestData } = best;
  const { error: upsertErr } = await supabase
    .from('ladder_entries')
    .upsert(
      { ...bestData, history: best.history ?? [], nickname: target, updated_at: new Date().toISOString() },
      { onConflict: 'nickname' },
    );
  if (upsertErr) throw upsertErr;

  const toDelete = nicknames.filter((n) => n !== target);
  if (toDelete.length > 0) {
    const { error: delErr } = await supabase.from('ladder_entries').delete().in('nickname', toDelete);
    if (delErr) throw delErr;
  }
}

let subscriberSeq = 0;

/** Живі оновлення таблиці лідерів — кожному виклику потрібен СВІЙ унікальний
 * канал (Supabase кешує канали за назвою, повторний .on() з тим самим
 * іменем кидає помилку), як subscribeToTournamentChanges в pw-pvp. */
export function subscribeLadderChanges(onChange: () => void): () => void {
  const channel = supabase
    .channel(`ladder-changes-${++subscriberSeq}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ladder_entries' }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

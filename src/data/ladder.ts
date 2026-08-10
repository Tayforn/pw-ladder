// =========================================================
// Шар даних Supabase для ладдера — той самий проєкт/allow-list, що
// thunder-info (лише нові таблиці ladder_settings/ladder_entries,
// див. supabase/migrations/0001..0006).
// =========================================================

import { supabase } from '../app/supabaseClient';
import { errorMessage } from '../app/errorMessage';
import type { AttemptResult } from '../lib/types';

export interface LadderSettings {
  pointsPerSuccess: number;
  skyCost: number;
  underCost: number;
  worldCost: number;
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
  points_per_success: number;
  sky_cost: number;
  under_cost: number;
  world_cost: number;
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
  pointsPerSuccess: r.points_per_success,
  skyCost: r.sky_cost,
  underCost: r.under_cost,
  worldCost: r.world_cost,
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

export async function updateSettings(patch: Partial<LadderSettings>): Promise<void> {
  const row: Partial<SettingsRow> = {};
  if (patch.pointsPerSuccess !== undefined) row.points_per_success = patch.pointsPerSuccess;
  if (patch.skyCost !== undefined) row.sky_cost = patch.skyCost;
  if (patch.underCost !== undefined) row.under_cost = patch.underCost;
  if (patch.worldCost !== undefined) row.world_cost = patch.worldCost;
  const { error } = await supabase.from('ladder_settings').update(row).eq('id', 1);
  if (error) throw error;
}

/** Рейтинг: перш за все за рівнем заточки (головне досягнення), а серед
 * однакових рівнів — за НАЙМЕНШОЮ кількістю спроб (бали можна нескінченно
 * накрутити просто клікаючи міраж, спроби так просто не підробиш). Якщо і
 * рівень, і спроби однакові — розв'язує нічию БІЛЬША кількість балів.
 * Завжди повний список (він легкий — history не вибирається): App ділить
 * його на топ-10 для таблиці і повний — для адмінки/спецнагород. */
export async function fetchLadder(): Promise<LadderEntry[]> {
  const { data, error } = await supabase
    .from('ladder_entries')
    .select(ENTRY_COLUMNS)
    .order('level', { ascending: false })
    .order('attempts', { ascending: true })
    .order('points', { ascending: false });
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
  points: number,
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
      { nickname, level, attempts, points, history, updated_at: new Date().toISOString(), ...statsToRow(stats) },
      { onConflict: 'nickname' },
    );
  if (error) {
    // Гонка: хтось встиг внести кращий результат між select і upsert.
    if (errorMessage(error, '').includes('ladder_result_not_better')) return { submitted: false };
    throw error;
  }
  return { submitted: true };
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

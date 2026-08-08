// =========================================================
// Шар даних Supabase для ладдера — той самий проєкт/allow-list, що
// thunder-info (лише нові таблиці ladder_settings/ladder_entries,
// див. supabase/migrations/0001_init.sql).
// =========================================================

import { supabase } from '../app/supabaseClient';

export interface LadderSettings {
  pointsPerSuccess: number;
  skyCost: number;
  underCost: number;
  worldCost: number;
}

export interface LadderEntry {
  nickname: string;
  level: number;
  attempts: number;
  points: number;
  updatedAt: string;
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
}

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
});

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
 * накрутити просто клікаючи міраж, спроби так просто не підробиш — вони й
 * так відображають витрачені бали/камені: дорожчий/ризикованіший шлях до
 * того самого рівня — це саме БІЛЬШЕ спроб, не менше). */
/** limit не задано — повний список (потрібен адмінці для об'єднання
 * записів поза топ-10, які публічна таблиця вже не показує). */
export async function fetchLadder(limit?: number): Promise<LadderEntry[]> {
  let query = supabase
    .from('ladder_entries')
    .select('*')
    .order('level', { ascending: false })
    .order('attempts', { ascending: true });
  if (limit) query = query.limit(limit);
  const { data, error } = await query;
  if (error) throw error;
  return (data as EntryRow[]).map(entryFromRow);
}

/** "Кращий" = вищий рівень; за однакового рівня — менше спроб. Вносить лише
 * якщо результат кращий за вже наявний запис цього ніка. */
export async function submitIfBetter(nickname: string, level: number, attempts: number, points: number): Promise<{ submitted: boolean }> {
  const { data: existing, error: selErr } = await supabase
    .from('ladder_entries')
    .select('level, attempts')
    .eq('nickname', nickname)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing) {
    const e = existing as { level: number; attempts: number };
    const better = level > e.level || (level === e.level && attempts < e.attempts);
    if (!better) return { submitted: false };
  }

  const { error } = await supabase
    .from('ladder_entries')
    .upsert({ nickname, level, attempts, points, updated_at: new Date().toISOString() }, { onConflict: 'nickname' });
  if (error) throw error;
  return { submitted: true };
}

export async function resetLadder(): Promise<void> {
  const { error } = await supabase.from('ladder_entries').delete().neq('nickname', '');
  if (error) throw error;
}

/** Об'єднує 2+ записи ладдера в один (напр. гравець змінив нік у грі) —
 * лишається найкращий результат серед вибраних (той самий критерій, що й
 * рейтинг: вищий рівень, далі менше спроб), решта видаляється. */
export async function mergeLadderEntries(nicknames: string[], targetNickname: string): Promise<void> {
  if (nicknames.length < 2) throw new Error('Потрібно обрати щонайменше 2 записи для об’єднання.');
  const { data, error } = await supabase.from('ladder_entries').select('*').in('nickname', nicknames);
  if (error) throw error;
  const rows = data as EntryRow[];
  if (rows.length === 0) return;

  const best = rows.reduce((a, b) => (b.level > a.level || (b.level === a.level && b.attempts < a.attempts) ? b : a));
  const target = targetNickname.trim() || best.nickname;

  const { error: upsertErr } = await supabase
    .from('ladder_entries')
    .upsert(
      { nickname: target, level: best.level, attempts: best.attempts, points: best.points, updated_at: new Date().toISOString() },
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

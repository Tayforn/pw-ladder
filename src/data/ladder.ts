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

export async function fetchLadder(): Promise<LadderEntry[]> {
  const { data, error } = await supabase.from('ladder_entries').select('*').order('points', { ascending: false });
  if (error) throw error;
  return (data as EntryRow[]).map(entryFromRow);
}

/** Вносить результат у ладдер лише якщо він кращий (більше балів) за вже
 * наявний запис цього ніка — інакше нічого не пише. */
export async function submitIfBetter(nickname: string, level: number, points: number): Promise<{ submitted: boolean }> {
  const { data: existing, error: selErr } = await supabase
    .from('ladder_entries')
    .select('points')
    .eq('nickname', nickname)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing && (existing as { points: number }).points >= points) return { submitted: false };

  const { error } = await supabase
    .from('ladder_entries')
    .upsert({ nickname, level, points, updated_at: new Date().toISOString() }, { onConflict: 'nickname' });
  if (error) throw error;
  return { submitted: true };
}

export async function resetLadder(): Promise<void> {
  const { error } = await supabase.from('ladder_entries').delete().neq('nickname', '');
  if (error) throw error;
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

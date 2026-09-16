-- Ладдер страждання — сезони: «Обнулити ладдер» починає новий сезон повністю.
--
-- Раніше кнопка лише чистила ladder_board / ladder_talan, а активні забіги,
-- лічильник забігів гравця (ladder_players.runs_count) і нумерація забігів
-- (run_index, тайбрейк ладдера) переходили в «новий» ладдер.
--
-- Тепер:
--  • ladder_settings.season — номер поточного сезону;
--  • кожен забіг пам'ятає свій сезон, run_index рахується в межах сезону
--    (тайбрейк «у якому за ліком забігу досягнуто рівень» знову чесний);
--  • ladder_new_season() атомарно: season + 1, активні забіги → 'closed'
--    (без запису в ладдер), чистить ладдер і «Талан», runs_count = 0.
-- Історія забігів і спроб (докази для античиту) лишається в базі.
--
-- Виконати один раз ДО викладки бекенда, що пише ladder_runs.season.

alter table ladder_settings
  add column if not exists season int not null default 1 check (season >= 1);

alter table ladder_runs
  add column if not exists season int not null default 1 check (season >= 1);

alter table ladder_runs drop constraint if exists ladder_runs_player_id_run_index_key;
alter table ladder_runs drop constraint if exists ladder_runs_player_season_run_index_key;
alter table ladder_runs
  add constraint ladder_runs_player_season_run_index_key unique (player_id, season, run_index);

-- 'closed' — забіг закрито початком нового сезону.
alter table ladder_runs drop constraint if exists ladder_runs_status_check;
alter table ladder_runs
  add constraint ladder_runs_status_check check (status in ('active', 'submitted', 'finished', 'reset', 'closed'));

create or replace function ladder_new_season()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  next_season int;
begin
  if not is_ladder_admin() then
    raise exception 'Лише адмін ладдера може почати новий сезон.' using errcode = '42501';
  end if;

  -- Лок рядка налаштувань: бекенд бере його FOR SHARE при старті забігу, тож
  -- забіг, що стартує паралельно, або закриється тут, або почнеться вже в новому сезоні.
  update ladder_settings set season = season + 1 where id = 1 returning season into next_season;
  if next_season is null then
    raise exception 'Немає рядка ladder_settings.';
  end if;

  update ladder_runs
     set status = 'closed', ended_at = now(), challenge = null
   where status = 'active';

  -- where потрібен: pg_safeupdate у Supabase відхиляє delete без умови.
  delete from ladder_board where player_id is not null;
  delete from ladder_talan where player_id is not null;
  update ladder_players set runs_count = 0 where runs_count <> 0;

  return next_season;
end;
$$;

revoke all on function ladder_new_season() from public, anon;
grant execute on function ladder_new_season() to authenticated;

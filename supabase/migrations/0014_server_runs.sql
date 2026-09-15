-- Ладдер страждання — серверні забіги (бекенд на Hetzner, вхід через Discord).
--
-- Створює НОВІ таблиці поруч зі старими й нічого не ламає: поточний сайт
-- і далі пише в ladder_entries, доки не перемкнеться на бекенд. Закриття
-- старих шляхів запису — окрема міграція 0015, її запускати в момент
-- переходу.
--
-- Писати в нові таблиці може лише бекенд: він підключається як postgres
-- і минає RLS. Анонімні відвідувачі бачать тільки публічне — ладдер,
-- «Талан», нік і кількість забігів гравців. Адмін ладдера (is_ladder_admin())
-- додатково читає забіги з сигналами детекції, видаляє записи й банить.
--
-- Виконати один раз: Dashboard → SQL Editor → New query → вставити весь
-- файл → Run.

-- ---------------------------------------------------------------------
-- Гравці й сесії
-- ---------------------------------------------------------------------
create table if not exists ladder_players (
  id uuid primary key default gen_random_uuid(),
  discord_id text not null unique,
  nickname text not null check (char_length(nickname) between 1 and 64),
  avatar_url text,
  runs_count int not null default 0 check (runs_count >= 0),
  banned boolean not null default false,
  created_at timestamptz not null default now(),
  last_login_at timestamptz not null default now()
);

-- У базі лише SHA-256 від токена сесії: витік таблиці не дає увійти.
create table if not exists ladder_sessions (
  token_hash text primary key check (char_length(token_hash) = 64),
  player_id uuid not null references ladder_players (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists ladder_sessions_player_idx on ladder_sessions (player_id);
create index if not exists ladder_sessions_expires_idx on ladder_sessions (expires_at);

-- ---------------------------------------------------------------------
-- Забіги та спроби
-- ---------------------------------------------------------------------
create table if not exists ladder_runs (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references ladder_players (id) on delete cascade,
  run_index int not null check (run_index >= 1),
  status text not null default 'active' check (status in ('active', 'submitted', 'finished', 'reset')),
  -- Знімок налаштувань на старті забігу.
  settings jsonb not null,
  levels int[] not null default '{0,0,0,0,0,0}',
  main_slot text not null default 'a' check (main_slot in ('a', 'b', 'c', 'd', 'e', 'f')),
  used jsonb not null default '{"mirage":0,"sky":0,"under":0,"world":0}',
  attempts int not null default 0 check (attempts >= 0),
  -- Темп (token bucket) і перевірки присутності.
  bucket_tokens double precision not null,
  bucket_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  active_since timestamptz,
  next_random_check int,
  checked_at_attempt int,
  challenge jsonb,
  challenges_passed int not null default 0,
  challenges_failed int not null default 0,
  record_cleared boolean not null default false,
  -- Підсумок.
  final_level int,
  signals jsonb,
  suspicion int,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (player_id, run_index)
);
-- Рівно один активний забіг на гравця.
create unique index if not exists ladder_runs_one_active on ladder_runs (player_id) where status = 'active';
create index if not exists ladder_runs_suspicion_idx on ladder_runs (suspicion desc) where suspicion is not null;

create table if not exists ladder_run_attempts (
  run_id uuid not null references ladder_runs (id) on delete cascade,
  seq int not null check (seq >= 1),
  item text not null check (item in ('a', 'b', 'c', 'd', 'e', 'f')),
  method text not null check (method in ('mirage', 'sky', 'under', 'world')),
  success boolean not null,
  before int not null,
  after int not null,
  p double precision not null,
  role text not null check (role in ('main', 'decoy')),
  at timestamptz not null default now(),
  client_dt double precision,
  click_x real,
  click_y real,
  pointer text,
  primary key (run_id, seq)
);

-- ---------------------------------------------------------------------
-- Ладдер і «Талан»
-- ---------------------------------------------------------------------
-- Один рядок на гравця — його найкращий внесений забіг. Порядок:
-- рівень ↓, номер забігу, у якому рівень досягнуто вперше ↑, спроби ↑.
create table if not exists ladder_board (
  player_id uuid primary key references ladder_players (id) on delete cascade,
  nickname text not null,
  level int not null check (level between 1 and 12),
  run_index int not null check (run_index >= 1),
  attempts int not null,
  paid_attempts int not null,
  best_streak int not null,
  worst_streak int not null,
  biggest_drop int not null,
  biggest_comeback int not null,
  success_rate double precision not null,
  peak_attempt int not null,
  luck_score int not null,
  aggression int not null,
  times_hit_zero int not null,
  history jsonb not null,
  run_id uuid references ladder_runs (id) on delete set null,
  achieved_at timestamptz not null default now()
);
create index if not exists ladder_board_rank_idx on ladder_board (level desc, run_index, attempts, paid_attempts);

-- Найкращий рівень за перші talan_runs забігів гравця.
create table if not exists ladder_talan (
  player_id uuid primary key references ladder_players (id) on delete cascade,
  nickname text not null,
  level int not null check (level between 1 and 12),
  run_index int not null check (run_index >= 1),
  attempts int not null,
  run_id uuid references ladder_runs (id) on delete set null,
  achieved_at timestamptz not null default now()
);
create index if not exists ladder_talan_rank_idx on ladder_talan (level desc, run_index, attempts);

-- ---------------------------------------------------------------------
-- Нові поля адмінки
-- ---------------------------------------------------------------------
alter table ladder_settings
  add column if not exists min_attempt_ms int not null default 150 check (min_attempt_ms between 0 and 5000),
  add column if not exists burst_attempts int not null default 5 check (burst_attempts between 1 and 50),
  add column if not exists challenge_every_attempts int not null default 300 check (challenge_every_attempts >= 0),
  add column if not exists session_challenge_minutes int not null default 60 check (session_challenge_minutes >= 0),
  add column if not exists talan_runs int not null default 10 check (talan_runs between 1 and 1000);

-- ---------------------------------------------------------------------
-- Доступ. Supabase за замовчуванням видає anon/authenticated усі права на
-- нові таблиці — забираємо їх і відкриваємо лише потрібне.
-- ---------------------------------------------------------------------
alter table ladder_players enable row level security;
alter table ladder_sessions enable row level security;
alter table ladder_runs enable row level security;
alter table ladder_run_attempts enable row level security;
alter table ladder_board enable row level security;
alter table ladder_talan enable row level security;

revoke all on ladder_players, ladder_sessions, ladder_runs, ladder_run_attempts, ladder_board, ladder_talan
  from anon, authenticated;

grant select (id, nickname, avatar_url, runs_count) on ladder_players to anon, authenticated;
grant select (banned, created_at, last_login_at) on ladder_players to authenticated;
grant update (banned) on ladder_players to authenticated;
drop policy if exists ladder_players_select on ladder_players;
create policy ladder_players_select on ladder_players for select using (true);
drop policy if exists ladder_players_admin_update on ladder_players;
create policy ladder_players_admin_update on ladder_players
  for update to authenticated using (is_ladder_admin()) with check (is_ladder_admin());

grant select on ladder_board, ladder_talan to anon, authenticated;
grant delete on ladder_board, ladder_talan to authenticated;
drop policy if exists ladder_board_select on ladder_board;
create policy ladder_board_select on ladder_board for select using (true);
drop policy if exists ladder_board_admin_delete on ladder_board;
create policy ladder_board_admin_delete on ladder_board for delete to authenticated using (is_ladder_admin());
drop policy if exists ladder_talan_select on ladder_talan;
create policy ladder_talan_select on ladder_talan for select using (true);
drop policy if exists ladder_talan_admin_delete on ladder_talan;
create policy ladder_talan_admin_delete on ladder_talan for delete to authenticated using (is_ladder_admin());

grant select on ladder_runs, ladder_run_attempts to authenticated;
drop policy if exists ladder_runs_admin_select on ladder_runs;
create policy ladder_runs_admin_select on ladder_runs for select to authenticated using (is_ladder_admin());
drop policy if exists ladder_run_attempts_admin_select on ladder_run_attempts;
create policy ladder_run_attempts_admin_select on ladder_run_attempts for select to authenticated using (is_ladder_admin());

-- ---------------------------------------------------------------------
-- Realtime для публічних таблиць ладдера
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'ladder_board') then
      alter publication supabase_realtime add table ladder_board;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'ladder_talan') then
      alter publication supabase_realtime add table ladder_talan;
    end if;
  end if;
end;
$$;

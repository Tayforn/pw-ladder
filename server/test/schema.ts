// Схема для тестів на PGlite: ті самі таблиці, що й міграція 0014, але без
// RLS/політик/publication (бекенд працює власником БД і минає RLS, тож для
// логіки забігів вони не потрібні). Тримати колонки в синху з 0014.

export const SCHEMA_SQL = `
create table ladder_settings (
  id int primary key default 1 check (id = 1),
  mirage_count int not null default 200,
  sky_count int not null default 15,
  under_count int not null default 15,
  world_count int not null default 30,
  decoy_count int not null default 1,
  reset_unlock_attempts int not null default 100,
  min_attempt_ms int not null default 150,
  burst_attempts int not null default 5,
  challenge_every_attempts int not null default 300,
  session_challenge_minutes int not null default 60,
  talan_runs int not null default 10
);

create table ladder_players (
  id uuid primary key default gen_random_uuid(),
  discord_id text not null unique,
  nickname text not null,
  avatar_url text,
  runs_count int not null default 0,
  banned boolean not null default false,
  created_at timestamptz not null default now(),
  last_login_at timestamptz not null default now()
);

create table ladder_sessions (
  token_hash text primary key,
  player_id uuid not null references ladder_players (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table ladder_runs (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references ladder_players (id) on delete cascade,
  run_index int not null,
  status text not null default 'active',
  settings jsonb not null,
  levels int[] not null default '{0,0,0,0,0,0}',
  main_slot text not null default 'a',
  used jsonb not null default '{"mirage":0,"sky":0,"under":0,"world":0}',
  attempts int not null default 0,
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
  final_level int,
  signals jsonb,
  suspicion int,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (player_id, run_index)
);
create unique index ladder_runs_one_active on ladder_runs (player_id) where status = 'active';

create table ladder_run_attempts (
  run_id uuid not null references ladder_runs (id) on delete cascade,
  seq int not null,
  item text not null,
  method text not null,
  success boolean not null,
  before int not null,
  after int not null,
  p double precision not null,
  role text not null,
  at timestamptz not null default now(),
  client_dt double precision,
  click_x real,
  click_y real,
  pointer text,
  primary key (run_id, seq)
);

create table ladder_board (
  player_id uuid primary key references ladder_players (id) on delete cascade,
  nickname text not null,
  level int not null,
  run_index int not null,
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

create table ladder_talan (
  player_id uuid primary key references ladder_players (id) on delete cascade,
  nickname text not null,
  level int not null,
  run_index int not null,
  attempts int not null,
  run_id uuid references ladder_runs (id) on delete set null,
  achieved_at timestamptz not null default now()
);
`;

export const TEST_SETTINGS = {
  mirage_count: 30, sky_count: 5, under_count: 5, world_count: 5, decoy_count: 1,
  reset_unlock_attempts: 10, min_attempt_ms: 150, burst_attempts: 5,
  challenge_every_attempts: 0, session_challenge_minutes: 0, talan_runs: 3,
};

-- Персонажі pvp.thunderpw.fun (лялька): документ персонажа прив'язаний до
-- гравця ладдера (ladder_players.id = Discord-ідентичність), тож не залежить
-- від ніку, який у Discord можна змінити.
--
-- Пише й читає лише бекенд (server/src/pvp.ts) власником БД: RLS увімкнено
-- без жодних політик, права anon/authenticated відкликано — через Supabase
-- REST таблицю не видно й не змінити.
--
-- doc — компактний документ (src/doll/model/doc.ts у pw-pvp): посилання на
-- речі каталогу, заточка, камені, додані роли, Головний і сети. Базових
-- статів речей у ньому немає, тож підробити їх не вийде. name/cls/level —
-- копія з doc для списку «Мої персонажі» без читання jsonb.
--
-- «Видалення» — archived_at: заявки на турніри пізніше посилатимуться на
-- персонажа, і їхні знімки не мають зависати.

create table if not exists pvp_characters (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references ladder_players (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 32),
  cls text not null check (cls in ('by', 'ga', 'ya', 'rl', 'ij', 'js', 'fx', 'sj', 'ej', 'rg')),
  level int not null check (level between 1 and 105),
  doc jsonb not null check (octet_length(doc::text) < 49152),
  revision int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

-- Імена унікальні в межах гравця (без регістру), архівні не заважають.
create unique index if not exists pvp_characters_player_name
  on pvp_characters (player_id, lower(name)) where archived_at is null;
create index if not exists pvp_characters_player
  on pvp_characters (player_id) where archived_at is null;

alter table pvp_characters enable row level security;
revoke all on pvp_characters from anon, authenticated;

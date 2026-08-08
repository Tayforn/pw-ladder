-- Ладдер страждання — Supabase-схема.
-- ТОЙ САМИЙ проєкт, що thunder-info — таблиці admins/is_admin() уже
-- існують, тут лише нові таблиці й політики, що на них посилаються.
-- Виконати один раз: Dashboard → SQL Editor → New query → вставити
-- весь файл → Run.

-- =========================================================
-- Налаштування гри — один рядок (id=1). Скільки балів дає успішна
-- заточка міражем, і скільки коштує кожен камінь-помічник.
-- =========================================================
create table if not exists ladder_settings (
  id int primary key default 1 check (id = 1),
  points_per_success numeric not null default 10,
  sky_cost numeric not null default 20,
  under_cost numeric not null default 20,
  world_cost numeric not null default 10
);
insert into ladder_settings (id) values (1) on conflict do nothing;

-- =========================================================
-- Публічний ладдер — один рядок на нік (одна людина = одне місце).
-- Оновлюється лише клієнтом, коли новий результат кращий за наявний
-- (перевірка "кращий" — на клієнті перед upsert, див. src/data/ladder.ts).
-- =========================================================
create table if not exists ladder_entries (
  nickname text primary key check (char_length(trim(nickname)) between 1 and 40),
  level int not null check (level >= 0 and level <= 12),
  points numeric not null check (points >= 0),
  updated_at timestamptz not null default now()
);

-- =========================================================
-- RLS: налаштування читає будь-хто, пише лише admin. Ладдер читає
-- будь-хто; вносити/оновлювати СВІЙ результат може будь-хто (як
-- registrations у pw-pvp — anon-ключ і так публічний), видаляти
-- (обнулення) — лише admin.
-- =========================================================
alter table ladder_settings enable row level security;
alter table ladder_entries enable row level security;

create policy ladder_settings_select on ladder_settings for select using (true);
create policy ladder_settings_write on ladder_settings for all using (is_admin()) with check (is_admin());

create policy ladder_entries_select on ladder_entries for select using (true);
create policy ladder_entries_insert on ladder_entries for insert with check (true);
create policy ladder_entries_update on ladder_entries for update using (true) with check (true);
create policy ladder_entries_delete on ladder_entries for delete using (is_admin());

-- Реалтайм — щоб таблиця лідерів оновлювалась у всіх відкритих вкладках
-- без релоаду, коли хтось вносить результат.
alter publication supabase_realtime add table ladder_entries;

-- =========================================================
-- Адмінів для цього сайту заводити не треба окремо — allow-list
-- admins/is_admin() спільний з thunder-info: хто вже адмін там, той
-- адмін і тут.
-- =========================================================

-- Ладдер страждання — лічильник ЗАВЕРШЕНИХ забігів на нікнейм (включно зі
-- скинутими, які в ладдер не потрапляють). Це «м'яка» метрика: скинутий
-- забіг узагалі не доходить до сервера, тож перевірити його неможливо —
-- лише рахуємо факт завершення. Захист від довільних значень: інкремент
-- лише через RPC bump_run_count (+1 за виклик), пряме писання закрите RLS.
-- Виконати один раз: Dashboard → SQL Editor → New query → вставити весь
-- файл → Run.

create table if not exists ladder_run_counts (
  nickname text primary key check (char_length(trim(nickname)) between 1 and 40),
  runs int not null default 0,
  updated_at timestamptz not null default now()
);

alter table ladder_run_counts enable row level security;
-- Читати може будь-хто (показуємо «забігів зіграно» в попапах/нагородах).
drop policy if exists ladder_run_counts_select on ladder_run_counts;
create policy ladder_run_counts_select on ladder_run_counts for select using (true);
-- Без insert/update/delete policy — пряме писання заблоковано; єдиний шлях
-- змінити лічильник — RPC нижче, який лише додає +1.

create or replace function bump_run_count(nick text) returns int
language plpgsql security definer set search_path = public as $$
declare
  n text := trim(nick);
  result int;
begin
  if n = '' or char_length(n) > 40 then
    return 0;
  end if;
  insert into ladder_run_counts (nickname, runs, updated_at)
  values (n, 1, now())
  on conflict (nickname) do update
    set runs = ladder_run_counts.runs + 1, updated_at = now()
  returning runs into result;
  return result;
end;
$$;

-- RPC доступний анонам (гра грає під anon-ключем), але він лише інкрементує.
grant execute on function bump_run_count(text) to anon, authenticated;

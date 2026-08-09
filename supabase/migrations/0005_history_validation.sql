-- Ладдер страждання — "Рівень 1" захисту: клієнт тепер надсилає ПОВНУ
-- історію спроб забігу разом із результатом, і тригер перевіряє кожен
-- крок на відповідність детермінованим правилам гри (перехід рівня за
-- методом+результатом — це чиста арифметика, RNG тут ні до чого), а не
-- лише агреговану статистику як у 0004.
-- Виконати один раз: Dashboard → SQL Editor → New query → вставити весь
-- файл → Run.
--
-- Це ЗНАЧНО підіймає поріг підробки (більше не можна просто виставити
-- довільні best_streak/biggest_drop/luck_score — вони тепер рахуються
-- ТУТ, з наданої історії, і мають збігатися точно), але не є повним
-- захистом: клієнт і далі сам вирішує success/fail кожної спроби (справжній
-- кидок відбувається в браузері), тож технічно можна згенерувати
-- статистично правдоподібну фейкову історію offline. Повний захист —
-- серверна авторитетна RNG (Supabase Edge Function) — суттєво більший
-- проєкт, тут не робимо.

alter table ladder_entries add column if not exists history jsonb not null default '[]'::jsonb;

-- Дзеркало RATES із src/data/refineRates.ts — потрібне, щоб перевірити
-- luck_score, НЕ довіряючи значенню p, яке присилає клієнт разом зі
-- спробою (легко підробити локально інакше).
create table if not exists refine_rates (
  method text not null,
  level int not null check (level between 1 and 12),
  p numeric not null check (p > 0 and p <= 1),
  primary key (method, level)
);
insert into refine_rates (method, level, p) values
  ('mirage', 1, 0.50), ('mirage', 2, 0.30), ('mirage', 3, 0.30), ('mirage', 4, 0.30),
  ('mirage', 5, 0.30), ('mirage', 6, 0.30), ('mirage', 7, 0.30), ('mirage', 8, 0.30),
  ('mirage', 9, 0.25), ('mirage', 10, 0.20), ('mirage', 11, 0.12), ('mirage', 12, 0.05),
  ('sky', 1, 0.60), ('sky', 2, 0.45), ('sky', 3, 0.45), ('sky', 4, 0.45),
  ('sky', 5, 0.45), ('sky', 6, 0.45), ('sky', 7, 0.45), ('sky', 8, 0.45),
  ('sky', 9, 0.40), ('sky', 10, 0.35), ('sky', 11, 0.27), ('sky', 12, 0.20),
  ('under', 1, 0.535), ('under', 2, 0.335), ('under', 3, 0.335), ('under', 4, 0.335),
  ('under', 5, 0.335), ('under', 6, 0.335), ('under', 7, 0.335), ('under', 8, 0.335),
  ('under', 9, 0.285), ('under', 10, 0.235), ('under', 11, 0.155), ('under', 12, 0.085),
  ('world', 1, 1.00), ('world', 2, 0.25), ('world', 3, 0.10), ('world', 4, 0.04),
  ('world', 5, 0.0167), ('world', 6, 0.0077), ('world', 7, 0.0047), ('world', 8, 0.0025),
  ('world', 9, 0.0013), ('world', 10, 0.0007), ('world', 11, 0.0004), ('world', 12, 0.0002)
on conflict (method, level) do update set p = excluded.p;

alter table refine_rates enable row level security;
drop policy if exists refine_rates_select on refine_rates;
create policy refine_rates_select on refine_rates for select using (true);
-- Без insert/update/delete policy — після enable RLS це заблоковано для
-- всіх ролей (нема кому підмінити довідкові шанси).

create or replace function ladder_entries_validate() returns trigger
language plpgsql as $$
declare
  pps numeric;
  n int;
  idx int;
  elem jsonb;
  cur_method text;
  cur_success boolean;
  cur_before int;
  cur_after int;
  expected_after int;
  expected_p numeric;
  cur_level int := 0;
  cur_streak int := 0;
  fail_streak int := 0;
  successes int := 0;
  calc_best_streak int := 0;
  calc_worst_streak int := 0;
  calc_biggest_drop int := 0;
  calc_biggest_comeback int := 0;
  calc_peak_level int := 0;
  calc_peak_attempt int := 0;
  expected_successes numeric := 0;
  calc_luck int;
  afters int[] := '{}';
  before_i int;
  after_i int;
  later_peak int;
  j int;
begin
  n := coalesce(jsonb_array_length(new.history), 0);

  if n <> new.attempts then
    raise exception 'ladder_entries: довжина history (%) не дорівнює attempts (%)', n, new.attempts;
  end if;
  if new.attempts > 200 then
    raise exception 'ladder_entries: attempts (%) перевищує ліміт 200', new.attempts;
  end if;

  -- Прохід 1: перевіряємо кожен перехід і рахуємо агрегати, що не
  -- потребують "погляду вперед" (стріки, дропи, очікувана к-сть успіхів).
  for idx in 0 .. n - 1 loop
    elem := new.history -> idx;
    cur_method := elem ->> 'method';
    cur_success := (elem ->> 'success')::boolean;
    cur_before := (elem ->> 'before')::int;
    cur_after := (elem ->> 'after')::int;

    if cur_method is null or cur_success is null or cur_before is null or cur_after is null then
      raise exception 'ladder_entries: history[%] має відсутні/невалідні поля', idx;
    end if;
    if cur_method not in ('mirage', 'sky', 'under', 'world') then
      raise exception 'ladder_entries: невідомий метод "%" у history[%]', cur_method, idx;
    end if;
    if cur_before <> cur_level then
      raise exception 'ladder_entries: history[%] before (%) не збігається з рівнем після попередньої спроби (%)', idx, cur_before, cur_level;
    end if;

    select p into expected_p from refine_rates where method = cur_method and level = cur_before + 1;
    if expected_p is null then
      raise exception 'ladder_entries: history[%] — немає шансу для %/рівень %+1 (рівень поза межами атаки)', idx, cur_method, cur_before;
    end if;
    expected_successes := expected_successes + expected_p;

    if cur_success then
      expected_after := cur_before + 1;
    elsif cur_method = 'world' then
      expected_after := cur_before;
    elsif cur_method = 'under' then
      expected_after := greatest(0, cur_before - 1);
    else
      expected_after := 0;
    end if;
    if cur_after <> expected_after then
      raise exception 'ladder_entries: history[%] перехід %→% неможливий для % / %', idx, cur_before, cur_after, cur_method, case when cur_success then 'успіх' else 'провал' end;
    end if;

    if cur_success then
      successes := successes + 1;
      cur_streak := cur_streak + 1;
      fail_streak := 0;
      calc_best_streak := greatest(calc_best_streak, cur_streak);
    else
      fail_streak := fail_streak + 1;
      cur_streak := 0;
      calc_worst_streak := greatest(calc_worst_streak, fail_streak);
      if cur_after < cur_before then
        calc_biggest_drop := greatest(calc_biggest_drop, cur_before - cur_after);
      end if;
    end if;

    if cur_after > calc_peak_level then
      calc_peak_level := cur_after;
      calc_peak_attempt := idx + 1;
    end if;

    afters := afters || cur_after;
    cur_level := cur_after;
  end loop;

  if cur_level <> new.level then
    raise exception 'ladder_entries: фінальний рівень історії (%) не збігається з level (%)', cur_level, new.level;
  end if;

  -- Прохід 2: "найбільший відкат" (biggestComeback) — для кожного падіння
  -- дивимось на максимум ПІСЛЯ нього; O(n²), для n<=200 — миттєво.
  for idx in 1 .. n loop
    before_i := case when idx = 1 then 0 else afters[idx - 1] end;
    after_i := afters[idx];
    if after_i < before_i then
      later_peak := after_i;
      for j in (idx + 1) .. n loop
        if afters[j] > later_peak then
          later_peak := afters[j];
        end if;
      end loop;
      calc_biggest_comeback := greatest(calc_biggest_comeback, later_peak - after_i);
    end if;
  end loop;

  if new.attempts > 0 and abs(new.success_rate - (successes::numeric / new.attempts)) > 0.0001 then
    raise exception 'ladder_entries: success_rate (%) не відповідає історії (успіхів % із %)', new.success_rate, successes, new.attempts;
  end if;
  if new.attempts = 0 and new.success_rate <> 0 then
    raise exception 'ladder_entries: success_rate має бути 0 при attempts=0';
  end if;

  if new.best_streak <> calc_best_streak or new.worst_streak <> calc_worst_streak
     or new.biggest_drop <> calc_biggest_drop or new.biggest_comeback <> calc_biggest_comeback
     or new.peak_attempt <> calc_peak_attempt then
    raise exception 'ladder_entries: подана статистика (стріки/дроп/камбек/пік) не відповідає наданій історії';
  end if;

  calc_luck := round(50 + ((successes::numeric / greatest(expected_successes, 0.0001)) - 1) * 50)::int;
  calc_luck := greatest(0, least(100, calc_luck));
  if abs(new.luck_score - calc_luck) > 1 then
    raise exception 'ladder_entries: luck_score (%) не збігається з очікуваним (%) на основі RATES', new.luck_score, calc_luck;
  end if;

  -- Грубий стелю для балів: mirage безкоштовний, тож максимум балів за
  -- забіг — це к-сть спроб, помножена на поточну винагороду за успіх
  -- (points саме по собі history не покриває — камені можна юзати в
  -- будь-який момент за поточні на той час settings).
  select points_per_success into pps from ladder_settings where id = 1;
  if pps is not null and new.points > new.attempts * pps then
    raise exception 'ladder_entries: points (%) неможливі за % спроб і % балів/успіх', new.points, new.attempts, pps;
  end if;

  return new;
end;
$$;

drop trigger if exists ladder_entries_validate_trg on ladder_entries;
create trigger ladder_entries_validate_trg
  before insert or update on ladder_entries
  for each row execute function ladder_entries_validate();

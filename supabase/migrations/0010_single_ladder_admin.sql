-- Ладдер страждання — ВЛАСНИЙ allow-list адмінів замість спільного
-- admins/is_admin() з thunder-info, з жорстким обмеженням: РІВНО ОДИН
-- адмін (унікальний індекс не дасть вставити другий рядок).
--
-- ПЕРЕД запуском: подивись, хто зараз має адмінку (спільну на всі сайти):
--
--   select u.id, u.email, u.last_sign_in_at
--   from admins a join auth.users u on u.id = a.user_id;
--
-- Потім упиши email єдиного адміна ладдера в рядку "ВПИШИ EMAIL" нижче і
-- виконай файл. Спільну таблицю admins НЕ ЧІПАЄМО — адмінки thunder-info
-- та інших сайтів лишаються як були; просто ладдер її більше не читає.
-- Виконати один раз: Dashboard → SQL Editor → New query → Run.

create table if not exists ladder_admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

-- "Пускає лише одного" — буквально: другий рядок вставити неможливо.
create unique index if not exists ladder_admins_single_row on ladder_admins ((true));

alter table ladder_admins enable row level security;
drop policy if exists ladder_admins_select_self on ladder_admins;
-- Кожен залогінений бачить лише СВІЙ рядок (це все, що треба клієнту для
-- перевірки "чи я адмін"); писати може лише Dashboard/service role.
create policy ladder_admins_select_self on ladder_admins
  for select using (auth.uid() = user_id);

create or replace function is_ladder_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from ladder_admins where user_id = auth.uid());
$$;

-- ЄДИНИЙ адмін ладдера: ВПИШИ EMAIL між лапками.
do $$
declare
  admin_id uuid;
begin
  select id into admin_id from auth.users where email = 'ВПИШИ EMAIL';
  if admin_id is null then
    raise exception 'Користувача з таким email немає в auth.users — виправ email у міграції';
  end if;
  delete from ladder_admins;
  insert into ladder_admins (user_id) values (admin_id);
end;
$$;

-- Політики ладдера тепер дивляться на is_ladder_admin().
drop policy if exists ladder_settings_write on ladder_settings;
create policy ladder_settings_write on ladder_settings
  for all using (is_ladder_admin()) with check (is_ladder_admin());

drop policy if exists ladder_entries_delete on ladder_entries;
create policy ladder_entries_delete on ladder_entries
  for delete using (is_ladder_admin());

-- Тригер валідації: адмін-байпас теж через is_ladder_admin().
-- (Повна копія функції з 0009, змінено лише рядок із перевіркою адміна.)
create or replace function ladder_entries_validate() returns trigger
language plpgsql as $$
declare
  n int;
  idx int;
  elem jsonb;
  cur_method text;
  cur_success boolean;
  cur_before int;
  cur_after int;
  cur_item text;
  slot int;
  expected_after int;
  expected_p numeric;
  cur_level int;
  cur_streak int := 0;
  fail_streak int := 0;
  successes int := 0;
  calc_best_streak int := 0;
  calc_worst_streak int := 0;
  expected_successes numeric := 0;
  calc_luck int;
  levels int[] := array_fill(0, array[6]);
  peaks int[] := array_fill(0, array[6]);
  peak_attempts int[] := array_fill(0, array[6]);
  drops int[] := array_fill(0, array[6]);
  used_slots boolean[] := array_fill(false, array[6]);
  winner int := 1;
  distinct_items int := 0;
  sky_n int := 0;
  under_n int := 0;
  world_n int := 0;
  cfg record;
  calc_biggest_comeback int := 0;
  later_peak int;
  w_afters int[] := '{}';
  m int;
  j int;
  before_i int;
  after_i int;
  stake_sum int := 0;
  calc_hit_zero int := 0;
  calc_paid int := 0;
begin
  new.nickname := trim(new.nickname);
  new.updated_at := now();

  -- Адміну ЛАДДЕРА (merge/rename/ручні правки) валідація не потрібна.
  if is_ladder_admin() then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if not (new.level > old.level or (new.level = old.level and new.attempts < old.attempts)) then
      raise exception 'ladder_result_not_better: наявний результат (+% за % спроб) не гірший за надісланий', old.level, old.attempts;
    end if;
  end if;

  n := coalesce(jsonb_array_length(new.history), 0);

  if n <> new.attempts then
    raise exception 'ladder_entries: довжина history (%) не дорівнює attempts (%)', n, new.attempts;
  end if;
  if new.attempts > 500 then
    raise exception 'ladder_entries: attempts (%) перевищує абсолютний ліміт 500', new.attempts;
  end if;

  for idx in 0 .. n - 1 loop
    elem := new.history -> idx;
    cur_method := elem ->> 'method';
    cur_success := (elem ->> 'success')::boolean;
    cur_before := (elem ->> 'before')::int;
    cur_after := (elem ->> 'after')::int;
    cur_item := coalesce(elem ->> 'item', 'a');

    if cur_method is null or cur_success is null or cur_before is null or cur_after is null then
      raise exception 'ladder_entries: history[%] має відсутні/невалідні поля', idx;
    end if;
    if cur_method not in ('mirage', 'sky', 'under', 'world') then
      raise exception 'ladder_entries: невідомий метод "%" у history[%]', cur_method, idx;
    end if;
    slot := strpos('abcdef', cur_item);
    if length(cur_item) <> 1 or slot = 0 then
      raise exception 'ladder_entries: невідомий предмет "%" у history[%]', cur_item, idx;
    end if;
    if not used_slots[slot] then
      used_slots[slot] := true;
      distinct_items := distinct_items + 1;
    end if;

    cur_level := levels[slot];
    if cur_before <> cur_level then
      raise exception 'ladder_entries: history[%] before (%) не збігається з рівнем предмета % після попередньої спроби (%)', idx, cur_before, cur_item, cur_level;
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
      if cur_after = 0 and cur_before >= 1 then
        calc_hit_zero := calc_hit_zero + 1;
      end if;
    end if;

    if cur_method in ('mirage', 'sky') then
      stake_sum := stake_sum + cur_before;
    elsif cur_method = 'under' then
      stake_sum := stake_sum + least(1, cur_before);
    end if;
    if cur_method <> 'mirage' then
      calc_paid := calc_paid + 1;
    end if;
    if cur_method = 'sky' then sky_n := sky_n + 1;
    elsif cur_method = 'under' then under_n := under_n + 1;
    elsif cur_method = 'world' then world_n := world_n + 1;
    end if;

    if not cur_success and cur_after < cur_before then
      drops[slot] := greatest(drops[slot], cur_before - cur_after);
    end if;
    if cur_after > peaks[slot] then
      peaks[slot] := cur_after;
      peak_attempts[slot] := idx + 1;
    end if;
    levels[slot] := cur_after;
  end loop;

  for idx in 2 .. 6 loop
    if levels[idx] > levels[winner] or (levels[idx] = levels[winner] and peaks[idx] > peaks[winner]) then
      winner := idx;
    end if;
  end loop;

  if (select max(v) from unnest(levels) v) <> new.level then
    raise exception 'ladder_entries: фінальний рівень історії (%) не збігається з level (%)', (select max(v) from unnest(levels) v), new.level;
  end if;

  for idx in 0 .. n - 1 loop
    elem := new.history -> idx;
    if strpos('abcdef', coalesce(elem ->> 'item', 'a')) = winner then
      w_afters := w_afters || (elem ->> 'after')::int;
    end if;
  end loop;
  m := coalesce(array_length(w_afters, 1), 0);
  for idx in 1 .. m loop
    before_i := case when idx = 1 then 0 else w_afters[idx - 1] end;
    after_i := w_afters[idx];
    if after_i < before_i then
      later_peak := after_i;
      for j in (idx + 1) .. m loop
        if w_afters[j] > later_peak then
          later_peak := w_afters[j];
        end if;
      end loop;
      calc_biggest_comeback := greatest(calc_biggest_comeback, later_peak - after_i);
    end if;
  end loop;

  select mirage_count, sky_count, under_count, world_count, decoy_count
    into cfg from ladder_settings where id = 1;
  if found then
    if new.attempts > ceil(cfg.mirage_count * 1.5) then
      raise exception 'ladder_entries: спроб/міражів (%) понад ліміт % (з запасом)', new.attempts, cfg.mirage_count;
    end if;
    if sky_n > ceil(cfg.sky_count * 1.5) then
      raise exception 'ladder_entries: небесок (%) понад ліміт % (з запасом)', sky_n, cfg.sky_count;
    end if;
    if under_n > ceil(cfg.under_count * 1.5) then
      raise exception 'ladder_entries: підземок (%) понад ліміт % (з запасом)', under_n, cfg.under_count;
    end if;
    if world_n > ceil(cfg.world_count * 1.5) then
      raise exception 'ladder_entries: світобудов (%) понад ліміт % (з запасом)', world_n, cfg.world_count;
    end if;
    if distinct_items > ceil((cfg.decoy_count + 1) * 1.5) then
      raise exception 'ladder_entries: предметів (%) понад ліміт % (з запасом)', distinct_items, cfg.decoy_count + 1;
    end if;
  end if;

  if new.attempts > 0 and abs(new.success_rate - (successes::numeric / new.attempts)) > 0.0001 then
    raise exception 'ladder_entries: success_rate (%) не відповідає історії (успіхів % із %)', new.success_rate, successes, new.attempts;
  end if;
  if new.attempts = 0 and new.success_rate <> 0 then
    raise exception 'ladder_entries: success_rate має бути 0 при attempts=0';
  end if;

  if new.best_streak <> calc_best_streak or new.worst_streak <> calc_worst_streak
     or new.biggest_drop <> drops[winner] or new.biggest_comeback <> calc_biggest_comeback
     or new.peak_attempt <> peak_attempts[winner] then
    raise exception 'ladder_entries: подана статистика (стріки/дроп/камбек/пік) не відповідає наданій історії';
  end if;

  calc_luck := round(50 + ((successes::numeric / greatest(expected_successes, 0.0001)) - 1) * 50)::int;
  calc_luck := greatest(0, least(100, calc_luck));
  if abs(new.luck_score - calc_luck) > 1 then
    raise exception 'ladder_entries: luck_score (%) не збігається з очікуваним (%) на основі RATES', new.luck_score, calc_luck;
  end if;

  new.points := 0;
  new.aggression := greatest(0, least(100, round(((stake_sum::numeric / greatest(n, 1)) / 1.5) * 100)::int));
  new.times_hit_zero := calc_hit_zero;
  new.paid_attempts := calc_paid;

  return new;
end;
$$;

drop trigger if exists ladder_entries_validate_trg on ladder_entries;
create trigger ladder_entries_validate_trg
  before insert or update on ladder_entries
  for each row execute function ladder_entries_validate();

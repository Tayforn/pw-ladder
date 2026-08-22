-- Ладдер страждання — механіка "підставної шмотки": у забігу ДВА предмети
-- (слоти a/b), кожна спроба в history позначена полем item. Валідація веде
-- два незалежні ланцюжки рівнів; у ладдер іде ВИЩИЙ із фінальних рівнів.
-- Виконати один раз: Dashboard → SQL Editor → New query → вставити весь
-- файл → Run. (Замінює функцію тригера з 0007 — сам тригер лишається.)
--
-- Правила:
--  * item відсутній → 'a' (старі записи і старий клієнт валідні без змін).
--  * level = max(фінал a, фінал b). "Переможець" для статистики по рівнях
--    (biggest_drop / biggest_comeback / peak_attempt): вищий фінальний
--    рівень; при рівності — вищий пік; далі — слот a. Детерміновано з
--    history, клієнт (src/lib/sessionStats.ts) обирає так само.
--  * Статистика по ПОСЛІДОВНОСТІ (стріки, success_rate, luck, агресія,
--    поїздки в нуль, платні камені) — по всіх спробах обох предметів:
--    стрік — властивість ГВЧ, а не предмета.
--  * Бали: успіх "основної" (вищий рівень на момент спроби) дає
--    points_per_success, "підставної" — decoy_points_per_success. Сервер
--    ролі не відтворює: клемп successes * points_per_success і далі
--    коректна верхня межа.
--  * attempts = загальна довжина history — спроби на підставній коштують
--    бюджету 200 так само, як і на основній.

alter table ladder_settings add column if not exists decoy_points_per_success numeric not null default 5;

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
  cur_item text;
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
  -- по предметах
  level_a int := 0;
  level_b int := 0;
  peak_a int := 0;
  peak_b int := 0;
  peak_attempt_a int := 0;
  peak_attempt_b int := 0;
  drop_a int := 0;
  drop_b int := 0;
  afters_a int[] := '{}';
  afters_b int[] := '{}';
  w_afters int[];
  w_drop int;
  w_peak_attempt int;
  m int;
  calc_biggest_comeback int := 0;
  before_i int;
  after_i int;
  later_peak int;
  j int;
  -- 0007: статистика для спецнагород (обчислюється, не валідується)
  stake_sum int := 0;
  calc_hit_zero int := 0;
  calc_paid int := 0;
begin
  new.nickname := trim(new.nickname);
  new.updated_at := now();

  -- Адміну (merge/rename/ручні правки) валідація не потрібна — він і так
  -- має повний доступ до даних через RLS-політики.
  if is_admin() then
    return new;
  end if;

  -- Не-адмін оновлює запис лише СТРОГО кращим результатом (той самий
  -- критерій, що й рейтинг: рівень, далі менше спроб).
  if tg_op = 'UPDATE' then
    if not (new.level > old.level or (new.level = old.level and new.attempts < old.attempts)) then
      raise exception 'ladder_result_not_better: наявний результат (+% за % спроб) не гірший за надісланий', old.level, old.attempts;
    end if;
  end if;

  n := coalesce(jsonb_array_length(new.history), 0);

  if n <> new.attempts then
    raise exception 'ladder_entries: довжина history (%) не дорівнює attempts (%)', n, new.attempts;
  end if;
  if new.attempts > 200 then
    raise exception 'ladder_entries: attempts (%) перевищує ліміт 200', new.attempts;
  end if;

  -- Прохід 1: перевіряємо кожен перехід (у ланцюжку СВОГО предмета) і
  -- рахуємо агрегати, що не потребують "погляду вперед".
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
    if cur_item not in ('a', 'b') then
      raise exception 'ladder_entries: невідомий предмет "%" у history[%]', cur_item, idx;
    end if;

    cur_level := case when cur_item = 'a' then level_a else level_b end;
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

    -- Послідовність (обидва предмети разом)
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

    -- Ставка спроби (дзеркало stakeFor у src/lib/rngProfile.ts).
    if cur_method in ('mirage', 'sky') then
      stake_sum := stake_sum + cur_before;
    elsif cur_method = 'under' then
      stake_sum := stake_sum + least(1, cur_before);
    end if;
    if cur_method <> 'mirage' then
      calc_paid := calc_paid + 1;
    end if;

    -- Предмет (рівневі агрегати)
    if cur_item = 'a' then
      if not cur_success and cur_after < cur_before then
        drop_a := greatest(drop_a, cur_before - cur_after);
      end if;
      if cur_after > peak_a then
        peak_a := cur_after;
        peak_attempt_a := idx + 1;
      end if;
      afters_a := afters_a || cur_after;
      level_a := cur_after;
    else
      if not cur_success and cur_after < cur_before then
        drop_b := greatest(drop_b, cur_before - cur_after);
      end if;
      if cur_after > peak_b then
        peak_b := cur_after;
        peak_attempt_b := idx + 1;
      end if;
      afters_b := afters_b || cur_after;
      level_b := cur_after;
    end if;
  end loop;

  if greatest(level_a, level_b) <> new.level then
    raise exception 'ladder_entries: фінальний рівень історії (%) не збігається з level (%)', greatest(level_a, level_b), new.level;
  end if;

  -- Переможець: вищий фінальний рівень; при рівності — вищий пік; далі — a.
  if level_b > level_a or (level_b = level_a and peak_b > peak_a) then
    w_afters := afters_b;
    w_drop := drop_b;
    w_peak_attempt := peak_attempt_b;
  else
    w_afters := afters_a;
    w_drop := drop_a;
    w_peak_attempt := peak_attempt_a;
  end if;

  -- Прохід 2: "найбільший відкат" по ланцюжку переможця — для кожного
  -- падіння дивимось на максимум ПІСЛЯ нього; O(n²), для n<=200 — миттєво.
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

  if new.attempts > 0 and abs(new.success_rate - (successes::numeric / new.attempts)) > 0.0001 then
    raise exception 'ladder_entries: success_rate (%) не відповідає історії (успіхів % із %)', new.success_rate, successes, new.attempts;
  end if;
  if new.attempts = 0 and new.success_rate <> 0 then
    raise exception 'ladder_entries: success_rate має бути 0 при attempts=0';
  end if;

  if new.best_streak <> calc_best_streak or new.worst_streak <> calc_worst_streak
     or new.biggest_drop <> w_drop or new.biggest_comeback <> calc_biggest_comeback
     or new.peak_attempt <> w_peak_attempt then
    raise exception 'ladder_entries: подана статистика (стріки/дроп/камбек/пік) не відповідає наданій історії';
  end if;

  calc_luck := round(50 + ((successes::numeric / greatest(expected_successes, 0.0001)) - 1) * 50)::int;
  calc_luck := greatest(0, least(100, calc_luck));
  if abs(new.luck_score - calc_luck) > 1 then
    raise exception 'ladder_entries: luck_score (%) не збігається з очікуваним (%) на основі RATES', new.luck_score, calc_luck;
  end if;

  -- Стеля балів: кожен успіх дає не більше points_per_success (підставна —
  -- менше), камені лише віднімають. Клемп замість reject.
  select points_per_success into pps from ladder_settings where id = 1;
  if pps is not null then
    new.points := least(new.points, successes * pps);
  end if;

  -- 0007: статистика спецнагород — сервер обчислює і перезаписує сам.
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

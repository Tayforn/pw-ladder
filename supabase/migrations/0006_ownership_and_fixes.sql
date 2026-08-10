-- Ладдер страждання — "Рівень 2" захисту + виправлення відомих дір.
-- Виконати один раз: Dashboard → SQL Editor → New query → вставити весь
-- файл → Run. (Замінює ЛИШЕ функцію тригера з 0005 — таблиця refine_rates
-- і сам тригер лишаються як були.)
--
-- Що змінюється проти 0005:
--
--  1) "Кращий/не кращий" тепер вирішує СЕРВЕР. Раніше ця перевірка жила
--     лише в клієнті (src/data/ladder.ts), тож будь-хто з консолі міг
--     перезаписати ЧУЖИЙ запис гіршим (але структурно валідним) результатом
--     або перейменувати чужий рядок — RLS update-політика відкрита для всіх.
--     Тепер non-admin UPDATE мусить бути СТРОГО кращим: вищий рівень, або
--     той самий рівень за меншу к-сть спроб. Погіршити/знести чужий запис
--     стало неможливо (підняти чужий нік краще — можливо, як і раніше:
--     нік не автентифікується взагалі, це межа anon-моделі).
--     Помилка "не кращий" НАВМИСНО без префікса 'ladder_entries:' — клієнт
--     розпізнає її як submitted:false, а не як спробу читерства.
--
--  2) Адмін (is_admin()) обходить валідацію повністю: merge записів, у яких
--     ще немає history (створені до 0005), більше не падає на перевірці
--     "довжина history = attempts".
--
--  3) points більше не ВІДХИЛЯЮТЬСЯ, а м'яко обрізаються до стелі
--     successes * points_per_success. Стара перевірка брала ПОТОЧНЕ
--     значення налаштувань: адмін міняє "балів за успіх" посеред чийогось
--     забігу — і чесний сабміт відхилявся як читерський. Бали впливають
--     лише на третій tie-break рейтингу, тож клемп безпечніший за reject.
--
--  4) updated_at завжди ставить сервер — клієнтському значенню не довіряємо.
--
--  5) nickname трімиться на сервері — "Nick" і " Nick " більше не два
--     різні записи (клієнт трімив і так, але клієнт можна обійти).

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

  -- Стеля балів: кожен успіх дає points_per_success, платні камені лише
  -- ВІДНІМАЮТЬ бали, тож більше за successes * pps чесно бути не може.
  -- Клемп замість reject — щоб зміна налаштувань посеред забігу не
  -- перетворювала чесний сабміт на "читерський" (бали — лише третій
  -- tie-break рейтингу).
  select points_per_success into pps from ladder_settings where id = 1;
  if pps is not null then
    new.points := least(new.points, successes * pps);
  end if;

  return new;
end;
$$;

drop trigger if exists ladder_entries_validate_trg on ladder_entries;
create trigger ladder_entries_validate_trg
  before insert or update on ladder_entries
  for each row execute function ladder_entries_validate();

-- Ладдер страждання — базові перевірки узгодженості внесених результатів.
-- Виконати один раз: Dashboard → SQL Editor → New query → вставити весь
-- файл → Run.
--
-- Проблема: RLS на ladder_entries дозволяє insert/update будь-кому (anon-
-- ключ публічний за визначенням), тож "перевірка кращий за попередній" у
-- src/data/ladder.ts — лише клієнтська. Будь-хто з консолі браузера може
-- викликати supabase.from('ladder_entries').upsert({...}) напряму й
-- підставити довільні level/attempts/points/статистику в обхід гри.
--
-- Це НЕ захищає від підробленого RNG — сервер не бачить самих кидків, тож
-- "правдоподібну" фальшивку (напр. занизити attempts трохи) тригер не
-- зловить. Він відсікає лише структурно НЕМОЖЛИВІ або абсурдні значення
-- (напр. рівень +12 за 1 спробу, luck_score поза 0..100, спроби > 200) —
-- саме такі найлегше підробити нашвидкуруч.

create or replace function ladder_entries_validate() returns trigger
language plpgsql as $$
declare
  pps numeric;
  successes numeric;
begin
  -- Рівень росте не більше ніж на 1 за успішну спробу, тож щоб досягти
  -- level, потрібно щонайменше level спроб; ліміт забігу — MAX_ATTEMPTS.
  if new.attempts < new.level or new.attempts > 200 then
    raise exception 'ladder_entries: attempts (%) несумісні з рівнем (%)', new.attempts, new.level;
  end if;

  if new.success_rate < 0 or new.success_rate > 1 then
    raise exception 'ladder_entries: success_rate (%) поза межами 0..1', new.success_rate;
  end if;

  -- К-сть успіхів (з success_rate * attempts) не може бути меншою за
  -- досягнутий рівень (і не може перевищувати attempts — це вже гарантує
  -- перевірка success_rate <= 1, тут просто для симетрії помилки).
  successes := round(new.success_rate * new.attempts);
  if successes < new.level or successes > new.attempts then
    raise exception 'ladder_entries: success_rate/attempts (% / %) не узгоджені з рівнем (%)', new.success_rate, new.attempts, new.level;
  end if;

  if new.best_streak < 0 or new.best_streak > new.attempts
     or new.worst_streak < 0 or new.worst_streak > new.attempts
     or new.peak_attempt < 0 or new.peak_attempt > new.attempts then
    raise exception 'ladder_entries: стрік/peak_attempt виходять за межі attempts (%)', new.attempts;
  end if;

  if new.biggest_drop < 0 or new.biggest_drop > 12 or new.biggest_comeback < 0 or new.biggest_comeback > 12 then
    raise exception 'ladder_entries: biggest_drop/biggest_comeback поза межами 0..12';
  end if;

  if new.luck_score < 0 or new.luck_score > 100 then
    raise exception 'ladder_entries: luck_score (%) поза межами 0..100', new.luck_score;
  end if;

  -- Грубий стелю для балів: mirage безкоштовний, тож максимум балів за
  -- забіг — це к-сть спроб, помножена на поточну винагороду за успіх
  -- (ігнорує витрати на камені, тож межа навмисно з запасом "згори").
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

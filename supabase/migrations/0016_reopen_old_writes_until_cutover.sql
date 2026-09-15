-- Ладдер страждання — ВІДКАТ 0015 до моменту переходу.
--
-- 0015 закрив прямий запис у ladder_entries й лічильник bump_run_count. Але
-- поточний живий клієнт (ще старий, до переходу на бекенд) пише результати
-- саме туди — після 0015 сабміт на сайті перестав працювати. Ця міграція
-- повертає старі шляхи, щоб живий сайт працював, доки фронтенд не
-- перемкнеться на бекенд. У момент переходу знову запустити 0015.
--
-- Виконати один раз: Dashboard → SQL Editor → New query → Run.

-- Політики відкритого запису з 0001.
drop policy if exists ladder_entries_insert on ladder_entries;
create policy ladder_entries_insert on ladder_entries for insert with check (true);
drop policy if exists ladder_entries_update on ladder_entries;
create policy ladder_entries_update on ladder_entries for update using (true) with check (true);

grant insert, update on ladder_entries to anon, authenticated;
grant execute on function bump_run_count(text) to anon, authenticated;

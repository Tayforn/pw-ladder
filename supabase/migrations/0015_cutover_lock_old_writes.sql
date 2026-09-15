-- Ладдер страждання — перехід на бекенд: закриває старі шляхи запису.
--
-- ЗАПУСКАТИ ЛИШЕ В МОМЕНТ ПЕРЕХОДУ, коли фронтенд уже працює через бекенд:
-- до того поточний сайт пише результати напряму в ladder_entries і
-- лічильник забігів через bump_run_count — після цієї міграції обидва
-- шляхи перестануть працювати.
--
-- Старі дані лишаються в ladder_entries як архів (читання не чіпаємо).
-- Виконати один раз: Dashboard → SQL Editor → New query → Run.

drop policy if exists ladder_entries_insert on ladder_entries;
drop policy if exists ladder_entries_update on ladder_entries;
revoke insert, update on ladder_entries from anon, authenticated;

revoke execute on function bump_run_count(text) from public, anon, authenticated;

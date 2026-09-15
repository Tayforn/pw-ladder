-- Ладдер — дозволяємо банити гравця і адміну гільдії (thunder-info), а не
-- лише адміну ладдера. Адміни — одна довірена група, а кнопка «Бан» живе в
-- адмінці guild.thunderpw.fun, яка автентифікує через is_admin().
--
-- Прапорець banned перевіряється на КОЖНОМУ запиті (requirePlayer), тож бан
-- діє миттєво і на ладдері, і на закритих розділах гільдії.
--
-- Виконати один раз: Dashboard → SQL Editor → New query → Run.

drop policy if exists ladder_players_admin_update on ladder_players;
create policy ladder_players_admin_update on ladder_players
  for update to authenticated
  using (is_ladder_admin() or is_admin())
  with check (is_ladder_admin() or is_admin());

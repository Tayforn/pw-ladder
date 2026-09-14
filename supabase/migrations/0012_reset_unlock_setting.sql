-- Ладдер страждання — поріг розблокування «Скинути прогрес» тепер ОКРЕМЕ
-- поле адмінки (reset_unlock_attempts), а не жорстка «половина міражів».
-- Це суто клієнтське правило гри — тригер валідації не змінюється.
-- Сід зберігає поточну поведінку: половина від mirage_count (при 1000
-- міражів → 500); далі крути значення в адмінці як хочеш.
-- Виконати один раз: Dashboard → SQL Editor → New query → вставити весь
-- файл → Run. (Повторний запуск перезапише поле назад на половину міражів.)

alter table ladder_settings add column if not exists reset_unlock_attempts int not null default 100;

update ladder_settings
set reset_unlock_attempts = ceil(mirage_count / 2.0)::int
where id = 1;

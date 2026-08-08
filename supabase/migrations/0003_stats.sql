-- Ладдер страждання — додає розширену статистику забігу для лідерборду
-- зі спецнагородами (Highest Peak, Best Streak, Luckiest Run тощо) і
-- фінального екрана результату.
-- Виконати один раз: Dashboard → SQL Editor → New query → вставити
-- весь файл → Run.

alter table ladder_entries add column if not exists best_streak int not null default 0;
alter table ladder_entries add column if not exists worst_streak int not null default 0;
alter table ladder_entries add column if not exists biggest_drop int not null default 0;
alter table ladder_entries add column if not exists biggest_comeback int not null default 0;
alter table ladder_entries add column if not exists success_rate numeric not null default 0;
alter table ladder_entries add column if not exists peak_attempt int not null default 0;
alter table ladder_entries add column if not exists luck_score int not null default 0;

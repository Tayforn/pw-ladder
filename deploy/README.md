# Деплой бекенда ладдера (Hetzner)

Бекенд — один зібраний файл `server/dist/index.mjs` (esbuild, усе вбудовано,
крім опційного `pg-native`). Стан — у Supabase. Сервер `thunderpw`
(89.167.1.191), Caddy проксить `ladder.thunderpw.fun/api/*` на `127.0.0.1:3001`.

## Одноразове налаштування сервера

```bash
# Node (для запуску бандла) і системний користувач сервісу
apt-get install -y nodejs
adduser --system --group --no-create-home ladder
install -d -o root -g root -m 755 /srv/ladder-api
install -d -o root -g ladder -m 750 /etc/ladder-api

# env: скопіювати server/.env.example у /etc/ladder-api/env і вписати
# DATABASE_URL (з паролем) та DISCORD_CLIENT_SECRET; для заявок сайту турнірів —
# PVP_SUPABASE_URL і PVP_SUPABASE_SERVICE_KEY (див. нижче). Права — root:ladder 640.
install -o root -g ladder -m 640 /dev/null /etc/ladder-api/env
nano /etc/ladder-api/env

# systemd
cp deploy/ladder-api.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now ladder-api
systemctl status ladder-api
```

Discord Developer Portal → OAuth2 → Redirects: додати рівно
`https://ladder.thunderpw.fun/api/auth/callback`.

## Оновлення (кожен деплой)

GitHub Actions (`.github/workflows/deploy.yml`) збирає й викладає **лише
фронтенд** (статику `dist/`). Бекенд збирається й деплоїться **вручну**:
`npm run server:build` (потрібне `../pw-pvp` на задеплоєному коміті — див.
нижче), на сервер кладеться новий `index.mjs`, далі `systemctl restart ladder-api`:

```bash
npm run server:build
scp -i ~/.ssh/hetzner_thunderpw server/dist/index.mjs root@89.167.1.191:/srv/ladder-api/index.mjs
ssh thunderpw 'systemctl restart ladder-api && sleep 1 && curl -fsS localhost:3001/api/health'
```

## Збірка потребує ../pw-pvp

Прийом заявок на фул-рандом сайту турнірів (`POST /api/pvp/registrations`,
`server/src/pvpRegister.ts`) рахує скор заявки моделлю ляльки з репо pw-pvp:
`npm run server:build` (`server/tools/build.mjs`) вбудовує в бандл
`../pw-pvp/src/server/scorer.ts` разом із каталогами речей (JSON, ~3 МБ бандла).
Тому перед збіркою:

- репо pw-pvp лежить поруч (`D:\pw-pvp` ↔ `D:\pw-ladder`) і стоїть на
  **актуальному коміті** — тому, що задеплоєно на pvp.thunderpw.fun (`git -C
  ../pw-pvp pull`), інакше сервер рахуватиме заявки не тією моделлю, що браузер
  і адмінка;
- збірка друкує, яким комітом pw-pvp рахуватиме сервер (`скорер pw-pvp@…`),
  той самий підпис пишеться в `item_breakdown.scorer` кожної заявки;
  `-dirty` — у `../pw-pvp/src` були незакомічені зміни (так не деплоїти).

Після оновлення моделі ляльки в pw-pvp бекенд треба перезібрати й задеплоїти.
Typecheck і тести сервера (`npm run server:typecheck`, `npm test`) теж ідуть у
файли pw-pvp — там мають бути встановлені залежності (`npm ci` у ../pw-pvp).

Змінні середовища для цього ендпоінта (у `/etc/ladder-api/env`, ключ — лише
на сервері): `PVP_SUPABASE_URL` (URL проєкту Supabase сайту турнірів) і
`PVP_SUPABASE_SERVICE_KEY` (service_role-ключ того проєкту). Без них ендпоінт
відповідає `503 not_configured`, а сайт подає заявку напряму, як раніше.

Тим самим service-ключем бекенд підписує свої заявки збереженим персонажем
(`item_breakdown.sig`, HMAC): правило «один персонаж — одна жива заявка на
турнір» рахує лише підписані рядки, тож рядок, вставлений напряму анонімним
ключем (до 0034), справжнього власника не блокує. `item_breakdown.nonce` —
мітка спроби з браузера: після тайм-ауту сайт упізнає за нею свою щойно
записану заявку.

**Одна жива заявка з Discord-акаунта на турнір** (міграція pw-pvp 0035):
будь-яким персонажем, чернеткою з сесією чи іншим ніком. Бекенд пише в
колонку `registrations.account_tag` мітку акаунта — HMAC(турнір, гравець) тим
самим ключем; частковий унікальний індекс не пускає другу живу заявку з тією
самою міткою (і при одночасних запитах, і після тайм-ауту, і коли адмін
повертає відхилену). Перерахунок адміна колонку не чіпає. Відхилена не
рахується. Гість без входу мітки не має (в адмінці — бейдж «без Discord»).
Бекенд, що пише `account_tag`, деплоїти лише ПІСЛЯ 0035.

**Ключ не міняти, поки є відкриті фул-рандом турніри:** після заміни
`PVP_SUPABASE_SERVICE_KEY` міняються всі підписи й мітки акаунтів, і на таких
турнірах кожен акаунт зможе подати ще одну заявку.

### Увімкнення прийому заявок бекендом — строго в такому порядку

1. **env**: вписати `PVP_SUPABASE_URL` і `PVP_SUPABASE_SERVICE_KEY` у
   `/etc/ladder-api/env` (root:ladder 640, без лапок).
2. **деплой**: сайт pw-pvp із поданням заявки через бекенд
   (`src/data/registerApi.ts`) уже задеплоєно; `git -C ../pw-pvp pull` до цього
   коміту, `npm run server:build` (у підписі скорера не має бути `-dirty`),
   залити `index.mjs` і `systemctl restart ladder-api` — як в «Оновленні» вище.
3. **тестова заявка**: подати з сайту заявку на відкритий фул-рандом і
   перевірити в Supabase pvp, що її порахував сервер —
   `select item_breakdown->>'server', item_breakdown->>'scorer' from registrations order by created_at desc limit 1`
   дає `true` і `pw-pvp@<коміт>`. Не так (порожньо) — заявка пішла запасним
   шляхом; причина — у `journalctl -u ladder-api` (рядки `pvp: база турнірів …`
   — 502 від Supabase pvp: URL чи ключ); таких рядків немає — бекенд відповів
   503, тобто змінні з env не підхопились.
4. **лише тепер** — міграцію pw-pvp `0034_server_registrations.sql`
   (прямий insert на фул-рандом і заявки з `character_id` — тільки бекенд). Без
   працюючого бекенда після неї заявки на фул-рандом зупиняться; відкат — у
   шапці міграції.

## Ставки в юанях (pvp.thunderpw.fun)

`server/src/pvpBets.ts`: `POST /api/pvp/bets`, `GET /api/pvp/bets/mine`,
`POST /api/pvp/bets/:id/cancel` — лише з Discord-сесією. Юані сайт не списує:
ставка — запис, суперадмін в адмінці pw-pvp («Ставки») позначає її оплаченою,
коли юані прийшли скарбнику в грі, і виплату — коли передав виграш. Правила
(ринок відкритий, мін/макс, учасник матчу ставить лише на свою перемогу, не
більше 5 ставок на ринок) перевіряє функція бази `place_bet` (міграція pw-pvp
`0036_bets.sql`), бекенд передає їй гравця, нік у Discord і мітку акаунта
(`account_tag`, той самий HMAC, що в заявках). Ті самі змінні `PVP_SUPABASE_*`;
без них — `503 not_configured`.

Порядок: спершу міграція `0036_bets.sql` у Supabase pvp, потім цей бекенд
(без міграції ставки відповідають `503` — функції `place_bet` ще немає), потім
сайт pw-pvp з карткою ставок. Тести сервера (`server/test/pvpBets.test.ts`)
ганяють справжню міграцію 0036 з `../pw-pvp` — там має бути гілка зі ставками.

## Логи

Fastify пише лог рівня `info` і вище (JSON-рядки) у stdout → `journalctl -u
ladder-api`: старт і зупинка, 500 (з маршрутом і стеком), 502 upstream від бази
турнірів (що робили, HTTP-статус, код і текст PostgREST), збої входу через
Discord. Помилки клієнта (400/413/415 від самого Fastify) — без запису. Ключі,
cookie й заголовки запитів у лог не потрапляють; рядків на кожен запит немає
(`disableRequestLogging`).

## Caddy

Блок `ladder.thunderpw.fun` віддає `/api/*` на бекенд, решту — статику SPA
(див. `/etc/caddy/Caddyfile` на сервері).

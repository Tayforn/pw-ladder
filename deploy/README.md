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
# DATABASE_URL (з паролем) та DISCORD_CLIENT_SECRET. Права — root:ladder 640.
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

Збірка йде в GitHub Actions разом із фронтендом; на сервер кладеться новий
`index.mjs`, далі `systemctl restart ladder-api`. Уручну:

```bash
npm run server:build
scp -i ~/.ssh/hetzner_thunderpw server/dist/index.mjs root@89.167.1.191:/srv/ladder-api/index.mjs
ssh thunderpw 'systemctl restart ladder-api && sleep 1 && curl -fsS localhost:3001/api/health'
```

## Caddy

Блок `ladder.thunderpw.fun` віддає `/api/*` на бекенд, решту — статику SPA
(див. `/etc/caddy/Caddyfile` на сервері).

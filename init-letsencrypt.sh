#!/bin/bash
# Первоначальный выпуск Let's Encrypt-сертификата.
#
# Что делает:
#   1. Поднимает frontend-контейнер в bootstrap-режиме (только HTTP, отдаёт
#      ACME challenge) и backend (он самостоятельный).
#   2. Запрашивает у certbot выпуск сертификата для ${DOMAIN} через http-01.
#   3. Перезапускает frontend, чтобы тот подцепил HTTPS-конфиг.
#
# После этого certbot-контейнер сам поддерживает сертификат свежим:
# каждые 12 часов делает `certbot renew`, а nginx раз в 6 часов делает reload.
#
# Использование:
#   1. Запиши DOMAIN и LETSENCRYPT_EMAIL в .env рядом с docker-compose.yml:
#        DOMAIN=example.com
#        LETSENCRYPT_EMAIL=admin@example.com
#   2. Убедись, что 80/443 порты открыты и A-запись DOMAIN указывает на сервер.
#   3. Запусти: ./init-letsencrypt.sh
#   4. После успешного выпуска: ./deploy.sh (или `docker compose up -d`).
#
# Опции:
#   STAGING=1 — выпустить тестовый сертификат от staging-сервера
#               Let's Encrypt (не тратит rate-limit на боевые попытки).

set -e

cd "$(dirname "$0")"

# Грузим .env, если он есть.
if [ -f .env ]; then
    set -a
    . ./.env
    set +a
fi

: "${DOMAIN:?env DOMAIN is required (e.g. export DOMAIN=example.com)}"
: "${LETSENCRYPT_EMAIL:?env LETSENCRYPT_EMAIL is required (e.g. export LETSENCRYPT_EMAIL=admin@example.com)}"

COMPOSE="docker compose -p minesweeper-pvp"

STAGING_FLAG=""
if [ "${STAGING:-0}" = "1" ]; then
    echo "[init] STAGING=1 → используем staging Let's Encrypt (тестовый сертификат)"
    STAGING_FLAG="--staging"
fi

echo "[init] Проверяю наличие docker compose..."
docker compose version >/dev/null

echo "[init] Создаю каталоги для certbot..."
mkdir -p ./letsencrypt/etc ./letsencrypt/var ./letsencrypt/www

EXISTING_CERT="./letsencrypt/etc/live/${DOMAIN}/fullchain.pem"
if [ -f "$EXISTING_CERT" ]; then
    echo "[init] Сертификат уже существует: $EXISTING_CERT"
    echo "[init] Если хочешь перевыпустить — удали ./letsencrypt/etc/live/${DOMAIN}/ и запусти скрипт снова."
    exit 0
fi

echo "[init] (1/3) Поднимаю backend + frontend (frontend в bootstrap-режиме без HTTPS)..."
$COMPOSE up -d --build backend frontend

echo "[init] Жду 5 секунд, чтобы nginx успел подняться на 80-м порту..."
sleep 5

echo "[init] (2/3) Запрашиваю сертификат у Let's Encrypt для домена $DOMAIN ..."
$COMPOSE run --rm --entrypoint "" certbot \
    certbot certonly \
        --webroot \
        --webroot-path=/var/www/certbot \
        --email "$LETSENCRYPT_EMAIL" \
        --agree-tos \
        --no-eff-email \
        $STAGING_FLAG \
        -d "$DOMAIN"

echo "[init] (3/3) Перезапускаю frontend, чтобы подцепить HTTPS-конфиг..."
$COMPOSE up -d --force-recreate frontend
$COMPOSE up -d certbot

echo ""
echo "======================================"
echo "  Сертификат выпущен. Открой:"
echo "    https://${DOMAIN}"
echo "  Автообновление активно через certbot-контейнер."
echo "======================================"

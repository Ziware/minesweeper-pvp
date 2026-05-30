#!/bin/bash
set -e

COMPOSE_PROJECT="minesweeper-pvp"

echo "======================================"
echo "  Minesweeper PvP — Deploy Script"
echo "======================================"

cd "$(dirname "$0")"

# 0. Проверяем, что .env существует (нужен для DOMAIN/LETSENCRYPT_EMAIL).
if [ ! -f .env ]; then
    echo "ERROR: файл .env не найден. Скопируй .env.example в .env и заполни DOMAIN/LETSENCRYPT_EMAIL."
    exit 1
fi

# Подгружаем .env, чтобы вывести URL в финальном сообщении.
set -a
. ./.env
set +a

# Если сертификата ещё нет — подсказываем запустить init-letsencrypt.sh.
CERT_PATH="./letsencrypt/etc/live/${DOMAIN}/fullchain.pem"
if [ ! -f "$CERT_PATH" ]; then
    echo "WARN: сертификат Let's Encrypt не найден ($CERT_PATH)."
    echo "      После деплоя выполни: ./init-letsencrypt.sh"
fi

# 1. Обновляем код
echo "[1/4] Обновляем код из репозитория..."
git fetch --all
git reset --hard origin/main

# 2. Пересобираем образы
# yarn install, tsc, vite build — всё происходит внутри Dockerfile
echo "[2/4] Собираем образы..."
docker compose -p "$COMPOSE_PROJECT" build --no-cache

# 3. Останавливаем старые контейнеры
echo "[3/4] Останавливаем старые контейнеры..."
docker compose -p "$COMPOSE_PROJECT" down --remove-orphans || true

# 4. Запускаем новые контейнеры из свежесобранных образов
echo "[4/4] Запускаем контейнеры..."
docker compose -p "$COMPOSE_PROJECT" up -d

echo ""
echo "======================================"
echo "  Деплой завершён!"
if [ -f "$CERT_PATH" ]; then
    echo "  Сайт   : https://${DOMAIN}"
else
    echo "  Bootstrap-режим (HTTP). Запусти ./init-letsencrypt.sh для выпуска сертификата."
fi
echo "======================================"

docker compose -p "$COMPOSE_PROJECT" ps

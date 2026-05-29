#!/bin/bash
set -e

COMPOSE_PROJECT="minesweeper-pvp"

echo "======================================"
echo "  Minesweeper PvP — Deploy Script"
echo "======================================"

cd "$(dirname "$0")"

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
echo "  Frontend : http://localhost:3000"
echo "  Backend  : http://localhost:3001"
echo "======================================"

docker compose -p "$COMPOSE_PROJECT" ps

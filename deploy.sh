#!/bin/bash
set -e

# ─── Конфигурация ───────────────────────────────────────────
REPO_URL="https://github.com/YOUR_USERNAME/minesweeper-pvp.git"
REPO_DIR="minesweeper-pvp"
COMPOSE_PROJECT="minesweeper-pvp"
# ────────────────────────────────────────────────────────────

echo "======================================"
echo "  Minesweeper PvP — Deploy Script"
echo "======================================"

# 1. Клонируем или обновляем репозиторий
if [ -d "$REPO_DIR/.git" ]; then
  echo "[1/5] Обновляем репозиторий..."
  cd "$REPO_DIR"
  git fetch --all
  git reset --hard origin/main
  cd ..
else
  echo "[1/5] Клонируем репозиторий..."
  git clone "$REPO_URL" "$REPO_DIR"
fi

cd "$REPO_DIR"

# 2. Останавливаем и удаляем старые контейнеры
echo "[2/5] Останавливаем старые контейнеры..."
docker compose -p "$COMPOSE_PROJECT" down --remove-orphans || true

# 3. Удаляем старые образы проекта (чтобы пересобрать с нуля)
echo "[3/5] Удаляем старые образы..."
docker image rm "${COMPOSE_PROJECT}-backend" "${COMPOSE_PROJECT}-frontend" 2>/dev/null || true

# 4. Собираем образы (зависимости устанавливаются внутри Dockerfile)
echo "[4/5] Собираем образы..."
docker compose -p "$COMPOSE_PROJECT" build --no-cache

# 5. Запускаем
echo "[5/5] Запускаем контейнеры..."
docker compose -p "$COMPOSE_PROJECT" up -d

echo ""
echo "======================================"
echo "  Деплой завершён!"
echo "  Frontend : http://localhost:3000"
echo "  Backend  : http://localhost:3001"
echo "======================================"

docker compose -p "$COMPOSE_PROJECT" ps

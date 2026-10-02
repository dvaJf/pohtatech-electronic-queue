#!/usr/bin/env bash
# deploy.sh — запускать на сервере при отсутствии рабочего CI/CD
# Использование:
#   chmod +x deploy.sh   (один раз)
#   ./deploy.sh          (при каждом деплое)

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="$REPO_DIR/docker-compose.yml"

echo "==> [1/4] Переход в директорию репозитория: $REPO_DIR"
cd "$REPO_DIR"

echo "==> [2/4] git pull origin main"
git pull origin main

echo "==> [3/4] Сборка образов (только изменённые)"
docker compose -f "$COMPOSE_FILE" build --pull

echo "==> [4/4] Перезапуск контейнеров без простоя"
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans

echo ""
echo "✅ Деплой завершён. Статус контейнеров:"
docker compose -f "$COMPOSE_FILE" ps

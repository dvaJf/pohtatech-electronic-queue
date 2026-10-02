#!/usr/bin/env bash
# ==============================================================================
# [DEPRECATED / LEGACY]
# Этот скрипт предназначался для односерверного развертывания через docker-compose.
# В ПРОДАКШЕНЕ ИСПОЛЬЗУЕТСЯ GITOPS (GitLab CI -> ArgoCD -> Kubernetes Helm).
# Не запускайте этот скрипт на продакшен-нодах Kubernetes!
# ==============================================================================
set -euo pipefail

# Режим бесконечного цикла (для запуска в фоне/systemd/screen)
if [ "${1:-}" = "--loop" ] || [ "${1:-}" = "-d" ]; then
  INTERVAL="${2:-30}"
  echo "🚀 Запущен автопулл-демон для $(pwd) (интервал: ${INTERVAL}с)"
  while true; do
    "$0" --check || true
    sleep "$INTERVAL"
  done
  exit 0
fi

# Защита от одновременного запуска нескольких процессов деплоя
LOCKFILE="/tmp/suo_autopull.lock"
exec 200>"$LOCKFILE"
flock -n 200 || {
  # Если уже идет предыдущий пулл/пересборка — пропускаем тик
  exit 0
}

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

# Определяем текущую активную ветку
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")"
if [ "$BRANCH" = "HEAD" ] || [ -z "$BRANCH" ]; then
  BRANCH="main"
fi

# Получаем свежие метаданные из удаленного репозитория
if ! git fetch origin "$BRANCH" --quiet 2>/dev/null; then
  exit 0
fi

LOCAL_HASH="$(git rev-parse HEAD)"
REMOTE_HASH="$(git rev-parse "origin/$BRANCH" 2>/dev/null || echo "$LOCAL_HASH")"

# Если новых коммитов нет — завершаем работу тихо
if [ "$LOCAL_HASH" = "$REMOTE_HASH" ]; then
  exit 0
fi

echo "========================================================"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Обнаружены обновления в ветке '$BRANCH'!"
echo "Текущий локальный коммит: $LOCAL_HASH"
echo "Новый удаленный коммит:  $REMOTE_HASH"
echo "========================================================"

echo "📥 Подтягиваем изменения (git pull)..."
git pull origin "$BRANCH"

echo "🐳 Пересобираем и перезапускаем обновленные контейнеры..."
if docker compose version >/dev/null 2>&1; then
  docker compose up -d --build -V
  docker compose exec -T backend /app/api migrate up || true
  if [ -f "scripts/seed_demo_branches.sql" ]; then
    docker compose exec -T postgres psql -U postcode -d postcode -v ON_ERROR_STOP=1 < scripts/seed_demo_branches.sql || true
  fi
else
  docker-compose up -d --build -V
  docker-compose exec -T backend /app/api migrate up || true
  if [ -f "scripts/seed_demo_branches.sql" ]; then
    docker-compose exec -T postgres psql -U postcode -d postcode -v ON_ERROR_STOP=1 < scripts/seed_demo_branches.sql || true
  fi
fi

echo "🧹 Удаление устаревших промежуточных docker-образов..."
docker image prune -f

echo "✅ [$(date '+%Y-%m-%d %H:%M:%S')] Деплой успешно завершен!"
echo ""

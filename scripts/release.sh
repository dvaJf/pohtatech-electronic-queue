#!/usr/bin/env bash
set -euo pipefail

# ── Release & GitOps Trigger Script ──────────────────────────────────────
# Использование: ./scripts/release.sh [backend|frontend|all] [commit_message]
# ─────────────────────────────────────────────────────────────────────────

COMPONENT="${1:-backend}"
MSG="${2:-"chore(release): update $COMPONENT"}"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

SHORT_SHA="$(git rev-parse --short HEAD)"
TAG="v-${SHORT_SHA}-$(date +%s | tail -c 5)"
MASTER_HOST="144.31.181.192"

echo "========================================================"
echo "🚀 Подготовка релиза: $COMPONENT (тег: $TAG)"
echo "========================================================"

# 1. Прогон тестов (CI этап на стороне разработчика)
if [ "$COMPONENT" = "backend" ] || [ "$COMPONENT" = "all" ]; then
  echo "🧪 1/4 Запуск тестов бэкенда (Go)..."
  (cd backend && go test ./...)
  echo "✅ Тесты пройдены!"
fi

# 2. Сборка и отправка Docker-образа в кластер
if [ "$COMPONENT" = "backend" ] || [ "$COMPONENT" = "all" ]; then
  echo "🐳 2/4 Сборка Docker-образа queue-backend:$TAG..."
  docker build -t "queue-backend:$TAG" ./backend
  
  echo "📤 Импорт образа в containerd кластера K3s..."
  docker save "queue-backend:$TAG" | ssh -o StrictHostKeyChecking=no "root@$MASTER_HOST" "k3s ctr images import -"
  
  echo "📝 Обновление тега бэкенда в Helm values..."
  sed -i "s|tag: \".*\" # backend-tag|tag: \"$TAG\" # backend-tag|g; s|tag: \"v.*\"|tag: \"$TAG\"|g" helm/queue-chart/values.yaml
fi

if [ "$COMPONENT" = "frontend" ] || [ "$COMPONENT" = "all" ]; then
  echo "🐳 Сборка Docker-образа queue-frontend:$TAG..."
  docker build -t "queue-frontend:$TAG" -f frontend/Dockerfile.prod ./frontend
  docker save "queue-frontend:$TAG" | ssh -o StrictHostKeyChecking=no "root@$MASTER_HOST" "k3s ctr images import -"
  sed -i "s|queue-frontend\n    tag: \".*\"|queue-frontend\n    tag: \"$TAG\"|g" helm/queue-chart/values.yaml
fi

# 3. Фиксация нового тега в Git (GitOps Single Source of Truth)
echo "📦 3/4 Коммит новой версии в Git..."
git add helm/queue-chart/values.yaml
if ! git diff --cached --quiet; then
  git commit -m "$MSG [tag: $TAG]"
fi

# 4. Передача управления ArgoCD
echo "🔄 4/4 Отправка изменений в репозиторий..."
echo "Если настроен удаленный origin, выполните: git push origin main"
echo ""
echo "✨ ГОТОВО! Дальше всё делает ArgoCD:"
echo "1. ArgoCD заметит новый коммит в Git с тегом $TAG."
echo "2. Выполнит плавный RollingUpdate в Kubernetes без простоя."
echo "3. Статус можно наблюдать вживую: https://pointers-team.tech/argocd/"
echo "========================================================"
